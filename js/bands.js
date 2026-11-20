// bands.js — THE BANDED WEAVE: every strand of the lattice in n strips side by side (Ji, 19 Nov: the star weave as in the
// rattan photo — n strips on every side of a cell, the cell itself stays an open hole).
//
// A strand of the lattice (weave.js) becomes a band: n plies at the pitch `pitch`, centred on the strand's own line.
// Where two strands cross on a lattice edge, their bands cross in a BLOCK of n × n crossings. Who is on top in a block:
//   · no star near:      the plies of the strand that is on top in the hexagonal weave — the block is woven as one crossing
//   · a corner of a STAR (one of the two cells of the edge is a centre): the plies are counted from that cell, round 1
//     nearest to it; the ply of the EARLIER round is on top ("the new strip is pushed under the V"), the same round as the
//     hexagonal weave has it — the nested V of the sheet
//   · a point of a star (the cell opposite the edge, across one of its two triangles, is a centre): the ply of the LATER
//     round is on top — the ends of a new strip lie over the rounds before it
//   · between two centres: each crossing of the block goes with the centre it is nearer to
// → { n, pitch, plies: [{ strand, k, offset, closed, family, knots: [{ p, n, e, over, rim, by: [strand, k], dir }] }], of(strand, k),
//     fit: how wide a band can be on every stretch of every strand (sorted), tight: on how many of them this band is wider }
// opts: { n, pitch | pitchOf(fit) → pitch, centres: [cells], hand }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const add = (a, b, s = 1) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

