// planner.js — the human layer on top of the weave: where to start, in which order to build the cells, what every
// sub-step asks of the hands (which strip, in which direction, over or under at each crossing, which crossings to clip
// until they hold), where the strands are cut into pieces of the material's length and how consecutive pieces overlap.
//
// Rules in this practice (each one is a choice to discuss, see README):
//   start    — 'half' (most reachable): the cell from which half of the singular cells are reached soonest; 'centre':
//              smallest sum of distances to every singular cell; 'flat': the regular cell farthest from any singularity;
//              or a cell picked on the surface.
//   order    — 'spiral': rings from the start (from the whole rim where the start lies on the end of a tube), inside a
//              ring stay beside the last cell and close early — but WHAT IS BEGUN IS FINISHED (18 Nov): a limb (an ear,
//              a branch: shape.js limbs) once the tour has taken one of its cells, and a hole — the smallest part of the
//              cells still to weave — as soon as the weave has closed round it; 'strips':
//              the same but prefer cells whose sides are strips already in hand (fewest new pieces); 'singular': grow
//              toward the singular cells one after another along a nearest-neighbour tour, then finish in rings.
//   fan      — building a cell makes every crossing of its fan (its ring and the opposite edge of each of its
//              triangles) that is not made yet: the cell's strips are woven through each other completely, free ends
//              included (Design update 3). A crossing is made at the first cell whose fan holds it.
//   sub-steps — per cell: 'lay' the crossings between strips already in hand (slotted into the cell's strip sub-step
//              right after the strip has passed both strips of the crossing — one event per cell), 'add' every new strip,
//              threaded through the strips in hand in its weaving direction (the end with less length to pull through,
//              reversible); the last sub-step closes the cell; a cell already woven by its neighbours gets an empty
//              'close'; a final 'done' sub-step shows the finished weave. Crossings get fractional sub-steps (ticks).
//   pieces   — ONE WOVEN PART PER STRIP (Ji, 11 Nov — "both ends woven": the capped cylinder at step 76, S21 on the 5-cone):
//              a strip is threaded where the tour first needs its strand and woven on from there, crossing after crossing,
//              in one or both directions — never at a second place with the middle free. Two things keep that:
//              the ORDER — a cell whose fan needs a strip that is woven up to less than `follow` lattice edges away, but
//              not up to this cell, waits: the tour takes the nearest cell that can be woven (the strip is followed
//              first — a short move, not a joint); and the CUT — where the tour comes back to a strand further away
//              than that, a new strip starts there and the two are joined where they meet (strandValleys, cutByTimes).
//              A strip is as long as the material allows from where it is threaded; the next one is joined to its end
//              (the joint first: its end pushed through the last k woven crossings, then woven on).
//              `strips: 'shared'` gives the earlier cut (by arc length from the first-woven crossing, both strips woven
//              through a joint's crossings, a strip woven wherever the tour meets it) — the baseline.
//   clips    — a strip holds itself by friction once it has been woven through N crossings (4, more for slippery
//              material): a crossing is a clip point until both strips through it hold.
//   ⋈        — the closing of a cell with fewer than six sides: there the families permute, so strips that run parallel
//              on a flat patch have to cross each other ("cross exists" in Ji's notes, only around cells under six).

import { limbs } from './shape.js';

/** lexicographic a < b over arrays of numbers */
const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; } return false; };

/** BFS hop distance from a set of cells over the lattice edges */
export function hopDistance(w, sources, nbr) {
  const d = new Int32Array(w.nV).fill(-1), queue = [];
  for (const s of sources) { if (d[s] < 0) { d[s] = 0; queue.push(s); } }
  for (let q = 0; q < queue.length; q++) { const v = queue[q]; for (const u of nbr[v]) if (d[u] < 0) { d[u] = d[v] + 1; queue.push(u); } }
  return d;
}

export function neighbours(w) {
  const nbr = Array.from({ length: w.nV }, () => []);
  for (const [a, b] of w.edges) { nbr[a].push(b); nbr[b].push(a); }
  return nbr;
}

export const START_RULES = {
  half: 'most reachable: half of the singular cells soonest',
  centre: 'centre of the singular cells: smallest sum of distances',
  flat: 'from flat: the regular cell farthest from any singularity',
  rim: 'from the rim: the lowest cell of the boundary — and round that rim first where it is the end of a tube',
  loop: 'from a loop round the shape: the shortest one through the lower end of its longest axis, then one way round (a shape with a handle and no rim)',
};
export const ORDER_RULES = {
  spiral: 'spiral: rings from the start, close early',
  strand: 'along the strips: follow the newest strip, then the nearest cell',
  strips: 'fewest new strips: prefer cells whose strips are in hand',
  singular: 'singular to singular: grow toward the next singular cell',
};
/** the fan of every cell: its ring crossings and the opposite crossing of each of its triangles (edge ids) */
export function cellFans(w) {
  const fan = Array.from({ length: w.nV }, () => []), seen = Array.from({ length: w.nV }, () => new Set());
  for (let t = 0; t < w.nT; t++) for (let k = 0; k < 3; k++) { const v = w.F[3 * t + k]; for (let m = 0; m < 3; m++) { const e = w.triEdges[3 * t + m]; if (!seen[v].has(e)) { seen[v].add(e); fan[v].push(e); } } }
  return fan;
}
/** the cells whose fan holds edge e: its two cells and the apex of each of its triangles */
function fanCellsOf(w, e) { const [a, b] = w.edges[e], out = [a, b]; for (const t of w.edgeTris[e]) for (let k = 0; k < 3; k++) { const v = w.F[3 * t + k]; if (v !== a && v !== b) out.push(v); } return out; }

/** the automatic start; rule: 'half' (default) | 'centre' | 'flat'. Returns {cell, scores (lower = better), k, singular} */
export function chooseStart(w, nbr, rule = 'half') {
  const singular = []; for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) singular.push(v);
  const S = singular.length, scores = new Float64Array(w.nV).fill(Infinity);
  if (rule === 'rim') {
    let best = -1, bz = Infinity;
    for (let v = 0; v < w.nV; v++) { if (!w.boundary[v]) continue; scores[v] = w.V[3 * v + 2]; if (w.V[3 * v + 2] < bz) { bz = w.V[3 * v + 2]; best = v; } }
    if (best >= 0) return { cell: best, scores, k: 0, singular };
  }
  if (S > 0 && rule === 'flat') {
    const d = hopDistance(w, singular, nbr); let best = -1, bs = -1;
    for (let v = 0; v < w.nV; v++) { if (w.boundary[v]) continue; scores[v] = -d[v]; if (d[v] > bs) { bs = d[v]; best = v; } }
    return { cell: best, scores, k: 0, singular };
  }
  if (S > 0 && rule === 'centre') {
    const D = singular.map(s => hopDistance(w, [s], nbr)); let best = -1, bs = Infinity;
    for (let v = 0; v < w.nV; v++) { if (w.boundary[v]) continue; let sum = 0; for (const d of D) sum += d[v]; scores[v] = sum; if (sum < bs) { bs = sum; best = v; } }
    return { cell: best, scores, k: S, singular };
  }
  if (S === 0) {
    const rim = []; for (let v = 0; v < w.nV; v++) if (w.boundary[v]) rim.push(v);
    let best = -1, bs = -Infinity;
    if (rim.length) { const d = hopDistance(w, rim, nbr); for (let v = 0; v < w.nV; v++) { scores[v] = -d[v]; if (d[v] > bs) { bs = d[v]; best = v; } } }
    else {
      let cx = 0, cy = 0, cz = 0; for (let v = 0; v < w.nV; v++) { cx += w.V[3 * v]; cy += w.V[3 * v + 1]; cz += w.V[3 * v + 2]; } cx /= w.nV; cy /= w.nV; cz /= w.nV;
      bs = Infinity; for (let v = 0; v < w.nV; v++) { const d = Math.hypot(w.V[3 * v] - cx, w.V[3 * v + 1] - cy, w.V[3 * v + 2] - cz); scores[v] = d; if (d < bs) { bs = d; best = v; } }
    }
    return { cell: best, scores, k: 0, singular };
  }
  const k = Math.ceil(S / 2), D = singular.map(s => hopDistance(w, [s], nbr));
  let best = -1, bestKey = null;
  for (let v = 0; v < w.nV; v++) {
    if (w.boundary[v]) continue;
    const ds = D.map(d => d[v]).sort((a, b) => a - b); let sum = 0; for (const x of ds) sum += x;
    const key = [ds[k - 1], sum, w.valence[v] === 6 ? 0 : 1, -w.V[3 * v + 2]];                    // last tie-break: the higher cell (start on top)
    scores[v] = ds[k - 1] + sum / (1e3 * S);
    if (!bestKey || lexLess(key, bestKey)) { best = v; bestKey = key; }
  }
  return { cell: best, scores, k, singular };
}

/** The strip rule as the tour sees it. A strand is woven in parts (runs of made crossings); a cell can be woven when every
 *  strand of its fan is either woven up to the cell (its new crossings continue a woven part — one crossing may wait, G),
 *  or not woven within D crossings of it (a new strip starts here). Otherwise a strip in hand ends close by and has to be
 *  followed first: the cell waits. → { avail(v), take(v), made, forced } */
export function strandGuard(w, fan, D = 8, G = 1) {
  const made = new Uint8Array(w.nE);
  const avail = (v) => {
    const by = new Map();                                             // strand → the knots this cell would make on it
    for (const e of fan[v]) { if (made[e]) continue; for (const [si, i] of w.knotStrands[e]) { let l = by.get(si); if (!l) by.set(si, l = []); l.push(i); } }
    for (const [si, list] of by) {
      const s = w.strands[si], n = s.knots.length, inCell = new Set(list), seen = new Set();
      const nx = (i, d) => { const j = i + d; return s.closed ? ((j % n) + n) % n : (j >= 0 && j < n ? j : -1); };
      for (const i0 of list) {
        if (seen.has(i0)) continue;
        let lo = i0, hi = i0; seen.add(i0);
        for (let j = nx(lo, -1); j >= 0 && inCell.has(j) && !seen.has(j); j = nx(lo, -1)) { lo = j; seen.add(j); }
        for (let j = nx(hi, 1); j >= 0 && inCell.has(j) && !seen.has(j); j = nx(hi, 1)) { hi = j; seen.add(j); }
        let near = Infinity;                                          // unmade crossings between this run and the strand's woven part
        for (const [from, d] of [[lo, -1], [hi, 1]]) for (let j = nx(from, d), g = 0; j >= 0 && g <= Math.max(D, G); j = nx(j, d), g++) { if (inCell.has(j)) break; if (made[s.knots[j]]) { near = Math.min(near, g); break; } }
        if (near > G && near < D) return false;                       // a strip ends close by: follow it first
      }
    }
    return true;
  };
  const guard = { avail, made, forced: 0, take: (v) => { for (const e of fan[v]) made[e] = 1; } };
  return guard;
}

