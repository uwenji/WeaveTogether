// shape.js — what the lattice says about the shape beyond the graph (Ji, Multiplayer update 3, 10 Nov 2026):
//
//   Geo            distances along the weave: the shortest way over the crossings, in model units (chords between the
//                  crossings of a cell). A move longer than the material's length is a jump; shorter, it is still in
//                  the area (item 11).
//   curvature()    the discrete Gaussian curvature of every cell: its angle defect 2π − Σ(corner angles), in units of a
//                  cone 5's defect (60°). |K| is the figure-recognition score (a tube is 0 everywhere, a head is not).
//   wrapClasses()  the loops that wrap around the shape (a tube's ring, the two ways round a torus): for every lattice edge
//                  the class of the loop it would close, as a small integer vector. A set of crossings holds a wrap-around
//                  loop when a closed chain of them has a class other than zero — the sheet has become a cylinder
//                  (emerging shape stress). WrapTracker follows that while crossings are made.
//   looseEnds() …  the loose remainders as straight segments in space (as the view draws them); inTheWay(): a remainder
//                  being moved sweeps a narrow fan (it pivots where it leaves the weave) and collides with the remainders
//                  that enter it (item 9).
// Nothing here touches the DOM.

// ---------------------------------------------------------------------------------------------------------- distances
/** lazy shortest paths over the crossings from one source. nbr[e] = the crossings sharing a cell with e. */
export class Geo {
  constructor(w, nbr) { this.M = w.edgeMid; this.nbr = nbr; this.nE = w.nE; this.d = new Float64Array(w.nE); this.done = new Uint8Array(w.nE); this.stamp = new Int32Array(w.nE); this.now = 0; this.hd = []; this.he = []; }
  _len(a, b) { const M = this.M; return Math.hypot(M[3 * a] - M[3 * b], M[3 * a + 1] - M[3 * b + 1], M[3 * a + 2] - M[3 * b + 2]); }
  _push(d, e) { const hd = this.hd, he = this.he; let i = hd.length; hd.push(d); he.push(e); while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hd[i] = hd[p]; he[i] = he[p]; i = p; } hd[i] = d; he[i] = e; }
  _pop() { const hd = this.hd, he = this.he, e0 = he[0], d = hd.pop(), e = he.pop(), n = hd.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hd[c + 1] < hd[c]) c++; if (hd[c] >= d) break; hd[i] = hd[c]; he[i] = he[c]; i = c; } hd[i] = d; he[i] = e; } return e0; }
  /** start from crossing e0 (or several) */
  from(src) { this.now++; this.hd.length = 0; this.he.length = 0; for (const e of (Array.isArray(src) ? src : [src])) { this.stamp[e] = this.now; this.d[e] = 0; this.done[e] = 0; this._push(0, e); } return this; }
  /** the distance to crossing e, Infinity when it is farther than cap (the search stays valid for a larger cap later) */
  to(e, cap = Infinity) {
    const { d, done, stamp, now, nbr } = this;
    if (stamp[e] === now && done[e]) return d[e];
    while (this.hd.length) {
      if (this.hd[0] > cap) return Infinity;
      const dx = this.hd[0], x = this._pop();
      if (done[x] && stamp[x] === now && d[x] < dx) continue;
      if (done[x]) continue;
      done[x] = 1;
      for (const f of nbr[x]) { const nd = dx + this._len(x, f); if (stamp[f] !== now) { stamp[f] = now; done[f] = 0; d[f] = nd; this._push(nd, f); } else if (!done[f] && nd < d[f]) { d[f] = nd; this._push(nd, f); } }
      if (x === e) return dx;
    }
    return stamp[e] === now && done[e] ? d[e] : Infinity;
  }
}

// ---------------------------------------------------------------------------------------------------------- curvature
/** the angle defect of every cell in units of 60° (a cone 5 on an even lattice = +1, a 7 = −1); rim cells 0.
 *  Returns { K (signed), absK, total = Σ|K| } */
export function curvature(w) {
  const { V, F, nV } = w, sum = new Float64Array(nV), K = new Float64Array(nV), absK = new Float64Array(nV);
  const ang = (a, b, c) => { const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2], vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2]; const l = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz); return l ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / l))) : 0; };
  for (let t = 0; t < F.length; t += 3) { const a = F[t], b = F[t + 1], c = F[t + 2]; sum[a] += ang(a, b, c); sum[b] += ang(b, c, a); sum[c] += ang(c, a, b); }
  let total = 0;
  for (let v = 0; v < nV; v++) { if (w.boundary[v]) continue; K[v] = (2 * Math.PI - sum[v]) / (Math.PI / 3); absK[v] = Math.abs(K[v]); total += absK[v]; }
  return { K, absK, total };
}

// ------------------------------------------------------------------------------------------------------ wrap-around loops
/** the classes of the loops around the shape. A spanning tree of the cells; a spanning tree of the triangles across the
 *  other edges, rooted outside the rim when there is one (every rim edge leads outside); the edges in neither tree are
 *  the generators — 1 − χ of them with a rim, 2 − χ without: a disc 0, a tube 1, a torus 2, a pair of trousers 2. Every
 *  edge a → b (a < b) gets the class of the loop "tree path to a, this edge, tree path back from b" as an integer vector
 *  of length `rank`. Returns { rank, cls: Int16Array(nE × rank), generators }. */
