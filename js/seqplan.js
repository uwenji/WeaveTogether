// seqplan.js — the sequence planner's result in the shape the viewer (view.js) and the History bar (history.js) read,
// the shape of the cell tour (planner.js): a sub-step is a run — the crossings one weaver makes in a row with one strip
// in hand, every crossing a tick; a joint is a tick per crossing of its overlap ("overlap 1 … k", each with its own
// under / over: the end lies on the strip it is joined to — Ji, update 5); the strips are pieces along their
// strands (no walk offset, never reversed: a run's direction says which way it threads). With several weavers the runs
// are ordered by when they start; a run ends where the other weaver's work meets it (a seam crossing or a hand-over),
// so a run never shows a strip before it is there. The path is drawn per weaver (`paths`), the badge is the weaver.

import { planSequence } from './sequence.js';
import { cellFans, hopDistance, neighbours, overlapWord } from './planner.js';

import { WEAVER } from './weavers.js';
export { WEAVER };

export function sequenceViewPlan(w, opts = {}) {
  const R = planSequence(w, opts);
  const nE = w.nE, nS = w.strands.length, hold = Math.max(1, opts.hold | 0 || 4);
  const rim = new Uint8Array(nE); for (let e = 0; e < nE; e++) if (w.edgeTris[e].length < 2) rim[e] = 1;
  // --- strands: labels by first use (unused strands after) --------------------------------------------------------------
  const label = new Int32Array(nS); let nextLabel = R.strandLabel.size + 1;
  for (let si = 0; si < nS; si++) label[si] = R.strandLabel.has(si) ? R.strandLabel.get(si) : nextLabel++;
  const segLenOf = (si, j) => { const s = w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1; if (j < 0 || j >= nseg) return 0; const [t, k] = s.segs[j]; return w.segLen[3 * t + k]; };
  const walkSeg = (si, q) => { const s = w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, j = s.closed ? ((q % K) + K) % K : q; return j >= 0 && j < nseg ? j : -1; };
  // --- pieces: ids grouped by strand (a strand's pieces are one id range: the Lengths chart highlights it) --------------
  const q0Of = (P) => { const s = w.strands[P.si], K = s.knots.length; return s.closed ? ((P.u0 % K) + K) % K : P.u0; };
  const src = R.pieces.slice().sort((a, b) => (label[a.si] - label[b.si]) || (q0Of(a) - q0Of(b)));
  const idOf = new Map(), pieceList = [], pieces = Array.from({ length: nS }, () => ({ list: [], nPieces: 0 }));
  for (const P of src) {
    const si = P.si, s = w.strands[si], K = s.knots.length, n = P.knots.length;
    const q0 = s.closed ? ((P.u0 % K) + K) % K : P.u0, q1 = q0 + n - 1;
    const arc = [walkSeg(si, q0 - 1) >= 0 ? segLenOf(si, walkSeg(si, q0 - 1)) / 2 : 0];
    for (let m = 1; m < n; m++) arc.push(arc[m - 1] + segLenOf(si, walkSeg(si, q0 + m - 1)));
    const length = arc[n - 1] + (walkSeg(si, q1) >= 0 ? segLenOf(si, walkSeg(si, q1)) / 2 : 0);
    const id = pieceList.length, list = pieces[si].list;
    const pc = { id, strand: si, p: list.length, q0, q1, knots: P.knots.slice(), edges: P.edges.slice(), overs: P.knots.map(i => w.over(si, i)), length, label: P.label,
      arcOf: (m) => arc[Math.max(0, Math.min(n - 1, m))], intro: -1, introCell: -1, weaver: P.wv, ovTail: P.ovTail || 0, ovHead: P.ovHead || 0, src: P.id,
      ends: { tail: (P.why || {})[-1] || 'end', head: (P.why || {})[1] || 'end' }, threadAt: P.threadAt };
    idOf.set(P.id, id); pieceList.push(pc); list.push(pc);
  }
  for (const P of pieces) P.nPieces = P.list.length;
  // the piece through a knot: its own extent first (a joint's overlap is the second one there)
  for (let si = 0; si < nS; si++) {
    const K = w.strands[si].knots.length, P = pieces[si];
    P.pieceOfKnot = new Int32Array(K).fill(-1); P.pieceOfKnot2 = new Int32Array(K).fill(-1);
    P.list.forEach((pc, k) => pc.knots.forEach((i, m) => { const own = m >= pc.ovTail && m < pc.knots.length - pc.ovHead; if (own && P.pieceOfKnot[i] < 0) P.pieceOfKnot[i] = k; else if (P.pieceOfKnot2[i] < 0 && P.pieceOfKnot[i] !== k) P.pieceOfKnot2[i] = k; }));
    for (let i = 0; i < K; i++) if (P.pieceOfKnot[i] < 0 && P.pieceOfKnot2[i] >= 0) { P.pieceOfKnot[i] = P.pieceOfKnot2[i]; P.pieceOfKnot2[i] = -1; }
  }
  const pieceAt = (si, i) => { const P = pieces[si]; return P.list[Math.max(0, P.pieceOfKnot[i])] || P.list[0] || null; };
  // --- runs ----------------------------------------------------------------------------------------------------------------
  // a run is cut where it would depend on another weaver's run that starts after it: a seam crossing, a hand-over, a
  // joint through crossings that weaver made since — so in the run order nothing is shown before it exists
  const runs = [], cur = new Map(), madeIn = new Map();                   // crossing → the run that made it
  const startRun = (ev) => { const r = { weaver: ev.weaver, mover: ev.mover, t0: ev.t, round: ev.round, ticks: [], lastE: -1 }; runs.push(r); cur.set(ev.weaver, r); return r; };
  const born = new Map(R.pieces.map(P => [P.id, P.born]));
  // the strip a weaver moves next: a crossing whose strip in hand moves only once (the next one is another) is a crossing
  // between strips in hand — a "lay" inside the run of the strip being threaded
  const nextMover = new Map(), lastIdx = new Map();
  R.events.forEach((ev, j) => { if (ev.kind !== 'weave') return; const p = lastIdx.get(ev.weaver); if (p !== undefined) nextMover.set(p, ev.mover); lastIdx.set(ev.weaver, j); });
  for (const [j, ev] of R.events.entries()) {
    let r = cur.get(ev.weaver);
    if (ev.kind === 'join') {
      // the joint of another strip than the one in hand starts that strip's run: its end is pushed in crossing by crossing,
      // so it is the strip in hand while that is done (Ji, update 5)
      if (!r || r.mover !== ev.mover || (ev.es || [ev.e]).some(e => { const m = madeIn.get(e); return m && m !== r && m.t0 > r.t0; })) r = startRun(ev);
      r.ticks.push(ev); continue;
    }
    // another weaver's strip in this crossing (a seam crossing, or two weavers side by side on one front) keeps the run
    // going only if that strip, and its crossings next to this one, were there when the run started
    const later = !!r && ev.seam && ev.pieces.some(pid => {
      const P = R.seq.pieces[pid]; if (pid === r.mover || P.wv === ev.weaver && born.get(pid) >= r.t0) return false;
      if (born.get(pid) > r.t0) return true;
      for (let m = 0; m < P.edges.length; m++) if (P.edges[m] === ev.e) for (const q of [m - 1, m + 1]) { const x = q >= 0 && q < P.edges.length ? madeIn.get(P.edges[q]) : null; if (x && x !== r && x.t0 > r.t0) return true; }
      return false;
    });
    // a crossing between two strips already in hand, next to the run, is made inside the run of the strip in hand
    // ("S7 under S3", as the cell tour slots them in) — unless it belongs to another weaver's work
    const inHandLay = r && r.mover !== ev.mover && !ev.pieces.includes(r.mover) && nextMover.get(j) !== ev.mover && !later && ev.handover < 0 && ev.pieces.every(pid => born.get(pid) < ev.t) && r.lastE >= 0 && R.seq.crossDistance(r.lastE, ev.e, 3) <= 2;
    // right after its joint, the strip just joined makes its next crossings as the strip in hand, whichever of the two
    // strips the planner moved there ("take S10.2: overlap 1 … 4, under S3")
    const afterJoint = r && r.mover !== ev.mover && r.ticks.length > 0 && r.ticks.every(x => x.kind === 'join') && ev.pieces.includes(r.mover) && !later && ev.handover < 0;
    if (!(r && ((r.mover === ev.mover && !later && ev.handover < 0) || inHandLay || afterJoint))) r = startRun(ev);
    r.ticks.push(ev); madeIn.set(ev.e, r); r.lastE = ev.e;
  }
  // a short run that only brings a new strip in (every crossing of it with that strip), followed by the new strip's own
  // run, is that strip's start: "take S48" rather than "continue S46 › take S48"
  const joinedThrough = new Set(); for (const ev of R.events) if (ev.kind === 'join') for (const e of ev.es || [ev.e]) joinedThrough.add(e);
  for (let j = 0; j + 1 < runs.length; j++) {
    const r = runs[j]; if (!r.ticks.length || r.ticks.length > 3) continue;
    const nx = runs.slice(j + 1).find(x => x.weaver === r.weaver); if (!nx) continue;
    const F = nx.mover; if (born.get(F) < r.t0 || born.get(F) > (r.ticks[r.ticks.length - 1].t) || nx.ticks.some(ev => ev.kind === 'join')) continue;   // a run with a joint keeps its start
    let cut = r.ticks.length; while (cut > 0 && r.ticks[cut - 1].kind === 'weave' && r.ticks[cut - 1].pieces.includes(F)) cut--;   // the ticks that bring F in, at the end of r
    if (cut === r.ticks.length || r.ticks.slice(cut).some(ev => born.get(F) > ev.t || joinedThrough.has(ev.e))) continue;
    const moved = r.ticks.slice(cut); r.ticks = r.ticks.slice(0, cut);
    nx.ticks = moved.concat(nx.ticks); nx.t0 = moved[0].t; nx.round = moved[0].round; for (const ev of moved) madeIn.set(ev.e, nx);
  }
  for (let j = runs.length - 1; j >= 0; j--) if (!runs[j].ticks.length) runs.splice(j, 1);
  runs.sort((a, b) => a.t0 - b.t0 || a.weaver - b.weaver);
  // a joint is one tick per crossing of its overlap, in the order the end is pushed in: overlap 1 at the other strip's
  // end (next to this strip's own crossings), the last one the deepest
  const overlapTicks = (ev) => {
    const pc = pieceList[idOf.get(ev.pieces[0])], es = new Set(ev.es || [ev.e]), n = pc.knots.length, oT = pc.ovTail | 0, oH = pc.ovHead | 0;
    const tail = oT > 0 && pc.edges.slice(0, oT).some(f => es.has(f));
    let ms = []; for (let m = tail ? oT - 1 : n - oH; tail ? m >= 0 : m < n; m += tail ? -1 : 1) if (es.has(pc.edges[m]) && !rim[pc.edges[m]]) ms.push(m);
    if (!ms.length) ms = pc.edges.map((f, m) => (es.has(f) && !rim[f] ? m : -1)).filter(m => m >= 0);   // (a joint not at an end of the strip: as recorded)
    return ms.map((m, x) => ({ ...ev, e: pc.edges[m], ov: { m, idx: x + 1, n: ms.length, first: x === 0, tail } }));
  };
  for (const r of runs) r.ticks = r.ticks.flatMap(ev => (ev.kind === 'join' ? overlapTicks(ev) : [ev]));
  for (let j = runs.length - 1; j >= 0; j--) if (!runs[j].ticks.length) runs.splice(j, 1);
  // --- steps: ticks, knot steps, cells closed ------------------------------------------------------------------------------
  const steps = [], knotStep = new Float64Array(nE).fill(-1), stepOf = new Int32Array(w.nV).fill(-1), cellMade = new Int32Array(w.nV);
  const ringN = w.cellKnots.map(l => l.filter(e => !rim[e] && w.knotStrands[e].length === 2).length);
  const posIn = (pc, e) => { let best = -1; pc.edges.forEach((f, m) => { if (f === e && (best < 0 || m < best)) best = m; }); return best; };
  const madeBefore = new Map();                                             // piece id → [min, max] knot index made so far
  runs.forEach((r, k) => {
    const mover = pieceList[idOf.get(r.mover)];
    const st = { k, kind: 'add', weaver: r.weaver, round: r.round, piece: mover, newPieces: [], closes: false, first: k, last: k, ticks: r.ticks, flipKey: null };
    const n = r.ticks.length, closed = [];
    r.ticks.forEach((ev, i) => {
      for (const pid of ev.pieces) { const pc = pieceList[idOf.get(pid)]; if (pc && pc.intro < 0) { pc.intro = k; st.newPieces.push(pc); } }
      if (ev.kind !== 'weave') return;
      knotStep[ev.e] = k + (i + 1) / (n + 1);
      for (const v of w.edges[ev.e]) { if (rim[ev.e] || w.knotStrands[ev.e].length !== 2) continue; cellMade[v]++; if (cellMade[v] === ringN[v] && stepOf[v] < 0) { stepOf[v] = k; closed.push(v); } }
    });
    // the direction the strip in hand is threaded: along its knots (+1) or back (−1)
    const own = r.ticks.filter(ev => ev.kind === 'weave').map(ev => posIn(mover, ev.e)).filter(m => m >= 0);
    let dir = 1;
    if (own.length > 1) dir = own[own.length - 1] >= own[0] ? 1 : -1;
    else if (own.length === 1) { const mb = madeBefore.get(mover.id); if (mb && own[0] < mb[0]) dir = -1; }
    for (const m of own) { const mb = madeBefore.get(mover.id); madeBefore.set(mover.id, mb ? [Math.min(mb[0], m), Math.max(mb[1], m)] : [m, m]); }
    st.dir = dir; st.cont = mover.intro < k; st.closes = closed.length > 0; st.closed = closed;
    const lastE = r.ticks.filter(ev => ev.kind === 'weave').map(ev => ev.e).pop() ?? r.ticks[0].e;
    st.cell = closed.length ? closed[closed.length - 1] : w.edges[lastE][0];
    st.cellIdx = k; st.valence = w.valence[st.cell]; st.rim = !!w.boundary[st.cell];
    steps.push(st);
  });
  // crossings never made (an incomplete plan) are shown at the end
  for (let e = 0; e < nE; e++) if (knotStep[e] < 0) knotStep[e] = steps.length + 0.5;
  for (let v = 0; v < w.nV; v++) if (stepOf[v] < 0) stepOf[v] = ringN[v] ? steps.length : 0;
  for (const pc of pieceList) if (pc.intro < 0) pc.intro = steps.length;
  // --- clips: a strip holds after `hold` crossings; a crossing is clipped until both strips through it hold ----------------
  for (const pc of pieceList) {
    const ks = pc.knots.map(i => knotStep[w.strands[pc.strand].knots[i]]).sort((a, b) => a - b);
    pc.holdStep = ks[Math.min(hold, ks.length) - 1]; pc.lastStep = ks[ks.length - 1];
  }
  const lockStep = new Float64Array(nE).fill(-1);
  for (let e = 0; e < nE; e++) {
    if (rim[e] || w.knotStrands[e].length !== 2) { lockStep[e] = knotStep[e]; continue; }
    const [[sa, ia], [sb, ib]] = w.knotStrands[e], pa = pieceAt(sa, ia), pb = pieceAt(sb, ib);
    lockStep[e] = Math.max(pa ? pa.holdStep : 0, pb ? pb.holdStep : 0, knotStep[e]);
  }
  // --- what every tick asks ----------------------------------------------------------------------------------------------
  const nSteps = steps.length + 1, releaseAt = Array.from({ length: nSteps }, () => []);
  for (let e = 0; e < nE; e++) if (!rim[e] && lockStep[e] > knotStep[e]) releaseAt[Math.min(nSteps - 1, Math.floor(lockStep[e]))].push(e);
  let clipsNow = 0, maxClips = 0;
  for (const st of steps) {
    const k = st.k;
    st.knots = st.ticks.map((ev, i) => {
      const e = ev.e, [a, b] = w.edges[e];
      if (ev.kind === 'join') {
        // a crossing of the overlap: the strip lies on the one it is joined to (`other`), between it and the strip that
        // crosses there (`partner`), so it goes over or under that strip as the one beneath does; the view lays the
        // overlap crossing by crossing (ovAt), from its first tick on (joinAt)
        const subject = pieceList[idOf.get(ev.pieces[0])], other = pieceList[idOf.get(ev.pieces[1])], o = ev.ov, ki = subject.knots[o.m], at = k + (i + 1) / (st.ticks.length + 1), side = o.tail ? 'tail' : 'head';
        (subject.ovAt || (subject.ovAt = {}))[o.m] = at; if (!subject.joinAt) subject.joinAt = {}; if (subject.joinAt[side] === undefined) subject.joinAt[side] = at;
        const cross = w.knotStrands[e].find(([sj, ij]) => !(sj === subject.strand && ij === ki)), partner = cross ? pieceAt(cross[0], cross[1]) : null, goesOver = !!w.over(subject.strand, ki), X = cross || [-1, -1];
        const mine = st.piece && st.piece.id === subject.id;
        return { e, tick: i, at, isNew: false, locked: true, rim: false, lay: !mine, join: true, overlap: o.idx, first: o.first, n: o.n, subject, other, partner, goesOver, pos: mine ? o.m : -1, m: o.m, dir: o.tail ? -1 : 1,
          over: goesOver ? subject.strand : X[0], overI: goesOver ? ki : X[1], under: goesOver ? X[0] : subject.strand, underI: goesOver ? X[1] : ki, pcOver: goesOver ? subject : partner, pcUnder: goesOver ? partner : subject, self: false,
          cells: [a, b], clip: false, release: false };
      }
      const [[sa, ia], [sb, ib]] = w.knotStrands[e], overA = w.over(sa, ia);
      const over = overA ? sa : sb, overI = overA ? ia : ib, under = overA ? sb : sa, underI = overA ? ib : ia;
      const pcOver = pieceAt(over, overI), pcUnder = pieceAt(under, underI), self = !!pcOver && !!pcUnder && pcOver.id === pcUnder.id;
      const mine = st.piece, locked = lockStep[e] < k + 1;
      const q = { e, tick: i, at: knotStep[e], isNew: true, locked, rim: false, over, under, overI, underI, self, pcOver, pcUnder, cells: [a, b], clip: !locked, release: false, lay: false, collide: ev.collide || 0 };
      q.pos = posIn(mine, e);
      q.goesOver = !!(pcOver && pcOver.id === mine.id && !(pcUnder && pcUnder.id === mine.id && self));
      q.partner = self ? mine : (pcOver && pcOver.id === mine.id ? pcUnder : pcOver);
      if (q.pos < 0) { q.lay = true; q.subject = pcOver && pcUnder ? (pcOver.intro >= pcUnder.intro ? pcOver : pcUnder) : (pcOver || pcUnder); q.goesOver = !!(pcOver && q.subject && pcOver.id === q.subject.id); q.partner = q.subject === pcOver ? pcUnder : pcOver; }
      return q;
    });
    st.nTicks = st.knots.length;
    const own = new Set(st.knots.map(q => q.e));
    st.released = releaseAt[k].filter(e => !own.has(e));
    st.nClip = st.knots.filter(q => q.clip).length; st.nRel = st.released.length; clipsNow += st.nClip - st.nRel; st.clipsNow = clipsNow; maxClips = Math.max(maxClips, clipsNow);
    st.nNewCross = st.knots.filter(q => !q.join).length; st.nOverlap = st.knots.length - st.nNewCross; st.nJoin = st.knots.filter(q => q.join && q.first).length;
    st.collide = st.knots.reduce((n, q) => n + (q.collide || 0), 0);              // loose strips in the way over the run (update 3, item 9)
    st.sameFamily = false; st.selfCross = st.knots.some(q => q.self);
    st.layIds = new Set(st.knots.filter(q => q.lay).map(q => q.e));
    delete st.ticks;
  }
  const order = steps.map(st => st.cell);
  steps.push({ k: steps.length, kind: 'done', weaver: -1, cell: -1, cellIdx: order.length, ring: -1, valence: 0, rim: false, piece: null, newPieces: [], closes: false, knots: [], nTicks: 0, first: steps.length, last: steps.length, dir: 1, nClip: 0, nRel: 0, clipsNow: 0, nNewCross: 0 });
  const cellIdx = new Int32Array(w.nV).fill(-1); order.forEach((v, k) => { if (cellIdx[v] < 0) cellIdx[v] = k; });
  const knotCell = Int32Array.from(knotStep, x => Math.floor(x));
  // --- per weaver: the path through the cells of its runs --------------------------------------------------------------
  const paths = Array.from({ length: R.K }, () => []);
  for (const st of steps) if (st.kind !== 'done') paths[st.weaver].push({ cell: st.cell, k: st.k });
  // --- bends and twists per piece, as the cell tour reports them -----------------------------------------------------------
  const dir3 = (e0, e1) => { const M = w.edgeMid, d = [M[3 * e1] - M[3 * e0], M[3 * e1 + 1] - M[3 * e0 + 1], M[3 * e1 + 2] - M[3 * e0 + 2]], l = Math.hypot(...d) || 1; return d.map(x => x / l); };
  for (const pc of pieceList) {
    let curv = 0, twist = 0; const E = pc.edges;
    for (let j = 1; j + 1 < E.length; j++) { const a = dir3(E[j - 1], E[j]), b = dir3(E[j], E[j + 1]); curv += Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI; }
    for (let j = 1; j < E.length; j++) { const N = w.edgeNrm, e0 = E[j - 1], e1 = E[j]; twist += Math.acos(Math.max(-1, Math.min(1, N[3 * e0] * N[3 * e1] + N[3 * e0 + 1] * N[3 * e1 + 1] + N[3 * e0 + 2] * N[3 * e1 + 2]))) * 180 / Math.PI; }
    pc.bends = E.length; pc.curvature = curv; pc.twist = twist;
  }
  const ring = R.K === 1 && R.cellLevels && R.cellLevels[0] ? R.cellLevels[0] : hopDistance(w, R.origin || R.seeds[0], neighbours(w));
  const singular = []; for (let v = 0; v < w.nV; v++) if (!w.boundary[v] && w.valence[v] !== 6) singular.push({ cell: v, valence: w.valence[v], ring: ring[v], step: stepOf[v], angle: 0 });
  singular.sort((p, q) => p.step - q.step);
  const totalLen = w.strandLen.reduce((a, b) => a + b, 0);
  const plan = {
    kind: 'sequence', K: R.K, seeds: R.seeds, origin: R.origin, front: R.front, startWhy: R.startWhy, start: R.seeds[0][0], autoStart: R.seeds[0][0], ring, maxRing: Math.max(...ring), order, tour: order, skipped: 0, cellIdx, stepOf, knotStep, knotCell, lockStep, rim, fan: cellFans(w), steps, nSteps,
    label, tick: (si, i) => i + 1, pieces, pieceList, pieceLabel: (si, i) => (pieceAt(si, i) || {}).label, pieceAt, offset: new Int32Array(nS), reversed: new Uint8Array(nS), strandRank: [...Array(nS).keys()].sort((a, b) => label[a] - label[b]),
    singular, nbr: null, totalLen, nPiecesAll: pieceList.length, maxLength: R.Lmax, overlap: R.k, hold, strategy: 'rings', jumps: R.metrics.jumps, maxClips, newStripEvents: pieceList.length,
    metrics: R.metrics, paths, ruleUsed: 'rims', summary: { rounds: R.rounds, joins: R.joins, handovers: R.handovers, seams: R.seams, cuts: R.cuts, shortJoints: R.shortJoints, overLong: R.overLong, idle: R.idle, acts: R.acts, complete: R.complete, made: R.madeN, crossings: R.nCross },
  };
  delete plan.metrics.seq; delete plan.metrics.collideSeq;
  plan.describe = (k) => describeRun(plan, k);
  return plan;
}

