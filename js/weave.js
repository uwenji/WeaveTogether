// weave.js — from a triangulated lattice to the triaxial (kagome) weave.
//
// The lattice is the dual triangulation TryTriWeave exports ("Export lattice"): one vertex per hole (site), one
// triangle per small triangular opening. In the weave every lattice edge is a crossing (two laths meet at its
// midpoint), every triangle holds three short lath segments (its mid-segments), and the n lath segments around a
// vertex close an n-sided hole. A lath passes through edge midpoints and in every triangle takes the mid-segment that
// wraps the vertex it did not wrap in the previous triangle — a straight line on a regular lattice.
// The strand tracing, the over/under parity and the family colouring follow TryTriWeave/web/js/lattice.js
// (traceStrands), read as the reference and not changed. On top of it this module records what the planner needs:
// which strand and which position every segment belongs to, and the ring of segments and crossings around every hole.

/** Parse a Wavefront OBJ (v / f lines; polygons fanned; negative indices). Returns {V, F, header, meta}. */
export function parseOBJ(text) {
  const V = [], F = []; let header = '';
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (line[0] === '#') { if (!header && line.length > 1) header = line.slice(1).trim(); continue; }
    const p = line.split(/\s+/);
    if (p[0] === 'v') V.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const nv = V.length / 3, ids = p.slice(1).map(s => { const k = parseInt(s.split('/')[0], 10); return k < 0 ? nv + k : k - 1; });
      for (let i = 1; i + 1 < ids.length; i++) F.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  const meta = {};
  const ma = /\ba\s*=\s*([0-9.]+)/.exec(header); if (ma) meta.a = +ma[1];
  const mv = /valence\s*(\d+)\s*seed/.exec(header); if (mv) meta.seedValence = +mv[1];
  const mn = /^(?:LocalSH|GlobalSH)\s+([^:]+):/.exec(header); if (mn) meta.name = mn[1].trim();
  const ms = /\bscale\s*=\s*([0-9.]+(?:e[-+]?\d+)?)\s*cm/i.exec(header); if (ms && +ms[1] > 0) meta.scale = +ms[1];   // centimetres per model unit (TryTriWeave's export)
  return { V: Float64Array.from(V), F: Int32Array.from(F), header, meta };
}

/** Parse an STL, binary or ASCII. An STL is a list of loose triangles: corners that lie at the same place are welded into
 *  one vertex (within a millionth of the model's size) and triangles that collapse are dropped, so that the result is a
 *  mesh like an OBJ's — its vertices the cells. Returns {V, F, header, meta}. */
export function parseSTL(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const nB = u8.length >= 84 ? dv.getUint32(80, true) : 0, head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 80)));
  let P, header = '';
  if (u8.length >= 84 && 84 + 50 * nB === u8.length) {      // binary: 80 bytes, a count, 50 bytes a triangle
    P = new Float64Array(9 * nB); for (let t = 0, o = 84; t < nB; t++, o += 50) for (let k = 0; k < 9; k++) P[9 * t + k] = dv.getFloat32(o + 12 + 4 * k, true);
    header = head.replace(/[^\x20-\x7e]+/g, ' ').trim();
  } else {
    const text = new TextDecoder().decode(u8), m = /^\s*solid[ \t]*([^\r\n]*)/.exec(text), a = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let q;
    while ((q = re.exec(text))) a.push(+q[1], +q[2], +q[3]);
    if (!a.length || a.length % 9) throw new Error('not an STL this page can read');
    P = Float64Array.from(a); header = m ? m[1].trim() : '';
  }
  const n = P.length / 3; let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const x = P[3 * i + k]; if (!(Math.abs(x) < Infinity)) throw new Error('a coordinate is not a number'); if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  const eps = Math.max(1e-12, 1e-6 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  // (welded on two grids half a step apart, so that two corners a hair's breadth apart on either side of a grid line still meet)
  const par = new Int32Array(n).map((_, i) => i), find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (const sh of [0, 0.5]) { const seen = new Map(); for (let i = 0; i < n; i++) { const k = `${Math.round((P[3 * i] - lo[0]) / eps + sh)},${Math.round((P[3 * i + 1] - lo[1]) / eps + sh)},${Math.round((P[3 * i + 2] - lo[2]) / eps + sh)}`, j = seen.get(k); if (j === undefined) seen.set(k, i); else { const a = find(i), b = find(j); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); } } }
  const id = new Int32Array(n).fill(-1), V = [], F = [];
  for (let i = 0; i < n; i++) { const r = find(i); if (id[r] < 0) { id[r] = V.length / 3; V.push(P[3 * r], P[3 * r + 1], P[3 * r + 2]); } id[i] = id[r]; }
  for (let t = 0; t < n; t += 3) { const a = id[t], b = id[t + 1], c = id[t + 2]; if (a !== b && b !== c && c !== a) F.push(a, b, c); }
  return { V: Float64Array.from(V), F: Int32Array.from(F), header, meta: {} };
}
/** a mesh file by its name: .stl (binary or ASCII), anything else as an OBJ. `buf`: an ArrayBuffer or Uint8Array. */
export function parseMesh(name, buf) { return /\.stl$/i.test(name || '') ? parseSTL(buf) : parseOBJ(new TextDecoder().decode(buf)); }