export function wrapClasses(w) {
  const { nV, nE, edges, edgeTris, triEdges, F } = w, nT = F.length / 3;
  const vAdj = Array.from({ length: nV }, () => []); edges.forEach(([a, b], e) => { vAdj[a].push([b, e]); vAdj[b].push([a, e]); });
  const inTree = new Uint8Array(nE), seenV = new Uint8Array(nV);
  for (let r = 0; r < nV; r++) { if (seenV[r]) continue; seenV[r] = 1; const q = [r]; for (let i = 0; i < q.length; i++) for (const [u, e] of vAdj[q[i]]) if (!seenV[u]) { seenV[u] = 1; inTree[e] = 1; q.push(u); } }
  // the dual tree over the triangles, across edges that are not in the cell tree; parentEdge[t] leads towards the root
  const inDual = new Uint8Array(nE), parentEdge = new Int32Array(nT).fill(-1), seenT = new Uint8Array(nT), orderT = [];
  const grow = (queue) => { for (let i = 0; i < queue.length; i++) { const t = queue[i]; orderT.push(t); for (let k = 0; k < 3; k++) { const e = triEdges[3 * t + k]; if (inTree[e] || edgeTris[e].length !== 2) continue; const t2 = edgeTris[e][0] === t ? edgeTris[e][1] : edgeTris[e][0]; if (seenT[t2]) continue; seenT[t2] = 1; inDual[e] = 1; parentEdge[t2] = e; queue.push(t2); } } };
  const first = [];
  for (let e = 0; e < nE; e++) { if (edgeTris[e].length !== 1 || inTree[e]) continue; const t = edgeTris[e][0]; if (seenT[t]) continue; seenT[t] = 1; inDual[e] = 1; parentEdge[t] = e; first.push(t); }   // the triangles next to the outside
  grow(first);
  for (let r = 0; r < nT; r++) if (!seenT[r]) { seenT[r] = 1; grow([r]); }     // a closed shape: any triangle is the root
  const gen = []; for (let e = 0; e < nE; e++) if (!inTree[e] && !inDual[e]) gen.push(e);
  const rank = gen.length, cls = new Int16Array(nE * Math.max(1, rank));
  gen.forEach((e, g) => { cls[e * rank + g] = 1; });
  // triangle t, edge slot k runs F[3t+k] → F[3t+k+1]: +1 when that is the edge's own direction (lower → higher cell);
  // a triangle's three edges sum to zero, which gives the class of the edge towards its parent — leaves first
  const sign = (t, k) => (F[3 * t + k] < F[3 * t + (k + 1) % 3] ? 1 : -1), acc = new Int32Array(Math.max(1, rank));
  for (let i = orderT.length - 1; i >= 0 && rank; i--) {
    const t = orderT[i], pe = parentEdge[t]; if (pe < 0) continue;
    let pk = -1; acc.fill(0);
    for (let k = 0; k < 3; k++) { const e = triEdges[3 * t + k]; if (e === pe && pk < 0) { pk = k; continue; } const s = sign(t, k); for (let g = 0; g < rank; g++) acc[g] += s * cls[e * rank + g]; }
    const s = sign(t, pk); for (let g = 0; g < rank; g++) cls[pe * rank + g] = -s * acc[g];
  }
  return { rank, cls, generators: gen };
}

/** follows the made crossings: union–find over the cells with the class of the path between them. add(e) returns the class
 *  of the wrap-around loop the crossing closes (an array, not all zero), or null (it closes none, or only a loop that can
 *  be shrunk to a point on the surface). */
