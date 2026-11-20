// sequence.js — the sequence planner v2 (document/Planning method.md §4–§5): crossing by crossing, K weavers in rounds.
//
// The unit is the piece — a physical strip. A strip is cut when it is threaded: from the crossing where the front first
// needs its strand it runs along the strand — first through the crossings of the front's ring, then ahead of it — until
// the material (or a cut length) ends, the strand ends, another strip lies there (the two are joined), the strand turns
// back toward the front, or, with several weavers, another weaver's front will reach it first (cut there, joined at the
// seam). A strip is woven from where it was threaded, contiguously: a crossing may wait for its partner one at a time
// (G = 1, R9) — never woven at both ends with the middle free. A joint (O1) pushes the later strip's end backwards
// through the earlier strip's last k crossings once both are woven up to there; a strip around a closed strand meets
// its own start the same way. A strip that would block the front is cut shorter after the fact (the plan is made before
// anyone weaves, so the cut is simply decided earlier).
//
// The weavers start from the rims — a tube from its bottom ring, a tree from its trunk base, the columns from their feet;
// a closed shape from the lower end of its longest axis (Ji, 8 Nov: "ring to ring, based on my study of people's weaving
// paths"). The front is a strict ring: a weaver finishes its ring (hop level from its seed) before it starts the next,
// one ahead only when nothing is left on its ring. Several weavers each have a front of their own by default (one per
// rim, `front: 'rims'`; Ji, 9 Nov: "together is basically just the same path, randomly distributed"). With `front: 'together'`
// they share one front: the rings are counted from one start, the weavers begin spread along it, each works the part of
// its ring nearer to it than to the others (or the next ring near it, never back down) and strips pass from hand to hand.
// One per rim: each weaver from its own rim (or picked cell); where two fronts meet head-on the strands are cut and
// joined. A weaver works next to its own work only — its front is the crossings beside the ones it has made (its seed
// at first) — so it never jumps over a neighbour into another weaver's area (Ji, 9 Nov evening: "multiplayer is not
// multitasking"); one whose front is closed by the others waits. Each round every weaver makes one crossing, the cheapest by the rules as costs — a new strip costs as much as it will hang (the load of its remainder: a long remainder weighs, not only
// waits — Ji), closing cells and strips pays, so do continuing the strip in hand and staying near; jumps, turns, joints
// and hand-overs (the weaver who moves a strip holds it — O6) cost. Where the fronts meet is a result (O5).

import { Sequencer, featuresOf, replay } from './sequencer.js';
import { chooseStart, neighbours, hopDistance } from './planner.js';
import { Geo, looseEnds, inTheWay, SWEEP, curvature, wrapClasses, WrapTracker } from './shape.js';

// dist: per lattice edge of the way to a crossing beyond the weaver's reach (the nearest first — the travelling-salesman
// side of the plan); leap: a move longer than the material, or to another front — a jump in Ji's count (update 3)
// collide: per loose remainder in the way of the remainder being moved (item 9 — hanging is a collision, not a wait).
// Measured on the test set it is 0 by default: choosing the next crossing by it does not lower the collisions (they
// follow the length of the strips — the cut), it only makes the weaver move about; curv: per unit of |K| of the crossing's two cells (a cone 5 = 1) — the recognisable parts first; wrap / wrapNew: a
// crossing that closes a wrap-around loop / the first of its kind (the sheet becomes a cylinder: "wrap is early"); hold:
// a crossing around a singular cell that is already closed — the crossings around it hold it (Q11)
const WEIGHTS = { newPiece: 4, ringFresh: 0.15, join: 1, cellClosed: 2, pieceDone: 2, jump: 4, far: 10, dist: 1, leap: 20, turn: 1.0, handover: 2, feature: 1, featureNew: 0.5, stress: 1, hold: 3, fill: 1.5, support: 2, sameMover: 1, level: 3, load: 0.25, collide: 0, curv: 1, wrap: 2, wrapNew: 6 };

