// patterns.js — the weave patterns of the practice (Options → 3 Pattern).
//
// A pattern turns the lattice into a weave. The practice's own weave — one strip through every edge midpoint of the
// lattice, over and under in turn (weave.js) — is the hexagonal weave, 六角孔編. Every other pattern is made from it with
// one of three parts, and a new pattern is a new entry of PATTERNS made of the same parts:
//
//   rule     another over / under on the same strands — the star in rounds, 蛛網編 read as rounds of wide strips
//   lattice  the weave of a lattice derived from the lattice, with its own rule — the mad weave, 亀甲編 (the √3 lattice)
//   guests   strips the lattice does not have, beside or between the weave's own (guests.js) — the hemp leaf, 麻葉編
//            (the 米 strips through the middle of the cells), the star weave, 蛛網編 (every strand in n strips)
//
// Whatever the parts, what comes out is a weave as weave.js makes it (strands, crossings on lattice edges, a ring of
// crossings round every cell), so the planners read it without knowing the pattern. A pattern adds: w.overRaw (its
// over / under), w.level(strand, crossing) (how many strips lie beneath the strip there — a pattern can be three strips
// deep), w.pattern (what it is, in words) — and, with guests, w.x: the weave with the guests as strands of their own,
// which the view, the History bar, the lengths and the exports read (the planners keep to w).
//
// The sources of the three patterns (Ji, 19 Nov 2026):
//   蛛網編 and 麻葉編 — 居有竹, 竹編基礎教學 · 基礎編法 (bamboo.nanguan.org.tw): the step-by-step sheets 蛛網(轉框) and 麻葉(轉框)
//   mad weave — H. A. Verrill, Symmetries of mad weave patterns, J. Math. Arts 20 (2026): every strip 2-1 twill with the
//               strips of both other directions; the top layer is the rhombic tiling

import { buildWeave, vertexNormals, medianEdge } from './weave.js';
import { wedgeLattice, embedLattice } from './lattices.js';
import { extendWeave } from './guests.js';
import { bandWeave, bandGuests } from './bands.js';

// --- small tools on a weave ----------------------------------------------------------------------------------------
const adjacency = (w) => { const nbr = Array.from({ length: w.nV }, () => []); for (const [a, b] of w.edges) { nbr[a].push(b); nbr[b].push(a); } return nbr; };
/** how many cells away every cell is from one cell (−1: not reached) */
function hops(nbr, from) { const d = new Int32Array(nbr.length).fill(-1), q = [from]; d[from] = 0; for (let h = 0; h < q.length; h++) { const v = q[h]; for (const u of nbr[v]) if (d[u] < 0) { d[u] = d[v] + 1; q.push(u); } } return d; }
/** the two segments of strand s that meet at its crossing i: [before, after], each [triangle, corner it wraps] or null */
function segsAt(s, i) { const K = s.knots.length, nseg = s.closed ? K : K - 1, jb = s.closed ? (i - 1 + K) % K : i - 1, ja = i < nseg ? i : -1; return [jb >= 0 ? s.segs[jb] : null, ja >= 0 ? s.segs[ja] : null]; }
/** a crossing of two strips (not a loose end at the rim) */
const realKnot = (w, e) => w.edgeTris[e].length === 2 && w.knotStrands[e].length === 2;
/** the vertex after v in the winding of triangle t */
const nextIn = (F, t, v) => { for (let k = 0; k < 3; k++) if (F[3 * t + k] === v) return F[3 * t + (k + 1) % 3]; return -1; };
/** an over / under table in place of the weave's own: ov[strand][crossing] = 1 where the strip is on top (read from the side of the normals) */
function setOver(w, ov) { w.ov = ov; w.overRaw = (si, i) => ov[si][i] === 1; }

/** THE LAYERS. Where strips are wide, three of them lie on each other in every triangle of the lattice: the one that is
 *  over at both of its crossings there is on top (2), the one that is under at both lies on the surface (0), the third
 *  between them (1). At a crossing a strip is half-way between its layers in the two triangles it leaves and enters, so
 *  a strip that dives from the top to the bottom passes 2 → 1½ → ½ → 0. A triangle whose three strips go round — each
 *  over the next, as in the open hexagonal weave — has no stack: there over is 1½ and under ½.
 *  → w.level(si, i) at a crossing, w.midLevel(si, j) along segment j (the layer in its triangle, null without a stack) */
function setLevels(w) {
  const ov = w.ov, rank = new Float32Array(3 * w.nT).fill(1), full = new Uint8Array(3 * w.nT);
  w.strands.forEach((s, si) => {
    const K = s.knots.length, nseg = s.closed ? K : K - 1;
    for (let j = 0; j < nseg; j++) {
      const i1 = (j + 1) % K, r0 = realKnot(w, s.knots[j]), r1 = realKnot(w, s.knots[i1]), n = (r0 ? 1 : 0) + (r1 ? 1 : 0), c = (r0 ? ov[si][j] : 0) + (r1 ? ov[si][i1] : 0), [t, k] = s.segs[j];
      rank[3 * t + k] = n === 2 ? c : n === 1 ? 2 * c : 1; full[3 * t + k] = n === 2 ? 1 : 0;
    }
  });
  // at the rim two loose ends lie in one triangle without crossing each other there: where the count leaves two strips
  // in one layer, one goes on the other (the order of the triangle's corners decides — nothing depends on it)
  for (let t = 0; t < w.nT; t++) {
    if (full[3 * t] && full[3 * t + 1] && full[3 * t + 2]) continue;
    const o = [0, 1, 2].sort((x, y) => (rank[3 * t + x] - rank[3 * t + y]) || (x - y));
    if (rank[3 * t + o[0]] !== rank[3 * t + o[1]] && rank[3 * t + o[1]] !== rank[3 * t + o[2]]) continue;
    o.forEach((k, r) => { rank[3 * t + k] = r; });
  }
  const flat = new Uint8Array(w.nT);                                // the three strips of the triangle lie in a stack
  for (let t = 0; t < w.nT; t++) { const a = rank[3 * t], b = rank[3 * t + 1], c = rank[3 * t + 2]; flat[t] = !(full[3 * t] && full[3 * t + 1] && full[3 * t + 2]) || (a !== b && b !== c && a !== c) ? 1 : 0; }
  const lev = w.strands.map((s, si) => {
    const L = new Float32Array(s.knots.length);
    for (let i = 0; i < L.length; i++) { let sum = 0, n = 0; for (const sg of segsAt(s, i)) { if (!sg) continue; sum += flat[sg[0]] ? rank[3 * sg[0] + sg[1]] : (ov[si][i] ? 1.5 : 0.5); n++; } L[i] = n ? sum / n : (ov[si][i] ? 1.5 : 0.5); }
    return L;
  });
  w.lev = lev; w.segRank = rank; w.flatTri = flat; w.layers = 3;
  w.level = (si, i) => (w.side < 0 ? 2 - lev[si][i] : lev[si][i]);
  // between two crossings a strip lies in its layer of the triangle it runs through (null: no stack there)
  w.midLevel = (si, j) => { const [t, k] = w.strands[si].segs[j]; if (!flat[t]) return null; const r = rank[3 * t + k]; return w.side < 0 ? 2 - r : r; };
  let nFlat = 0, nIn = 0; for (let t = 0; t < w.nT; t++) if (full[3 * t] && full[3 * t + 1] && full[3 * t + 2]) { nIn++; nFlat += flat[t]; }
  return { stacked: nFlat, triangles: nIn };
}