/** Area-weighted vertex normals from the face winding; faces are assumed consistently oriented (outward / convex side). */
export function vertexNormals(V, F) {
  const n = V.length / 3, N = new Float64Array(3 * n), nt = F.length / 3;
  for (let t = 0; t < nt; t++) {
    const a = F[3 * t], b = F[3 * t + 1], c = F[3 * t + 2];
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2];
    const vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;     // 2 × area × unit normal
    for (const i of [a, b, c]) { N[3 * i] += nx; N[3 * i + 1] += ny; N[3 * i + 2] += nz; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1; N[3 * i] /= l; N[3 * i + 1] /= l; N[3 * i + 2] /= l; }
  return N;
}

/** Make the face winding consistent across every edge (BFS over the triangles; a flipped triangle in an exported lattice
 *  happens where the carrier is sharply curved). Returns the number of triangles flipped. */
export function orientConsistent(F) {
  const nT = F.length / 3, nV = F.reduce((m, v) => Math.max(m, v), -1) + 1, byEdge = new Map();
  const key = (a, b) => (a < b ? a * nV + b : b * nV + a);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const kk = key(F[3 * t + k], F[3 * t + (k + 1) % 3]); if (!byEdge.has(kk)) byEdge.set(kk, []); byEdge.get(kk).push(t); }
  const seen = new Uint8Array(nT); let flips = 0;
  const dir = (t, a, b) => { for (let k = 0; k < 3; k++) if (F[3 * t + k] === a && F[3 * t + (k + 1) % 3] === b) return 1; return -1; };
  for (let t0 = 0; t0 < nT; t0++) {
    if (seen[t0]) continue; seen[t0] = 1; const queue = [t0];
    while (queue.length) {
      const t = queue.shift();
      for (let k = 0; k < 3; k++) {
        const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3];
        for (const t2 of byEdge.get(key(a, b))) {
          if (t2 === t || seen[t2]) continue;
          if (dir(t2, a, b) === 1) { const q = F[3 * t2 + 1]; F[3 * t2 + 1] = F[3 * t2 + 2]; F[3 * t2 + 2] = q; flips++; }   // same direction on the shared edge: flip
          seen[t2] = 1; queue.push(t2);
        }
      }
    }
  }
  return flips;
}

/** Flip every face if the winding points inward: the lath side is the outside. The test is the signed volume of the
 *  surface with every rim closed by a fan to its centre — a branching tube with a canopy (a tree, the two columns) has
 *  its outside on the trunk and under the canopy, which the old test (the normals against the centroid) got wrong: the
 *  laths lay inside the trunk and over / under read the other way (Ji, 11 Nov; TryTriWeave's README: "a branching tube
 *  like the tree used to come out facing inward"). A sheet that encloses next to nothing falls back to the normals
 *  against the centroid, then to "up". Returns true when it flipped. */