/** The parts of a strand by when its crossings are made (t[i]: the cell that makes knot i). A part starts where the tour
 *  first touches the strand (a seed) and grows from there; where two parts meet lies a joint. → group[i] (the part of
 *  every knot; a part is contiguous along the strand), nG, self (a closed strand whose one part meets itself). One unmade
 *  crossing between two woven ones does not make two parts (G). */
export function strandValleys(s, t, G = 1) {
  const K = s.knots.length, closed = s.closed, group = new Int32Array(K).fill(-1), made = new Uint8Array(K);
  const nx = (i, d) => { const j = i + d; return closed ? ((j % K) + K) % K : (j >= 0 && j < K ? j : -1); };
  const order = [...Array(K).keys()].sort((a, b) => t[a] - t[b] || a - b);
  let nG = 0;
  /** the part woven within G unmade crossings of knot i on side d (made before this batch, or already placed in it) */
  const beside = (i, d) => { for (let j = nx(i, d), g = 0; j >= 0 && g <= G; j = nx(j, d), g++) if (group[j] >= 0) return group[j]; return -1; };
  for (let p = 0; p < K;) {
    let q = p; while (q < K && t[order[q]] === t[order[p]]) q++;
    const batch = order.slice(p, q).sort((a, b) => a - b), inB = new Set(batch), seen = new Set();
    for (const i of batch) made[i] = 1;
    for (const i0 of batch) {
      if (seen.has(i0)) continue;
      let lo = i0, hi = i0, n = 1; seen.add(i0);
      for (let j = nx(lo, -1); j >= 0 && inB.has(j) && !seen.has(j); j = nx(lo, -1)) { lo = j; seen.add(j); n++; }
      for (let j = nx(hi, 1); j >= 0 && inB.has(j) && !seen.has(j); j = nx(hi, 1)) { hi = j; seen.add(j); n++; }
      const ga = beside(lo, -1), gb = beside(hi, 1);
      if (ga >= 0 && gb >= 0 && ga !== gb) {                          // two parts meet in this cell: the joint in the middle of its crossings
        const half = Math.ceil(n / 2); for (let c = 0, i = lo; c < n; c++, i = nx(i, 1)) group[i] = c < half ? ga : gb;
      } else { const g = ga >= 0 ? ga : gb >= 0 ? gb : nG++; for (let c = 0, i = lo; c < n; c++, i = nx(i, 1)) group[i] = g; }
    }
    p = q;
  }
  for (let i = 0; i < K; i++) if (group[i] < 0) group[i] = nG++;      // (never made: a part of its own)
  return { group, nG, self: closed && nG === 1 };
}

/** Cut one strand into strips by when its crossings are made. Every part (strandValleys) is woven from its seed outward:
 *  the first strip takes the seed and grows with the tour, on both sides, until the material ends; the next strip on that
 *  side starts there, its end laid over the last k crossings of the one before (the joint first). Where two parts meet,
 *  the strip with more material left is laid over the other's last crossings (k in all).
 *  → { offset, reversed, pieces: [{lo, hi (own crossings, walk positions), ovTail, ovHead, born}] in walk order, short }.
 *  A closed strand's walk starts after its last joint; its first strip may reach back before 0, its last one past K − 1. */