export function planSequence(w, opts = {}) {
  const G = opts.G ?? 1, k = Math.max(0, opts.k ?? 2), Lmax = opts.Lmax > 0 ? opts.Lmax : Infinity, R = opts.radius ?? 3, ahead = opts.ahead ?? 0;
  const Lcut = Math.min(Lmax, opts.cut > 0 ? opts.cut : Infinity);
  const W = { ...WEIGHTS, ...(opts.weights || {}) };
  const nbr = neighbours(w), aMed = (() => { const l = Array.from(w.edgeLen).sort((x, y) => x - y); return l[l.length >> 1] || 1; })();
  // --- seeds: a rim loop or a cell per weaver. Given (cells / arrays of cells: a rim cell stands for its loop), from a
  //     start rule of the cell tour (for comparison), or by default the rims from the lowest up, then the ends of the shape
  const loops = boundaryLoops(w, nbr), loopOf = new Int32Array(w.nV).fill(-1); loops.forEach((l, i) => { for (const v of l) loopOf[v] = i; });
  const asSeed = (v) => (loopOf[v] >= 0 ? loops[loopOf[v]].slice() : [v]);
  const Kwant = Math.max(1, opts.K | 0 || 1);
  let seeds = null, origin = null, startWhy = null, startLoop = null;
  if (opts.front === 'together' && Kwant > 1) {                    // (one front per rim is the default — Ji, 9 Nov)
    // one front for all: the rings are counted from one start (the K = 1 start, or the given one), the weavers begin
    // spread along it and work the same ring side by side — a strip passes from hand to hand (O6), no seam
    const given = Array.isArray(opts.seeds) && opts.seeds.length ? opts.seeds[0] : null;
    origin = given != null ? (Array.isArray(given) ? given.slice() : asSeed(given)) : opts.rule && opts.rule !== 'rims' ? asSeed(chooseStart(w, nbr, opts.rule).cell) : (startWhy = autoStart(w, nbr, { wrap: opts.wrapStart })).src;
    seeds = spreadStarts(w, nbr, origin, Kwant).map(v => [v]);
  } else {
    seeds = Array.isArray(opts.seeds) && opts.seeds.length ? opts.seeds.map(sd => (Array.isArray(sd) ? sd.slice() : asSeed(sd))) : null;
    if (seeds && seeds.length < Kwant) seeds = fillSeeds(w, nbr, seeds, Kwant);
    if (!seeds && opts.rule && opts.rule !== 'rims') seeds = fillSeeds(w, nbr, [asSeed(chooseStart(w, nbr, opts.rule).cell)], Kwant);
    if (!seeds) { startWhy = autoStart(w, nbr, { wrap: opts.wrapStart }); seeds = Kwant > 1 ? autoSeeds(w, Kwant, nbr, { wrap: opts.wrapStart }) : [startWhy.src]; if (Kwant === 1) startLoop = seeds[0]; }
  }
  const K = seeds.length, seq = new Sequencer(w, { G, k, weavers: K });
  // --- strand geometry: chord between consecutive knots, wrapping on a closed strand -----------------------------------
  const M = w.edgeMid, dist = (a, b) => Math.hypot(M[3 * a] - M[3 * b], M[3 * a + 1] - M[3 * b + 1], M[3 * a + 2] - M[3 * b + 2]);
  const SG = w.strands.map((s) => {
    const Kn = s.knots.length, seg = new Float64Array(Kn);
    for (let i = 0; i < Kn; i++) seg[i] = i + 1 < Kn ? dist(s.knots[i], s.knots[i + 1]) : (s.closed ? dist(s.knots[Kn - 1], s.knots[0]) : 0);
    return { Kn, closed: s.closed, seg, knots: s.knots };
  });
  const idx = (si, u) => { const { Kn, closed } = SG[si]; return closed ? ((u % Kn) + Kn) % Kn : u; };
  const valid = (si, u) => SG[si].closed || (u >= 0 && u < SG[si].Kn);
  const segAt = (si, u) => SG[si].seg[idx(si, u)];                        // chord between unwrapped positions u and u + 1
  /** the length of a strip over unwrapped positions [lo, hi]: chords plus half a chord at each end */
  const spanLength = (si, lo, hi) => {
    let L = 0; for (let u = lo; u < hi; u++) L += segAt(si, u);
    if (valid(si, lo - 1)) L += segAt(si, lo - 1) / 2;
    if (valid(si, hi + 1)) L += segAt(si, hi) / 2;
    return L;
  };
  /** the strip a joint adds beyond an end: n chords past position endU on side sd */
  const overlapLen = (si, endU, sd, n) => { let L = 0; for (let q = 0; q < n; q++) { if (!valid(si, endU + sd * (q + 1))) break; L += sd > 0 ? segAt(si, endU + q) : segAt(si, endU - 1 - q); } return L; };
  // --- features (R7) and singular rings (R8) --------------------------------------------------------------------------
  const { singular, feats } = featuresOf(w, seq);
  const featOf = Array.from({ length: w.nE }, () => []);
  feats.forEach((f, fi) => { f.made = 0; f.total = f.cross.length; for (const e of f.cross) featOf[e].push(fi); });
  const ringOf = Array.from({ length: w.nE }, () => []);
  const ringSets = singular.map((c) => { const set = new Set(); for (const v of [c, ...nbr[c]]) for (const e of seq.cellCross[v]) set.add(e); return { c, set, made: 0, total: set.size, started: false }; });
  ringSets.forEach((r, ri) => { for (const e of r.set) ringOf[e].push(ri); });
  // --- the weavers: hop levels of the cells from the seed; a crossing's level is the farther of its two cells -------------
  const levShared = origin ? hopDistance(w, origin, nbr) : null;
  const weavers = seeds.map((seed, wv) => {
    const lev = levShared || (wv === 0 && startWhy && startWhy.lev && seed === startLoop ? startWhy.lev : hopDistance(w, seed, nbr)), elev = new Int32Array(w.nE), remaining = [];
    for (let e = 0; e < w.nE; e++) { const [a, b] = w.edges[e]; elev[e] = Math.max(lev[a] < 0 ? 0 : lev[a], lev[b] < 0 ? 0 : lev[b]); if (seq.isCross[e]) remaining[elev[e]] = (remaining[elev[e]] || 0) + 1; }
    return { wv, seed, last: -1, lastPiece: -1, prevVec: null, idle: 0, acts: 0, elev, remaining, L: 0, lev };
  });
  const frontLevel = (wr) => { while (wr.L < wr.remaining.length && !(wr.remaining[wr.L] > 0)) wr.L++; return wr.L; };
  const noteMade = (e) => { for (const wr of weavers) wr.remaining[wr.elev[e]]--; };
  // several weavers with fronts of their own: each one's front = the unmade crossings beside its own made ones (sharing a
  // cell), its seed's crossings at first — multiplayer, not multitasking (Ji, 9 Nov evening)
  // experiment (Ji's point 2, 9 Nov evening — open for discussion, not in the panel): `segments: true` keeps a weaver on one
  // segment of its front — the front cut into pieces by holes, blocks and branches (connected over the crossings, or by
  // distance with `reach` in model units: a person reaches over a narrow gap) — finishing it ring after ring before it
  // moves to the next, instead of going round every split ring
  // 10 Nov (Ji, update 3 — Q6: "only when the current front is finished or blocked, and focus on one side first. Ring after
  // ring is not that important"): one front at a time is the rule for every weaver, and inside that front the ring order
  // holds only on the weaver's SIDE — the part of the front within `side` lattice edges of it, measured along the front.
  // `segments: false` gives the plan of 9 Nov (the whole ring, wherever it lies).
  const segMode = !origin && opts.segments !== false, reach = opts.reach > 0 ? opts.reach : 0;
  const contig = !origin && (K > 1 || segMode);
  const sideR = segMode ? (opts.side > 0 ? opts.side : opts.side === 0 ? Infinity : 4) * aMed : Infinity;
  const Lref = Number.isFinite(Lmax) ? Lmax : Math.max(...w.strandLen);       // "the material's max length": a longer move leaves the area
  const geo = new Geo(w, seq.crossNbr);
  const Kc = curvature(w), wrapT = new WrapTracker(w, opts.wrapClasses || wrapClasses(w)), clearR = (opts.clear ?? SWEEP.clear) * aMed, spreadR = opts.spread ?? SWEEP.spread;
  if (contig) for (const wr of weavers) {
    wr.front = new Set(); wr.outside = 0;
    // the crossings of the seed's cells; a rim cell without a crossing of its own (a corner) starts from the nearest cells that have one
    let cells = wr.seed.slice(); const seen = new Set(cells);
    for (let guard = 0; guard < w.nV && !wr.front.size && cells.length; guard++) {
      for (const v of cells) for (const e of seq.cellCross[v]) if (seq.isCross[e] && !seq.made[e]) wr.front.add(e);
      if (!wr.front.size) { const nx = []; for (const v of cells) for (const u of nbr[v]) if (!seen.has(u)) { seen.add(u); nx.push(u); } cells = nx; }
    }
  }
  const noteFront = (wr, e) => { if (!contig) return; for (const o of weavers) o.front.delete(e); for (const f of seq.crossNbr[e]) if (!seq.made[f]) wr.front.add(f); };

  // --- loose remainders (item 9): a strip in hand hangs straight on past its outermost woven crossing, as the view draws it;
  //     the remainder that moves at a crossing collides with the remainders that cross its path -------------------------------
  const loose = new Map();                                                  // strip id → its loose ends
  const arcOf = (edges) => { const A = [0]; for (let m = 1; m < edges.length; m++) A.push(A[m - 1] + dist(edges[m - 1], edges[m])); return A; };
  const pastEnds = (planned, A) => { const x = Math.max(0, ((planned || 0) - A[A.length - 1]) / 2); return [x, x]; };
  const refreshLoose = (P) => { const A = arcOf(P.edges), l = looseEnds(M, P, A, pastEnds(P.planned, A)); if (l.length) loose.set(P.id, l); else loose.delete(P.id); };
  /** the loose ends a strip of the plan would have at crossing e once e is made (none when it is woven on both sides of it) */
  const endsAt = (r, e) => {
    if (r.kind === 'covered') {
      const P = r.piece, ms = seq.positionsOf(P, e).filter(m => !P.madeMask[m]); if (!ms.length) return [];
      for (const m of ms) P.madeMask[m] = 1;
      const A = arcOf(P.edges), l = looseEnds(M, P, A, pastEnds(P.planned, A)).filter(x => x.root === e);
      for (const m of ms) P.madeMask[m] = 0;
      return l;
    }
    const { ext, si } = r, edges = [], cross = [], made = [];
    for (let u = ext.lo; u <= ext.hi; u++) { const f = SG[si].knots[idx(si, u)]; edges.push(f); cross.push(seq.isCross[f]); made.push(f === e ? 1 : 0); }
    const A = arcOf(edges);
    return looseEnds(M, { edges, cross, madeMask: made }, A, pastEnds(ext.length, A)).filter(x => x.root === e);
  };
  /** the loose remainders in the way at crossing e: for the strip of the two that has fewer of them across its loose end */
  const collideAt = (wr, e, plan) => {
    if (!loose.size) return 0;
    const skip = new Set(); for (const r of plan) if (r.kind === 'covered') skip.add(r.piece.id);
    let best = Infinity;
    for (const r of plan) {
      const moving = endsAt(r, e); if (!moving.length) continue;
      let n = 0;
      for (const [id, list] of loose) { if (skip.has(id)) continue; for (const o of list) if (moving.some(m => inTheWay(m, o, clearR, spreadR, 0.5 * aMed))) n++; }
      if (n < best) best = n;
    }
    return Number.isFinite(best) ? best : 0;
  };

  // --- strips -------------------------------------------------------------------------------------------------------------
  // a piece: Sequencer piece + { lo, hi: its own extent (unwrapped strand positions), u0: the position of knots[0]
  // (lower than lo once its tail joint is pushed in), nb: {1, -1}: the strip it is joined to at that end ({id, n} or
  // null), self: a closed strand's strip that meets its own start, joined: {1, -1}, born, wv }
  const pendingJ = new Set(), jointFirst = opts.jointFirst !== false, holdRule = opts.holdRule !== false && W.hold > 0;
  const covering = (si, u) => { const l = seq.pieceOfKnot[si][idx(si, u)]; return l.length ? seq.pieces[l[0]] : null; };
  /** the extent of a new strip threaded at strand position u0 by weaver wv */
  const plannedExtent = (si, u0, wv) => {
    const lev = weavers[wv].elev, others = weavers.filter(o => o.wv !== wv), { Kn, closed } = SG[si];
    const levAt = (u) => lev[SG[si].knots[idx(si, u)]];
    let lo = u0, hi = u0, inner = 0, self = false;
    const S = { 1: { open: true, max: levAt(u0), nb: null }, '-1': { open: true, max: levAt(u0), nb: null } };
    // the exact length of the strip over [l, h] with nT / nH crossings of joint pushed in at its tail / head, half a
    // chord past each physical end
    const clampN = (end, sd, n) => { let q = 0; while (q < n && valid(si, end + sd * (q + 1))) q++; return q; };
    const exactLen = (l, h, inn, nT, nH) => {
      const t = clampN(l, -1, nT), hh = clampN(h, 1, nH); let L = inn;
      for (let q = 0; q < t; q++) L += segAt(si, l - 1 - q);
      for (let q = 0; q < hh; q++) L += segAt(si, h + q);
      if (valid(si, l - t - 1)) L += segAt(si, l - t - 1) / 2;
      if (valid(si, h + hh + 1)) L += segAt(si, h + hh) / 2;
      return L;
    };
    const nTail = () => (S[-1].nb ? S[-1].nb.n : 0), nHead = (full) => (S[1].nb ? S[1].nb.n : full ? k : 0);
    for (let guard = 0; guard < 2 * Kn + 4; guard++) {
      if (closed && hi - lo + 1 >= Kn) { self = true; break; }
      let sd = 0, best = Infinity;                                         // the side whose next crossing lies lower: the ring first, then ahead
      for (const s of [1, -1]) { if (!S[s].open) continue; const u = s > 0 ? hi + 1 : lo - 1; if (!valid(si, u)) { S[s].open = false; S[s].why = 'end'; continue; } const l = levAt(u); if (l < best) { best = l; sd = s; } }
      if (!sd) break;
      const u = sd > 0 ? hi + 1 : lo - 1, Sd = S[sd];
      const N = covering(si, u);
      if (N) { Sd.open = false; Sd.nb = { id: N.id, n: Math.min(k, N.knots.length) }; Sd.why = 'joint'; continue; }
      const e = SG[si].knots[idx(si, u)], l = lev[e];
      if (l < Sd.max - 1) { Sd.open = false; Sd.why = 'turn'; continue; }   // the strand turns back toward the front
      if (hi - lo + 1 >= 2 * k + 1 && others.some(o => o.elev[e] + 2 < l)) { Sd.open = false; Sd.why = 'seam'; continue; }   // another weaver's front gets there clearly first: the seam (once the strip can be joined)
      const nlo = sd < 0 ? u : lo, nhi = sd > 0 ? u : hi, nin = inner + (sd > 0 ? segAt(si, hi) : segAt(si, u));
      const full = closed && nhi - nlo + 1 >= Kn;
      if (exactLen(nlo, nhi, nin, nTail(), nHead(full)) > Lcut + 1e-9) { Sd.open = false; Sd.why = 'length'; continue; }   // the strip's length
      lo = nlo; hi = nhi; inner = nin; Sd.max = Math.max(Sd.max, l);
    }
    // a joint found last may not fit any more: shorten the strip from an end that meets nothing (or drop that joint)
    let length = exactLen(lo, hi, inner, nTail(), nHead(self));
    for (let guard = 0; length > Lcut + 1e-9 && hi > lo && guard < 2 * Kn; guard++) {
      if (self) { self = false; S[1].why = 'length'; S[-1].why = 'length'; }
      const sd = !S[1].nb && hi > u0 ? 1 : !S[-1].nb && lo < u0 ? -1 : hi - u0 >= u0 - lo ? 1 : -1;
      if (S[sd].nb) { S[sd].nb = null; }
      S[sd].why = 'length';
      if (sd > 0) { inner -= segAt(si, hi - 1); hi--; } else { inner -= segAt(si, lo); lo++; }
      length = exactLen(lo, hi, inner, nTail(), nHead(false));
    }
    // the material is shorter than a crossing and its joints: the overlap of a joint shrinks (to one crossing at least)
    let short = 0;
    for (let guard = 0; length > Lcut + 1e-9 && guard < 4 * k + 4; guard++) {
      const sd = S[1].nb && S[1].nb.n > 1 && (!S[-1].nb || S[1].nb.n >= S[-1].nb.n) ? 1 : S[-1].nb && S[-1].nb.n > 1 ? -1 : 0;
      if (!sd) break;
      S[sd].nb = { ...S[sd].nb, n: S[sd].nb.n - 1 }; short = 1;
      length = exactLen(lo, hi, inner, nTail(), nHead(self));
    }
    return { lo, hi, nb: { 1: S[1].nb, '-1': S[-1].nb }, self, length, short, over: length > Lcut + 1e-9 ? 1 : 0, why: { 1: self ? 'self' : S[1].why || 'end', '-1': self ? 'self' : S[-1].why || 'end' } };
  };
  let shortJoints = 0, overLong = 0;
  const introduce = (si, u0, wv, ext) => {
    shortJoints += ext.short; overLong += ext.over;
    const knots = []; for (let u = ext.lo; u <= ext.hi; u++) knots.push(idx(si, u));
    const pc = seq.addPiece({ si, knots, holder: wv });
    Object.assign(pc, { why: ext.why, lo: ext.lo, hi: ext.hi, u0: ext.lo, nb: ext.nb, self: ext.self, joined: { 1: !ext.nb[1] && !ext.self, '-1': !ext.nb[-1] }, born: seq.t, wv, threadAt: u0, ovHead: 0, ovTail: 0, planned: ext.length });
    if (!pc.joined[1] || !pc.joined[-1]) pendingJ.add(pc.id);
    return pc;
  };
  const posOf = (pc, u) => u - pc.u0;                                       // index in pc.knots of unwrapped position u
  /** is the strip woven up to its own end on side sd (its outermost crossing there made)? */
  const wovenToEnd = (pc, sd) => {
    for (let u = sd > 0 ? pc.hi : pc.lo; sd > 0 ? u >= pc.lo : u <= pc.hi; u -= sd) { const m = posOf(pc, u); if (pc.cross[m]) return !!pc.madeMask[m]; }
    return true;
  };
  let joins = 0, jointsFirst = 0, handovers = 0, seams = 0, cuts = 0, strandedSum = 0, strandedMax = 0, actions = 0;
  /** the joint at end sd of strip Q: its end pushed backwards through the k woven crossings of the strip it meets */
  const tryJoin = (Q, sd, wv, first = false) => {
    if (Q.joined[sd]) return false;
    const si = Q.si, target = sd > 0 && Q.self ? { id: Q.id, n: k } : Q.nb[sd];
    if (!target) { Q.joined[sd] = true; return false; }
    if (!first && !wovenToEnd(Q, sd)) return false;
    const end = sd > 0 ? Q.hi : Q.lo, positions = [];
    for (let q = 1; q <= target.n; q++) {
      const u = end + sd * q; if (!valid(si, u)) break;
      const i = idx(si, u), e = SG[si].knots[i];
      if (!seq.pieceOfKnot[si][i].includes(target.id)) break;
      if (seq.isCross[e] && !seq.made[e]) return false;                    // O1: only through woven crossings
      positions.push(u);
    }
    Q.joined[sd] = true;
    if (!positions.length) return false;                                   // the strip it was to meet is no longer there: a free end
    for (const u of positions) { seq.extendPiece(Q, sd, idx(si, u)); if (sd < 0) Q.u0--; }
    const Lk = Q.knots.length, pos = [];
    for (let q = 0; q < positions.length; q++) { const m = sd > 0 ? Lk - positions.length + q : q; if (seq.isCross[Q.edges[m]]) pos.push(m); }
    if (pos.length) seq.join(Q.id, target.id, wv, pos);
    if (sd > 0) Q.ovHead = positions.length; else Q.ovTail = positions.length;
    joins++; if (first) jointsFirst++;
    refreshLoose(Q);
    return true;
  };
  const runJoins = (wv) => { for (const id of [...pendingJ]) { const Q = seq.pieces[id]; for (const sd of [1, -1]) tryJoin(Q, sd, Q.holder ?? wv); if (Q.joined[1] && Q.joined[-1]) pendingJ.delete(id); } };

  /** how the slot (si, i) of crossing e is served now: an existing strip (if it stays contiguous) or a new one; null =
   *  not now. `cache` keeps the planned extents of one decision */
  const slotPlan = (si, i, e, wv, cache) => {
    const l = seq.pieceOfKnot[si][i];
    if (l.length) { const P = seq.pieces[l[0]]; return seq.gapIfMade(P, e) <= G ? { kind: 'covered', piece: P } : null; }
    const key = si * 65536 + i; let ext = cache.get(key);
    if (!ext) { ext = plannedExtent(si, i, wv); cache.set(key, ext); }
    return { kind: 'fresh', ext, si, i };
  };
  const planOf = (e, wv, cache) => {
    const out = []; for (const [si, i] of seq.slots[e]) { const r = slotPlan(si, i, e, wv, cache); if (!r) return null; out.push(r); }
    // a strand crossing itself: a strip threaded at the first pass that also reaches the second would be woven at both
    // passes with the strip between them free (R9) — this crossing waits until the strip is woven up to there
    if (out.length === 2 && out[0].kind === 'fresh' && out[1].kind === 'fresh' && out[0].si === out[1].si) {
      const { ext, si } = out[0]; let lo = Infinity, hi = -Infinity;
      for (let u = ext.lo; u <= ext.hi; u++) if (SG[si].knots[idx(si, u)] === e) { lo = Math.min(lo, u); hi = Math.max(hi, u); }
      if (hi - lo - 1 > G) return null;
    }
    return out;
  };

  // --- one crossing --------------------------------------------------------------------------------------------------------
  const vec = (a, b) => [M[3 * b] - M[3 * a], M[3 * b + 1] - M[3 * a + 1], M[3 * b + 2] - M[3 * a + 2]];
  const angle = (u, v) => { const lu = Math.hypot(...u), lv = Math.hypot(...v); if (!lu || !lv) return 0; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))) * 180 / Math.PI; };
  /** open strips the front has left behind: their next crossing lies below the weaver's ring */
  const strandedCount = (wr) => {
    let n = 0;
    for (const P of seq.pieces) {
      if (P.intro < 0 || P.madeN >= P.nCross) continue;
      let lv = Infinity; for (let m = 0; m < P.knots.length; m++) if (P.cross[m] && !P.madeMask[m]) lv = Math.min(lv, wr.elev[P.edges[m]]);
      if (lv < wr.L) n++;
    }
    return n;
  };
  const act = (wr, e) => {
    const wv = wr.wv, involved = [], threaded = [];
    for (const [si, i] of seq.slots[e]) {                                   // slot by slot: a strip threaded for the first slot may cover the second
      const l = seq.pieceOfKnot[si][i];
      if (l.length) { involved.push(seq.pieces[l[0]]); continue; }
      const Q = introduce(si, i, wv, plannedExtent(si, i, wv)); involved.push(Q); threaded.push(Q);
    }
    let mover = -1, bestT = -2;                                             // the strip in this weaver's hands moved most recently, else a new one
    for (const P of involved) if (P.holder === wv && P.lastT > bestT) { bestT = P.lastT; mover = P.id; }
    if (mover < 0) { const f = involved.find(P => P.intro < 0); mover = (f || involved[0]).id; }
    const holders = new Set(involved.map(P => P.holder));
    // the joint first (Ji, update 3, item 8): a strip threaded at the end of the strip before it is anchored there — its end
    // pushed through that strip's k woven crossings — and then extends from that end; its far end is woven into the weave last
    if (jointFirst) for (const Q of threaded) for (const sd of [-1, 1]) if (Q.nb[sd] && (sd < 0 ? Q.lo : Q.hi) === Q.threadAt) tryJoin(Q, sd, wv, true);
    const ev = seq.weave(e, wv, mover);
    noteMade(e); wrapT.add(e, seq.t - 1);
    for (const P of involved) refreshLoose(P);
    if (contig) { if (!wr.front.has(e)) wr.outside++; noteFront(wr, e); }
    if (ev.handover >= 0) handovers++;
    if (holders.size > 1) { seams++; ev.seam = true; }
    for (const fi of featOf[e]) feats[fi].made++;
    for (const ri of ringOf[e]) { ringSets[ri].made++; ringSets[ri].started = true; }
    if (wr.last >= 0) wr.prevVec = vec(wr.last, e);
    wr.last = e; wr.lastPiece = mover; wr.acts++;
    if (actions % 4 === 0) { frontLevel(wr); const st = strandedCount(wr); strandedSum += st * 4; if (st > strandedMax) strandedMax = st; }
    actions++;
    runJoins(wv);
  };
  const cost = (wr, e, plan, d) => {
    let c = 0, fill = 0, own = false;
    for (const r of plan) if (r.kind === 'covered' && r.piece.holder === wr.wv) own = true;
    for (const r of plan) {
      if (r.kind === 'fresh') {
        // on the weaver's own ring a new strip cannot be avoided, only put off: its cost is a tie-breaker there, so the
        // ring is swept in order instead of hopping back and forth to thread late
        const f = wr.elev[e] <= (wr.Lw ?? wr.L) ? W.ringFresh : 1;
        c += f * (W.newPiece + W.load * r.ext.length / aMed) + W.join * ((r.ext.nb[1] ? 1 : 0) + (r.ext.nb[-1] ? 1 : 0) + (r.ext.self ? 1 : 0));
      } else {
        const P = r.piece; fill++;
        if (P.holder !== wr.wv && P.intro >= 0 && !own) c += W.handover;
        if (P.madeN + seq.positionsOf(P, e).filter(m => !P.madeMask[m]).length >= P.nCross) c -= W.pieceDone;
      }
    }
    let cells = 0; for (const v of w.edges[e]) if (!seq.closed[v] && seq.ringN[v] > 0 && seq.cellMade[v] + 1 === seq.ringN[v]) cells++;
    const nb = seq.crossNbr[e]; let sup = 0; for (const f of nb) if (seq.made[f]) sup++;
    const same = plan.some(r => r.kind === 'covered' && r.piece.id === wr.lastPiece) ? 1 : 0;
    c += -W.cellClosed * cells - W.fill * fill - W.support * (nb.length ? sup / nb.length : 0) - W.sameMover * same;
    if (d >= 2) c += W.jump * (d - 1);
    if (d > R) { c += W.far; if (wr.geo) { const D = geo.to(e); c += W.dist * D / aMed; if (D > Lref) c += W.leap; } }   // beyond reach: the nearest first; longer than the material = a jump
    const ah = wr.elev[e] - (wr.Lw ?? wr.L); if (ah > 0) c += W.level * ah;
    if (wr.prevVec && wr.last >= 0 && d <= 2) c += W.turn * angle(wr.prevVec, vec(wr.last, e)) / 90;
    let featBonus = 0, featNew = 0;
    for (const fi of featOf[e]) { const f = feats[fi]; if (f.made > 0 && f.made < f.total) featBonus = 1; else if (f.made === 0 && feats.some(g => g.kind === f.kind && g.made > 0 && g.made < g.total)) featNew = 1; }
    c += -W.feature * featBonus + W.featureNew * featNew;
    // a singular cell: once it is closed the crossings around it hold it (Q11); before that, a ring begun is finished
    { let b = 0; for (const ri of ringOf[e]) { const r = ringSets[ri]; if (r.made >= r.total) continue; if (seq.closed[r.c]) b = Math.max(b, W.hold); else if (r.started) b = Math.max(b, W.stress); } c -= b; }
    if (W.curv) { const [a, b] = w.edges[e]; c -= W.curv * (Kc.absK[a] + Kc.absK[b]) / 2; }
    if (wrapT.r && (W.wrap || W.wrapNew)) { const lp = wrapT.loopOf(e); if (lp) c -= wrapT.isNew(lp) ? W.wrapNew : W.wrap; }
    if (W.collide) c += W.collide * collideAt(wr, e, plan);
    return c;
  };
  /** unmade crossings around e0 by lattice distance (BFS over crossings sharing a cell) */
  const near = (e0) => {
    const dist = new Map([[e0, 0]]); let frontier = [e0]; const out = [];
    for (let d = 1; frontier.length; d++) {
      const next = [];
      for (const e of frontier) for (const f of seq.crossNbr[e]) if (!dist.has(f)) { dist.set(f, d); next.push(f); if (!seq.made[f]) out.push([f, d]); }
      frontier = next;
      if (d >= R && out.length) break;
    }
    return out;
  };
  /** a strip that blocks the nearest unmade crossing (woven too far from it) is cut back to its woven part */
  const repair = (wr) => {
    let best = -1, bd = Infinity;
    const D = new Map(); if (wr.last >= 0) { D.set(wr.last, 0); let frontier = [wr.last]; for (let d = 1; d <= 8 && frontier.length; d++) { const next = []; for (const x of frontier) for (const f of seq.crossNbr[x]) if (!D.has(f)) { D.set(f, d); next.push(f); } frontier = next; } }   // one sweep, not one per crossing
    for (let e = 0; e < w.nE; e++) if (seq.isCross[e] && !seq.made[e]) { const d = wr.last >= 0 ? (D.get(e) ?? 9) : wr.elev[e]; if (d < bd) { bd = d; best = e; } }
    if (best < 0) return false;
    let did = false;
    for (const [si, i] of seq.slots[best]) {
      const l = seq.pieceOfKnot[si][i]; if (!l.length) continue;
      const P = seq.pieces[l[0]]; if (seq.gapIfMade(P, best) <= G) continue;
      let mlo = Infinity, mhi = -1; P.madeMask.forEach((x, m) => { if (x) { mlo = Math.min(mlo, m); mhi = Math.max(mhi, m); } });
      const ms = seq.positionsOf(P, best).find(m => !P.madeMask[m] && (m > mhi + G || m < mlo - G));
      if (ms === undefined) continue;
      if (ms > mhi) { const n = P.knots.length - ms; seq.trimPiece(P, 1, n); P.hi -= n; P.nb[1] = null; P.self = false; P.joined[1] = true; }
      else { const n = ms + 1; seq.trimPiece(P, -1, n); P.lo += n; P.u0 += n; P.nb[-1] = null; P.joined[-1] = true; }
      cuts++; did = true; refreshLoose(P);
    }
    return did;
  };

  // --- one front for all: a weaver works the crossings of the ring that are nearer to it than to the others (the next
  //     ring near it when the rest of this one is the others' — nobody reaches across a neighbour); lattice distance
  //     from where each weaver is, over the crossings ----------------------------------------------------------------------
  const together = !!origin;
  const distFrom = (srcs) => {
    const D = new Int32Array(w.nE).fill(1 << 29); let frontier = [];
    for (const e of srcs) if (D[e] > 0) { D[e] = 0; frontier.push(e); }
    for (let d = 1; frontier.length; d++) { const next = []; for (const e of frontier) for (const f of seq.crossNbr[e]) if (D[f] > d) { D[f] = d; next.push(f); } frontier = next; }
    return D;
  };
  if (together) for (const wr of weavers) { wr.dmap = distFrom([...new Set(wr.seed.flatMap(v => seq.cellCross[v]))]); wr.Lw = 0; }

  // --- the rounds ----------------------------------------------------------------------------------------------------------
  const guard = seq.nCross * 4 + 100;
  let stall = 0, relax = false, relaxed = 0;                         // relax: nobody could act next to their own work — one round as before
  /** the piece of wr's front it is on: the front cut into pieces (connected over crossings two apart at most, or within
   *  `reach` of each other), of which the one holding a crossing next to its last one, else the nearest. Also the LEFTOVERS:
   *  pieces of one to three crossings within three lattice edges of the weaver — a crossing that could not be made when the
   *  front passed it; it is made before the weaver moves on, not at the end with a jump back. Returns { seg, left } (seg =
   *  null when the front is one piece). */
  const segmentOf = (wr) => {
    const F = [...wr.front]; if (F.length < 2) return { seg: null, left: [] };
    const inF = new Set(F), comp = new Map(); let nc = 0;
    const near = (e) => { const out = []; if (reach > 0) { for (const f of F) if (f !== e && dist(e, f) <= reach) out.push(f); } else { for (const f of seq.crossNbr[e]) { if (inF.has(f)) out.push(f); for (const g of seq.crossNbr[f]) if (inF.has(g) && g !== e) out.push(g); } } return out; };
    for (const e of F) { if (comp.has(e)) continue; const st = [e]; comp.set(e, nc); while (st.length) { const x = st.pop(); for (const f of near(x)) if (!comp.has(f)) { comp.set(f, nc); st.push(f); } } nc++; }
    if (nc < 2) return { seg: null, left: [] };
    let c = -1; for (const f of seq.crossNbr[wr.last]) if (comp.has(f)) { c = comp.get(f); break; }
    if (c < 0) { let bd = Infinity; for (const e of F) { const d = dist(wr.last, e); if (d < bd) { bd = d; c = comp.get(e); } } }
    const size = new Int32Array(nc); for (const e of F) size[comp.get(e)]++;
    return { seg: F.filter(e => comp.get(e) === c), left: F.filter(e => comp.get(e) !== c && size[comp.get(e)] <= 3 && dist(wr.last, e) <= 3 * aMed) };
  };
  /** the weaver's side of its front: the crossings of `seg` within sideR of where it stands, measured along the front
   *  (from one front crossing to the next, two apart at most) */
  const sideOf = (wr, seg) => {
    if (seg.length < 2) return seg;
    const inS = new Set(seg), D = new Map(); let frontier = [];
    for (const f of seq.crossNbr[wr.last]) { if (inS.has(f) && !D.has(f)) { D.set(f, 0); frontier.push(f); } for (const g of seq.crossNbr[f]) if (inS.has(g) && !D.has(g)) { D.set(g, 0); frontier.push(g); } }
    if (!frontier.length) { let b = seg[0], bd = Infinity; for (const e of seg) { const d = dist(wr.last, e); if (d < bd) { bd = d; b = e; } } D.set(b, 0); frontier.push(b); }
    while (frontier.length) {
      const next = [];
      for (const x of frontier) { const dx = D.get(x); for (const f of seq.crossNbr[x]) for (const g of [f, ...seq.crossNbr[f]]) { if (g === x || !inS.has(g)) continue; const nd = dx + dist(x, g); if (nd <= sideR && nd < (D.get(g) ?? Infinity)) { D.set(g, nd); next.push(g); } } }
      frontier = next;
    }
    return [...D.keys()];
  };
  /** lattice distances (over the crossings) from e0, up to R + 1 */
  const distAround = (e0) => { const D = new Map([[e0, 0]]); let frontier = [e0]; for (let d = 1; d <= R + 1 && frontier.length; d++) { const next = []; for (const e of frontier) for (const f of seq.crossNbr[e]) if (!D.has(f)) { D.set(f, d); next.push(f); } frontier = next; } return D; };
  while (seq.madeN < seq.nCross && seq.round < guard) {
    let acted = false;
    for (const wr of weavers) {
      if (seq.madeN >= seq.nCross) break;
      const L = frontLevel(wr), cache = new Map();
      const choose = (list) => { let best = null; for (const [e, d] of list) { const plan = planOf(e, wr.wv, cache); if (!plan) continue; const c = cost(wr, e, plan, d); if (!best || c < best.c || (c === best.c && e < best.e)) best = { e, c }; } return best; };
      // the ring: crossings of the current level (one ahead with `ahead`), near ones by lattice distance, the rest of the
      // ring wherever it is; the next ring only when nothing is left to do on this one
      let cands = [], best = null;
      if (together) {
        // my ring: from my level up (never back down), the crossings nearer to me than to the weavers still working at or
        // below that level; a crossing left below everyone's ring goes to the nearest weaver first
        wr.Lw = Math.max(wr.Lw ?? 0, L);
        const lv = new Map();
        for (let e = 0; e < w.nE; e++) {
          if (!seq.isCross[e] || seq.made[e] || wr.elev[e] > wr.Lw + 2) continue;
          const l = wr.elev[e], dm = wr.dmap[e], below = l < wr.Lw && !weavers.some(o => o.Lw <= l);
          let own = true;
          for (const o of weavers) if (o !== wr && (below || o.Lw <= l) && (o.dmap[e] < dm || (o.dmap[e] === dm && o.wv < wr.wv))) { own = false; break; }
          if (!own || (l < wr.Lw && !below)) continue;
          if (!lv.has(l)) lv.set(l, []); lv.get(l).push([e, Math.max(1, dm)]);
        }
        for (const l of [...lv.keys()].sort((x, y) => x - y)) { best = choose(lv.get(l)); if (best) { if (l > wr.Lw) wr.Lw = l; break; } }
      } else if (contig && !relax) {
        // my front only, one piece of it at a time, and on that piece my side first: its lowest ring (one ahead with `ahead`);
        // when that is blocked any ring of my side; when my side is finished or blocked the rest of this piece of front, the
        // nearest first; then my other pieces of front (Ji, 10 Nov — Q6)
        const dd = wr.last >= 0 ? distAround(wr.last) : null, pairs = (list) => list.map(e => [e, dd ? dd.get(e) ?? R + 1 : 1]);
        wr.geo = wr.last >= 0; if (wr.geo) geo.from(wr.last);
        const F = [...wr.front], sg = segMode && wr.last >= 0 ? segmentOf(wr) : null, seg = (sg && sg.seg) || F;
        const side = segMode && wr.last >= 0 && Number.isFinite(sideR) ? sideOf(wr, seg) : seg;
        let Ls = Infinity; for (const e of side) if (wr.elev[e] < Ls) Ls = wr.elev[e];
        wr.Lw = Number.isFinite(Ls) ? Ls : L;
        if (sg && sg.left.length && opts.leftovers !== false) best = choose(pairs(sg.left));   // a leftover within reach first
        // the lowest ring of my side — and, whatever their ring and also across a junction when within reach, the crossings
        // around a singular cell that is closed: they hold it (Q11 — "without more crossings, it tries to turn back to flat").
        // Candidates with a bonus (W.hold), not a rule: on a branch junction a strict rule pulls the weaver back and forth
        if (!best) {
          const holds = (e) => { for (const ri of ringOf[e]) { const r = ringSets[ri]; if (r.made < r.total && seq.closed[r.c]) return true; } return false; };
          const list = side.filter(e => wr.elev[e] <= Ls + ahead || (holdRule && holds(e)));
          if (holdRule && wr.last >= 0 && F.length > side.length) { const inS = new Set(side); for (const e of F) if (!inS.has(e) && holds(e) && dist(wr.last, e) <= 3 * aMed) list.push(e); }
          best = choose(pairs(list));
        }
        if (!best && side.some(e => wr.elev[e] > Ls + ahead)) best = choose(pairs(side));
        if (!best && seg.length > side.length) { const inS = new Set(side); best = choose(pairs(seg.filter(e => !inS.has(e)))); }
        if (!best && F.length > seg.length) { const inS = new Set(seg); best = choose(pairs(F.filter(e => !inS.has(e)))); }
        if (!best && wr.front.size && repair(wr)) best = choose(pairs([...wr.front].filter(e => !seq.made[e])));
      } else if (wr.last < 0) cands = [...new Set(wr.seed.flatMap(v => seq.cellCross[v]))].filter(e => !seq.made[e] && wr.elev[e] <= L + ahead).map(e => [e, 1]);
      else {
        cands = near(wr.last).filter(([e]) => wr.elev[e] <= L + ahead);
        const seen = new Set(cands.map(c => c[0]));
        for (let e = 0; e < w.nE; e++) if (seq.isCross[e] && !seq.made[e] && wr.elev[e] <= L && !seen.has(e)) cands.push([e, seq.crossDistance(wr.last, e, R + 1)]);
      }
      if (!together && !(contig && !relax)) best = choose(cands);
      for (let widen = 1; !best && widen <= 2 && !(contig && !relax); widen++) {
        const list = []; for (let e = 0; e < w.nE; e++) if (seq.isCross[e] && !seq.made[e] && (widen === 2 || wr.elev[e] <= L + 1)) list.push([e, wr.last < 0 ? 1 : seq.crossDistance(wr.last, e, R + 1)]);
        best = choose(list);
      }
      if (!best && !(contig && !relax) && repair(wr)) { const list = []; for (let e = 0; e < w.nE; e++) if (seq.isCross[e] && !seq.made[e]) list.push([e, wr.last < 0 ? 1 : seq.crossDistance(wr.last, e, R + 1)]); best = choose(list); }
      if (best) { act(wr, best.e); acted = true; if (together) wr.dmap = distFrom([best.e]); } else wr.idle++;
    }
    runJoins(0);
    seq.round++;
    if (contig) { if (relax) relaxed++; relax = !acted && !relax; if (relax) { stall = 0; continue; } }
    stall = acted ? 0 : stall + 1; if (stall > 2) break;
  }
  runJoins(0);
  // --- labels: strands by first use, pieces by birth -------------------------------------------------------------------
  const firstUse = new Map(); for (const P of seq.pieces) if (!firstUse.has(P.si) || P.born < firstUse.get(P.si)) firstUse.set(P.si, P.born);
  const strandRank = [...firstUse.keys()].sort((a, b) => firstUse.get(a) - firstUse.get(b) || a - b), label = new Map(strandRank.map((si, r) => [si, r + 1]));
  const perStrand = new Map();
  for (const P of [...seq.pieces].sort((a, b) => a.born - b.born || a.id - b.id)) { const n = (perStrand.get(P.si) || 0) + 1; perStrand.set(P.si, n); P.n = n; }
  for (const P of seq.pieces) P.label = perStrand.get(P.si) > 1 ? `S${label.get(P.si)}.${P.n}` : `S${label.get(P.si)}`;
  // --- metrics via replay (comparable with the baseline): own crossings only, the joint belongs to the strip that made it;
  //     the physical length includes the joints -------------------------------------------------------------------------
  const weaveEvents = seq.events.filter(ev => ev.kind === 'weave');
  const order = weaveEvents.map(ev => ev.e), weaverOf = weaveEvents.map(ev => ev.weaver), movers = weaveEvents.map(ev => ev.mover);
  const pieces = seq.pieces.map(P => ({ si: P.si, knots: P.knots.slice(P.ovTail, P.knots.length - P.ovHead), label: P.label }));
  const lengths = seq.pieces.map(P => spanLength(P.si, P.u0, P.u0 + P.knots.length - 1));
  const metrics = replay(w, pieces, order, { G, k, Lmax: Number.isFinite(Lmax) ? Lmax : 0, lengths, weaverOf, movers, weavers: K, ends: seq.pieces.map(P => [P.ovTail || 0, P.ovHead || 0]), lath: opts.lath });
  weaveEvents.forEach((ev, n) => { ev.collide = metrics.collideSeq[n] || 0; });      // the loose strips in the way at every crossing
  return {
    K, seeds, origin, front: origin ? 'together' : 'rims', startWhy, G, k, Lmax, Lcut, events: seq.events, order, pieces: seq.pieces, lengths, strandLabel: label, metrics, levels: weavers.map(wr => wr.elev), cellLevels: weavers.map(wr => wr.lev), aMed,
    rounds: seq.round, idle: weavers.map(wr => wr.idle), acts: weavers.map(wr => wr.acts), joins, jointsFirst, handovers, seams, cuts, shortJoints, overLong, weights: W,
    outside: contig ? weavers.map(wr => wr.outside) : null, relaxed,
    strandedMean: actions ? strandedSum / actions : 0, strandedMax,
    complete: seq.madeN === seq.nCross, madeN: seq.madeN, nCross: seq.nCross, pendingJoins: pendingJ.size, seq,
  };
}

