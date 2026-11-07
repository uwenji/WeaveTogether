// planner.js — the human layer on top of the weave: where to start, in which order to build the cells, what every
// sub-step asks of the hands (which strip, in which direction, over or under at each crossing, which crossings to clip
// until they hold), where the strands are cut into pieces of the material's length and how consecutive pieces overlap.
//
// Rules in this practice (each one is a choice to discuss, see README):
//   start    — 'half' (most reachable): the cell from which half of the singular cells are reached soonest; 'centre':
//              smallest sum of distances to every singular cell; 'flat': the regular cell farthest from any singularity;
//              or a cell picked on the surface.
//   order    — 'spiral': rings from the start, inside a ring stay beside the last cell and close early; 'strips':
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
//   pieces   — a strand is cut where the material's length ends; consecutive pieces overlap by k crossings (the joint);
//              'start' distribution: full-length pieces from the first-woven crossing, the remainder last; 'even':
//              equal pieces; a cut is moved off a segment beside a singular cell.
//   clips    — a strip holds itself by friction once it has been woven through N crossings (4, more for slippery
//              material): a crossing is a clip point until both strips through it hold.
//   ⋈        — the closing of a cell with fewer than six sides: there the families permute, so strips that run parallel
//              on a flat patch have to cross each other ("cross exists" in Ji's notes, only around cells under six).

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
  rim: 'from the rim: the lowest cell of the boundary',
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

/** the cell order. strategy: 'spiral' | 'strips' | 'singular'; pieceOf(si, i) → a provisional piece id for the cost of
 *  new strips (any consistent partition works); singular: the singular cells (for the tour) */
