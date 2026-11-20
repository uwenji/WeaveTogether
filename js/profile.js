// profile.js — what a plan is judged by, and the optimiser that tunes an algorithm to it (Ji, Multiplayer update 4, 11 Nov:
// "create the profiles for dual annealing control in a radar chart … which controls the algorithm parameters. This will
// help us arrange different new algorithms in the future").
//
// Three things, kept apart so that a new planning algorithm only has to say what its parameters are (algorithms.js):
//   AXES / scoresOf()   seven things a weaver can ask of a plan, each measured on the plan (sequencer.js replay) and turned
//                       into a score from 0 to 1 — 1 is the outer ring of the radar chart. The scores are absolute (per
//                       crossing, per strip), so plans of different algorithms and of different lattices can be compared.
//   a PROFILE           how much each axis matters, 0 … 1 (the handles of the radar chart). objective() = the weighted
//                       mean of what is missing to 1 on every axis: the number the optimiser brings down.
//   dualAnnealing()     generalised simulated annealing (Tsallis & Stariolo 1996; Xiang et al. 1997; the scheme of SciPy's
//                       dual_annealing without its local search, which needs a smooth function — a plan is not one):
//                       a heavy-tailed visiting distribution (q_v) that shrinks with the temperature, a generalised
//                       Metropolis acceptance (q_a), a chain of 2 · dim visits per temperature — all coordinates at once
//                       for the first dim, then one coordinate at a time — and a restart when the temperature has fallen
//                       to a small share of its start. Runs in the page or in a worker: no DOM, a seeded generator.

// (the keys are kept — saved profiles carry them; "clear way" was "hands free" and "few closing strips" was "open ends"
//  until Ji asked what they meant, update 5: nothing has to be held — the material lies on the table and is taken strip
//  by strip — the axis counts what lies in the way)
export const AXES = [
  { key: 'jumps', label: 'no jumps', hint: 'A jump: the next crossing is further away than a strip of the material is long, or on another front (another stretch of the open edge of the weave, more than 3 lattice edges away). Score 1 / (1 + jumps per 100 crossings).' },
  { key: 'moves', label: 'short moves', hint: 'The way from one crossing to the next when they are not next to each other, summed over the weave, in lattice edges (a). Score 1 / (1 + way per crossing / 0.2 a).' },
  { key: 'joints', label: 'few joints', hint: 'The strips of the plan against the fewest the length limit allows (every strand in as few strips as its length needs): every strip more is a joint more. Score fewest / strips.' },
  { key: 'clear', label: 'clear way', hint: 'Loose ends in the way: how many hanging remainders of strips already in the weave lie across the sweep of the end that is being threaded, on average per crossing. Nothing has to be held — the material lies on the table and is taken strip by strip — this counts what has to be pushed aside. Score 1 / (1 + in the way / 2).' },
  { key: 'ends', label: 'few closing strips', hint: 'A closing strip is joined to other strips at both of its ends: it has to fit between two woven parts, and both of its ends are pushed into a joint. A strip with one free end can simply be woven on. Score 1 / (1 + 3 · closing strips / strips).' },
  { key: 'figure', label: 'figure first', hint: 'The recognisable parts early and in one go: how soon the curvature is there (the singular cells closed), how soon the features — tips, saddles, bends — are complete, and whether a limb — a part that sticks out and ends: an ear, a branch up to its rim — is finished once it is begun (the share of the rest of the weave that is not made while a limb stands open). Score: the mean of the shares; a shape without limbs has two.' },
  { key: 'held', label: 'shape held', hint: 'How well the half-woven shape holds itself: little spring-back energy in strips whose cells are still open, singular cells held soon by the crossings around them, the first loop round a tube or a handle closed early. Score: the mean of the three.' },
];
export const PROFILES = {
  balanced: { label: 'balanced', w: { jumps: 0.7, moves: 0.5, joints: 0.5, clear: 0.5, ends: 0.5, figure: 0.5, held: 0.5 } },
  stay: { label: 'stay where the work is', w: { jumps: 1, moves: 0.9, joints: 0.3, clear: 0.3, ends: 0.2, figure: 0.1, held: 0.3 } },
  thrift: { label: 'fewest joints', w: { jumps: 0.5, moves: 0.2, joints: 1, clear: 0.2, ends: 0.8, figure: 0.1, held: 0.2 } },
  figure: { label: 'figure first', w: { jumps: 0.4, moves: 0.2, joints: 0.2, clear: 0.2, ends: 0.2, figure: 1, held: 0.9 } },
  hands: { label: 'clear way', w: { jumps: 0.5, moves: 0.3, joints: 0.2, clear: 1, ends: 0.7, figure: 0.1, held: 0.5 } },
};
export const DEFAULT_PROFILE = 'balanced';