export class WrapTracker {
  constructor(w, H) { this.w = w; this.H = H; this.r = H.rank; this.parent = Int32Array.from({ length: w.nV }, (_, i) => i); this.pot = new Int32Array(w.nV * Math.max(1, this.r)); this.size = new Int32Array(w.nV).fill(1); this.loops = []; this.basis = []; }
  /** root of v and the class of the path v → root (accumulated into out) */
  _find(v, out) { const r = this.r; out.fill(0); while (this.parent[v] !== v) { for (let j = 0; j < r; j++) out[j] += this.pot[v * r + j]; v = this.parent[v]; } return v; }
  /** the class of the loop crossing e would close with the crossings made so far, or null */
  loopOf(e) {
    const r = this.r; if (!r) return null;
    const [a, b] = this.w.edges[e], pa = new Int32Array(r), pb = new Int32Array(r), ra = this._find(a, pa), rb = this._find(b, pb);
    if (ra !== rb) return null;
    const c = []; let any = false; for (let j = 0; j < r; j++) { const x = this.H.cls[e * r + j] + pb[j] - pa[j]; c.push(x); if (x) any = true; }   // a → b by the edge, b → root → a back
    return any ? c : null;
  }
  /** is this class new — not a combination of the loops closed so far (rank test over the rationals) */
  isNew(c) { const B = this.basis.map(v => v.slice()); B.push(c.slice()); return rankOf(B) > this.basis.length; }
  add(e, t = 0) {
    const r = this.r; if (!r) return null;
    const [a, b] = this.w.edges[e], pa = new Int32Array(r), pb = new Int32Array(r), ra = this._find(a, pa), rb = this._find(b, pb);
    if (ra === rb) {
      const c = this.loopOf(e); if (!c) return null;
      const fresh = this.isNew(c); if (fresh) this.basis.push(c);
      this.loops.push({ t, e, cls: c, fresh });
      return { cls: c, fresh };
    }
    // join the smaller tree under the larger: pot[root] = the class of the path root → new parent
    const cab = []; for (let j = 0; j < r; j++) cab.push(this.H.cls[e * r + j]);
    if (this.size[ra] < this.size[rb]) { for (let j = 0; j < r; j++) this.pot[ra * r + j] = -pa[j] + cab[j] + pb[j]; this.parent[ra] = rb; this.size[rb] += this.size[ra]; }
    else { for (let j = 0; j < r; j++) this.pot[rb * r + j] = -pb[j] - cab[j] + pa[j]; this.parent[rb] = ra; this.size[ra] += this.size[rb]; }
    return null;
  }
}
/** The weave as it grows, read as a surface — Ji, 18 Nov: "the Euler characteristic on the ongoing weave graph surface: a
 *  surface without a hole, then patch the hole, if the hole area needs to weave". The woven part W is a piece of the
 *  lattice: its cells are the cells that have a made crossing (V), its edges the made crossings (E), its faces the
 *  triangles whose three crossings are made (F — the small three-strip openings that are complete).
 *      χ(W) = V − E + F        parts (b0, by union–find)        loops = b0 − χ(W)   (+ 1 once a closed shape is woven whole)
 *  `loops` is the number of independent closed ways round something inside the woven part — the holes of the fabric. One
 *  crossing a–b changes it like this:
 *      a or b new                              χ unchanged, the part grows                               loops ± 0
 *      a and b in two parts                    the parts become one                                      loops ± 0
 *      a and b already joined, completes 1 Δ   the ordinary crossing of a patch that grows               loops ± 0
 *      a and b already joined, completes no Δ  THE WEAVE MEETS ITSELF: a loop is closed                  loops + 1
 *      completes 2 Δ                           the last crossing of a hole: patched                      loops − 1
 *  add(e) makes the crossing and says what the loop it closed goes round:
 *      'round'  round the shape — a tube, a branch, a handle (its class on the carrier is not zero: WrapTracker). Nothing
 *               can ever fill it; from here on the weave is a closed band and holds its section.
 *      'hole'   round a patch of the surface — the loop could be shrunk to a point on the carrier. The patch is the smaller
 *               of the two sides (triangles reached without crossing a made crossing); `cells` of it have no crossing yet.
 *               cells = 0: a gap of a few triangles that the next crossings fill (not reported unless asked);
 *               cells > 0: a hole to patch — the weave has gone round something it left open (an ear's tip, a pocket).
 *               `hoop` = 12 · cells of the patch / (cells on the loop)²: about 1 for a flat patch, 2 for a dome, more for
 *               a limb — the loop is then a hoop round a neck, on a closed shape the only kind of "wrap-around" there is.
 *  → { loops, dLoops, kind, cls, fresh, cells, tris, girth, hoop } (kind null: no loop closed) */
export class WeaveTopology {
  constructor(w, H = null) {
    this.w = w; this.wrap = new WrapTracker(w, H || wrapClasses(w));
    this.made = new Uint8Array(w.nE); this.touched = new Uint8Array(w.nV); this.filled = new Uint8Array(w.F.length / 3);
    this.parent = Int32Array.from({ length: w.nV }, (_, i) => i);
    this.V = 0; this.E = 0; this.F = 0; this.b0 = 0; this.closedShape = !w.boundary.some(b => b); this.nT = w.F.length / 3;
  }
  _find(v) { const p = this.parent; while (p[v] !== v) { p[v] = p[p[v]]; v = p[v]; } return v; }
  get chi() { return this.V - this.E + this.F; }
  get loops() { return this.b0 - this.chi + (this.closedShape && this.F === this.nT ? 1 : 0); }
  /** the side of crossing e that triangle t0 lies on: the triangles reached from it without passing a made crossing */
  _side(t0, stopAt = -1) {
    const w = this.w, seen = new Set([t0]), st = [t0];
    while (st.length) { const t = st.pop(); for (let k = 0; k < 3; k++) { const e = w.triEdges[3 * t + k]; if (this.made[e]) continue; for (const u of w.edgeTris[e]) if (!seen.has(u)) { if (u === stopAt) return null; seen.add(u); st.push(u); } } }
    return seen;
  }
  add(e, t = 0) {
    const w = this.w, [a, b] = w.edges[e], before = this.loops;
    if (this.made[e]) return { loops: before, dLoops: 0, kind: null };
    this.made[e] = 1; this.E++;
    for (const v of [a, b]) if (!this.touched[v]) { this.touched[v] = 1; this.V++; this.b0++; }
    const ra = this._find(a), rb = this._find(b), joined = ra === rb; if (!joined) { this.parent[ra] = rb; this.b0--; }
    for (const tr of w.edgeTris[e]) { if (this.filled[tr]) continue; let all = true; for (let k = 0; k < 3; k++) if (!this.made[w.triEdges[3 * tr + k]]) { all = false; break; } if (all) { this.filled[tr] = 1; this.F++; } }
    const cl = this.wrap.add(e, t), loops = this.loops, out = { loops, dLoops: loops - before, kind: null, cls: null, fresh: false };
    if (cl) { out.kind = 'round'; out.cls = cl.cls; out.fresh = cl.fresh; return out; }
    if (out.dLoops <= 0 || w.edgeTris[e].length < 2) return out;
    // a loop that can be shrunk on the carrier: the two sides of the new crossing are apart now; the smaller one is the hole
    const [t1, t2] = w.edgeTris[e], A = this._side(t1, t2); if (!A) return out;       // (not apart: no hole — should not happen)
    const B = this._side(t2), small = A.size <= B.size ? A : B, inside = new Set(), rimOf = new Set();
    for (const tr of small) for (let k = 0; k < 3; k++) { const v = w.F[3 * tr + k]; if (this.touched[v]) rimOf.add(v); else inside.add(v); }
    out.kind = 'hole'; out.tris = small.size; out.cells = inside.size; out.girth = rimOf.size; out.hoop = rimOf.size ? 12 * (inside.size + rimOf.size) / (rimOf.size * rimOf.size) : 0;
    return out;
  }
}
/** the topology of the weave at every crossing of a plan (WeaveTopology, in the order of the steps and their ticks).
 *  Marks the steps where the weave meets itself — st.loop = 'round' (a loop round the shape closed, a new one) or 'hole'
 *  (it closed round a patch with cells still to weave), st.loopText in words —
 *  → { per[step][tick] = [χ, loops round the shape so far, holes open (gaps of a few triangles included), parts], events, rank } */