// --- the star weave, 蛛網編 -------------------------------------------------------------------------------------------
/** the cell a star is centred on when none is picked: a singular cell — the highest one; on a lattice without one, the
 *  cell farthest from the rim (the middle of a patch), else the highest cell */
export function defaultCentre(w) {
  let best = -1, bz = -Infinity;
  for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6 && w.V[3 * v + 2] > bz + 1e-9) { bz = w.V[3 * v + 2]; best = v; }
  if (best >= 0) return best;
  const nbr = adjacency(w), d = new Int32Array(w.nV).fill(-1), q = [];
  for (let v = 0; v < w.nV; v++) if (w.boundary[v]) { d[v] = 0; q.push(v); }
  if (q.length) { for (let h = 0; h < q.length; h++) { const v = q[h]; for (const u of nbr[v]) if (d[u] < 0) { d[u] = d[v] + 1; q.push(u); } } let bd = -1; for (let v = 0; v < w.nV; v++) if (d[v] > bd) { bd = d[v]; best = v; } return best; }
  for (let v = 0; v < w.nV; v++) if (w.V[3 * v + 2] > bz) { bz = w.V[3 * v + 2]; best = v; }
  return Math.max(0, best);
}

/** the singular cells of the lattice: inside the rim, with other than six sides */
export function singularCells(w) { const out = []; for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) out.push(v); return out; }

// THE STAR WEAVE (蛛網編, 星紋編: "以六角孔起底，往六邊向外堆疊竹篾") is made in rounds round a cell: round 1 is the ring of the
// hexagonal weave round that cell; every further round lies outside the last, one strip on every side, and a new strip is
// pushed under the strips already lying across its place (the "V" of the sheet: 挑起v字形竹篾，加入新竹篾).
// Until 19 Nov the practice read a round as a strand of the lattice (round r on a side = the strand between ring r − 1
// and ring r, drawn wide). Ji's rattan ball shows the weave as it is made: every side of a hole has n strips lying
// against each other, and the hole stays open — a BAND of n strips where the hexagonal weave has one (bands.js). So the
// star weave is the hexagonal weave with every strand in n strips: where two bands cross, n × n crossings; at the corners
// of a CENTRE they nest as the sheet's V — the strip of the earlier round, nearer the hole, on top. Any number of cells
// can be a centre (Ji: "one singular, and make option for picked, select every singular").

// STAR IN ROUNDS. The first reading stays in the library as a pattern of its own (Ji, 19 Nov night: "bring the previous
// star weave pattern as a new pattern in our library"): the same strands as the hexagonal weave, one strip each, wide
// enough to close on each other, and another over / under. Round one cell at first; since 20 Nov round as many as the
// star weave (Ji: "also needs multiple centres and set every singular, same as star weave"): every crossing is woven
// by the rule of the centre it is nearest to.
/** THE RULE OF THE ROUNDS. The strip of round r on a side is the strand that runs between ring r − 1 and ring r of cells
 *  there, a new strip is pushed under the strips already lying across its place, under the strip added before it in the
 *  same round and over the next one. With rho the ring of a cell (hops from the centre) and R the round of a strand
 *  (1 + the lowest ring it touches), the sheet's steps come to:
 *    a crossing between two rings (its edge joins ring r − 1 and ring r):  the strip of the later round is underneath
 *    a crossing on a ring (its edge joins two cells of one ring):           the strip of the later round is on top
 *    the same round:  between two rings — at a corner of the round — the strip of the side counter-clockwise of the
 *                     corner is on top; on a ring — where the two strips of the neighbouring sides meet over the middle
 *                     of a side — the one from the clockwise side is on top  (hand −1: the mirror image)
 *  Round 1 by this rule is the hexagonal weave itself. `rounds` > 0: only strands of the first `rounds` rounds are woven
 *  this way, the rest over and under in turn.
 *  SEVERAL CENTRES (`centres`: a cell or a list of cells): rings and rounds are counted from every centre, and a crossing
 *  is woven by the rule of the centre it is nearest to (the two cells of its edge together; a tie: the centre named
 *  first) — the stars meet where the rounds of two centres are equally far.
 *  → { centre: the first one, centres, round: the round of every strand (from the centre it comes nearest to), ring: the
 *  ring of every cell (from its nearest centre), owner: per crossing the centre whose rule it follows (index into
 *  centres, −1: none), rounds: the last round woven by the rule, allRounds, starred: crossings woven by the rule, inRule } */
