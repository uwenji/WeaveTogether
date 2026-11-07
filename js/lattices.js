// lattices.js — synthetic lattices for the warm-up cases: a flat hexagonal patch and the ideal cones with one
// singular hole at the centre (n wedges of 60°, n = 3 … 7). The flat lattice is cut into 60° wedges; n of them are
// glued around the centre site. n < 6 folds into a cone (exact, every edge = a), n = 6 stays flat, n = 7 is a saddle:
// the 420° development cannot be a cone, so it starts as a three-lobed guess and is relaxed until every edge is a.

const SQ3 = Math.sqrt(3);

/** sites of one 60° wedge of the triangular lattice, hex radius R (lattice units): the ray θ = 0 included, θ = 60° excluded */
function wedgePoints(R) {
  const pts = [];                                                // {q, r, rho, theta} in lattice units, radians
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    if (Math.abs(q + r) > R) continue;
    const x = q + r / 2, y = r * SQ3 / 2, rho = Math.hypot(x, y); if (rho < 1e-9) continue;
    let th = Math.atan2(y, x); if (th < -1e-9) th += 2 * Math.PI;
    if (th > -1e-9 && th < Math.PI / 3 - 1e-9) pts.push({ q, r, rho, theta: th < 0 ? 0 : th });
  }
  return pts;
}

/** combinatorics of n wedges glued around the centre: V in development polar coordinates (rho, theta over the n·60°
 *  sector), F consistently oriented (counter-clockwise in the development) */
export function wedgeLattice(n, R) {
  const pts = wedgePoints(R), idx = new Map();                   // "w|q|r" → site id
  const sites = [{ rho: 0, theta: 0 }];                           // 0 = the centre
  for (let w = 0; w < n; w++) for (const p of pts) { idx.set(`${w}|${p.q}|${p.r}`, sites.length); sites.push({ rho: p.rho, theta: p.theta + w * Math.PI / 3 }); }
  // lattice rotation by +60° is (q, r) → (−r, q + r); by −60° it is (q, r) → (q + r, −q)
  const siteOf = (w, q, r) => {
    if (q === 0 && r === 0) return 0;
    const x = q + r / 2, y = r * SQ3 / 2; let th = Math.atan2(y, x); if (th < -1e-9) th += 2 * Math.PI;
    // a point on the closing ray (θ = 60°) of wedge w is the θ = 0 point of wedge w + 1, rotated back by 60°
    if (th >= Math.PI / 3 - 1e-9) return idx.get(`${(w + 1) % n}|${q + r}|${-q}`);
    return idx.get(`${w}|${q}|${r}`);
  };
  const F = [];
  const tri = (w, a, b, c) => { const ia = siteOf(w, ...a), ib = siteOf(w, ...b), ic = siteOf(w, ...c); if (ia === undefined || ib === undefined || ic === undefined) return; F.push(ia, ib, ic); };
  const inHex = (q, r) => Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R;
  const centroidIn = (a, b, c) => { const x = (a[0] + b[0] + c[0]) / 3 + (a[1] + b[1] + c[1]) / 6, y = (a[1] + b[1] + c[1]) / 3 * SQ3 / 2; const th = Math.atan2(y, x); return th > 1e-9 && th < Math.PI / 3 - 1e-9; };
  for (let w = 0; w < n; w++) for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    const up = [[q, r], [q + 1, r], [q, r + 1]], dn = [[q + 1, r], [q + 1, r + 1], [q, r + 1]];
    for (const t of [up, dn]) if (t.every(([a, b]) => inHex(a, b)) && centroidIn(...t)) tri(w, ...t);
  }
  return { sites, F: Int32Array.from(F), n, R };
}