export function planTopology(w, steps) {
  const T = new WeaveTopology(w), per = [], events = [];
  let rounds = 0, state = [0, 0, 0, 0];
  const nth = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  for (const st of steps) {
    const row = []; st.loop = null; st.loopText = '';
    (st.knots || []).forEach((q, i) => {
      if (!q.join && !q.rim && q.e >= 0 && !T.made[q.e]) {
        const r = T.add(q.e, T.E);
        if (r.kind === 'round' && r.fresh) rounds++;
        state = [T.chi, rounds, Math.max(0, r.loops - rounds), T.b0];
        const tell = (r.kind === 'round' && r.fresh) || (r.kind === 'hole' && r.cells > 0);
        if (tell) {
          const text = r.kind === 'round' ? `the weave meets itself: the ${nth[rounds - 1] || rounds + 'th'} loop round the shape is closed${rounds === 1 ? ' — a closed band from here on' : ''}`
            : `the weave closes round a patch of ${r.cells} cell${r.cells === 1 ? '' : 's'} still to weave (${r.girth} cells round it${r.hoop >= 2 ? ', a hoop round a neck' : ''})`;
          events.push({ step: st.k, tick: i, n: T.E, kind: r.kind, cells: r.cells || 0, girth: r.girth || 0, hoop: r.hoop || 0, text });
          st.loop = st.loop === 'round' ? 'round' : r.kind; st.loopText = st.loopText ? st.loopText + ' · ' + text : text;
        }
      }
      row.push(state);
    });
    per.push(row.length ? row : [state]);
  }
  return { per, events, rank: T.wrap.r, crossings: T.E };
}
function rankOf(rows) {
  const A = rows.map(r => r.map(Number)); let rank = 0; const n = A.length ? A[0].length : 0;
  for (let c = 0; c < n && rank < A.length; c++) {
    let p = -1; for (let i = rank; i < A.length; i++) if (Math.abs(A[i][c]) > 1e-9) { p = i; break; }
    if (p < 0) continue; [A[rank], A[p]] = [A[p], A[rank]];
    for (let i = 0; i < A.length; i++) if (i !== rank && Math.abs(A[i][c]) > 1e-9) { const f = A[i][c] / A[rank][c]; for (let j = c; j < n; j++) A[i][j] -= f * A[rank][j]; }
    rank++;
  }
  return rank;
}

// ------------------------------------------------------------------------------------------------------- loose remainders
/** the smallest distance between segments p0 → p1 and q0 → q1 (arrays of 3) */
export function segDist(p0, p1, q0, q1) {
  const d1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], d2 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], r = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2], f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s, t;
  if (a <= 1e-18 && e <= 1e-18) { s = 0; t = 0; }
  else if (a <= 1e-18) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= 1e-18) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = a * e - b * b;
      s = den > 1e-18 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return Math.hypot(r[0] + s * d1[0] - t * d2[0], r[1] + s * d1[1] - t * d2[1], r[2] + s * d1[2] - t * d2[2]);
}

/** is loose end o in the way when loose end m is moved to make its crossing? m pivots where it leaves the weave, so its far
 *  end swings wide: its sweep is everything closer to its line than `clear` (model units) near the crossing, widening by
 *  `spread` per unit of length along it. o is in the way when it enters that sweep. Ends: { p0, p1, len }. */
