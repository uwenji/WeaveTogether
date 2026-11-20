// sequencer.js — the environment of the planning method (document/Planning method.md, §2–§3).
//
// Crossings are the atomic nodes. Every crossing has two slots (one per strand passing it — possibly the same strand on
// a tube); a slot holds the pieces through it: 0, 1, or 2 (two = a joint, R3). A crossing is MADE when both slots hold a
// piece. A cell closes when all its ring crossings are made (a result, not an action). Pieces are intervals of a strand;
// consecutive pieces of a strand overlap by k crossings. Weavers act in rounds; a piece's holder is the weaver who last
// moved it (hand-over, O6). Time is counted in actions (crossings made).
//
// This module does two things:
//   • Sequencer — the state machine: addPiece / weave / join, legality (both slots covered, gap ≤ G — R9), closures.
//   • replay()  — runs any crossing order through the state machine and returns the metrics of §3: hanging time (R5),
//                 gaps (R9), jumps and turning (R6), fronts, feature spread (R7), singular stress (R8), piece lengths
//                 and waste (R3), runs (R4). planToSequence() turns a plan of planner.js into (pieces, order) so the
//                 current four orders can be measured as the baseline (§6).
// Nothing here touches the DOM; t10.mjs runs it in node.
//
// 10 Nov (Ji, Multiplayer update 3) — the measures follow his definitions:
//   moves       a move to a crossing that is not next to the last one is a SKIP while it stays in the area — within the
//               material's length along the lattice ("the weaving path could still continue in the area") — and a JUMP when
//               it is longer, or when it leaves the piece of the front the weaver is on for another one more than three
//               lattice edges away (a change of front; a leftover crossing within reach is not another front). Jumps are
//               counted first, their length second.
//   collisions  hanging is not a waiting time: a loose remainder is in the way of the remainder being moved. At every
//               crossing one of the two strips passes its loose end over or under the other. That end pivots where it
//               leaves the weave, so it sweeps a narrow fan: half a lattice edge wide near the crossing, a quarter of the
//               distance wide further out (shape.js SWEEP). Counted are the loose remainders (straight along their tangent,
//               as the view draws them) that enter the fan — for the strip with fewer of them, the one a weaver would move.
//   strips      a strip is anchored at one end and woven along; only its far end may at last be woven into the existing
//               weave. FREE MIDDLE = a strip woven at two places with unmade crossings between (the overlap of a joint is
//               not a woven end: it is pushed in when the strip is woven up to it); CLOSING = a strip joined at both ends.
//   figure      the share of the shape's curvature Σ|K| that is closed, averaged over the sequence (|K| = the angle defect
//               of a cell): higher = the recognisable parts come earlier.
//   wrap        the wrap-around loops (a tube's ring) and when the first of each kind closes: until then the piece is a
//               sheet. hold = how soon a closed singular cell gets the crossings around it.

import { Geo, curvature, wrapClasses, WrapTracker, looseEnds, inTheWay, SWEEP, strandStress, features, limbs } from './shape.js';

const dist3 = (M, a, b) => Math.hypot(M[3 * a] - M[3 * b], M[3 * a + 1] - M[3 * b + 1], M[3 * a + 2] - M[3 * b + 2]);
const sub3 = (M, a, b) => [M[3 * a] - M[3 * b], M[3 * a + 1] - M[3 * b + 1], M[3 * a + 2] - M[3 * b + 2]];
const angleDeg = (u, v) => { const lu = Math.hypot(...u), lv = Math.hypot(...v); if (!lu || !lv) return 0; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))) * 180 / Math.PI; };

/** cell adjacency over the lattice edges */
export function cellNeighbours(w) {
  const nbr = Array.from({ length: w.nV }, () => []);
  for (const [a, b] of w.edges) { nbr[a].push(b); nbr[b].push(a); }
  return nbr;
}

/** BFS hop distance over cells from a set of sources */
export function hopDistance(w, sources, nbr) {
  const d = new Int32Array(w.nV).fill(-1), queue = [];
  for (const s of sources) if (d[s] < 0) { d[s] = 0; queue.push(s); }
  for (let q = 0; q < queue.length; q++) { const v = queue[q]; for (const u of nbr[v]) if (d[u] < 0) { d[u] = d[v] + 1; queue.push(u); } }
  return d;
}

export class Sequencer {
  /** opts: { G = 1 (largest allowed gap, R9), k = 2 (joint overlap in crossings), weavers = 1 } */
  constructor(w, opts = {}) {
    this.w = w; this.G = opts.G ?? 1; this.k = opts.k ?? 2; this.nWeavers = Math.max(1, opts.weavers | 0 || 1);
    const nE = w.nE;
    // a real crossing: an interior edge with two strands through it; a rim edge only carries two loose ends
    this.isCross = new Uint8Array(nE);
    for (let e = 0; e < nE; e++) this.isCross[e] = w.edgeTris[e].length === 2 && w.knotStrands[e].length === 2 ? 1 : 0;
    this.nCross = this.isCross.reduce((a, b) => a + b, 0);
    this.slots = w.knotStrands;                                              // slots[e] = [[si, i], [sj, j]]
    // the ring crossings of every cell (rim ends left out) — a cell closes when all of them are made
    this.cellCross = w.cellKnots.map(list => list.filter(e => this.isCross[e]));
    this.ringN = Int32Array.from(this.cellCross, l => l.length);
    this.nbr = cellNeighbours(w);
    // crossings adjacent along the lattice (sharing a cell) — for jump distances
    this.crossNbr = Array.from({ length: nE }, () => []);
    for (let e = 0; e < nE; e++) {
      if (!this.isCross[e]) continue;
      const seen = new Set([e]);
      for (const v of w.edges[e]) for (const f of w.vertEdges[v]) if (!seen.has(f) && this.isCross[f]) { seen.add(f); this.crossNbr[e].push(f); }
    }
    this.reset();
  }

