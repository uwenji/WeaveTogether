// guests.js — STRIPS THAT ARE NOT STRANDS OF THE LATTICE, as strips of the plan (Ji, 19 Nov: the hemp leaf's centre
// strips "become strips"; the star weave "every strand in n strips").
//
// The lattice gives the weave its strands (weave.js): one through every edge midpoint. Two patterns add strips that the
// lattice does not have — the hemp leaf its centre strips (through the middle of the cells), the star weave the strips
// that lie beside every strand of the lattice. They are GUESTS: the planners never see them (a guest crosses no lattice
// edge of its own: the cell tour and ring to ring plan the lattice's weave, as ever), and everything after the planner
// does — the view, the History bar, the lengths, the exports.
//
//   extendWeave(w, G)  → wx: the weave with the guests as strands of their own. wx inherits everything from w
//                        (Object.create), and adds: wx.strands (the lattice's, then the guests': { knots, closed, guest,
//                        len: the lengths of its segments, … }), the crossings they pass (ids from w.nE on:
//                        wx.edgeMid / edgeNrm / knotStrands, wx.nX of them in all), wx.over / wx.level for both kinds,
//                        wx.family, wx.strandLen. wx.nE stays the number of lattice edges.
//   augmentPlan(wx, plan, opts) → the plan of the lattice's weave with the guests added: their strips (cut to the
//                        material's length, joined by an overlap as the lattice's are), and a step for every one of
//                        them after the lattice's own (opts.method 'along', the hemp leaf: no step — a centre strip is
//                        laid in as the crossings along its line are made).
//
// G (what a pattern hands over, patterns.js / bands.js):
//   { kind: 'centre' | 'ply', top: the highest layer (the other side of the weave reads top − level),
//     pos, nrm: the crossings the guests add (3 numbers each; crossing nE + i), moved: Map(lattice edge → where its
//     crossing lies instead of the edge midpoint) | null,
//     strands: [{ knots: crossing ids, closed, family, host: its lattice strand (ply) | −1, tag: what its name adds,
//                 hk: per knot the knot of the host it lies beside (ply), over: per knot 1 = on top, lv: per knot its
//                 layer, quiet: per knot 1 = nothing to weave there (the middle of a cell, an end), loose: 1 = a loose
//                 end (lies on the surface), cross: per knot { s: the strand it crosses, i: that strand's knot there,
//                 e: the lattice edge } | null (ply), between: per knot the lattice edge whose two strips hold it | −1 (centre) }],
//     baseLv: per lattice strand the layer at each of its knots | null (over: top, under: 0),
//     path: per strand of wx the points its centreline runs through | null, cover: {} | null (see view.js _strandCurve),
//     stacks: Map(crossing → [[guest, knot]]) the strips that lie on each other in the middle of a cell (centre) }

const hyp = (A, i, j) => Math.hypot(A[3 * i] - A[3 * j], A[3 * i + 1] - A[3 * j + 1], A[3 * i + 2] - A[3 * j + 2]);

export function extendWeave(w, G) {
  const nS0 = w.strands.length, nE = w.nE, nx = G.pos.length / 3, nX = nE + nx, top = G.top;
  const wx = Object.create(w);
  const edgeMid = new Float64Array(3 * nX), edgeNrm = new Float64Array(3 * nX);
  edgeMid.set(w.edgeMid); edgeNrm.set(w.edgeNrm); edgeMid.set(G.pos, 3 * nE); edgeNrm.set(G.nrm, 3 * nE);
  if (G.moved) for (const [e, p] of G.moved) { edgeMid[3 * e] = p[0]; edgeMid[3 * e + 1] = p[1]; edgeMid[3 * e + 2] = p[2]; }
  const knotStrands = w.knotStrands.concat(Array.from({ length: nx }, () => []));
  const strands = w.strands.slice(), family = Array.from(w.family), strandLen = Array.from(w.strandLen);
  G.strands.forEach((g, gi) => {
    const si = nS0 + gi, K = g.knots.length, nseg = g.closed ? K : K - 1, len = new Float64Array(Math.max(nseg, 0));
    let total = 0; for (let j = 0; j < nseg; j++) { len[j] = hyp(edgeMid, g.knots[j], g.knots[(j + 1) % K]); total += len[j]; }
    g.knots.forEach((x, i) => { if (x >= nE) knotStrands[x].push([si, i]); });
    strands.push({ knots: Array.from(g.knots), closed: !!g.closed, segs: null, guest: true, gi, kind: G.kind, len, host: g.host ?? -1, tag: g.tag || '', hk: g.hk || null, quiet: g.quiet || null, cross: g.cross || null, between: g.between || null });
    family.push(g.family ?? -1); strandLen.push(total);
  });
  const rimEdge = (e) => e < nE && w.edgeTris[e].length < 2;
  Object.assign(wx, { base: w, nS0, nX, top, guestKind: G.kind, per: G.per || 1, strands, edgeMid, edgeNrm, knotStrands, family, strandLen, layers: top + 1, lev: true, path: G.path || null, cover: G.cover || null, inlay: null });
  // over and under, and the layer of a strip at a crossing: read from the lath side (w.side), as weave.js's own
  Object.defineProperty(wx, 'side', { get: () => w.side, set: (v) => { w.side = v; }, enumerable: true, configurable: true });
  wx.over = (si, i) => { if (si < nS0) return w.over(si, i); const o = !!G.strands[si - nS0].over[i]; return w.side < 0 ? !o : o; };
  wx.level = (si, i) => {
    let lv;
    if (si < nS0) { if (rimEdge(w.strands[si].knots[i])) return 0; lv = G.baseLv ? G.baseLv[si][i] : (w.overRaw(si, i) ? top : 0); }
    else { const g = G.strands[si - nS0]; if (g.loose && g.loose[i]) return 0; lv = g.lv[i]; if (w.side < 0 && g.tp) return g.tp[i] - lv; }
    return w.side < 0 ? top - lv : lv;
  };
  /** the strips that cross in the middle of a cell lie on each other in the order they are laid — the first at the
   *  bottom (Ji, 18 Nov: "first always on the bottom"); when(guest strand, knot): the moment it is laid there */
  wx.restack = (when) => {
    if (!G.stacks) return;
    for (const list of G.stacks.values()) {
      const m = list.length, o = list.map(([g, i], n) => ({ g, i, n, t: when ? when(nS0 + g, i) : n })).sort((x, y) => (x.t - y.t) || (x.n - y.n));
      // (a stack of fewer strips than layers sits round the middle; a cell of eight sides has four: one more layer there)
      o.forEach((q, k) => { const g = G.strands[q.g]; g.lv[q.i] = k + (top + 1 - Math.min(top + 1, m)) / 2; (g.tp || (g.tp = new Float32Array(g.knots.length).fill(top)))[q.i] = Math.max(top, m - 1); });
    }
  };
  wx.restack(null);
  return wx;
}

/** cut a walk into strips no longer than maxL (0: one strip), consecutive ones sharing `lap` crossings: [{ q0, q1 }] in
 *  the walk's own numbering (q1 runs past K − 1 on a closed strand: the last strip laps over the first); firstL: the
 *  first strip no longer than this (the joints of strips that lie side by side are not all in one place) */
