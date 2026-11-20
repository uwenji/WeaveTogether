// tune_worker.js — the optimiser off the page's thread: dual annealing (profile.js) over the parameters of one algorithm
// (algorithms.js) for one lattice and one profile. The page sends { type: 'tune', V, F, pattern, side, method, base, weights,
// maxfun, seed, x0 } and gets { type: 'progress', n, best, x } while it runs and { type: 'done', x, fx, nfev } at the end;
// it stops the run by ending the worker (the best so far has been reported). { type: 'lengths', … }: the length scan.
import { patternWeave } from './patterns.js';
import { runPlan, boundsOf, fromVector, toVector, defaults, lengthRow } from './algorithms.js';
import { dualAnnealing } from './profile.js';

self.onmessage = async (ev) => {
  const d = ev.data; if (!d) return;
  // { type: 'lengths', V, F, pattern, side, method, base, x, weights, list, offset } → the plan at every strip length of the
  // list: { type: 'row', i (+ offset), row } each, then { type: 'done' }
  if (d.type === 'lengths') {
    try { const w = patternWeave(d.V, d.F, d.pattern); w.side = d.side || 1; d.list.forEach((L, i) => self.postMessage({ type: 'row', i: i + (d.offset | 0), row: lengthRow(w, d.method, d.base, d.x, d.weights, L) })); self.postMessage({ type: 'done' }); }
    catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
    return;
  }
  if (d.type !== 'tune') return;
  try {
    const w = patternWeave(d.V, d.F, d.pattern); w.side = d.side || 1;   // (V, F: the lattice; pattern: the weave made of it — patterns.js)
    const B = boundsOf(d.method), f = (v) => runPlan(w, d.method, d.base, fromVector(d.method, v), d.weights).f;
    let last = 0, bestX = null, bestF = Infinity;
    const r = await dualAnnealing(f, B, { maxfun: d.maxfun, seed: d.seed, x0: toVector(d.method, { ...defaults(d.method), ...(d.x0 || {}) }),
      onEval: (n, x, fx, best) => { if (fx <= bestF) { bestF = fx; bestX = x; } const now = performance.now(); if (now - last > 120 || n >= d.maxfun) { last = now; self.postMessage({ type: 'progress', n, best, x: fromVector(d.method, bestX) }); } } });
    self.postMessage({ type: 'done', x: fromVector(d.method, r.x), fx: r.fx, nfev: r.nfev });
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