export const SWEEP = { clear: 0.5, spread: 0.25 };                           // half a lattice edge; a quarter of the distance out (about 14°)
export function inTheWay(m, o, clear, spread, step) {
  if (!(m.len > 0)) return false;
  const rx = o.p0[0] - m.p0[0], ry = o.p0[1] - m.p0[1], rz = o.p0[2] - m.p0[2];
  if (Math.hypot(rx, ry, rz) > m.len * (1 + spread) + o.len + clear) return false;
  const tx = (m.p1[0] - m.p0[0]) / m.len, ty = (m.p1[1] - m.p0[1]) / m.len, tz = (m.p1[2] - m.p0[2]) / m.len;
  const dx = o.p1[0] - o.p0[0], dy = o.p1[1] - o.p0[1], dz = o.p1[2] - o.p0[2], n = Math.max(1, Math.min(32, Math.ceil(o.len / step)));
  for (let q = 0; q <= n; q++) {
    const u = q / n, x = rx + u * dx, y = ry + u * dy, z = rz + u * dz, sAx = x * tx + y * ty + z * tz;
    if (sAx < 0 || sAx > m.len) continue;
    if (Math.hypot(x - sAx * tx, y - sAx * ty, z - sAx * tz) <= Math.max(clear, sAx * spread)) return true;
  }
  return false;
}

/** the loose ends of a strip: beyond its outermost woven crossing at either side, straight along the strip's own tangent
 *  there, as long as what is left — only when a crossing is still to be made on that side.
 *  pc: { edges, cross, madeMask } (positions along the strip); arc[m] = arc length from position 0; extra = the strip
 *  past its last knot at [tail, head]. Returns [{ side: −1 | 1, root (crossing), m, p0, p1, len }]. */
export function looseEnds(M, pc, arc, extra = [0, 0]) {
  const n = pc.edges.length; let lo = -1, hi = -1;
  for (let m = 0; m < n; m++) if (pc.madeMask[m] && pc.cross[m]) { if (lo < 0) lo = m; hi = m; }
  if (lo < 0) return [];
  const out = [], P = (m) => [M[3 * pc.edges[m]], M[3 * pc.edges[m] + 1], M[3 * pc.edges[m] + 2]];
  const unit = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
  const pending = (from, to) => { for (let m = from; m <= to; m++) if (pc.cross[m] && !pc.madeMask[m]) return true; return false; };
  if (hi < n - 1 && pending(hi + 1, n - 1)) {
    const len = arc[n - 1] - arc[hi] + extra[1], t = hi > 0 ? unit(P(hi - 1), P(hi)) : unit(P(hi), P(hi + 1)), p0 = P(hi);
    out.push({ side: 1, root: pc.edges[hi], m: hi, p0, p1: [p0[0] + t[0] * len, p0[1] + t[1] * len, p0[2] + t[2] * len], len });
  }
  if (lo > 0 && pending(0, lo - 1)) {
    const len = arc[lo] + extra[0], t = lo < n - 1 ? unit(P(lo + 1), P(lo)) : unit(P(lo), P(lo - 1)), p0 = P(lo);
    out.push({ side: -1, root: pc.edges[lo], m: lo, p0, p1: [p0[0] + t[0] * len, p0[1] + t[1] * len, p0[2] + t[2] * len], len });
  }
  return out;
}

// ------------------------------------------------------------------------------- stress from the geometry (update 4, 17 · 20)
/** What the shape asks of every strip, from the geometry alone (no solver): along a strand the path through its crossings
 *  bends about the strip's flat side (the surface curves under it — easy), bends sideways in the surface (a flat strip
 *  cannot: where the lattice asks for it the weave is forced) and twists (the surface normal turns about the strip).
 *  Per unit length a strip w wide and t thick stores ½ E w t³ / 12 · (κn² + (w/t)² κg² + 1.54 τ²): the three terms are
 *  kept apart — `bend`, `side`, `twist` — in units of ½ E w t³ / 12 / a (a = the lattice edge), so 1 is one segment bent
 *  to a circle of radius a.  opts: { width, thickness } in model units (the lath's section; only their ratio matters).
 *  → { knot: Float64Array per strand-knot [bend, side], seg: per segment (t, k) the spring-back energy (bend + twist of
 *      its two ends and itself — what makes an open piece "turn back to flat", Q11) and `force` (the sideways part),
 *      strand: [{ bend, side, twist }], total: { bend, side, twist }, back (Σ spring-back), sideW = (w/t)² } */
