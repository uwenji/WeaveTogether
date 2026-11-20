// algorithms.js — the planning algorithms as the profile sees them (profile.js): each one names its parameters (a handful,
// each with a meaning and a range) and makes a plan from them. The optimiser tunes those numbers to a profile; the page
// draws whatever plan comes out. A new algorithm is a new entry here — nothing else has to know it.
//
//   rings   ring to ring (sequence.js). Its twenty-odd rule weights are moved in seven groups, by a factor ¼ … 4 each,
//           plus the width of the weaver's side and the length a strip is cut to.
//   spiral  the cell tour (planner.js): how far a strip is followed before a new one is started, where the tour starts,
//           the length a strip is cut to, and whether what is begun — a limb, a hole — is finished first.

import { planSequence } from './sequence.js';
import { planWeave, neighbours, chooseStart } from './planner.js';
import { replay, planToSequence } from './sequencer.js';
import { sequenceViewPlan } from './seqplan.js';
import { fillSeeds, axisEnd, wrapLoopThrough, oneWayLevels } from './sequence.js';
import { wrapClasses } from './shape.js';
import { scoresOf, objective } from './profile.js';

const factor = (key, label, hint) => ({ key, label, hint, lo: 0.25, hi: 4, def: 1, log: true });
const GROUPS = {                                                    // ring to ring: the rule weights each factor scales
  area: ['jump', 'far', 'dist', 'leap'], strip: ['sameMover', 'turn', 'pieceDone'], thrift: ['newPiece', 'join', 'load'],
  close: ['cellClosed', 'fill', 'support'], shape: ['curv', 'feature', 'wrap', 'wrapNew'], hold: ['hold', 'stress'], ring: ['level'],
};
const BASE_W = { newPiece: 4, join: 1, cellClosed: 2, pieceDone: 2, jump: 4, far: 10, dist: 1, leap: 20, turn: 1.0, feature: 1, stress: 1, hold: 3, fill: 1.5, support: 2, sameMover: 1, level: 3, load: 0.25, curv: 1, wrap: 2, wrapNew: 6 };
const START_RULES = ['half', 'centre', 'flat', 'rim'];

export const ALGORITHMS = {
  rings: {
    label: 'ring to ring',
    params: [
      factor('area', 'stay in the area', 'the cost of a move away from the last crossing: skips, far moves, jumps'),
      factor('strip', 'keep the strip', 'go on with the strip in hand, without turning, until it is done'),
      factor('thrift', 'few new strips', 'the cost of threading a new strip and of a joint'),
      factor('close', 'close cells', 'the gain of closing a cell and of crossings beside woven ones'),
      factor('shape', 'curved parts first', 'the gain of crossings at curved cells, of features and of wrap-around loops'),
      factor('hold', 'hold the singular cells', 'the gain of the crossings around a singular cell that is begun or closed'),
      factor('ring', 'ring order', 'the cost of a crossing ahead of the ring the weaver is on'),
      { key: 'side', label: 'side [a]', hint: 'how far along the front the weaver\'s side reaches, in lattice edges', lo: 2, hi: 10, def: 4 },
      { key: 'cut', label: 'strip length', hint: 'the length a strip is cut to, as a share of the material', lo: 0.5, hi: 1, def: 1 },
    ],
    options(x, base) {
      const weights = {}; for (const [g, keys] of Object.entries(GROUPS)) for (const k of keys) weights[k] = BASE_W[k] * (x[g] ?? 1);
      return { weights, side: x.side ?? 4, cut: base.Lmax > 0 && (x.cut ?? 1) < 0.999 ? base.Lmax * x.cut : undefined };
    },
  },
  spiral: {
    label: 'cell tour',
    params: [
      { key: 'follow', label: 'follow a strip [a]', hint: 'a strip that is woven up to closer than this is followed before the cell is woven; further away a new strip starts there and the two are joined', lo: 0, hi: 8, def: 4 },
      { key: 'start', label: 'start', hint: 'the start rule: most reachable · centre of the singular cells · farthest from them · the rim (auto: the best of them by the profile)', lo: 0, hi: 3.999, def: -1, pick: START_RULES },
      { key: 'cut', label: 'strip length', hint: 'the length a strip is cut to, as a share of the material', lo: 0.5, hi: 1, def: 1 },
      { key: 'finish', label: 'finish first', hint: 'what is begun is finished: a limb — a part that sticks out and ends: an ear, a branch up to its rim — is woven to its end as soon as the tour reaches it, and a hole — a patch the weave has closed round — is woven before the tour goes on; or everything is left to the rings from the start', lo: 0, hi: 1.999, def: 1, pick: ['rings only', 'limbs and holes'] },
    ],
  },
};
export const defaults = (method) => Object.fromEntries(ALGORITHMS[method].params.map(p => [p.key, p.def]));
/** the box the optimiser searches (log-scaled factors as exponents) and the way back to parameter values */
export const boundsOf = (method) => ALGORITHMS[method].params.map(p => (p.log ? [Math.log(p.lo), Math.log(p.hi)] : [p.lo, p.hi]));
export const fromVector = (method, v) => Object.fromEntries(ALGORITHMS[method].params.map((p, i) => [p.key, p.log ? Math.exp(v[i]) : v[i]]));
export const toVector = (method, x) => ALGORITHMS[method].params.map(p => { const val = x[p.key] ?? p.def; return p.log ? Math.log(Math.max(p.lo, Math.min(p.hi, val))) : Math.max(p.lo, Math.min(p.hi, val < 0 ? p.lo : val)); });