/** the rim of the lattice as loops of boundary cells (connected groups of boundary cells) */
export function boundaryLoops(w, nbr) {
  const seen = new Uint8Array(w.nV), loops = [];
  for (let v = 0; v < w.nV; v++) {
    if (!w.boundary[v] || seen[v]) continue;
    const loop = [v]; seen[v] = 1;
    for (let q = 0; q < loop.length; q++) for (const u of nbr[loop[q]]) if (w.boundary[u] && !seen[u]) { seen[u] = 1; loop.push(u); }
    loops.push(loop);
  }
  return loops;
}
/** the start of the rings when none is given: the lowest rim (a tube from its bottom ring, a tree from its trunk base, the
 *  columns from a foot; a closed shape from the lower end of its longest axis) — unless from that rim most strands would
 *  turn back. A strand whose level rises and falls again is woven from both ends towards the middle, so it needs a joint
 *  there (R9): a cone from its rim turns every strand, from its apex none. Then the start is the candidate with the
 *  fewest turns (the singular cells, the centre of the lattice, the lower end of the longest axis, the other rims), if it
 *  has fewer than half. Returns { src, kind, turns, base: { kind, turns, strands, size } }. */
export function autoStart(w, nbr = neighbours(w), opts = {}) {
  const loops = boundaryLoops(w, nbr), zOf = (l) => l.reduce((s, v) => s + w.V[3 * v + 2], 0) / l.length;
  loops.sort((A, B) => zOf(A) - zOf(B) || A.length - B.length);
  const cands = loops.map(l => ({ src: l.slice(), kind: 'rim' }));
  const sing = []; for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) sing.push(v);
  if (sing.length <= 64) for (const v of sing) cands.push({ src: [v], kind: 'singular' });
  cands.push({ src: [graphCentre(w, nbr)], kind: 'centre' }, { src: [axisEnd(w)], kind: 'axis' });
  const measure = (c) => { const lev = hopDistance(w, c.src, nbr); Object.assign(c, strandTurns(w, lev)); let m = 0; for (const x of lev) if (x > m) m = x; c.ecc = m; return c; };
  const base = measure(loops.length ? cands[0] : cands[cands.length - 1]), rank = { rim: 0, singular: 1, centre: 2, axis: 3 };
  let pick = base;
  // a closed shape with a handle (a torus) has no rim, but it has loops that wrap around it: it starts from the shortest of
  // them through the lower end of its axis — a ring around the tube — and is woven like a tube, ring to ring, the two ends
  // meeting at the far side (Ji, 10 Nov: "wrap is early"; "a torus could be considered a bending tube")
  if (!loops.length && opts.wrap !== false) {
    const H = wrapClasses(w), lp = H.rank ? wrapLoopThrough(w, H, base.src[0]) : null;
    if (lp) { pick = { src: lp.cells, kind: 'wrap', lev: oneWayLevels(w, nbr, lp.cells) }; Object.assign(pick, strandTurns(w, pick.lev)); }
  }
  if (loops.length && base.strands >= 0.5 * w.strands.length) {
    let best = base;
    for (const c of cands) { if (c === base) continue; measure(c); if (c.turns < best.turns || (c.turns === best.turns && (rank[c.kind] < rank[best.kind] || (c.kind === best.kind && c.ecc < best.ecc)))) best = c; }
    if (best.turns < 0.5 * base.turns) pick = best;
  }
  return { src: pick.src, kind: pick.kind, turns: pick.turns, lev: pick.lev || null, base: { kind: base.kind, turns: base.turns, strands: base.strands, size: base.src.length } };
}
/** the shortest loop of cells through cell v0 that wraps around the shape (cannot be shrunk to a point on it): two shortest
 *  paths from v0 and the lattice edge that joins their ends, whose class (shape.js wrapClasses) is not zero.
 *  Returns { cells, length } or null. */