  reset() {
    const { w } = this;
    this.made = new Uint8Array(w.nE); this.madeN = 0;
    this.slotPieces = Array.from({ length: w.nE }, () => [[], []]);
    this.cellMade = new Int32Array(w.nV); this.closed = new Uint8Array(w.nV); this.closedN = 0;
    this.pieces = []; this.pieceOfKnot = w.strands.map(s => Array.from({ length: s.knots.length }, () => []));
    this.t = 0; this.round = 0; this.events = [];
    this.lastCross = new Int32Array(this.nWeavers).fill(-1);                 // last crossing made by every weaver
  }

  /** register a piece: strand si, knot indices in strand order (may wrap on a closed strand). Returns the piece. */
  addPiece({ si, knots, label, holder = 0 }) {
    const s = this.w.strands[si], id = this.pieces.length;
    const edges = knots.map(i => s.knots[i]);
    const pc = { id, si, knots: knots.slice(), edges, label: label || `P${id}`, holder, cross: edges.map(e => this.isCross[e]),
      madeMask: knots.map(() => 0), madeN: 0, nCross: 0, intro: -1, done: -1, lastT: -1, joinedOnto: -1, gapMax: 0, over: knots.map(i => this.w.over(si, i)) };
    pc.nCross = pc.cross.reduce((a, b) => a + b, 0);
    knots.forEach((i, m) => this._register(pc, i, edges[m]));
    this.pieces.push(pc);
    return pc;
  }

  _register(pc, i, e) {
    this.pieceOfKnot[pc.si][i].push(pc.id);
    const slotIx = this.slotIndex(e, pc.si, i);
    if (slotIx >= 0) this.slotPieces[e][slotIx].push(pc.id);
  }

  /** take n knots off a piece's head (side = +1) or tail (−1) — a strip cut shorter after the fact; only unmade knots */
  trimPiece(pc, side, n) {
    for (let q = 0; q < n && pc.knots.length > 1; q++) {
      const m = side > 0 ? pc.knots.length - 1 : 0;
      if (pc.madeMask[m]) throw new Error(`cannot trim a made crossing of ${pc.label}`);
      const i = pc.knots[m], e = pc.edges[m];
      const l = this.pieceOfKnot[pc.si][i], at = l.indexOf(pc.id); if (at >= 0) l.splice(at, 1);
      const slotIx = this.slotIndex(e, pc.si, i); if (slotIx >= 0) { const sl = this.slotPieces[e][slotIx], k2 = sl.indexOf(pc.id); if (k2 >= 0) sl.splice(k2, 1); }
      pc.nCross -= pc.cross[m];
      for (const arr of [pc.knots, pc.edges, pc.cross, pc.madeMask, pc.over]) { if (side > 0) arr.pop(); else arr.shift(); }
    }
  }

  /** grow a piece by one knot at its head (after its last knot, side = +1) or its tail (before its first, side = −1).
   *  `i` is the strand knot index. Returns the position of the new knot in the piece. */
  extendPiece(pc, side, i) {
    const e = this.w.strands[pc.si].knots[i], isC = this.isCross[e], ov = this.w.over(pc.si, i);
    if (side > 0) { pc.knots.push(i); pc.edges.push(e); pc.cross.push(isC); pc.madeMask.push(0); pc.over.push(ov); }
    else { pc.knots.unshift(i); pc.edges.unshift(e); pc.cross.unshift(isC); pc.madeMask.unshift(0); pc.over.unshift(ov); }
    pc.nCross += isC;
    this._register(pc, i, e);
    return side > 0 ? pc.knots.length - 1 : 0;
  }

  /** every strand gets one piece over its whole length (no cutting) */
  addWholeStrands() {
    this.w.strands.forEach((s, si) => this.addPiece({ si, knots: [...Array(s.knots.length).keys()], label: `S${si + 1}` }));
  }

  slotIndex(e, si, i) { const l = this.slots[e]; for (let q = 0; q < l.length; q++) if (l[q][0] === si && l[q][1] === i) return q; return -1; }

  /** the pieces of crossing e as [pieceOnSlot0, pieceOnSlot1] (the first piece of each slot), or null when a slot is bare */
  piecesAt(e) {
    const [a, b] = this.slotPieces[e];
    if (!a.length || !b.length) return null;
    return [this.pieces[a[0]], this.pieces[b[0]]];
  }

  canWeave(e) { return this.isCross[e] && !this.made[e] && this.slotPieces[e][0].length > 0 && this.slotPieces[e][1].length > 0; }