function starRule(w, centres, rounds, hand) {
  const cs = Array.isArray(centres) ? centres : [centres];
  const F = w.F, nbr = adjacency(w), nS = w.strands.length, BIG = 0x3fffffff;
  const rhos = cs.map(c => hops(nbr, c));
  const Rs = rhos.map(rh => { const Rk = new Int32Array(nS).fill(BIG); w.strands.forEach((s, si) => { for (const e of s.knots) { const [a, b] = w.edges[e]; if (rh[a] < 0 || rh[b] < 0) continue; const m = 1 + Math.min(rh[a], rh[b]); if (m < Rk[si]) Rk[si] = m; } }); return Rk; });
  const owner = new Int32Array(w.nE).fill(-1);
  for (let e = 0; e < w.nE; e++) { const [a, b] = w.edges[e]; let bs = Infinity, bm = Infinity; rhos.forEach((rh, k) => { if (rh[a] < 0 || rh[b] < 0) return; const sum = rh[a] + rh[b], mn = Math.min(rh[a], rh[b]); if (sum < bs || (sum === bs && mn < bm)) { bs = sum; bm = mn; owner[e] = k; } }); }
  const ov = w.strands.map((s, si) => { const o = new Uint8Array(s.knots.length); for (let i = 0; i < o.length; i++) o[i] = w.plainOver(si, i) ? 1 : 0; return o; });
  const wraps = (si, i, t) => { for (const sg of segsAt(w.strands[si], i)) if (sg && sg[0] === t) return F[3 * t + sg[1]]; return -1; };
  const leftOf = (e, a, b) => { for (const t of w.edgeTris[e]) if (nextIn(F, t, a) === b) return t; return -1; };   // the triangle on the left of a → b
  const third = (t, a, b) => { for (let k = 0; k < 3; k++) { const v = F[3 * t + k]; if (v !== a && v !== b) return v; } return -1; };
  const set = [], inRule = new Uint8Array(w.nE); let agree = 0, differ = 0, last = 0, allLast = 0;
  for (let e = 0; e < w.nE; e++) {
    if (!realKnot(w, e) || owner[e] < 0) continue;
    const [[sp, ip], [sq, iq]] = w.knotStrands[e], [a, b] = w.edges[e], rho = rhos[owner[e]], R = Rs[owner[e]];
    if (rho[a] < 0 || rho[b] < 0) continue;
    if (R[sp] < BIG && R[sq] < BIG) allLast = Math.max(allLast, R[sp], R[sq]);   // (the rounds there are: as counted at each crossing from its own centre)
    if (rounds > 0 && (R[sp] > rounds || R[sq] > rounds)) continue;
    const between = rho[a] !== rho[b]; let pOver = null;
    if (sp !== sq && R[sp] !== R[sq]) pOver = between ? R[sp] < R[sq] : R[sp] > R[sq];
    else if (between) { const u = rho[a] < rho[b] ? a : b, v = u === a ? b : a, t = leftOf(e, u, v), x = t >= 0 ? wraps(sp, ip, t) : -1; if (x >= 0) pOver = (x === u) === (hand > 0); }
    else { const inner = w.edgeTris[e].filter(t => rho[third(t, a, b)] === rho[a] - 1); if (inner.length === 1) { const t = inner[0], c = nextIn(F, t, a) === b ? a : b, x = wraps(sp, ip, t); if (x >= 0) pOver = (x === c) === (hand > 0); } }
    if (pOver === null) continue;
    if (R[sp] === 1 && R[sq] === 1) { if ((ov[sp][ip] === 1) === pOver) agree++; else differ++; }
    set.push([sp, ip, sq, iq, pOver]); inRule[e] = 1; last = Math.max(last, R[sp], R[sq]);
  }
  // the plain weave outside the star goes the same way round as the star's first round
  if (differ > agree) for (let si = 0; si < nS; si++) for (let i = 0; i < ov[si].length; i++) ov[si][i] ^= 1;
  for (const [sp, ip, sq, iq, pOver] of set) { ov[sp][ip] = pOver ? 1 : 0; ov[sq][iq] = pOver ? 0 : 1; }
  setOver(w, ov);
  // (for the record: every strand's round and every cell's ring, from the centre nearest to it)
  const R = new Int32Array(nS).fill(BIG), rho = new Int32Array(w.nV).fill(-1);
  for (let k = 0; k < cs.length; k++) { for (let si = 0; si < nS; si++) if (Rs[k][si] < R[si]) R[si] = Rs[k][si]; for (let v = 0; v < w.nV; v++) if (rhos[k][v] >= 0 && (rho[v] < 0 || rhos[k][v] < rho[v])) rho[v] = rhos[k][v]; }
  let maxR = 0; for (let si = 0; si < nS; si++) if (R[si] < BIG && R[si] > maxR) maxR = R[si];
  if (cs.length === 1 || !allLast) allLast = maxR;                 // (one centre: the round of the strand furthest out, as ever)
  return { centre: cs[0], centres: cs.slice(), round: R, ring: rho, owner, rounds: rounds > 0 ? Math.min(rounds, allLast) : allLast, allRounds: allLast, starred: set.length, inRule };
}

// --- the mad weave, 亀甲編 -------------------------------------------------------------------------------------------
/** THE √3 LATTICE of a lattice: a new cell in the middle of every triangle, joined to the triangle's three cells and to
 *  the new cells of the three triangles beside it; the old edges are gone. Every old cell keeps its number of sides,
 *  every new cell has six: a singular cell stays the only singular thing. The new cell is lifted onto the curved surface
 *  (half-way to the mean of its projections on the tangent planes of the three cells: exact on a sphere).
 *  At the rim the lattice goes on by one new cell beyond every rim edge (the cell in the middle of the rim triangle,
 *  mirrored in the middle of the edge), so that a rim edge is crossed by an edge between two new cells like any other:
 *  every edge of the lattice has its rhombus, and all triangles are alike — the strips run straight out over the rim.
 *  → { V, F, nBase: the first nBase vertices are the lattice's own cells, nRim: the cells added beyond the rim (the last ones) } */
export function sqrt3(V, F) {
  const nV = V.length / 3, nT = F.length / 3, N = vertexNormals(V, F);
  const twin = new Map(), key = (a, b) => a * nV + b;
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) twin.set(key(F[3 * t + k], F[3 * t + (k + 1) % 3]), t);
  let nRim = 0; for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) if (!twin.has(key(F[3 * t + (k + 1) % 3], F[3 * t + k]))) nRim++;
  const V2 = new Float64Array(3 * (nV + nT + nRim)); V2.set(V);
  for (let t = 0; t < nT; t++) {
    const c = [0, 0, 0], p = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const v = F[3 * t + k]; for (let d = 0; d < 3; d++) c[d] += V[3 * v + d] / 3; }
    for (let k = 0; k < 3; k++) { const v = F[3 * t + k], h = (c[0] - V[3 * v]) * N[3 * v] + (c[1] - V[3 * v + 1]) * N[3 * v + 1] + (c[2] - V[3 * v + 2]) * N[3 * v + 2]; for (let d = 0; d < 3; d++) p[d] += (c[d] - h * N[3 * v + d]) / 3; }
    for (let d = 0; d < 3; d++) V2[3 * (nV + t) + d] = c[d] + 0.5 * (p[d] - c[d]);
  }
  const F2 = new Int32Array(9 * nT + 3 * nRim); let m = 0, x = nV + nT;
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], o = twin.get(key(b, a));
    if (o !== undefined) { F2[m++] = a; F2[m++] = nV + o; F2[m++] = nV + t; continue; }   // (the cell, the new cell on its right, the one on its left)
    for (let d = 0; d < 3; d++) V2[3 * x + d] = V[3 * a + d] + V[3 * b + d] - V2[3 * (nV + t) + d];   // beyond the rim edge a → b
    F2[m++] = a; F2[m++] = x; F2[m++] = nV + t; F2[m++] = b; F2[m++] = nV + t; F2[m++] = x; x++;
  }
  return { V: V2, F: F2, nBase: nV, nRim };
}