const pct = (x) => Math.round(100 * x) + ' %';
/** the scores of a plan. m: the measures (replay); ctx: { a (lattice edge), nStrips, joints, minStrips } →
 *  { key: { score 0…1, text (the measure in words) } } */
export function scoresOf(m, ctx) {
  const nC = Math.max(1, m.crossings || 1), nS = Math.max(1, ctx.nStrips || m.pieces || 1), a = ctx.a || 1, out = {};
  out.jumps = { score: 1 / (1 + 100 * m.jumps / nC), short: String(m.jumps), text: `${m.jumps} jump${m.jumps === 1 ? '' : 's'}` };
  out.moves = { score: 1 / (1 + (m.travel / a / nC) / 0.2), short: `${Math.round(m.travel / a)} a`, text: `${m.skips + m.jumps} moves · ${Math.round(m.travel / a)} a` };
  out.joints = { score: Math.min(1, Math.max(1, ctx.minStrips || 1) / nS), short: String(ctx.joints ?? 0), text: `${ctx.joints ?? 0} joint${ctx.joints === 1 ? '' : 's'} · ${nS} strips` };
  out.clear = { score: 1 / (1 + m.collideMean / 2), short: m.collideMean.toFixed(1), text: `${m.collideMean.toFixed(1)} loose ends in the way per crossing` };
  out.ends = { score: 1 / (1 + 3 * m.closing / nS), short: String(m.closing), text: `${m.closing} closing strip${m.closing === 1 ? '' : 's'} (joined at both ends)` };
  { const parts = [m.figure], words = [`curvature ${pct(m.figure)}`];
    if (Number.isFinite(m.featEarly)) { parts.push(m.featEarly); words.push(`features ${pct(m.featEarly)}`); }
    if (Number.isFinite(m.limbOpen)) { parts.push(1 - m.limbOpen); words.push(`limbs in one go ${pct(1 - m.limbOpen)}`); }   // (18 Nov: an ear, a branch finished once it is begun)
    out.figure = { score: parts.reduce((x, y) => x + y, 0) / parts.length, short: '', text: words.join(' · ') }; }
  { const parts = [], words = [];
    if (m.stressTotal > 0) { parts.push(Math.max(0, 1 - 2 * m.stressLoose)); words.push(`loose ${pct(m.stressLoose)}`); }
    if (Number.isFinite(m.holdMean)) { parts.push(1 / (1 + (m.holdMean - 1) / 4)); words.push(`hold ×${m.holdMean.toFixed(1)}`); }
    if (m.wrapRank) { parts.push(1 - m.sheet); words.push(`wrap at ${pct(m.sheet)}`); }
    out.held = { score: parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 1, short: '', text: words.join(' · ') || 'flat' }; }
  for (const k of ['figure', 'held']) out[k].short = pct(out[k].score);
  return out;
}
/** what is missing to 1, weighted by the profile (0 = perfect on every axis that counts); a plan that is not complete, or
 *  weaves a strip at two places, is pushed out */
export function objective(sc, weights, m = null) {
  let sum = 0, wsum = 0;
  for (const ax of AXES) { const wt = Math.max(0, weights[ax.key] ?? 0); sum += wt * (1 - sc[ax.key].score); wsum += wt; }
  let f = wsum > 0 ? sum / wsum : 0;
  if (m) { if (m.complete === false) f += 1; if (m.gapViolations > 0) f += 0.002 * m.gapViolations; }
  return f;
}