/** 3D positions: n < 6 the ideal cone (apex up), n = 6 flat, n > 6 a relaxed saddle. Lattice edge a. */
export function embedLattice(lat, a = 10) {
  const { sites, F, n } = lat, nV = sites.length, V = new Float64Array(3 * nV);
  const Theta = n * Math.PI / 3, s = Theta / (2 * Math.PI);
  if (n < 6) {
    const c = Math.sqrt(1 - s * s);
    sites.forEach((p, i) => { const phi = p.theta / s; V[3 * i] = a * p.rho * s * Math.cos(phi); V[3 * i + 1] = a * p.rho * s * Math.sin(phi); V[3 * i + 2] = -a * p.rho * c; });
  } else if (n === 6) {
    sites.forEach((p, i) => { V[3 * i] = a * p.rho * Math.cos(p.theta); V[3 * i + 1] = a * p.rho * Math.sin(p.theta); V[3 * i + 2] = 0; });
  } else {
    // a three-lobed guess whose rim is about the right length, then edge-length relaxation
    const k = 0.9, h = Math.sqrt(Math.max(0, (s * s - k * k) / 4.5)), lobes = 3;
    sites.forEach((p, i) => { const phi = p.theta / s; V[3 * i] = a * p.rho * k * Math.cos(phi); V[3 * i + 1] = a * p.rho * k * Math.sin(phi); V[3 * i + 2] = a * h * p.rho * Math.cos(lobes * phi); });
    relaxEdges(V, F, a, 400);
  }
  return V;
}

/** Jacobi edge-length projection: every edge pulled toward length a, the centre held, light smoothing against folds */
export function relaxEdges(V, F, a, iters = 300) {
  const nV = V.length / 3, nT = F.length / 3, eset = new Set(), E = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const p = F[3 * t + k], q = F[3 * t + (k + 1) % 3], kk = p < q ? p * nV + q : q * nV + p; if (!eset.has(kk)) { eset.add(kk); E.push([Math.min(p, q), Math.max(p, q)]); } }
  const nbr = Array.from({ length: nV }, () => []); for (const [p, q] of E) { nbr[p].push(q); nbr[q].push(p); }
  const D = new Float64Array(3 * nV), C = new Float64Array(nV);
  for (let it = 0; it < iters; it++) {
    D.fill(0); C.fill(0);
    for (const [p, q] of E) {
      const dx = V[3 * q] - V[3 * p], dy = V[3 * q + 1] - V[3 * p + 1], dz = V[3 * q + 2] - V[3 * p + 2], l = Math.hypot(dx, dy, dz) || 1e-9, f = 0.5 * (l - a) / l;
      D[3 * p] += f * dx; D[3 * p + 1] += f * dy; D[3 * p + 2] += f * dz; D[3 * q] -= f * dx; D[3 * q + 1] -= f * dy; D[3 * q + 2] -= f * dz; C[p]++; C[q]++;
    }
    const w = it < iters / 2 ? 0.08 : 0.02;                       // Laplacian smoothing, fading out
    for (let i = 1; i < nV; i++) {
      if (!C[i]) continue;
      let sx = 0, sy = 0, sz = 0; for (const j of nbr[i]) { sx += V[3 * j]; sy += V[3 * j + 1]; sz += V[3 * j + 2]; } const m = nbr[i].length;
      V[3 * i] += D[3 * i] / C[i] + w * (sx / m - V[3 * i]); V[3 * i + 1] += D[3 * i + 1] / C[i] + w * (sy / m - V[3 * i + 1]); V[3 * i + 2] += D[3 * i + 2] / C[i] + w * (sz / m - V[3 * i + 2]);
    }
  }
  return V;
}

/** the built-in cases: id → {label, make(): {V, F, meta}} */
export const SYNTHETIC = {
  flat6: { label: 'flat hexagon patch (no singularity)', make: () => mk(6, 4, 10, 'flat patch') },
  cone5: { label: 'ideal cone, one 5 (one wedge out)', make: () => mk(5, 4, 10, 'ideal cone n = 5') },
  cone4: { label: 'ideal cone, one 4 (two wedges out)', make: () => mk(4, 4, 10, 'ideal cone n = 4') },
  cone3: { label: 'ideal cone, one 3 (three wedges out)', make: () => mk(3, 4, 10, 'ideal cone n = 3') },
  saddle7: { label: 'saddle, one 7 (one wedge in, relaxed)', make: () => mk(7, 4, 10, 'saddle n = 7') },
};
function mk(n, R, a, name) { const lat = wedgeLattice(n, R); const V = embedLattice(lat, a); return { V, F: lat.F, header: `synthetic ${name}: valence ${n} centre, a = ${a}, hex radius ${R}`, meta: { a, name, seedValence: n } }; }