export function bandWeave(w, opts = {}) {
  const n = Math.max(1, opts.n | 0 || 3), hand = opts.hand < 0 ? -1 : 1; let pitch = opts.pitch;
  const isC = new Uint8Array(w.nV); for (const c of opts.centres || []) if (c >= 0 && c < w.nV) isC[c] = 1;
  const M = (e) => [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]], Nn = (e) => [w.edgeNrm[3 * e], w.edgeNrm[3 * e + 1], w.edgeNrm[3 * e + 2]];
  const cell = (v) => [w.V[3 * v], w.V[3 * v + 1], w.V[3 * v + 2]];
  const off = (k) => (k - (n - 1) / 2) * pitch;
  const plain = w.plainOver || w.overRaw;                           // the hexagonal weave's own over / under, read from the side of the normals
  /** the direction of strand si at its crossing i (along its numbering), in the plane of the lattice there */
  const dirAt = (si, i) => {
    const s = w.strands[si], K = s.knots.length, a = s.closed ? (i - 1 + K) % K : Math.max(0, i - 1), b = s.closed ? (i + 1) % K : Math.min(K - 1, i + 1), N = Nn(s.knots[i]);
    const t = sub(M(s.knots[b]), M(s.knots[a])); return unit(add(t, N, -dot(t, N)));
  };
  /** onto the lattice: the point x beside the crossing on edge e is put on the triangle of the edge it lies over */
  const triOf = (e) => w.edgeTris[e];
  const onto = (e, x) => {
    const N = Nn(e), m = M(e), [u, v] = w.edges[e], d = unit(sub(cell(v), cell(u))), side = dot(sub(x, m), cross(N, d));
    let best = -1, bs = 0;
    for (const t of triOf(e)) { let o = -1; for (let q = 0; q < 3; q++) { const y = w.F[3 * t + q]; if (y !== u && y !== v) o = y; } const s2 = dot(sub(cell(o), m), cross(N, d)); if (best < 0 || s2 * side > bs) { best = t; bs = s2 * side; } }
    if (best < 0) return x;
    const a = cell(w.F[3 * best]), nt = unit(cross(sub(cell(w.F[3 * best + 1]), a), sub(cell(w.F[3 * best + 2]), a))), den = dot(N, nt);
    return Math.abs(den) > 0.2 ? add(x, N, dot(sub(a, x), nt) / den) : x;
  };
  const real = (e) => w.edgeTris[e].length === 2 && w.knotStrands[e].length === 2;
  // how the two strands lie at every crossing of the lattice: their directions, and how askew they cross
  const lay = new Map();
  for (let e = 0; e < w.nE; e++) {
    if (!real(e)) continue;
    const [[sa, ia], [sb, ib]] = w.knotStrands[e], N = Nn(e), ta = dirAt(sa, ia), tb = dirAt(sb, ib), ba = cross(N, ta), bb = cross(N, tb), ka = dot(tb, ba), kb = dot(ta, bb);
    if (Math.abs(ka) < 1e-6 || Math.abs(kb) < 1e-6) continue;
    lay.set(e, { sa, ia, sb, ib, N, ta, tb, ba, bb, ka, kb, cab: dot(ta, tb) });
  }
  // HOW WIDE A BAND CAN BE. Where two bands cross askew, a band b wide takes b / 2 · (1 + |cos|) / |sin| of the other
  // strand's length on either side of the crossing; two crossings of a strand L apart leave room for bands up to
  // 2 L / (x₀ + x₁) wide — 0.289 a on a lattice of equal edges a, where the bands then just close the triangles of the
  // hexagonal weave. On a lattice of unequal edges the room differs from stretch to stretch: `fit` holds it for every
  // stretch, sorted. A band wider than a stretch allows runs into the next crossing's strips there (`tight` counts them).
  const fit = [], reach = (e, si, i) => { const L = lay.get(e); if (!L) return 0; return L.sa === si && L.ia === i ? 1 / Math.abs(L.kb) + Math.abs(L.cab) / Math.abs(L.ka) : 1 / Math.abs(L.ka) + Math.abs(L.cab) / Math.abs(L.kb); };
  w.strands.forEach((s, si) => {
    const K = s.knots.length, nseg = s.closed ? K : K - 1;
    for (let j = 0; j < nseg; j++) { const i1 = (j + 1) % K, x = reach(s.knots[j], si, j) + reach(s.knots[i1], si, i1); if (x > 0) { const d = sub(M(s.knots[i1]), M(s.knots[j])); fit.push(2 * Math.hypot(d[0], d[1], d[2]) / x); } }
  });
  fit.sort((x, y) => x - y);
  if (typeof opts.pitchOf === 'function') pitch = opts.pitchOf(fit);
  let tight = 0; for (const f of fit) if (f < n * pitch) tight++;
  // the blocks: for every crossing of the lattice, where its n × n crossings are and who is on top
  const blocks = new Map();
  for (const [e, L] of lay) {
    const { sa, ia, sb, ib, N, ta, tb, ba, bb, ka, kb } = L, m = M(e);
    const topA = (plain(sa, ia) ? 1 : -1) * hand > 0;                // the strand on top in the hexagonal weave (the mirror image: the other one)
    const [u, v] = w.edges[e], thirds = w.edgeTris[e].map(t => { for (let q = 0; q < 3; q++) { const y = w.F[3 * t + q]; if (y !== u && y !== v) return y; } return -1; });
    const rank = (c, b, k) => (dot(sub(cell(c), m), b) > 0 ? n - k : k + 1);   // the round of ply k as counted from cell c (1: nearest)
    const rule = (c, k, q, tip) => { const ra = rank(c, ba, k), rb = rank(c, bb, q), rT = topA ? ra : rb, rO = topA ? rb : ra; return { top: tip ? rT >= rO : rT <= rO, near: ra + rb }; };
    const pick = (cs, k, q, tip) => { if (cs.length === 1) return rule(cs[0], k, q, tip).top; const A = rule(cs[0], k, q, tip), B = rule(cs[1], k, q, tip); return A.near < B.near ? A.top : B.near < A.near ? B.top : true; };
    const corners = [u, v].filter(c => isC[c]), tips = thirds.filter(c => c >= 0 && isC[c]);
    const pos = [], aOver = [];
    for (let k = 0; k < n; k++) { pos.push([]); aOver.push([]); for (let q = 0; q < n; q++) {
      pos[k].push(onto(e, add(add(m, ta, off(q) / kb), tb, off(k) / ka)));
      const top = corners.length ? pick(corners, k, q, false) : tips.length ? pick(tips, k, q, true) : true;
      aOver[k].push(top === topA);
    } }
    blocks.set(e, { sa, ia, sb, ib, ta, tb, N, pos, aOver, kb, ka, cab: dot(ta, tb), star: corners.length ? 'corner' : tips.length ? 'point' : '' });
  }
  // the plies: every strand n times, through the blocks in the order it meets the other band's plies
  const plies = [], of = (si, k) => si * n + k;
  w.strands.forEach((s, si) => {
    for (let k = 0; k < n; k++) {
      const knots = [];
      s.knots.forEach((e, i) => {
        const B = blocks.get(e);
        if (!B) { const N = Nn(e), t = dirAt(si, i); knots.push({ p: add(M(e), cross(N, t), off(k)), n: N, e, i, s: 0, rim: true, over: false, by: null, dir: null }); return; }
        const isA = B.sa === si && B.ia === i, order = [...Array(n).keys()].sort((x, y) => (off(x) - off(y)) * (isA ? B.kb : B.ka));   // along this strand: the other band's plies as they come
        // (i, s: the crossing lies s along the strand from its crossing i with the other strand's own line)
        for (const q of order) knots.push({ p: isA ? B.pos[k][q] : B.pos[q][k], n: B.N, e, i, s: isA ? off(q) / B.kb + off(k) / B.ka * B.cab : off(q) / B.ka + off(k) / B.kb * B.cab, rim: false, over: isA ? B.aOver[k][q] : !B.aOver[q][k], by: [isA ? B.sb : B.sa, q], dir: isA ? B.tb : B.ta, star: B.star });
      });
      plies.push({ strand: si, k, offset: off(k), closed: s.closed, family: w.family ? w.family[si] : 0, knots });
    }
  });
  return { n, pitch, plies, of, blocks, fit, tight };
}