export function orientOutward(V, F) {
  const n = V.length / 3, nT = F.length / 3; let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += V[3 * i]; cy += V[3 * i + 1]; cz += V[3 * i + 2]; } cx /= n; cy /= n; cz /= n;
  const P = (i) => [V[3 * i] - cx, V[3 * i + 1] - cy, V[3 * i + 2] - cz];
  const vol6 = (A, B, C) => A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
  // the rim: directed edges used once; its loops by union-find over their cells
  const half = new Map(), key = (a, b) => a * n + b;
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) half.set(key(F[3 * t + k], F[3 * t + (k + 1) % 3]), 1);
  const parent = new Map(), find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const y = parent.get(x); parent.set(x, r); x = y; } return r; }, rim = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3]; if (half.has(key(b, a))) continue;
    rim.push([a, b]); for (const v of [a, b]) if (!parent.has(v)) parent.set(v, v); parent.set(find(a), find(b));
  }
  const cen = new Map(); for (const v of parent.keys()) { const r = find(v), c = cen.get(r) || [0, 0, 0, 0], p = P(v); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3]++; cen.set(r, c); }
  let vol = 0, area = 0;
  for (let t = 0; t < nT; t++) {
    const A = P(F[3 * t]), B = P(F[3 * t + 1]), C = P(F[3 * t + 2]); vol += vol6(A, B, C);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]; area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  for (const [a, b] of rim) { const c = cen.get(find(a)); vol += vol6(P(b), P(a), [c[0] / c[3], c[1] / c[3], c[2] / c[3]]); }
  vol /= 6;
  let flip;
  if (Math.abs(vol) > 2e-3 * Math.pow(area, 1.5)) flip = vol < 0;
  else {
    const N = vertexNormals(V, F); let dot = 0, up = 0;
    for (let i = 0; i < n; i++) { const p = P(i); dot += N[3 * i] * p[0] + N[3 * i + 1] * p[1] + N[3 * i + 2] * p[2]; up += N[3 * i + 2]; }
    flip = Math.abs(dot) > 1e-9 * n ? dot < 0 : up < 0;
  }
  if (flip) for (let t = 0; t < F.length; t += 3) { const q = F[t + 1]; F[t + 1] = F[t + 2]; F[t + 2] = q; }
  return flip;
}

