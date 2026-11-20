// history.js — the History bar (after Solidcraft's timeline, laid out as Ji's historybar sketches, multitrack after his
// 9 Nov sketch): two rows —
// "Weave direction": a play button for the crossings of the current step, a reverse button for its direction, and the
// over / under sequence of the strip as arrow tags (made · current · to come) — nothing else: the view says the rest;
// "History": first / previous / play-pause / next / last and one chip per step: an "add strip" step is a bar in the
// strip's own colour, a "lay" step (crossing strips already in hand) two crossed bars, and the step that closes a cell a
// capsule with the cell's polygon (salmon under six, grey at six, blue above, hollow at the rim) over the bar of the
// closing strip; the finished weave is a ✓ chip. With several weavers the chips run on one track per weaver, in one time
// order: a check box per weaver (its letter) shows or hides the weaver in the view and takes its steps into the play.
// The rollback marker (line and dot) sits after the current chip: drag it, click a chip, or use the keys (← → step,
// ↑ ↓ crossing by crossing, space play, Shift-space play the crossings of the step, R reverse, Home / End). Play goes
// step by step ("All steps") or through every crossing of every step ("All sub-steps"). Hovering a chip puts a red dot
// on its cell in the view; the bar folds to three rows when it is narrow and takes its colours from the page theme.

import { WEAVER, WEAVER_HEX } from './weavers.js';

const $ = (id) => document.getElementById(id);
const CELL_FILL = (n) => (n < 6 ? '#E6A092' : n === 6 ? '#C6C8CB' : '#9CCBEC');
const START_FILL = '#E8C25A';

/** the cell layer: an n-gon (hollow at the rim), with its number of sides inside when the cell is singular */
export function cellGlyph(n, rim = false, size = 16, fill = null, number = n !== 6 && !rim) {
  const r = size / 2 - 1.2, cx = size / 2, cy = size / 2, f = rim ? 'none' : (fill || CELL_FILL(n)), stroke = rim ? 'var(--dim)' : 'rgba(0,0,0,0.28)';
  const txt = number && n >= 3 ? `<text x="${cx}" y="${cy + 0.3}" text-anchor="middle" dominant-baseline="central" font-size="${(size * 0.52).toFixed(1)}" font-weight="600" fill="rgba(0,0,0,0.72)">${n}</text>` : '';
  if (n < 3 || n > 12) return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}" stroke="${stroke}" stroke-width="1"/>${txt}</svg>`;
  const pts = []; for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + 2 * Math.PI * k / n; pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`); }
  return `<svg viewBox="0 0 ${size} ${size}"><polygon points="${pts.join(' ')}" fill="${f}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"/>${txt}</svg>`;
}
/** the lath layer: 'add' (a bar in `colour`), 'lay' (two crossed bars), 'cross' (⋈), 'done' (✓), 'none' */
export function lathGlyph(kind, size = 16, colour = '#E8C25A') {
  if (kind === 'add') return `<svg viewBox="0 0 ${size} ${size}"><rect x="1.5" y="5.5" width="13" height="5" rx="1" fill="${colour}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/></svg>`;
  if (kind === 'cont') return `<svg viewBox="0 0 ${size} ${size}"><rect x="1.5" y="5.5" width="13" height="5" rx="1" fill="${colour}" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/><path d="M6 3.2 10.2 8 6 12.8" fill="none" stroke="rgba(0,0,0,0.75)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (kind === 'lay') return `<svg viewBox="0 0 ${size} ${size}"><g transform="rotate(-30 8 8)"><rect x="1.5" y="6" width="13" height="4" rx="1" fill="#b9bbbe"/></g><g transform="rotate(30 8 8)"><rect x="1.5" y="6" width="13" height="4" rx="1" fill="#8d9094"/></g></svg>`;
  if (kind === 'cross') return `<svg viewBox="0 0 ${size} ${size}"><path d="M1.5 3.5 C6 3.5 6 12.5 1.5 12.5 M14.5 3.5 C10 3.5 10 12.5 14.5 12.5" fill="none" stroke="#8d9094" stroke-width="2" stroke-linecap="round"/></svg>`;
  if (kind === 'done') return `<svg viewBox="0 0 ${size} ${size}"><path d="M2.5 8.5 6.5 12.5 13.5 4" fill="none" stroke="var(--ok)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return '';
}