/** THE MAD WEAVE RULE. The strips are as wide as their spacing, so three lie on each other everywhere, and the top layer
 *  is the rhombic tiling (Verrill 2026, fig. 2): six rhombi round a star point, three round a cube corner. On the √3
 *  lattice the star points are the lattice's own cells and the cube corners the new ones; a rhombus is the two triangles
 *  on either side of an edge between two new cells — one rhombus for every edge of the lattice — and the strip on top of
 *  it runs along the side that comes first clockwise as seen from its star point (hand −1: counter-clockwise, the mirror
 *  image). That is, for a crossing on
 *    a spoke (a cell v — a new cell c):       the strip that wraps v in the triangle on the left of v → c is on top
 *    a short diagonal (two new cells):         in a triangle (v, c1, c2) wound from its cell v, the strip that wraps c2
 *  which gives every strip over 1 · under 2 with one of the other directions and over 2 · under 1 with the other, and in
 *  every triangle a stack: the strip along the clockwise spoke on top, the strip round the star point in the middle. The
 *  rule only looks at one star point at a time, so it holds unchanged round a cell of 5 or 7 sides (a star of 5 or 7). */
function madRule(w, nB, hand) {
  const F = w.F, ov = w.strands.map(s => new Uint8Array(s.knots.length));
  w.strands.forEach((s, si) => {
    for (let i = 0; i < s.knots.length; i++) {
      const e = s.knots[i]; if (!realKnot(w, e)) continue;
      const [sb, sa] = segsAt(s, i), sg = sa || sb; if (!sg) continue;
      const [t, k] = sg, x = F[3 * t + k], [p, q] = w.edges[e], pB = p < nB, qB = q < nB; let over;
      if (pB !== qB) { const v = pB ? p : q, c = pB ? q : p; over = nextIn(F, t, v) === c ? x === v : x === c; }
      else if (!pB) { let o = -1; for (let m = 0; m < 3; m++) { const u = F[3 * t + m]; if (u !== p && u !== q) o = u; } over = x === nextIn(F, t, nextIn(F, t, o)); }
      else continue;
      ov[si][i] = (hand < 0 ? !over : over) ? 1 : 0;
    }
  });
  setOver(w, ov);
}

// --- the hemp leaf, 麻葉編 -------------------------------------------------------------------------------------------
/** THE CENTRE STRIPS (米字竹篾) of the hemp leaf: one along every line of the lattice, through the middle of the cells — in a
 *  six-sided cell three of them cross, the 米 — and at every crossing of the hexagonal weave between its two strips
 *  ("中心橘色竹篾皆會被夾於兩條竹篾間"). A line goes straight on through a cell with an even number of sides; in a cell with an
 *  odd number (5, 7) no edge lies opposite, and the strip ends there, in the middle of the cell (Ji, 19 Nov: "all end in
 *  the cell"); at the rim it ends in the rim cell. A rim edge carries none (no crossing would hold it).
 *  → { strands: [{ cells, edges, closed, length, ends: ['odd' | 'rim' | 'turn', …] }], at: cell → [[strand, place]] } */
export function traceInlays(w) {
  const inner = (e) => w.edgeTris[e].length === 2, used = new Uint8Array(w.nE), strands = [];
  const across = (v, e) => {                                       // the edge opposite to e in cell v, or −1
    const ring = w.cellKnots[v], n = ring.length, i = ring.indexOf(e); if (i < 0) return -1;
    if (!w.boundary[v]) return n % 2 ? -1 : ring[(i + n / 2) % n];
    const j = i + 3 < n ? i + 3 : i - 3 >= 0 ? i - 3 : -1;         // a rim cell: its edges fan out 60° apart
    return j >= 0 && inner(ring[j]) ? ring[j] : -1;
  };
  const other = (e, v) => (w.edges[e][0] === v ? w.edges[e][1] : w.edges[e][0]);
  for (let e0 = 0; e0 < w.nE; e0++) {
    if (used[e0] || !inner(e0)) continue;
    used[e0] = 1; const [a0, b0] = w.edges[e0], cells = [a0, b0], edges = [e0]; let closed = false;
    for (let v = b0, e = e0; ;) { const f = across(v, e); if (f < 0 || !inner(f)) break; if (f === e0) { closed = true; break; } if (used[f]) break; used[f] = 1; v = other(f, v); edges.push(f); cells.push(v); e = f; }
    if (!closed) for (let v = a0, e = e0; ;) { const f = across(v, e); if (f < 0 || !inner(f) || used[f]) break; used[f] = 1; v = other(f, v); edges.unshift(f); cells.unshift(v); e = f; }
    if (closed) cells.pop();
    let length = 0; for (const e of edges) length += w.edgeLen[e];
    const endKind = (v) => (w.boundary[v] ? 'rim' : w.valence[v] % 2 ? 'odd' : 'turn');
    strands.push({ cells, edges, closed, length, ends: closed ? [] : [endKind(cells[0]), endKind(cells[cells.length - 1])] });
  }
  const at = Array.from({ length: w.nV }, () => []);
  strands.forEach((s, si) => s.cells.forEach((v, j) => at[v].push([si, j])));
  return { strands, at };
}
/** the order in which the centre strips lie on each other in every cell: the one laid first at the bottom (as Ji's rule
 *  for a joint: "first always on the bottom") — the strip whose first crossing is made first; `when(e)`: the step at
 *  which the crossing on lattice edge e is made. Without a plan: by number. */
export function stackInlays(w, when = null) {
  const I = w.inlay; if (!I) return;
  I.strands.forEach((s, si) => { s.id = si; s.first = when ? Math.min(...s.edges.map(e => { const t = when(e); return t >= 0 ? t : Infinity; })) : si; });
  for (const list of I.at) list.sort((x, y) => (I.strands[x[0]].first - I.strands[y[0]].first) || (x[0] - y[0]));
}