export function wrapLoopThrough(w, H, v0) {
  const r = H.rank; if (!r) return null;
  const adj = Array.from({ length: w.nV }, () => []); w.edges.forEach(([a, b], e) => { adj[a].push([b, e]); adj[b].push([a, e]); });
  const d = new Int32Array(w.nV).fill(-1), par = new Int32Array(w.nV).fill(-1), pot = new Int32Array(w.nV * r), queue = [v0]; d[v0] = 0;
  for (let q = 0; q < queue.length; q++) { const x = queue[q]; for (const [u, e] of adj[x]) if (d[u] < 0) { d[u] = d[x] + 1; par[u] = x; const sg = x < u ? 1 : -1; for (let j = 0; j < r; j++) pot[u * r + j] = pot[x * r + j] + sg * H.cls[e * r + j]; queue.push(u); } }
  let best = null;
  w.edges.forEach(([a, b], e) => {
    if (d[a] < 0 || d[b] < 0 || par[a] === b || par[b] === a) return;
    let wraps = false; for (let j = 0; j < r; j++) if (pot[a * r + j] + H.cls[e * r + j] - pot[b * r + j]) { wraps = true; break; }
    if (!wraps) return;
    const len = d[a] + d[b] + 1, bal = Math.abs(d[a] - d[b]);
    if (!best || len < best.len || (len === best.len && bal < best.bal)) best = { a, b, len, bal };
  });
  if (!best) return null;
  const pa = []; for (let v = best.a; v >= 0; v = par[v]) pa.push(v);          // a … v0
  const pb = []; for (let v = best.b; v >= 0; v = par[v]) pb.push(v);          // b … v0
  while (pa.length > 1 && pb.length > 1 && pa[pa.length - 2] === pb[pb.length - 2]) { pa.pop(); pb.pop(); }   // a shared stem is not part of the loop
  pb.pop();
  return { cells: [...pa, ...pb.reverse()], length: pa.length + pb.length };   // in order round the loop
}
/** ring levels from a wrap-around loop, one way only: the loop is the start and the end. From a cell of the loop the
 *  levels do not step to its neighbours on one side (between the previous and the next loop cell in the cell's fan), so
 *  those are reached the long way round and get the highest levels — the shape is woven from the loop round to the loop,
 *  like a tube from one rim to the other. `cycle` = the loop's cells in order. */