function cutWalk(walk, maxL, lap, firstL = maxL) {
  const { K, nseg, closed } = walk;
  if (K < 2) return [{ q0: 0, q1: K - 1 }];
  const arc = new Float64Array(nseg + 1); for (let q = 0; q < nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
  const total = arc[nseg];
  if (!(maxL > 0) || total <= maxL) return [{ q0: 0, q1: K - 1 }];
  const lastQ = closed ? K - 1 + lap : K - 1, mod = (q) => ((q % K) + K) % K;
  const arcAt = (q) => (closed ? Math.floor(q / K) * total + arc[mod(q)] : arc[Math.max(0, Math.min(K - 1, q))]);
  const before = (q) => arcAt(q) - (closed || q > 0 ? walk.segLen(mod(q - 1)) / 2 : 0), after = (q) => arcAt(q) + (closed || q < K - 1 ? walk.segLen(mod(q)) / 2 : 0);
  const out = []; let a = 0;
  for (let guard = 0; guard < 4 * K + 8; guard++) {
    const lim = out.length ? maxL : Math.min(maxL, firstL);
    let b = a; while (b + 1 <= lastQ && after(b + 1) - before(a) <= lim) b++;
    // (a closed strand: only its last strip runs on over the first one, and it keeps a crossing of its own before that)
    if (closed && b < lastQ && b > K - 2) b = Math.max(a, K - 2);
    out.push({ q0: a, q1: b }); if (b >= lastQ) break;
    a = Math.max(b - lap + 1, a + 1);
  }
  return out;
}

/** THE STAR FROM ITS CENTRE (Ji, 20 Nov — his images 1–5, and "my B is correct … update it band by band and set it as
 *  the default"). No hexagonal weave first: every strip of the weave — the lattice's own strands, which are the middle
 *  strips of the bands, as much as the strips beside them — is a strip of this plan and a step of its own, threaded
 *  through the strips that are there already. The order:
 *    · THE STAR IN ROUNDS: round the centre the strip nearest the hole on every side, then the second strip on every
 *      side, then the third …;
 *    · then outward BAND BY BAND: ring after ring, and in a ring one band after the other, each from its strip nearest
 *      the centre out.
 *  The centre is the one the weave starts at (the plan's start cell when that is a centre of the pattern, else the
 *  centre nearest to it); everything is counted from it: the ring of a cell is its distance from the centre in cells, a
 *  strip belongs to the ring of the cell nearest the centre that it passes (a strand cut into several strips: each of
 *  them by itself — so on a closed shape the far side comes last). A strand is cut so that its first strip lies with
 *  its middle at the centre; the joints of the strips of a band are not side by side; and where two strips of a strand
 *  are joined, the end of the one threaded later lies on the other.
 *  Names: the bands S1, S2 … in the order they are begun; in a band the strip threaded first carries the band's name,
 *  the next ones b, c … (S3, S3b, S3c) — as ever, only that the first strip is now the one nearest the centre and not
 *  the middle one.
 *  The planner's own steps (the cell tour, ring to ring) are not used, nor its cuts: one weaver, no clips. What stays of
 *  its plan: the start cell and the tables the view and the charts read. */
function centrePlan(wx, plan, opts = {}) {
  const w = wx.base, nS0 = wx.nS0, nS = wx.strands.length, nE = w.nE, nX = wx.nX, n = wx.per || 1, kind = wx.guestKind, BIG = 1 << 28;
  const maxL = opts.maxLength > 0 ? opts.maxLength : 0, lapK = Math.max(0, Math.min(6, opts.overlap | 0));
  const grow = (A, m, fill = 0) => { if (Array.isArray(A)) return A.concat(Array(Math.max(0, m - A.length)).fill(fill)); const B = new A.constructor(m); if (fill) B.fill(fill); B.set(A.subarray ? A.subarray(0, Math.min(A.length, m)) : A); return B; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // --- the centre the weave starts at, and the ring of every cell round it ---------------------------------------------
  const nbr = Array.from({ length: w.nV }, () => []); for (const [a, b] of w.edges) { nbr[a].push(b); nbr[b].push(a); }
  const bfs = (from) => { const d = new Int32Array(w.nV).fill(-1), q = [from]; d[from] = 0; for (let h = 0; h < q.length; h++) { const v = q[h]; for (const u of nbr[v]) if (d[u] < 0) { d[u] = d[v] + 1; q.push(u); } } return d; };
  const centres = w.pattern && Array.isArray(w.pattern.centres) ? w.pattern.centres.filter(c => c >= 0 && c < w.nV) : [];
  const start = Number.isInteger(plan.start) && plan.start >= 0 && plan.start < w.nV ? plan.start : (centres.length ? centres[0] : 0);
  let c0 = start;
  if (centres.length && !centres.includes(start)) { const d = bfs(start); let bd = Infinity; for (const c of centres) { const x = d[c] < 0 ? BIG : d[c]; if (x < bd) { bd = x; c0 = c; } } }
  const hop = bfs(c0), ringOfEdge = (e) => { const [a, b] = w.edges[e]; return Math.min(hop[a] < 0 ? BIG : hop[a], hop[b] < 0 ? BIG : hop[b]); };
  const Mx = (x) => [wx.edgeMid[3 * x], wx.edgeMid[3 * x + 1], wx.edgeMid[3 * x + 2]], C0 = [w.V[3 * c0], w.V[3 * c0 + 1], w.V[3 * c0 + 2]];
  const N0 = unit([w.N[3 * c0], w.N[3 * c0 + 1], w.N[3 * c0 + 2]]); let ex = Math.abs(N0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; { const k = dot(ex, N0); ex = unit([ex[0] - k * N0[0], ex[1] - k * N0[1], ex[2] - k * N0[2]]); } const ey = crs(N0, ex);
  const hostOf = (si) => (si < nS0 ? si : wx.strands[si].host), hostKnot = (si, i) => (si < nS0 ? i : wx.strands[si].hk[i]);
  const ringAt = (si, i) => ringOfEdge(w.strands[hostOf(si)].knots[hostKnot(si, i)]);
  // --- where a strand passes the centre: at a knot of its lattice strand from which it gets further away both ways (a long
  //     strand can pass it more than once — the Bunny's two strands make every side of every cell). There: on which side
  //     of it the centre lies, and where round the centre it is -----------------------------------------------------------
  const keyAt = (h, j) => { const e = w.strands[h].knots[j], m = Mx(e); return [ringOfEdge(e), Math.hypot(m[0] - C0[0], m[1] - C0[1], m[2] - C0[2])]; };
  const less = (A, B) => A[0] < B[0] || (A[0] === B[0] && A[1] < B[1] - 1e-12);
  const passMemo = new Map();
  const passOf = (h, j) => {
    const key = h * 65536 + j; let cur = passMemo.get(key); if (cur !== undefined) return cur;
    const s = w.strands[h], K = s.knots.length; cur = j; let kc = keyAt(h, cur);
    for (let guard = 0; guard < K; guard++) { let moved = false; for (const d of [1, -1]) { const nx = s.closed ? (cur + d + K) % K : cur + d; if (nx < 0 || nx >= K || nx === cur) continue; const kn = keyAt(h, nx); if (less(kn, kc)) { cur = nx; kc = kn; moved = true; break; } } if (!moved) break; }
    passMemo.set(key, cur); return cur;
  };
  const sideAt = (h, j) => { const s = w.strands[h], K = s.knots.length, ia = s.closed ? (j + 1) % K : Math.min(K - 1, j + 1), ib = s.closed ? (j - 1 + K) % K : Math.max(0, j - 1), e = s.knots[j], m = Mx(e);
    const t = unit(sub(Mx(s.knots[ia]), Mx(s.knots[ib]))), b = crs([w.edgeNrm[3 * e], w.edgeNrm[3 * e + 1], w.edgeNrm[3 * e + 2]], t); return dot(sub(C0, m), b) >= 0 ? 1 : -1; };
  const angAt = (h, j) => { const v = sub(Mx(w.strands[h].knots[j]), C0); return Math.atan2(dot(v, ey), dot(v, ex)); };
  // the band as a whole: where it comes nearest to the centre (its strips are cut from there, and named from that side)
  const band = w.strands.map((s, h) => { let best = 0, kb = [BIG + 1, Infinity]; for (let j = 0; j < s.knots.length; j++) { const kj = keyAt(h, j); if (less(kj, kb)) { kb = kj; best = j; } } return { knot: best, side: sideAt(h, best) }; });
  // (the strips of a band from one side to the other; the place of a strip counted from the side of the centre: 0 nearest)
  const offOf = (si) => (wx.path && wx.path[si] ? wx.path[si].off : 0), plies = new Array(nS0), plyAt = new Int32Array(nS);
  { const by = Array.from({ length: nS0 }, () => []); for (let si = 0; si < nS; si++) by[hostOf(si)].push(si);
    by.forEach((ids, h) => { ids.sort((x, y) => (offOf(x) - offOf(y)) || (x - y)); ids.forEach((si, r) => { plyAt[si] = r; }); plies[h] = ids; }); }
  const rankAt = (si, side) => (side > 0 ? plies[hostOf(si)].length - 1 - plyAt[si] : plyAt[si]);
  const rank = new Int32Array(nS); for (let si = 0; si < nS; si++) rank[si] = rankAt(si, band[hostOf(si)].side);   // (for its name: as counted where the band is nearest the centre)
  const label = grow(plan.label, nS);
  const rankWord = (r) => (r === 0 ? 'nearest the centre' : r === n - 1 ? 'the outer strip' : n === 3 ? 'the middle strip' : `strip ${r + 1} of ${n} from the centre`);
  // --- the walks: a closed strand begins so that its first strip has its middle at the centre -------------------------------
  const offset = grow(plan.offset, nS), reversed = grow(plan.reversed, nS), walks = new Array(nS);
  for (let si = 0; si < nS; si++) {
    const s = wx.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, h = hostOf(si), per = si < nS0 ? 1 : n;
    const rawLen = si < nS0 ? (j) => { const sg = s.segs && s.segs[j]; return sg ? w.segLen[3 * sg[0] + sg[1]] : 0; } : (j) => s.len[j];
    let near = band[h].knot; if (si >= nS0) { const hits = []; for (let i = 0; i < K; i++) if (s.hk[i] === band[h].knot) hits.push(i); near = hits.length ? hits[hits.length >> 1] : 0; }
    let total = 0; for (let j = 0; j < nseg; j++) total += rawLen(j);
    const cut = maxL > 0 && total > maxL, shift = cut && n > 1 ? (rank[si] - (n - 1) / 2) / n * 0.6 * maxL : 0, lapLen = total / Math.max(1, nseg) * lapK * per;
    let firstL = maxL;
    if (s.closed) {
      const arc = new Float64Array(K + 1); for (let j = 0; j < K; j++) arc[j + 1] = arc[j] + rawLen(j);
      const from = total > 0 ? ((((arc[near] - (cut ? maxL / 2 - shift : total / 2)) % total) + total) % total) : 0;
      let i0 = 0; while (i0 < K && arc[i0] < from - 1e-9) i0++;
      offset[si] = i0 % K; reversed[si] = 0;
    } else {
      reversed[si] = plan.reversed[h] ? 1 : 0; offset[si] = 0;
      if (cut) { const qn = reversed[si] ? K - 1 - near : near; let an = 0; for (let q = 0; q < qn; q++) an += rawLen(reversed[si] ? nseg - 1 - q : q);
        const P = Math.max(0.3 * maxL, maxL - lapLen); let f = (((an - maxL / 2 + shift) % P) + P) % P; if (f < 0.35 * maxL) f += P; firstL = Math.min(maxL, f); }
    }
    const off = offset[si], rev = reversed[si];
    const knotAt = (q) => (s.closed ? (((q + off) % K) + K) % K : (rev ? K - 1 - q : q)), segAt = (q) => (s.closed ? (((q + off) % K) + K) % K : (rev ? nseg - 1 - q : q));
    walks[si] = { K, nseg, knotAt, segAt, segLen: (q) => rawLen(segAt(q)), segCell: () => -1, closed: s.closed, firstL, lap: lapK * per };
  }
  // --- the strips ------------------------------------------------------------------------------------------------------
  const pieces = new Array(nS), pieceList = [], cutsOf = new Array(nS);
  for (let si = 0; si < nS; si++) {
    const s = wx.strands[si], walk = walks[si], K = walk.K, nseg = walk.nseg, mod = (q) => ((q % K) + K) % K, lap = walk.lap;
    const cuts = cutWalk(walk, maxL, lap, walk.firstL), arc = new Float64Array(nseg + 1); for (let q = 0; q < nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
    const total = arc[nseg], arcAt = (q) => (s.closed ? Math.floor(q / K) * total + arc[mod(q)] : arc[Math.max(0, Math.min(K - 1, q))]);
    const before = (q) => arcAt(q) - (s.closed || q > 0 ? walk.segLen(mod(q - 1)) / 2 : 0), after = (q) => arcAt(q) + (s.closed || q < K - 1 ? walk.segLen(mod(q)) / 2 : 0);
    const list = cuts.map((c, p) => {
      const knots = []; for (let q = c.q0; q <= c.q1; q++) knots.push(walk.knotAt(q));
      const m = knots.length, a0 = before(c.q0), a1 = after(c.q1);
      const ovTail = p > 0 ? Math.min(lap, m - 1) : 0, ovHead = s.closed && cuts.length > 1 && p === cuts.length - 1 ? Math.max(0, Math.min(c.q1 - (K - 1), m - 1 - ovTail)) : 0;
      const rec = { id: pieceList.length, strand: si, p, q0: c.q0, q1: c.q1, ovTail, ovHead, underTail: false, underHead: false, knots, introCell: 1e9, intro: -1, length: a1 - a0,
        label: '', edges: knots.map(i => s.knots[i]), overs: knots.map(i => wx.over(si, i)), arcOf: (mm) => arcAt(c.q0 + mm) - a0, weaver: 0, bends: m, curvature: 0, twist: 0, rank: 0, ring: 0, pass: 0, ang: 0 };
      if (si >= nS0) { rec.guest = true; rec.kind = kind; }
      const E = rec.edges, M = wx.edgeMid, N = wx.edgeNrm, dir = (x, y) => unit([M[3 * y] - M[3 * x], M[3 * y + 1] - M[3 * x + 1], M[3 * y + 2] - M[3 * x + 2]]);
      const deg = (c2) => Math.acos(Math.max(-1, Math.min(1, c2))) * 180 / Math.PI;
      for (let j = 1; j + 1 < m; j++) rec.curvature += deg(dot(dir(E[j - 1], E[j]), dir(E[j], E[j + 1])));
      for (let j = 1; j < m; j++) rec.twist += deg(N[3 * E[j - 1]] * N[3 * E[j]] + N[3 * E[j - 1] + 1] * N[3 * E[j] + 1] + N[3 * E[j - 1] + 2] * N[3 * E[j] + 2]);
      // its ring — of the crossings it does not share with the strip before it or (a strand's last strip) with the first —,
      // where it passes the centre, where round the centre that is, and its place in the band as counted from the centre there
      { const h = hostOf(si), m1 = Math.max(ovTail + 1, m - ovHead); let kb = [BIG + 1, Infinity], jb = hostKnot(si, knots[ovTail]);
        for (let mm = ovTail; mm < m1; mm++) { const j = hostKnot(si, knots[mm]), kj = keyAt(h, j); if (less(kj, kb)) { kb = kj; jb = j; } }
        rec.ring = kb[0] + 1; rec.pass = passOf(h, jb); rec.ang = angAt(h, rec.pass); rec.rank = rankAt(si, sideAt(h, rec.pass)); }
      pieceList.push(rec); return rec;
    });
    cutsOf[si] = cuts; pieces[si] = { nPieces: list.length, pieceLen: Float64Array.from(list.map(x => x.length)), length: total, list, walk };
    if (si >= nS0) pieces[si].guest = true;
  }
  // --- the order: the star in rounds, then ring after ring, band by band --------------------------------------------------
  const keyOf = (pc) => { const h = hostOf(pc.strand); return pc.ring === 1 ? [0, pc.rank, pc.ang, h, pc.p] : [pc.ring, pc.ang, h, pc.rank, pc.p]; };
  const order = pieceList.slice().sort((x, y) => { const A = keyOf(x), B = keyOf(y); for (let i = 0; i < 5; i++) if (A[i] !== B[i]) return A[i] - B[i]; return x.id - y.id; });
  // the names: the bands S1, S2 … as they are begun; in a band the strip nearest the centre carries the band's name, the next ones b, c …
  const bandsBy = []; { const seen = new Uint8Array(nS0); for (const pc of order) { const h = hostOf(pc.strand); if (!seen[h]) { seen[h] = 1; bandsBy.push(h); } } for (let h = 0; h < nS0; h++) if (!seen[h]) bandsBy.push(h); }
  bandsBy.forEach((h, r) => { label[h] = r + 1; }); for (let si = nS0; si < nS; si++) label[si] = label[hostOf(si)];
  for (let si = 0; si < nS; si++) { const name = `S${label[si]}${rank[si] ? String.fromCharCode(97 + rank[si]) : ''}`, list = pieces[si].list; for (const pc of list) pc.label = list.length > 1 ? `${name}.${pc.p + 1}` : name; }
  const stepOfPiece = new Map(order.map((pc, k) => [pc.id, k])), N = order.length, total = N + 1;
  // (a joint: the end of the strip threaded later lies on the one that is there — when the next strip along a strand comes
  //  first, the crossings the two share are its own, and the end of the one before it is laid over them)
  let joints = 0, guestJoints = 0;
  for (let si = 0; si < nS; si++) {
    const s = wx.strands[si], P = pieces[si], list = P.list, walk = P.walk, K = walk.K, nseg = walk.nseg, cuts = cutsOf[si];
    for (let p = 1; p < list.length; p++) { const a = list[p - 1], b = list[p]; if (b.ovTail > 0 && stepOfPiece.get(b.id) < stepOfPiece.get(a.id)) { a.ovHead = Math.max(0, Math.min(b.ovTail, a.knots.length - 1 - a.ovTail)); b.ovTail = 0; } }
    for (const pc of list) { const j = (pc.ovTail ? 1 : 0) + (pc.ovHead ? 1 : 0); joints += j; if (si >= nS0) guestJoints += j; }
    const own = (pc, m) => m >= pc.ovTail && m < pc.knots.length - pc.ovHead;
    const pieceOfKnot = new Int32Array(K).fill(-1), pieceOfKnot2 = new Int32Array(K).fill(-1), pieceOfSeg = new Int32Array(Math.max(nseg, 0)).fill(-1), overlapSeg = new Uint8Array(Math.max(nseg, 0));
    list.forEach((pc, k) => pc.knots.forEach((i, m) => { if (own(pc, m) && pieceOfKnot[i] < 0) pieceOfKnot[i] = k; }));
    list.forEach((pc, k) => pc.knots.forEach((i, m) => { if (!own(pc, m) && pieceOfKnot2[i] < 0 && pieceOfKnot[i] !== k) pieceOfKnot2[i] = k; }));
    for (let i = 0; i < K; i++) if (pieceOfKnot[i] < 0 && pieceOfKnot2[i] >= 0) { pieceOfKnot[i] = pieceOfKnot2[i]; pieceOfKnot2[i] = -1; }   // (a crossing no strip calls its own: the one that passes it)
    for (let q = 0; q < nseg; q++) {
      const owners = []; cuts.forEach((c, k) => { if ((q >= c.q0 && q + 1 <= c.q1) || (s.closed && q + K >= c.q0 && q + K + 1 <= c.q1)) owners.push(k); });
      pieceOfSeg[walk.segAt(q)] = owners.length ? owners[0] : Math.max(0, pieceOfKnot[walk.knotAt(q)]); overlapSeg[walk.segAt(q)] = owners.length > 1 ? 1 : 0;
    }
    Object.assign(P, { pieceOfKnot, pieceOfKnot2, pieceOfSeg, overlapSeg });
  }
  const pieceAt = (si, i) => pieces[si].list[Math.max(0, pieces[si].pieceOfKnot[i])];
  // --- along a strand of the lattice: every crossing of its blocks, not only the one it has a knot at (bands.js: path) -----
  const blocks = new Array(nS0);
  for (let si = 0; si < nS0; si++) { const P = wx.path && wx.path[si], K = wx.strands[si].knots.length, B = Array.from({ length: K }, () => []); if (P) for (let a = 0; a < P.n; a++) if (P.ki[a] >= 0 && P.ki[a] < K) B[P.ki[a]].push(a); blocks[si] = B; }
  const otherPass = (si, i) => { const e = wx.strands[si].knots[i]; for (const [s2, i2] of w.knotStrands[e]) if (!(s2 === si && i2 === i)) return [s2, i2]; return null; };
  /** the crossings a strip passes at its m-th knot, in the order it passes them: [{ so, io: the strip it crosses and that
   *  strip's knot there, x: the crossing, edge: the lattice edge whose block it is in, over: this strip on top }] */
  const crossingsAt = (pc, m) => {
    const si = pc.strand, s = wx.strands[si], i = pc.knots[m], out = [];
    if (si >= nS0) { if (s.quiet && s.quiet[i]) return out; const c = s.cross && s.cross[i]; if (c) out.push({ so: c.s, io: c.i, x: s.knots[i], edge: c.e, over: wx.over(si, i) }); return out; }
    const P = wx.path && wx.path[si], e = s.knots[i];
    if (!P) { const o = w.knotStrands[e].length === 2 ? otherPass(si, i) : null; if (o) out.push({ so: o[0], io: o[1], x: e, edge: e, over: wx.over(si, i) }); return out; }
    const list = reversed[si] ? blocks[si][i].slice().reverse() : blocks[si][i];
    for (const a of list) { const so = P.ps[a]; if (so < 0) continue;
      if (so < nS0) { const o = otherPass(si, i); if (o) out.push({ so: o[0], io: o[1], x: e, edge: e, over: wx.over(si, i) }); }
      else { const io = wx.path[so].ki[P.pa[a]]; out.push({ so, io, x: wx.strands[so].knots[io], edge: e, over: !wx.over(so, io) }); } }
    return out;
  };
  // --- the steps: a strip each -------------------------------------------------------------------------------------------
  const knotStep = new Float64Array(nX).fill(-1), base = plan.steps.length - 1, done = plan.steps[base], newSteps = [];
  const zone = (pc, m) => (m < pc.ovTail ? 'tail' : m >= pc.knots.length - pc.ovHead ? 'head' : '');
  const joinFields = (pc, m, seen) => {
    const z = zone(pc, m); if (!z) return null;
    const list = pieces[pc.strand].list, other = z === 'tail' ? list[pc.p - 1] : list[(pc.p + 1) % list.length], first = !seen[z]; seen[z] = true;
    return { join: true, lapUnder: false, overlap: z === 'tail' ? m + 1 : m - (pc.knots.length - pc.ovHead) + 1, n: z === 'tail' ? pc.ovTail : pc.ovHead, first, other, m, dir: 1 };
  };
  const cellOf = (pc) => { let bi = pc.knots[0], br = BIG + 1; for (const i of pc.knots) { const r = ringAt(pc.strand, i); if (r < br) { br = r; bi = i; } } const [a, b] = w.edges[w.strands[hostOf(pc.strand)].knots[hostKnot(pc.strand, bi)]]; return (hop[a] < 0 ? BIG : hop[a]) <= (hop[b] < 0 ? BIG : hop[b]) ? a : b; };
  order.forEach((pc, k) => {
    const si = pc.strand, s = wx.strands[si], m0 = pc.knots.length, T = [];
    for (let m = 0; m < m0; m++) for (const c of crossingsAt(pc, m)) {
      const pp = pieceAt(c.so, c.io), kp = stepOfPiece.get(pp.id);
      if (kp > k) continue;                                          // the strip it crosses there comes later: that one makes the crossing
      if (kp === k) { let m2 = -1; for (let x = 0; x < pp.knots.length; x++) if (pp.knots[x] === c.io && !(c.so === si && x === m)) { m2 = x; break; } if (m2 > m) continue; }   // (a strip crossing itself: on its second pass)
      T.push({ m, i: pc.knots[m], c, pp });
    }
    const nT = T.length, seen = {};
    const knots = T.map((t, j) => {
      const at = k + (j + 1) / (nT + 1), J = joinFields(pc, t.m, seen) || {}, c = t.c, goesOver = c.over;
      const q = { e: c.x, guest: true, isNew: !J.join, locked: true, rim: false, self: t.pp.id === pc.id, tick: j, at, clip: false, release: false, lay: false, pos: t.m, subject: pc, ...J };
      Object.assign(q, { host: c.edge, goesOver, partner: t.pp, over: goesOver ? si : c.so, overI: goesOver ? t.i : c.io, under: goesOver ? c.so : si, underI: goesOver ? c.io : t.i, pcOver: goesOver ? pc : t.pp, pcUnder: goesOver ? t.pp : pc, cells: w.edges[c.edge] });
      if (knotStep[c.x] < at) knotStep[c.x] = at;
      return q;
    });
    // when the strip passes each of its crossings: with the tick that weaves it there — what lies before a tick comes with it
    const at = new Float64Array(m0); let j = 0;
    for (let m = 0; m < m0; m++) { while (j < nT && T[j].m < m) j++; at[m] = nT ? k + (Math.min(j, nT - 1) + 1) / (nT + 1) : k + 0.5; }
    pc.at = at; pc.intro = k; pc.introCell = k; pc.holdStep = pc.lastStep = nT ? k + nT / (nT + 1) : k + 0.5; pc.weaver = 0;
    pc.knots.forEach((i, m) => { const x = s.knots[i]; if (knotStep[x] < 0) knotStep[x] = at[m]; });
    const cell = cellOf(pc), h = hostOf(si);
    const nJoin = knots.filter(q => q.join && q.first).length, joined = [...new Set(knots.filter(q => q.join).map(q => q.other.label))];
    const seq = knots.filter(q => !q.join).map(q => (q.goesOver ? 'over' : 'under')).join(' › ');
    const words = `${pc.label} · band S${label[h]}, ${rankWord(pc.rank)}: ${seq || (k ? 'nothing to cross here yet' : 'the first strip — nothing to cross yet')}`;
    newSteps.push({ k, kind: 'add', guest: true, cont: false, cell, cellIdx: k, ring: pc.ring - 1, valence: 6, rim: false, piece: pc, newPieces: [pc], closes: false, knotIds: knots.map(q => q.e), nTicks: nT, first: k, last: k, groupNew: [pc], dir: 1,
      weaver: 0, layIds: new Set(), knots, released: [], nClip: 0, nRel: 0, clipsNow: 0, nNewCross: knots.filter(q => !q.join).length, nJoin, nOverlap: knots.filter(q => q.join).length, sameFamily: false, selfCross: knots.some(q => q.self),
      text: `${k + 1} / ${total} · ${words}${joined.length ? ` · joined to ${joined.join(', ')}` : ''}` });
  });
  for (let x = 0; x < nX; x++) if (knotStep[x] < 0) knotStep[x] = 0;
  const rim = grow(plan.rim, nX);
  for (let si = nS0; si < nS; si++) { const s = wx.strands[si]; if (s.quiet) s.knots.forEach((x, i) => { if (x >= nE && s.quiet[i]) rim[x] = 1; }); }   // the loose end of a strip beside a strand, at the rim
  // a cell is closed when the last crossing round it is made
  const stepOf = new Int32Array(w.nV), fan = plan.fan || null;
  for (let v = 0; v < w.nV; v++) { let t = 0; const es = fan && fan[v] ? fan[v] : []; for (const e of es) if (e < nE && w.knotStrands[e].length === 2) t = Math.max(t, Math.floor(knotStep[e])); stepOf[v] = Math.min(N - 1, t); }
  const cellOrder = [...Array(w.nV).keys()].sort((a, b) => (stepOf[a] - stepOf[b]) || ((hop[a] < 0 ? BIG : hop[a]) - (hop[b] < 0 ? BIG : hop[b])) || (a - b)), cellIdx = new Int32Array(w.nV); cellOrder.forEach((v, r) => { cellIdx[v] = r; });
  done.k = N; done.first = done.last = N;
  Object.assign(plan, { steps: newSteps.concat([done]), nSteps: N + 1, knotStep, lockStep: Float64Array.from(knotStep), rim, offset, reversed, label, pieces, pieceList, pieceAt, nPiecesAll: pieceList.length, joints,
    K: 1, paths: [], stepOf, order: cellOrder, tour: cellOrder, cellIdx, strandRank: bandsBy.slice() });
  plan.tick = (si, i) => { const K = wx.strands[si].knots.length; return wx.strands[si].closed ? ((i - offset[si] + K) % K) + 1 : (reversed[si] ? K - i : i + 1); };
  plan.pieceLabel = (si, i) => (pieceAt(si, i) || {}).label;
  const nGuest = pieceList.filter(pc => pc.guest).length;
  plan.guests = { kind, method: 'after', order: 'band', whole: true, centre: c0, first: 0, baseDone: base, steps: N, pieces: nGuest, joints: guestJoints, jointsAll: joints, basePieces: pieceList.length - nGuest };
  return plan;
}

/** THE GUESTS IN THE PLAN. plan: what a planner made for the lattice's weave (planner.js planWeave, seqplan.js) — it is
 *  changed in place: its tables by crossing and by strand grow, its strips and steps are added to.
 *  opts: { maxLength (model units, 0: no cut), overlap (crossings), method: 'after' | 'along' (the hemp leaf),
 *          order: 'band' | 'pass' (the star weave: each band finished before the next — the default — or pass by pass) } */
export function augmentPlan(wx, plan, opts = {}) {
  const w = wx.base, nS0 = wx.nS0, nS = wx.strands.length, nE = w.nE, nX = wx.nX, kind = wx.guestKind;
  if (!(nS > nS0)) return plan;
  if (kind === 'ply' && opts.order !== 'pass') return centrePlan(wx, plan, opts);   // the star from its centre: every strip a step of its own (above)
  // (the overlap of a joint, in crossings of the lattice's weave: a strip beside a strand passes `per` crossings where the strand passes one)
  const maxL = opts.maxLength > 0 ? opts.maxLength : 0, lap = Math.max(0, Math.min(6, opts.overlap | 0)) * (wx.per || 1);
  const along = kind === 'centre' && opts.method === 'along';
  const grow = (A, n, fill = 0) => { if (Array.isArray(A)) return A.concat(Array(Math.max(0, n - A.length)).fill(fill)); const B = new A.constructor(n); if (fill) B.fill(fill); B.set(A); return B; };
  const knotStep = grow(plan.knotStep, nX, -1), lockStep = grow(plan.lockStep, nX, -1), rim = grow(plan.rim, nX);
  const offset = grow(plan.offset, nS), reversed = grow(plan.reversed, nS), label = grow(plan.label, nS);
  const base = plan.steps.length - 1, done = plan.steps[base];       // the steps of the lattice's own weave; the last one shows the weave finished
  const weaverAt = (t) => { const st = plan.steps[Math.max(0, Math.min(base - 1, Math.floor(t)))]; return st && st.weaver >= 0 ? st.weaver : 0; };
  const pieceAt0 = plan.pieceAt, tick0 = plan.tick, pieceLabel0 = plan.pieceLabel;
  // --- when the lattice's weave reaches a guest: the moment the crossing beside (or round) each of its knots is made ----
  const hostT = (s, i) => {
    if (kind === 'centre') { const e = s.between[i]; return e >= 0 ? plan.knotStep[e] : -1; }
    const h = w.strands[s.host]; return plan.knotStep[h.knots[s.hk[i]]];
  };
  const staggerOf = (s) => (kind === 'ply' && s.tag ? ((s.tag.charCodeAt(0) - 97) % (wx.per || 1)) / (wx.per || 1) : 0);   // b: 1 / n, c: 2 / n …
  const when = new Float64Array(nS).fill(Infinity), walks = new Array(nS);
  for (let si = nS0; si < nS; si++) {
    const s = wx.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1;
    let bi = 0; for (let i = 0; i < K; i++) { const t = hostT(s, i); if (t >= 0 && t < when[si]) { when[si] = t; bi = i; } }
    if (!Number.isFinite(when[si])) when[si] = 0;
    // the walk along it: a strip beside a strand of the lattice is woven the way that strand is; a centre strip from
    // where the weave first reaches its line
    // (the strips of a band are cut and joined at different places: the b strip a third of the way on from where the
    //  lattice's own strip begins, the c strip two thirds … — three joints side by side would be one weak, thick place)
    if (kind === 'ply') { const h = s.host; if (s.closed) { let i0 = 0; while (i0 < K && s.hk[i0] !== plan.offset[h]) i0++; offset[si] = ((i0 < K ? i0 : 0) + (maxL > 0 ? Math.round(K * staggerOf(s)) : 0)) % K; } else reversed[si] = plan.reversed[h] ? 1 : 0; }
    else if (s.closed) offset[si] = bi; else reversed[si] = bi > (K - 1) / 2 ? 1 : 0;
    const off = offset[si], rev = reversed[si];
    const knotAt = (q) => (s.closed ? (((q + off) % K) + K) % K : (rev ? K - 1 - q : q));
    const segAt = (q) => (s.closed ? (((q + off) % K) + K) % K : (rev ? nseg - 1 - q : q));
    walks[si] = { K, nseg, knotAt, segAt, segLen: (q) => s.len[segAt(q)], segCell: () => -1, closed: s.closed };
  }
  // --- names: C1, C2 … by when the weave reaches them (the centre strips); S4b, S4c … (the strips beside strand S4) ------
  const guests = []; for (let si = nS0; si < nS; si++) guests.push(si);
  const byWhen = guests.slice().sort((a, b) => (when[a] - when[b]) || (a - b)), rankOf = new Map(byWhen.map((si, r) => [si, r]));
  const nameOf = (si) => (kind === 'centre' ? `C${rankOf.get(si) + 1}` : `S${plan.label[wx.strands[si].host]}${wx.strands[si].tag}`);
  for (const si of guests) label[si] = kind === 'centre' ? nS0 + rankOf.get(si) + 1 : plan.label[wx.strands[si].host];
  // --- the strips ---------------------------------------------------------------------------------------------------
  const pieces = plan.pieces.slice(), pieceList = plan.pieceList.slice(), nBasePieces = pieceList.length; let joints = 0;
  for (const si of guests) {
    const s = wx.strands[si], walk = walks[si], K = walk.K, nseg = walk.nseg, mod = (q) => ((q % K) + K) % K;
    const cuts = cutWalk(walk, maxL, lap, s.closed ? maxL : maxL * (1 - staggerOf(s))), arc = new Float64Array(nseg + 1); for (let q = 0; q < nseg; q++) arc[q + 1] = arc[q] + walk.segLen(q);
    const total = arc[nseg], arcAt = (q) => (s.closed ? Math.floor(q / K) * total + arc[mod(q)] : arc[Math.max(0, Math.min(K - 1, q))]);
    const before = (q) => arcAt(q) - (s.closed || q > 0 ? walk.segLen(mod(q - 1)) / 2 : 0), after = (q) => arcAt(q) + (s.closed || q < K - 1 ? walk.segLen(mod(q)) / 2 : 0);
    const name = nameOf(si);
    const list = cuts.map((c, p) => {
      const knots = []; for (let q = c.q0; q <= c.q1; q++) knots.push(walk.knotAt(q));
      const n = knots.length, a0 = before(c.q0), a1 = after(c.q1);
      // the overlap of a joint: the first crossings of a strip lie on the last ones of the strip before it; the last strip
      // of a closed strand laps over the first one
      const ovTail = p > 0 ? Math.min(lap, n - 1) : 0, ovHead = s.closed && cuts.length > 1 && p === cuts.length - 1 ? Math.max(0, Math.min(c.q1 - (K - 1), n - 1 - ovTail)) : 0;
      joints += (ovTail ? 1 : 0) + (ovHead ? 1 : 0);
      const rec = { id: pieceList.length, strand: si, p, q0: c.q0, q1: c.q1, ovTail, ovHead, underTail: false, underHead: false, knots, introCell: 1e9, intro: -1, length: a1 - a0,
        label: cuts.length > 1 ? `${name}.${p + 1}` : name, edges: knots.map(i => s.knots[i]), overs: knots.map(i => wx.over(si, i)), arcOf: (m) => arcAt(c.q0 + m) - a0, guest: true, kind, weaver: 0, bends: n, curvature: 0, twist: 0 };
      const E = rec.edges, M = wx.edgeMid, N = wx.edgeNrm, dir = (x, y) => { const d = [M[3 * y] - M[3 * x], M[3 * y + 1] - M[3 * x + 1], M[3 * y + 2] - M[3 * x + 2]], l = Math.hypot(...d) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
      const deg = (c2) => Math.acos(Math.max(-1, Math.min(1, c2))) * 180 / Math.PI;
      for (let j = 1; j + 1 < n; j++) { const u = dir(E[j - 1], E[j]), v = dir(E[j], E[j + 1]); rec.curvature += deg(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]); }
      for (let j = 1; j < n; j++) rec.twist += deg(N[3 * E[j - 1]] * N[3 * E[j]] + N[3 * E[j - 1] + 1] * N[3 * E[j] + 1] + N[3 * E[j - 1] + 2] * N[3 * E[j] + 2]);
      pieceList.push(rec); return rec;
    });
    const own = (pc, m) => m >= pc.ovTail && m < pc.knots.length - pc.ovHead;
    const pieceOfKnot = new Int32Array(K).fill(-1), pieceOfKnot2 = new Int32Array(K).fill(-1), pieceOfSeg = new Int32Array(Math.max(nseg, 0)).fill(-1), overlapSeg = new Uint8Array(Math.max(nseg, 0));
    list.forEach((pc, k) => pc.knots.forEach((i, m) => { if (own(pc, m) && pieceOfKnot[i] < 0) pieceOfKnot[i] = k; }));
    list.forEach((pc, k) => pc.knots.forEach((i, m) => { if (!own(pc, m) && pieceOfKnot2[i] < 0 && pieceOfKnot[i] !== k) pieceOfKnot2[i] = k; }));
    for (let q = 0; q < nseg; q++) {
      const owners = []; cuts.forEach((c, k) => { if ((q >= c.q0 && q + 1 <= c.q1) || (s.closed && q + K >= c.q0 && q + K + 1 <= c.q1)) owners.push(k); });
      pieceOfSeg[walk.segAt(q)] = owners.length ? owners[0] : Math.max(0, pieceOfKnot[walk.knotAt(q)]); overlapSeg[walk.segAt(q)] = owners.length > 1 ? 1 : 0;
    }
    pieces[si] = { nPieces: list.length, pieceOfKnot, pieceOfKnot2, pieceOfSeg, overlapSeg, pieceLen: Float64Array.from(list.map(x => x.length)), length: total, list, walk, guest: true };
  }
  const gPieces = pieceList.slice(nBasePieces);
  const pieceAt = (si, i) => (si < nS0 ? pieceAt0(si, i) : pieces[si].list[Math.max(0, pieces[si].pieceOfKnot[i])]);
  const zone = (pc, m) => (m < pc.ovTail ? 'tail' : m >= pc.knots.length - pc.ovHead ? 'head' : '');
  const joinFields = (pc, m, seen) => {
    const z = zone(pc, m); if (!z) return null;
    const list = pieces[pc.strand].list, other = z === 'tail' ? list[pc.p - 1] : list[0], first = !seen[z]; seen[z] = true;
    return { join: true, lapUnder: false, overlap: z === 'tail' ? m + 1 : m - (pc.knots.length - pc.ovHead) + 1, n: z === 'tail' ? pc.ovTail : pc.ovHead, first, other, m, dir: 1 };
  };
  const newSteps = [];
  if (along) {
    // --- laid in as you weave: a centre strip appears crossing by crossing, as the two strips that hold it there cross ---
    const byEdge = new Map();
    for (const pc of gPieces) {
      const s = wx.strands[pc.strand], n = pc.knots.length, at = new Float64Array(n).fill(-1);
      pc.knots.forEach((i, m) => { const e = s.between[i]; if (e >= 0) at[m] = Math.max(0, plan.knotStep[e]); });
      for (let m = 0; m < n; m++) if (at[m] < 0) { const a = m > 0 ? at[m - 1] : -1, b = m + 1 < n ? at[m + 1] : -1; at[m] = a >= 0 && b >= 0 ? Math.min(a, b) : Math.max(a, b, 0); }
      // (picked up at the first crossing of its own; the end that lies on the strip before it is not there earlier)
      let lo = Infinity, hi = 0, mLo = 0; for (let m = 0; m < n; m++) if (s.between[pc.knots[m]] >= 0 && !zone(pc, m) && at[m] < lo) { lo = at[m]; mLo = m; }
      if (!Number.isFinite(lo)) lo = Math.min(...at);
      for (let m = 0; m < n; m++) { if (at[m] < lo) at[m] = lo; if (at[m] > hi) hi = at[m]; }
      pc.at = at; pc.intro = Math.floor(lo); pc.holdStep = pc.lastStep = hi; pc.weaver = weaverAt(lo);
      pc.knots.forEach((i, m) => { const x = s.knots[i]; if (x >= nE) knotStep[x] = Math.max(knotStep[x], at[m]); const e = s.between[i]; if (e >= 0 && !zone(pc, m)) byEdge.set(e, { label: pc.label, first: m === mLo, piece: pc }); });
    }
    /** the centre strip held by the crossing on lattice edge e: { label, first: it is picked up here } | null */
    plan.between = (e) => byEdge.get(e) || null;
  } else {
    // --- a step for every guest strip, after the lattice's own weave, in the order the weave reached their strands.
    //     The strips beside the strands BAND BY BAND: the second strip of a band, its third …, and only then the next band
    //     (Ji, 19 Nov night: "each band finished before the next as default; current could save as an option") — or,
    //     opts.order 'pass', PASS BY PASS: the second strip of every band, then the third of every band … The centre
    //     strips one after another. --------------------------------------------------------------------------------------
    const passOf = (pc) => (kind === 'ply' ? (wx.strands[pc.strand].tag || 'b').charCodeAt(0) : 0), bandOf = (pc) => wx.strands[pc.strand].host;
    const byBand = kind === 'ply' && opts.order !== 'pass', bandWhen = new Map();
    if (byBand) for (const pc of gPieces) { const h = bandOf(pc), t = when[pc.strand]; if (!bandWhen.has(h) || t < bandWhen.get(h)) bandWhen.set(h, t); }
    const order = gPieces.slice().sort(byBand
      ? (a, b) => (bandWhen.get(bandOf(a)) - bandWhen.get(bandOf(b))) || (bandOf(a) - bandOf(b)) || (passOf(a) - passOf(b)) || (a.strand - b.strand) || (a.p - b.p)
      : (a, b) => (passOf(a) - passOf(b)) || (when[a.strand] - when[b.strand]) || (a.strand - b.strand) || (a.p - b.p));
    const stepOfPiece = new Map(order.map((pc, n) => [pc.id, base + n])), total = base + order.length + 1;
    const lastClips = base > 0 ? (plan.steps[base - 1].clipsNow | 0) : 0;
    order.forEach((pc, nth) => {
      const k = base + nth, si = pc.strand, s = wx.strands[si], n = pc.knots.length, T = [];
      pc.knots.forEach((i, m) => {
        if (s.quiet && s.quiet[i]) return;
        if (kind === 'centre') { if (s.between[i] >= 0 && w.knotStrands[s.between[i]].length === 2) T.push({ m, i }); return; }
        const c = s.cross && s.cross[i]; if (!c) return;
        let pp;
        if (c.s < nS0) pp = pieceAt0(c.s, c.i);
        else {                                                       // another guest: the crossing is made by the one that comes later
          pp = pieceAt(c.s, c.i); const kp = stepOfPiece.get(pp.id);
          if (kp > k) return;
          if (kp === k) { let m2 = -1; for (let x = 0; x < pp.knots.length; x++) if (pp.knots[x] === c.i) { m2 = x; break; } if (m2 > m) return; }
        }
        T.push({ m, i, c, pp });
      });
      const nT = T.length, seen = {};
      const knots = T.map((t, j) => {
        const at = k + (j + 1) / (nT + 1), x = s.knots[t.i], J = joinFields(pc, t.m, seen) || {};
        const q = { e: x, guest: true, isNew: !J.join, locked: true, rim: false, self: false, tick: j, at, clip: false, release: false, lay: false, pos: t.m, subject: pc, ...J };
        if (kind === 'centre') {
          const e = s.between[t.i], [[sa, ia], [sb, ib]] = w.knotStrands[e], up = w.over(sa, ia) ? [sa, ia] : [sb, ib], lo = w.over(sa, ia) ? [sb, ib] : [sa, ia];
          Object.assign(q, { host: e, between: true, over: up[0], overI: up[1], under: lo[0], underI: lo[1], pcOver: pieceAt0(up[0], up[1]), pcUnder: pieceAt0(lo[0], lo[1]), partner: null, cells: w.edges[e] });
        } else {
          const goesOver = wx.over(si, t.i), c = t.c;
          Object.assign(q, { host: c.e, goesOver, partner: t.pp, over: goesOver ? si : c.s, overI: goesOver ? t.i : c.i, under: goesOver ? c.s : si, underI: goesOver ? c.i : t.i, pcOver: goesOver ? pc : t.pp, pcUnder: goesOver ? t.pp : pc, self: t.pp.id === pc.id, cells: w.edges[c.e] });
        }
        return q;
      });
      // when the strip passes each of its crossings: with the tick that weaves it there — what lies before a tick comes with it
      const at = new Float64Array(n); let j = 0;
      for (let m = 0; m < n; m++) { while (j < nT && T[j].m < m) j++; at[m] = nT ? k + (Math.min(j, nT - 1) + 1) / (nT + 1) : k + 0.5; }
      pc.at = at; pc.intro = k; pc.holdStep = pc.lastStep = nT ? k + nT / (nT + 1) : k + 0.5; pc.weaver = weaverAt(when[si]);
      pc.knots.forEach((i, m) => { const x = s.knots[i]; if (x >= nE) knotStep[x] = Math.max(knotStep[x], at[m]); });
      const cell = knots.length && knots[0].cells ? knots[0].cells[0] : (plan.order.length ? plan.order[plan.order.length - 1] : 0);
      const nJoin = knots.filter(q => q.join && q.first).length, joined = [...new Set(knots.filter(q => q.join).map(q => q.other.label))];
      const words = kind === 'centre' ? `centre strip ${pc.label}: thread it along its line, between the two strips of every crossing — ${nT} crossing${nT === 1 ? '' : 's'}`
        : `${pc.label}, beside ${pieceLabel0 ? `S${plan.label[s.host]}` : 'its strand'}: ${knots.filter(q => !q.join).map(q => (q.goesOver ? 'over' : 'under')).join(' › ') || 'no crossing yet'}`;
      newSteps.push({ k, kind: 'add', guest: true, cont: false, cell, cellIdx: plan.order.length, ring: -1, valence: 6, rim: false, piece: pc, newPieces: [pc], closes: false, knotIds: knots.map(q => q.e), nTicks: nT, first: k, last: k, groupNew: [pc], dir: 1,
        weaver: pc.weaver, layIds: new Set(), knots, released: [], nClip: 0, nRel: 0, clipsNow: lastClips, nNewCross: knots.filter(q => !q.join).length, nJoin, nOverlap: knots.filter(q => q.join).length, sameFamily: false, selfCross: knots.some(q => q.self),
        text: `${k + 1} / ${total} · ${words}${joined.length ? ` · joined to ${joined.join(', ')}` : ''}` });
    });
    done.k = base + newSteps.length; done.first = done.last = done.k;
    plan.steps = plan.steps.slice(0, base).concat(newSteps, [done]); plan.nSteps = plan.steps.length;
  }
  for (let x = nE; x < nX; x++) { if (knotStep[x] < 0) knotStep[x] = 0; lockStep[x] = knotStep[x]; }
  for (const si of guests) { const s = wx.strands[si]; if (s.quiet) s.knots.forEach((x, i) => { if (x >= nE && s.quiet[i] && kind === 'ply') rim[x] = 1; }); }   // the loose end of a strip beside a strand, at the rim
  Object.assign(plan, { knotStep, lockStep, rim, offset, reversed, label, pieces, pieceList, pieceAt, nPiecesAll: pieceList.length });
  plan.tick = (si, i) => { if (si < nS0) return tick0 ? tick0(si, i) : i + 1; const K = wx.strands[si].knots.length; return wx.strands[si].closed ? ((i - offset[si] + K) % K) + 1 : (reversed[si] ? K - i : i + 1); };
  plan.pieceLabel = (si, i) => (si < nS0 && pieceLabel0 ? pieceLabel0(si, i) : (pieceAt(si, i) || {}).label);
  if (typeof plan.joints === 'number') plan.joints += joints;
  plan.guests = { kind, method: along ? 'along' : 'after', order: kind === 'ply' ? (opts.order === 'pass' ? 'pass' : 'band') : '', first: base, steps: newSteps.length, pieces: gPieces.length, joints, basePieces: nBasePieces };
  // the middle of a cell: the strip laid first at the bottom
  wx.restack((si, i) => { const P = pieces[si], pc = P.list[Math.max(0, P.pieceOfKnot[i] >= 0 ? P.pieceOfKnot[i] : P.pieceOfKnot2[i])]; const m = pc.knots.indexOf(i); return m >= 0 && pc.at ? pc.at[m] + 1e-6 * pc.id : pc.intro; });
  return plan;
}