/** THE CENTRE STRIPS AS GUESTS (guests.js). A centre strip runs: the middle of a cell — the crossing on the next lattice
 *  edge, where it lies between the two strips of the hexagonal weave (layer 1 of three) — the middle of the next cell …
 *  In the middle of a cell the strips that cross there lie on each other (which one first: the plan says, wx.restack);
 *  a strip that ends in a cell of 5 or 7 sides stops short of its middle. `back`: how far short (model units). */
function hempGuests(w, I, back) {
  const nE = w.nE, pos = [], nrm = [], xOfCell = new Int32Array(w.nV).fill(-1), stacks = new Map();
  const newX = (p, n) => { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); return nE + pos.length / 3 - 1; };
  const V = (v) => [w.V[3 * v], w.V[3 * v + 1], w.V[3 * v + 2]], Nv = (v) => [w.N[3 * v], w.N[3 * v + 1], w.N[3 * v + 2]];
  const M = (e) => [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]], Ne = (e) => [w.edgeNrm[3 * e], w.edgeNrm[3 * e + 1], w.edgeNrm[3 * e + 2]];
  const strands = I.strands.map((s, g) => {
    const n = s.cells.length, K = s.edges.length, knots = [], quiet = [], lv = [], between = [];
    const cell = (j) => {
      const v = s.cells[j], end = !s.closed && (j === 0 || j === n - 1), odd = end && !w.boundary[v] && I.at[v].length !== 1;
      let x;
      if (odd) { const p = V(v), m = M(s.edges[j === 0 ? 0 : K - 1]), d = [m[0] - p[0], m[1] - p[1], m[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, b = Math.min(0.45 * l, back); x = newX([p[0] + b * d[0] / l, p[1] + b * d[1] / l, p[2] + b * d[2] / l], Nv(v)); }
      else { if (xOfCell[v] < 0) { xOfCell[v] = newX(V(v), Nv(v)); stacks.set(xOfCell[v], []); } x = xOfCell[v]; stacks.get(x).push([g, knots.length]); }
      knots.push(x); quiet.push(1); lv.push(1); between.push(-1);
    };
    for (let j = 0; j < K; j++) { cell(j); const e = s.edges[j]; knots.push(newX(M(e), Ne(e))); quiet.push(0); lv.push(1); between.push(e); }
    if (!s.closed) cell(n - 1);
    return { knots, closed: s.closed, family: -1, host: -1, tag: '', quiet: Uint8Array.from(quiet), lv: Float32Array.from(lv), over: new Uint8Array(knots.length), between: Int32Array.from(between) };
  });
  return { kind: 'centre', top: 2, pos, nrm, moved: null, strands, baseLv: null, path: null, cover: null, stacks };
}

// --- the patterns ---------------------------------------------------------------------------------------------------
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** id → { name, native (the craft's own names), about (the card's tooltip), lath (strip width and thickness the pattern
 *  is drawn with, in lattice edges of its weave; null: the page's own), the controls it has — centres (cells picked on
 *  the model; 'one': a single cell), strips (how many in a band), rounds (how many rounds its rule weaves), hand (the
 *  mirror image), method (how its guests are woven in), order (the order its guests are threaded in) —,
 *  fitsWidth: the weave itself depends on the strip width, thin: its strips are flat (no thicker than a quarter of their
 *  width), build(V, F, spec) → the weave, style(w, spec): the rule again in place (other centres, the mirror image) } */
export const PATTERNS = {
  hex: {
    id: 'hex', name: 'Hexagonal weave', native: '六角孔編 · 六つ目編み',
    about: 'The open triaxial weave: one strip through every crossing of the lattice, over and under in turn. Every cell is an open hole with as many sides as the cell — the weave the lattice is drawn for.',
    lath: null,
    build(V, F) { const w = buildWeave(V, F); w.layers = 2; w.level = (si, i) => (w.over(si, i) ? 1 : 0); w.pattern = { id: 'hex', spec: {}, sum: '', text: 'one strip through every crossing, over and under in turn' }; return w; },
  },
  star: {
    id: 'star', name: 'Star weave', native: '蛛網編 · 星紋編', centres: true, strips: true, order: true, hand: true, fitsWidth: true, thin: true,
    about: 'The hexagonal weave with every strand in several strips lying against each other: a band on every side of a hole, and the hole stays open. Where two bands cross, every strip of one crosses every strip of the other; at the corners of a centre they nest as a V — the strip nearer the hole on top — as when the weave is built in rounds round that cell, each new strip pushed under the last. The centre is a singular cell until you pick others, or take every singular cell.',
    lath: null,                                                    // (the strips are as wide as fit side by side in a band: w.pattern.lath)
    build(V, F, spec) { const w = buildWeave(V, F); w.plainOver = w.overRaw; this.style(w, spec); return w; },
    style(w, spec = {}) {
      const n = Math.max(2, Math.min(5, (spec.strips | 0) || 3)), hand = spec.hand < 0 ? -1 : 1, sing = singularCells(w);
      let centres = spec.centres === 'singular' ? sing.slice() : Array.isArray(spec.centres) ? [...new Set(spec.centres.filter(c => Number.isInteger(c) && c >= 0 && c < w.nV))] : [];
      const auto = !centres.length && spec.centres !== 'singular'; if (!centres.length) centres = [defaultCentre(w)];
      // THE WIDTH. The strips of a band lie side by side, a hair apart (GAP). A band can be as wide as closes the triangles
      // of the hexagonal weave and no wider — its strips would meet a third band's before they are past the second's
      // (bands.js: fit, 0.289 a on a lattice of equal edges). On a lattice of unequal edges that differs from place to
      // place. The pattern's own width fits EVERYWHERE (the shortest stretch decides): three bands in one place cannot be
      // drawn — or woven — with a strip on top of each crossing, and it was at the short edges round the centres that the
      // layers could not be read (Ji, 19 Nov night). The widest that can be set is the one that closes the triangles
      // where the lattice has its median edge; then the strips run into each other on the shorter stretches (`tight`).
      const a = spec.a > 0 ? spec.a : medianEdge(w), GAP = 0.06, L = {};
      w.overRaw = w.plainOver;
      const B = bandWeave(w, { n, centres, hand, pitchOf: (fit) => {
        const q = (f) => (fit.length ? fit[Math.floor(f * (fit.length - 1))] : 0.289 * a) * 0.985 / n / (1 + GAP);
        L.widest = q(0.5); L.own = Math.min(q(0), L.widest); L.width = spec.width > 0 ? Math.min(spec.width * a, L.widest) : L.own; L.pitch = L.width * (1 + GAP);
        return L.pitch;
      } }), G = bandGuests(w, B), { width, widest } = L;
      setOver(w, G.ov); w.layers = 2; w.level = (si, i) => (w.over(si, i) ? 1 : 0);
      w.band = B; w.x = extendWeave(w, G);
      let corners = 0, points = 0; for (const b of B.blocks.values()) { if (b.star === 'corner') corners++; else if (b.star === 'point') points++; }
      w.pattern = { id: 'star', spec: { centres: spec.centres === 'singular' ? 'singular' : auto ? [] : centres, strips: n, hand, width: spec.width > 0 ? spec.width : 0, a: spec.a > 0 ? spec.a : 0 }, centres, auto, all: spec.centres === 'singular', strips: n,
        lath: { width, widest, own: L.own, pitch: L.pitch }, tight: B.tight, stretches: B.fit.length, sum: `${n} strips · ${centres.length === 1 ? `centre #${centres[0]}` : `${centres.length} centres`}`,
        text: `every strand in ${n} strips, ${(width / a).toFixed(3)} a wide · ${plural(centres.length, 'centre')}${spec.centres === 'singular' ? ' (every singular cell)' : auto ? ' (the default)' : ''} · ${corners} corner and ${points} point blocks of ${B.blocks.size}${B.tight ? ` · the bands are wider than the lattice allows on ${B.tight} of ${B.fit.length} stretches (short edges): the strips run into each other there` : ''}` };
    },
  },
  rounds: {
    id: 'rounds', name: 'Star in rounds', native: '蛛網編 · wide strips', centres: true, rounds: true, hand: true,
    about: 'The star read as rounds of wide strips round a cell, as a spider builds its web: round 1 is the ring of the hexagonal weave, every further round lies outside the last and is pushed under the strips that already cross its place. The same strands as the hexagonal weave, one strip each, wide enough to close on each other. One centre by default, a singular cell (the highest one); pick others — any cell, also one with six sides — or take every singular cell: each crossing is then woven by the rounds of the centre it is nearest to.',
    lath: { width: 0.7, thickness: 0.04 },
    build(V, F, spec) { const w = buildWeave(V, F); w.plainOver = w.overRaw; this.style(w, spec); return w; },
    style(w, spec = {}) {
      // the centres, as the star weave has them: the cells picked, every singular cell, or — none picked — the default one
      // (spec.centre: a single cell, as plans of 19 and 20 Nov were saved)
      const sing = singularCells(w), all = spec.centres === 'singular';
      let centres = all ? sing.slice() : Array.isArray(spec.centres) ? [...new Set(spec.centres.filter(c => Number.isInteger(c) && c >= 0 && c < w.nV))] : [];
      if (!centres.length && !all && Number.isInteger(spec.centre) && spec.centre >= 0 && spec.centre < w.nV) centres = [spec.centre];
      const auto = !centres.length && !all; if (!centres.length) centres = [defaultCentre(w)];
      const centre = centres[0], hand = spec.hand < 0 ? -1 : 1, want = Math.max(0, spec.rounds | 0);
      const S = starRule(w, centres, want, hand), L = setLevels(w);
      w.star = S;
      const nC = centres.length, roundsText = `${plural(S.rounds, 'round')}${want > 0 && S.allRounds > S.rounds ? ` of ${S.allRounds}` : ''}`;
      w.pattern = { id: 'rounds', spec: { centres: all ? 'singular' : auto ? [] : centres, rounds: want, hand }, centre, centres, auto, all,
        sum: `${nC === 1 ? `centre #${centre}` : `${nC} centres`} · ${roundsText}`,
        text: `${nC === 1 ? `rounds round cell #${centre} (${w.boundary[centre] ? 'a rim cell' : w.valence[centre] + ' sides'}${auto ? ', the default' : ''})` : `rounds round ${nC} cells${all ? ' (every singular cell)' : ''}, each crossing by the centre it is nearest to`} · ${roundsText}${want > 0 && S.allRounds > S.rounds ? '' : nC > 1 ? ', until the stars meet' : w.boundary.some(Boolean) ? ', to the rim' : ', all the way round'} · ${S.starred} of ${w.edges.reduce((n, _, e) => n + (realKnot(w, e) ? 1 : 0), 0)} crossings by the rule of the rounds${L.stacked < L.triangles ? ` · ${L.triangles - L.stacked} triangles go round (no stack)` : ''}` };
    },
  },
  hemp: {
    id: 'hemp', name: 'Hemp leaf', native: '麻葉編 · 麻の葉編み', method: true,
    about: 'The hexagonal weave with a centre strip along every line of the lattice: three of them cross in the middle of every six-sided cell (the 米), and at every crossing the centre strip lies between the two strips of the hexagonal weave. The centre strips are threaded in after the hexagonal weave is made, or laid in as it is woven — your choice, by the material. In a cell of 5 or 7 sides the centre strips cannot go straight on: they end there.',
    lath: { width: 0.15, thickness: 0.04 },                        // narrow: the cells stay open, six triangles round every 米
    build(V, F) {
      const w = buildWeave(V, F); w.layers = 3; w.level = (si, i) => (w.over(si, i) ? 2 : 0);
      w.inlay = traceInlays(w); stackInlays(w);
      w.x = extendWeave(w, hempGuests(w, w.inlay, 0.55 * this.lath.width * medianEdge(w)));
      const I = w.inlay.strands, odd = new Set(); let nOdd = 0;
      for (const s of I) s.ends.forEach((k, j) => { if (k === 'odd') { nOdd++; odd.add(j ? s.cells[s.cells.length - 1] : s.cells[0]); } });
      w.pattern = { id: 'hemp', spec: {}, sum: plural(I.length, 'centre strip'), text: `${plural(I.length, 'centre strip')} (${I.filter(s => s.closed).length} closed)${nOdd ? ` · ${plural(nOdd, 'end')} in ${plural(odd.size, 'singular cell')}` : ''} · between the two strips of every crossing` };
      return w;
    },
  },
  mad: {
    id: 'mad', name: 'Mad weave', native: '亀甲編 · anyam gila', hand: true,
    about: 'Three layers of strips and no holes: every strip goes over two and under one (2-1 twill) with the strips of both other directions, and what shows is a tiling of rhombi. Every cell of the lattice becomes a star point (6 rhombi — 5 or 7 at a singular cell), every edge a rhombus, every triangle a cube corner: the weave is made on the √3 lattice, with strips half a lattice edge wide and three times the crossings.',
    lath: { width: 0.8, thickness: 0.04 },
    build(V, F, spec) { const r = sqrt3(V, F), w = buildWeave(r.V, r.F); w.nBase = r.nBase; w.nRimCells = r.nRim; w.refined = '√3'; this.style(w, spec); return w; },
    style(w, spec = {}) {
      const hand = spec.hand < 0 ? -1 : 1; madRule(w, w.nBase, hand); const L = setLevels(w);
      w.pattern = { id: 'mad', spec: { hand }, sum: hand < 0 ? 'mirror image' : '', text: `${plural(w.nBase, 'star point')} · ${plural(w.nV - w.nBase - (w.nRimCells || 0), 'cube corner')} · ${w.nE} crossings on the √3 lattice · three strips deep${L.stacked < L.triangles ? ` · ${L.triangles - L.stacked} triangles without a stack` : ''}` };
    },
  },
};
export const PATTERN_IDS = Object.keys(PATTERNS);

/** the weave of lattice (V, F — oriented, the laths on the side of the normals) in the pattern spec.id; for the patterns
 *  that have them: spec.centres (cells; [] the default one; 'singular': every singular cell), spec.centre (the one cell of
 *  the star in rounds; −1: the default), spec.strips (the strips of a band), spec.rounds (the rounds woven by the rule of
 *  the rounds; 0: every round), spec.hand (−1: the mirror image), spec.width (the strip width in lattice edges; 0: the
 *  pattern's own), spec.a (the lattice edge the width is counted in; 0: the median edge). With guests: w.x (guests.js). */
export function patternWeave(V, F, spec = {}) {
  const P = PATTERNS[spec && spec.id] || PATTERNS.hex, w = P.build(V, F, spec || {});
  w.baseV = V; w.baseF = F; if (w.nBase === undefined) w.nBase = w.nV;
  return w;
}
/** the pattern's rule again on the same weave, with other settings (the star's centre, the mirror image) */
export function restyle(w, spec = {}) { const P = PATTERNS[w.pattern.id]; if (P.style) P.style(w, { ...w.pattern.spec, ...spec }); return w; }
/** what a worker needs to make the same weave again: the lattice and the pattern as it is set */
export const patternJob = (w) => ({ V: w.baseV, F: w.baseF, pattern: { id: w.pattern.id, ...w.pattern.spec } });

// --- the pattern cards: a flat weave, painted ---------------------------------------------------------------------------
/** PAINT A FLAT WEAVE on a 2-D canvas, strips as bands with their edges, the right one on top everywhere. The lattice
 *  is cut into the six pieces of every triangle (from its middle to a corner and to the middle of a side); in a piece
 *  the three strips of the triangle are painted from the bottom up — by their stack where they have one, else the strip
 *  that does not cross here first, then the under strip of the crossing, then the over strip — and the centre strips of
 *  the corner cell between the two. o: { scale, cx, cy (canvas px of the lattice origin), width (strip width, lattice
 *  units), family: [three colours], inlay, edge (colours), line (px) } */
export function paintWeave(ctx, w, o) {
  const F = w.F, P2 = (x, y) => [o.cx + o.scale * x, o.cy - o.scale * y], X = (v) => P2(w.V[3 * v], w.V[3 * v + 1]), M = (e) => P2(w.edgeMid[3 * e], w.edgeMid[3 * e + 1]);
  const hw = 0.5 * o.width * o.scale, grow = 0.6;
  const band = (A, B, colour, ext0, ext1) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy * hw, ny = ux * hw;
    const a = [A[0] - ux * ext0, A[1] - uy * ext0], b = [B[0] + ux * ext1, B[1] + uy * ext1];
    ctx.beginPath(); ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.lineTo(b[0] - nx, b[1] - ny); ctx.lineTo(a[0] - nx, a[1] - ny); ctx.closePath();
    ctx.fillStyle = colour; ctx.fill();
    ctx.beginPath(); ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(b[0] - nx, b[1] - ny);
    if (ext0 < 0) { ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(a[0] - nx, a[1] - ny); }                      // a strip that ends here: its end drawn
    ctx.strokeStyle = o.edge; ctx.lineWidth = o.line; ctx.stroke();
  };
  const famOf = (si) => o.family[(w.family[si] >= 0 ? w.family[si] : 0) % 3];
  const arms = w.inlay ? (v) => w.inlay.at[v].map(([si, j]) => { const s = w.inlay.strands[si], n = s.cells.length, out = []; const add = (jj, e) => out.push({ to: s.cells[jj], e }); if (j + 1 < n) add(j + 1, s.edges[j]); else if (s.closed) add(0, s.edges[j]); if (j > 0) add(j - 1, s.edges[j - 1]); else if (s.closed) add(n - 1, s.edges[n - 1]); return { ends: !s.closed && (j === 0 || j === n - 1), out }; }) : null;
  for (let t = 0; t < w.nT; t++) {
    const C = [X(F[3 * t]), X(F[3 * t + 1]), X(F[3 * t + 2])], G = [(C[0][0] + C[1][0] + C[2][0]) / 3, (C[0][1] + C[1][1] + C[2][1]) / 3];
    const E = [w.triEdges[3 * t], w.triEdges[3 * t + 1], w.triEdges[3 * t + 2]], Em = E.map(M);
    // the strip that wraps corner k runs from the middle of the side before it to the middle of the side after it
    const seg = [0, 1, 2].map(k => ({ k, si: w.segStrand[3 * t + k], j: w.segIndex[3 * t + k], A: Em[(k + 2) % 3], B: Em[k], rank: w.segRank ? w.segRank[3 * t + k] : 1 })).filter(q => q.si >= 0);
    const overAt = (q, e) => { const s = w.strands[q.si], i = s.knots[q.j] === e ? q.j : (q.j + 1) % s.knots.length; return w.over(q.si, i); };
    const reach = 3 * Math.hypot(C[1][0] - C[0][0], C[1][1] - C[0][1]);
    for (let m = 0; m < 3; m++) {
      const e = E[m], a = seg.find(q => q.k === m), b = seg.find(q => q.k === (m + 1) % 3), c = seg.find(q => q.k === (m + 2) % 3);
      let order;
      if (w.flatTri && w.flatTri[t]) order = seg.slice().sort((x, y) => x.rank - y.rank);
      else { const two = [a, b].filter(Boolean); if (two.length === 2 && realKnot(w, e) && overAt(a, e)) two.reverse(); order = [c, ...two].filter(Boolean); }
      for (const [corner, P0, P1] of [[F[3 * t + m], C[m], Em[m]], [F[3 * t + (m + 1) % 3], Em[m], C[(m + 1) % 3]]]) {
        const cx = (G[0] + P0[0] + P1[0]) / 3, cy = (G[1] + P0[1] + P1[1]) / 3, out = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + grow * dx / l, p[1] + grow * dy / l]; };
        ctx.save(); ctx.beginPath(); const q0 = out(G), q1 = out(P0), q2 = out(P1); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath(); ctx.clip();
        const top = order.length ? order[order.length - 1] : null, laidIn = arms ? arms(corner) : [];
        for (const q of order) { if (laidIn.length && q === top && order.length > 1) for (const A of laidIn) for (const arm of A.out) band(X(corner), X(arm.to), o.inlay, A.ends ? -0.55 * hw : 0.2 * hw, 0); band(q.A, q.B, famOf(q.si), reach, reach); }
        if (laidIn.length && order.length < 2) for (const A of laidIn) for (const arm of A.out) band(X(corner), X(arm.to), o.inlay, A.ends ? -0.55 * hw : 0.2 * hw, 0);
        ctx.restore();
      }
    }
  }
}
/** the flat lattice a card is painted from (a hexagonal patch, the centre cell at the origin, lattice edge 1) in pattern id */
const cardCache = new Map();
export function cardWeave(id) {
  if (!cardCache.has(id)) { const lat = wedgeLattice(6, 4), V = embedLattice(lat, 1); cardCache.set(id, patternWeave(V, Int32Array.from(lat.F), { id, centres: [0], centre: 0, a: 1 })); }
  return cardCache.get(id);
}
/** PAINT A BANDED WEAVE (bands.js) on a 2-D canvas: every strip whole, then at every crossing the strip that is on top
 *  once more, within the strip it crosses. o as for paintWeave. */