export function oneWayLevels(w, nbr, cycle) {
  const n = cycle.length, on = new Map(cycle.map((v, i) => [v, i])), blocked = new Set();
  for (let i = 0; i < n; i++) {
    const v = cycle[i], prev = cycle[(i - 1 + n) % n], next = cycle[(i + 1) % n];
    const fan = w.cellKnots[v].map(e => (w.edges[e][0] === v ? w.edges[e][1] : w.edges[e][0])), m = fan.length;
    const ip = fan.indexOf(prev), inx = fan.indexOf(next); if (ip < 0 || inx < 0) continue;
    for (let q = (ip + 1) % m; q !== inx; q = (q + 1) % m) if (!on.has(fan[q])) blocked.add(v * w.nV + fan[q]);   // the cells after prev, before next
  }
  const d = new Int32Array(w.nV).fill(-1), queue = cycle.slice(); for (const v of cycle) d[v] = 0;
  for (let q = 0; q < queue.length; q++) { const x = queue[q]; for (const u of nbr[x]) if (d[u] < 0 && !blocked.has(x * w.nV + u)) { d[u] = d[x] + 1; queue.push(u); } }
  for (let v = 0; v < w.nV; v++) if (d[v] < 0) { let m = 0; for (const u of nbr[v]) if (d[u] > m) m = d[u]; d[v] = m + 1; }   // (cut off by the loop: after everything else)
  return d;
}
/** the strands that turn back: interior strict maxima of the level along each strand (a plateau counted once) →
 *  { turns, strands (that turn at least once) } */