/** The weave of a triangulated lattice (V: Float64Array 3n, F: Int32Array 3m, consistently oriented). */
export function buildWeave(V, F) {
  const nV = V.length / 3, nT = F.length / 3, N = vertexNormals(V, F);
  // --- edges, valences, boundary -------------------------------------------------------------------------------
  const edgeId = new Map(), edges = [], edgeTris = [], triEdges = new Int32Array(3 * nT);
  const key = (a, b) => (a < b ? a * nV + b : b * nV + a);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], kk = key(a, b);
    let e = edgeId.get(kk);
    if (e === undefined) { e = edges.length; edgeId.set(kk, e); edges.push([Math.min(a, b), Math.max(a, b)]); edgeTris.push([]); }
    triEdges[3 * t + k] = e; edgeTris[e].push(t);
  }
  const nE = edges.length, valence = new Int32Array(nV), boundary = new Uint8Array(nV), vertEdges = Array.from({ length: nV }, () => []);
  for (let e = 0; e < nE; e++) { const [a, b] = edges[e]; valence[a]++; valence[b]++; vertEdges[a].push(e); vertEdges[b].push(e); if (edgeTris[e].length !== 2) { boundary[a] = 1; boundary[b] = 1; } }
  const edgeMid = new Float64Array(3 * nE), edgeNrm = new Float64Array(3 * nE), edgeLen = new Float64Array(nE);
  for (let e = 0; e < nE; e++) {
    const [a, b] = edges[e];
    for (let c = 0; c < 3; c++) edgeMid[3 * e + c] = 0.5 * (V[3 * a + c] + V[3 * b + c]);
    let nx = N[3 * a] + N[3 * b], ny = N[3 * a + 1] + N[3 * b + 1], nz = N[3 * a + 2] + N[3 * b + 2]; const l = Math.hypot(nx, ny, nz) || 1;
    edgeNrm[3 * e] = nx / l; edgeNrm[3 * e + 1] = ny / l; edgeNrm[3 * e + 2] = nz / l;
    edgeLen[e] = Math.hypot(V[3 * a] - V[3 * b], V[3 * a + 1] - V[3 * b + 1], V[3 * a + 2] - V[3 * b + 2]);
  }
  // --- strands (TryTriWeave · traceStrands) ------------------------------------------------------------------------
  const cornerOf = (t, v) => F[3 * t] === v ? 0 : F[3 * t + 1] === v ? 1 : F[3 * t + 2] === v ? 2 : -1;
  // segment (t, k) wraps corner k and joins the midpoints of edges (k−1, k) and (k, k+1)
  const segEdges = (t, k) => [triEdges[3 * t + (k + 2) % 3], triEdges[3 * t + k]];
  const otherTri = (e, t) => { const l = edgeTris[e]; return l.length === 2 ? (l[0] === t ? l[1] : l[0]) : -1; };
  const advance = (t, k, exitEdge) => {
    const t2 = otherTri(exitEdge, t); if (t2 < 0) return null;
    const v = F[3 * t + k], [ea, eb] = edges[exitEdge], w = ea === v ? eb : ea;    // in the next triangle wrap the other end of the exit edge
    const k2 = cornerOf(t2, w); if (k2 < 0) return null;
    const [e1, e2] = segEdges(t2, k2); return { t: t2, k: k2, exit: e1 === exitEdge ? e2 : e1 };
  };
  const used = new Uint8Array(3 * nT), strands = [], segStrand = new Int32Array(3 * nT).fill(-1), segIndex = new Int32Array(3 * nT).fill(-1);
  for (let t0 = 0; t0 < nT; t0++) for (let k0 = 0; k0 < 3; k0++) {
    if (used[3 * t0 + k0]) continue;
    const [eA, eB] = segEdges(t0, k0), fwd = [], bwd = []; let closed = false;
    used[3 * t0 + k0] = 1;
    let cur = { t: t0, k: k0, exit: eB };
    for (;;) {
      const nx = advance(cur.t, cur.k, cur.exit); if (!nx) break;
      if (nx.t === t0 && nx.k === k0) { closed = true; break; }
      if (used[3 * nx.t + nx.k]) break;
      used[3 * nx.t + nx.k] = 1; fwd.push(nx); cur = nx;
    }
    if (!closed) {
      cur = { t: t0, k: k0, exit: eA };
      for (;;) {
        const nx = advance(cur.t, cur.k, cur.exit); if (!nx) break;
        if (used[3 * nx.t + nx.k]) break;
        used[3 * nx.t + nx.k] = 1; bwd.push(nx); cur = nx;
      }
    }
    const knots = [];
    for (let i = bwd.length - 1; i >= 0; i--) knots.push(bwd[i].exit);
    knots.push(eA, eB);
    for (const s of fwd) knots.push(s.exit);
    if (closed) knots.pop();
    const segs = [...bwd.slice().reverse().map(s => [s.t, s.k]), [t0, k0], ...fwd.map(s => [s.t, s.k])];
    const si = strands.length;
    segs.forEach(([t, k], j) => { segStrand[3 * t + k] = si; segIndex[3 * t + k] = j; });   // segment j joins knots j and j+1
    strands.push({ knots, segs, closed });
  }
  const nS = strands.length;
  // crossings: the strands passing every edge midpoint (two on an interior edge, two loose ends on a rim edge)
  const knotStrands = edges.map(() => []);
  strands.forEach((s, si) => s.knots.forEach((e, i) => knotStrands[e].push([si, i])));
  // --- families: strands crossing at a knot differ (greedy BFS + min-conflict sweeps) -----------------------------
  const family = new Int32Array(nS).fill(-1), adj = Array.from({ length: nS }, () => new Set());
  for (let e = 0; e < nE; e++) { const l = knotStrands[e]; if (l.length === 2 && l[0][0] !== l[1][0] && edgeTris[e].length === 2) { adj[l[0][0]].add(l[1][0]); adj[l[1][0]].add(l[0][0]); } }
  const order = [...Array(nS).keys()].sort((a, b) => strands[b].knots.length - strands[a].knots.length);
  for (const root of order) {
    if (family[root] >= 0) continue;
    const queue = [root]; family[root] = 0;
    while (queue.length) {
      const s = queue.shift();
      for (const q of adj[s]) {
        if (family[q] >= 0) continue;
        const usedC = new Set(); for (const z of adj[q]) if (family[z] >= 0) usedC.add(family[z]);
        let col = [0, 1, 2].find(c => !usedC.has(c)); if (col === undefined) col = (family[s] + 1) % 3;
        family[q] = col; queue.push(q);
      }
    }
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    let changed = 0;
    for (let s = 0; s < nS; s++) {
      const cnt = [0, 0, 0]; for (const q of adj[s]) if (family[q] >= 0) cnt[family[q]]++;
      let best = family[s]; for (let c = 0; c < 3; c++) if (cnt[c] < cnt[best]) best = c;
      if (best !== family[s]) { family[s] = best; changed++; }
    }
    if (!changed) break;
  }
  let colourConflicts = 0; for (let s = 0; s < nS; s++) for (const q of adj[s]) if (q > s && family[q] === family[s]) colourConflicts++;
  // --- over / under: over(s, i) = base[s] XOR (i & 1); the two strands at a knot must differ ---------------------
  const base = new Int8Array(nS).fill(-1), padj = Array.from({ length: nS }, () => []); let parityConflicts = 0, selfConflicts = 0;
  for (let e = 0; e < nE; e++) {
    const l = knotStrands[e]; if (l.length !== 2 || edgeTris[e].length !== 2) continue;
    const [[sa, ia], [sb, ib]] = l;
    if (sa === sb) { if (((ia + ib) & 1) === 0) selfConflicts++; continue; }      // a strand crossing itself: over at one pass, under at the other
    const rel = 1 ^ ((ia + ib) & 1); padj[sa].push([sb, rel]); padj[sb].push([sa, rel]);
  }
  for (let root = 0; root < nS; root++) {
    if (base[root] >= 0) continue; base[root] = 0; const queue = [root];
    while (queue.length) {
      const s = queue.shift();
      for (const [q, rel] of padj[s]) { const want = base[s] ^ rel; if (base[q] < 0) { base[q] = want; queue.push(q); } else if (base[q] !== want) parityConflicts++; }
    }
  }
  for (const s of strands) if (s.closed && (s.knots.length & 1)) parityConflicts += 2;
  const overRaw = (si, i) => ((base[si] ^ (i & 1)) === 1);                     // over = on the side of the normals
  // --- the ring of segments around every hole, in cyclic order (the fan of triangles) ------------------------------
  // around vertex v the corner (t, k) is followed by the corner of v in the triangle across edge triEdges[t, k]
  const cellSegs = Array.from({ length: nV }, () => []), cellKnots = Array.from({ length: nV }, () => []);
  const cornerAt = new Map();                                                   // v → one corner (t, k) of v; on the rim the first one
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = F[3 * t + k], prevE = triEdges[3 * t + (k + 2) % 3];
    if (!cornerAt.has(v) || edgeTris[prevE].length === 1) cornerAt.set(v, [t, k]);
  }
  for (let v = 0; v < nV; v++) {
    const start = cornerAt.get(v); if (!start) continue;
    let [t, k] = start; const seen = new Set();
    const prevE0 = triEdges[3 * t + (k + 2) % 3];
    if (edgeTris[prevE0].length === 1) cellKnots[v].push(prevE0);               // the rim end before the first segment
    for (;;) {
      if (seen.has(t)) break; seen.add(t);
      cellSegs[v].push([t, k]);
      const nextE = triEdges[3 * t + k]; cellKnots[v].push(nextE);
      const t2 = otherTri(nextE, t); if (t2 < 0) break;
      const k2 = cornerOf(t2, v); if (k2 < 0) break;
      t = t2; k = k2;
    }
    if (!boundary[v] && cellSegs[v].length === valence[v]) { /* closed ring: knots[j] follows segment j */ }
  }
  // segment lengths and strand lengths (chords between consecutive knot midpoints)
  const segLen = new Float64Array(3 * nT), strandLen = new Float64Array(nS);
  strands.forEach((s, si) => {
    const K = s.knots.length, nseg = s.closed ? K : K - 1; let L = 0;
    for (let j = 0; j < nseg; j++) {
      const e0 = s.knots[j], e1 = s.knots[(j + 1) % K];
      const d = Math.hypot(edgeMid[3 * e0] - edgeMid[3 * e1], edgeMid[3 * e0 + 1] - edgeMid[3 * e1 + 1], edgeMid[3 * e0 + 2] - edgeMid[3 * e1 + 2]);
      const [t, k] = s.segs[j]; segLen[3 * t + k] = d; L += d;
    }
    strandLen[si] = L;
  });
  let chi = nV - nE + nT, sumCharge = 0; for (let v = 0; v < nV; v++) if (!boundary[v]) sumCharge += 6 - valence[v];
  // `side`: +1 the laths lie on the side of the normals, −1 on the other one (Display → flip the lath side). Over and under
  // are read from the lath side, so they swap with it (as TryTriWeave's "input normal"): the weave itself stays the same
  const W = { nV, nT, nE, V, F, N, edges, edgeTris, triEdges, vertEdges, valence, boundary, edgeMid, edgeNrm, edgeLen,
    strands, segStrand, segIndex, segLen, strandLen, knotStrands, family, overRaw, side: 1, base, parityConflicts: parityConflicts / 2 | 0, selfConflicts, colourConflicts,
    cellSegs, cellKnots, chi, sumCharge };
  // (W.overRaw is looked up at every call: a pattern — patterns.js — puts its own over / under rule there)
  W.over = (si, i) => (W.side < 0 ? !W.overRaw(si, i) : W.overRaw(si, i));
  return W;
}

/** valence histogram of the interior holes, the singular ones, Σ(6 − n) */
export function chargeSummary(w) {
  const hist = {}, singular = []; let charge = 0, nInterior = 0;
  for (let v = 0; v < w.nV; v++) {
    if (w.boundary[v]) continue;
    const n = w.valence[v]; hist[n] = (hist[n] || 0) + 1; charge += 6 - n; nInterior++;
    if (n !== 6) singular.push(v);
  }
  return { hist, charge, singular, nInterior };
}

/** the median lattice edge — the lattice edge a when the header does not say */
export function medianEdge(w) { const l = Array.from(w.edgeLen).sort((x, y) => x - y); return l.length ? l[l.length >> 1] : 1; }