export function strandStress(w, opts = {}) {
  const M = w.edgeMid, Nn = w.edgeNrm, a = (() => { const l = Array.from(w.edgeLen).sort((x, y) => x - y); return l[l.length >> 1] || 1; })();
  const ratio = opts.width > 0 && opts.thickness > 0 ? opts.width / opts.thickness : 6.5, sideW = ratio * ratio, TW = 1.54;
  const back = new Float64Array(3 * w.nT), force = new Float64Array(3 * w.nT), strand = [], total = { bend: 0, side: 0, twist: 0 };
  const sub = (p, q) => [M[3 * q] - M[3 * p], M[3 * q + 1] - M[3 * p + 1], M[3 * q + 2] - M[3 * p + 2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], unit = (u) => { const l = Math.hypot(u[0], u[1], u[2]) || 1; return [u[0] / l, u[1] / l, u[2] / l]; };
  w.strands.forEach((s, si) => {
    const K = s.knots.length, nseg = s.closed ? K : K - 1, st = { bend: 0, side: 0, twist: 0 }, kb = new Float64Array(K), ks = new Float64Array(K);
    for (let j = 0; j < K; j++) {                                   // the bend at knot j, shared by the two segments beside it
      const jp = s.closed ? (j - 1 + K) % K : j - 1, jn = s.closed ? (j + 1) % K : j + 1; if (jp < 0 || jn >= K || K < 3) continue;
      const u1 = sub(s.knots[jp], s.knots[j]), u2 = sub(s.knots[j], s.knots[jn]), l1 = Math.hypot(...u1), l2 = Math.hypot(...u2), l = (l1 + l2) / 2; if (!(l > 0)) continue;
      const d1 = unit(u1), d2 = unit(u2), b = [d2[0] - d1[0], d2[1] - d1[1], d2[2] - d1[2]], n = [Nn[3 * s.knots[j]], Nn[3 * s.knots[j] + 1], Nn[3 * s.knots[j] + 2]];
      const t = unit([d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2]]), bn = dot(b, n), bg = dot(b, cross(n, t));
      kb[j] = bn * bn / l * a; ks[j] = bg * bg / l * a;             // κ² · length, in units of 1 / a
      st.bend += kb[j]; st.side += ks[j];
    }
    for (let j = 0; j < nseg; j++) {
      const e0 = s.knots[j], e1 = s.knots[(j + 1) % K], d = sub(e0, e1), l = Math.hypot(...d); if (!(l > 0)) continue;
      const t = unit(d), n0 = [Nn[3 * e0], Nn[3 * e0 + 1], Nn[3 * e0 + 2]], n1 = [Nn[3 * e1], Nn[3 * e1 + 1], Nn[3 * e1 + 2]];
      const p0 = unit([n0[0] - dot(n0, t) * t[0], n0[1] - dot(n0, t) * t[1], n0[2] - dot(n0, t) * t[2]]), p1 = unit([n1[0] - dot(n1, t) * t[0], n1[1] - dot(n1, t) * t[1], n1[2] - dot(n1, t) * t[2]]);
      const phi = Math.atan2(dot(cross(p0, p1), t), dot(p0, p1)), tw = TW * phi * phi / l * a;
      st.twist += tw;
      const [tt, kk] = s.segs[j], j1 = (j + 1) % K;
      back[3 * tt + kk] = tw + (kb[j] + kb[j1]) / 2; force[3 * tt + kk] = sideW * (ks[j] + ks[j1]) / 2;
    }
    strand.push(st); total.bend += st.bend; total.side += st.side; total.twist += st.twist;
  });
  let sumBack = 0; for (const x of back) sumBack += x;
  return { back, force, strand, total, sumBack, sideW, a };
}

// ------------------------------------------------------------------------------------- the figure: features and parts (19)
/** The recognisable features of the shape: the singular cells in groups (two of them at most two lattice edges apart are
 *  one feature). A group whose sides add up to fewer than six each is a TIP (a cone, a cap, a dome end: Σ(6 − n) > 0);
 *  more, a SADDLE (a branch, a flare, a waist: Σ < 0); a balanced group with both kinds is a BEND (a 5–7 pair shifts or
 *  turns the lattice). → [{ kind, cells, charge, weight (Σ|6 − n|), around (the cells and their neighbours) }] */
export function features(w, nbr) {
  const sing = []; for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) sing.push(v);
  const isS = new Set(sing), group = new Map(); let n = 0; const out = [];
  for (const s0 of sing) {
    if (group.has(s0)) continue;
    const cells = [s0]; group.set(s0, n);
    for (let q = 0; q < cells.length; q++) for (const u of nbr[cells[q]]) for (const x of [u, ...nbr[u]]) if (isS.has(x) && !group.has(x)) { group.set(x, n); cells.push(x); }
    let charge = 0, weight = 0, pos = 0, neg = 0; for (const v of cells) { const c = 6 - w.valence[v]; charge += c; weight += Math.abs(c); if (c > 0) pos++; else neg++; }
    const around = new Set(cells); for (const v of cells) for (const u of nbr[v]) around.add(u);
    out.push({ id: n++, kind: charge > 0 ? 'tip' : charge < 0 ? 'saddle' : 'bend', cells, charge, weight, mixed: pos > 0 && neg > 0, around: [...around] });
  }
  return out;
}
/** The limbs of the shape: the parts that stick out and end — an ear, a finger, a branch up to its rim (Ji, 18 Nov: "it
 *  should finish the ear as early as it can"). Found by their rings, whatever the start of the weave: from a tip (cells
 *  with fewer than six sides, in groups two lattice edges apart at most, and one by one) or from a rim, the cells 1, 2, 3 …
 *  lattice edges away form rings. Along a limb every ring is ONE closed band of about the same size — a tube: the angle
 *  defect inside stays 6 from a closed tip and 0 from a rim — and where the limb runs into the body the ring FLARES (more
 *  than `flare` × the smallest ring so far). The limb is everything up to the last ring that is still of its own size
 *  (`tight` × the smallest), so that the limbs round a junction do not share cells. Kept: at least
 *  `minRings` rings, at most `maxShare` of the cells, long for its girth (cells ≥ `hoop` · girth² / 12: a flat disc of that
 *  girth has 1, a hemisphere 2), and no two limbs that overlap without one lying inside the other. A tube, a capsule, a
 *  sphere, a cone and a torus have none: nothing flares.
 *  → { list: [{ id, kind ('tip' | 'rim'), seed, cells, member (Uint8Array), d (ring of every cell, from the seed), rings,
 *      girth, hoop, parent (the limb it lies in, −1) }], of (Int32Array: the innermost limb of a cell, −1) } */
