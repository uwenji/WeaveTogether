// radar.js — the profile as a radar chart (Ji, Multiplayer update 4): one axis per thing a weaver can ask of a plan
// (profile.js AXES), the outer ring = 1 = as good as it gets.
//   the filled shape      the plan in the view, scored on every axis (the measures that used to be a list of numbers);
//   the grey outline      the plan with the algorithm's default parameters, once the parameters have been tuned;
//   the hollow handles    the profile: how much each axis matters, 0 … 1 — drag one along its axis (or focus it and use
//                         the arrow keys). The optimiser tunes the algorithm's parameters to these.
// Every axis carries its name and its measure in a few characters; the measure in words, the score and the definition
// are in the table under the chart (closed by default) — the chart is never the only way to read a value. There is no
// hover text on the chart (Ji, 16 Nov: it got in the way of dragging a handle); a handle's value is read out to
// assistive technology (aria-valuetext).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text = null) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== null) e.textContent = text; return e; };

export class Radar {
  /** root: a block element; axes: [{ key, label, hint }]; onWeights(weights, done) while and after a handle is moved */
  constructor(root, { axes, onWeights = null }) {
    this.root = root; this.axes = axes; this.onWeights = onWeights; this.n = axes.length;
    this.weights = Object.fromEntries(axes.map(a => [a.key, 0.5])); this.scores = null; this.ref = null; this.short = {}; this.texts = {};
    this.W = 272; this.H = 232; this.cx = 136; this.cy = 116; this.R = 68;
    root.classList.add('radar'); root.textContent = '';
    this.svg = el('svg', { viewBox: `0 0 ${this.W} ${this.H}`, role: 'group', 'aria-label': 'the plan scored on seven axes, and the profile: how much each one matters' });
    root.append(this.svg);
    this._build();
  }
  angle(i) { return -Math.PI / 2 + 2 * Math.PI * i / this.n; }
  point(i, r) { const a = this.angle(i); return [this.cx + this.R * r * Math.cos(a), this.cy + this.R * r * Math.sin(a)]; }
  _build() {
    const g = this.svg, n = this.n;
    // the rings and the spokes: hairlines, one step off the surface
    for (const r of [0.25, 0.5, 0.75, 1]) g.append(el('polygon', { class: r === 1 ? 'grid outer' : 'grid', points: Array.from({ length: n }, (_, i) => this.point(i, r).map(x => x.toFixed(1)).join(',')).join(' ') }));
    for (let i = 0; i < n; i++) { const [x, y] = this.point(i, 1); g.append(el('line', { class: 'grid', x1: this.cx, y1: this.cy, x2: x.toFixed(1), y2: y.toFixed(1) })); }
    this.refPoly = el('polygon', { class: 'ref', points: '' }); this.fill = el('polygon', { class: 'plan-fill', points: '' }); this.line = el('polygon', { class: 'plan-line', points: '' });
    g.append(this.refPoly, this.fill, this.line);
    this.dots = []; this.handles = []; this.labels = []; this.values = [];
    for (let i = 0; i < n; i++) { const d = el('circle', { class: 'plan-dot', r: 4 }); this.dots.push(d); g.append(d); }
    for (let i = 0; i < n; i++) {
      const ax = this.axes[i], a = this.angle(i), c = Math.cos(a), s = Math.sin(a), [lx, ly] = [this.cx + (this.R + 11) * c, this.cy + (this.R + 11) * s];
      const anchor = Math.abs(c) < 0.25 ? 'middle' : c > 0 ? 'start' : 'end', up = s < -0.5, down = s > 0.5;
      const y0 = up ? ly - 13 : down ? ly + 9 : ly - 2;
      const name = el('text', { class: 'ax-name', x: lx.toFixed(1), y: y0.toFixed(1), 'text-anchor': anchor }, ax.label);
      const val = el('text', { class: 'ax-val', x: lx.toFixed(1), y: (y0 + 11.5).toFixed(1), 'text-anchor': anchor }, '');
      this.labels.push(name); this.values.push(val); g.append(name, val);
    }
    for (let i = 0; i < n; i++) {                                    // on top: the hit area of the axis (wider than any mark) and the handle
      const ax = this.axes[i], [x, y] = this.point(i, 1.08);
      const hit = el('line', { class: 'hit', x1: this.cx, y1: this.cy, x2: x.toFixed(1), y2: y.toFixed(1) });
      const h = el('circle', { class: 'handle', r: 5.5, tabindex: 0, role: 'slider', 'aria-label': `${ax.label}: how much it matters`, 'aria-valuemin': 0, 'aria-valuemax': 1 });
      const drag = (e) => { const p = this._local(e), a = this.angle(i), r = ((p.x - this.cx) * Math.cos(a) + (p.y - this.cy) * Math.sin(a)) / this.R; this._setWeight(i, Math.round(Math.max(0, Math.min(1, r)) * 20) / 20, false); };
      const start = (e) => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); h.setPointerCapture(e.pointerId); this._drag = i; h.classList.add('drag'); drag(e); };
      h.addEventListener('pointerdown', start); hit.addEventListener('pointerdown', (e) => { h.focus({ preventScroll: true }); start(e); });
      h.addEventListener('pointermove', (e) => { if (this._drag === i) drag(e); });
      const end = () => { if (this._drag !== i) return; this._drag = -1; h.classList.remove('drag'); if (this.onWeights) this.onWeights({ ...this.weights }, true); };
      h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
      h.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : e.key === 'Home' ? -2 : e.key === 'End' ? 2 : 0; if (!d) return;
        e.preventDefault(); e.stopPropagation(); this._setWeight(i, Math.round(Math.max(0, Math.min(1, this.weights[ax.key] + d)) * 20) / 20, true);
      });
      this.handles.push(h); g.append(hit, h);
    }
    // the legend: identity never by colour alone
    const lg = el('g', { class: 'legend', transform: `translate(8 ${this.H - 9})` });
    lg.append(el('line', { class: 'plan-line', x1: 0, y1: -3, x2: 14, y2: -3 }), el('circle', { class: 'plan-dot', cx: 7, cy: -3, r: 3 }), el('text', { x: 19, y: 0 }, 'this plan'));
    this.lgRef = el('g', { transform: 'translate(72 0)' }); this.lgRef.append(el('line', { class: 'ref', x1: 0, y1: -3, x2: 14, y2: -3 }), el('text', { x: 19, y: 0 }, 'default')); lg.append(this.lgRef);
    const lp = el('g', { transform: 'translate(134 0)' }); lp.append(el('circle', { class: 'handle static', cx: 5, cy: -3, r: 4.5 }), el('text', { x: 15, y: 0 }, 'what matters (drag)')); lg.append(lp);
    g.append(lg);
    this.render();
  }
  _local(e) { const r = this.svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * this.W / Math.max(1, r.width), y: (e.clientY - r.top) * this.H / Math.max(1, r.height) }; }
  _setWeight(i, v, done) { const k = this.axes[i].key; if (this.weights[k] === v && !done) return; this.weights[k] = v; this.render(); if (this.onWeights) this.onWeights({ ...this.weights }, done); }
  /** scores / ref: { key: 0…1 } (ref null hides the default outline); short: { key: the measure in a few characters };
   *  texts: { key: the measure in words }; weights: the profile */
  set({ scores = this.scores, ref = this.ref, short = this.short, texts = this.texts, weights = null } = {}) {
    this.scores = scores; this.ref = ref; this.short = short; this.texts = texts; if (weights) this.weights = { ...this.weights, ...weights };
    this.render();
  }
  render() {
    const pts = (obj) => this.axes.map((ax, i) => this.point(i, Math.max(0.02, Math.min(1, obj[ax.key] ?? 0))).map(x => x.toFixed(1)).join(',')).join(' ');
    const has = !!this.scores;
    this.fill.setAttribute('points', has ? pts(this.scores) : ''); this.line.setAttribute('points', has ? pts(this.scores) : '');
    this.refPoly.setAttribute('points', this.ref ? pts(this.ref) : ''); this.lgRef.style.display = this.ref ? '' : 'none';
    this.axes.forEach((ax, i) => {
      const d = this.dots[i]; if (has) { const [x, y] = this.point(i, Math.max(0.02, Math.min(1, this.scores[ax.key]))); d.setAttribute('cx', x.toFixed(1)); d.setAttribute('cy', y.toFixed(1)); d.style.display = ''; } else d.style.display = 'none';
      const wv = this.weights[ax.key] ?? 0, [hx, hy] = this.point(i, wv), h = this.handles[i];
      h.setAttribute('cx', hx.toFixed(1)); h.setAttribute('cy', hy.toFixed(1)); h.setAttribute('aria-valuenow', wv.toFixed(2)); h.setAttribute('aria-valuetext', `${wv.toFixed(2)} · ${this.texts[ax.key] || ''}`);
      this.values[i].textContent = this.short[ax.key] ?? '';
    });
  }
}