  /** largest run of unmade crossings between two made crossings of a piece (rim ends skipped) */
  gapOf(pc) {
    let first = -1, last = -1, gap = 0, run = 0;
    for (let m = 0; m < pc.knots.length; m++) {
      if (!pc.cross[m]) continue;
      if (pc.madeMask[m]) { if (first < 0) first = m; last = m; if (run > gap && first !== m) gap = run; run = 0; } else run++;
    }
    return first < 0 ? 0 : gap;
  }

  /** the positions of crossing e along a piece (two when the strand crosses itself there) */
  positionsOf(pc, e) { const out = []; pc.edges.forEach((f, m) => { if (f === e) out.push(m); }); return out; }

  /** the gap a piece would have if crossing e were made now */
  gapIfMade(pc, e) {
    const ms = this.positionsOf(pc, e).filter(m => !pc.madeMask[m]);
    for (const m of ms) pc.madeMask[m] = 1;
    const g = this.gapOf(pc);
    for (const m of ms) pc.madeMask[m] = 0;
    return g;
  }

  /** is making crossing e allowed by the gap rule (R9) for every piece through it */
  gapOk(e) {
    const ids = new Set([...this.slotPieces[e][0], ...this.slotPieces[e][1]]);
    for (const pid of ids) if (this.gapIfMade(this.pieces[pid], e) > this.G) return false;
    return true;
  }

  /** the legal crossings for a weaver: both slots covered, not made, gap rule kept */
  legal() { const out = []; for (let e = 0; e < this.w.nE; e++) if (this.canWeave(e) && this.gapOk(e)) out.push(e); return out; }

  /** make crossing e (weaver wv). The piece that moves is `mover` (a piece id) when known; otherwise the one moved most
   *  recently. Returns the event. Illegal input (bare slot / made) throws. */
  weave(e, wv = 0, mover = -1) {
    if (!this.canWeave(e)) throw new Error(`crossing ${e} cannot be woven (made or bare slot)`);
    const [a, b] = this.slotPieces[e];
    const pcs = [...new Set([...a, ...b])].map(id => this.pieces[id]);     // one entry per piece, even when a piece crosses itself here
    // which piece moves: given, else the most recently moved of the two slots, else the first
    let mv = mover >= 0 ? this.pieces[mover] : null;
    if (!mv) { mv = pcs[0]; for (const pc of pcs) if (pc.lastT > mv.lastT) mv = pc; }
    const handover = mv.intro >= 0 && mv.holder !== wv ? mv.holder : -1;
    this.made[e] = 1; this.madeN++;
    const gaps = [];
    for (const pc of pcs) {
      const ms = this.positionsOf(pc, e).filter(m => !pc.madeMask[m]); if (!ms.length) continue;
      for (const m of ms) { pc.madeMask[m] = 1; pc.madeN++; }
      if (pc.intro < 0) pc.intro = this.t;
      pc.lastT = this.t;
      const g = this.gapOf(pc); if (g > pc.gapMax) pc.gapMax = g; gaps.push(g);
      if (pc.madeN === pc.nCross) pc.done = this.t;
    }
    mv.holder = wv;
    for (const v of this.w.edges[e]) { this.cellMade[v]++; if (!this.closed[v] && this.ringN[v] > 0 && this.cellMade[v] === this.ringN[v]) { this.closed[v] = 1; this.closedN++; } }
    const [sa, ia] = this.slots[e][0], overSlot = this.w.over(sa, ia) ? 0 : 1;
    const ev = { t: this.t, round: this.round, weaver: wv, e, kind: 'weave', mover: mv.id, pieces: pcs.map(p => p.id), overPiece: this.slotPieces[e][overSlot][0], gaps, handover };
    this.events.push(ev); this.lastCross[wv] = e; this.t++;
    return ev;
  }

  /** a joint: piece pNew is pushed in along pOld through pOld's last k crossings (O1: they must be made). Records the
   *  event and marks those positions of pNew as made; pNew.intro = now. The caller has already added pNew with knots
   *  that include the k overlap positions. */
  join(pNewId, pOldId, wv = 0, positions = null) {
    const pn = this.pieces[pNewId], po = this.pieces[pOldId];
    const shared = positions || pn.edges.map((e, m) => (po.edges.includes(e) ? m : -1)).filter(m => m >= 0);
    if (!shared.length) throw new Error(`pieces ${pn.label} and ${po.label} do not overlap`);
    for (const m of shared) if (!this.made[pn.edges[m]]) throw new Error(`joint crossing ${pn.edges[m]} of ${pn.label} is not made (O1)`);
    for (const m of shared) { if (!pn.madeMask[m]) { pn.madeMask[m] = 1; pn.madeN++; } }
    if (pn.intro < 0) pn.intro = this.t;
    pn.lastT = this.t; if (pn.joinedOnto < 0) pn.joinedOnto = po.id; pn.holder = wv;
    if (pn.madeN === pn.nCross) pn.done = this.t;
    const ev = { t: this.t, round: this.round, weaver: wv, e: pn.edges[shared[0]], es: shared.map(m => pn.edges[m]), kind: 'join', mover: pn.id, pieces: [pn.id, po.id], k: shared.length, handover: -1 };
    this.events.push(ev); this.t++;
    return ev;
  }