export function limbs(w, nbr, opts = {}) {
  const nV = w.nV, flare = opts.flare ?? 1.4, tight = opts.tight ?? 1.15, minRings = opts.minRings ?? 3, maxShare = opts.maxShare ?? 0.5, minHoop = opts.hoop ?? 3;
  const hop = (src) => { const d = new Int32Array(nV).fill(-1), q = []; for (const v of src) if (d[v] < 0) { d[v] = 0; q.push(v); } for (let i = 0; i < q.length; i++) for (const u of nbr[q[i]]) if (d[u] < 0) { d[u] = d[q[i]] + 1; q.push(u); } return d; };
  const seeds = [];
  { const seen = new Uint8Array(nV);                                 // every rim loop
    for (let v = 0; v < nV; v++) { if (!w.boundary[v] || seen[v]) continue; const loop = [v]; seen[v] = 1; for (let q = 0; q < loop.length; q++) for (const u of nbr[loop[q]]) if (w.boundary[u] && !seen[u]) { seen[u] = 1; loop.push(u); } seeds.push({ kind: 'rim', cells: loop }); } }
  { const tip = []; for (let v = 0; v < nV; v++) if (!w.boundary[v] && w.valence[v] < 6) tip.push(v);
    const isT = new Uint8Array(nV), g = new Int32Array(nV).fill(-1), groups = []; for (const v of tip) isT[v] = 1;
    for (const s0 of tip) { if (g[s0] >= 0) continue; const cells = [s0]; g[s0] = groups.length; for (let q = 0; q < cells.length; q++) for (const u of nbr[cells[q]]) for (const x of [u, ...nbr[u]]) if (isT[x] && g[x] < 0) { g[x] = groups.length; cells.push(x); } groups.push(cells); }
    for (const c of groups) if (c.length > 1) seeds.push({ kind: 'tip', cells: c });
    for (const v of tip) seeds.push({ kind: 'tip', cells: [v] }); }
  const list = [];
  for (const sd of seeds) {
    const d = hop(sd.cells); let K = 0; for (let v = 0; v < nV; v++) if (d[v] > K) K = d[v];
    const rings = Array.from({ length: K + 1 }, () => []); for (let v = 0; v < nV; v++) if (d[v] >= 0) rings[d[v]].push(v);
    const oneBand = (k) => { const cells = rings[k], seen = new Set([cells[0]]), st = [cells[0]]; while (st.length) { const x = st.pop(); for (const u of nbr[x]) if (d[u] === k && !seen.has(u)) { seen.add(u); st.push(u); } } return seen.size === cells.length; };
    let ref = Infinity, end = -1, m = rings[0].length;                // (m: the cells so far)
    for (let k = 1; k <= K; k++) {
      const n = rings[k].length;
      if (n > flare * ref) { end = k - 1; break; }                    // the flare: the limb ended a ring before
      if (!oneBand(k)) break;                                         // the ring falls apart: a junction, not the end of a limb
      ref = Math.min(ref, n); m += n;
      if (m > maxShare * nV) break;
    }
    while (end >= 1 && rings[end].length > tight * ref) end--;         // its last ring is still of the limb's own size
    // laminar: inside another limb, around it, or apart from it — and not nearly the same limb again. Two limbs that
    // meet in a junction share a few cells of their last rings: the later one gives up rings until they are apart
    let cells = null, member = null, ok = false;
    for (; end >= minRings - 1; end--) {
      member = new Uint8Array(nV); cells = []; for (let k = 0; k <= end; k++) for (const v of rings[k]) { member[v] = 1; cells.push(v); }
      let clash = false, twin = false;
      for (const L of list) { let both = 0; for (const v of cells) if (L.member[v]) both++; if (!both) continue; const small = Math.min(cells.length, L.cells.length); if (both < small) clash = true; else if (small > 0.6 * Math.max(cells.length, L.cells.length)) twin = true; }
      if (twin) break;
      if (!clash) { ok = true; break; }
    }
    if (!ok) continue;
    const girth = rings[end].length, hoopR = 12 * cells.length / (girth * girth); if (hoopR < minHoop) continue;
    list.push({ id: list.length, kind: sd.kind, seed: sd.cells, cells, member, d, rings: end + 1, girth, hoop: hoopR, parent: -1 });
  }
  const of = new Int32Array(nV).fill(-1);
  for (const L of [...list].sort((a, b) => b.cells.length - a.cells.length)) { for (const v of L.cells) of[v] = L.id; }   // the smallest limb last
  for (const L of list) { let best = -1; for (const M of list) if (M !== L && M.cells.length > L.cells.length && M.member[L.cells[0]] && (best < 0 || M.cells.length < list[best].cells.length)) best = M.id; L.parent = best; }
  return { list, of };
}
/** The parts of the shape as the rings see it (lev: the ring of every cell, hops from the start). The cells of one ring fall
 *  into connected bands; a band followed by one band is the same part going on, by several a JUNCTION (the front splits:
 *  a branch) and several bands running into one a MERGE (a handle closes, two legs meet). Small side parts — the corners
 *  a rim cuts off a ring, fewer than `minCells` cells with everything behind them — belong to the part they hang on.
 *  A part whose bands close on themselves is a TUBE (a branch, a trunk, a leg), one that grows from the start cell or
 *  ends in a point a CAP (a cone, a dome, a tip), the rest are SHEETs.
 *  → { partOf: Int32Array, parts: [{ id, kind, cells, from, to (rings), parent, children }] } */