function cutByTimes(w, si, knotCell, maxL, k) {
  const s = w.strands[si], K = s.knots.length, closed = s.closed, t = s.knots.map(e => knotCell[e]);
  const { group, self } = strandValleys(s, t);
  // the walk: an open strand from the end nearer to its first-woven crossing; a closed one from just after the joint
  // made last (the part that begins there starts at walk position 0)
  let first = 0; for (let i = 1; i < K; i++) if (t[i] < t[first]) first = i;
  let offset = 0, reversed = 0;
  if (!closed) reversed = first > (K - 1) / 2 ? 1 : 0;
  else if (self) { let last = 0; for (let i = 1; i < K; i++) if (t[i] > t[last]) last = i; offset = (last + 1) % K; }
  else { let best = -1; for (let i = 0; i < K; i++) { const j = (i + 1) % K; if (group[i] !== group[j] && (best < 0 || Math.max(t[i], t[j]) > Math.max(t[best], t[(best + 1) % K]))) best = i; } offset = (best + 1) % K; }
  const walk = strandWalk(w, si, offset, reversed), tq = (q) => t[walk.knotAt(q)], gq = (q) => group[walk.knotAt(q)];
  const arc = new Float64Array(K + 1); for (let q = 0; q < walk.nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
  const total = arc[closed ? K : K - 1];
  const arcW = (q) => (closed ? Math.floor(q / K) * total + arc[((q % K) + K) % K] : arc[Math.max(0, Math.min(K - 1, q))]);
  const physLen = (q0, q1) => arcW(q1) - arcW(q0) + (closed || q0 > 0 ? walk.segLen(q0 - 1) / 2 : 0) + (closed || q1 < K - 1 ? walk.segLen(q1) / 2 : 0);
  const fits = (q0, q1) => !(maxL > 0) || physLen(q0, q1) <= maxL * (1 + 1e-9);
  const pieces = [], valleys = [];
  for (let a = 0; a < K;) {
    let b = a; while (b + 1 < K && gq(b + 1) === gq(a)) b++;
    // the seed: the crossings made first (a cell's window; two windows of one cell with their gap)
    let tmin = Infinity; for (let q = a; q <= b; q++) tmin = Math.min(tmin, tq(q));
    let sl = a; while (tq(sl) !== tmin) sl++; let sh = b; while (tq(sh) !== tmin) sh--;
    const P0 = { lo: sl, hi: sh, ovTail: 0, ovHead: 0, born: tmin }, cur = { 1: P0, '-1': P0 }, v0 = pieces.length; pieces.push(P0);
    const add = (q, sd) => {
      const P = cur[sd];
      if (sd > 0 ? fits(P.lo - P.ovTail, q) : fits(q, P.hi + P.ovHead)) { if (sd > 0) P.hi = q; else P.lo = q; return; }
      let n = Math.min(k, P.hi - P.lo + 1); while (n > 0 && !(sd > 0 ? fits(q - n, q) : fits(q, q + n))) n--;   // the material shorter than a joint: a shorter one
      const Q = { lo: q, hi: q, ovTail: sd > 0 ? n : 0, ovHead: sd > 0 ? 0 : n, born: tq(q) }; pieces.push(Q); cur[sd] = Q;
    };
    let l = sl - 1, h = sh + 1;
    while (l >= a || h <= b) { if (h > b || (l >= a && tq(l) <= tq(h))) add(l--, -1); else add(h++, 1); }
    valleys.push({ a, b, first: v0 });
    a = b + 1;
  }
  pieces.sort((x, y) => x.lo - y.lo);
  // the joints where two parts meet (and where a closed strand's last part meets its first): a lap of up to k crossings,
  // made by one of the two ends. THE STRIP THAT IS THERE FIRST IS ALWAYS THE LOWER LAYER (Ji, 18 Nov, answer 1: "first
  // always on the bottom; that is my previous joint drawing" — until then the earlier strip was laid on top when its
  // material reached further). So: the strip that arrives later (the one threaded later when both arrive in one cell) is
  // laid over the earlier one's last crossings, as far as its material goes; where that is less than the earlier strip
  // can give, the earlier strip's spare end goes on UNDER the later one instead (ovUnder: the same lap, the layers as the
  // rule asks). Only two strips threaded in the same cell have no first: there the longer lap, then the one with more
  // material left, laid on.
  let short = 0;
  const meet = (A, B, shift) => {                                   // A ends at the joint, B begins after it (B's positions + shift)
    const spare = (P) => (maxL > 0 ? maxL - physLen(P.lo - P.ovTail, P.hi + P.ovHead) : Infinity);
    const ownA = A.hi - A.lo + 1, ownB = B.hi - B.lo + 1;
    const grow = (P, head, want) => { let n = 0; while (n < want && (head ? fits(P.lo - P.ovTail, P.hi + n + 1) : fits(P.lo - n - 1, P.hi + P.ovHead))) n++; return n; };
    if (A === B) { A.ovHead = grow(A, true, Math.min(k, ownA - 1)); if (A.ovHead < Math.min(k, ownA - 1)) short++; return; }
    const gA = grow(A, true, Math.min(k, ownB)), gB = grow(B, false, Math.min(k, ownA)), tA = tq(A.hi), tB = tq(B.lo);
    const want = Math.min(k, ownA, ownB), laterA = tA !== tB ? tA > tB : A.born !== B.born ? A.born > B.born : null;
    let takeA, under = false;
    if (laterA === null) takeA = gA !== gB ? gA > gB : spare(A) >= spare(B);
    else { const gL = laterA ? gA : gB, gE = laterA ? gB : gA; under = gL < want && gE > gL; takeA = under ? !laterA : laterA; }
    if (takeA) { A.ovHead = gA; if (under) A.underHead = true; } else { B.ovTail = gB; if (under) B.underTail = true; }
    if ((takeA ? gA : gB) < want) short++;
  };
  for (let j = 0; j + 1 < pieces.length; j++) if (gq(pieces[j].hi) !== gq(pieces[j + 1].lo)) meet(pieces[j], pieces[j + 1], 0);
  if (closed && pieces.length) { const A = pieces[pieces.length - 1], B = pieces[0]; if (A === B || gq(A.hi) !== gq(B.lo) || self) meet(A, B, K); }
  return { offset, reversed, pieces, short, walk };
}

/** the cell order. strategy: 'spiral' | 'strips' | 'singular'; pieceOf(si, i) → a provisional piece id for the cost of
 *  new strips (any consistent partition works); singular: the singular cells (for the tour) */
export function cellOrder(w, nbr, start, ring, strategy = 'spiral', pieceOf = null, singular = [], guard = null, limbsOf = null) {
  const nV = w.nV, woven = new Uint8Array(nV), wovenNbr = new Int32Array(nV), order = [], inHand = new Set();
  const nbrSet = nbr.map(l => new Set(l));
  const sidePieces = (v) => w.cellSegs[v].map(([t, k]) => pieceOf ? pieceOf(w.segStrand[3 * t + k], w.segIndex[3 * t + k]) : w.segStrand[3 * t + k]);
  // WHAT IS BEGUN IS FINISHED (Ji, 18 Nov — the bunny's ears: "it should finish the ear as early as it can, rather than
  // bring more strips to weave the other front … without hanging the strips and leaving it open there"; and his rule for
  // the growing weave: "a surface without a hole, then patch the hole"). Two things, both on with limbsOf:
  //   a LIMB (shape.js limbs — a part that sticks out and ends): as soon as the tour takes one of its cells it stays in
  //     it — round the ring it came in by, ring by ring to the tip (or the rim), then what is left towards the body — and
  //     only then goes on with the rings from the start. A limb inside a limb first.
  //   a HOLE: when the woven cells close round a patch — the cells still to weave fall into several parts — the smallest
  //     part is woven first, and so on: the weave never goes on round a patch it has left open. On a tube or a branch the
  //     parts are the two sides of the band just closed: one side is finished before the other is begun.
  const LB = limbsOf && limbsOf.list.length && strategy === 'spiral' ? limbsOf : null, holesFirst = !!limbsOf && strategy === 'spiral';
  /** the cells still to weave (inside `mask` when given) as connected parts → the smallest one as a mask, null when there is one part only */
  const smallestOpenPart = (mask, near) => {
    const comp = new Int32Array(nV).fill(-1), parts = [];
    for (let v0 = 0; v0 < nV; v0++) {
      if (woven[v0] || comp[v0] >= 0 || ring[v0] < 0 || (mask && !mask[v0])) continue;
      const id = parts.length, st = [v0]; comp[v0] = id; let n = 0, d = Infinity;
      while (st.length) { const x = st.pop(); n++; if (near(x) < d) d = near(x); for (const u of nbr[x]) if (!woven[u] && comp[u] < 0 && ring[u] >= 0 && (!mask || mask[u])) { comp[u] = id; st.push(u); } }
      parts.push({ id, n, d });
    }
    if (parts.length < 2) return null;
    const P = parts.reduce((a, b) => (b.n < a.n || (b.n === a.n && b.d < a.d) ? b : a)), out = new Uint8Array(nV);
    for (let v = 0; v < nV; v++) if (comp[v] === P.id) out[v] = 1;
    return out;
  };
  const limbLeft = LB ? LB.list.map(L => L.cells.length) : null, limbEntry = LB ? LB.list.map(() => -1) : null;
  const activeLimb = () => { let a = -1; if (LB) for (const L of LB.list) if (limbEntry[L.id] >= 0 && limbLeft[L.id] > 0 && (a < 0 || L.cells.length < LB.list[a].cells.length)) a = L.id; return a; };
  const limbLevel = (l, v) => { const L = LB.list[l], dv = L.d[v], de = L.d[limbEntry[l]]; return dv <= de ? de - dv : L.rings + dv - de; };   // the ring it was entered by, then towards the seed, then outwards
  const take = (v) => { woven[v] = 1; order.push(v); for (const u of nbr[v]) wovenNbr[u]++; for (const p of sidePieces(v)) inHand.add(p); if (guard) guard.take(v);
    if (LB) for (let l = LB.of[v]; l >= 0; l = LB.list[l].parent) { limbLeft[l]--; if (limbEntry[l] < 0) limbEntry[l] = v; } };
  if (strategy === 'strand') return strandOrder(w, nbr, start, take, woven, wovenNbr, order);
  take(start);
  let last = start;
  // singular tour: nearest-neighbour from the start over hop distances
  let targets = [], tIdx = 0, dTarget = null;
  if (strategy === 'singular' && singular.length) {
    const left = new Set(singular.filter(s => s !== start)); let cur = start;
    while (left.size) { const d = hopDistance(w, [cur], nbr); let bestS = -1, bd = Infinity; for (const s of left) if (d[s] >= 0 && d[s] < bd) { bd = d[s]; bestS = s; } if (bestS < 0) break; targets.push(bestS); left.delete(bestS); cur = bestS; }
  }
  while (order.length < nV) {
    const dLast = hopDistance(w, [last], nbr), dl = (v) => (dLast[v] < 0 ? 1e9 : dLast[v]);
    const A = activeLimb(), lev = A >= 0 ? (v) => limbLevel(A, v) : (v) => ring[v];
    let inA = A >= 0 ? LB.list[A].member : null;
    if (holesFirst) { const part = smallestOpenPart(inA, dl); if (part) inA = part; }   // (inA: where the tour may go now — the limb that is begun, the hole to patch)
    let r = Infinity; for (let v = 0; v < nV; v++) if (!woven[v] && ring[v] >= 0 && (!inA || inA[v]) && lev(v) < r) r = lev(v);
    if (r === Infinity) { for (let v = 0; v < nV; v++) if (!woven[v]) take(v); break; }
    while (strategy === 'singular' && tIdx < targets.length && woven[targets[tIdx]]) { tIdx++; dTarget = null; }
    const toTarget = strategy === 'singular' && tIdx < targets.length;
    if (toTarget && !dTarget) dTarget = hopDistance(w, [targets[tIdx]], nbr);
    const keyOf = (v) => {                                            // the rule of the order (null: not a candidate)
      if (toTarget) return [dTarget[v] < 0 ? 1e9 : dTarget[v], -wovenNbr[v], dl(v), v];
      if (strategy === 'strips') { let fresh = 0; for (const p of new Set(sidePieces(v))) if (!inHand.has(p)) fresh++; return [ring[v] - r > 1 ? 1 : 0, fresh, ring[v], nbrSet[last].has(v) ? 0 : 1, -wovenNbr[v], dl(v), v]; }
      return lev(v) === r ? [nbrSet[last].has(v) ? 0 : 1, -wovenNbr[v], dl(v), v] : null;
    };
    const can = new Map(); let waiting = 0;                            // cells that wait for a strip (the strip rule)
    const ok = (v) => { let a = can.get(v); if (a === undefined) { a = guard.avail(v); can.set(v, a); } return a; };
    const pick = (key, free) => {
      let best = -1, bestKey = null;
      for (let v = 0; v < nV; v++) {
        if (woven[v] || !wovenNbr[v] || (inA && !inA[v])) continue;   // the front: cells touching the woven patch (inside the limb that is begun)
        const kv = key(v); if (!kv) continue;
        if (free && !ok(v)) { waiting++; continue; }
        if (!bestKey || lexLess(kv, bestKey)) { best = v; bestKey = kv; }
      }
      return best;
    };
    let best = pick(keyOf, !!guard);
    if (guard) {
      // a cell of the ring waits for its strip: the nearest of the others rather than the one best closed — the weaver
      // stays where the work is, and the strip that is waited for is usually next to it
      if (best >= 0 && waiting && !nbrSet[last].has(best)) best = pick((v) => { const kv = keyOf(v); return kv ? [dl(v), ...kv] : null; }, true);
      if (best < 0) best = pick((v) => [dl(v), lev(v), -wovenNbr[v], v], true);   // the whole ring waits: on, next to the weaver, whatever the ring
      if (best < 0) { best = pick(keyOf, false); if (best >= 0) guard.forced++; }   // nothing can be woven by the rule: the cell of the order (a new strip there)
    }
    if (best < 0 && inA) best = pick((v) => [lev(v), dl(v), v], false);   // the ring of the limb or the hole is not on the front yet: the nearest ring that is
    if (best < 0) { for (let v = 0; v < nV; v++) if (!woven[v] && (!inA || inA[v])) { best = v; break; } }
    take(best); last = best;
  }
  return order;
}

/** several weavers on the cell tour: every cell goes to the nearest start (hops; a tie to the earlier weaver), each weaver
 *  closes the cells of its part in the spiral order from its own start, and the tours are interleaved one cell each in
 *  turn. → { order (the interleaved tour), owner (cell → weaver), ring (hops from the cell's own start) } */
export function multiTour(w, nbr, starts, guard = null) {
  const nV = w.nV, K = starts.length, owner = new Int32Array(nV).fill(-1), ring = new Int32Array(nV).fill(-1);
  let frontier = [];
  starts.forEach((s, i) => { if (owner[s] < 0) { owner[s] = i; ring[s] = 0; frontier.push(s); } });
  for (let d = 1; frontier.length; d++) { const next = []; for (const v of frontier) for (const u of nbr[v]) if (owner[u] < 0) { owner[u] = owner[v]; ring[u] = d; next.push(u); } frontier = next; }
  for (let v = 0; v < nV; v++) if (owner[v] < 0) { owner[v] = 0; ring[v] = nV; }        // a part of the lattice no start reaches
  const nbrSet = nbr.map(l => new Set(l)), woven = new Uint8Array(nV), wovenNbr = new Int32Array(nV), left = new Int32Array(K), last = new Int32Array(K).fill(-1), order = [];
  for (let v = 0; v < nV; v++) left[owner[v]]++;
  const take = (v, i) => { woven[v] = 1; order.push(v); left[i]--; last[i] = v; for (const u of nbr[v]) wovenNbr[u]++; if (guard) guard.take(v); };
  starts.forEach((s, i) => { if (!woven[s] && owner[s] === i) take(s, i); });
  while (order.length < nV) {
    let moved = false;
    for (let i = 0; i < K; i++) {
      if (!left[i]) continue;
      let r = Infinity; for (let v = 0; v < nV; v++) if (!woven[v] && owner[v] === i && ring[v] < r) r = ring[v];
      const dLast = last[i] >= 0 ? hopDistance(w, [last[i]], nbr) : null;
      const dl = (v) => (dLast && dLast[v] >= 0 ? dLast[v] : 1e9);
      const pick = (anyRing, free) => {
        let best = -1, bestKey = null;
        for (let v = 0; v < nV; v++) {
          if (woven[v] || owner[v] !== i || !wovenNbr[v] || (!anyRing && ring[v] !== r)) continue;   // its part of the front, its ring
          if (free && !guard.avail(v)) continue;                       // the strip rule: this cell waits for a strip
          const key = anyRing ? [dl(v), ring[v], -wovenNbr[v], v] : [last[i] >= 0 && nbrSet[last[i]].has(v) ? 0 : 1, -wovenNbr[v], dl(v), v];
          if (!bestKey || lexLess(key, bestKey)) { best = v; bestKey = key; }
        }
        return best;
      };
      let best = pick(false, !!guard);
      if (best < 0 && guard) best = pick(true, true);
      if (best < 0 && guard) { best = pick(false, false); if (best >= 0) guard.forced++; }
      if (best < 0) for (let v = 0; v < nV; v++) if (!woven[v] && owner[v] === i && ring[v] === r) { best = v; break; }
      if (best >= 0) { take(best, i); moved = true; }
    }
    if (!moved) break;
  }
  return { order, owner, ring };
}

/** 'along the strips': follow one strip cell by cell along its crossings — the row of cells it runs through — in one
 *  direction, then the other; when it is exhausted take the next strip introduced so far (closed strands first, then
 *  the longest, then the oldest); when none is left, the nearest cell of the front, which introduces new strips
 *  (Ji's marching direction: first ring, second ring, diagonals …) */
function strandOrder(w, nbr, start, take, woven, wovenNbr, order) {
  const nV = w.nV, fan = cellFans(w), made = new Uint8Array(w.nE), used = new Uint8Array(w.strands.length), done = new Uint8Array(w.strands.length), queue = [];
  const nbrSet = nbr.map(l => new Set(l));
  const takeCell = (v) => { take(v); for (const e of fan[v]) made[e] = 1; for (const e of fan[v]) for (const [si] of w.knotStrands[e]) if (!used[si]) { used[si] = 1; queue.push(si); } };
  const startIndex = (si) => { const s = w.strands[si]; let best = -1; s.knots.forEach((e, i) => { if (made[e] && best < 0) best = i; }); return best; };
  /** the strip to follow next among those introduced from index q0 of the queue on (the newest cell's strips): closed
   *  strands first, then the longest, then the first introduced */
  const nextStrand = (q0 = 0) => {
    let best = -1, bk = null;
    for (let q = q0; q < queue.length; q++) { const si = queue[q], s = w.strands[si]; if (done[si] || !s.knots.some(e => !made[e])) continue; const key = [s.closed ? 0 : 1, -s.knots.length, q]; if (!bk || lexLess(key, bk)) { best = si; bk = key; } }
    return best;
  };
  /** the front cell at the next unmade crossing of strand si from index `at` in direction dir: {cell, i} or null */
  const ahead = (si, at, dir, last) => {
    const s = w.strands[si], K = s.knots.length; let i = at;
    for (let n = 0; n < K; n++) {
      i = s.closed ? ((i + dir) % K + K) % K : i + dir;
      if (i < 0 || i >= K) return null;
      const e = s.knots[i]; if (made[e]) continue;
      let best = -1, bk = null;                                     // its own two cells first, then the apexes
      for (const v of fanCellsOf(w, e)) { if (woven[v] || !wovenNbr[v]) continue; const key = [w.edges[e].includes(v) ? 0 : 1, nbrSet[last].has(v) ? 0 : 1, -wovenNbr[v], v]; if (!bk || lexLess(key, bk)) { best = v; bk = key; } }
      return best >= 0 ? { cell: best, i } : null;
    }
    return null;
  };
  let follow = -1, dir = 1, at = -1, last = start, tries = 0;
  takeCell(start); follow = nextStrand(); if (follow >= 0) at = startIndex(follow);
  while (order.length < nV) {
    let next = -1;
    if (follow >= 0) {
      const hit = ahead(follow, at, dir, last);
      if (hit) { next = hit.cell; at = hit.i; }
      else if (tries === 0) { tries = 1; dir = -dir; at = startIndex(follow); continue; }       // the other way along the strip
      else { done[follow] = 1; follow = -1; tries = 0; dir = 1; }
    }
    if (next < 0) {                                                 // the strip is exhausted: the nearest cell of the front, and its newest strip
      const dLast = hopDistance(w, [last], nbr); let bk = null;
      for (let v = 0; v < nV; v++) { if (woven[v] || !wovenNbr[v]) continue; const key = [nbrSet[last].has(v) ? 0 : 1, dLast[v] < 0 ? 1e9 : dLast[v], -wovenNbr[v], v]; if (!bk || lexLess(key, bk)) { next = v; bk = key; } }
      if (next < 0) { for (let v = 0; v < nV; v++) if (!woven[v]) { next = v; break; } }
      const q0 = queue.length; takeCell(next); last = next;
      follow = nextStrand(q0); if (follow < 0) follow = nextStrand(0);                          // its own new strips first, else any strip left
      tries = 0; dir = 1; if (follow >= 0) at = startIndex(follow);
      continue;
    }
    takeCell(next); last = next;
  }
  return order;
}

/** angular coordinate of every cell around the start for the ring map */
export function ringAngles(w, nbr, start, ring) {
  const nV = w.nV, ang = new Float64Array(nV).fill(NaN), V = w.V, N = w.N;
  const nx = N[3 * start], ny = N[3 * start + 1], nz = N[3 * start + 2];
  let ex, ey, ez; if (Math.abs(nx) < 0.9) { ex = 1 - nx * nx; ey = -nx * ny; ez = -nx * nz; } else { ex = -ny * nx; ey = 1 - ny * ny; ez = -ny * nz; }
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  const fx = ny * ez - nz * ey, fy = nz * ex - nx * ez, fz = nx * ey - ny * ex;
  ang[start] = 0;
  const maxR = ring.reduce((m, r) => Math.max(m, r), 0);
  for (let r = 1; r <= maxR; r++) for (let v = 0; v < nV; v++) {
    if (ring[v] !== r) continue;
    if (r === 1) { const dx = V[3 * v] - V[3 * start], dy = V[3 * v + 1] - V[3 * start + 1], dz = V[3 * v + 2] - V[3 * start + 2]; ang[v] = Math.atan2(dx * fx + dy * fy + dz * fz, dx * ex + dy * ey + dz * ez); continue; }
    let cx = 0, cy = 0; for (const u of nbr[v]) if (ring[u] === r - 1 && Number.isFinite(ang[u])) { cx += Math.cos(ang[u]); cy += Math.sin(ang[u]); }
    ang[v] = (cx || cy) ? Math.atan2(cy, cx) : 0;
  }
  return ang;
}

/** the weaver's walk along a strand: weaver-knot q ↔ original knot index; closed strands start at `offset`, open ones
 *  may run backwards (`reversed`). Segment q joins weaver-knots q and q+1. */
function strandWalk(w, si, offset, reversed) {
  const s = w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1;
  const knotAt = (q) => s.closed ? (((q + offset) % K) + K) % K : (reversed ? K - 1 - q : q);
  const segAt = (q) => s.closed ? (((q + offset) % K) + K) % K : (reversed ? nseg - 1 - q : q);   // original segment index of weaver-segment q
  const segLen = (q) => { const [t, k] = s.segs[segAt(q)]; return w.segLen[3 * t + k]; };
  const segCell = (q) => { const [t, k] = s.segs[segAt(q)]; return w.F[3 * t + k]; };
  return { K, nseg, knotAt, segAt, segLen, segCell, closed: s.closed };
}

/** cut one strand into pieces. Returns [{q0, q1}] in weaver-knot indices (inclusive; q1 may exceed K−1 on a closed
 *  strand to wrap), overlapping by `overlap` crossings. maxL in model units (0 = never cut). */
function cutStrand(w, walk, maxL, overlap, distribution, singularSeg) {
  const { K, nseg, closed } = walk;
  if (K < 2) return [{ q0: 0, q1: K - 1 }];
  // arc position of weaver-knot q (knot 0 at 0) and of the cut after weaver-knot q (the middle of segment q)
  const arc = new Float64Array(K + 1); for (let q = 0; q < nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
  const cutAfter = (q) => q < nseg ? arc[q] + walk.segLen(q) / 2 : arc[q];     // open: the last cut is the end itself
  const cutBefore = (q) => q > 0 ? arc[q] - walk.segLen(q - 1) / 2 : 0;
  const total = closed ? arc[K] : arc[K - 1];
  if (!(maxL > 0) || total <= maxL) return [{ q0: 0, q1: K - 1 }];
  const lastQ = closed ? K - 1 + overlap : K - 1;                              // a closed strand's last piece overlaps the first
  const okCut = (q) => !singularSeg(((q % K) + K) % K);
  const lenOf = (q0, q1) => (q1 < K ? cutAfter(q1) : arc[K] + cutAfter(q1 - K)) - cutBefore(q0);
  const pieces = []; let a = 0;
  if (distribution === 'even') {
    let n = 1;
    for (;;) {
      const per = Math.ceil((lastQ + 1 + (n - 1) * overlap) / n); let fits = true, a2 = 0;
      for (let p = 0; p < n; p++) { const b = Math.min(a2 + per - 1, lastQ); if (lenOf(a2, b) > maxL) { fits = false; break; } a2 = b - overlap + 1; }
      if (fits || n > K) break; n++;
    }
    const per = Math.ceil((lastQ + 1 + (n - 1) * overlap) / n);
    for (let p = 0; p < n; p++) {
      let b = p === n - 1 ? lastQ : Math.min(a + per - 1, lastQ);
      if (p < n - 1) for (const d of [0, -1, -2, 1]) if (b + d > a + overlap && b + d < lastQ && okCut(b + d)) { b += d; break; }
      pieces.push({ q0: a, q1: b }); a = b - overlap + 1; if (a > lastQ) break;
    }
  } else {
    for (;;) {
      let b = a; while (b + 1 <= lastQ && lenOf(a, b + 1) <= maxL) b++;
      if (b < lastQ) for (const d of [0, -1, -2]) if (b + d > a + overlap && okCut(b + d)) { b += d; break; }
      pieces.push({ q0: a, q1: b });
      if (b >= lastQ) break;
      a = Math.max(b - overlap + 1, pieces[pieces.length - 1].q0 + 1);
    }
  }
  for (const p of pieces) p.q1 = Math.min(p.q1, lastQ);
  // the even split counts crossings, so a piece of long segments can still run over: fall back to the greedy cut
  if (distribution === 'even' && pieces.some(p => lenOf(p.q0, p.q1) > maxL * 1.001)) return cutStrand(w, walk, maxL, overlap, 'start', singularSeg);
  return pieces;
}

/** Everything the viewer and the tutorial need for one weave.
 *  opts: {start, rule, strategy, maxLength (model units, 0 = no cut), overlap (crossings), distribution ('start' | 'even'), hold (crossings)} */
export function planWeave(w, opts = {}) {
  const nbr = neighbours(w), nS = w.strands.length;
  const auto = chooseStart(w, nbr, opts.rule || 'half');
  // several weavers (opts.starts, one cell each): every cell to the nearest start, the tours interleaved (multiTour)
  const starts = Array.isArray(opts.starts) && opts.starts.length > 1 ? opts.starts.filter(v => Number.isInteger(v) && v >= 0 && v < w.nV) : null;
  // the strip rule (one woven part per strip): `follow` lattice edges — a strip woven up to closer than that is followed
  // before the cell is woven (0: never wait, always a new strip and a joint); `strips: 'shared'` = the earlier cell tour
  const strict = opts.strips !== 'shared', follow = Number.isFinite(opts.follow) && opts.follow >= 0 ? opts.follow : 4;
  const fan = cellFans(w), guard = strict ? strandGuard(w, fan, Math.round(2 * follow), opts.gap ?? 0) : null;
  const multi = starts && starts.length > 1 ? multiTour(w, nbr, starts, guard) : null;
  const start = multi ? starts[0] : Number.isInteger(opts.start) && opts.start >= 0 && opts.start < w.nV ? opts.start : auto.cell;
  // the rings of the tour: lattice edges from the start cell — from the whole rim when the start lies on one (18 Nov: the
  // tour then goes round the rim first and the weave is a closed band from its first ring on, as ring to ring does; from
  // the one cell it was an arc that met itself on the far side). opts.rimRing === false: from the cell, as before.
  // Only where the rim is the end of a tube — the next two rings are closed bands of the rim's own size (0.9 … 1.15 ×):
  // the outline of a cone or of an open surface is not a loop round anything, its rings shrink towards the middle.
  const rimLoop = (v) => { const loop = [v], seen = new Set(loop); for (let q = 0; q < loop.length; q++) for (const u of nbr[loop[q]]) if (w.boundary[u] && !seen.has(u)) { seen.add(u); loop.push(u); } return loop; };
  const tubeEnd = (loop) => {
    const d = hopDistance(w, loop, nbr);
    for (const k of [1, 2]) { const cells = []; for (let v = 0; v < w.nV; v++) if (d[v] === k) cells.push(v); if (cells.length < 0.9 * loop.length || cells.length > 1.15 * loop.length) return null;
      const seen = new Set([cells[0]]), st = [cells[0]]; while (st.length) { const x = st.pop(); for (const u of nbr[x]) if (d[u] === k && !seen.has(u)) { seen.add(u); st.push(u); } } if (seen.size !== cells.length) return null; }
    return d;
  };
  const rimRing = !multi && opts.rimRing !== false && w.boundary[start] ? tubeEnd(rimLoop(start)) : null, fromRim = !!rimRing;
  // (opts.levels: the rings given — from a loop round a handle, one way round: algorithms.js, the start rule "loop")
  const given = !multi && opts.levels && opts.levels.length === w.nV ? opts.levels : null;
  const ring = multi ? multi.ring : given || rimRing || hopDistance(w, [start], nbr);
  const owner = multi ? multi.owner : null, K = multi ? starts.length : 1;
  const maxL = opts.maxLength > 0 ? opts.maxLength : 0, overlap = Math.max(0, Math.min(6, opts.overlap | 0)), distribution = opts.distribution === 'even' ? 'even' : 'start', hold = Math.max(1, (opts.hold | 0) || 4);
  // provisional pieces (natural indexing) for the cost of new strips while ordering
  const provisional = w.strands.map((s, si) => { const walk = strandWalk(w, si, 0, 0); const pcs = cutStrand(w, walk, maxL, overlap, distribution, () => false); const of = new Int32Array(s.knots.length); pcs.forEach((p, k) => { for (let q = p.q0; q <= p.q1; q++) of[walk.knotAt(q)] = k; }); return of; });
  const provPiece = (si, i) => si * 4096 + provisional[si][i];
  // what is begun is finished — the limbs of the shape (ears, branches) and the holes the weave closes round — unless
  // opts.finish === false (the tour as it was until 17 Nov: the rings from the start only)
  const limbsOf = opts.finish !== false && !multi ? (w._limbs || (w._limbs = limbs(w, nbr))) : null;
  const tour = multi ? multi.order : cellOrder(w, nbr, start, ring, opts.strategy || 'spiral', provPiece, auto.singular, guard, limbsOf);

  // --- the fan of every cell: its ring crossings and the opposite crossing of each of its triangles. A crossing is made at
  //     the first cell (in the order) whose fan holds it: building a cell weaves its strips through each other completely,
  //     ring and free ends alike (Design update 3: "it intersects each lath, but it is not woven") ------------------------
  const nE = w.nE, cellIdx = new Int32Array(w.nV).fill(-1), knotCell = new Int32Array(nE).fill(-1), rim = new Uint8Array(nE);
  for (let e = 0; e < nE; e++) if (w.edgeTris[e].length < 2) rim[e] = 1;
  const assign = (list) => { cellIdx.fill(-1); knotCell.fill(-1); list.forEach((v, k) => { cellIdx[v] = k; }); for (const v of list) for (const e of fan[v]) if (knotCell[e] < 0 || cellIdx[v] < knotCell[e]) knotCell[e] = cellIdx[v]; };
  assign(tour);
  // a cell whose fan is woven entirely by earlier cells has nothing to do: it is left out of the tour unless asked to
  // stay as a checkpoint (the ownership of the crossings does not change)
  const skipEmpty = opts.skipEmpty !== false;
  const order = skipEmpty ? tour.filter((v, k) => fan[v].some(e => knotCell[e] === k)) : tour;
  const skipped = tour.length - order.length;
  if (skipEmpty) assign(order);
  // --- strands numbered by first use; the weaver's walk starts at the first-woven crossing ------------------------------
  const firstCell = new Int32Array(nS).fill(1e9), offset = new Int32Array(nS), reversed = new Uint8Array(nS);
  const cuts = strict ? w.strands.map((s, si) => cutByTimes(w, si, knotCell, maxL, overlap)) : null;   // the strips by when the tour makes their crossings
  w.strands.forEach((s, si) => {
    let best = 1e9, bestI = 0;
    s.knots.forEach((e, i) => { if (knotCell[e] < best) { best = knotCell[e]; bestI = i; } });
    firstCell[si] = best;
    if (cuts) { offset[si] = cuts[si].offset; reversed[si] = cuts[si].reversed; }
    else if (s.closed) offset[si] = bestI; else reversed[si] = bestI > (s.knots.length - 1) / 2 ? 1 : 0;
  });
  const strandRank = [...Array(nS).keys()].sort((a, b) => firstCell[a] - firstCell[b] || b - a);
  const label = new Int32Array(nS); strandRank.forEach((si, r) => { label[si] = r + 1; });
  const walks = w.strands.map((s, si) => strandWalk(w, si, offset[si], reversed[si]));
  /** tick number of knot index i of strand si, 1-based, along the weaver's walk */
  const tick = (si, i) => { const s = w.strands[si], K = s.knots.length; return s.closed ? ((i - offset[si] + K) % K) + 1 : (reversed[si] ? K - i : i + 1); };
  // --- pieces -----------------------------------------------------------------------------------------------------------
  const pieces = [], pieceList = [];                                            // pieces[si] per strand; pieceList: every piece
  const sing = (walk) => (q) => { const v = walk.segCell(q); return !w.boundary[v] && w.valence[v] !== 6; };
  let shortJoints = 0;
  w.strands.forEach((s, si) => {
    const walk = walks[si], K = walk.K;
    // strict: own crossings [lo, hi] and the joint's overlap beyond them (ovTail / ovHead: laid over the strip it is joined
    // to — not woven by this strip); shared: consecutive pieces share the overlap, both woven through it
    const pcs = cuts ? cuts[si].pieces.map(c => ({ q0: c.lo - c.ovTail, q1: c.hi + c.ovHead, ovTail: c.ovTail, ovHead: c.ovHead, born: c.born, underTail: !!c.underTail, underHead: !!c.underHead }))
      : cutStrand(w, walk, maxL, overlap, distribution, sing(walk)).map(c => ({ q0: c.q0, q1: c.q1, ovTail: 0, ovHead: 0, born: 0 }));
    if (cuts) shortJoints += cuts[si].short;
    const pieceOfKnot = new Int32Array(K).fill(-1), pieceOfKnot2 = new Int32Array(K).fill(-1);   // the strip woven through a knot, and the one laid over it in a joint
    const pieceOfSeg = new Int32Array(Math.max(walk.nseg, 0)).fill(-1), overlapSeg = new Uint8Array(Math.max(walk.nseg, 0));
    const arc = new Float64Array(K + 1); for (let q = 0; q < walk.nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
    const total = arc[s.closed ? K : K - 1];
    const arcAt = (q) => (s.closed ? Math.floor(q / K) * total + arc[((q % K) + K) % K] : arc[Math.max(0, Math.min(K - 1, q))]);   // arc position of weaver-knot q (wrapping on a closed strand)
    const cutBefore = (q) => arcAt(q) - (s.closed || q > 0 ? walk.segLen(q - 1) / 2 : 0), cutAfter = (q) => arcAt(q) + (s.closed || q < K - 1 ? walk.segLen(q) / 2 : 0);
    // numbered by when they are threaded (strict), along the walk (shared)
    const nth = pcs.map((c, k) => k); if (cuts) { const byBirth = pcs.map((c, k) => k).sort((x, y) => (pcs[x].born - pcs[y].born) || (pcs[x].q0 - pcs[y].q0)); byBirth.forEach((k, n) => { nth[k] = n; }); }
    const info = pcs.map((p, k) => {
      const knots = []; for (let q = p.q0; q <= p.q1; q++) knots.push(walk.knotAt(q));
      const a0 = cutBefore(p.q0), a1 = cutAfter(p.q1), len = a1 - a0, n = knots.length;
      let introCell = 1e9; knots.forEach((i, m) => { if (m >= p.ovTail && m < n - p.ovHead) introCell = Math.min(introCell, knotCell[s.knots[i]]); });
      const id = pieceList.length;
      const rec = { id, strand: si, p: k, q0: p.q0, q1: p.q1, ovTail: p.ovTail, ovHead: p.ovHead, underTail: !!p.underTail, underHead: !!p.underHead, knots, introCell, intro: -1, length: len, label: pcs.length > 1 ? `S${label[si]}.${nth[k] + 1}` : `S${label[si]}`,
        edges: knots.map(i => s.knots[i]), overs: knots.map(i => w.over(si, i)),   // the crossing of every knot of the piece, and whether the piece goes over there
        arcOf: (m) => arcAt(p.q0 + m) - a0 };                                   // arc position of the piece's m-th crossing from its start
      pieceList.push(rec); return rec;
    });
    if (cuts) {
      info.forEach((pc, k) => pc.knots.forEach((i, m) => { if (m >= pc.ovTail && m < pc.knots.length - pc.ovHead && pieceOfKnot[i] < 0) pieceOfKnot[i] = k; }));
      info.forEach((pc, k) => pc.knots.forEach((i, m) => { if (!(m >= pc.ovTail && m < pc.knots.length - pc.ovHead) && pieceOfKnot2[i] < 0 && pieceOfKnot[i] !== k) pieceOfKnot2[i] = k; }));
    } else pcs.forEach((p, k) => { for (let q = p.q0; q <= p.q1; q++) { const i = walk.knotAt(q); if (pieceOfKnot[i] < 0) pieceOfKnot[i] = k; else pieceOfKnot2[i] = k; } });
    for (let q = 0; q < walk.nseg; q++) {
      const m = walk.segAt(q), owners = [];
      pcs.forEach((p, k) => { if ((q >= p.q0 && q + 1 <= p.q1) || (s.closed && ((q + K >= p.q0 && q + K + 1 <= p.q1) || (q - K >= p.q0 && q - K + 1 <= p.q1)))) owners.push(k); });
      pieceOfSeg[m] = owners.length ? owners[0] : Math.max(0, pieceOfKnot[walk.knotAt(q)]);
      overlapSeg[m] = owners.length > 1 ? 1 : 0;
    }
    pieces.push({ nPieces: pcs.length, pieceOfKnot, pieceOfKnot2, pieceOfSeg, overlapSeg, pieceLen: Float64Array.from(info.map(x => x.length)), length: total, list: info, walk });
  });
  const pieceLabel = (si, i) => { const p = pieces[si], k = Math.max(0, p.pieceOfKnot[i]); return p.nPieces > 1 ? `S${label[si]}.${k + 1}` : `S${label[si]}`; };
  const pieceAt = (si, i) => pieces[si].list[Math.max(0, pieces[si].pieceOfKnot[i])];
  /** every piece passing a crossing: the primary piece of each strand pass, and the second one inside a joint */
  const knotPieces = (e) => { const out = []; for (const [si, i] of w.knotStrands[e]) { const P = pieces[si]; out.push(P.list[Math.max(0, P.pieceOfKnot[i])]); if (!strict && P.pieceOfKnot2[i] >= 0) out.push(P.list[P.pieceOfKnot2[i]]); } return out; };
  const isOwn = (pc, m) => m >= pc.ovTail && m < pc.knots.length - pc.ovHead;   // a crossing the strip is woven through (not the overlap of a joint)
  /** the passes of piece pc through crossing e: [{si, i, m}] with m the index along the piece (two for a strip crossing itself) */
  const passes = (pc, e) => { const out = []; for (const [si, i] of w.knotStrands[e]) { if (si !== pc.strand) continue; let m = -1; for (let x = pc.ovTail; x < pc.knots.length - pc.ovHead; x++) if (pc.knots[x] === i) { m = x; break; } if (m >= 0) out.push({ si, i, m }); } return out; };
  // --- sub-steps: for every cell — "continue" the marching strip (the strip added last that runs on through this cell),
  //     "lay" the other crossings between strips already in hand, then "add" every new strip in turn, threaded through
  //     the strips in hand at the crossings of the cell's fan in its weaving direction (toward the crossing made next);
  //     the last sub-step of the cell closes it. Crossings get fractional sub-steps (ticks) in their order. --------------------
  const flip = opts.flip instanceof Set ? opts.flip : new Set();
  const steps = [], knotStep = new Float64Array(nE).fill(-1), stepOf = new Int32Array(w.nV).fill(-1), cellSteps = [];
  const inHand = new Uint8Array(pieceList.length);
  const frame = (c) => { const nx = w.N[3 * c], ny = w.N[3 * c + 1], nz = w.N[3 * c + 2]; let ex, ey, ez; if (Math.abs(nx) < 0.9) { ex = 1 - nx * nx; ey = -nx * ny; ez = -nx * nz; } else { ex = -ny * nx; ey = 1 - ny * ny; ez = -ny * nz; } const l = Math.hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l; return [ex, ey, ez, ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex]; };
  const angleAround = (c, e) => { const f = frame(c), dx = w.edgeMid[3 * e] - w.V[3 * c], dy = w.edgeMid[3 * e + 1] - w.V[3 * c + 1], dz = w.edgeMid[3 * e + 2] - w.V[3 * c + 2]; return Math.atan2(dx * f[3] + dy * f[4] + dz * f[5], dx * f[0] + dy * f[1] + dz * f[2]); };
  // the joints (strict): a strip threaded at the end of the one before is joined first — its end pushed through that
  // strip's last woven crossings, then it is woven on (a tick before its first crossing); where two woven parts meet, the
  // end is pushed in once both are woven up to there (a tick after the crossing that completes it)
  const jointsFirst = new Map(), jointsLast = [];
  if (strict) for (const pc of pieceList) {
    const s = w.strands[pc.strand], n = pc.knots.length; if (!pc.ovTail && !pc.ovHead) continue;
    let mFirst = -1; for (let m = pc.ovTail; m < n - pc.ovHead; m++) if (mFirst < 0 || knotCell[s.knots[pc.knots[m]]] < knotCell[s.knots[pc.knots[mFirst]]]) mFirst = m;
    for (const [nOv, zone, mEnd] of [[pc.ovTail, [...Array(pc.ovTail).keys()], pc.ovTail], [pc.ovHead, [...Array(pc.ovHead).keys()].map(x => n - pc.ovHead + x), n - pc.ovHead - 1]]) {
      if (!nOv) continue;
      const P = pieces[pc.strand], other = P.list[Math.max(0, P.pieceOfKnot[pc.knots[zone[0]]])];
      const J = { piece: pc, other, n: nOv, tail: zone[0] === 0, under: zone[0] === 0 ? !!pc.underTail : !!pc.underHead, e: s.knots[pc.knots[mEnd > zone[0] ? zone[zone.length - 1] : zone[0]]], need: [...zone.map(m => s.knots[pc.knots[m]]), s.knots[pc.knots[mEnd]]] };
      J.ms = J.tail ? zone.slice().reverse() : zone.slice();           // overlap 1 … n: from the other strip's end into its woven part (the way the end is pushed in)
      // (a strip with a single crossing of its own between two joints: one end is threaded in first, the crossing is made, the other end is laid last)
      if (mFirst === mEnd && !jointsFirst.has(pc.id) && knotCell[J.need[J.need.length - 1]] >= Math.max(...zone.map(m => knotCell[s.knots[pc.knots[m]]]))) jointsFirst.set(pc.id, [J]);
      else jointsLast.push(J);
    }
  }
  /** the ticks of a joint: one per crossing of the overlap, in the order the end is pushed in (Ji, update 5: "overlap 1 …
   *  overlap 4", each with its own under / over); a rim end is no crossing */
  const overlapTicks = (J) => { const s = w.strands[J.piece.strand], out = J.ms.map((m, x) => ({ J, m, idx: x + 1 })).filter(t => !rim[s.knots[J.piece.knots[t.m]]]); if (out.length) out[0].first = true; return out; };
  const pushStep = (st, knots) => {
    st.k = steps.length;
    if (jointsLast.length) {                                           // the joints this sub-step completes
      const now = new Set(knots.filter(e => typeof e === 'number'));
      for (let j = jointsLast.length - 1; j >= 0; j--) { const J = jointsLast[j]; if (J.need.every(e => knotStep[e] >= 0 || now.has(e)) && J.need.some(e => now.has(e))) { knots = [...knots, ...overlapTicks(J)]; jointsLast.splice(j, 1); } }
    }
    st.knotIds = knots; st.nTicks = knots.length;
    knots.forEach((e, i) => { if (typeof e === 'number') knotStep[e] = st.k + (i + 1) / (knots.length + 1); });
    steps.push(st); return st;
  };
  const madeIndices = (pc) => { const s = w.strands[pc.strand], out = []; pc.knots.forEach((i, m) => { if (isOwn(pc, m) && knotStep[s.knots[i]] >= 0) out.push(m); }); return out; };
  /** the threading direction of piece pc for the crossings at indices ms: toward the crossing made next (the side woven
   *  sooner in the order); if both sides are done, the end with less length to pull through */
  const threadDir = (pc, ms, ci) => {
    const s = w.strands[pc.strand], mFirst = Math.min(...ms), mLast = Math.max(...ms);
    let ahead = 1e9, behind = 1e9;
    pc.knots.forEach((i, m) => { if (!isOwn(pc, m)) return; const kc = knotCell[s.knots[i]]; if (kc <= ci) return; if (m > mLast) ahead = Math.min(ahead, kc); else if (m < mFirst) behind = Math.min(behind, kc); });
    if (ahead < 1e9 || behind < 1e9) return ahead <= behind ? 1 : -1;
    const before = pc.arcOf(mFirst), after = pc.length - pc.arcOf(mLast); return after <= before ? 1 : -1;
  };
  const orderAlong = (pc, es, dir) => es.map(e => ({ e, m: Math.min(...passes(pc, e).map(ps => ps.m)) })).sort((a, b) => dir * (a.m - b.m)).map(x => x.e);
  for (let ci = 0; ci < order.length; ci++) {
    const c = order[ci], E = fan[c].filter(e => knotCell[e] === ci), base = { cell: c, cellIdx: ci, ring: ring[c], valence: w.valence[c], rim: !!w.boundary[c], weaver: owner ? owner[c] : 0 };
    const first = steps.length, made = new Set();
    // the new strips of this cell, in the order their strands appear around it (pieces of one strand in walk order)
    const ringRank = new Map(); w.cellSegs[c].forEach(([t, kk], j) => { const si = w.segStrand[3 * t + kk]; if (!ringRank.has(si)) ringRank.set(si, j); });
    const fresh = [];
    for (const e of E) for (const pc of knotPieces(e)) if (!inHand[pc.id] && !fresh.includes(pc)) fresh.push(pc);
    fresh.sort((a, b) => ((ringRank.get(a.strand) ?? 99) - (ringRank.get(b.strand) ?? 99)) || (a.strand - b.strand) || (a.p - b.p));
    const inHandE = E.filter(e => knotPieces(e).every(pc => inHand[pc.id]));
    // 1. the marching strip: among the strips whose crossings here continue their woven part, the one most of these
    //    crossings lie on — the weave direction of the cell runs along it (Ji, update 5: the capped cylinder's step 17,
    //    where the strip added last had one crossing and the strip beside it four); the strip added last on a tie
    let march = null, marchKnots = [];
    { const cands = new Map(); for (const e of inHandE) for (const pc of knotPieces(e)) cands.set(pc.id, pc);
      for (const pc of cands.values()) {
        const mine = inHandE.filter(e => passes(pc, e).length); if (!mine.length) continue;
        const done = new Set(madeIndices(pc)), ms = mine.flatMap(e => passes(pc, e).map(ps => ps.m));
        if (!ms.some(m => done.has(m - 1) || done.has(m + 1))) continue;
        if (!march || (strict && mine.length > marchKnots.length) || ((!strict || mine.length === marchKnots.length) && pc.intro > march.intro)) { march = pc; marchKnots = mine; }   // (the earlier tour, `strips: 'shared'`: the strip added last, as it was)
      } }
    // 2. the other crossings between strips already in hand (and the rim ends of strips in hand), around the cell — made
    //    inside the strip sub-step of the cell (the marching strip, else the first new strip) when there is one, so a
    //    cell is one event (Design update 6): each such crossing comes right after the strip has passed both strips of
    //    it (the later of its crossings with them; the nearer one when it passes neither); a sub-step of their own otherwise
    const lay = inHandE.filter(e => !marchKnots.includes(e)).sort((a, b) => angleAround(c, a) - angleAround(c, b));
    let layLead = [];
    if (lay.length) { if (march || fresh.length) layLead = lay; else pushStep({ ...base, kind: 'lay', piece: null, newPieces: [], closes: false }, lay); for (const e of lay) made.add(e); }
    const dist = (e, f) => Math.hypot(w.edgeMid[3 * e] - w.edgeMid[3 * f], w.edgeMid[3 * e + 1] - w.edgeMid[3 * f + 1], w.edgeMid[3 * e + 2] - w.edgeMid[3 * f + 2]);
    const weave = (pc, ordered, lays) => {                                        // the strip's crossings with the in-hand crossings slotted in
      const out = ordered.slice();
      for (const e of lays) {
        const ids = new Set(knotPieces(e).map(q => q.id)); let at = -1;
        ordered.forEach((f, k) => { if (knotPieces(f).some(q => q.id !== pc.id && ids.has(q.id))) at = Math.max(at, out.indexOf(f)); });
        if (at < 0 && ordered.length) { let best = Infinity; ordered.forEach((f) => { const d = dist(e, f); if (d < best) { best = d; at = out.indexOf(f); } }); }
        out.splice(at + 1, 0, e);
      }
      return strict ? inOrder(pc, ordered, out) : out;
    };
    /** the same crossings in an order every strip can follow: the strip in hand along itself (as given), and each strip it
     *  meets from its own woven end outward, crossing after crossing — so a strip crossed in this sub-step is not woven
     *  at its far crossing before the ones between (the strip rule inside a cell). */
    const inOrder = (pc, ordered, out) => {
      if (out.length < 3) return out;
      const pos = new Map(out.map((e, k) => [e, k])), after = new Map(out.map(e => [e, []])), need = new Map(out.map(e => [e, 0]));
      const link = (a, b) => { after.get(a).push(b); need.set(b, need.get(b) + 1); };
      for (let k = 1; k < ordered.length; k++) link(ordered[k - 1], ordered[k]);
      const others = new Map(); for (const e of out) for (const q of knotPieces(e)) if (q.id !== pc.id) others.set(q.id, q);
      for (const q of others.values()) {
        const done = madeIndices(q), lo = done.length ? Math.min(...done) : 0, hi = done.length ? Math.max(...done) : -1, mine = []; let twice = false;
        // (a strip that crosses itself here passes the crossing twice: the pass beyond its woven part is the one being woven)
        for (const e of out) { const ps = passes(q, e); if (!ps.length) continue; const beyond = ps.filter(x => x.m > hi || x.m < lo); if (ps.length > 1 && (!done.length || beyond.length !== 1)) { twice = true; continue; } mine.push({ e, m: (beyond[0] || ps[0]).m }); }
        if ((twice && !done.length) || mine.length < 2) continue;
        mine.sort((x, y) => x.m - y.m);
        if (done.length) {                                              // from its woven part outward, on either side
          const up = mine.filter(x => x.m > hi), down = mine.filter(x => x.m < lo).reverse();
          for (const chain of [up, down]) for (let k = 1; k < chain.length; k++) link(chain[k - 1].e, chain[k].e);
        } else {                                                        // not woven yet: from the crossing made first here, outward
          let seed = 0; for (let k = 1; k < mine.length; k++) if (pos.get(mine[k].e) < pos.get(mine[seed].e)) seed = k;
          for (let k = seed + 1; k < mine.length; k++) link(mine[k - 1].e, mine[k].e);
          for (let k = seed - 1; k >= 0; k--) link(mine[k + 1].e, mine[k].e);
        }
      }
      const res = [], left = new Set(out);
      while (left.size) {
        let best = null; for (const e of left) if (need.get(e) === 0 && (best === null || pos.get(e) < pos.get(best))) best = e;
        // the strips disagree (three strips round a small triangle, each coming from its own side): the crossing with the
        // fewest crossings still due before it goes first — one strip waits one crossing (G = 1), the rest keep their order
        if (best === null) for (const e of left) if (best === null || need.get(e) < need.get(best) || (need.get(e) === need.get(best) && pos.get(e) < pos.get(best))) best = e;
        res.push(best); left.delete(best); for (const f of after.get(best)) need.set(f, need.get(f) - 1);
      }
      return res;
    };
    if (march) {
      const done = madeIndices(march), ms = marchKnots.flatMap(e => passes(march, e).map(ps => ps.m));
      let dir = Math.min(...ms) > Math.max(...done) ? 1 : Math.max(...ms) < Math.min(...done) ? -1 : threadDir(march, ms, ci);
      if (flip.has(`${ci}:${march.id}`)) dir = -dir;
      // its crossings outward from its woven part — on both sides of it where the cell lies at both of its ends
      const lo = Math.min(...done), hi = Math.max(...done), away = (e) => Math.min(...passes(march, e).map(ps => (ps.m > hi ? ps.m - hi : ps.m < lo ? lo - ps.m : 0)));
      const both = ms.some(m => m > hi) && ms.some(m => m < lo), ordered = both ? orderAlong(march, marchKnots, dir).map((e, k) => ({ e, k, d: away(e) })).sort((x, y) => (x.d - y.d) || (x.k - y.k)).map(x => x.e) : orderAlong(march, marchKnots, dir);
      pushStep({ ...base, kind: 'add', cont: true, piece: march, newPieces: [], dir, closes: false, flipKey: `${ci}:${march.id}`, layIds: new Set(layLead) }, weave(march, ordered, layLead));
      layLead = [];
      for (const e of ordered) made.add(e);
    }
    // 3. every new strip in turn, through the strips in hand at the crossings of the fan
    for (const pc of fresh) {
      const mine = E.filter(e => !made.has(e) && passes(pc, e).length && knotPieces(e).every(q => q.id === pc.id || inHand[q.id]));
      inHand[pc.id] = 1; pc.intro = steps.length; pc.weaver = base.weaver;
      const ms = mine.flatMap(e => passes(pc, e).map(ps => ps.m));
      let dir = ms.length ? threadDir(pc, ms, ci) : 1;
      if (flip.has(`${ci}:${pc.id}`)) dir = -dir;
      const ordered = orderAlong(pc, mine, dir);
      pushStep({ ...base, kind: 'add', cont: false, piece: pc, newPieces: [pc], dir, closes: false, flipKey: `${ci}:${pc.id}`, layIds: new Set(layLead) }, [...(jointsFirst.get(pc.id) || []).filter(J => { const ready = J.need.slice(0, -1).every(e => knotStep[e] >= 0); if (!ready) jointsLast.push(J); return ready; }).flatMap(overlapTicks), ...weave(pc, ordered, layLead)]);   // the joint first — unless the strip it lies on is still being woven there in this cell: then when that is done
      layLead = [];
      for (const e of ordered) made.add(e);
    }
    if (made.size !== E.length) throw new Error(`cell ${c}: ${E.length - made.size} crossings of the fan not made`);
    // 4. a cell already woven by its neighbours (kept in the tour as a checkpoint) gets an empty closing sub-step
    if (steps.length === first) pushStep({ ...base, kind: 'close', piece: null, newPieces: [], closes: true }, []);
    const last = steps[steps.length - 1]; last.closes = true; stepOf[c] = last.k; cellSteps.push(last.k);
    for (let k = first; k < steps.length; k++) { steps[k].first = first; steps[k].groupNew = fresh; steps[k].last = last.k; }
  }
  // 5. the finished weave: every strip in its full colour
  steps.push({ k: steps.length, kind: 'done', cell: -1, cellIdx: order.length, ring: -1, valence: 0, rim: false, piece: null, newPieces: [], closes: false, knotIds: [], nTicks: 0, first: steps.length, last: steps.length, groupNew: [], dir: 1, weaver: -1 });
  // a cell left out of the tour is closed when the last crossing of its fan is made
  for (let v = 0; v < w.nV; v++) if (stepOf[v] < 0) { let k = 0; for (const e of fan[v]) k = Math.max(k, Math.floor(knotStep[e])); stepOf[v] = k; }
  const nSteps = steps.length;
  // --- clips: a strip holds after `hold` crossings; a crossing is clipped until both strips through it hold --------------
  for (const pc of pieceList) { const st = pc.knots.filter((i, m) => isOwn(pc, m)).map(i => knotStep[w.strands[pc.strand].knots[i]]).sort((a, b) => a - b); pc.holdStep = st[Math.min(hold, st.length) - 1]; pc.lastStep = st[st.length - 1]; }
  const lockStep = new Float64Array(nE).fill(-1);
  for (let e = 0; e < nE; e++) {
    if (rim[e] || w.knotStrands[e].length !== 2) { lockStep[e] = knotStep[e]; continue; }
    const [[sa, ia], [sb, ib]] = w.knotStrands[e];
    lockStep[e] = Math.max(pieceAt(sa, ia).holdStep, pieceAt(sb, ib).holdStep, knotStep[e]);
  }
  // --- what every sub-step asks: the crossings in order with over / under, clips on and off ------------------------------
  let clipsNow = 0;
  const releaseAt = Array.from({ length: nSteps }, () => []);
  for (let e = 0; e < nE; e++) if (!rim[e] && lockStep[e] > knotStep[e]) releaseAt[Math.min(nSteps - 1, Math.floor(lockStep[e]))].push(e);
  const describeKnot = (e, st, i) => {
    const k = st.k, [a, b] = w.edges[e], isNew = Math.floor(knotStep[e]) === k, locked = lockStep[e] < k + 1;
    let over = -1, under = -1, overI = -1, underI = -1, self = false, pcOver = null, pcUnder = null;
    if (!rim[e] && w.knotStrands[e].length === 2) { const [[sa, ia], [sb, ib]] = w.knotStrands[e]; self = pieceAt(sa, ia).id === pieceAt(sb, ib).id; if (w.over(sa, ia)) { over = sa; overI = ia; under = sb; underI = ib; } else { over = sb; overI = ib; under = sa; underI = ia; } pcOver = pieceAt(over, overI); pcUnder = pieceAt(under, underI); }
    const q = { e, isNew, locked, rim: !!rim[e], over, under, overI, underI, self, pcOver, pcUnder, tick: i, at: knotStep[e], clip: isNew && !locked && !rim[e], release: !isNew && Math.floor(lockStep[e]) === k && !rim[e], cells: [a, b] };
    const isLay = st.kind === 'lay' || (st.kind === 'add' && !!st.layIds && st.layIds.has(e));   // a crossing between strips in hand
    q.lay = st.kind === 'add' && isLay;
    if (st.kind === 'add' && !isLay) { const mine = st.piece, ps = passes(mine, e); q.pos = ps.length ? Math.min(...ps.map(x => x.m)) : -1; }   // the crossing's index along the strip
    else q.pos = -1;
    if (st.kind === 'add' && !isLay && !q.rim) { const mine = st.piece; q.goesOver = pcOver && pcOver.id === mine.id && !(pcUnder && pcUnder.id === mine.id && self); q.partner = self ? mine : (pcOver && pcOver.id === mine.id ? pcUnder : pcOver); }
    if (isLay) {                                                               // the latest strip in hand is the subject: "S10 under S1" (Design update 5)
      const cands = [pcOver, pcUnder].filter(Boolean);
      q.subject = cands.length ? cands.reduce((a, b) => (b.intro > a.intro ? b : a)) : (w.knotStrands[e].length ? pieceAt(w.knotStrands[e][0][0], w.knotStrands[e][0][1]) : null);
      q.goesOver = !!(pcOver && q.subject && pcOver.id === q.subject.id); q.partner = q.subject && pcOver && pcOver.id === q.subject.id ? pcUnder : pcOver;
    }
    return q;
  };
  /** a crossing of a joint's overlap: the strip `subject` is laid on the strip it is joined to (`other`), between it and
   *  the strip crossing there (`partner`) — so it goes over or under that strip as the one beneath it does. `pos` (its
   *  index along the strip) and `dir` (−1: toward its start, +1: toward its end) when it is the strip in hand; `at`: when
   *  this crossing of the overlap is laid (the view lays the overlap crossing by crossing: pc.ovAt, pc.joinAt = the first) */
  const overlapKnot = (t, st, i, at) => {
    const J = t.J, pc = J.piece, ki = pc.knots[t.m], e = w.strands[pc.strand].knots[ki], side = J.tail ? 'tail' : 'head';
    (pc.ovAt || (pc.ovAt = {}))[t.m] = at; if (!pc.joinAt) pc.joinAt = {}; if (pc.joinAt[side] === undefined) pc.joinAt[side] = at;
    const cross = w.knotStrands[e].find(([sj, ij]) => !(sj === pc.strand && ij === ki)), partner = cross ? pieceAt(cross[0], cross[1]) : null, goesOver = !!w.over(pc.strand, ki);
    const mine = st.kind === 'add' && !!st.piece && st.piece.id === pc.id, X = cross || [-1, -1];
    return { e, tick: i, at, isNew: false, locked: true, rim: false, lay: !mine, join: true, lapUnder: !!J.under, overlap: t.idx, first: !!t.first, n: J.n, subject: pc, other: J.other, partner, goesOver, pos: mine ? t.m : -1, m: t.m, dir: J.tail ? -1 : 1,
      over: goesOver ? pc.strand : X[0], overI: goesOver ? ki : X[1], under: goesOver ? X[0] : pc.strand, underI: goesOver ? X[1] : ki, pcOver: goesOver ? pc : partner, pcUnder: goesOver ? partner : pc, self: false,
      cells: w.edges[e], clip: false, release: false };
  };
  for (const st of steps) {
    const k = st.k;
    st.knots = st.knotIds.map((e, i) => (typeof e === 'number' ? describeKnot(e, st, i) : overlapKnot(e, st, i, k + (i + 1) / (st.knotIds.length + 1))));
    const own = new Set(st.knotIds.filter(e => typeof e === 'number'));
    st.released = releaseAt[k].filter(e => !own.has(e));
    st.nClip = st.knots.filter(q => q.clip).length; st.nRel = st.knots.filter(q => q.release).length + st.released.length; clipsNow += st.nClip - st.nRel; st.clipsNow = clipsNow;
    st.nNewCross = st.knots.filter(q => !q.rim && !q.join).length; st.nJoin = st.knots.filter(q => q.join && q.first).length; st.nOverlap = st.knots.filter(q => q.join).length;
    st.sameFamily = st.closes && !st.rim && st.valence < 6;                     // ⋈: around a cell under six, strips of one family cross
    st.selfCross = st.knots.some(q => q.self);
  }
  // --- bends and twists per piece (how often the material is bent at a crossing, how much the surface turns under it) -----
  for (const pc of pieceList) {
    const s = w.strands[pc.strand]; let curv = 0, twist = 0;
    for (let j = 1; j + 1 < pc.knots.length; j++) {
      const e0 = s.knots[pc.knots[j - 1]], e1 = s.knots[pc.knots[j]], e2 = s.knots[pc.knots[j + 1]];
      curv += Math.acos(Math.max(-1, Math.min(1, dot3(dir3(w.edgeMid, e0, e1), dir3(w.edgeMid, e1, e2))))) * 180 / Math.PI;
    }
    for (let j = 1; j < pc.knots.length; j++) { const e0 = s.knots[pc.knots[j - 1]], e1 = s.knots[pc.knots[j]]; twist += Math.acos(Math.max(-1, Math.min(1, w.edgeNrm[3 * e0] * w.edgeNrm[3 * e1] + w.edgeNrm[3 * e0 + 1] * w.edgeNrm[3 * e1 + 1] + w.edgeNrm[3 * e0 + 2] * w.edgeNrm[3 * e1 + 2]))) * 180 / Math.PI; }
    pc.bends = pc.knots.length; pc.curvature = curv; pc.twist = twist;
  }
  // --- the singularity map / path ------------------------------------------------------------------------------------------
  const ang = ringAngles(w, nbr, start, ring);
  const singular = auto.singular.map(v => ({ cell: v, valence: w.valence[v], ring: ring[v], step: stepOf[v], angle: ang[v] })).sort((p, q) => p.step - q.step);
  const maxRing = ring.reduce((m, r) => Math.max(m, r), 0);
  const totalLen = w.strandLen.reduce((a, b) => a + b, 0);
  const jumps = order.reduce((n, v, i) => n + (i > 0 && !nbr[order[i - 1]].includes(v) ? 1 : 0), 0);
  const maxClips = steps.reduce((m, s) => Math.max(m, s.clipsNow), 0), newStripEvents = steps.filter(s => s.kind === 'add').length;
  const ringSize = {}; for (let v = 0; v < w.nV; v++) ringSize[ring[v]] = (ringSize[ring[v]] || 0) + 1;
  for (const pc of pieceList) if (pc.weaver === undefined) pc.weaver = 0;
  // several weavers: one path each, through its cells in its order (the view draws them in the weaver's colour)
  const paths = multi ? starts.map((s0, i) => order.filter(v => owner[v] === i).map(v => ({ cell: v, k: stepOf[v] }))) : undefined;
  return { start, starts: multi ? starts : [start], K, owner, paths, autoStart: auto.cell, startScores: auto.scores, k: auto.k, ring, maxRing, ringSize, order, tour, skipped, cellIdx, stepOf, cellSteps, knotStep, knotCell, lockStep, rim, fan, steps, nSteps,
    label, tick, pieces, pieceList, pieceLabel, pieceAt, firstCell, offset, reversed, strandRank, singular, ang, nbr, totalLen, nPiecesAll: pieceList.length,
    maxLength: maxL, overlap, distribution, hold, strategy: opts.strategy || 'spiral', jumps, maxClips, newStripEvents,
    strips: strict ? 'own' : 'shared', follow, limbs: limbsOf, fromRim: !!fromRim, fromLoop: !!given, forced: guard ? guard.forced : 0, shortJoints, joints: steps.reduce((n, st) => n + (st.nJoin || 0), 0) };
}

const dir3 = (M, e0, e1) => { const d = [M[3 * e1] - M[3 * e0], M[3 * e1 + 1] - M[3 * e0 + 1], M[3 * e1 + 2] - M[3 * e0 + 2]], l = Math.hypot(...d) || 1; return d.map(x => x / l); };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** a crossing of a joint's overlap in words: "over S7 · overlap 2/4 on S4.1" (with the strip's name when it is not the
 *  strip in hand) */
export function overlapWord(q, st = null) {
  const mine = st && st.kind === 'add' && st.piece && q.subject && st.piece.id === q.subject.id;
  return `${mine ? '' : q.subject.label + ' '}${q.goesOver ? 'over' : 'under'}${q.partner ? ' ' + q.partner.label : ''} · overlap ${q.overlap}/${q.n} ${q.lapUnder ? 'beneath' : 'on'} ${q.other ? q.other.label : ''}`;
}
/** the over / under sequence of a sub-step as words, in its order */
export function sequenceWords(st) {
  if (!st || !st.knots) return [];
  return st.knots.filter(q => !q.rim).map(q => q.join ? overlapWord(q, st) : st.kind === 'add' && !q.lay ? (q.goesOver ? 'over' : 'under') : `${q.subject.label} ${q.goesOver ? 'over' : 'under'} ${q.partner ? q.partner.label : ''}`);
}
/** text of one sub-step for the status bar */
export function describeStep(w, plan, k) {
  const st = plan.steps[k]; if (!st) return '';
  if (st.kind === 'done') return `${k + 1} / ${plan.steps.length} · the weave is complete: ${plan.order.length} cells, ${plan.nPiecesAll} pieces`;
  const cellName = st.rim ? 'rim cell' : `${st.valence}-sided cell`, clips = `clips +${st.nClip} −${st.nRel} (${st.clipsNow} held)`;
  if (st.kind === 'add') return `${k + 1} / ${plan.steps.length} · cell ${st.cellIdx + 1} (${cellName} #${st.cell}) · ${st.cont ? 'continue' : 'add'} ${st.piece.label}${st.closes ? ', closing the cell' : ''} · ${sequenceWords(st).join(' › ') || 'no crossing yet'} · ${clips}`;
  if (st.kind === 'lay') return `${k + 1} / ${plan.steps.length} · cell ${st.cellIdx + 1} (${cellName} #${st.cell}) · cross the strips in hand: ${sequenceWords(st).join(', ')}${st.closes ? ' · closes the cell' : ''} · ${clips}`;
  return `${k + 1} / ${plan.steps.length} · cell ${st.cellIdx + 1} (${cellName} #${st.cell}) · already woven by its neighbours: count it · ${clips}`;
}