export function strandTurns(w, lev) {
  let turns = 0, strands = 0;
  for (const s of w.strands) {
    const t0 = turns;
    const n = s.knots.length, L = s.knots.map(e => { const [a, b] = w.edges[e]; return Math.max(lev[a], lev[b]); });
    const get = (i) => L[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
      if (!s.closed && (i === 0 || i === n - 1)) continue;
      if (get(i) === get(i - 1)) continue;
      let j = i; while ((s.closed ? j - i < n : j < n - 1) && get(j + 1) === get(i)) j++;
      if (!s.closed && j >= n - 1) continue;
      if (get(i - 1) < get(i) && get(j + 1) < get(i)) turns++;
    }
    if (turns > t0) strands++;
  }
  return { turns, strands };
}
/** a cell near the centre of the lattice (by hops): between the two ends of a double sweep */
export function graphCentre(w, nbr = neighbours(w)) {
  const far = (d) => { let b = 0; for (let v = 0; v < w.nV; v++) if (d[v] > d[b]) b = v; return b; };
  const p = far(hopDistance(w, [0], nbr)), dp = hopDistance(w, [p], nbr), q = far(dp), dq = hopDistance(w, [q], nbr);
  let best = 0, bs = Infinity; for (let v = 0; v < w.nV; v++) { if (dp[v] < 0 || dq[v] < 0) continue; const s = Math.max(dp[v], dq[v]) * 1000 + Math.abs(dp[v] - dq[v]); if (s < bs) { bs = s; best = v; } }
  return best;
}
/** the default seeds of K weavers, each from its own front: the start above, then the other rims from the lowest up,
 *  then the cells farthest from the seeds so far */