  /** number of connected groups of open cells (some but not all ring crossings made) — the fronts */
  frontCount() {
    const open = new Uint8Array(this.w.nV), seen = new Uint8Array(this.w.nV); let n = 0;
    for (let v = 0; v < this.w.nV; v++) open[v] = (this.ringN[v] > 0 && this.cellMade[v] > 0 && !this.closed[v]) ? 1 : 0;
    for (let v = 0; v < this.w.nV; v++) {
      if (!open[v] || seen[v]) continue;
      n++; const queue = [v]; seen[v] = 1;
      for (let q = 0; q < queue.length; q++) for (const u of this.nbr[queue[q]]) if (open[u] && !seen[u]) { seen[u] = 1; queue.push(u); }
    }
    return n;
  }

  /** lattice distance between two crossings (edges sharing a cell are at distance 1), capped */
  crossDistance(e0, e1, cap = 8) {
    if (e0 === e1) return 0;
    let frontier = [e0]; const seen = new Set([e0]);
    for (let d = 1; d <= cap; d++) {
      const next = [];
      for (const e of frontier) for (const f of this.crossNbr[e]) { if (f === e1) return d; if (!seen.has(f)) { seen.add(f); next.push(f); } }
      frontier = next; if (!frontier.length) break;
    }
    return cap + 1;
  }
}

// ------------------------------------------------------------------------------------------------------------ features
/** the features of R7 and the singular cells of R8.
 *  singular: every interior cell with n ≠ 6, with its 1-ring;  band: every closed strand (a ring or column on a tube);
 *  junction: groups of singular cells within 2 hops of each other (branch junctions, cone apexes with several). */
export function featuresOf(w, seq) {
  const nbr = seq.nbr, singular = [];
  for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) singular.push(v);
  const ringCross = (cells) => { const set = new Set(); for (const v of cells) for (const e of seq.cellCross[v]) set.add(e); return [...set]; };
  const feats = [];
  for (const c of singular) feats.push({ kind: 'singular', cells: [c, ...nbr[c]], cross: ringCross([c, ...nbr[c]]), cell: c });
  w.strands.forEach((s, si) => { if (s.closed) feats.push({ kind: 'band', strand: si, cross: s.knots.filter(e => seq.isCross[e]) }); });
  // junctions: union–find over singular cells within 2 hops
  const parent = new Map(singular.map(v => [v, v])), find = (v) => { while (parent.get(v) !== v) v = parent.get(v); return v; };
  for (const c of singular) { const d = hopDistance(w, [c], nbr); for (const q of singular) if (q !== c && d[q] >= 0 && d[q] <= 2) parent.set(find(c), find(q)); }
  const groups = new Map(); for (const c of singular) { const r = find(c); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
  for (const cells of groups.values()) if (cells.length >= 2) { const all = new Set(cells); for (const c of cells) for (const u of nbr[c]) all.add(u); feats.push({ kind: 'junction', cells: [...all], cross: ringCross([...all]), singular: cells }); }
  return { singular, feats };
}

// -------------------------------------------------------------------------------------------------------------- replay
/** run a crossing order through the state machine and measure it.
 *  pieces: [{si, knots, label}] — every slot of every crossing in `order` must be covered;  order: crossing ids in the
 *  order they are made (rim edges are skipped);  weaverOf (optional): weaver index per event;  movers (optional): piece
 *  id per event. opts: { G, k, Lmax (model units), Lmin (fraction of Lmax that is still a usable remnant), lengths (piece
 *  id → length in model units), sample (fronts sampled every n events) } */
