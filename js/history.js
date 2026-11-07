// history.js — the History bar (after Solidcraft's timeline, laid out as Ji's historybar-06/07 sketches): two rows —
// "Weave direction": a play button for the crossings of the current sub-step, a reverse button for its direction, and
// the over / under sequence of the strip as arrow tags (made · current · to come), the crossings between strips in
// hand slotted in as "S10 ‹under› S1"; "History": first / previous /
// play-pause / next / last and one chip per sub-step in groups, one group per cell: an "add strip" sub-step is a bar
// in the strip's own colour, a "lay" sub-step (crossing strips already in hand) two crossed bars, and the sub-step
// that closes the cell a capsule with the cell's polygon (as many sides as the cell: salmon under six, grey at six,
// blue above, hollow at the rim, golden for the start cell) over the bar of the closing strip; the finished weave is a
// ✓ chip. A separator ends every cell group. The rollback marker (line and dot) sits after the current chip: drag it,
// click a chip, or use the keys (← → sub-step, Shift for the next filtered one, ↑ ↓ crossing by crossing, space play,
// Shift-space play the crossings, R reverse, Home / End). Wheel over the strip scrolls it. Hovering a chip lights its
// cell in the view; the bar folds to three rows when it is narrow and takes its colours from the page theme.

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
  /** callbacks: onStep(k, tick) — the new sub-step and crossing (tick −1 = none yet); onHover(cell | −1) while the pointer
   *  is over a chip; onReverse(step) — the reverse button */
  constructor({ onStep, onHover = null, onReverse = null }) {
    this.onStep = onStep; this.onHover = onHover; this.onReverse = onReverse; this.plan = null; this.k = -1; this.tick = -1; this.playing = false; this.seqPlaying = false; this.timer = null; this.filter = 'all'; this.speed = 2; this.colourOf = null; this.cm = (x) => x;
    this.icons = $('h-icons'); this.track = $('h-track'); this.read = $('h-read'); this.marker = $('h-marker'); this.seq = $('d-seq');
    $('h-first').addEventListener('click', () => this.go(0));
    $('h-last').addEventListener('click', () => this.go(this.n - 1));
    $('h-prev').addEventListener('click', () => this.go(this.prevMatch(this.k)));
    $('h-next').addEventListener('click', () => this.go(this.nextMatch(this.k)));
    $('h-play').addEventListener('click', () => this.togglePlay());
    $('d-play').addEventListener('click', () => this.toggleSeq());
    $('d-rev').addEventListener('click', () => { const st = this.plan?.steps[this.k]; if (st && st.kind === 'add' && this.onReverse) this.onReverse(st); });
    $('h-filter').addEventListener('change', (e) => { this.filter = e.target.value; this.render(); });
    $('h-speed').addEventListener('input', (e) => { this.speed = +e.target.value; $('h-speed-out').textContent = `${this.speed}/s`; if (this.playing) { this.stop(); this.start(); } if (this.seqPlaying) { this.stopSeq(); this.startSeq(); } });
    this.icons.addEventListener('click', (e) => { const b = e.target.closest('.hs'); if (b) this.go(+b.dataset.step); });
    this.icons.addEventListener('pointerover', (e) => { const b = e.target.closest('.hs'); if (b && this.onHover && this.plan) this.onHover(this.plan.steps[+b.dataset.step].cell); });
    this.icons.addEventListener('pointerout', (e) => { const b = e.target.closest('.hs'); if (b && this.onHover) this.onHover(-1); });
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
      if (e.key === 'ArrowRight') { this.go(e.shiftKey ? this.nextMatch(this.k) : Math.min(this.n - 1, this.k + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.go(e.shiftKey ? this.prevMatch(this.k) : Math.max(-1, this.k - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === '.') { this.goTick(this.tick + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === ',') { this.goTick(this.tick - 1); e.preventDefault(); }
      else if (e.key === 'Home') { this.go(0); e.preventDefault(); }
      else if (e.key === 'End') { this.go(this.n - 1); e.preventDefault(); }
      else if (e.key === ' ') { if (e.shiftKey) this.toggleSeq(); else this.togglePlay(); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) { $('d-rev').click(); }
    });
    // fold the bar to three rows when it is narrow
    const bar = $('history'); this._ro = new ResizeObserver(() => { bar.classList.toggle('narrow', bar.clientWidth < 980); }); this._ro.observe(bar);
  }
  get n() { return this.plan ? this.plan.steps.length : 0; }
  matches(k) {
    const st = this.plan.steps[k]; if (!st) return false;
    if (this.filter === 'cells') return !!st.closes || st.kind === 'done';
    if (this.filter === 'singular') return !!st.closes && !st.rim && st.valence !== 6;
    if (this.filter === 'newstrip') return st.kind === 'add';
    if (this.filter === 'cross') return !!st.sameFamily;
    return true;
  }
  nextMatch(k) { for (let j = k + 1; j < this.n; j++) if (this.matches(j)) return j; return this.n - 1; }
  prevMatch(k) { for (let j = k - 1; j >= 0; j--) if (this.matches(j)) return j; return this.n ? 0 : -1; }
  /** the sub-step whose chip's right edge is nearest to screen x: the marker slot (−1 = before the first chip) */
  slotAt(clientX) {
    const r = this.track.getBoundingClientRect(), x = clientX - r.left + this.track.scrollLeft; let best = -1, bd = Infinity;
    this.buttons.forEach((b, j) => { const d = Math.abs(b.offsetLeft + b.offsetWidth - x); if (d < bd) { bd = d; best = j; } });
    if (this.buttons.length && x < this.buttons[0].offsetLeft + this.buttons[0].offsetWidth / 2) return -1;
    return best;
  }

  /** colourOf(pieceId) → [light, vivid] hex for the bars; cm(modelUnits) → centimetres for the strip lengths */
  setPlan(plan, k = 0, tick = null, { colourOf = this.colourOf, cm = this.cm } = {}) {
    this.stop(); this.stopSeq(); this.plan = plan; this.colourOf = colourOf; this.cm = cm;
    const frag = [];
    for (const st of plan.steps) {
      const cls = ['hs', st.kind]; if (st.closes) cls.push('closes'); if (st.closes && !st.rim && st.valence !== 6) cls.push('sing'); if (st.kind === 'close' && !st.nTicks) cls.push('empty');
      const cellName = st.kind === 'done' ? '' : `cell ${st.cellIdx + 1} (${st.rim ? 'rim cell' : st.valence + '-sided cell'} #${st.cell})`;
      const poly = st.closes ? cellGlyph(st.valence, st.rim, 16, st.cellIdx === 0 ? START_FILL : null) : '';
      let g1 = '', g2 = '', title;
      if (st.kind === 'add') {
        const col = colourOf ? colourOf(st.piece.id)[0] : '#E8C25A';
        g1 = poly; g2 = lathGlyph(st.cont ? 'cont' : 'add', 16, col);
        if (st.cont) cls.push('cont');
        title = `${st.k + 1}: ${st.cont ? 'continue' : 'add'} ${st.piece.label} at ${cellName}${st.closes ? ' — closes the cell' : ''} · ${st.nNewCross} crossing${st.nNewCross === 1 ? '' : 's'}` + (st.sameFamily ? ' · ⋈ strips of one family cross' : '');
      } else if (st.kind === 'lay') {
        g1 = poly; g2 = st.closes ? (st.sameFamily ? lathGlyph('cross') : '') : lathGlyph('lay');
        title = `${st.k + 1}: ${st.knots.map(q => q.subject ? `${q.subject.label} ${q.goesOver ? 'over' : 'under'} ${q.partner ? q.partner.label : ''}` : 'end').join(', ')} at ${cellName}${st.closes ? ' — closes the cell' : ''} · ${st.nNewCross} crossing${st.nNewCross === 1 ? '' : 's'}` + (st.sameFamily ? ' · ⋈ strips of one family cross' : '');
      } else if (st.kind === 'close') {
        g1 = poly; g2 = st.sameFamily ? lathGlyph('cross') : '';
        title = `${st.k + 1}: ${cellName} is already woven by its neighbours — count it`;
      } else { g1 = lathGlyph('done'); title = `${st.k + 1}: the weave is complete`; }
      frag.push(`<button class="${cls.join(' ')}" data-step="${st.k}" title="${title}"><span class="g1">${g1}</span><span class="g2">${g2}</span></button>`);
    }
    this.icons.innerHTML = frag.join('');
    this.buttons = Array.from(this.icons.querySelectorAll('.hs'));
    this.go(Math.min(k, this.n - 1), tick, true);
  }

  /** go to sub-step k; tick null = the whole sub-step */
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
    this.buttons.forEach((b, j) => { b.classList.toggle('cur', j === this.k); b.classList.toggle('future', j > this.k); b.classList.toggle('dimf', this.filter !== 'all' && !this.matches(j)); });
    const st = this.plan.steps[this.k], cells = this.plan.order.length;
    this.read.textContent = `${this.k + 1} / ${this.n}` + (st ? (st.kind === 'done' ? ` · ${cells} cells` : ` · cell ${st.cellIdx + 1} / ${cells}`) : '');
    this.renderSeq(st);
    const b = this.buttons[Math.max(0, this.k)];
    if (b) {
      const tr = this.track, x = b.offsetLeft, w = b.offsetWidth;
      if (x < tr.scrollLeft + 30) tr.scrollLeft = x - 30; else if (x + w > tr.scrollLeft + tr.clientWidth - 40) tr.scrollLeft = x + w - tr.clientWidth + 40;
      this.marker.hidden = false; this.marker.style.left = (this.k < 0 ? Math.max(0, x - 6) : x + w + 1) + 'px';
    }
    $('d-rev').disabled = !(st && st.kind === 'add' && st.nTicks > 0); $('d-play').disabled = !(st && st.nTicks > 0);
  }
  /** the over / under sequence of the current sub-step as arrow tags */
  renderSeq(st) {
    if (!st) { this.seq.innerHTML = '<span class="dlabel dim">nothing woven yet — press ▶ or →</span>'; return; }
    const tag = (q, i, text, extra = '') => `<button class="tag ${i === this.tick ? 'cur' : i < this.tick ? 'made' : 'todo'}${q.clip ? ' clip' : ''}${q.release ? ' rel' : ''}" data-tick="${i}" title="${extra}${q.clip ? ' · clip it: held by friction only' : ''}${q.release ? ' · the clip comes off' : ''}">${text}</button>`;
    const sw = (pc) => `<span class="sw" style="background:${this.colourOf ? this.colourOf(pc.id)[0] : '#E8C25A'}"></span>`;
    // a crossing between strips in hand: "S10 ‹under› S1" — the latest strip in hand, then the one it crosses
    const layTag = (q, i) => { if (q.rim) return tag(q, i, 'end', 'a strip ends at the rim'); const rel = q.goesOver ? 'over' : 'under', other = q.partner; return tag(q, i, `${sw(q.subject)}${q.subject.label} ${rel}${other ? ` ${sw(other)}${other.label}` : ''}`, `${q.subject.label} ${rel} ${other ? other.label : ''} — two strips in hand cross here`); };   // one tag
    let html = '';
    if (st.kind === 'add') {
      const pc = st.piece;
      html += `<span class="dlabel"><span class="sw" style="background:${this.colourOf ? this.colourOf(pc.id)[0] : '#E8C25A'}"></span>${st.cont ? '<span class="dim">continue</span> ' : ''}${pc.label} <span class="dim">${this.cm(pc.length).toFixed(0)} cm · ${st.dir > 0 ? '→' : '←'}</span></span>`;
      if (!st.knots.length) html += '<span class="dlabel dim">the first strip: in hand, nothing to cross yet</span>';
      html += st.knots.map((q, i) => q.lay ? layTag(q, i) : q.rim ? tag(q, i, 'end', 'the strip ends at the rim') : tag(q, i, q.goesOver ? 'over' : 'under', `${q.goesOver ? 'over' : 'under'} ${q.partner ? q.partner.label : ''}${q.self ? ' (itself)' : ''}`)).join('');
    } else if (st.kind === 'lay') html += st.knots.map(layTag).join('');
    else if (st.kind === 'close') html += '<span class="dlabel dim">already woven by its neighbours — count the cell</span>';
    else html += '<span class="dlabel">the weave is complete</span>';
    this.seq.innerHTML = html;
    const cur = this.seq.querySelector('.tag.cur'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  togglePlay() { if (this.playing) this.stop(); else this.start(); }
  start() {
    if (!this.plan || this.playing) return;
    this.stopSeq();
    if (this.k >= this.n - 1) this.go(0);
    this.playing = true; const p = $('h-play'); p.classList.add('on'); p.title = 'pause (space)'; p.querySelector('.ic-play').hidden = true; p.querySelector('.ic-pause').hidden = false;
    const tickFn = () => {
      if (!this.playing) return;
      const next = this.filter === 'all' ? this.k + 1 : this.nextMatch(this.k);
      if (next >= this.n || (this.filter !== 'all' && next === this.k)) { this.go(this.n - 1); this.stop(); return; }
      this.go(next);
      if (this.k >= this.n - 1) { this.stop(); return; }
      this.timer = setTimeout(tickFn, 1000 / this.speed);            // the pause starts after the sub-step is shown (Solidcraft)
    };
    this.timer = setTimeout(tickFn, 1000 / this.speed);
  }
  stop() {
    this.playing = false; if (this.timer) clearTimeout(this.timer); this.timer = null;
    const p = $('h-play'); p.classList.remove('on'); p.title = 'play (space)'; p.querySelector('.ic-play').hidden = false; p.querySelector('.ic-pause').hidden = true;
  }
  /** play the crossings of the current sub-step one by one */
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
    const p = $('d-play'); if (!p) return; p.classList.remove('on'); p.title = 'play the crossings of this strip (⇧space)'; p.querySelector('.ic-play').hidden = false; p.querySelector('.ic-pause').hidden = true;
  }
}