/** the status line of a run: who, which strip, its over / under sequence, the joints, the clips */
export function describeRun(plan, k) {
  const st = plan.steps[k]; if (!st) return '';
  if (st.kind === 'done') return `${k + 1} / ${plan.steps.length} · the weave is complete: ${plan.nPiecesAll} strips, ${plan.summary.joins} joints${plan.K > 1 ? `, ${plan.K} weavers in ${plan.summary.rounds} rounds` : ''}`;
  const words = st.knots.map(q => q.join ? overlapWord(q, st) : q.lay ? `${q.subject ? q.subject.label : ''} ${q.goesOver ? 'over' : 'under'} ${q.partner ? q.partner.label : ''}` : (q.goesOver ? 'over' : 'under'));
  const who = plan.K > 1 ? `weaver ${WEAVER[st.weaver]} · round ${st.round + 1} · ` : '';
  return `${k + 1} / ${plan.steps.length} · ${who}${st.cont ? 'continue' : 'take'} ${st.piece.label} · ${words.join(' › ') || 'no crossing'}${st.closes ? ` · closes ${st.closed.length} cell${st.closed.length > 1 ? 's' : ''}` : ''} · clips +${st.nClip} −${st.nRel} (${st.clipsNow} held)${st.collide ? ` · ${st.collide} loose strip${st.collide > 1 ? 's' : ''} in the way` : ''}`;
}