/** THE BAND AS GUESTS (guests.js): of the n strips of a band the lattice's own strand is one — the middle one (the
 *  lower middle of an even n: its crossings then lie half a pitch beside the edge midpoints) — and the others are strips
 *  of their own beside it, named b, c, d … from the nearest out. A block's n × n crossings: the one of the two middle
 *  strips is the lattice's crossing; every other one is a crossing the guests add.
 *  → G for extendWeave, and ov: the over / under of the lattice's own strands (the middle strips), [strand][knot] */
export function bandGuests(w, B) {
  const n = B.n, k0 = Math.floor((n - 1) / 2), nE = w.nE, nS = w.strands.length;
  const order = []; for (let d = 1; order.length < n - 1; d++) { if (k0 + d < n) order.push(k0 + d); if (k0 - d >= 0 && order.length < n - 1) order.push(k0 - d); }
  const rankOf = new Int32Array(n).fill(-1); order.forEach((k, r) => { rankOf[k] = r; });
  const sx = (si, k) => (k === k0 ? si : nS + si * (n - 1) + rankOf[k]);       // ply k of lattice strand si, as a strand of the extended weave
  const pos = [], nrm = [], ids = new Map(), moved = new Map();
  const newX = (p, N) => { pos.push(p[0], p[1], p[2]); nrm.push(N[0], N[1], N[2]); return nE + pos.length / 3 - 1; };
  const idOf = (kn, si, k) => {
    if (kn.rim) { if (k !== k0) return newX(kn.p, kn.n); if (n % 2 === 0) moved.set(kn.e, kn.p); return kn.e; }
    const Bk = B.blocks.get(kn.e), isA = Bk.sa === si && Bk.ia === kn.i, ka = isA ? k : kn.by[1], kb = isA ? kn.by[1] : k;
    if (ka === k0 && kb === k0) { if (n % 2 === 0) moved.set(kn.e, kn.p); return kn.e; }
    const key = (kn.e * n + ka) * n + kb; let x = ids.get(key); if (x === undefined) { x = newX(kn.p, kn.n); ids.set(key, x); } return x;
  };
  const where = new Map(), strands = [];
  for (let si = 0; si < nS; si++) for (const k of order) {
    const ply = B.plies[B.of(si, k)], K = ply.knots.length, me = sx(si, k);
    const knots = new Array(K), over = new Uint8Array(K), lv = new Float32Array(K), quiet = new Uint8Array(K), loose = new Uint8Array(K), hk = new Int32Array(K), cross = new Array(K).fill(null);
    ply.knots.forEach((kn, i) => {
      const x = idOf(kn, si, k); knots[i] = x; hk[i] = kn.i;
      if (kn.rim) { quiet[i] = 1; loose[i] = 1; return; }
      const Bk = B.blocks.get(kn.e), isA = Bk.sa === si && Bk.ia === kn.i;
      over[i] = kn.over ? 1 : 0; lv[i] = over[i];
      cross[i] = { s: sx(kn.by[0], kn.by[1]), i: isA ? Bk.ib : Bk.ia, e: kn.e };   // (i: the lattice knot of the strand it crosses — its own knot there when that one is a guest too, below)
      if (!where.has(x)) where.set(x, []); where.get(x).push([me, i]);
    });
    strands.push({ knots, closed: ply.closed, family: ply.family, host: si, tag: String.fromCharCode(98 + rankOf[k]), hk, over, lv, quiet, loose, cross });
  }
  strands.forEach((g, gi) => g.cross.forEach((c, i) => { if (!c || c.s < nS) return; const o = (where.get(g.knots[i]) || []).find(([s2, i2]) => !(s2 === nS + gi && i2 === i)); if (o) c.i = o[1]; }));
  // THE LINE OF EVERY STRIP (view.js _plyCurve): the line of its lattice strand, moved sideways by `off`. Along it the
  // strip's crossings — for a strand of the lattice all the crossings of its blocks, not only the one it has a knot at —
  // each with: tau (where on the line: the host's crossing index + the fraction of the way to the next one), ov (1: on
  // top there), ps / pa (the strip it crosses and that strip's own entry for the crossing; −1: a loose end), ki (the
  // knot of the strip the crossing belongs to), and kn (a lattice strand: knot → entry).
  const ov = w.strands.map(s => new Uint8Array(s.knots.length)), path = new Array(nS * n), seen = new Map();
  const M = (e) => [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]];
  const segAfter = w.strands.map(s => { const K = s.knots.length, L = new Float64Array(K); for (let i = 0; i < K; i++) { const j = s.closed ? (i + 1) % K : i + 1; if (j < K && j !== i) { const p0 = M(s.knots[i]), p1 = M(s.knots[j]); L[i] = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); } } return L; });
  for (let si = 0; si < nS; si++) for (let k = 0; k < n; k++) {
    const ply = B.plies[B.of(si, k)], m = ply.knots.length, isBase = k === k0, me = sx(si, k), s = w.strands[si], K = s.knots.length, L = segAfter[si];
    const tau = new Float64Array(m), o = new Uint8Array(m), ps = new Int32Array(m).fill(-1), pa = new Int32Array(m).fill(-1), ki = new Int32Array(m), kn = isBase ? new Int32Array(K).fill(-1) : null;
    ply.knots.forEach((q, a) => {
      const after = L[q.i] > 0 ? L[q.i] : 0, before = L[s.closed ? (q.i - 1 + K) % K : Math.max(0, q.i - 1)] || after, len = (q.s >= 0 ? after || before : before || after) || 1;
      tau[a] = q.i + q.s / len; if (a > 0 && tau[a] < tau[a - 1] + 1e-4) tau[a] = tau[a - 1] + 1e-4;   // (a band wider than the lattice allows there: the strip does not go back)
      o[a] = q.over ? 1 : 0; ki[a] = isBase ? q.i : a;
      if (isBase && (q.rim || q.by[1] === k0)) { kn[q.i] = a; ov[si][q.i] = q.over ? 1 : 0; }
      if (q.rim) return;
      const x = isBase ? idOf(q, si, k0) : strands[si * (n - 1) + rankOf[k]].knots[a];
      if (!seen.has(x)) seen.set(x, []); seen.get(x).push([me, a]);
    });
    path[me] = { n: m, host: si, off: ply.offset, per: n, pitch: B.pitch, tau, ov: o, ps, pa, ki, kn };
  }
  for (const list of seen.values()) if (list.length === 2) { const [[s0, a0], [s1, a1]] = list; path[s0].ps[a0] = s1; path[s0].pa[a0] = a1; path[s1].ps[a1] = s0; path[s1].pa[a1] = a0; }
  return { kind: 'ply', top: 1, per: n, pos, nrm, moved: moved.size ? moved : null, strands, baseLv: null, path, cover: {}, ov, k0 };
}