/** the fewest strips the material allows: every strand in pieces of the full length */
/** the plan at another strip length (model units): how many strips and joints, how even the strips — one row of the
 *  length scan (Ji, update 5: "it shows the suggested best length, like 155, in this capped cylinder case") */
export function lengthRow(w, method, base, x, weights, Lmax) {
  const r = runPlan(w, method, { ...base, Lmax }, x || {}, weights, true), plan = r.plan, len = plan.pieceList.map(pc => pc.length);
  const seq = plan.kind === 'sequence', mean = len.reduce((u, v) => u + v, 0) / Math.max(1, len.length);
  return { L: Lmax, strips: len.length, joints: seq ? plan.summary.joins : plan.joints, short: (seq ? plan.summary.shortJoints : plan.shortJoints) || 0, closing: r.metrics.closing || 0,
    min: Math.min(...len), max: Math.max(...len), mean, f: r.f, complete: r.metrics.complete !== false };
}
/** the lengths worth choosing from a scan: a row is kept when it needs fewer strips than every shorter length (a step
 *  down of the staircase) — the first length at that count whose joints are all full, when there is one; the suggestion
 *  is the one with the fewest strips, i.e. the shortest length that reaches it. `gaps`: the pairs of scanned rows
 *  between which a step lies, for a finer second pass */
export function lengthSteps(rows) {
  const ok = rows.filter(r => r && r.complete).slice().sort((x, y) => x.L - y.L), steps = [], gaps = [];
  let fewest = Infinity;
  for (let i = 0; i < ok.length; i++) {
    if (ok[i].strips >= fewest) continue;
    fewest = ok[i].strips;
    let j = i; while (j + 1 < ok.length && ok[j].short > 0 && ok[j + 1].strips === ok[i].strips) j++;   // the first length at this count without a short joint
    const pick = ok[j].short > 0 ? i : j;
    steps.push(ok[pick]);
    if (i > 0) gaps.push([ok[i - 1], ok[i]]);
    if (pick > i) gaps.push([ok[pick - 1], ok[pick]]);
  }
  return { steps, best: steps.length ? steps[steps.length - 1] : null, gaps };
}
export function minStrips(w, Lmax) { let n = 0; for (const L of w.strandLen) n += Lmax > 0 ? Math.max(1, Math.ceil(L / Lmax - 1e-9)) : 1; return n; }
const medianA = (w) => { const l = Array.from(w.edgeLen).sort((x, y) => x - y); return l[l.length >> 1] || 1; };

/** One plan of `method` with parameters x, measured and scored.
 *  base: { K, Lmax (model units, 0 = no limit), k (joint overlap), hold, picks (start cells, optional), seeds (ring to
 *  ring), lath: { width, thickness } }; weights: the profile (for the cell tour's choice of start); view: also the plan
 *  the page draws. → { plan?, metrics, scores, f (the objective for `weights`), ctx } */