export class History {
  /** callbacks: onStep(k, tick) — the new step and crossing; onHover(cell | −1) while the pointer is over a chip;
   *  onReverse(step) — the reverse button; onShow(show[]) — the weavers shown (check boxes) */
  constructor({ onStep, onHover = null, onReverse = null, onShow = null }) {
    this.onStep = onStep; this.onHover = onHover; this.onReverse = onReverse; this.onShow = onShow;
    this.plan = null; this.k = -1; this.tick = -1; this.playing = false; this.seqPlaying = false; this.timer = null; this.mode = 'ticks'; this.speed = 2.5; this.colourOf = null; this.cm = (x) => x; this.show = [true];
    this.icons = $('h-icons'); this.track = $('h-track'); this.read = $('h-read'); this.marker = $('h-marker'); this.seq = $('d-seq'); this.lanes = $('h-lanes');
    $('h-first').addEventListener('click', () => this.go(this.nextMatch(-1)));
    $('h-last').addEventListener('click', () => this.go(this.n - 1));
    $('h-prev').addEventListener('click', () => this.go(this.prevMatch(this.k)));
    $('h-next').addEventListener('click', () => this.go(this.nextMatch(this.k)));
    $('h-play').addEventListener('click', () => this.togglePlay());
    $('d-play').addEventListener('click', () => this.toggleSeq());
    $('d-rev').addEventListener('click', () => { const st = this.plan?.steps[this.k]; if (st && st.kind === 'add' && this.onReverse) this.onReverse(st); });
    $('h-filter').value = this.mode;
    $('h-filter').addEventListener('change', (e) => { this.mode = e.target.value; if (this.playing) { this.stop(); this.start(); } });
    $('h-speed').value = this.speed; $('h-speed-out').textContent = `${this.speed}/s`;
    $('h-speed').addEventListener('input', (e) => { this.speed = +e.target.value; $('h-speed-out').textContent = `${this.speed}/s`; if (this.playing) { this.stop(); this.start(); } if (this.seqPlaying) { this.stopSeq(); this.startSeq(); } });
    this.icons.addEventListener('click', (e) => { const b = e.target.closest('.hs:not(.ghost)'); if (b) this.go(+b.dataset.step); });
    this.icons.addEventListener('pointerover', (e) => { const b = e.target.closest('.hs:not(.ghost)'); if (b && this.onHover && this.plan) this.onHover(this.plan.steps[+b.dataset.step].cell); });
    this.icons.addEventListener('pointerout', (e) => { const b = e.target.closest('.hs:not(.ghost)'); if (b && this.onHover) this.onHover(-1); });
    this.lanes.addEventListener('change', (e) => {
      const c = e.target.closest('input[data-w]'); if (!c) return;
      this.show[+c.dataset.w] = c.checked;
      if (!this.show.some(Boolean)) { this.show[+c.dataset.w] = true; c.checked = true; }   // one weaver at least
      this.render(); if (this.onShow) this.onShow(this.show.slice());
    });
    this.seq.addEventListener('click', (e) => { const t = e.target.closest('.tag'); if (t && t.dataset.tick !== undefined) this.goTick(+t.dataset.tick); });
    this.track.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.track.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    // the marker: drag it to roll the weave back or forward
    let drag = false;
    this.marker.addEventListener('pointerdown', (e) => { drag = true; this.marker.setPointerCapture(e.pointerId); this.stop(); this.stopSeq(); e.preventDefault(); });
    this.marker.addEventListener('pointermove', (e) => { if (!drag) return; this.go(this.slotAt(e.clientX)); });
    const up = () => { drag = false; };
    this.marker.addEventListener('pointerup', up); this.marker.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === 'ArrowRight') { this.go(this.nextMatch(this.k)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.go(this.prevMatch(this.k)); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === '.') { this.goTick(this.tick + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === ',') { this.goTick(this.tick - 1); e.preventDefault(); }
      else if (e.key === 'Home') { this.go(this.nextMatch(-1)); e.preventDefault(); }
      else if (e.key === 'End') { this.go(this.n - 1); e.preventDefault(); }
      else if (e.key === ' ') { if (e.shiftKey) this.toggleSeq(); else this.togglePlay(); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) { $('d-rev').click(); }
    });
    // fold the bar to three rows when it is narrow
    const bar = $('history'); this._ro = new ResizeObserver(() => { bar.classList.toggle('narrow', bar.clientWidth < 980); }); this._ro.observe(bar);
  }
  get n() { return this.plan ? this.plan.steps.length : 0; }
  get K() { return this.plan ? Math.max(1, this.plan.K || 1) : 1; }
  weaverOf(k) { const st = this.plan.steps[k]; return st && st.weaver >= 0 ? st.weaver : -1; }
  /** a step of a weaver that is shown (the finished weave always) */
  matches(k) { const st = this.plan.steps[k]; if (!st) return false; const wv = this.weaverOf(k); return wv < 0 || this.show[wv] !== false; }
  nextMatch(k) { for (let j = k + 1; j < this.n; j++) if (this.matches(j)) return j; return this.n - 1; }
  prevMatch(k) { for (let j = k - 1; j >= 0; j--) if (this.matches(j)) return j; return this.n ? this.nextMatch(-1) : -1; }
  /** the step whose chip's right edge is nearest to screen x: the marker slot (−1 = before the first chip) */
  slotAt(clientX) {
    const r = this.track.getBoundingClientRect(), x = clientX - r.left + this.track.scrollLeft; let best = -1, bd = Infinity;
    this.buttons.forEach((b, j) => { if (!this.matches(j)) return; const d = Math.abs(b.offsetLeft + b.offsetWidth - x); if (d < bd) { bd = d; best = j; } });
    if (this.buttons.length && x < this.buttons[0].offsetLeft + this.buttons[0].offsetWidth / 2) return -1;
    return best;
  }

  /** colourOf(pieceId) → [light, vivid] hex for the bars; cm(modelUnits) → centimetres */
  setPlan(plan, k = 0, tick = null, { colourOf = this.colourOf, cm = this.cm } = {}) {
    this.stop(); this.stopSeq(); this.plan = plan; this.colourOf = colourOf; this.cm = cm;
    const K = this.K;
    if (this.show.length !== K) this.show = Array(K).fill(true);
    // the weavers: a check box with the weaver's letter and a bar of its colour, one per track
    $('history').classList.toggle('multi', K > 1);
    this.lanes.innerHTML = K > 1 ? Array.from({ length: K }, (_, i) => `<label class="lane" style="--wc:${WEAVER_HEX[i % WEAVER_HEX.length]}" title="weaver ${WEAVER[i]}: shown in the view and played"><input type="checkbox" data-w="${i}"${this.show[i] ? ' checked' : ''}><span class="lk">${WEAVER[i]}</span><span class="lbar"></span></label>`).join('') : '';
    // the chips: one per step, on the track of its weaver; the other tracks keep the column empty
    const chip = (st) => {
      const cls = ['hs', st.kind]; if (st.guest) cls.push('guest'); if (st.closes) cls.push('closes'); if (st.closes && !st.rim && st.valence !== 6) cls.push('sing'); if (st.kind === 'close' && !st.nTicks) cls.push('empty');
      const poly = st.closes ? cellGlyph(st.valence, st.rim, 16, plan.kind !== 'sequence' && st.cellIdx === 0 && K === 1 ? START_FILL : null) : '';
      let g1 = '', g2 = '', title;
      if (st.kind === 'add') { g1 = poly; g2 = lathGlyph(st.cont ? 'cont' : 'add', 16, colourOf ? colourOf(st.piece.id)[0] : '#E8C25A'); if (st.cont) cls.push('cont'); title = `${st.k + 1}: ${st.piece.label} · ${st.nNewCross} crossing${st.nNewCross === 1 ? '' : 's'}`; }
      else if (st.kind === 'lay') { g1 = poly; g2 = st.closes ? (st.sameFamily ? lathGlyph('cross') : '') : lathGlyph('lay'); title = `${st.k + 1}: ${st.nNewCross} crossing${st.nNewCross === 1 ? '' : 's'} between strips in hand`; }
      else if (st.kind === 'close') { g1 = poly; g2 = st.sameFamily ? lathGlyph('cross') : ''; title = `${st.k + 1}: woven by its neighbours`; }
      else { g1 = lathGlyph('done'); title = `${st.k + 1}: the weave is complete`; }
      // the weave meets itself in this step (shape.js planTopology): a ring on the chip — a loop round the shape, or round a patch still open
      if (st.loop) { cls.push('loop', st.loop === 'round' ? 'lround' : 'lhole'); title += ` — ${st.loopText}`; }
      return { cls, html: `<span class="g1">${g1}</span><span class="g2">${g2}</span>`, title: title.replace(/"/g, '&quot;') };
    };
    const chips = plan.steps.map(chip), rows = [];
    for (let r = 0; r < K; r++) {
      const frag = [];
      plan.steps.forEach((st, j) => {
        const c = chips[j], wv = st.weaver >= 0 ? st.weaver : 0;
        if (wv === r) frag.push(`<button class="${c.cls.join(' ')}" data-step="${st.k}" title="${c.title}">${c.html}</button>`);
        else frag.push(`<span class="${c.cls.join(' ')} ghost" aria-hidden="true"></span>`);
      });
      rows.push(`<div class="hlane" data-w="${r}">${frag.join('')}</div>`);
    }
    this.icons.innerHTML = rows.join('');
    this.buttons = Array.from(this.icons.querySelectorAll('.hs:not(.ghost)')).sort((a, b) => a.dataset.step - b.dataset.step);
    let k0 = Math.min(k, this.n - 1); if (k0 >= 0 && !this.matches(k0)) k0 = this.nextMatch(k0);
    this.go(k0, tick, true);
  }

  /** go to step k; tick null = the whole step */
  go(k, tick = null, force = false) {
    if (!this.plan) return;
    k = Math.max(-1, Math.min(this.n - 1, k));
    const st = k >= 0 ? this.plan.steps[k] : null, nT = st ? st.nTicks : 0;
    tick = tick === null || tick === undefined ? nT - 1 : Math.max(nT ? 0 : -1, Math.min(nT - 1, tick));   // no empty "nothing yet" tick (Design update 6)
    if (k === this.k && tick === this.tick && !force) return;
    if (k !== this.k) this.stopSeq();
    this.k = k; this.tick = tick; this.render(); this.onStep(k, tick);
  }
  goTick(i) { if (this.k < 0) return; this.go(this.k, i); }
  render() {
    if (!this.plan) { this.read.textContent = '—'; this.marker.hidden = true; this.seq.innerHTML = ''; return; }
    this.buttons.forEach((b, j) => { b.classList.toggle('cur', j === this.k); b.classList.toggle('future', j > this.k); b.classList.toggle('dimf', !this.matches(j)); });
    for (const l of this.icons.querySelectorAll('.hlane')) l.classList.toggle('off', this.show[+l.dataset.w] === false);
    for (const l of this.lanes.querySelectorAll('.lane')) l.classList.toggle('off', this.show[+l.querySelector('input').dataset.w] === false);
    const st = this.plan.steps[this.k];
    this.read.textContent = `${this.k + 1} / ${this.n}`;
    this.renderSeq(st);
    const b = this.buttons[Math.max(0, this.k)];
    if (b) {
      const tr = this.track, x = b.offsetLeft, w = b.offsetWidth;
      if (x < tr.scrollLeft + 30) tr.scrollLeft = x - 30; else if (x + w > tr.scrollLeft + tr.clientWidth - 40) tr.scrollLeft = x + w - tr.clientWidth + 40;
      this.marker.hidden = false; this.marker.style.left = (this.k < 0 ? Math.max(0, x - 6) : x + w + 1) + 'px';
    }
    $('d-rev').disabled = !(st && st.kind === 'add' && st.nTicks > 0 && this.plan.kind !== 'sequence' && !st.guest);   // the planner's direction is fixed; so is a guest strip's (guests.js)
    $('d-play').disabled = !(st && st.nTicks > 0);
  }
  /** the over / under sequence of the current step as arrow tags — the words only */
  renderSeq(st) {
    if (!st || !st.knots || !st.knots.length) { this.seq.innerHTML = ''; return; }
    // a crossing of a joint's overlap keeps its over / under — the end lies on the strip it is joined to and goes the same
    // way — in another colour (Ji, update 5); the tooltip says which crossing of the overlap and on which strip
    // (a strip the pattern adds to the lattice's own — guests.js: a centre strip of the hemp leaf goes BETWEEN the two
    //  strips of a crossing; a strip beside a strand of the star weave over or under, as any strip)
    const name = (pc) => (pc && pc.label ? pc.label : ''), word = (q) => (q.between ? 'between' : q.goesOver ? 'over' : 'under');
    const tip = (q) => q.rim ? 'the end of the strip at the rim'
      : q.between ? `${name(q.subject)} between ${name(q.pcUnder)} (beneath it) and ${name(q.pcOver)} (on it)${q.join ? ` · overlap ${q.overlap} of ${q.n}: it lies on ${name(q.other)} here` : ''}`
      : q.join ? `overlap ${q.overlap} of ${q.n}: ${name(q.subject)} lies ${q.lapUnder ? 'beneath' : 'on'} ${name(q.other)} here, ${word(q)} ${name(q.partner)}`
      : q.lay ? `${name(q.subject)} ${word(q)} ${name(q.partner)} (both already in hand)` : `${st.piece ? name(st.piece) + ' ' : ''}${word(q)} ${name(q.partner)}`;
    // a crossing that holds a strip laid in by the pattern (the hemp leaf's centre strip, between the two strips): a bar
    // after the word, and the strip's name in the tooltip
    // after the word, and the strip's name before it where the strip is picked up (plan.between: "laid in as you weave")
    const laid = (q) => (this.plan.between && !q.rim && !q.join && !q.guest && q.e !== undefined ? this.plan.between(q.e) : null);
    const tag = (q, i, text) => { const c = laid(q); return `<button class="tag ${i === this.tick ? 'cur' : i < this.tick ? 'made' : 'todo'}${q.join ? ' ov' : ''}${q.clip ? ' clip' : ''}${q.release ? ' rel' : ''}${c ? ' mid' : ''}${q.between ? ' btw' : ''}" data-tick="${i}" title="${tip(q)}${c ? ` — centre strip ${c.label} lies between the two${c.first ? ': it is picked up here' : ''}` : ''}">${c && c.first ? `<b class="new">${c.label}</b> ` : ''}${text}</button>`; };
    this.seq.innerHTML = st.knots.map((q, i) => tag(q, i, q.rim ? 'end' : word(q))).join('');
    const cur = this.seq.querySelector('.tag.cur'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  /** play: step by step ("All steps"), or every crossing of every step and then the next step ("All sub-steps");
   *  the steps of the weavers switched off are passed over */
  togglePlay() { if (this.playing) this.stop(); else this.start(); }
  start() {
    if (!this.plan || this.playing) return;
    this.stopSeq();
    if (this.k >= this.n - 1) this.go(this.nextMatch(-1), this.mode === 'ticks' ? 0 : null);
    this.playing = true; const p = $('h-play'); p.classList.add('on'); p.title = 'pause (space)'; p.querySelector('.ic-play').hidden = true; p.querySelector('.ic-pause').hidden = false;
    const tickFn = () => {
      if (!this.playing) return;
      const st = this.plan.steps[this.k];
      if (this.mode === 'ticks' && st && this.tick < st.nTicks - 1) this.go(this.k, this.tick + 1);   // the next crossing of this step
      else {
        const next = this.nextMatch(this.k);
        if (next <= this.k) { this.stop(); return; }
        this.go(next, this.mode === 'ticks' ? 0 : null);
      }
      const now = this.plan.steps[this.k];
      if (this.k >= this.n - 1 && !(this.mode === 'ticks' && now && this.tick < now.nTicks - 1)) { this.stop(); return; }
      this.timer = setTimeout(tickFn, 1000 / this.speed);            // the pause starts after the step is shown (Solidcraft)
    };
    this.timer = setTimeout(tickFn, 1000 / this.speed);
  }
  stop() {
    this.playing = false; if (this.timer) clearTimeout(this.timer); this.timer = null;
    const p = $('h-play'); p.classList.remove('on'); p.title = 'play (space)'; p.querySelector('.ic-play').hidden = false; p.querySelector('.ic-pause').hidden = true;
  }
  /** play the crossings of the current step one by one */
  toggleSeq() { if (this.seqPlaying) this.stopSeq(); else this.startSeq(); }
  startSeq() {
    const st = this.plan?.steps[this.k]; if (!st || !st.nTicks || this.seqPlaying) return;
    this.stop();
    if (this.tick >= st.nTicks - 1) this.go(this.k, 0);              // the first move is the first crossing (Design update 6)
    this.seqPlaying = true; const p = $('d-play'); p.classList.add('on'); p.title = 'pause (⇧space)'; p.querySelector('.ic-play').hidden = true; p.querySelector('.ic-pause').hidden = false;
    const tickFn = () => {
      if (!this.seqPlaying) return;
      this.go(this.k, this.tick + 1);
      if (this.tick >= st.nTicks - 1) { this.stopSeq(); return; }
      this.seqTimer = setTimeout(tickFn, 1000 / this.speed);
    };
    this.seqTimer = setTimeout(tickFn, 1000 / this.speed);
  }
  stopSeq() {
    this.seqPlaying = false; if (this.seqTimer) clearTimeout(this.seqTimer); this.seqTimer = null;
    const p = $('d-play'); if (!p) return; p.classList.remove('on'); p.title = 'play the crossings of this step (⇧space)'; p.querySelector('.ic-play').hidden = false; p.querySelector('.ic-pause').hidden = true;
  }
}