export function replay(w, pieces, order, opts = {}) {
  const seq = new Sequencer(w, { G: opts.G ?? 1, k: opts.k ?? 2, weavers: opts.weavers ?? 1 });
  for (const p of pieces) seq.addPiece(p);
  // bare slots get a whole-strand piece so every crossing can be made
  w.strands.forEach((s, si) => { if (s.knots.some((e, i) => seq.isCross[e] && !seq.pieceOfKnot[si][i].length)) seq.addPiece({ si, knots: [...Array(s.knots.length).keys()], label: `S${si + 1}*` }); });
  const G = seq.G, N = order.length, sample = Math.max(1, opts.sample || Math.floor(N / 40) || 1);
  // the load of the remainders (Ji, 8 Nov: a long remainder weighs, not only waits): from its first crossing until its last
  // a piece carries its length minus the stretch between its outermost woven crossings; the sum over the open pieces is
  // the strip hanging loose from the object at that moment
  const M3 = w.edgeMid, d3 = (a, b) => Math.hypot(M3[3 * a] - M3[3 * b], M3[3 * a + 1] - M3[3 * b + 1], M3[3 * a + 2] - M3[3 * b + 2]);
  const arcs = seq.pieces.map(pc => { const A = [0]; for (let m = 1; m < pc.edges.length; m++) A.push(A[m - 1] + d3(pc.edges[m - 1], pc.edges[m])); return A; });
  const Lp = seq.pieces.map((pc, id) => { const L = opts.lengths ? opts.lengths[id] : NaN; const A = arcs[id]; return Number.isFinite(L) ? L : A[A.length - 1] + (A.length > 1 ? A[A.length - 1] / (A.length - 1) : 0); });
  const lo = new Int32Array(seq.pieces.length).fill(-1), hi = new Int32Array(seq.pieces.length).fill(-1), rem = new Float64Array(seq.pieces.length), shut = new Uint8Array(seq.pieces.length);
  let load = 0, loadSum = 0, loadMax = 0, remMax = 0;
  const prevOf = new Map();                                                   // piece → predecessor on the same strand (the piece it is joined onto)
  for (const pc of seq.pieces) {
    const l = seq.pieceOfKnot[pc.si][pc.knots[0]].filter(id => id !== pc.id);
    if (l.length) prevOf.set(pc.id, l[0]);
  }
  let gapViolations = 0, gapMax = 0, jumpCount = 0, jumpSum = 0, jumpFar = 0, turnSum = 0, turnN = 0, fronts = [], runs = 0, handovers = 0;
  const K = seq.nWeavers, prevMover = new Int32Array(K).fill(-1), prevE = new Int32Array(K).fill(-1), prevVec = new Array(K).fill(null);   // momentum is per weaver
  const rank = new Int32Array(w.nE).fill(-1);
  const weaverOf = opts.weaverOf || null, movers = opts.movers || null;
  // --- the measures of update 3 (see the head of this file) ---------------------------------------------------------------
  const aMed = (() => { const l = Array.from(w.edgeLen).sort((x, y) => x - y); return l[l.length >> 1] || 1; })();
  const finiteL = Lp.filter(Number.isFinite), Lref = opts.Lmax > 0 ? opts.Lmax : (finiteL.length ? Math.max(...finiteL) : Infinity);   // "the material's max length": the limit, or the longest strip when nothing is cut
  const geo = new Geo(w, seq.crossNbr), frontier = new Set(), reachR = (opts.reach ?? 3) * aMed;
  /** before e is made: is it next to crossing p, or on the piece of the front p lies on (front = unmade crossings beside made ones, pieces = at most two apart)? */
  const sameFront = (p, e) => {
    const home = new Set();
    for (const f of seq.crossNbr[p]) { if (f === e) return true; home.add(f); for (const g of seq.crossNbr[f]) { if (g === e) return true; home.add(g); } }
    if (!frontier.has(e)) return false;
    const seen = new Set([e]), st = [e];
    while (st.length) { const x = st.pop(); for (const f of seq.crossNbr[x]) for (const g of [f, ...seq.crossNbr[f]]) { if (seen.has(g) || !frontier.has(g)) continue; if (home.has(g)) return true; seen.add(g); st.push(g); } }
    return false;
  };
  let skips = 0, jumps = 0, jumpsLong = 0, frontChanges = 0, travel = 0, jumpTravel = 0; const jumpsBy = new Int32Array(K), jumpAt = [];
  const clear = (opts.clear ?? SWEEP.clear) * aMed, spread = opts.spread ?? SWEEP.spread, ends = new Map(), extraOf = (id) => { const A = arcs[id], x = Math.max(0, (Lp[id] - A[A.length - 1]) / 2); return [x, x]; };
  let collideSum = 0, collideMax = 0, collideSteps = 0; const collideSeq = [];
  const Kc = curvature(w), wrap = new WrapTracker(w, wrapClasses(w));
  let figSum = 0, figNow = 0, cellSum = 0; const closable = seq.ringN.reduce((s, n) => s + (n > 0 ? 1 : 0), 0), closedAt = new Int32Array(w.nV).fill(-1);
  // emerging shape stress (update 4, checklist 20): a strip segment is in the weave once both its crossings are made; what
  // the surface asks of it there (shape.js strandStress: bending about its flat side and twist — what makes an open piece
  // turn back to flat) is LOOSE until the cell it is a side of is closed. stressNow = the loose share of the whole
  // shape's spring-back energy; its mean over the sequence is the measure (lower = the shape is held as it emerges)
  const SE = opts.stress === false ? null : (opts.stressOf || strandStress(w, opts.lath || {})), segsAt = SE ? Array.from({ length: w.nE }, () => []) : null;
  if (SE) for (const s of w.strands) { const Kn = s.knots.length, nseg = s.closed ? Kn : Kn - 1; for (let j = 0; j < nseg; j++) { const [t, k] = s.segs[j], x = { e0: s.knots[j], e1: s.knots[(j + 1) % Kn], c: w.F[3 * t + k], en: SE.back[3 * t + k], on: false }; segsAt[x.e0].push(x); segsAt[x.e1].push(x); } }
  let looseNow = 0, looseSum = 0, looseMax = 0; const looseOf = new Float64Array(w.nV);
  order.forEach((e, n) => {
    if (!seq.isCross[e] || seq.made[e]) return;
    const wv = weaverOf ? Math.min(K - 1, weaverOf[n] | 0) : 0;
    // moves: measured on the state before the crossing is made
    if (prevE[wv] >= 0 && seq.crossDistance(prevE[wv], e, 2) >= 2) {
      const D = geo.from(prevE[wv]).to(e), far = D > Lref * (1 + 1e-9), change = D > reachR && !sameFront(prevE[wv], e);   // a leftover within reach is not another front
      travel += D;
      if (far || change) { jumps++; jumpsBy[wv]++; jumpTravel += D; if (far) jumpsLong++; if (change) frontChanges++; jumpAt.push([seq.t, wv, prevE[wv], e, D, far ? 1 : 0, change ? 1 : 0]); } else skips++;
    }
    const wasClosed = w.edges[e].map(v => seq.closed[v]);
    const ev = seq.weave(e, wv, movers ? movers[n] : -1);
    rank[e] = seq.t - 1;
    frontier.delete(e); for (const f of seq.crossNbr[e]) if (!seq.made[f]) frontier.add(f);
    // collisions: one of the two strips passes its loose end over or under the other — the one whose remainder is crossed by
    // fewer of the other loose remainders (a strip woven on both sides of the crossing has no loose end here and cannot move)
    for (const id of ev.pieces) ends.set(id, looseEnds(M3, seq.pieces[id], arcs[id], extraOf(id)));
    { let c = Infinity;
      for (const pid of ev.pieces) {
        const moving = ends.get(pid).filter(x => x.root === e); if (!moving.length) continue;
        let n = 0; for (const [id, list] of ends) { if (ev.pieces.includes(id)) continue; for (const o of list) if (moving.some(m => inTheWay(m, o, clear, spread, 0.5 * aMed))) n++; }
        if (n < c) { c = n; ev.moves = pid; }
      }
      if (!Number.isFinite(c)) c = 0;
      ev.collide = c; collideSeq.push(c); collideSum += c; if (c > collideMax) collideMax = c; if (c) collideSteps++;
      for (const id of ev.pieces) if (!ends.get(id).length) ends.delete(id); }
    // figure: the curvature closed so far; wrap-around loops
    w.edges[e].forEach((v, q) => { if (!wasClosed[q] && seq.closed[v]) { figNow += Kc.absK[v]; closedAt[v] = seq.t - 1; } });
    if (SE) {
      for (const x of segsAt[e]) if (!x.on && seq.made[x.e0] && seq.made[x.e1]) { x.on = true; if (!seq.closed[x.c]) { looseNow += x.en; looseOf[x.c] += x.en; } }
      w.edges[e].forEach((v, q) => { if (!wasClosed[q] && seq.closed[v]) { looseNow -= looseOf[v]; looseOf[v] = 0; } });
      const share = SE.sumBack > 0 ? Math.max(0, looseNow) / SE.sumBack : 0; looseSum += share; if (share > looseMax) looseMax = share;
    }
    figSum += Kc.total > 0 ? figNow / Kc.total : 0; cellSum += closable ? seq.closedN / closable : 0;
    wrap.add(e, seq.t - 1);
    for (const id of ev.pieces) {
      if (shut[id]) continue;
      const pc = seq.pieces[id], A = arcs[id];
      for (let m = 0; m < pc.edges.length; m++) if (pc.edges[m] === e) { if (lo[id] < 0 || m < lo[id]) lo[id] = m; if (m > hi[id]) hi[id] = m; }
      const r = Math.max(0, Lp[id] - (A[hi[id]] - A[lo[id]]));
      if (pc.madeN === 1 || rem[id] === 0 && lo[id] === hi[id]) remMax = Math.max(remMax, r);
      load += r - rem[id]; rem[id] = r;
      if (pc.madeN >= pc.nCross) { load -= rem[id]; rem[id] = 0; shut[id] = 1; }
    }
    loadSum += load; if (load > loadMax) loadMax = load;
    for (const g of ev.gaps) { if (g > G) gapViolations++; if (g > gapMax) gapMax = g; }
    if (ev.handover >= 0) handovers++;
    if (ev.mover !== prevMover[wv]) { runs++; prevMover[wv] = ev.mover; }
    if (prevE[wv] >= 0) {
      const d = seq.crossDistance(prevE[wv], e);
      if (d >= 2) { jumpCount++; jumpSum += d - 1; if (d >= 4) jumpFar++; }
      const vec = sub3(w.edgeMid, e, prevE[wv]);
      if (prevVec[wv] && d <= 2) { turnSum += angleDeg(prevVec[wv], vec); turnN++; }
      prevVec[wv] = vec;
    }
    prevE[wv] = e;
    if (seq.t % sample === 0) fronts.push(seq.frontCount());
  });
  const T = seq.t;
  // --- R5 hanging: intro = first own crossing (not the overlap with the predecessor), done = last crossing ---------------
  const hang = [], openDelta = new Int32Array(T + 2);
  for (const pc of seq.pieces) {
    if (pc.nCross === 0) continue;
    const prev = prevOf.get(pc.id), prevPc = prev !== undefined ? seq.pieces[prev] : null;
    let intro = Infinity, done = -1;
    pc.edges.forEach((e, m) => {
      if (!pc.cross[m] || rank[e] < 0) return;
      done = Math.max(done, rank[e]);
      const shared = prevPc ? prevPc.edges.includes(e) : false;
      if (!shared) intro = Math.min(intro, rank[e]);
    });
    if (!Number.isFinite(intro)) intro = pc.edges.reduce((m, e) => (rank[e] >= 0 ? Math.min(m, rank[e]) : m), Infinity);
    if (!Number.isFinite(intro) || done < 0) continue;
    pc.hangIntro = intro; pc.hangDone = done; hang.push(done - intro);
    openDelta[intro]++; openDelta[done + 1]--;
  }
  let open = 0, openMax = 0, openSum = 0;
  for (let t = 0; t < T; t++) { open += openDelta[t]; openMax = Math.max(openMax, open); openSum += open; }
  // --- R7 spread, R8 stress ---------------------------------------------------------------------------------------------
  const { singular, feats } = featuresOf(w, seq);
  const spreadOf = (cross) => { let lo = Infinity, hi = -1, n = 0; for (const e of cross) if (rank[e] >= 0) { lo = Math.min(lo, rank[e]); hi = Math.max(hi, rank[e]); n++; } return n ? { spread: hi - lo + 1, n, norm: (hi - lo + 1) / n } : null; };
  const byKind = {};
  for (const f of feats) { const sp = spreadOf(f.cross); if (!sp) continue; (byKind[f.kind] = byKind[f.kind] || []).push(sp.norm); }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const stress = [], stressNorm = [];
  for (const c of singular) {
    const own = seq.cellCross[c].filter(e => rank[e] >= 0); if (!own.length) continue;
    const first = Math.min(...own.map(e => rank[e]));
    const ringCells = [c, ...seq.nbr[c]], all = new Set(); for (const v of ringCells) for (const e of seq.cellCross[v]) if (rank[e] >= 0) all.add(e);
    const last = Math.max(...[...all].map(e => rank[e]));
    stress.push(last - first + 1); stressNorm.push((last - first + 1) / all.size);
  }
  // --- R3 lengths and waste ----------------------------------------------------------------------------------------------
  const Lmax = opts.Lmax || 0, LminF = opts.Lmin ?? 0.25, lengths = seq.pieces.map(pc => (opts.lengths ? opts.lengths[pc.id] : NaN)).filter(Number.isFinite);
  let waste = 0; if (Lmax > 0) for (const L of lengths) { const r = Lmax - L; if (r > 0 && r < LminF * Lmax) waste += r; }
  const shortPieces = seq.pieces.filter(pc => pc.nCross > 0 && pc.nCross < 2 * seq.k + 1).length;
  // --- strips by their woven ends (opts.ends: per piece [joint at its tail, joint at its head], in crossings) -------------
  let closing = 0, extending = 0, freeStrips = 0;
  if (opts.ends) seq.pieces.forEach((pc, id) => { if (!pc.nCross || !opts.ends[id]) return; const n = (opts.ends[id][0] > 0 ? 1 : 0) + (opts.ends[id][1] > 0 ? 1 : 0); if (n === 2) closing++; else if (n === 1) extending++; else freeStrips++; });
  // --- wrap-around loops and the hold of the singular cells (Q11: the crossings around a closed singular cell hold it) ----
  const wrapFresh = wrap.loops.filter(l => l.fresh).map(l => l.t), hold = [];
  for (const c of singular) {
    if (closedAt[c] < 0) continue;
    const around = new Set(); for (const v of seq.nbr[c]) for (const e of seq.cellCross[v]) if (rank[e] > closedAt[c]) around.add(e);
    if (!around.size) { hold.push(1); continue; }
    hold.push((Math.max(...[...around].map(e => rank[e])) - closedAt[c]) / around.size);     // 1 = the crossings around it follow at once
  }
  return {
    skips, jumps, jumpsLong, frontChanges, travel, jumpTravel, jumpsBy: Array.from(jumpsBy), jumpAt, Lref,
    collideSum, collideMean: T ? collideSum / T : 0, collideMax, collideSteps, collideSeq,
    closing, extending, freeStrips,
    figure: T ? figSum / T : 0, figureLead: T ? (figSum - cellSum) / T : 0, curvature: Kc.total,
    wrapRank: wrap.r, wrapLoops: wrap.loops.length, wrapFirst: wrapFresh.map(t => (T ? t / T : 0)), sheet: wrap.r && wrapFresh.length ? wrapFresh[0] / T : (wrap.r ? 1 : 0),
    holdMean: mean(hold), holdMax: hold.length ? Math.max(...hold) : 0,
    stressLoose: T ? looseSum / T : 0, stressLooseMax: looseMax, stressTotal: SE ? SE.sumBack : 0, stressSide: SE ? SE.total.side * SE.sideW : 0,
    ...featureMeasure(w, seq, rank, T), ...limbMeasure(w, seq, rank, T),
    steps: T, crossings: seq.nCross, cells: w.nV, closedCells: seq.closedN, pieces: seq.pieces.filter(pc => pc.nCross > 0).length,
    hangMax: hang.length ? Math.max(...hang) : 0, hangMean: mean(hang), hangSum: hang.reduce((a, b) => a + b, 0), openMax, openMean: T ? openSum / T : 0,
    gapViolations, gapMax, gapPieces: seq.pieces.filter(pc => pc.gapMax > G).length,
    jumpCount, jumpSum, jumpFar, turnMean: turnN ? turnSum / turnN : 0,
    frontsMax: fronts.length ? Math.max(...fronts) : 0, frontsMean: mean(fronts),
    spreadSingular: mean(byKind.singular || []), spreadBand: mean(byKind.band || []), spreadJunction: mean(byKind.junction || []),
    nSingular: singular.length, nBands: (byKind.band || []).length, nJunctions: (byKind.junction || []).length,
    stressMean: mean(stress), stressMax: stress.length ? Math.max(...stress) : 0, stressNormMean: mean(stressNorm),
    lengthMin: lengths.length ? Math.min(...lengths) : NaN, lengthMax: lengths.length ? Math.max(...lengths) : NaN, lengthMean: mean(lengths), waste, shortPieces,
    runs, handovers, loadMean: T ? loadSum / T : 0, loadMax, remMax, seq,
  };
}