export function runPlan(w, method, base, x = {}, weights = null, view = false) {
  const X = { ...defaults(method), ...x }, K = Math.max(1, base.K | 0 || 1), Lmax = base.Lmax > 0 ? base.Lmax : 0, a = medianA(w), min = minStrips(w, Lmax);
  const judge = (m, nStrips, joints) => { const ctx = { a, nStrips, joints, minStrips: min }, sc = scoresOf(m, ctx); return { metrics: m, scores: sc, ctx, f: weights ? objective(sc, weights, m) : 0 }; };
  if (method === 'rings') {
    const o = { K, front: 'rims', seeds: base.seeds, Lmax, k: base.k, G: 1, hold: base.hold, lath: base.lath, ...ALGORITHMS.rings.options(X, { Lmax }) };
    if (view) { const plan = sequenceViewPlan(w, o); plan.metrics.complete = plan.summary.complete; plan.joints = plan.summary.joins; return { plan, ...judge(plan.metrics, plan.nPiecesAll, plan.summary.joins) }; }
    const R = planSequence(w, o); R.metrics.complete = R.complete; delete R.metrics.seq; delete R.metrics.collideSeq;
    return judge(R.metrics, R.pieces.length, R.joins);
  }
  // the cell tour: from the picked cell(s), else from the start rule x.start — or, with none given, the best of the rules
  const maxLength = Lmax > 0 ? Lmax * Math.min(1, X.cut ?? 1) : 0, nbr = K > 1 ? neighbours(w) : null;
  const one = (rule, start, starts, levels) => {
    const plan = planWeave(w, { start, starts, rule, levels, strategy: 'spiral', maxLength, overlap: base.k, distribution: 'start', hold: base.hold, flip: base.flip, follow: X.follow, strips: base.strips, finish: Math.floor(X.finish ?? 1) >= 1, rimRing: base.rimRing });
    const q = planToSequence(w, plan);
    const m = replay(w, q.pieces, q.order, { G: 1, k: base.k, Lmax, lengths: q.lengths, ends: q.ends, weaverOf: q.weaverOf, weavers: q.weavers, lath: base.lath });
    delete m.seq; delete m.collideSeq; m.complete = true; plan.metrics = m; plan.ruleUsed = rule;
    return { plan, ...judge(m, plan.pieceList.length, plan.joints) };
  };
  const picks = base.picks && base.picks.length ? base.picks : null;
  let best = null;
  if (picks) best = one('half', picks[0], K > 1 ? fillSeeds(w, nbr, picks.map(v => [v]), K).map(sd => sd[0]) : undefined);
  else {
    const hasRim = w.boundary.some(b => b), idx = Math.floor(X.start), rules = idx >= 0 ? [START_RULES[Math.min(3, idx)]] : START_RULES;
    // (the rule "rim" on a shape without one: a closed shape with a handle — a torus — starts from the shortest loop round
    //  it through the lower end of its longest axis, as ring to ring does, and is woven one way round from that loop like
    //  a tube from its rim, 18 Nov; any other closed shape has no such loop and the rule falls back to "half")
    const loopStart = () => { if (hasRim || K > 1) return null; const H = w._wrapH || (w._wrapH = wrapClasses(w)); if (!H.rank) return null; const lp = wrapLoopThrough(w, H, axisEnd(w)); return lp ? { start: lp.cells[0], levels: oneWayLevels(w, nbr || neighbours(w), lp.cells) } : null; };
    for (const rule0 of rules) {
      const loop = rule0 === 'rim' ? loopStart() : null;
      const rule = loop ? 'loop' : rule0 === 'rim' && !hasRim ? 'half' : rule0; if (best && rule !== rule0 && !loop) continue;
      let r;
      if (loop) r = one('loop', loop.start, undefined, loop.levels);
      else if (K > 1) { const s0 = chooseStart(w, nbr, rule).cell; r = one(rule, s0, fillSeeds(w, nbr, [[s0]], K).map(sd => sd[0])); } else r = one(rule, undefined);
      // by the profile; without one, as the page did before update 4 (the shortest hanging time, for the 9 Nov baseline)
      const better = !best || (weights ? r.f < best.f - 1e-12 : (r.metrics.hangSum < best.metrics.hangSum || (r.metrics.hangSum === best.metrics.hangSum && r.metrics.gapViolations < best.metrics.gapViolations)));
      if (better) best = r;
    }
  }
  if (!view) delete best.plan;
  return best;
}