// ---------------------------------------------------------------------------------------------------- dual annealing
/** a seeded generator (mulberry32) with normals */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1, spare = null;
  const uniform = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => { if (spare !== null) { const x = spare; spare = null; return x; } let u = 0, v = 0, r = 0; do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; r = u * u + v * v; } while (r >= 1 || r === 0); const f = Math.sqrt(-2 * Math.log(r) / r); spare = v * f; return u * f; };
  return { uniform, normal };
}
/** log Γ(x) (Lanczos) */
function gammaln(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015; for (const c of g) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
/** Minimise fn over the box `bounds` ([[lo, hi], …]). fn may be async. opts: maxfun (evaluations, 120), initialTemp (the
 *  temperature of the first chain; the visiting steps are measured in shares of each coordinate's range and at 1 the
 *  typical step is about a third of the range — SciPy's 5230 suits tens of thousands of cheap evaluations, a plan costs
 *  a second), restartTempRatio (0.02), visit q_v (2.62), accept q_a (−5), energy (the objective is multiplied by this
 *  before the acceptance test, 100: differences of a per cent count as 1), seed, x0, onEval(n, x, f, best), stop().
 *  → { x, fx, nfev, restarts, trace: [[n, best]] } */
export async function dualAnnealing(fn, bounds, opts = {}) {
  const dim = bounds.length, maxfun = opts.maxfun ?? 120, T0 = opts.initialTemp ?? 1, ratio = opts.restartTempRatio ?? 0.02, qv = opts.visit ?? 2.62, qa = opts.accept ?? -5, scale = opts.energy ?? 100;
  const R = rng(opts.seed ?? 1), lo = bounds.map(b => b[0]), range = bounds.map(b => b[1] - b[0]);
  // the visiting distribution (SciPy's VisitingDistribution.visit_fn), in shares of the range
  const f2 = Math.exp((4 - qv) * Math.log(qv - 1)), f3 = Math.exp((2 - qv) * Math.log(2) / (qv - 1)), f4p = Math.sqrt(Math.PI) * f2 / (f3 * (3 - qv));
  const f5 = 1 / (qv - 1) - 0.5, d1 = 2 - f5, f6 = Math.PI * (1 - f5) / Math.sin(Math.PI * (1 - f5)) / Math.exp(gammaln(d1));
  // calibrated so that at temperature 1 the median step is a third of the range (the tail is far heavier than a normal's)
  const raw = (T) => { const x = R.normal(), y = R.normal(), f1 = Math.exp(Math.log(T) / (qv - 1)), f4 = f4p * f1; return x * Math.exp(-(qv - 1) * Math.log(f6 / f4) / (3 - qv)) / Math.exp((qv - 1) * Math.log(Math.abs(y) || 1e-12) / (3 - qv)); };
  const cal = (() => { const P = rng(12345), xs = []; for (let i = 0; i < 4001; i++) { const x = P.normal(), y = P.normal(); xs.push(Math.abs(x * Math.exp(-(qv - 1) * Math.log(f6 / f4p) / (3 - qv)) / Math.exp((qv - 1) * Math.log(Math.abs(y) || 1e-12) / (3 - qv)))); } xs.sort((p, q) => p - q); return (1 / 3) / xs[2000]; })();
  const wrap = (u) => { let v = u % 1; if (v < 0) v += 1; return v; };                 // SciPy folds a visit back into the box the same way
  const visit = (u, step, T) => {
    const v = u.slice();
    if (step < dim) for (let i = 0; i < dim; i++) v[i] = wrap(u[i] + Math.max(-1e8, Math.min(1e8, cal * raw(T))));
    else { const i = step - dim; v[i] = wrap(u[i] + Math.max(-1e8, Math.min(1e8, cal * raw(T)))); }
    return v;
  };
  const toX = (u) => u.map((t, i) => lo[i] + t * range[i]);
  let nfev = 0, restarts = 0; const trace = [];
  const evalU = async (u) => { const x = toX(u), f = await fn(x); nfev++; return f; };
  let cur = opts.x0 ? opts.x0.map((x, i) => (range[i] > 0 ? Math.min(1, Math.max(0, (x - lo[i]) / range[i])) : 0)) : bounds.map(() => R.uniform());
  let fc = await evalU(cur), best = cur.slice(), fb = fc; trace.push([nfev, fb]);
  if (opts.onEval) opts.onEval(nfev, toX(cur), fc, fb);
  const t1 = Math.exp((qv - 1) * Math.log(2)) - 1, stopped = () => nfev >= maxfun || (opts.stop && opts.stop());
  outer: while (!stopped()) {
    for (let i = 0; ; i++) {
      const T = T0 * t1 / (Math.exp((qv - 1) * Math.log(i + 2)) - 1);
      if (T < T0 * ratio) { restarts++; cur = best.map((b) => wrap(b + 0.25 * (R.uniform() - 0.5))); fc = await evalU(cur); if (fc < fb) { fb = fc; best = cur.slice(); } trace.push([nfev, fb]); if (opts.onEval) opts.onEval(nfev, toX(cur), fc, fb); break; }   // restart near the best (not anywhere: a plan is dear)
      const Ts = T / (i + 1);
      for (let j = 0; j < 2 * dim; j++) {
        if (stopped()) break outer;
        const v = visit(cur, j, T), fv = await evalU(v);
        if (fv < fc) { cur = v; fc = fv; if (fv < fb) { fb = fv; best = v.slice(); } }
        else { const p = 1 - (1 - qa) * scale * (fv - fc) / Ts; if (p > 0 && R.uniform() <= Math.exp(Math.log(p) / (1 - qa))) { cur = v; fc = fv; } }
        trace.push([nfev, fb]); if (opts.onEval) opts.onEval(nfev, toX(v), fv, fb);
      }
    }
  }
  return { x: toX(best), fx: fb, nfev, restarts, trace };
}