export function cellOrder(w, nbr, start, ring, strategy = 'spiral', pieceOf = null, singular = []) {
  const nV = w.nV, woven = new Uint8Array(nV), wovenNbr = new Int32Array(nV), order = [], inHand = new Set();
  const nbrSet = nbr.map(l => new Set(l));
  const sidePieces = (v) => w.cellSegs[v].map(([t, k]) => pieceOf ? pieceOf(w.segStrand[3 * t + k], w.segIndex[3 * t + k]) : w.segStrand[3 * t + k]);
  const take = (v) => { woven[v] = 1; order.push(v); for (const u of nbr[v]) wovenNbr[u]++; for (const p of sidePieces(v)) inHand.add(p); };
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
    let r = Infinity; for (let v = 0; v < nV; v++) if (!woven[v] && ring[v] >= 0 && ring[v] < r) r = ring[v];
    if (r === Infinity) { for (let v = 0; v < nV; v++) if (!woven[v]) take(v); break; }
    while (strategy === 'singular' && tIdx < targets.length && woven[targets[tIdx]]) { tIdx++; dTarget = null; }
    const toTarget = strategy === 'singular' && tIdx < targets.length;
    if (toTarget && !dTarget) dTarget = hopDistance(w, [targets[tIdx]], nbr);
    const dLast = hopDistance(w, [last], nbr);
    let best = -1, bestKey = null;
    for (let v = 0; v < nV; v++) {
      if (woven[v] || !wovenNbr[v]) continue;                         // the front: cells touching the woven patch
      let key;
      if (toTarget) key = [dTarget[v] < 0 ? 1e9 : dTarget[v], -wovenNbr[v], dLast[v] < 0 ? 1e9 : dLast[v], v];
      else if (strategy === 'strips') { let fresh = 0; for (const p of new Set(sidePieces(v))) if (!inHand.has(p)) fresh++; key = [ring[v] - r > 1 ? 1 : 0, fresh, ring[v], nbrSet[last].has(v) ? 0 : 1, -wovenNbr[v], dLast[v] < 0 ? 1e9 : dLast[v], v]; }
      else { if (ring[v] !== r) continue; key = [nbrSet[last].has(v) ? 0 : 1, -wovenNbr[v], dLast[v] < 0 ? 1e9 : dLast[v], v]; }
      if (!bestKey || lexLess(key, bestKey)) { best = v; bestKey = key; }
    }
    if (best < 0) { for (let v = 0; v < nV; v++) if (!woven[v]) { best = v; break; } }
    take(best); last = best;
  }
  return order;
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
  const start = Number.isInteger(opts.start) && opts.start >= 0 && opts.start < w.nV ? opts.start : auto.cell;
  const ring = hopDistance(w, [start], nbr);
  const maxL = opts.maxLength > 0 ? opts.maxLength : 0, overlap = Math.max(0, Math.min(6, opts.overlap | 0)), distribution = opts.distribution === 'even' ? 'even' : 'start', hold = Math.max(1, (opts.hold | 0) || 4);
  // provisional pieces (natural indexing) for the cost of new strips while ordering
  const provisional = w.strands.map((s, si) => { const walk = strandWalk(w, si, 0, 0); const pcs = cutStrand(w, walk, maxL, overlap, distribution, () => false); const of = new Int32Array(s.knots.length); pcs.forEach((p, k) => { for (let q = p.q0; q <= p.q1; q++) of[walk.knotAt(q)] = k; }); return of; });
  const provPiece = (si, i) => si * 4096 + provisional[si][i];
  const tour = cellOrder(w, nbr, start, ring, opts.strategy || 'spiral', provPiece, auto.singular);

  // --- the fan of every cell: its ring crossings and the opposite crossing of each of its triangles. A crossing is made at
  //     the first cell (in the order) whose fan holds it: building a cell weaves its strips through each other completely,
  //     ring and free ends alike (Design update 3: "it intersects each lath, but it is not woven") ------------------------
  const nE = w.nE, fan = cellFans(w), cellIdx = new Int32Array(w.nV).fill(-1), knotCell = new Int32Array(nE).fill(-1), rim = new Uint8Array(nE);
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
  w.strands.forEach((s, si) => {
    let best = 1e9, bestI = 0;
    s.knots.forEach((e, i) => { if (knotCell[e] < best) { best = knotCell[e]; bestI = i; } });
    firstCell[si] = best;
    if (s.closed) offset[si] = bestI; else reversed[si] = bestI > (s.knots.length - 1) / 2 ? 1 : 0;
  });
  const strandRank = [...Array(nS).keys()].sort((a, b) => firstCell[a] - firstCell[b] || b - a);
  const label = new Int32Array(nS); strandRank.forEach((si, r) => { label[si] = r + 1; });
  const walks = w.strands.map((s, si) => strandWalk(w, si, offset[si], reversed[si]));
  /** tick number of knot index i of strand si, 1-based, along the weaver's walk */
  const tick = (si, i) => { const s = w.strands[si], K = s.knots.length; return s.closed ? ((i - offset[si] + K) % K) + 1 : (reversed[si] ? K - i : i + 1); };
  // --- pieces -----------------------------------------------------------------------------------------------------------
  const pieces = [], pieceList = [];                                            // pieces[si] per strand; pieceList: every piece
  const sing = (walk) => (q) => { const v = walk.segCell(q); return !w.boundary[v] && w.valence[v] !== 6; };
  w.strands.forEach((s, si) => {
    const walk = walks[si], K = walk.K, pcs = cutStrand(w, walk, maxL, overlap, distribution, sing(walk));
    const pieceOfKnot = new Int32Array(K).fill(-1), pieceOfKnot2 = new Int32Array(K).fill(-1);   // primary piece, and the second one in an overlap zone
    const pieceOfSeg = new Int32Array(Math.max(walk.nseg, 0)).fill(-1), overlapSeg = new Uint8Array(Math.max(walk.nseg, 0));
    const arc = new Float64Array(K + 1); for (let q = 0; q < walk.nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
    const cutAfter = (q) => q < walk.nseg ? arc[q] + walk.segLen(q) / 2 : arc[q], cutBefore = (q) => q > 0 ? arc[q] - walk.segLen(q - 1) / 2 : 0;
    const arcAt = (q) => q < K ? arc[q] : arc[K] + arc[q - K];                   // arc position of weaver-knot q (wrapping on a closed strand)
    const info = pcs.map((p, k) => {
      const knots = []; for (let q = p.q0; q <= p.q1; q++) knots.push(walk.knotAt(q));
      const a0 = cutBefore(p.q0), a1 = p.q1 < K ? cutAfter(p.q1) : arc[K] + cutAfter(p.q1 - K), len = a1 - a0;
      let introCell = 1e9; for (const i of knots) introCell = Math.min(introCell, knotCell[s.knots[i]]);
      const id = pieceList.length;
      const rec = { id, strand: si, p: k, q0: p.q0, q1: p.q1, knots, introCell, intro: -1, length: len, label: pcs.length > 1 ? `S${label[si]}.${k + 1}` : `S${label[si]}`,
        edges: knots.map(i => s.knots[i]), overs: knots.map(i => w.over(si, i)),   // the crossing of every knot of the piece, and whether the piece goes over there
        arcOf: (m) => arcAt(p.q0 + m) - a0 };                                   // arc position of the piece's m-th crossing from its start
      pieceList.push(rec); return rec;
    });
    pcs.forEach((p, k) => { for (let q = p.q0; q <= p.q1; q++) { const i = walk.knotAt(q); if (pieceOfKnot[i] < 0) pieceOfKnot[i] = k; else pieceOfKnot2[i] = k; } });
    for (let q = 0; q < walk.nseg; q++) {
      const m = walk.segAt(q), owners = [];
      pcs.forEach((p, k) => { if ((q >= p.q0 && q + 1 <= p.q1) || (s.closed && q + K >= p.q0 && q + K + 1 <= p.q1)) owners.push(k); });
      pieceOfSeg[m] = owners.length ? owners[0] : Math.max(0, pieceOfKnot[walk.knotAt(q)]);
      overlapSeg[m] = owners.length > 1 ? 1 : 0;
    }
    pieces.push({ nPieces: pcs.length, pieceOfKnot, pieceOfKnot2, pieceOfSeg, overlapSeg, pieceLen: Float64Array.from(info.map(x => x.length)), length: arc[s.closed ? K : K - 1], list: info, walk });
  });
  const pieceLabel = (si, i) => { const p = pieces[si], k = Math.max(0, p.pieceOfKnot[i]); return p.nPieces > 1 ? `S${label[si]}.${k + 1}` : `S${label[si]}`; };
  const pieceAt = (si, i) => pieces[si].list[Math.max(0, pieces[si].pieceOfKnot[i])];
  /** every piece passing a crossing: the primary piece of each strand pass, and the second one inside a joint */
  const knotPieces = (e) => { const out = []; for (const [si, i] of w.knotStrands[e]) { const P = pieces[si]; out.push(P.list[Math.max(0, P.pieceOfKnot[i])]); if (P.pieceOfKnot2[i] >= 0) out.push(P.list[P.pieceOfKnot2[i]]); } return out; };
  /** the passes of piece pc through crossing e: [{si, i, m}] with m the index along the piece (two for a strip crossing itself) */
  const passes = (pc, e) => { const out = []; for (const [si, i] of w.knotStrands[e]) { if (si !== pc.strand) continue; const m = pc.knots.indexOf(i); if (m >= 0) out.push({ si, i, m }); } return out; };
  // --- sub-steps: for every cell — "continue" the marching strip (the strip added last that runs on through this cell),
  //     "lay" the other crossings between strips already in hand, then "add" every new strip in turn, threaded through
  //     the strips in hand at the crossings of the cell's fan in its weaving direction (toward the crossing made next);
  //     the last sub-step of the cell closes it. Crossings get fractional sub-steps (ticks) in their order. --------------------
  const flip = opts.flip instanceof Set ? opts.flip : new Set();
  const steps = [], knotStep = new Float64Array(nE).fill(-1), stepOf = new Int32Array(w.nV).fill(-1), cellSteps = [];
  const inHand = new Uint8Array(pieceList.length);
  const frame = (c) => { const nx = w.N[3 * c], ny = w.N[3 * c + 1], nz = w.N[3 * c + 2]; let ex, ey, ez; if (Math.abs(nx) < 0.9) { ex = 1 - nx * nx; ey = -nx * ny; ez = -nx * nz; } else { ex = -ny * nx; ey = 1 - ny * ny; ez = -ny * nz; } const l = Math.hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l; return [ex, ey, ez, ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex]; };
  const angleAround = (c, e) => { const f = frame(c), dx = w.edgeMid[3 * e] - w.V[3 * c], dy = w.edgeMid[3 * e + 1] - w.V[3 * c + 1], dz = w.edgeMid[3 * e + 2] - w.V[3 * c + 2]; return Math.atan2(dx * f[3] + dy * f[4] + dz * f[5], dx * f[0] + dy * f[1] + dz * f[2]); };
  const pushStep = (st, knots) => {
    st.k = steps.length; st.knotIds = knots; st.nTicks = knots.length;
    knots.forEach((e, i) => { knotStep[e] = st.k + (i + 1) / (knots.length + 1); });
    steps.push(st); return st;
  };
  const madeIndices = (pc) => { const s = w.strands[pc.strand], out = []; pc.knots.forEach((i, m) => { if (knotStep[s.knots[i]] >= 0) out.push(m); }); return out; };
  /** the threading direction of piece pc for the crossings at indices ms: toward the crossing made next (the side woven
   *  sooner in the order); if both sides are done, the end with less length to pull through */
  const threadDir = (pc, ms, ci) => {
    const s = w.strands[pc.strand], mFirst = Math.min(...ms), mLast = Math.max(...ms);
    let ahead = 1e9, behind = 1e9;
    pc.knots.forEach((i, m) => { const kc = knotCell[s.knots[i]]; if (kc <= ci) return; if (m > mLast) ahead = Math.min(ahead, kc); else if (m < mFirst) behind = Math.min(behind, kc); });
    if (ahead < 1e9 || behind < 1e9) return ahead <= behind ? 1 : -1;
    const before = pc.arcOf(mFirst), after = pc.length - pc.arcOf(mLast); return after <= before ? 1 : -1;
  };
  const orderAlong = (pc, es, dir) => es.map(e => ({ e, m: Math.min(...passes(pc, e).map(ps => ps.m)) })).sort((a, b) => dir * (a.m - b.m)).map(x => x.e);
  for (let ci = 0; ci < order.length; ci++) {
    const c = order[ci], E = fan[c].filter(e => knotCell[e] === ci), base = { cell: c, cellIdx: ci, ring: ring[c], valence: w.valence[c], rim: !!w.boundary[c] };
    const first = steps.length, made = new Set();
    // the new strips of this cell, in the order their strands appear around it (pieces of one strand in walk order)
    const ringRank = new Map(); w.cellSegs[c].forEach(([t, kk], j) => { const si = w.segStrand[3 * t + kk]; if (!ringRank.has(si)) ringRank.set(si, j); });
    const fresh = [];
    for (const e of E) for (const pc of knotPieces(e)) if (!inHand[pc.id] && !fresh.includes(pc)) fresh.push(pc);
    fresh.sort((a, b) => ((ringRank.get(a.strand) ?? 99) - (ringRank.get(b.strand) ?? 99)) || (a.strand - b.strand) || (a.p - b.p));
    const inHandE = E.filter(e => knotPieces(e).every(pc => inHand[pc.id]));
    // 1. the marching strip: the strip added last among those whose crossings here continue their woven part
    let march = null, marchKnots = [];
    { const cands = new Map(); for (const e of inHandE) for (const pc of knotPieces(e)) cands.set(pc.id, pc);
      for (const pc of cands.values()) {
        const mine = inHandE.filter(e => passes(pc, e).length); if (!mine.length) continue;
        const done = new Set(madeIndices(pc)), ms = mine.flatMap(e => passes(pc, e).map(ps => ps.m));
        if (!ms.some(m => done.has(m - 1) || done.has(m + 1))) continue;
        if (!march || pc.intro > march.intro) { march = pc; marchKnots = mine; }
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
      return out;
    };
    if (march) {
      const done = madeIndices(march), ms = marchKnots.flatMap(e => passes(march, e).map(ps => ps.m));
      let dir = Math.min(...ms) > Math.max(...done) ? 1 : Math.max(...ms) < Math.min(...done) ? -1 : threadDir(march, ms, ci);
      if (flip.has(`${ci}:${march.id}`)) dir = -dir;
      const ordered = orderAlong(march, marchKnots, dir);
      pushStep({ ...base, kind: 'add', cont: true, piece: march, newPieces: [], dir, closes: false, flipKey: `${ci}:${march.id}`, layIds: new Set(layLead) }, weave(march, ordered, layLead));
      layLead = [];
      for (const e of ordered) made.add(e);
    }
    // 3. every new strip in turn, through the strips in hand at the crossings of the fan
    for (const pc of fresh) {
      const mine = E.filter(e => !made.has(e) && passes(pc, e).length && knotPieces(e).every(q => q.id === pc.id || inHand[q.id]));
      inHand[pc.id] = 1; pc.intro = steps.length;
      const ms = mine.flatMap(e => passes(pc, e).map(ps => ps.m));
      let dir = ms.length ? threadDir(pc, ms, ci) : 1;
      if (flip.has(`${ci}:${pc.id}`)) dir = -dir;
      const ordered = orderAlong(pc, mine, dir);
      pushStep({ ...base, kind: 'add', cont: false, piece: pc, newPieces: [pc], dir, closes: false, flipKey: `${ci}:${pc.id}`, layIds: new Set(layLead) }, weave(pc, ordered, layLead));
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
  steps.push({ k: steps.length, kind: 'done', cell: -1, cellIdx: order.length, ring: -1, valence: 0, rim: false, piece: null, newPieces: [], closes: false, knotIds: [], nTicks: 0, first: steps.length, last: steps.length, groupNew: [], dir: 1 });
  // a cell left out of the tour is closed when the last crossing of its fan is made
  for (let v = 0; v < w.nV; v++) if (stepOf[v] < 0) { let k = 0; for (const e of fan[v]) k = Math.max(k, Math.floor(knotStep[e])); stepOf[v] = k; }
  const nSteps = steps.length;
  // --- clips: a strip holds after `hold` crossings; a crossing is clipped until both strips through it hold --------------
  for (const pc of pieceList) { const st = pc.knots.map(i => knotStep[w.strands[pc.strand].knots[i]]).sort((a, b) => a - b); pc.holdStep = st[Math.min(hold, st.length) - 1]; pc.lastStep = st[st.length - 1]; }
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
  for (const st of steps) {
    const k = st.k;
    st.knots = st.knotIds.map((e, i) => describeKnot(e, st, i));
    const own = new Set(st.knotIds);
    st.released = releaseAt[k].filter(e => !own.has(e));
    st.nClip = st.knots.filter(q => q.clip).length; st.nRel = st.knots.filter(q => q.release).length + st.released.length; clipsNow += st.nClip - st.nRel; st.clipsNow = clipsNow;
    st.nNewCross = st.knots.filter(q => !q.rim).length;
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
  return { start, autoStart: auto.cell, startScores: auto.scores, k: auto.k, ring, maxRing, ringSize, order, tour, skipped, cellIdx, stepOf, cellSteps, knotStep, knotCell, lockStep, rim, fan, steps, nSteps,
    label, tick, pieces, pieceList, pieceLabel, pieceAt, firstCell, offset, reversed, strandRank, singular, ang, nbr, totalLen, nPiecesAll: pieceList.length,
    maxLength: maxL, overlap, distribution, hold, strategy: opts.strategy || 'spiral', jumps, maxClips, newStripEvents };
}

const dir3 = (M, e0, e1) => { const d = [M[3 * e1] - M[3 * e0], M[3 * e1 + 1] - M[3 * e0 + 1], M[3 * e1 + 2] - M[3 * e0 + 2]], l = Math.hypot(...d) || 1; return d.map(x => x / l); };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** the over / under sequence of a sub-step as words, in its order */
export function sequenceWords(st) {
  if (!st || !st.knots) return [];
  return st.knots.filter(q => !q.rim).map(q => st.kind === 'add' && !q.lay ? (q.goesOver ? 'over' : 'under') : `${q.subject.label} ${q.goesOver ? 'over' : 'under'} ${q.partner ? q.partner.label : ''}`);
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