export function ringParts(w, nbr, lev, minCells = Math.max(6, Math.round(0.03 * w.nV))) {
  const nV = w.nV, band = new Int32Array(nV).fill(-1), bands = [];
  for (let v = 0; v < nV; v++) {
    if (band[v] >= 0 || lev[v] < 0) continue;
    const id = bands.length, cells = [v]; band[v] = id;
    for (let q = 0; q < cells.length; q++) for (const u of nbr[cells[q]]) if (band[u] < 0 && lev[u] === lev[v]) { band[u] = id; cells.push(u); }
    let inner = 0; for (const x of cells) for (const u of nbr[x]) if (u > x && band[u] === id) inner++;
    bands.push({ id, lev: lev[v], cells, up: new Set(), down: new Set(), ring: cells.length >= 3 && inner >= cells.length });   // closes on itself: as many links as cells
  }
  for (let v = 0; v < nV; v++) if (band[v] >= 0) for (const u of nbr[v]) if (band[u] >= 0 && lev[u] === lev[v] + 1) { bands[band[v]].up.add(band[u]); bands[band[u]].down.add(band[v]); }
  // chains of bands: a part goes on while one band follows one band
  let parts = []; const partOfBand = new Int32Array(bands.length).fill(-1);
  for (const b of [...bands].sort((x, y) => x.lev - y.lev)) {
    if (partOfBand[b.id] >= 0) continue;
    const P = { bands: [], parent: null, children: new Set(), size: 0 }; parts.push(P);
    for (let c = b; c;) { partOfBand[c.id] = parts.length - 1; P.bands.push(c); P.size += c.cells.length; const next = c.up.size === 1 ? bands[[...c.up][0]] : null; c = next && next.down.size === 1 && partOfBand[next.id] < 0 ? next : null; }
  }
  const link = () => { for (const P of parts) { P.children = new Set(); P.parent = null; } parts.forEach((P, i) => { for (const d of P.bands[0].down) { const Q = parts[partOfBand[d]]; if (Q !== P) { if (!P.parent) P.parent = Q; Q.children.add(P); } } }); };
  const absorb = (P, Q) => { Q.bands.push(...P.bands); Q.bands.sort((x, y) => x.lev - y.lev); Q.size += P.size; parts = parts.filter(x => x !== P); parts.forEach((x, i) => { for (const c of x.bands) partOfBand[c.id] = i; }); };
  for (let guard = 0; guard < bands.length; guard++) {
    link();
    // a small part with nothing behind it → the part it hangs on; then a part with one part behind it, that hangs on nothing else, goes on in it
    const leaf = parts.find(P => P.parent && !P.children.size && P.size < minCells);
    if (leaf) { absorb(leaf, leaf.parent); continue; }
    const chain = parts.find(P => P.children.size === 1 && [...P.children][0].bands[0].down.size >= 1 && [...[...P.children][0].bands[0].down].every(d => parts[partOfBand[d]] === P));
    if (chain) { absorb([...chain.children][0], chain); continue; }
    break;
  }
  link();
  const out = parts.map((P, id) => {
    const first = P.bands[0], lastLev = P.bands[P.bands.length - 1].lev, rings = P.bands.filter(x => x.ring).length, point = first.cells.length <= 2 && first.down.size === 0;
    const tip = !P.children.size && P.bands.filter(x => x.lev === lastLev).every(x => x.cells.length <= 3 && !x.cells.some(v => w.boundary[v]));   // ends in a point, not on a rim
    const kind = point || tip ? 'cap' : rings >= 0.6 * P.bands.length ? 'tube' : 'sheet';
    return { id, kind, cells: P.bands.flatMap(x => x.cells), from: first.lev, to: lastLev, parent: -1, children: [], splits: P.children.size > 1 };
  });
  parts.forEach((P, id) => { if (P.parent) { out[id].parent = parts.indexOf(P.parent); out[out[id].parent].children.push(id); } });
  const partOf = new Int32Array(nV).fill(-1); for (const P of out) for (const v of P.cells) partOf[v] = P.id;
  return { partOf, parts: out };
}
