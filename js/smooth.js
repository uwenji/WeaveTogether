// smooth.js — the smooth surface under a lattice (Ji, 20 Nov 2026: "I suggest running loop subdivision smoothing").
//
// A strip of a band is no strand of the lattice, so the lattice does not say where it runs: it was drawn as its strand's
// line moved sideways, with that strand's normal. On a fine lattice that is close enough. On a coarse one (the
// dodecahedron: 40° from one crossing to the next) two strands that cross disagree by several degrees about which way
// the surface faces, each band is flat across where the surface is round, and the places two strips share no longer fit
// on each other. Here every strip gets the same surface to lie on:
//   · the lattice is split once — a vertex in every edge, which is a crossing of the weave;
//   · the control points are moved until the Loop surface passes through every crossing (the middle of its edge, where
//     the hexagonal weave has it) and, for every cell, through a point under the cell's vertex, as deep as the ring of
//     crossings round it asks for (the lattice's own vertex stands off the weave: on the dodecahedron by 4 of 70);
//   · that mesh is split further by Loop's rules. Every face of the lattice keeps the grid of its fine vertices, so the
//     surface is asked by face and barycentric coordinates — at(), near() — and a point walks from face to face.
// A strand of the hexagonal weave is a straight line in these coordinates (through the middles of two edges of a face).

const key = (a, b, n) => (a < b ? a * n + b : b * n + a);

/** one split of a triangle mesh: a vertex in every edge. linear: the new vertex in the middle and the old ones where they
 *  are; otherwise Loop's rules (Warren's weights; a rim is a cubic spline). → { P, odd(a, b): the vertex in edge ab } */
function split(P, F, linear) {
  const nv = P.length / 3, nf = F.length / 3, E = new Map(), ea = [], eb = [], ec = [], ed = [];
  for (let t = 0; t < nf; t++) for (let k = 0; k < 3; k++) {
    const a = F[3 * t + k], b = F[3 * t + (k + 1) % 3], c = F[3 * t + (k + 2) % 3], kk = key(a, b, nv), i = E.get(kk);
    if (i === undefined) { E.set(kk, ea.length); ea.push(a); eb.push(b); ec.push(c); ed.push(-1); } else ed[i] = c;
  }
  const ne = ea.length, Q = new Float64Array(3 * (nv + ne));
  if (linear) Q.set(P);
  else {
    const sum = new Float64Array(3 * nv), rs = new Float64Array(3 * nv), val = new Int32Array(nv), rim = new Uint8Array(nv);
    for (let i = 0; i < ne; i++) { const a = ea[i], b = eb[i], r = ed[i] < 0; val[a]++; val[b]++; if (r) { rim[a] = 1; rim[b] = 1; }
      for (let c = 0; c < 3; c++) { sum[3 * a + c] += P[3 * b + c]; sum[3 * b + c] += P[3 * a + c]; if (r) { rs[3 * a + c] += P[3 * b + c]; rs[3 * b + c] += P[3 * a + c]; } } }
    for (let v = 0; v < nv; v++) { const k = val[v], be = k > 3 ? 3 / (8 * k) : 3 / 16;
      for (let c = 0; c < 3; c++) Q[3 * v + c] = rim[v] ? 0.75 * P[3 * v + c] + 0.125 * rs[3 * v + c] : (1 - k * be) * P[3 * v + c] + be * sum[3 * v + c]; }
  }
  for (let i = 0; i < ne; i++) { const a = ea[i], b = eb[i], c = ec[i], d = ed[i], o = 3 * (nv + i);
    for (let x = 0; x < 3; x++) Q[o + x] = linear || d < 0 ? 0.5 * (P[3 * a + x] + P[3 * b + x]) : 0.375 * (P[3 * a + x] + P[3 * b + x]) + 0.125 * (P[3 * c + x] + P[3 * d + x]); }
  return { P: Q, odd: (a, b) => nv + E.get(key(a, b, nv)) };
}
const at2 = (i, j, n) => j * (n + 1) - (j * (j - 1) >> 1) + i;      // the place of grid point (i, j), i + j ≤ n, in a face's grid
const refine = (G, n, odd) => { const m = 2 * n, H = new Int32Array((m + 1) * (m + 2) / 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i + j <= n; i++) { const a = G[at2(i, j, n)]; H[at2(2 * i, 2 * j, m)] = a;
    if (i + j < n) { const b = G[at2(i + 1, j, n)], c = G[at2(i, j + 1, n)]; H[at2(2 * i + 1, 2 * j, m)] = odd(a, b); H[at2(2 * i, 2 * j + 1, m)] = odd(a, c); H[at2(2 * i + 1, 2 * j + 1, m)] = odd(b, c); } }
  return H; };