/** the limbs of the shape (shape.js limbs: an ear, a branch up to its rim) and whether each one is woven in one go (Ji,
 *  18 Nov: "finish the ear as early as it can … without hanging the strips and leaving it open there"). A limb's own
 *  crossings are those between two of its cells — but not the ones between two cells of its last ring, which the body
 *  next to it may make; from its first to its last one, every other crossing made is the weave
 *  going on elsewhere while the limb stands open. limbOpen = the mean, over the limbs, of that as a share of the rest of
 *  the weave: 0 — every limb finished once begun; 1 — begun first and finished last. NaN: the shape has no limb. */
function limbMeasure(w, seq, rank, T) {
  const LB = w._limbs || (w._limbs = limbs(w, seq.nbr)); if (!LB.list.length || !T) return { limbs: 0, limbOpen: NaN, limbDone: [] };
  const out = []; let sum = 0;
  for (const L of LB.list) {
    const own = new Set(), edge = L.rings - 1; for (const v of L.cells) for (const e of seq.cellCross[v]) { const [a, b] = w.edges[e]; if (L.member[a] && L.member[b] && (L.d[a] < edge || L.d[b] < edge) && rank[e] >= 0) own.add(e); }
    if (!own.size) continue;
    let lo = Infinity, hi = -1; for (const e of own) { if (rank[e] < lo) lo = rank[e]; if (rank[e] > hi) hi = rank[e]; }
    const open = (hi - lo + 1 - own.size) / Math.max(1, T - own.size);
    sum += open; out.push({ kind: L.kind, cells: L.cells.length, from: lo / T, to: (hi + 1) / T, open });
  }
  return { limbs: out.length, limbOpen: out.length ? sum / out.length : NaN, limbDone: out };
}
/** the pieces and crossing order of a planner.js plan, for replay(). The cell tour cuts a strand into pieces that share
 *  the k crossings of their joint. A shared crossing belongs to the earlier piece; for the later one it is the joint —
 *  pushed in when that piece is woven up to it, not a woven end from the start (Ji, update 3, item 8: "extend from one end,
 *  and the other end will be woven into the existing weave lattice"). `ends` = the joint at [tail, head] of every piece.
 *  opts.shared = true keeps the shared crossings in both pieces (the count before 10 Nov). */