export function autoSeeds(w, K, nbr = neighbours(w), opts = {}) {
  const loops = boundaryLoops(w, nbr), z = (l) => l.reduce((s, v) => s + w.V[3 * v + 2], 0) / l.length;
  loops.sort((A, B) => z(A) - z(B) || A.length - B.length);
  const first = autoStart(w, nbr, opts).src, inFirst = new Set(first);
  const seeds = [first, ...loops.filter(l => !l.some(v => inFirst.has(v))).map(l => l.slice())].slice(0, K);
  return fillSeeds(w, nbr, seeds, K);
}
/** K start cells spread along a start (a rim loop, or a cell and the rings around it until there are K cells): the
 *  lowest first, then each the farthest from those chosen */
export function spreadStarts(w, nbr, origin, K) {
  const lev = hopDistance(w, origin, nbr);
  let cand = origin.slice();
  for (let r = 1; cand.length < K && r < w.nV; r++) { cand = []; for (let v = 0; v < w.nV; v++) if (lev[v] >= 0 && lev[v] <= r) cand.push(v); }
  const z = (v) => w.V[3 * v + 2];
  const out = [cand.reduce((b, v) => (z(v) < z(b) ? v : b), cand[0])];
  while (out.length < K && out.length < cand.length) {
    const d = hopDistance(w, out, nbr); let best = -1, bd = -1;
    for (const v of cand) if (d[v] > bd) { bd = d[v]; best = v; }
    if (best < 0 || bd <= 0) break; out.push(best);
  }
  return out;
}
/** add seeds (single cells) farthest from the ones there, up to K */
export function fillSeeds(w, nbr, seeds, K) {
  const out = seeds.map(s => s.slice());
  while (out.length < K) { const d = hopDistance(w, out.flat(), nbr); let best = -1, bd = -1; for (let v = 0; v < w.nV; v++) if (d[v] > bd) { bd = d[v]; best = v; } if (best < 0) break; out.push([best]); }
  return out;
}
/** the cell at the lower end of the longest axis of the shape (principal axis of the cells, oriented upward) */
export function axisEnd(w) {
  const n = w.nV, c = [0, 0, 0]; for (let v = 0; v < n; v++) for (let q = 0; q < 3; q++) c[q] += w.V[3 * v + q] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let v = 0; v < n; v++) { const d = [w.V[3 * v] - c[0], w.V[3 * v + 1] - c[1], w.V[3 * v + 2] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  let u = [0.3, 0.5, 0.8]; for (let it = 0; it < 60; it++) { const x = [0, 1, 2].map(i => C[i][0] * u[0] + C[i][1] * u[1] + C[i][2] * u[2]), l = Math.hypot(...x) || 1; u = x.map(t => t / l); }
  if (u[2] < -1e-6 || (Math.abs(u[2]) <= 1e-6 && u[0] < 0)) u = u.map(t => -t);
  let best = 0, bp = Infinity; for (let v = 0; v < n; v++) { const p = (w.V[3 * v] - c[0]) * u[0] + (w.V[3 * v + 1] - c[1]) * u[1] + (w.V[3 * v + 2] - c[2]) * u[2]; if (p < bp) { bp = p; best = v; } }
  return best;
}