const facesOf = (grids, n) => { const out = new Int32Array(3 * grids.length * n * n); let o = 0;
  for (const G of grids) for (let j = 0; j < n; j++) for (let i = 0; i + j < n; i++) {
    out[o++] = G[at2(i, j, n)]; out[o++] = G[at2(i + 1, j, n)]; out[o++] = G[at2(i, j + 1, n)];
    if (i + j < n - 1) { out[o++] = G[at2(i + 1, j, n)]; out[o++] = G[at2(i + 1, j + 1, n)]; out[o++] = G[at2(i, j + 1, n)]; } }
  return out; };

/** the smooth surface of weave w's lattice (w.V, w.F, w.N, w.edges, w.edgeNrm, w.edgeTris), split `levels` times in all
 *  (4: sixteen fine edges to a lattice edge). → { n, at, near, walk, P, N, rough: its sharpest turn in degrees, fit } */
export function smoothSurface(w, levels = 4, rounds = 60) {
  const V = w.V, F = w.F, nV = V.length / 3, nF = F.length / 3, nE = w.edges.length, N0 = w.N;
  // --- the first split, and where the surface is to pass ----------------------------------------------------------------
  let grids = []; for (let f = 0; f < nF; f++) grids.push(Int32Array.of(F[3 * f], F[3 * f + 1], F[3 * f + 2]));
  let n = 1, S = split(V, F, true); grids = grids.map(G => refine(G, n, S.odd)); n = 2;
  const T = S.P.slice(), nC = T.length / 3, eOf = new Int32Array(nE);        // T: the targets — a crossing: the middle of its edge
  w.edges.forEach(([a, b], e) => { eOf[e] = S.odd(a, b); });
  // a cell: on the line through its vertex along the normal. The vertex stands off the weave — by H over the ring of its
  // crossings, which lie r from that line; on a cap that is evenly round the weave passes H / (1 + c) under the vertex,
  // c = 1 / √(1 + (H / r)²): half-way between the ring and the vertex where the lattice is fine, less where it is coarse.
  // (From where the crossings are alone: their normals would say more, and say it wrong on a lattice as rough as the Bunny's.)
  { const cnt = new Int32Array(nV), hs = new Float64Array(nV), rr = new Float64Array(nV);
    w.edges.forEach(([a, b], e) => { for (const v of [a, b]) {
      const nx = N0[3 * v], ny = N0[3 * v + 1], nz = N0[3 * v + 2], o = 3 * eOf[e], dx = T[o] - V[3 * v], dy = T[o + 1] - V[3 * v + 1], dz = T[o + 2] - V[3 * v + 2];
      const z = dx * nx + dy * ny + dz * nz; hs[v] -= z; rr[v] += Math.hypot(dx - z * nx, dy - z * ny, dz - z * nz); cnt[v]++; } });
    for (let v = 0; v < nV; v++) if (cnt[v]) { const H = hs[v] / cnt[v], r = rr[v] / cnt[v], c = r > 1e-12 ? 1 / Math.sqrt(1 + (H / r) * (H / r)) : 0, down = H / (1 + c); for (let q = 0; q < 3; q++) T[3 * v + q] = V[3 * v + q] - down * N0[3 * v + q]; } }
  // --- the control points: moved until the surface is there ------------------------------------------------------------
  let F1 = facesOf(grids, n); const C = T.slice();
  const nbS = new Int32Array(nC + 1), nbr = [], val = new Int32Array(nC), rim = new Uint8Array(nC);
  { const seen = new Map(), pairs = []; for (let t = 0; t < F1.length; t += 3) for (let k = 0; k < 3; k++) { const a = F1[t + k], b = F1[t + (k + 1) % 3], kk = key(a, b, nC); seen.set(kk, (seen.get(kk) || 0) + 1); if (seen.get(kk) === 1) pairs.push([a, b]); }
    const lists = Array.from({ length: nC }, () => []), rl = Array.from({ length: nC }, () => []);
    for (const [a, b] of pairs) { lists[a].push(b); lists[b].push(a); if (seen.get(key(a, b, nC)) === 1) { rim[a] = 1; rim[b] = 1; rl[a].push(b); rl[b].push(a); } }
    for (let v = 0; v < nC; v++) { const L = rim[v] ? rl[v] : lists[v]; val[v] = L.length; nbS[v] = nbr.length; for (const u of L) nbr.push(u); } nbS[nC] = nbr.length; }
  const lim = (X, v, c) => { let s = 0; for (let q = nbS[v]; q < nbS[v + 1]; q++) s += X[3 * nbr[q] + c]; const k = val[v];
    return rim[v] ? (2 / 3) * X[3 * v + c] + s / 6 : k > 3 ? 0.5 * X[3 * v + c] + s / (2 * k) : 0.4 * X[3 * v + c] + s / 5; };
  let res = Infinity, its = 0; const D = new Float64Array(3 * nC), a0 = w.edgeLen && nE ? w.edgeLen.reduce((x, y) => x + y, 0) / nE : 1;
  for (; its < rounds && res > 2e-4 * a0; its++) { res = 0; for (let v = 0; v < nC; v++) for (let c = 0; c < 3; c++) { const d = T[3 * v + c] - lim(C, v, c); D[3 * v + c] = d; if (Math.abs(d) > res) res = Math.abs(d); } for (let i = 0; i < 3 * nC; i++) C[i] += D[i]; }
  // --- the further splits ----------------------------------------------------------------------------------------------
  let P = C; for (let l = 1; l < levels; l++) { S = split(P, F1, false); grids = grids.map(G => refine(G, n, S.odd)); n *= 2; P = S.P; F1 = facesOf(grids, n); }
  // (the last mesh's vertices are control points still: each to where the surface is, by the same rule as above)
  { const nP = P.length / 3, sum = new Float64Array(3 * nP), rs = new Float64Array(3 * nP), k = new Int32Array(nP), rm = new Uint8Array(nP), seen = new Map();
    for (let t = 0; t < F1.length; t += 3) for (let q = 0; q < 3; q++) { const a = F1[t + q], b = F1[t + (q + 1) % 3], kk = key(a, b, nP); seen.set(kk, (seen.get(kk) || 0) + 1); }
    for (const [kk, cnt] of seen) { const a = Math.floor(kk / nP), b = kk - a * nP; k[a]++; k[b]++; for (let c = 0; c < 3; c++) { sum[3 * a + c] += P[3 * b + c]; sum[3 * b + c] += P[3 * a + c]; } if (cnt === 1) { rm[a] = 1; rm[b] = 1; for (let c = 0; c < 3; c++) { rs[3 * a + c] += P[3 * b + c]; rs[3 * b + c] += P[3 * a + c]; } } }
    const L = new Float64Array(3 * nP); for (let v = 0; v < nP; v++) for (let c = 0; c < 3; c++) L[3 * v + c] = rm[v] ? (2 / 3) * P[3 * v + c] + rs[3 * v + c] / 6 : k[v] > 3 ? 0.5 * P[3 * v + c] + sum[3 * v + c] / (2 * k[v]) : 0.4 * P[3 * v + c] + sum[3 * v + c] / 5;
    P = L; }
  const nP = P.length / 3, N = new Float64Array(3 * nP);
  for (let t = 0; t < F1.length; t += 3) { const a = 3 * F1[t], b = 3 * F1[t + 1], c = 3 * F1[t + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; for (const o of [a, b, c]) { N[o] += x; N[o + 1] += y; N[o + 2] += z; } }
  for (let v = 0; v < nP; v++) { const l = Math.hypot(N[3 * v], N[3 * v + 1], N[3 * v + 2]) || 1; N[3 * v] /= l; N[3 * v + 1] /= l; N[3 * v + 2] /= l; }
  // --- asking the surface -----------------------------------------------------------------------------------------------
  // the face across each edge of a face, and which corner of it is the new one: across the edge opposite corner k of f
  const across = new Int32Array(3 * nF).fill(-1), acrossK = new Int8Array(3 * nF);
  { const seen = new Map(); for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) { const a = F[3 * f + (k + 1) % 3], b = F[3 * f + (k + 2) % 3], kk = key(a, b, nV), o = seen.get(kk); if (o === undefined) seen.set(kk, 3 * f + k); else { across[3 * f + k] = Math.floor(o / 3); acrossK[3 * f + k] = o % 3; across[o] = f; acrossK[o] = k; } } }
  /** the point at weights (1 − b1 − b2, b1, b2) of face f's corners: { p, n, d1, d2: how p moves with b1 and with b2 } */
  const at = (f, b1, b2) => { const G = grids[f]; let x = b1 * n, y = b2 * n, i = Math.floor(x), j = Math.floor(y);
    if (i < 0) i = 0; if (j < 0) j = 0; if (i + j > n - 1) { if (i > n - 1) i = n - 1; if (j > n - 1 - i) j = n - 1 - i; }
    const fx = x - i, fy = y - j; let a, b, c, wa, wb, wc, up = fx + fy > 1 && i + j < n - 1;
    if (!up) { a = G[at2(i, j, n)]; b = G[at2(i + 1, j, n)]; c = G[at2(i, j + 1, n)]; wb = fx; wc = fy; wa = 1 - fx - fy; }
    else { a = G[at2(i + 1, j + 1, n)]; b = G[at2(i, j + 1, n)]; c = G[at2(i + 1, j, n)]; wb = 1 - fx; wc = 1 - fy; wa = fx + fy - 1; }
    const p = [0, 0, 0], nn = [0, 0, 0], d1 = [0, 0, 0], d2 = [0, 0, 0], sg = up ? -n : n;
    for (let q = 0; q < 3; q++) { const A = P[3 * a + q], B = P[3 * b + q], Cc = P[3 * c + q]; p[q] = wa * A + wb * B + wc * Cc; nn[q] = wa * N[3 * a + q] + wb * N[3 * b + q] + wc * N[3 * c + q]; d1[q] = sg * (B - A); d2[q] = sg * (Cc - A); }
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1; nn[0] /= l; nn[1] /= l; nn[2] /= l; return { p, n: nn, d1, d2 }; };
  /** a point that has left its face goes on into the next one (Q = { f, b1, b2 }, changed in place; at the rim it stays on the edge). → Q */
  const walk = (Q) => { for (let g = 0; g < 8; g++) { const b0 = 1 - Q.b1 - Q.b2, m = Math.min(b0, Q.b1, Q.b2); if (m >= -1e-12) break;
      const k = m === b0 ? 0 : m === Q.b1 ? 1 : 2, w3 = [b0, Q.b1, Q.b2], f2 = across[3 * Q.f + k];
      if (f2 < 0) { const u = (k + 1) % 3, v = (k + 2) % 3, s = Math.max(1e-12, Math.max(0, w3[u]) + Math.max(0, w3[v])); w3[u] = Math.max(0, w3[u]) / s; w3[v] = Math.max(0, w3[v]) / s; w3[k] = 0; Q.b1 = w3[1]; Q.b2 = w3[2]; break; }
      const k2 = acrossK[3 * Q.f + k], A = F[3 * Q.f + (k + 1) % 3], B = F[3 * Q.f + (k + 2) % 3], wA = w3[(k + 1) % 3] + w3[k], wB = w3[(k + 2) % 3] + w3[k], wD = -w3[k], o = [0, 0, 0];
      for (let q = 0; q < 3; q++) { const u = F[3 * f2 + q]; o[q] = q === k2 ? wD : u === A ? wA : u === B ? wB : 0; }
      Q.f = f2; Q.b1 = o[1]; Q.b2 = o[2]; } return Q; };
  /** the point of the surface next to q, looked for from Q = { f, b1, b2 } (which is changed to where it is) → { p, n } */
  const near = (q, Q) => { let R = at(Q.f, Q.b1, Q.b2);
    for (let it = 0; it < 8; it++) { const r0 = q[0] - R.p[0], r1 = q[1] - R.p[1], r2 = q[2] - R.p[2], a = R.d1, b = R.d2;
      const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2], ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], bb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2], ar = a[0] * r0 + a[1] * r1 + a[2] * r2, br = b[0] * r0 + b[1] * r1 + b[2] * r2, det = aa * bb - ab * ab;
      if (!(det > 1e-30)) break; const u = (ar * bb - br * ab) / det, v = (br * aa - ar * ab) / det; if (Math.abs(u) + Math.abs(v) < 1e-5 / n) break;
      Q.b1 += u; Q.b2 += v; walk(Q); R = at(Q.f, Q.b1, Q.b2); }
    const r0 = q[0] - R.p[0], r1 = q[1] - R.p[1], r2 = q[2] - R.p[2], h = r0 * R.n[0] + r1 * R.n[1] + r2 * R.n[2];
    R.ok = Math.hypot(r0 - h * R.n[0], r1 - h * R.n[1], r2 - h * R.n[2]) < 2e-3 * a0;      // (found: q stands straight over it)
    return R; };
  // how evenly round it is: the sharpest turn from one fine face to the next, in degrees (dodecahedron 2.8, sphere · 122 1.9,
  // tubes 2.4 – 6.6; the rim of a capped cylinder 9 – 14, a tree's forks 25 – 30, the Bunny's ears 70). The view lays the
  // strips of a band on it up to 8° and does without beyond (view.js, _surface).
  let rough = 0; { const fn = new Float64Array(F1.length), seen = new Map();
    for (let t = 0; t < F1.length; t += 3) { const a = 3 * F1[t], b = 3 * F1[t + 1], c = 3 * F1[t + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2], x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1; fn[t] = x / l; fn[t + 1] = y / l; fn[t + 2] = z / l; }
    let lo = 1; for (let t = 0; t < F1.length; t += 3) for (let k = 0; k < 3; k++) { const a = F1[t + k], b = F1[t + (k + 1) % 3], kk = key(a, b, nP), o = seen.get(kk); if (o === undefined) seen.set(kk, t); else { const d = fn[o] * fn[t] + fn[o + 1] * fn[t + 1] + fn[o + 2] * fn[t + 2]; if (d < lo) lo = d; } }
    rough = Math.acos(Math.max(-1, Math.min(1, lo))) * 180 / Math.PI; }
  return { n, at, near, walk, P, N, F: F1, grids, crossing: eOf, rough, fit: { left: res, rounds: its, a: a0 } };
}