/** the features of the figure (shape.js features: tips, saddles, bends) and when each one is there to be recognised: all
 *  the crossings of its singular cells and of the cells around them made. featEarly = Σ weight · (1 − t / T) / Σ weight:
 *  1 = every feature at the very start, 0.5 = spread evenly, lower = the recognisable parts come last */
function featureMeasure(w, seq, rank, T) {
  const F = features(w, seq.nbr); if (!F.length || !T) return { features: F.length, featEarly: NaN, featKinds: {} };
  let sum = 0, wsum = 0; const kinds = {};
  for (const f of F) {
    kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    let last = -1, all = true; for (const v of f.around) for (const e of seq.cellCross[v]) { if (rank[e] < 0) all = false; else if (rank[e] > last) last = rank[e]; }
    f.doneAt = all ? (last + 1) / T : 1; sum += f.weight * (1 - f.doneAt); wsum += f.weight;
  }
  return { features: F.length, featEarly: wsum ? sum / wsum : NaN, featKinds: kinds, featDone: F.map(f => ({ kind: f.kind, cells: f.cells.length, at: f.doneAt })) };
}

export function planToSequence(w, plan, opts = {}) {
  const ends = plan.pieceList.map(pc => {
    const of = plan.pieces[pc.strand].pieceOfKnot, own = pc.knots.map(i => of[i] === pc.p); let t = 0, h = 0;
    while (t < own.length - 1 && !own[t]) t++; while (h < own.length - 1 - t && !own[own.length - 1 - h]) h++;
    if (!h) while (h < own.length - 1 - t && pc.knots.indexOf(pc.knots[own.length - 1 - h]) < own.length - 1 - h) h++;   // one piece round a closed strand: its end overlaps its own start
    return [t, h];
  });
  const pieces = plan.pieceList.map((pc, id) => ({ si: pc.strand, knots: opts.shared ? pc.knots : pc.knots.slice(ends[id][0], pc.knots.length - ends[id][1]), label: pc.label }));
  const lengths = plan.pieceList.map(pc => pc.length);
  const order = [...Array(w.nE).keys()].filter(e => !plan.rim[e] && Number.isFinite(plan.knotStep[e])).sort((a, b) => plan.knotStep[a] - plan.knotStep[b] || a - b);
  // several weavers on the cell tour: every crossing by the weaver of the step that makes it
  const K = Math.max(1, plan.K || 1), weaverOf = K > 1 ? order.map(e => { const st = plan.steps[Math.floor(plan.knotStep[e])]; return st && st.weaver >= 0 ? st.weaver : 0; }) : null;
  return { pieces, order, lengths, ends, weaverOf, weavers: K };
}