export function paintBands(ctx, w, o) {
  const B = w.band, hw = 0.5 * o.width * o.scale, P2 = (p) => [o.cx + o.scale * p[0], o.cy - o.scale * p[1]];
  const famOf = (ply) => o.family[(ply.family >= 0 ? ply.family : 0) % 3];
  ctx.lineWidth = o.line; ctx.strokeStyle = o.edge;
  const quad = (q, colour) => { ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); ctx.fillStyle = colour; ctx.fill(); };
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const lines = B.plies.map(ply => ply.knots.map(q => P2(q.p)));
  B.plies.forEach((ply, pi) => {
    const pts = lines[pi], n = pts.length, m = ply.closed ? n : n - 1, col = famOf(ply);
    for (let i = 0; i < m; i++) {
      const A = pts[i], C = pts[(i + 1) % n], dx = C[0] - A[0], dy = C[1] - A[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy * hw, ny = ux * hw, e = 0.6;
      quad([[A[0] - e * ux + nx, A[1] - e * uy + ny], [C[0] + e * ux + nx, C[1] + e * uy + ny], [C[0] + e * ux - nx, C[1] + e * uy - ny], [A[0] - e * ux - nx, A[1] - e * uy - ny]], col);
      line([A[0] + nx, A[1] + ny], [C[0] + nx, C[1] + ny]); line([A[0] - nx, A[1] - ny], [C[0] - nx, C[1] - ny]);
    }
  });
  B.plies.forEach((ply, pi) => {
    const pts = lines[pi], n = pts.length, col = famOf(ply);
    ply.knots.forEach((q, i) => {
      if (q.rim || !q.over || !q.dir) return;
      const X = pts[i], A = pts[ply.closed ? (i - 1 + n) % n : Math.max(0, i - 1)], C = pts[ply.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = C[0] - A[0], ty = C[1] - A[1]; const lt = Math.hypot(tx, ty) || 1; tx /= lt; ty /= lt;
      let bx = q.dir[0], by = -q.dir[1]; const lb = Math.hypot(bx, by) || 1; bx /= lb; by /= lb;
      const sn = Math.abs(tx * by - ty * bx); if (sn < 0.2) return;
      const L = hw / sn, g = L + 0.7;                               // (a little longer along the strip: it covers the edges of the strip beneath)
      quad([[X[0] - g * tx + L * bx, X[1] - g * ty + L * by], [X[0] + g * tx + L * bx, X[1] + g * ty + L * by], [X[0] + g * tx - L * bx, X[1] + g * ty - L * by], [X[0] - g * tx - L * bx, X[1] - g * ty - L * by]], col);
      line([X[0] - g * tx + L * bx, X[1] - g * ty + L * by], [X[0] + g * tx + L * bx, X[1] + g * ty + L * by]); line([X[0] - g * tx - L * bx, X[1] - g * ty - L * by], [X[0] + g * tx - L * bx, X[1] + g * ty - L * by]);
    });
  });
}
/** one picture of a pattern card on a square canvas of `size` px: 'cell' — one cell with its ring of strips — or 'ring' —
 *  the cell and the six cells round it; colours: { ground, family: [3], inlay, edge, frame } */
export function paintCard(ctx, id, variant, size, colours) {
  const w = cardWeave(id), P = PATTERNS[id], reach = variant === 'ring' ? 2.08 : 1.08, scale = (size / 2 - 1.5) / reach, cx = size / 2, cy = size / 2;
  const hexPath = () => { ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k, x = cx + scale * reach * Math.cos(a), y = cy - scale * reach * Math.sin(a); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath(); };
  ctx.clearRect(0, 0, size, size);
  ctx.save(); hexPath(); ctx.fillStyle = colours.ground; ctx.fill(); ctx.clip();
  const unit = w.refined ? 1 / Math.sqrt(3) : 1;                    // the lattice edge of the weave itself
  const o = { scale, cx, cy, width: (P.lath ? P.lath.width : 0.2) * unit, family: colours.family, inlay: colours.inlay, edge: colours.edge, line: variant === 'ring' ? 0.6 : 0.8 };
  if (w.band) paintBands(ctx, w, { ...o, width: w.pattern.lath.width, line: variant === 'ring' ? 0.45 : 0.7 }); else paintWeave(ctx, w, o);
  ctx.restore();
  hexPath(); ctx.strokeStyle = colours.frame; ctx.lineWidth = 1; ctx.stroke();
}
