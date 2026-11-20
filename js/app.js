// app.js — state, the page's controls and the frame loop of the WeaveTogether practice.
// Lattice (OBJ or synthetic) → patterns.js (the weave in the pattern chosen: weave.js's strands, crossings, over/under,
// or a pattern's own) → planner.js (start, order, sub-steps with
// their crossings in weaving order, pieces, clips) → view.js (the 3-D scene with the path of the order) + history.js
// (the play bar with the weave direction and the over / under sequence).
import { parseMesh, chargeSummary, medianEdge, orientConsistent, orientOutward } from './weave.js';
import { PATTERNS, PATTERN_IDS, patternWeave, restyle, patternJob, singularCells, paintCard } from './patterns.js';
import { augmentPlan } from './guests.js';
import { SYNTHETIC } from './lattices.js';
import { describeStep, neighbours } from './planner.js';
import { boundaryLoops } from './sequence.js';
import { ALGORITHMS, runPlan, boundsOf, fromVector, toVector, defaults as algoDefaults, lengthRow, lengthSteps } from './algorithms.js';
import { AXES, PROFILES, DEFAULT_PROFILE, dualAnnealing, objective } from './profile.js';
import { Radar } from './radar.js';
import { strandStress, ringParts, features, planTopology } from './shape.js';
import { WEAVER } from './weavers.js';
import { View } from './view.js';
import { History } from './history.js';

const $ = (id) => document.getElementById(id);
// the benchmark set (Ji, Multiplayer update 4, 11 Nov): each case sets its own scale (centimetres per model unit) and strip
// length limit (cm); then the other lattices, which keep whatever scale and limit are set
const MODELS = [
  { id: 'v4Cone_sharp', file: 'models/v4Cone_sharp_v4_135v.obj', label: 'v4 cone · 135 cells — one 4 at the apex', scale: 1, len: 30 },
  { id: 'v5Cone_sharp', file: 'models/v5Cone_sharp_v5_101v.obj', label: 'v5 cone · 101 cells — one 5 at the apex', scale: 1, len: 30 },
  { id: 'tube_v6_90v', file: 'models/tube_v6_90v.obj', label: 'tube · 90 cells — no singular cell', scale: 0.3, len: 50 },
  { id: 'tube_v6_84v', file: 'models/tube_v6_84v.obj', label: 'tube · 84 cells — no singular cell', scale: 0.3, len: 45 },
  { id: 'y_shape_round_v9_75v', file: 'models/y_shape_round_v9_75v.obj', label: 'Y shape · 75 cells — four 7s and an 8', scale: 0.3, len: 90 },
  { id: 'y_shape_round_v9_142v', file: 'models/y_shape_round_v9_142v.obj', label: 'Y shape · 142 cells — six 7s', scale: 0.3, len: 100 },
  { id: 'cylinder_v6_104v', file: 'models/cylinder_v6_104v.obj', label: 'capped cylinder · 104 cells — twelve 5s', scale: 0.3, len: 155 },   // 155 cm since 16 Nov (Ji, update 5, answer 4: the suggested length; 100 cm was set to see the two-places bug)
  { id: 'cylinder_v6_158v', file: 'models/cylinder_v6_158v.obj', label: 'capped cylinder · 158 cells — twelve 5s', scale: 0.3, len: 100 },
  { id: 'tree_branch45x3_188v', file: 'models/tree_branch45x3_v9_188v.obj', label: 'tree, three branches · 188 cells — six 7s, three 8s', scale: 0.3, len: 100 },
  { id: 'canopy_tree_round', file: 'models/canopy_tree_round_v9_419v.obj', label: 'canopy tree · 419 cells — 28 sevens and an 8', more: true },
  { id: 'two_columns_canopy', file: 'models/two_columns_canopy_v9_287v.obj', label: 'two columns with a canopy · 287 cells', more: true },
  { id: 'dodecahedron', file: 'models/dodecahedron.obj', label: 'dodecahedron · 32 cells — twelve 5s', scale: 0.2, len: 100 },   // Ji's example of 20 Nov: a ball 28 cm across, every strand one strip of 86 cm (at 1 cm a unit and 80 cm strips: 531 pieces)
  { id: 'quadYShape', file: 'models/quadYShape.stl', label: 'quad mesh Y, as an STL · 221 cells — 3 to 12 sides (Ji, 20 Nov)', more: true },
  { id: 'sphere', file: 'models/sphere_v3_122v.obj', label: 'sphere · 122 cells — twelve 5s', more: true },
  { id: 'cylinder', file: 'models/cylinder_v3_290v.obj', label: 'capped cylinder · 290 cells — six 5s on each crease', more: true },
  { id: 'Tube', file: 'models/Tube_v6_216v.obj', label: 'open tube · 216 cells', more: true },
  { id: 'Tube230', file: 'models/Tube_v6_230v.obj', label: 'open tube · 230 cells', more: true },
  { id: 'Bunny', file: 'models/Bunny_v3_309v.obj', label: 'Bunny · 309 cells — 61 singular cells', more: true },
  { id: 'srf', file: 'models/srf_v6_365v.obj', label: 'srf · 365 cells — open surface, three 5s and a 7', more: true },
  { id: 'torus201', file: 'models/genus1_torus_v6_201v.obj', label: 'small torus · 201 cells', more: true },
  { id: 'torus', file: 'models/genus1_torus_v6_696v.obj', label: 'torus · 696 cells — five closed strands', more: true },
  { id: 'treeBig', file: 'models/treeBig_v9_527v.obj', label: 'tree · 527 cells — thirty 7s', more: true },
  { id: 'twocolumn', file: 'models/twocolumn_v9_529v.obj', label: 'two columns · 529 cells — twelve 7s', more: true },
  { id: 'Duck', file: 'models/Duck_bob_v6_583v.obj', label: 'duck · 584 cells — 46 singular cells, closed', more: true },
];
const SAVED = JSON.parse(localStorage.getItem('sp.settings') || '{}');
// the reference marks, per file name (Ji, 18 Nov): [{ kind: 'cell', cell } | { kind: 'strip', strand, knot }, colour, name, on]
const MARKS = (() => { try { return JSON.parse(localStorage.getItem('sp.markers') || '{}'); } catch { return {}; } })();
const MARK_COLOURS = ['#D55E00', '#0072B2', '#009E73', '#E69F00', '#CC79A7', '#56B4E9', '#F0E442', '#111111'];   // Okabe & Ito's eight: told apart with any colour vision, and close to the tapes and clips at hand
const S = {                                                        // the state
  caseId: 'cone5', w: null, plan: null, a: 1, meta: {}, name: '', lastW: null,
  scale: SAVED.scale ?? 1, lengthCm: SAVED.lengthCm ?? 80, overlap: SAVED.overlap ?? 2, hold: SAVED.hold ?? 4, distribution: 'start',
  width: SAVED.width ?? 0.2, thickness: SAVED.thickness ?? 0.05, rule: 'auto', strategy: 'spiral', method: SAVED.method || 'spiral', weavers: SAVED.weavers || 1, deactive: SAVED.deactive || 'hanging',
  markers: [], markShow: !!SAVED.markShow, marking: false, lathCol: 'piece',
  // the pattern the lattice is woven in (patterns.js; 3 Pattern), its settings — the star's centres (cells picked on this
  // lattice; none: the default one; patAll: every singular cell; the star in rounds has the same since 20 Nov),
  // the strips of a band and the order they are threaded in (band by band, or pass by pass), the rounds of the star in
  // rounds (0: every round), the mirror image, how the hemp leaf's centre strips are woven in — and the strip width kept
  // for each pattern
  pattern: PATTERNS[SAVED.pattern] ? SAVED.pattern : 'hex', patStrips: Math.max(2, Math.min(5, (SAVED.patStrips | 0) || 3)), patRounds: Math.max(0, Math.min(60, SAVED.patRounds | 0)), starOrder: SAVED.starOrder === 'pass' ? 'pass' : 'band', patHand: SAVED.patHand < 0 ? -1 : 1, patCentres: [], patAll: false, hempMethod: SAVED.hempMethod === 'along' ? 'along' : 'after', pickingCentre: false, widths: { ...(SAVED.widths || {}) },
  picks: [], picksNew: [], pickNext: 0, shiftNext: 0, picking: false, step: 0, tick: null, follow: SAVED.follow || 'align', selPiece: -1, selSet: [], flip: new Set(), lastCell: -1,
  // the profile (what matters, 0 … 1 per axis: the handles of the radar chart) and the parameters the optimiser found for it,
  // per method, for the lattice that is open (not saved: a new lattice starts from the defaults)
  profile: SAVED.profile && (PROFILES[SAVED.profile] || SAVED.profile === 'custom') ? SAVED.profile : DEFAULT_PROFILE, weights: { ...PROFILES[DEFAULT_PROFILE].w, ...(SAVED.profile === 'custom' ? SAVED.weights || {} : (PROFILES[SAVED.profile] || PROFILES[DEFAULT_PROFILE]).w) },
  tuned: {}, tuneRuns: 0, tuning: null, refScores: null, refF: 0,
  lenScan: null,                                                   // the length scan: { rows, list (cm), running, worker } for the lattice and the settings it was made for
};
/** the strip width of a pattern [a]: the one set for it, else the pattern's own, else the page's (a pattern whose weave
 *  is made for a width — the star's bands — finds its own until one is set: 0) */
const widthOf = (id) => S.widths[id] ?? (PATTERNS[id].lath ? PATTERNS[id].lath.width : PATTERNS[id].fitsWidth ? 0 : (SAVED.width ?? 0.2));
if (S.widths.hex === undefined) S.widths.hex = S.width;
S.width = widthOf(S.pattern);
const patSpec = () => ({ id: S.pattern, centres: S.patAll ? 'singular' : S.patCentres.slice(), centre: S.patCentres.length ? S.patCentres[0] : -1, strips: S.patStrips, rounds: S.patRounds, hand: S.patHand, width: PATTERNS[S.pattern].fitsWidth ? (S.widths[S.pattern] || 0) : 0, a: S.raw && S.raw.meta && S.raw.meta.a > 0 ? S.raw.meta.a : 0 });
/** the width the pattern settled on (a band's strips are no wider than fit side by side) is the width the page shows */
const syncWidth = () => { const w = S.w; if (!w || !w.pattern || !w.pattern.lath) return; S.width = w.pattern.lath.width / S.a; const sl = $('sl-lathw'); if (sl) { sl.value = S.width; $('out-lathw').textContent = S.width.toFixed(2); } };
let view, history, radar;
let saveSettings = () => localStorage.setItem('sp.settings', JSON.stringify({ method: S.method, weavers: S.weavers, scale: S.scale, lengthCm: S.lengthCm, overlap: S.overlap, hold: S.hold, distribution: S.distribution, width: S.widths.hex ?? S.width, widths: S.widths, pattern: S.pattern, patStrips: S.patStrips, patRounds: S.patRounds, starOrder: S.starOrder, patHand: S.patHand, hempMethod: S.hempMethod, thickness: S.thickness, strategy: S.strategy, deactive: S.deactive, follow: S.follow, markShow: S.markShow, profile: S.profile, weights: S.weights }));
const maxLength = () => (S.lengthCm > 0 && S.scale > 0 ? S.lengthCm / S.scale : 0);   // the length limit in model units
const cm = (modelUnits) => modelUnits * S.scale;                                        // S.scale: centimetres per model unit
const lathOpts = () => ({ a: S.a, width: S.width * S.a, thickness: Math.min(S.thickness, PATTERNS[S.pattern].thin ? S.width / 4 : Infinity) * S.a });   // (thin: a band's strips are flat — no thicker than a quarter of their width)

// --- lattice in -------------------------------------------------------------------------------------------------
async function loadCase(id) {
  S.caseId = id; status('loading…');
  let data;
  if (SYNTHETIC[id]) data = SYNTHETIC[id].make();
  else {
    const m = MODELS.find(x => x.id === id); if (!m) return;
    try { const r = await fetch(m.file); if (!r.ok) throw new Error(r.status); data = parseMesh(m.file, await r.arrayBuffer()); data.meta.header = data.meta.name; data.meta.name = m.id; }   // the top bar and the exports carry the case's own name: several files say “cylinder” inside
    catch (err) { status(`could not load ${m.file} (${err.message}) — serve the folder over http`); return; }
    if (m.scale > 0) { S.scale = m.scale; S.lengthCm = m.len; $('nb-len').value = S.lengthCm; saveSettings(); }   // a benchmark case: its own scale and strip length (Ji, 11 Nov)
  }
  setLattice(data, data.meta.name || id);
}
/** TOP OF THE MODEL (Ji, 17 Nov: "different file sources have different Z directions"): the axis of the file that points
 *  up. The lattice is turned — a rotation, never a mirror, so over / under stay — until that axis is +Z; the planners
 *  (the lowest rim, the lower end of a closed shape), the camera, the view cube and the size read Z as up. Kept per
 *  file name in localStorage 'sp.up'. */
const TURN = { '+z': (x, y, z) => [x, y, z], '-z': (x, y, z) => [x, -y, -z], '+y': (x, y, z) => [x, -z, y], '-y': (x, y, z) => [x, z, -y], '+x': (x, y, z) => [-z, y, x], '-x': (x, y, z) => [z, y, -x] };
const UPS = (() => { try { return JSON.parse(localStorage.getItem('sp.up') || '{}'); } catch { return {}; } })();
const turned = (V0, up) => { const f = TURN[up] || TURN['+z'], V = new Float64Array(V0.length); for (let i = 0; i < V0.length; i += 3) { const p = f(V0[i], V0[i + 1], V0[i + 2]); V[i] = p[0]; V[i + 1] = p[1]; V[i + 2] = p[2]; } return V; };
function setUp(up) {
  if (!S.raw || !TURN[up]) return;
  if (up === '+z') delete UPS[S.name]; else UPS[S.name] = up;
  try { localStorage.setItem('sp.up', JSON.stringify(UPS)); } catch { /* private mode */ }
  S.step = 0; setLattice(S.raw, S.name);
}
function setLattice(data, name) {
  S.raw = data; S.up = TURN[UPS[name]] ? UPS[name] : '+z'; $('sel-up').value = S.up;
  const V = turned(data.V, S.up), F = Int32Array.from(data.F);
  const flips = orientConsistent(F), flipped = orientOutward(V, F);
  if (S.rawOf !== data) { S.rawOf = data; S.patCentres = []; S.patAll = false; }   // another lattice: the star's centres back to the default
  // the weave in the pattern chosen (3 Pattern): weave.js's own, or a pattern's — on the same lattice or on one made of it
  const w = patternWeave(V, F, patSpec()); w.side = view.sideSign;
  // a: the edge of the lattice the weave is made on (the strips are sized by it) — the file's lattice edge unless the
  // pattern refines the lattice (the mad weave's √3 lattice: a / √3)
  S.aLattice = data.meta.a || medianEdge(w) * (w.refined ? Math.sqrt(3) : 1);
  S.w = w; S.wx = w.x || w; S.a = w.refined ? medianEdge(w) : S.aLattice; syncWidth(); S.meta = data.meta; S.name = name; S.picks = []; S.shiftNext = 0; S.selPiece = -1; S.selSet = []; S.flip = new Set(); S.lastCell = -1;
  stopTune(false); S.tuned = {}; S.tuneRuns = 0; S.fresh = true;
  // the reference marks kept for this file name (a mark that does not fit this lattice is dropped)
  if (S.marking) disarmMark();
  S.markers = (Array.isArray(MARKS[markKey(name)]) ? MARKS[markKey(name)] : []).filter(m => m && (m.kind === 'cell' ? m.cell >= 0 && m.cell < w.nV : m.kind === 'strip' && S.wx.strands[m.strand] && m.knot >= 0 && m.knot < S.wx.strands[m.strand].knots.length));
  if (S.markShow && S.markers.length) { if (view.colouring !== 'marker') { S.lathCol = view.colouring; view.colouring = 'marker'; $('sel-lathcol').value = 'marker'; } }
  else if (view.colouring === 'marker') { view.colouring = S.lathCol && S.lathCol !== 'marker' ? S.lathCol : 'piece'; $('sel-lathcol').value = view.colouring; }   // a lattice without marks is not shown all grey
  view.setStarts(null);
  if (S.rule === 'pick') S.rule = 'auto';
  $('sel-start').value = S.rule;
  const cs = chargeSummary(w), hist = Object.entries(cs.hist).map(([n, c]) => `${c} × ${n}`).join(', ');
  const closed = w.strands.filter(s => s.closed).length;
  const feats = features(w, neighbours(w)), fk = {}; for (const f of feats) fk[f.kind] = (fk[f.kind] || 0) + 1;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  S.figureText = feats.length ? `figure: ${['tip', 'saddle', 'bend'].filter(k => fk[k]).map(k => plural(fk[k], k)).join(' · ')} (the singular cells in groups)` : 'figure: no singular cell — nothing to recognise but the outline';
  S.latticeText = $('ro-lattice').textContent = `${name}${S.up !== '+z' ? ` · turned: the file's ${S.up.replace('-', '−').toUpperCase()} is up` : ''}${w.refined ? `\n${PATTERNS[S.pattern].name.toLowerCase()}: woven on the ${w.refined} lattice — the file's ${w.nBase} cells and one in each of its triangles${w.nRimCells ? `, ${w.nRimCells} more beyond the rim` : ''}` : ''}\n${w.nV} cells (${cs.nInterior} interior) · ${w.nE} crossings · ${w.nT} triangles · χ = ${w.chi}\nsides: ${hist} · Σ(6 − n) = ${cs.charge}\n${w.strands.length} strands (${closed} closed) · parity conflicts ${w.parityConflicts}${w.selfConflicts ? ' · self-crossing conflicts ' + w.selfConflicts : ''}\na = ${S.a.toFixed(3)} model units (${data.meta.a ? 'from the file' : 'median edge'})${flips ? ` · ${flips} triangles re-oriented` : ''}${flipped ? ' · winding flipped outward' : ''}`;
  $('i-lattice').dataset.stage = w.parityConflicts && S.pattern !== 'mad' ? 'warn' : 'ok';   // (the mad weave has its own over / under: the parity of the plain weave says nothing about it)
  $('sum-file').textContent = name;
  showScale();
  $('st-model').textContent = `${name} · ${S.pattern !== 'hex' ? PATTERNS[S.pattern].name.toLowerCase() + ' · ' : ''}${w.nV} cells · ${w.nE} crossings · ${w.strands.length} strands`;
  replan(0);
  status('');
}

// --- plan -------------------------------------------------------------------------------------------------------
/** the picked starts as seeds of the ring-to-ring planner: a rim cell stands for its whole rim, unless another weaver
 *  starts on that rim too */
function seedsFromPicks(w, picks) {
  const loopOf = new Map(); boundaryLoops(w, neighbours(w)).forEach((l, i) => l.forEach(v => loopOf.set(v, i)));
  const count = new Map(); for (const v of picks) if (loopOf.has(v)) count.set(loopOf.get(v), (count.get(loopOf.get(v)) || 0) + 1);
  return picks.map(v => (loopOf.has(v) && count.get(loopOf.get(v)) === 1 ? v : [v]));
}
// (start 'auto' in a pattern that is woven round one cell — the star weave with one centre, the star in rounds — is that
//  cell: the weave is made from the centre out, as the sheet does, "以六角孔起底"; with several centres or several weavers
//  the starts are found as ever)
const patternStart = () => { const P = S.w && S.w.pattern; return P && PATTERNS[P.id].centres && P.centres && P.centres.length === 1 && (S.weavers | 0) <= 1 ? [P.centres[0]] : []; };
const pickedStarts = () => (S.rule === 'pick' ? S.picks.slice(0, S.weavers).filter(v => v >= 0) : patternStart());
/** what every plan of the lattice is made with: the weavers, the material, the picked starts, the lath's section */
function planBase() {
  const w = S.w, K = Math.max(1, S.weavers | 0), picks = pickedStarts();
  return { K, Lmax: maxLength(), k: S.overlap, hold: S.hold, picks: picks.length ? picks : null, seeds: picks.length ? seedsFromPicks(w, picks) : undefined, flip: S.flip, lath: { width: S.width * S.a, thickness: S.thickness * S.a } };
}
function replan(step = S.step, tick = null) {
  const w = S.w; if (!w) return;
  const K = Math.max(1, S.weavers | 0), picks = pickedStarts(), base = planBase(), tuned = S.tuned[S.method] || null;
  const t0 = performance.now();
  // the plan of the method with its parameters (the optimiser's, when it has run), scored on the profile's axes; the cell
  // tour's auto start is the best of its four start rules by the profile
  const r = runPlan(w, S.method, base, tuned || {}, S.weights, true), plan = r.plan;
  plan.scores = r.scores; plan.f = r.f; plan.ctx = r.ctx; plan.params = tuned;
  plan.ms = Math.round(performance.now() - t0);
  if (tuned) { const d = runPlan(w, S.method, base, {}, S.weights, false); S.refScores = d.scores; S.refF = d.f; } else { S.refScores = null; S.refF = r.f; }
  S.plan = plan; S.selPiece = -1; S.selSet = []; S.lastCell = -1;
  // the weave read as a surface at every crossing (Ji, 18 Nov: the Euler characteristic of the growing weave): where it
  // meets itself — a loop round the shape, a hole to patch — is marked on the History chips and told in the step's words
  try { S.topo = planTopology(w, plan.steps); } catch (err) { console.error(err); S.topo = null; }
  // the strips the pattern adds to the lattice's own (guests.js: the hemp leaf's centre strips, the strips beside every
  // strand of the star weave) come into the plan now — the planner has planned the lattice's weave; from here on the
  // weave is S.wx (the guests as strands of their own), the plan the one plan
  let wx = S.wx = w.x || w, failed = '';
  if (wx !== w) { try { augmentPlan(wx, plan, { maxLength: base.Lmax, overlap: S.overlap, method: S.hempMethod, order: S.starOrder }); } catch (err) { console.error(err); failed = `the pattern's own strips could not be planned: ${err.message}`; wx = S.wx = w; } }
  try { view.setModel(wx, plan, lathOpts(), { keepCamera: S.lastW === w }); view.setScale(S.scale); view.setDeactive(S.deactive); view.setStarts(K > 1 && picks.length ? picks : null); view.setFigure(figureOf(w, plan)); view.setCentres(S.pickingCentre ? w.pattern.centres : null); }
  catch (err) { console.error(err); status('the view could not be rebuilt: ' + err.message); }   // the History bar must still get the new plan
  S.lastW = w;
  const nK = Math.max(1, plan.K || 1), joints = plan.guests && plan.guests.whole ? plan.guests.jointsAll : plan.kind === 'sequence' ? plan.summary.joins + (plan.guests ? plan.guests.joints : 0) : plan.joints;
  $('sum-disc').textContent = `${plan.nPiecesAll} strips · ${joints} joint${joints === 1 ? '' : 's'}${nK > 1 ? ` · ${nK} weavers` : ''}`;
  showProfile(plan);
  showLengths();
  drawLengths(w, plan);
  $('st-pill').textContent = `${nK > 1 ? nK + ' weavers · ' : ''}${plan.steps.length - 1} steps`;
  // (a band of the star weave set wider than the lattice allows somewhere: say so — its own width fits everywhere)
  const Pw = w.pattern, crowded = Pw && Pw.tight > 0 ? `the bands are wider than the lattice allows on ${Pw.tight} of ${Pw.stretches} stretches: the strips run into each other there — narrower strips (Display → laths → width) or fewer of them fit` : '';
  // (the star from its centre — guests.js centrePlan — is woven strip by strip by one weaver: the planner's method and the weavers do not come into it)
  const solo = plan.guests && plan.guests.whole && (S.weavers | 0) > 1 ? 'band by band the star is woven from its centre, strip by strip, by one weaver — the weavers share the work only pass by pass (3 Pattern → order)' : '';
  status(failed || crowded || solo);
  showMarks(false);                                                // (before the History chips: they take the laths' colours)
  showPattern();
  history.setPlan(plan, Math.min(step, plan.steps.length - 1), tick, { colourOf: (pid) => view.pieceHex(pid), cm });
  view.setWeaverMask(nK > 1 ? history.show : null);
}
/** the figure as the plan reads it, for the view's colourings: the part of the shape every strip is threaded in (the rings
 *  from the plan's start cut where the front splits or merges — shape.js ringParts; the largest part first) and what the
 *  shape asks of every strip per length (strandStress), 0 … 1 against the most stressed strips */
function figureOf(w, plan) {
  const nP = plan.pieceList.length, partOfPiece = new Int32Array(nP).fill(-1), stressOfPiece = new Float32Array(nP);
  const { partOf, parts } = ringParts(w, neighbours(w), plan.ring), rank = new Map(parts.slice().sort((a, b) => b.cells.length - a.cells.length).map((P, i) => [P.id, i]));
  const SE = strandStress(w, { width: S.width * S.a, thickness: S.thickness * S.a }), per = [];
  for (const pc of plan.pieceList) {
    if (pc.guest) { per.push(0); continue; }                       // (a strip the pattern adds — guests.js — is no strand of the lattice: no part, no stress of its own)
    const s = w.strands[pc.strand], n = pc.knots.length, ks = pc.kStep || [];
    let m0 = pc.ovTail | 0; for (let m = m0; m < n - (pc.ovHead | 0); m++) if (ks[m] < ks[m0]) m0 = m;      // where it is threaded: its first crossing
    const e = s.knots[pc.knots[m0]], c = w.edges[e][0]; partOfPiece[pc.id] = partOf[c] >= 0 ? rank.get(partOf[c]) : -1;
    let sum = 0, cnt = 0; for (let q = pc.q0; q < pc.q1; q++) { const j = view.walkSeg(pc.strand, q); if (j < 0) continue; const [t, k] = s.segs[j]; sum += SE.back[3 * t + k] + SE.force[3 * t + k]; cnt++; }
    per.push(cnt ? sum / cnt : 0);
  }
  const sorted = per.slice().sort((a, b) => a - b), top = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] || 1;
  per.forEach((x, i) => { stressOfPiece[i] = Math.sqrt(Math.min(1, x / top)); });
  const kinds = {}; for (const P of parts) kinds[P.kind] = (kinds[P.kind] || 0) + 1;
  $('ro-lattice').textContent = `${S.latticeText}\n${S.figureText}\nparts from this plan's start: ${['cap', 'tube', 'sheet'].filter(k => kinds[k]).map(k => `${kinds[k]} ${k}${kinds[k] === 1 ? '' : 's'}`).join(' · ')}\nasked of the strips (per lattice edge of strip): bend ${(SE.total.bend / Math.max(1, w.nE)).toFixed(2)} · twist ${(SE.total.twist / Math.max(1, w.nE)).toFixed(2)} · sideways ${(SE.total.side / Math.max(1, w.nE)).toFixed(3)}`;
  return { partOfPiece, stressOfPiece, nParts: parts.length };
}

/** the plan on the radar chart: its score on every axis, the measure in words, the default plan's outline once the
 *  parameters are tuned; the same numbers as a table */
function showProfile(plan) {
  if (!radar || !plan.scores) return;
  const sc = plan.scores, pick = (o, f) => Object.fromEntries(AXES.map(a => [a.key, o[a.key][f]]));
  radar.set({ scores: pick(sc, 'score'), ref: S.refScores ? pick(S.refScores, 'score') : null, short: pick(sc, 'short'), texts: pick(sc, 'text'), weights: S.weights });
  const rows = $('prof-rows'); rows.textContent = '';
  for (const a of AXES) {
    const row = document.createElement('div'); row.className = 'prow'; row.title = a.hint;
    const name = document.createElement('span'); name.className = 'pn'; name.textContent = a.label;
    const bar = document.createElement('span'); bar.className = 'pbar'; const fill = document.createElement('i'); fill.style.width = Math.round(100 * sc[a.key].score) + '%'; bar.append(fill);
    const val = document.createElement('span'); val.className = 'pv'; val.textContent = `${sc[a.key].score.toFixed(2)} · ${sc[a.key].text}`;
    row.append(name, bar, val); rows.append(row);
  }
  // the parameters of the method the optimiser moves: the value in use, and the default where it differs
  const A = ALGORITHMS[S.method], tuned = S.tuned[S.method] || null, box = $('prof-params'); box.textContent = '';
  $('prof-params-head').textContent = `parameters of ${A.label}${tuned ? ' (tuned)' : ' (default)'}`;
  const show = (q, v) => (q.pick ? (v < 0 ? 'auto' : q.pick[Math.min(q.pick.length - 1, Math.floor(v))]) : (q.log ? '× ' : '') + (+v).toFixed(2));
  for (const q of A.params) {
    const row = document.createElement('div'); row.className = 'prow par'; row.title = q.hint || '';
    const name = document.createElement('span'); name.className = 'pn'; name.textContent = q.label;
    const val = document.createElement('span'); val.className = 'pv'; const v = tuned ? tuned[q.key] : q.def;
    val.textContent = show(q, v) + (tuned && Math.abs(v - q.def) > 1e-9 ? `   (default ${show(q, q.def)})` : '');
    row.append(name, val); box.append(row);
  }
  showTune();
}
/** what matters has changed. The plan is judged again; the cell tour picks its start by the profile, so it is planned again */
function reprofile() {
  const plan = S.plan; if (!plan || !plan.scores) return;
  if (S.tuning) stopTune(true);
  if (S.method === 'spiral' && !pickedStarts().length && !(S.tuned.spiral && S.tuned.spiral.start >= 0)) { replan(0); return; }
  plan.f = objective(plan.scores, S.weights, plan.metrics); S.refF = S.refScores ? objective(S.refScores, S.weights) : plan.f;
  showProfile(plan);
}
function showTune(text = null) {
  const el = $('ro-tune'), plan = S.plan, tuned = S.tuned[S.method];
  $('btn-untune').hidden = !tuned || !!S.tuning; $('btn-tune').textContent = S.tuning ? 'Stop' : 'Tune'; $('btn-tune').classList.toggle('on', !!S.tuning);
  if (text) { el.textContent = text; return; }
  if (!plan) { el.textContent = '—'; return; }
  const fit = (f) => (100 * (1 - f)).toFixed(1) + ' %', A = ALGORITHMS[S.method];
  // where the cell tour starts (the best of its start rules by the profile, unless picked): told with the fit
  const from = plan.kind === 'sequence' || (S.rule === 'pick' && S.picks.length) ? '' : ` · from ${{ half: 'the most reachable cell', centre: 'the centre of the singular cells', flat: 'the flattest cell', rim: plan.fromRim ? 'the rim, round it first' : 'a rim cell', loop: 'a loop round the shape' }[plan.ruleUsed] || plan.ruleUsed}`;
  if (!tuned) { el.textContent = `${A.label}, default parameters${from} · fit ${fit(plan.f)}`; el.title = 'fit: the weighted mean of the scores, by what matters'; return; }
  el.textContent = `${A.label}, tuned (${S.tunedInfo || ''})${from} · fit ${fit(plan.f)} — default ${fit(S.refF)}`;
  el.title = A.params.map(p => { const v = tuned[p.key]; return `${p.label}: ${p.pick ? (v < 0 ? 'auto' : p.pick[Math.min(p.pick.length - 1, Math.floor(v))]) : (p.log ? '×' : '') + (+v).toFixed(2)}`; }).join('\n');
}

// --- the optimiser: dual annealing over the method's parameters, in a worker (in the page where a worker cannot start) ----
function startTune() {
  const w = S.w, plan = S.plan; if (!w || !plan || S.tuning) return;
  const method = S.method, base = planBase(), per = Math.max(30, plan.ms / (method === 'spiral' && !base.picks && !S.tuned[method] ? 4 : 1));
  const maxfun = Math.max(60, Math.min(240, Math.round(60000 / per))), seed = 1 + S.tuneRuns++, f0 = plan.f;
  const job = { type: 'tune', ...patternJob(w), side: w.side, method, base: { ...base, flip: null }, weights: { ...S.weights }, maxfun, seed, x0: S.tuned[method] || null };
  const T = S.tuning = { method, maxfun, n: 0, best: f0, x: null, worker: null, stop: false, t0: performance.now() };
  const progress = () => showTune(`tuning ${ALGORITHMS[method].label} · ${T.n} / ${maxfun} plans · fit ${(100 * (1 - Math.min(T.best, f0))).toFixed(1)} % (from ${(100 * (1 - f0)).toFixed(1)} %)`);
  const finish = (x, n) => {
    if (S.tuning !== T) return; S.tuning = null; if (T.worker) T.worker.terminate();
    if (x && S.w === w) { S.tuned[method] = x; S.tunedInfo = `${n} plans, ${Math.round((performance.now() - T.t0) / 1000)} s`; if (S.method === method) replan(0); else showTune(); } else showTune();
  };
  T.finish = () => finish(T.x && T.best < f0 - 1e-9 ? T.x : null, T.n);
  progress();
  const inPage = async () => {                                       // no worker (an old browser, a file:// page): the same run, giving the page a turn after every plan
    const B = boundsOf(method), fn = async (v) => { await new Promise(r => setTimeout(r)); return runPlan(w, method, job.base, fromVector(method, v), job.weights).f; };
    const r = await dualAnnealing(fn, B, { maxfun, seed, x0: toVector(method, { ...algoDefaults(method), ...(job.x0 || {}) }), stop: () => T.stop || S.tuning !== T,
      onEval: (n, x, fx, best) => { T.n = n; if (fx <= T.best) { T.best = fx; T.x = fromVector(method, x); } progress(); } });
    if (S.tuning === T) finish(r.fx < f0 - 1e-9 ? fromVector(method, r.x) : null, r.nfev);
  };
  try {
    const wk = T.worker = new Worker(new URL('./tune_worker.js', import.meta.url), { type: 'module' });
    wk.onmessage = (ev) => { const d = ev.data; if (S.tuning !== T) return;
      if (d.type === 'progress') { T.n = d.n; if (d.best <= T.best) { T.best = d.best; T.x = d.x; } progress(); }
      else if (d.type === 'done') finish(d.fx < f0 - 1e-9 ? d.x : null, d.nfev);
      else if (d.type === 'error') { console.error('tune:', d.message); T.worker.terminate(); T.worker = null; inPage(); } };
    wk.onerror = (e) => { if (S.tuning !== T) return; e.preventDefault && e.preventDefault(); T.worker.terminate(); T.worker = null; inPage(); };
    wk.postMessage(job);
  } catch { T.worker = null; inPage(); }
}
/** stop the optimiser; keep: the best plan found so far becomes the tuned plan */
function stopTune(keep = true) { const T = S.tuning; if (!T) return; T.stop = true; if (keep) T.finish(); else { S.tuning = null; if (T.worker) T.worker.terminate(); } }

// --- the suggested strip length (Ji, update 5: "it shows the suggested best length, like 155, in this capped cylinder
//     case"): the plan made again at thirty-odd lengths from half the limit to twice it — in the worker — and the steps of
//     the staircase kept: every length that needs fewer strips than all shorter ones. The suggestion is the shortest
//     length that reaches the fewest strips, with every joint at its full overlap -------------------------------------------
const niceStep = (x) => { const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9))), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
/** the grid a strip length is suggested on — a length one cuts to: whole centimetres under 50 cm, 5 cm up to 3 m, then 10 */
const cutGrid = (L) => (L < 50 ? 1 : L < 300 ? 5 : 10);
/** SUGGEST LENGTH (Ji, update 5: "it shows the suggested best length, like 155"): the plan at the strip lengths from half
 *  to twice the current limit — some thirty of them first, then the lengths of the cutting grid around every drop of
 *  the number of strips — and, always, at the current limit itself. The list is what lengthSteps keeps of it. */
function startLengths() {
  const w = S.w, plan = S.plan; if (!w || !plan) return;
  if (S.lenScan && S.lenScan.running) { stopLengths(); return; }
  const longest = cm(Math.max(...w.strandLen)), ref = S.lengthCm > 0 ? S.lengthCm : longest / 2, grid = cutGrid(ref);
  // (nothing is gained beyond the longest strand in one strip — with the overlap it needs when it is a closed one)
  const lo = 0.5 * ref, hi = Math.min(2 * ref, Math.max(longest * 1.2 + S.overlap * cm(S.a) / 2, ref)), step = Math.max(grid, niceStep((hi - lo) / 30)), list = [];
  for (let L = Math.ceil(lo / step - 1e-9) * step; L <= hi + 1e-9; L += step) list.push(+L.toFixed(6));
  if (S.lengthCm > 0 && !list.some(L => Math.abs(L - S.lengthCm) < 1e-6)) list.push(S.lengthCm);
  const method = S.method, base = { ...planBase(), flip: null }, x = S.tuned[method] || {};
  const T = S.lenScan = { w, method, key: lenKey(), list, rows: [], step, grid, lo: list[0], hi: Math.max(...list), fine: step <= grid, running: true, worker: null, t0: performance.now() };
  const put = (i, row) => { T.rows[i] = { ...row, cm: T.list[i] }; showLengths(); };
  /** the second pass: the lengths of the cutting grid inside every gap of the first pass in which a step lies */
  const finer = () => {
    if (T.fine) return [];
    T.fine = true;
    const have = new Set(T.list.map(L => L.toFixed(6))), extra = [];
    for (const [ra, rb] of lengthSteps(T.rows).gaps)
      for (let L = Math.floor(ra.cm / grid + 1e-9) * grid + grid; L < rb.cm - 1e-6; L += grid) { const v = +L.toFixed(6); if (!have.has(v.toFixed(6))) { have.add(v.toFixed(6)); extra.push(v); } }
    return extra;
  };
  const end = () => { T.running = false; if (T.worker) { T.worker.terminate(); T.worker = null; } showLengths(); };
  const inPage = async () => {
    for (;;) {
      for (let i = 0; i < T.list.length && S.lenScan === T && T.running; i++) { if (T.rows[i]) continue; await new Promise(r => setTimeout(r)); put(i, lengthRow(w, method, base, x, S.weights, T.list[i] / S.scale)); }
      if (S.lenScan !== T || !T.running) return;
      const extra = finer(); if (!extra.length) break; T.list.push(...extra);
    }
    end();
  };
  const post = (wk, from) => wk.postMessage({ type: 'lengths', ...patternJob(w), side: w.side, method, base, x, weights: { ...S.weights }, list: T.list.slice(from).map(L => L / S.scale), offset: from });
  showLengths();
  try {
    const wk = T.worker = new Worker(new URL('./tune_worker.js', import.meta.url), { type: 'module' });
    wk.onmessage = (ev) => { const d = ev.data; if (S.lenScan !== T) return;
      if (d.type === 'row') put(d.i, d.row);
      else if (d.type === 'done') { const from = T.list.length, extra = finer(); if (extra.length) { T.list.push(...extra); showLengths(); post(wk, from); } else end(); }
      else if (d.type === 'error') { console.error('lengths:', d.message); T.worker.terminate(); T.worker = null; inPage(); } };
    wk.onerror = (e) => { if (S.lenScan !== T) return; e.preventDefault && e.preventDefault(); T.worker.terminate(); T.worker = null; inPage(); };
    post(wk, 0);
  } catch { T.worker = null; inPage(); }
}
function stopLengths() { const T = S.lenScan; if (!T) return; T.running = false; if (T.worker) { T.worker.terminate(); T.worker = null; } showLengths(); }
/** what the scan depends on besides the length: a change of any of it makes the list stale */
const lenKey = () => [S.method, S.scale, S.overlap, S.hold, S.weavers, S.rule, pickedStarts().join('.'), JSON.stringify(S.tuned[S.method] || {}), JSON.stringify(S.w && S.w.pattern ? [S.w.pattern.id, S.w.pattern.spec] : 0)].join('|');
function showLengths() {
  const T = S.lenScan, ro = $('ro-suggest'), box = $('len-list'), btn = $('btn-len');
  if (T && (T.w !== S.w || T.key !== lenKey())) { if (T.worker) T.worker.terminate(); S.lenScan = null; }
  const R = S.lenScan;
  btn.textContent = R && R.running ? 'Stop' : 'Suggest length'; btn.classList.toggle('on', !!(R && R.running));
  box.textContent = '';
  if (!R) { ro.textContent = ''; box.hidden = true; return; }
  const rows = R.rows.filter(Boolean), fmt = (r) => `${Math.round(cm(r.min))}–\u2060${Math.round(cm(r.max))}\u00a0cm`, isNow = (r) => Math.abs(r.cm - S.lengthCm) < 1e-6, fmtL = (L) => String(+L.toFixed(1));
  ro.textContent = R.running ? `planning at ${rows.length} / ${R.list.length} lengths …` : `${fmtL(R.lo)}–${fmtL(R.hi)} cm, to the nearest ${R.grid} cm`;
  const { steps, best } = lengthSteps(rows), show = steps.slice(), now = rows.find(isNow);
  if (now && now.complete && !show.includes(now)) show.push(now);                 // the current limit is always in the list
  show.sort((x, y) => y.cm - x.cm);
  box.hidden = !show.length;
  for (const r of show) {
    const L = r.cm, top = r === best && !R.running, row = document.createElement('div'); row.className = 'lrow' + (top ? ' best' : '') + (isNow(r) ? ' now' : '');
    const a = document.createElement('button'); a.type = 'button'; a.className = 'luse'; a.textContent = `${fmtL(L)} cm`; a.title = isNow(r) ? 'the length limit now' : 'use this length limit';
    a.addEventListener('click', () => { if (isNow(r)) return; S.lengthCm = L; $('nb-len').value = L; saveSettings(); replan(); });
    const t = document.createElement('span'); t.className = 'lt';
    t.textContent = `${r.strips}\u00a0strips · ${fmt(r)}${r.short ? ` · ${r.short}\u00a0short\u00a0joint${r.short > 1 ? 's' : ''}` : ''}`;   // (breaks between the parts only)
    t.title = `${top ? 'suggested: the fewest strips in this range, at the shortest length that reaches it with full joints\n' : ''}${r.joints} joint${r.joints === 1 ? '' : 's'} · ${r.closing} closing strip${r.closing === 1 ? '' : 's'} · mean ${fmt0(cm(r.mean))} cm · fit ${(100 * (1 - r.f)).toFixed(1)} %`;
    row.append(a, t); if (isNow(r)) { const n = document.createElement('span'); n.className = 'lnow'; n.textContent = 'now'; n.title = 'the length limit now'; row.append(n); }
    box.append(row);
  }
}

// --- one sub-step (and one crossing of it) -----------------------------------------------------------------------
function onStep(k, tick) {
  const w = S.w, plan = S.plan; if (!plan) return;
  S.step = k; S.tick = tick;
  view.setStep(k, tick);
  // the step in words is no longer in the top bar (it ran under the other controls — Ji, 11 Nov): it is the tooltip of the
  // step counter in the History bar and of the pill; the top bar shows the selected strip
  const st0 = k >= 0 ? plan.steps[k] : null;
  const words = (k >= 0 ? (st0 && st0.text ? st0.text : plan.describe ? plan.describe(k) : describeStep(w, plan, k)) : 'nothing woven yet') + (st0 && st0.loopText ? ' — ' + st0.loopText : '');
  $('h-read').title = words; $('st-pill').title = words;
  showTopology(k, tick);
  showStrip();
  // the camera follows the cell: once per cell — pan, or turn to the cell's side of the model (yaw and pitch only)
  const st = k >= 0 ? plan.steps[k] : null;
  const where = st ? (st.guest ? -2 - st.k : st.cellIdx) : -1;       // (a guest strip's step is no cell's: the camera goes to where the strip begins)
  if (S.fresh && st) { S.fresh = false; S.lastCell = where; }       // a new lattice opens on the whole model: the camera follows from the next cell on
  if (S.follow !== 'off' && st && st.kind !== 'done' && where !== S.lastCell) { S.lastCell = where; view.followCell(st.cell, S.follow); }
  if (!st) S.lastCell = -1;
}
/** the weave as a surface at this crossing, in the History bar: χ = cells − crossings + closed triangles of the woven part,
 *  how many loops round the shape are closed, how many holes are open; lit on the step where the weave meets itself */
function showTopology(k, tick) {
  const el = $('h-topo'), T = S.topo; if (!el) return;
  // (the steps of the pattern's own strips — guests.js — change nothing of the surface the lattice's weave is; the last step shows it finished)
  const stK = k >= 0 ? S.plan.steps[k] : null, kT = stK && stK.guest ? -1 : stK && stK.kind === 'done' && S.plan.guests ? (S.plan.guests.baseDone ?? S.plan.guests.first) : k;
  const row = T && kT >= 0 ? T.per[kT] : null; if (!row) { el.textContent = ''; el.classList.remove('on'); el.title = ''; return; }
  const [chi, rounds, holes, parts] = row[Math.max(0, Math.min(row.length - 1, tick == null || tick < 0 ? row.length - 1 : tick))], st = S.plan.steps[k];
  // (χ = parts − loops: a strip threaded ahead of the patch is a part of its own until the next crossings join it)
  el.textContent = `χ ${chi < 0 ? '−' + (-chi) : chi}${parts > 1 ? ` (${parts} parts)` : ''}${T.rank ? ` · round ${rounds}/${T.rank}` : ''} · holes ${holes}`;
  el.classList.toggle('on', !!st.loop);
  el.title = (st.loopText ? st.loopText.charAt(0).toUpperCase() + st.loopText.slice(1) + '.\n\n' : '')
    + 'The woven part read as a surface. χ = cells − crossings + closed triangles = parts − loops: one patch without a hole has 1. '
    + (T.rank ? `round: the loops round the shape that are closed — round a tube, a branch, a handle; this shape has ${T.rank}. ` : 'On this shape every loop can be shrunk to a point: there is no loop round the shape itself, only holes. ')
    + 'holes: the places where the weave has closed round something that is not woven yet — a patch of cells, or a gap of a few triangles that the next crossings fill. A crossing closes a loop when it joins two cells the weave already connects and does not just complete a triangle: χ drops by one.';
}
/** the selected strip in the top bar: its label, its remainder — what is not woven yet at this step, both loose ends
 *  together — and its whole length (Ji, 11 Nov) */
function showStrip() {
  const el = $('st-strip'), plan = S.plan, id = S.selPiece >= 0 ? S.selPiece : (S.selSet && S.selSet.length === 1 ? S.selSet[0] : -1), pc = plan && id >= 0 ? plan.pieceList[id] : null;
  if (!pc) { el.textContent = ''; el.title = ''; return; }
  const t = view.u.uStep.value, ks = pc.kStep || [], n = pc.knots.length; let lo = -1, hi = -1;
  for (let m = 0; m < n; m++) if (ks[m] <= t) { if (lo < 0) lo = m; hi = m; }
  const total = pc.length, a = lo < 0 ? total : pc.arcOf(lo), b = lo < 0 ? 0 : total - pc.arcOf(hi);
  el.textContent = `${pc.label} · remainder ${fmt0(cm(a + b))} cm · total ${fmt0(cm(total))} cm`;
  el.title = lo < 0 ? 'not woven yet at this step' : `woven through ${hi - lo + 1} of its ${n} crossings · loose: ${fmt0(cm(a))} cm at its start, ${fmt0(cm(b))} cm at its end`;
}
function selectPiece(id) { S.selSet = []; S.selPiece = S.selPiece === id ? -1 : id; view.selectPiece(S.selPiece); markLengthSel(); revealBar(); showStrip(); }
/** the selected strip's bar scrolled into its box (the box only, not the page) */
function revealBar() {
  const r = document.querySelector('#len-pieces rect.bar.sel'), box = r && r.closest('.lc-scroll'); if (!box) return;
  const y = +r.getAttribute('y'), top = box.scrollTop, h = box.clientHeight;
  if (y < top + 4 || y > top + h - 12) box.scrollTop = Math.max(0, y - h / 2);
}
/** the scale: the model's bounding box in centimetres, the lattice edge a in centimetres (File → scale) */
function showScale() {
  const w = S.w; if (!w) return;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < w.nV; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], w.V[3 * i + c]); hi[c] = Math.max(hi[c], w.V[3 * i + c]); }
  S.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  $('nb-scale').value = +S.scale.toFixed(3);
  for (const [id, c] of [['nb-w', 0], ['nb-d', 1], ['nb-h', 2]]) $(id).value = +cm(S.size[c]).toFixed(1);
  $('ro-scale').textContent = `lattice edge a = ${cm(S.aLattice).toFixed(1)} cm (${S.aLattice.toFixed(2)} model units × ${S.scale.toFixed(2)})${w.refined ? `\n${PATTERNS[S.pattern].name.toLowerCase()}: woven on the ${w.refined} lattice, edge ${cm(S.a).toFixed(1)} cm — the strips are sized by it` : ''}`;
}
function setScale(v) { if (!(Number.isFinite(v) && v > 0)) { showScale(); return; } S.scale = v; saveSettings(); showScale(); replan(); }

// --- exports (no buttons: window.sp.exportPlan() / window.sp.exportTapes() from the console) --------------------
function exportPlan() {
  const w = S.w, plan = S.plan; if (!plan) return;
  const cells = []; for (let v = 0; v < w.nV; v++) cells.push({ id: v, sides: w.valence[v], rim: !!w.boundary[v], ring: plan.ring[v], step: plan.stepOf[v], position: [w.V[3 * v], w.V[3 * v + 1], w.V[3 * v + 2]].map(x => +x.toFixed(4)) });
  const crossings = []; for (let e = 0; e < w.nE; e++) {
    const q = { id: e, cells: w.edges[e], rim: !!plan.rim[e], step: plan.knotStep[e], clipUntil: plan.lockStep[e], position: [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]].map(x => +x.toFixed(4)) };
    if (!plan.rim[e] && w.knotStrands[e].length === 2) { const [[sa, ia], [sb, ib]] = w.knotStrands[e], ov = w.over(sa, ia) ? [sa, ia] : [sb, ib], un = w.over(sa, ia) ? [sb, ib] : [sa, ia]; q.over = { piece: plan.pieceAt(ov[0], ov[1]).label, tick: plan.tick(ov[0], ov[1]) }; q.under = { piece: plan.pieceAt(un[0], un[1]).label, tick: plan.tick(un[0], un[1]) }; }
    crossings.push(q);
  }
  const wx = S.wx || w;                                             // (with the strips the pattern adds: their crossings are numbered from the lattice's last one on)
  const pieces = plan.pieceList.map(pc => ({ label: pc.label, ...(pc.guest ? { kind: pc.kind === 'centre' ? 'centre strip' : 'beside a strand' } : {}), strand: plan.label[pc.strand], lengthCm: +cm(pc.length).toFixed(1), crossings: pc.knots.map(i => ({ tick: plan.tick(pc.strand, i), edge: wx.strands[pc.strand].knots[i], over: wx.over(pc.strand, i), step: plan.knotStep[wx.strands[pc.strand].knots[i]] })), pickedUp: pc.intro, holdsFrom: pc.holdStep, bends: pc.bends, curvatureDeg: +pc.curvature.toFixed(1), twistDeg: +pc.twist.toFixed(1) }));
  const steps = plan.steps.map(st => ({ step: st.k, kind: st.kind, cell: st.cell, cellIndex: st.cellIdx, sides: st.valence, strip: st.piece ? st.piece.label : undefined, direction: st.dir, closesCell: !!st.closes, crossings: (st.knots || []).map(q => ({ edge: q.e, over: q.pcOver ? q.pcOver.label : null, under: q.pcUnder ? q.pcUnder.label : null, ...(q.between ? { between: q.subject.label, latticeEdge: q.host } : q.guest ? { latticeEdge: q.host } : {}), clip: !!q.clip, ...(q.join ? { overlap: q.overlap, of: q.n, strip: q.subject.label, on: q.other ? q.other.label : null, ...(q.lapUnder ? { beneath: true } : {}) } : {}) })), clipOff: (st.knots || []).filter(q => q.release).map(q => q.e).concat(st.released || []) }));
  const json = JSON.stringify({ lattice: S.name, up: S.up, pattern: patternExport(), markers: S.markers.map(m => (m.kind === 'cell' ? { cell: m.cell, colour: m.colour, name: m.name || undefined } : { strip: (markPiece(m) || {}).label, strand: m.strand, crossing: m.knot, colour: m.colour, name: m.name || undefined })), a: S.a, scale: S.scale, aCm: cm(S.a), lengthCm: S.lengthCm, overlap: S.overlap, hold: S.hold, distribution: S.distribution, strategy: S.strategy, startRule: S.rule === 'pick' && S.picks.length ? 'pick' : plan.ruleUsed, start: plan.start, starts: plan.starts || (plan.seeds ? plan.seeds.map(sd => sd[0]) : [plan.start]), method: S.method, parameters: plan.params || 'default', profile: S.weights, scores: Object.fromEntries(AXES.map(a => [a.key, +plan.scores[a.key].score.toFixed(3)])), measured: plan.metrics, cells, crossings, pieces, steps }, null, 1);
  showModal('Export plan', 'cells (ring, step), crossings (step made, clip until, over / under with piece and tick), pieces with their crossings, the sub-steps', json, `${S.name}_plan.json`);
}
/** the pattern in the exported plan: what it is, its settings, and the strips it adds to the lattice's own */
function patternExport() {
  const w = S.w, P = w.pattern, g = S.plan && S.plan.guests;
  return { id: P.id, name: PATTERNS[P.id].name, ...P.spec, ...(P.centres ? { centres: P.centres } : {}), layers: w.layers, about: P.text, ...(w.refined ? { lattice: w.refined, latticeCells: w.nBase } : {}),
    ...(g ? { ownStrips: { kind: g.kind === 'centre' ? 'centre strips' : 'strips beside every strand', woven: g.method === 'along' ? 'laid in as the crossings are made' : g.whole ? 'from the centre, every strip a step: the star in rounds, then band by band' : 'threaded after the lattice\'s own weave', ...(g.order ? { order: g.order === 'pass' ? 'pass by pass' : 'band by band' } : {}), ...(g.whole ? { centre: g.centre } : {}), strips: g.pieces, joints: g.joints, steps: g.whole ? g.pieces : g.steps, ...(g.whole ? { stepsInAll: g.steps } : {}) } } : {}) };
}
function exportTapes() {
  const w = S.w, plan = S.plan; if (!plan) return;
  const rows = ['piece,tick,over_under,partner_piece,partner_tick,cell_a,cell_b,sides_a,sides_b,step'];
  const wx = S.wx || w;
  for (const pc of plan.pieceList) for (const i of pc.knots) {
    // (a crossing the pattern's own strips add — guests.js — lies on no lattice edge: the cells of the edge it is made at)
    const s = wx.strands[pc.strand], e = s.knots[i], host = e < w.nE ? e : s.between ? s.between[i] : s.cross && s.cross[i] ? s.cross[i].e : -1, [a, b] = host >= 0 ? w.edges[host] : ['', ''];
    const other = e < w.nE ? w.knotStrands[e].filter(([q, j]) => !(q === pc.strand && j === i))[0] : s.cross && s.cross[i] ? [s.cross[i].s, s.cross[i].i] : null;
    const word = plan.rim[e] ? 'rim' : s.between ? (s.between[i] >= 0 ? 'between' : 'cell') : s.quiet && s.quiet[i] ? 'rim' : (wx.over(pc.strand, i) ? 'over' : 'under');
    rows.push([pc.label, plan.tick(pc.strand, i), word, other ? plan.pieceAt(other[0], other[1]).label : '', other ? plan.tick(other[0], other[1]) : '', a, b, host >= 0 ? w.valence[a] : '', host >= 0 ? w.valence[b] : '', +(plan.knotStep[e] + 1).toFixed(4)].join(','));
  }
  showModal('Export tapes (CSV)', 'one row per crossing of every piece, in tick order', rows.join('\n'), `${S.name}_tapes.csv`);
}
function showModal(title, hint, text, filename) {
  $('modal-title').textContent = title; $('modal-hint').textContent = hint; $('modal-text').value = text;
  const a = $('modal-download'); a.download = filename; if (a.href) URL.revokeObjectURL(a.href); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  $('modal').hidden = false;
}
window.sp = { exportPlan, exportTapes, state: S, get view() { return view; }, get history() { return history; }, select: (id) => selectPiece(id), tune: () => startTune() };

// --- page --------------------------------------------------------------------------------------------------------
function status(msg) { $('st-msg').textContent = msg || ''; }

// --- 3 Lengths: strands and strips, one row each, longest at the top, length along x in cm; the dashed line is the length
//     limit, the dotted one the usable minimum (2k + 1 crossings, the shortest strip that can be joined at both ends) -------
const fmt0 = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));
// --- 3 Lengths: a row per strand / strip, longest first, 7 px a row (Ji, 9 Nov evening: "1.5 or 2 times thicker, where I
//     could really click it"); the list scrolls in its box. Hover lights the row's strips on the model; a click selects
//     them (Shift / ⌘ / Ctrl: add or remove); dragging a window selects the strips whose length — the end of the bar —
//     lies in it, to see them on the model; Esc or a click beside the bars clears -----------------------------------------
const LEN = { ROW: 7, BAR: 5.6, MAXROWS: 600, VIEW: 300 };
const charts = {};                                                  // id → the drawn chart: items (longest first), rows, x scale
function drawLengths(w, plan) {
  const Lmax = S.lengthCm > 0 ? S.lengthCm : 0, k = S.overlap | 0;
  // strands, before the cut: a row's strips are the strand's
  // (with the strips the pattern adds — guests.js: a centre strip's whole line, the strips beside a strand — as strands of their own)
  const wx = S.wx || w, SL = wx.strandLen, kindOf = (si) => (wx.strands[si].guest ? (wx.strands[si].kind === 'centre' ? 'centre strip · ' : 'beside a strand · ') : '');
  const order = Array.from(SL, (l, si) => si).sort((a, b) => SL[b] - SL[a]);
  const strands = order.map((si, i) => { const L = cm(SL[si]), ids = plan.pieces[si] ? plan.pieces[si].list.map(p => p.id) : []; return { ids, L, tip: `${kindOf(si)}strand ${i + 1} of ${order.length}: ${fmt0(L)} cm (${(L / cm(S.a)).toFixed(1)} a) · ${ids.length} strip${ids.length === 1 ? '' : 's'}` }; });
  const nS = strands.length;
  drawChart('len-strands', strands, Math.max(nS ? strands[0].L : 1, Lmax || 0), { limit: Lmax, noun: 'strand' });
  // strips after the cut; orange = too short to be joined at both ends (< 2k + 1 crossings)
  const pcs = plan.pieceList.map(pc => ({ ids: [pc.id], label: pc.label, L: cm(pc.length), n: pc.knots.length, short: pc.knots.length < 2 * k + 1 })).filter(p => Number.isFinite(p.L));
  pcs.forEach(p => { p.tip = `${p.label}: ${fmt0(p.L)} cm · ${p.n} crossings${p.short ? ' · too short to join at both ends' : ''}`; });
  const sorted = pcs.slice().sort((a, b) => b.L - a.L), nP = sorted.length, hiP = Math.max(Lmax || 0, nP ? sorted[0].L : 1e-9);
  const stepLen = plan.pieceList.reduce((a, pc) => a + pc.length, 0) / Math.max(1, plan.pieceList.reduce((a, pc) => a + Math.max(1, pc.knots.length - 1), 0)), Lmin = cm(stepLen) * (2 * k + 1);
  drawChart('len-pieces', sorted, hiP, { limit: Lmax, min: Lmin < hiP ? Lmin : 0, noun: 'strip' });
  const Ls = pcs.map(p => p.L), nShort = pcs.filter(p => p.short).length, mean = Ls.reduce((a, b) => a + b, 0) / Math.max(1, Ls.length), med = nS ? strands[nS >> 1].L : 0;
  $('ro-len').textContent = `${nS} strands: ${fmt0(nS ? strands[nS - 1].L : 0)} – ${fmt0(nS ? strands[0].L : 0)} cm (median ${fmt0(med)} cm)${Lmax ? ` · ${strands.filter(q => q.L > Lmax).length} longer than the limit` : ''}\n${pcs.length} strips: mean ${fmt0(mean)} cm, shortest ${fmt0(Math.min(...Ls))} cm · ${nShort} with fewer than ${2 * k + 1} crossings`
    + (plan.guests ? `\nof them ${plan.guests.pieces} ${plan.guests.kind === 'centre' ? 'centre strips' : 'beside the lattice\'s own strands'} · ${plan.guests.joints} joint${plan.guests.joints === 1 ? '' : 's'}` : '');
  $('sum-len').textContent = `${pcs.length} strips · ${nShort} short`;
  markLengthSel();
}
/** one chart: a header with the limit / minimum labels (on two lines where they would overlap, kept inside the chart),
 *  the rows in a scrolling box, the axis below it */
function drawChart(id, items, hi, opts) {
  const el = $(id), W = Math.max(200, Math.round(el.clientWidth) || 280), left = 2, right = 10, pw = W - left - right;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const n = items.length, group = Math.max(1, Math.ceil(n / LEN.MAXROWS)), rows = Math.ceil(n / group), rowH = LEN.ROW, H = Math.max(rowH, rows * rowH) + 2;
  const X = (L) => left + pw * Math.max(0, Math.min(L, hi)) / Math.max(1e-9, hi);
  const lines = [];
  if (opts.limit) lines.push({ x: X(opts.limit), text: `limit ${fmt0(opts.limit)} cm`, cls: '' });
  if (opts.min) lines.push({ x: X(opts.min), text: `min ${fmt0(opts.min)} cm`, cls: ' min' });
  const placed = []; let head = '';
  for (const lb of lines) {                                         // 9.5 px mono ≈ 5.8 px a character
    const wd = lb.text.length * 5.8 + 2; let anchor = 'end', tx = lb.x - 3, x0 = tx - wd;
    if (x0 < 0) { anchor = 'start'; tx = lb.x + 3; x0 = tx; }
    if (x0 + wd > W) { anchor = 'end'; tx = W - 1; x0 = tx - wd; }
    let line = 0; while (placed.some(q => q.line === line && x0 < q.x0 + q.wd + 6 && q.x0 < x0 + wd + 6)) line++;
    placed.push({ x0, wd, line });
    head += `<line class="limit${lb.cls}" x1="${lb.x.toFixed(1)}" y1="${(4 + 11 * line).toFixed(1)}" x2="${lb.x.toFixed(1)}" y2="99"/><text x="${tx.toFixed(1)}" y="${9 + 11 * line}" text-anchor="${anchor}">${esc(lb.text)}</text>`;
  }
  const headH = 12 + 11 * (placed.length ? Math.max(...placed.map(q => q.line)) : 0);
  let bars = `<line class="axis" x1="${left}" y1="0" x2="${left}" y2="${H}"/>`;
  for (let r = 0; r < rows; r++) {
    const grp = items.slice(r * group, (r + 1) * group), p = grp[0], y = 1 + r * rowH, short = grp.some(q => q.short), wd = Math.max(1.5, X(p.L) - left);
    const tip = grp.length === 1 ? p.tip : `${opts.noun}s ${r * group + 1}–${r * group + grp.length} of ${n}: ${fmt0(grp[grp.length - 1].L)} – ${fmt0(p.L)} cm`;
    bars += `<rect class="bar${short ? ' short' : ''}${grp.length > 1 ? ' grp' : ''}" data-r="${r}" x="${left}" y="${y.toFixed(1)}" width="${wd.toFixed(1)}" height="${LEN.BAR}" rx="1.4"><title>${esc(tip)}</title></rect>`;
  }
  for (const lb of lines) bars += `<line class="limit${lb.cls}" x1="${lb.x.toFixed(1)}" y1="0" x2="${lb.x.toFixed(1)}" y2="${H}"/>`;
  bars += '<rect class="brush" x="0" y="0" width="0" height="0" visibility="hidden"/>';
  const axis = `<line class="axis" x1="${left}" y1="1" x2="${W - right}" y2="1"/><text x="${left}" y="12">0</text><text x="${W - right}" y="12" text-anchor="end">${fmt0(hi)} cm</text>`;
  el.innerHTML = `<svg class="lc-head" viewBox="0 0 ${W} ${headH}" style="height:${headH}px" aria-hidden="true">${head}</svg>`
    + `<div class="lc-scroll" style="max-height:${LEN.VIEW}px"><svg class="lc-bars" viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="${opts.noun} lengths">${bars}</svg></div>`
    + `<svg class="lc-axis" viewBox="0 0 ${W} 15" style="height:15px" aria-hidden="true">${axis}</svg>`;
  charts[id] = { items, group, rows, rowH, H, W, left, X, noun: opts.noun };
}
/** the strips of rows r0…r1 of a chart (whole rows), or those whose length lies in [x0, x1] (chart units) */
function chartIds(c, r0, r1, x0 = -Infinity, x1 = Infinity) {
  const ids = [];
  for (let r = Math.max(0, r0); r <= Math.min(c.rows - 1, r1); r++) for (const it of c.items.slice(r * c.group, (r + 1) * c.group)) { const x = c.X(it.L); if (x >= x0 && x <= x1) ids.push(...it.ids); }
  return ids;
}
/** the selection of the Lengths charts (S.selSet) → the model, the bars and the line under the charts */
function setLengthSel(ids) {
  S.selSet = [...new Set(ids)]; S.selPiece = -1;
  view.selectPieces(S.selSet); markLengthSel(); showStrip();
}
function markLengthSel() {
  const sel = new Set(S.selSet && S.selSet.length ? S.selSet : S.selPiece >= 0 ? [S.selPiece] : []);
  for (const [id, c] of Object.entries(charts)) {
    const el = $(id); if (!el) continue;
    el.querySelectorAll('rect.bar').forEach(r => { const row = +r.dataset.r, on = sel.size > 0 && c.items.slice(row * c.group, (row + 1) * c.group).some(it => it.ids.some(x => sel.has(x))); r.classList.toggle('sel', on); });
  }
  const ro = $('ro-lensel'); if (!ro) return;
  if (!sel.size || !S.plan) { ro.hidden = true; return; }
  const Ls = [...sel].map(x => S.plan.pieceList[x]).filter(Boolean).map(pc => cm(pc.length));
  ro.hidden = false;
  ro.querySelector('.txt').textContent = `${sel.size} strip${sel.size === 1 ? '' : 's'} selected${Ls.length ? ` · ${fmt0(Math.min(...Ls))}${Ls.length > 1 ? ` – ${fmt0(Math.max(...Ls))}` : ''} cm` : ''}`;
}
function clearLengthSel() { if (S.selSet && S.selSet.length) setLengthSel([]); else if (S.selPiece >= 0) selectPiece(S.selPiece); markLengthSel(); }
/** hover, click and the selection window on both charts (wired once; the charts are redrawn inside their boxes) */
function wireLengthBars() {
  for (const id of ['len-strands', 'len-pieces']) {
    const el = $(id);
    const at = (e, svg) => { const r = svg.getBoundingClientRect(), c = charts[id]; return { x: (e.clientX - r.left) * c.W / Math.max(1, r.width), y: (e.clientY - r.top) * c.H / Math.max(1, r.height) }; };
    const rowAt = (y) => Math.floor((y - 1) / charts[id].rowH);
    el.addEventListener('pointerover', (e) => { if (drag) return; const r = e.target.closest('rect.bar'); if (!r || !view || !charts[id]) return; const row = +r.dataset.r; view.hoverPieces(chartIds(charts[id], row, row)); });
    el.addEventListener('pointerout', (e) => { if (drag) return; if (e.target.closest('rect.bar') && view) view.hoverPieces(null); });
    let drag = null, raf = 0, touch = false;
    const brush = () => {
      const c = charts[id], b = el.querySelector('.brush'); if (!drag || !b) return;
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
      b.setAttribute('x', x0.toFixed(1)); b.setAttribute('y', y0.toFixed(1)); b.setAttribute('width', (x1 - x0).toFixed(1)); b.setAttribute('height', (y1 - y0).toFixed(1)); b.setAttribute('visibility', 'visible');
      drag.ids = chartIds(c, rowAt(y0), rowAt(y1), x0, x1);
      view.hoverPieces(drag.ids.length ? drag.ids : null);
    };
    const scrollLoop = () => {                                       // the window goes on past the edge of the box: scroll
      raf = 0; if (!drag) return;
      const box = el.querySelector('.lc-scroll'), r = box.getBoundingClientRect(); let dy = 0;
      if (drag.cy < r.top + 6) dy = -Math.min(24, (r.top + 6 - drag.cy) * 0.5 + 4); else if (drag.cy > r.bottom - 6) dy = Math.min(24, (drag.cy - r.bottom + 6) * 0.5 + 4);
      if (dy && box.scrollHeight > box.clientHeight) { box.scrollTop += dy; const p = at({ clientX: drag.cx, clientY: drag.cy }, drag.svg); drag.x1 = p.x; drag.y1 = p.y; brush(); raf = requestAnimationFrame(scrollLoop); }
    };
    el.addEventListener('pointerdown', (e) => {
      const svg = e.target.closest('svg.lc-bars'); if (!svg || e.button !== 0 || !charts[id] || !view) return;
      touch = e.pointerType === 'touch'; if (touch) return;           // touch: a tap selects, a drag scrolls the list
      const p = at(e, svg);
      drag = { svg, x0: p.x, y0: p.y, x1: p.x, y1: p.y, cx: e.clientX, cy: e.clientY, moved: false, add: e.shiftKey || e.metaKey || e.ctrlKey, ids: [] };
      try { svg.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ } e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = at(e, drag.svg); drag.x1 = p.x; drag.y1 = p.y; drag.cx = e.clientX; drag.cy = e.clientY;
      if (!drag.moved && Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 4) drag.moved = true;
      if (drag.moved) { brush(); if (!raf) raf = requestAnimationFrame(scrollLoop); }
    });
    const end = (e, cancel = false) => {
      if (!drag) return; const d = drag; drag = null; if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const b = el.querySelector('.brush'); if (b) b.setAttribute('visibility', 'hidden');
      view.hoverPieces(null);
      if (cancel) return;
      const cur = new Set(S.selSet && S.selSet.length ? S.selSet : S.selPiece >= 0 ? [S.selPiece] : []);
      if (d.moved) { if (d.add) { for (const x of d.ids) cur.add(x); setLengthSel([...cur]); } else setLengthSel(d.ids); return; }
      // a click: on a bar → its strips (Shift / ⌘ / Ctrl: add or remove them); beside the bars → clear
      const c = charts[id], row = rowAt(d.y0), ids = row >= 0 && row < c.rows ? chartIds(c, row, row) : [];
      const onBar = ids.length && d.x0 <= Math.max(...c.items.slice(row * c.group, (row + 1) * c.group).map(it => c.X(it.L))) + 3;
      if (!onBar) { if (!d.add) clearLengthSel(); return; }
      if (d.add) { const all = ids.every(x => cur.has(x)); for (const x of ids) all ? cur.delete(x) : cur.add(x); setLengthSel([...cur]); }
      else if (cur.size === ids.length && ids.every(x => cur.has(x))) setLengthSel([]);
      else setLengthSel(ids);
    };
    el.addEventListener('pointerup', (e) => end(e));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('click', (e) => {                            // touch: a tap on a bar selects its strips
      if (!touch) return; touch = false;
      const r = e.target.closest('rect.bar'); if (!r || !charts[id]) return; const row = +r.dataset.r; setLengthSel(chartIds(charts[id], row, row));
    });
  }
  $('btn-lensel-clear').addEventListener('click', () => clearLengthSel());
  // the charts are drawn to the width of their box: redrawn when the options are resized
  let lastW = 0, tm = 0;
  new ResizeObserver(() => { const wNow = Math.round($('len-pieces').clientWidth); if (!wNow || Math.abs(wNow - lastW) < 4) return; lastW = wNow; clearTimeout(tm); tm = setTimeout(() => { if (S.w && S.plan) { drawLengths(S.w, S.plan); } }, 120); }).observe($('len-pieces'));
}
function initLayout() {
  const app = $('app'), saved = JSON.parse(localStorage.getItem('sp.layout') || '{}');
  const apply = () => {
    app.classList.toggle('options-closed', !!saved.optionsClosed); app.classList.toggle('options-right', !!saved.optionsRight);
    if (saved.optionsW) app.style.setProperty('--options-open-w', saved.optionsW + 'px'); else app.style.removeProperty('--options-open-w');
    $('options-toggle').setAttribute('aria-expanded', String(!saved.optionsClosed));
    localStorage.setItem('sp.layout', JSON.stringify(saved));
  };
  apply();
  $('options-toggle').addEventListener('click', () => { saved.optionsClosed = !saved.optionsClosed; apply(); });
  $('options-dock').addEventListener('click', () => { saved.optionsRight = !saved.optionsRight; apply(); });
  for (const d of document.querySelectorAll('details.sec')) { if (saved[d.id] === false) d.open = false; d.addEventListener('toggle', () => { saved[d.id] = d.open; apply(); }); }
  const rz = $('options-resize'); let drag = null;
  rz.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, w: $('options').getBoundingClientRect().width }; rz.setPointerCapture(e.pointerId); rz.classList.add('drag'); });
  rz.addEventListener('pointermove', (e) => { if (!drag) return; const sgn = app.classList.contains('options-right') ? -1 : 1; saved.optionsW = Math.max(240, Math.min(640, drag.w + sgn * (e.clientX - drag.x))); apply(); });
  rz.addEventListener('pointerup', () => { drag = null; rz.classList.remove('drag'); });
  rz.addEventListener('dblclick', () => { delete saved.optionsW; apply(); });
  // the theme: a switch in the top bar, light ⟷ dark (Ji, 17 Nov). Until it is used the page follows the system
  // ('auto', also after "reset all settings"); the switch shows the theme in effect either way.
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)'), sw = $('theme-switch');
  let theme = localStorage.getItem('sp.theme'); if (theme !== 'light' && theme !== 'dark') theme = 'auto';
  const isDark = () => (theme === 'auto' ? sysDark.matches : theme === 'dark');
  const showTheme = () => { sw.setAttribute('aria-checked', String(isDark())); };
  const setTheme = (t) => { theme = t; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; try { localStorage.setItem('sp.theme', t); } catch { /* private mode */ } showTheme(); view?.applyTheme(); drawPatternCards(); if (S.plan) history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm }); };
  sw.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
  setTheme(theme);
  sysDark.addEventListener('change', () => { showTheme(); view?.applyTheme(); drawPatternCards(); });
}
function initTips() {
  const card = $('tipcard'); let cur = null;
  const show = (btn) => {
    let html = '';
    if (btn.dataset.src) html = btn.dataset.src.split(/\s+/).map(id => $(id)?.outerHTML || '').join('');
    if (btn.dataset.tipText) html += `<p>${btn.dataset.tipText}</p>`;
    if (!html) return;
    card.innerHTML = html; card.hidden = false; cur = btn;
    const r = btn.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
    let x = r.right + 8, y = r.top - 6; if (x + cw > window.innerWidth - 8) x = r.left - cw - 8; if (y + ch > window.innerHeight - 8) y = window.innerHeight - ch - 8;
    card.style.left = Math.max(8, x) + 'px'; card.style.top = Math.max(8, y) + 'px';
  };
  const hide = () => { card.hidden = true; cur = null; };
  document.querySelectorAll('.info').forEach(b => {
    if (b.title) { b.dataset.tipText = b.title; b.removeAttribute('title'); }
    b.addEventListener('mouseenter', () => show(b)); b.addEventListener('mouseleave', hide); b.addEventListener('focus', () => show(b)); b.addEventListener('blur', hide);
    b.addEventListener('click', () => (cur === b ? hide() : show(b)));
  });
}
function initControls() {
  const sel = $('sel-case');
  const og1 = document.createElement('optgroup'); og1.label = 'warm-up (synthetic)';
  for (const [id, c] of Object.entries(SYNTHETIC)) { const o = document.createElement('option'); o.value = id; o.textContent = c.label; og1.appendChild(o); }
  const og2 = document.createElement('optgroup'); og2.label = 'benchmark (TryTriWeave) — sets scale and strip length';
  const og3 = document.createElement('optgroup'); og3.label = 'more lattices (TryTriWeave)';
  for (const m of MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.scale ? `${m.label} · ${m.scale} cm, ${m.len} cm` : m.label; o.title = m.scale ? `${m.scale} cm per model unit, strips up to ${m.len} cm` : ''; (m.more ? og3 : og2).appendChild(o); }
  sel.append(og1, og2, og3); sel.value = S.caseId;
  sel.addEventListener('change', () => { S.step = 0; window.history.replaceState(null, '', hashOf(sel.value)); loadCase(sel.value); });
  $('sel-up').addEventListener('change', (e) => setUp(e.target.value));
  const openFile = async (f) => { if (!f) return; try { const d = parseMesh(f.name, await f.arrayBuffer()); if (!d.F.length) throw new Error('no faces'); d.meta.header = d.meta.name; d.meta.name = f.name.replace(/\.(obj|stl)$/i, ''); S.step = 0; if (d.meta.scale > 0) { S.scale = d.meta.scale; saveSettings(); } setLattice(d, d.meta.name); } catch (err) { status(`could not read ${f.name}: ${err.message}`); } };
  $('file-obj').addEventListener('change', (e) => openFile(e.target.files[0]));
  const vp = $('viewport'); let dragDepth = 0;
  vp.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  vp.addEventListener('dragover', (e) => e.preventDefault());
  vp.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  vp.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; openFile(e.dataTransfer.files[0]); });
  initPatterns();
  // discretization
  $('sel-start').addEventListener('change', (e) => { S.rule = e.target.value; if (S.rule === 'pick') { if (!S.picks.length) armPick(); else replan(0); } else replan(0); });
  $('btn-pick').addEventListener('click', () => armPick());
  $('sel-method').value = S.method; $('sel-method').addEventListener('change', (e) => { stopTune(true); S.method = e.target.value; saveSettings(); replan(0); });
  // the profile: a radar chart of the plan's scores with a handle per axis for what matters; presets; the optimiser
  radar = new Radar($('radar'), { axes: AXES, onWeights: (wts, done) => { S.weights = wts; S.profile = 'custom'; $('sel-profile').value = 'custom'; if (done) { saveSettings(); reprofile(); } } });
  { const sp = $('sel-profile'); for (const [id, P] of Object.entries(PROFILES)) { const o = document.createElement('option'); o.value = id; o.textContent = P.label; sp.appendChild(o); }
    const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'my own (the handles)'; sp.appendChild(o); sp.value = S.profile;
    sp.addEventListener('change', () => { S.profile = sp.value; if (PROFILES[S.profile]) S.weights = { ...PROFILES[S.profile].w }; saveSettings(); radar.set({ weights: S.weights }); reprofile(); }); }
  radar.set({ weights: S.weights });
  $('btn-tune').addEventListener('click', () => { if (S.tuning) stopTune(true); else startTune(); });
  $('btn-len').addEventListener('click', startLengths);
  $('btn-untune').addEventListener('click', () => { delete S.tuned[S.method]; replan(0); });
  $('nb-weavers').value = S.weavers; $('nb-weavers').addEventListener('change', (e) => { const v = Math.max(1, Math.min(6, Math.round(+e.target.value) || 1)); e.target.value = v; S.weavers = v; saveSettings(); pickLabel(); replan(0); });
  pickLabel();
  const num = (id, key, after) => { const el = $(id); el.value = S[key]; el.addEventListener('change', () => { const v = +el.value; if (Number.isFinite(v)) { S[key] = v; saveSettings(); after(); } }); };
  num('nb-len', 'lengthCm', () => replan()); num('nb-overlap', 'overlap', () => replan()); num('nb-hold', 'hold', () => replan());
  wireLengthBars();
  // the scale: × model units, or one of the three sizes of the bounding box in centimetres (the others follow)
  $('nb-scale').addEventListener('change', (e) => setScale(+e.target.value));
  for (const [id, c] of [['nb-w', 0], ['nb-d', 1], ['nb-h', 2]]) $(id).addEventListener('change', (e) => { const v = +e.target.value; if (S.size && S.size[c] > 1e-9 && Number.isFinite(v) && v > 0) setScale(v / S.size[c]); else showScale(); });
  $('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
  $('modal-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('modal-text').value); status('copied'); } catch { $('modal-text').select(); } });
  // display
  $('chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; c.classList.toggle('on'); view.setVisible(c.dataset.layer, c.classList.contains('on')); });
  $('sel-lathcol').addEventListener('change', (e) => { const v = e.target.value; if (v !== 'marker') S.lathCol = v; applyLathColour(); if (v === 'marker') { if (!S.markers.length) { openMarkers(); armMark(); } else if (!S.markShow) setMarkShow(true); } });
  // the reference marks: the switch in the header of 3 Markers (Ji, 18 Nov: there, not in the top bar — the list is right under it), the Add button, the list
  $('mk-switch').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation();        // the header is the fold of the section: the switch does not fold it
    if (!S.plan) return;
    if (!S.markers.length) { if (S.marking) disarmMark(); else { openMarkers(); armMark(); } return; }   // nothing marked yet: the switch starts the marking
    setMarkShow(!S.markShow); });
  $('btn-mark').addEventListener('click', () => { if (S.marking) disarmMark(); else armMark(); });
  $('btn-mark-clear').addEventListener('click', () => { S.markers = []; saveMarks(); showMarks(); });
  { const list = $('mk-list'), at = (e) => { const r = e.target.closest('.mkrow'); return r ? S.markers[+r.dataset.i] : null; };
    list.addEventListener('change', (e) => { const m = at(e); if (!m) return; if (e.target.classList.contains('mk-on')) { m.on = e.target.checked; saveMarks(); showMarks(); } });
    list.addEventListener('input', (e) => { const m = at(e); if (!m) return;
      if (e.target.classList.contains('mk-col')) { m.colour = e.target.value; saveMarks(); showMarks(true, false); }
      else if (e.target.classList.contains('mk-name')) { m.name = e.target.value.slice(0, 24); saveMarks(); showMarks(false, false); } });
    list.addEventListener('click', (e) => { if (!e.target.closest('.mk-del')) return; const r = e.target.closest('.mkrow'); if (!r) return; S.markers.splice(+r.dataset.i, 1); view.hoverPieces(null); view.setHover(-1); saveMarks(); showMarks(); });
    const lit = (m) => { if (!m) { view.hoverPieces(null); view.setHover(-1); return; } if (m.kind === 'cell') view.setHover(m.cell); else { const pc = markPiece(m); view.hoverPieces(pc ? [pc.id] : null); } };
    list.addEventListener('pointerover', (e) => { const r = e.target.closest('[data-i]'); if (r) lit(S.markers[+r.dataset.i]); });
    list.addEventListener('pointerout', (e) => { if (e.target.closest('[data-i]')) lit(null); }); }
  const slider = (id, out, fmt, cb) => { const el = $(id); el.addEventListener('input', () => { $(out).textContent = fmt(+el.value); }); el.addEventListener('change', () => cb(+el.value)); $(out).textContent = fmt(+el.value); };
  $('sl-lathw').value = S.width; $('sl-latht').value = S.thickness;
  slider('sl-lathw', 'out-lathw', (v) => v.toFixed(2), (v) => { S.width = v; S.widths[S.pattern] = v; saveSettings(); if (PATTERNS[S.pattern].fitsWidth) restylePattern(); else view.setLaths(lathOpts()); });   // (kept for the pattern in use; a band's strips lie side by side: the weave is made again for the width)
  slider('sl-latht', 'out-latht', (v) => v.toFixed(3), (v) => { S.thickness = v; saveSettings(); view.setLaths(lathOpts()); });
  $('sel-deactive').value = S.deactive; $('sel-deactive').addEventListener('change', (e) => { S.deactive = e.target.value; saveSettings(); view.setDeactive(S.deactive); });
  // the lath side: the laths on the other side of the surface, and over / under read from there (they swap) — replanned so
  // that the History bar, the status and the exports say what the view shows (Ji, 11 Nov: the canopy tree)
  $('ck-flip').addEventListener('change', (e) => { view.sideSign = e.target.checked ? -1 : 1; if (S.w) { S.w.side = view.sideSign; replan(S.step, S.tick); } });
  $('sel-follow').value = S.follow; $('sel-follow').addEventListener('change', (e) => { S.follow = e.target.value; saveSettings(); S.lastCell = -1; if (S.follow === 'off') view.home(); else if (S.step >= 0 && S.plan) onStep(S.step, S.tick); });
  slider('sl-turn', 'out-turn', (v) => String(v), (v) => view.setTurntable(view.turntable, v));
  $('btn-defaults').addEventListener('click', () => { for (const k of ['sp.settings', 'sp.layout', 'sp.theme', 'sp.up', 'sp.markers']) localStorage.removeItem(k); saveSettings = () => {}; location.href = location.pathname; });
  // navigation
  $('nav-home').addEventListener('click', () => view.home());
  $('nav-fit').addEventListener('click', () => view.fit());
  $('nav-turn').addEventListener('click', () => { view.setTurntable(!view.turntable, +$('sl-turn').value); $('nav-turn').classList.toggle('on', view.turntable); });
  $('nav-up').addEventListener('click', () => view.orbitBy(0, -Math.PI / 2));
  $('nav-down').addEventListener('click', () => view.orbitBy(0, Math.PI / 2));
  $('nav-left').addEventListener('click', () => view.orbitBy(-Math.PI / 2, 0));
  $('nav-right').addEventListener('click', () => view.orbitBy(Math.PI / 2, 0));
  $('nav-proj').addEventListener('click', () => { const ortho = view.projection !== 'ortho'; view.setProjection(ortho ? 'ortho' : 'persp'); $('nav-proj').querySelector('.ic-persp').hidden = ortho; $('nav-proj').querySelector('.ic-ortho').hidden = !ortho; $('nav-proj').title = ortho ? 'Orthographic — click for perspective (P)' : 'Perspective — click for orthographic (P)'; });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'h') view.home(); else if (k === 'f') view.fit(); else if (k === 't') $('nav-turn').click(); else if (k === 'p') $('nav-proj').click();
    else if (e.key === 'Escape') { if (S.picking) disarmPick(); if (S.marking) disarmMark(); if (S.pickingCentre) disarmCentre(); clearLengthSel(); $('modal').hidden = true; }
  });
  // picking on the view: a cell disc tells about its cell (no jump — Ji's bug 2), a lath selects its piece, the bare
  // surface does nothing (unless a start is being picked)
  const gl = $('gl'); let down = null;
  gl.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  gl.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; } down = null;
    const h = view.pick(e.clientX, e.clientY);
    if (S.pickingCentre) { const c = cellAt(h); if (c >= 0) toggleCentre(c); return; }   // the star's centres: any cell, on and off
    if (S.marking) { markAt(h); return; }
    if (S.picking || e.shiftKey) { const c = cellAt(h); if (c >= 0) pickCell(c, S.picking); return; }
    if (!h || (h.kind === 'cell' && h.onSurface)) { clearLengthSel(); return; }
    if (h.kind === 'cell') { const plan = S.plan, v = h.cell, k = plan.stepOf[v]; status(`${S.w.boundary[v] ? 'rim cell' : S.w.valence[v] + '-sided cell'} #${v} · closed at step ${k + 1}`); }
    else if (h.kind === 'lath') selectPiece(h.piece);
  });
}
/** the cell a click means while a cell is being picked: the cell clicked — or, clicked on a strip (wide strips leave
 *  little of a cell open to click on), the cell nearest to that point */
function cellAt(h) {
  if (!h) return -1; if (h.kind === 'cell') return h.cell; if (!h.point || !S.w) return -1;
  const V = S.w.V, p = h.point; let best = -1, bd = Infinity;
  for (let v = 0; v < S.w.nV; v++) { const d = (V[3 * v] - p.x) ** 2 + (V[3 * v + 1] - p.y) ** 2 + (V[3 * v + 2] - p.z) ** 2; if (d < bd) { bd = d; best = v; } }
  return best;
}
// --- the reference marks (Ji, 18 Nov: "when the user physically weaves, there is no colour or reference between their model
//     and the digital 3D canvas, so it would be good to mark cells or strips as spatial references") ----------------------
// A mark is a cell of the lattice, or a strip — kept as one crossing of its strand, so that it stays on the strip that holds
// that crossing when the plan is cut differently. Added from the model (3 Markers → Add from the model…, then a click on a
// strip or on the opening of a cell; a second click takes the mark off), listed with a check box, a colour and a name;
// the switch in the top bar shows them: it colours the laths by marker and lists the marks beside it.
const markKey = (name = S.name) => (S.pattern === 'hex' ? name : `${name} · ${S.pattern}`);   // the marks of a file, for the weave of each pattern (a strip mark is a crossing of one of its strands)
const saveMarks = () => { if (S.markers.length) MARKS[markKey()] = S.markers; else delete MARKS[markKey()]; try { localStorage.setItem('sp.markers', JSON.stringify(MARKS)); } catch { /* private mode */ } };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const applyLathColour = () => { view.recolour($('sel-lathcol').value); if (S.plan) history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm }); };
/** the strip a strip mark is on in the plan as it is: the one that is woven through the marked crossing (else the one laid over it in a joint) */
function markPiece(m) {
  const plan = S.plan; if (!plan || m.kind !== 'strip') return null; let other = null;
  for (const pc of plan.pieceList) { if (pc.strand !== m.strand) continue; const n = pc.knots.length, oT = pc.ovTail | 0, oH = pc.ovHead | 0; for (let i = 0; i < n; i++) if (pc.knots[i] === m.knot) { if (i >= oT && i < n - oH) return pc; other = other || pc; } }
  return other;
}
/** the marks in the view and the list, and their switch. recolour: the History chips follow (the laths are coloured by marker); list: rebuild the rows (not while a field of a row is being edited) */
function showMarks(recolour = true, list = true) {
  const w = S.w, plan = S.plan; if (!w || !plan) return;
  const rows = S.markers.map((m, i) => {
    if (m.kind === 'cell') { const k = plan.stepOf ? plan.stepOf[m.cell] : -1; return { m, i, what: `cell #${m.cell}`, tip: `${w.boundary[m.cell] ? 'rim cell' : w.valence[m.cell] + '-sided cell'} #${m.cell}${k >= 0 ? ` · closed at step ${k + 1}` : ''}` }; }
    const pc = markPiece(m); return { m, i, pc, what: pc ? `strip ${pc.label}` : 'strip', tip: pc ? `strip ${pc.label} · ${fmt0(cm(pc.length))} cm${pc.intro >= 0 ? ` · picked up at step ${pc.intro + 1}` : ''}` : 'this strip is not in the plan as it is' };
  });
  const shown = rows.filter(r => r.m.on !== false);
  view.setMarkers(shown.map(r => (r.m.kind === 'cell' ? { kind: 'cell', cell: r.m.cell, hex: r.m.colour } : { kind: 'strip', piece: r.pc ? r.pc.id : -1, hex: r.m.colour })));
  view.setVisible('markers', S.markShow);
  if (list) {
    $('mk-list').innerHTML = rows.map(r => `<div class="mkrow" data-i="${r.i}" title="${esc(r.tip)}"><input type="checkbox" class="mk-on"${r.m.on !== false ? ' checked' : ''} title="show this mark" aria-label="show ${esc(r.what)}"><input type="color" class="mk-col" value="${esc(r.m.colour)}" title="the colour of the mark" aria-label="colour of ${esc(r.what)}"><span class="mk-what ${r.m.kind}">${esc(r.what)}</span><input type="text" class="mk-name" value="${esc(r.m.name || '')}" placeholder="name" maxlength="24" autocomplete="off" aria-label="name of ${esc(r.what)}"><button type="button" class="mk-del" title="remove this mark" aria-label="remove ${esc(r.what)}">×</button></div>`).join('');
    $('mk-foot').hidden = rows.length < 2;
  }
  const nS = rows.filter(r => r.m.kind === 'strip').length, nC = rows.length - nS;
  $('sum-mark').textContent = rows.length ? [nS ? `${nS} strip${nS === 1 ? '' : 's'}` : '', nC ? `${nC} cell${nC === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : '';
  $('mk-hint').textContent = S.marking ? 'click a strip, or the opening of a cell' : rows.length ? '' : 'a strip, or the opening of a cell';
  // with nothing marked (and no marking going on) the laths are not left grey: the colouring there was comes back
  if (!rows.length && !S.marking && $('sel-lathcol').value === 'marker') { const sel = $('sel-lathcol'); sel.value = S.lathCol && S.lathCol !== 'marker' ? S.lathCol : 'piece'; view.recolour(sel.value); if (recolour && S.plan) history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm }); }
  // the switch in the header of the section
  const sw = $('mk-switch'), on = S.markShow && (rows.length > 0 || S.marking);
  sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('none', !rows.length);
  if (recolour && view.colouring === 'marker' && S.plan) history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm });
}
/** the switch: on — the laths by marker, the marked cells ringed; off — the colouring there was */
function setMarkShow(on) {
  S.markShow = !!on; saveSettings();
  const sel = $('sel-lathcol');
  if (S.markShow) { if (sel.value !== 'marker') { S.lathCol = sel.value; sel.value = 'marker'; } }
  else if (sel.value === 'marker') sel.value = S.lathCol && S.lathCol !== 'marker' ? S.lathCol : 'piece';
  view.recolour(sel.value);
  showMarks(false); applyLathColour();
}
function openMarkers() { const app = $('app'); if (app.classList.contains('options-closed')) $('options-toggle').click(); const d = $('sec-mark'); d.open = true; d.scrollIntoView({ block: 'nearest' }); }
function armMark() {
  if (S.picking) disarmPick(); if (S.pickingCentre) disarmCentre();
  S.marking = true; $('gl').classList.add('arm'); $('pickhint').textContent = 'click a strip, or the opening of a cell, to mark it · again to take the mark off · Esc ends'; $('pickhint').hidden = false;
  $('btn-mark').classList.add('on'); $('btn-mark').textContent = 'Done';
  setMarkShow(true);                                               // the marks are shown while they are made
}
function disarmMark() { S.marking = false; $('gl').classList.remove('arm'); $('pickhint').hidden = true; $('btn-mark').classList.remove('on'); $('btn-mark').textContent = 'Add from the model…'; if (S.plan) showMarks(true, false); }
/** a click on the model while marking: a strip, or a cell (its disc, or the bare surface nearest to it) — marked, or unmarked when it was */
function markAt(h) {
  const plan = S.plan; if (!h || !plan) return;
  let m = null;
  if (h.kind === 'lath') {
    const pc = plan.pieceList[h.piece]; if (!pc) return;
    const j = S.markers.findIndex(x => x.kind === 'strip' && markPiece(x) === pc);
    if (j >= 0) S.markers.splice(j, 1);
    else { const oT = pc.ovTail | 0, own = pc.knots.length - oT - (pc.ovHead | 0); m = { kind: 'strip', strand: pc.strand, knot: pc.knots[Math.min(pc.knots.length - 1, oT + Math.floor(Math.max(0, own - 1) / 2))] }; }   // the middle one of its own crossings
  } else if (h.kind === 'cell') {
    const j = S.markers.findIndex(x => x.kind === 'cell' && x.cell === h.cell);
    if (j >= 0) S.markers.splice(j, 1); else m = { kind: 'cell', cell: h.cell };
  } else return;
  if (m) { const used = new Set(S.markers.map(x => x.colour)); m.colour = MARK_COLOURS.find(c => !used.has(c)) || MARK_COLOURS[S.markers.length % MARK_COLOURS.length]; m.name = ''; m.on = true; S.markers.push(m); }
  saveMarks(); showMarks();
}

// picking the starts: one cell per weaver, A first (Pick start…, then a click on the surface for each); Shift-click picks
// the next one without arming; Esc keeps the starts there were
const pickHint = () => (S.weavers > 1 ? `click the start of weaver ${WEAVER[S.pickNext]} (${S.pickNext + 1} of ${S.weavers}) · Esc cancels` : 'click a cell to start there · Esc cancels');
function pickLabel() { $('btn-pick').textContent = S.weavers > 1 ? 'Pick starts…' : 'Pick start…'; }
function armPick() { if (S.marking) disarmMark(); if (S.pickingCentre) disarmCentre(); S.picking = true; S.pickNext = 0; S.picksNew = []; $('gl').classList.add('arm'); $('pickhint').textContent = pickHint(); $('pickhint').hidden = false; $('btn-pick').classList.add('on'); }
function disarmPick() {
  S.picking = false; $('gl').classList.remove('arm'); $('pickhint').hidden = true; $('btn-pick').classList.remove('on');
  view.setStarts(S.weavers > 1 && S.rule === 'pick' && S.picks.length ? S.picks.slice(0, S.weavers) : null);
  if (S.rule === 'pick' && !S.picks.length) { S.rule = 'auto'; $('sel-start').value = 'auto'; }
}
function pickCell(v, armed) {
  const K = Math.max(1, S.weavers | 0);
  if (armed) {
    S.picksNew[S.pickNext++] = v; view.setStarts(K > 1 ? S.picksNew : null);
    if (S.pickNext < K) { $('pickhint').textContent = pickHint(); return; }
    S.picks = S.picksNew.slice();
  } else { S.picks = S.picks.slice(0, K); const i = S.picks.length < K ? S.picks.length : S.shiftNext++ % K; S.picks[i] = v; }   // A, B … in turn
  S.rule = 'pick'; $('sel-start').value = 'pick'; disarmPick(); replan(0);
}

// --- 3 Pattern (Ji, 19 Nov: "from the options panel, we will add a new section after discretisation, called Pattern … use
//     grid view to display the pattern (show basic on hex for single cell and one ring). This makes it easier to add new
//     patterns") ---------------------------------------------------------------------------------------------------------
// One card per entry of PATTERNS (patterns.js), painted from the pattern's own rule on a flat patch: the cell, and the
// cell with the six round it. A click weaves the lattice in that pattern: the weave is made again (its strands and
// crossings may be others), then the plan, the view, the History bar and the lengths. Under the grid only the controls
// the pattern has (Ji, 19 Nov evening: no second, larger picture and no readout — "verbosity and overlap with the other
// diagram"; "they should only show up when the pattern has the additional/optional setting"): the star's centres, the
// strips of its bands and the order they are threaded in, the centre and the rounds of the star in rounds, the mirror
// image, how the hemp leaf's centre strips are woven in.
const CENTRE_INFO = {
  many: 'The cells the star is woven round: at their corners the strips of the bands nest as a V, the strip nearer the hole on top. By default one singular cell — the highest one; on a lattice without one, the middle of the patch. Pick…: click cells on the model to make them centres (a cell with six sides works too), click a centre again to take it off; the centres wear a small ring while you pick. Every singular: all cells of 5 or 7 sides at once. default: back to the one.',
  rounds: 'The cells the rounds go round. By default one singular cell — the highest one; on a lattice without one, the middle of the patch. Pick…: click cells on the model to make them centres (a cell with six sides works too), click a centre again to take it off; the centres wear a small ring while you pick. Every singular: all cells of 5 or 7 sides at once. With several centres every crossing is woven by the rounds of the centre it is nearest to: the stars meet half-way. default: back to the one.',
  one: 'The cell the rounds go round. By default a singular cell — the highest one; on a lattice without one, the middle of the patch. Pick…, then click any cell on the model (a cell with six sides works too): the rounds are woven round it. default: back to the singular cell.',
};
const hashOf = (caseId = S.caseId) => '#' + caseId + (S.pattern !== 'hex' ? '/' + S.pattern : '');
function initPatterns() {
  const grid = $('pat-grid');
  grid.innerHTML = PATTERN_IDS.map(id => { const P = PATTERNS[id]; return `<button type="button" class="patcard" role="radio" aria-checked="false" data-pat="${id}" title="${esc(P.about)}"><canvas data-v="cell" aria-hidden="true"></canvas><canvas data-v="ring" aria-hidden="true"></canvas><span class="pn">${esc(P.name)}</span><span class="pz">${esc(P.native)}</span></button>`; }).join('');
  grid.addEventListener('click', (e) => { const b = e.target.closest('.patcard'); if (b) setPattern(b.dataset.pat); });
  $('btn-centre').addEventListener('click', () => { if (S.pickingCentre) disarmCentre(); else armCentre(); });
  $('btn-centre-all').addEventListener('click', () => { S.patAll = !S.patAll; S.patCentres = []; restylePattern(); });
  $('btn-centre-auto').addEventListener('click', () => { S.patAll = false; S.patCentres = []; restylePattern(); });
  $('nb-strips').addEventListener('change', (e) => { const v = Math.max(2, Math.min(5, Math.round(+e.target.value) || 3)); e.target.value = v; if (v === S.patStrips) return; S.patStrips = v; saveSettings(); restylePattern(); });
  $('nb-rounds').addEventListener('change', (e) => { const v = Math.max(0, Math.min(60, Math.round(+e.target.value) || 0)); e.target.value = v; if (v === S.patRounds) return; S.patRounds = v; saveSettings(); restylePattern(); });
  $('sel-star-order').addEventListener('change', (e) => { S.starOrder = e.target.value === 'pass' ? 'pass' : 'band'; saveSettings(); replan(0); });
  $('ck-hand').addEventListener('change', (e) => { S.patHand = e.target.checked ? -1 : 1; saveSettings(); restylePattern(); });
  $('sel-hemp').addEventListener('change', (e) => { S.hempMethod = e.target.value === 'along' ? 'along' : 'after'; saveSettings(); replan(0); });
  // the cards are painted to the size of their box: again when the options are resized or the section is opened
  let lastW = 0, tm = 0;
  const ro = new ResizeObserver(() => { const c = grid.querySelector('canvas'), wNow = c ? Math.round(c.clientWidth) : 0; if (!wNow || wNow === lastW) return; lastW = wNow; clearTimeout(tm); tm = setTimeout(drawPatternCards, 60); });
  ro.observe(grid);
  $('sec-pat').addEventListener('toggle', () => { lastW = 0; drawPatternCards(); });   // (and without waiting for the observer: at once when the section opens, and at the start)
  requestAnimationFrame(() => drawPatternCards());
  showPattern();
}
/** the cards: each pattern on one cell and on the cell with its ring, in the colours of the three strand families */
function drawPatternCards() {
  const grid = $('pat-grid'); if (!grid || !grid.children.length) return;
  const css = getComputedStyle(document.documentElement), val = (n, f) => css.getPropertyValue(n).trim() || f, dark = val('--scheme', 'light') === 'dark', dpr = Math.min(window.devicePixelRatio || 1, 3);
  const mix = (hex, to, t) => { const h = (x) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)), a = h(hex.length === 7 ? hex : '#888888'), b = h(to); return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join(''); };
  const colours = { ground: val('--canvas', '#f6f6f5'), family: [val('--fam-a', '#2f94d3'), val('--fam-b', '#DDAA33'), val('--fam-c', '#BB5566')].map(c => mix(c, '#ffffff', dark ? 0.12 : 0.38)), inlay: dark ? '#d39a4c' : '#c98a3c', edge: dark ? 'rgba(0,0,0,0.62)' : 'rgba(40,36,30,0.55)', frame: val('--border', '#dcdcd9') };
  for (const cv of grid.querySelectorAll('canvas[data-v]')) {
    const card = cv.closest('.patcard'), size = Math.max(36, Math.round(cv.clientWidth) || 56); cv.width = cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { paintCard(ctx, card.dataset.pat, cv.dataset.v, size, colours); } catch (err) { console.error('pattern card:', err); }
  }
}
/** the section shows the state: the card in use, and the controls the pattern has — no others */
function showPattern() {
  const P = PATTERNS[S.pattern], w = S.w, grid = $('pat-grid'); if (!grid) return;
  for (const b of grid.children) b.setAttribute('aria-checked', String(b.dataset.pat === S.pattern));
  const one = P.centres === 'one';                                 // (a pattern woven round a single cell: the star in rounds)
  $('pat-opts').hidden = !(P.centres || P.strips || P.rounds || P.order || P.hand || P.method);
  $('row-pat-centre').hidden = !P.centres; $('row-pat-strips').hidden = !P.strips; $('row-pat-order').hidden = !P.order; $('row-pat-rounds').hidden = !P.rounds; $('row-pat-hand').hidden = !P.hand; $('row-pat-method').hidden = !P.method;
  $('nb-strips').value = S.patStrips; $('nb-rounds').value = S.patRounds; $('sel-star-order').value = S.starOrder; $('ck-hand').checked = S.patHand < 0; $('sel-hemp').value = S.hempMethod;
  $('lb-centre').textContent = one ? 'centre' : 'centres'; $('info-centre').dataset.tipText = one ? CENTRE_INFO.one : CENTRE_INFO[S.pattern] || CENTRE_INFO.many;
  $('btn-centre').textContent = S.pickingCentre ? (one ? 'Cancel' : 'Done') : 'Pick…'; $('btn-centre').classList.toggle('on', S.pickingCentre);
  $('btn-centre-all').hidden = one; $('btn-centre-all').classList.toggle('on', S.patAll); $('btn-centre-all').disabled = !(w && singularCells(w).length);
  $('btn-centre-auto').hidden = !(P.centres && (one ? S.patCentres.length : S.patAll || S.patCentres.length));
  const mine = w && w.pattern && w.pattern.id === S.pattern, g = S.plan && S.plan.guests;
  $('sum-pat').textContent = [P.name.toLowerCase(), mine ? w.pattern.sum : '', mine && P.method && g ? (g.method === 'along' ? 'laid in' : 'threaded afterwards') : '', mine && P.order && g && g.order ? (g.order === 'pass' ? 'pass by pass' : 'band by band') : ''].filter(Boolean).join(' · ');
  $('sum-pat').title = mine ? `${P.native} — ${w.pattern.text}` : P.native;
}
/** weave the lattice in another pattern */
function setPattern(id) {
  if (!PATTERNS[id] || id === S.pattern) return;
  if (S.pickingCentre) disarmCentre(); if (S.picking) disarmPick(); if (S.marking) disarmMark();
  S.pattern = id; S.width = widthOf(id); $('sl-lathw').value = S.width; $('out-lathw').textContent = S.width.toFixed(2);
  saveSettings(); window.history.replaceState(null, '', hashOf());
  S.step = 0; if (S.raw) setLattice(S.raw, S.name); else showPattern();
}
/** the pattern's rule again on the weave as it is (other centres, another number of strips, the mirror image, another
 *  width): the lattice's strands stay, over and under and the pattern's own strips are made again */
function restylePattern() {
  const w = S.w; if (!w || !w.pattern || !PATTERNS[w.pattern.id].style) { showPattern(); return; }
  restyle(w, patSpec()); S.wx = w.x || w; syncWidth(); replan(S.step, S.tick);
}
// the star's centres (Ji, 19 Nov: "default at singular cell, but provide the option by user to select which cell, it could
// be on hex 6 cell as well" — and, in the evening: "please add multiple centres" · "one singular, and make option for
// picked, select every singular"). Pick…: every click on a cell of the model makes it a centre, a click on a centre
// takes it off again — starting from the centres there are; the centres wear a small ring while they are picked (no
// longer at other times: "it blocks the view"). Done or Esc ends. With no centre left the default one comes back.
// (A pattern woven round a single cell — centres: 'one', none at the moment — takes the cell clicked and ends the picking.)
function armCentre() {
  if (S.picking) disarmPick(); if (S.marking) disarmMark();
  S.pickingCentre = true; $('gl').classList.add('arm'); $('pickhint').textContent = PATTERNS[S.pattern].centres === 'one' ? 'click the cell the rounds go round · Esc ends' : 'click a cell to make it a centre · again to take it off · Esc or Done ends'; $('pickhint').hidden = false;
  if (S.w && S.w.pattern.centres) view.setCentres(S.w.pattern.centres);
  showPattern();
}
function disarmCentre() { S.pickingCentre = false; $('gl').classList.remove('arm'); $('pickhint').hidden = true; view.setCentres(null); showPattern(); }
function toggleCentre(v) {
  if (PATTERNS[S.pattern].centres === 'one') { S.patAll = false; S.patCentres = [v]; disarmCentre(); restylePattern(); return; }   // one centre: the cell clicked, and the picking is over
  const now = S.w && S.w.pattern.centres ? S.w.pattern.centres.slice() : [], at = now.indexOf(v);
  if (at >= 0) now.splice(at, 1); else now.push(v);
  S.patAll = false; S.patCentres = now; restylePattern();
}

/** every control shows the state: a browser puts the form values of the last visit back on reload, which may not be what
 *  was saved (the method said "ring to ring" while the plan was the cell tour) */
function syncControls() {
  const set = (id, v) => { const el = $(id); if (el && v !== undefined && String(el.value) !== String(v)) el.value = v; };
  set('sel-case', S.caseId); set('sel-up', S.up); set('sel-method', S.method); set('nb-weavers', S.weavers); set('nb-len', S.lengthCm); set('nb-overlap', S.overlap); set('nb-hold', S.hold);
  set('sel-deactive', S.deactive); set('sel-follow', S.follow); set('sel-profile', S.profile); set('sel-start', S.rule); set('sl-lathw', S.width); set('sl-latht', S.thickness);
  if (view) { set('sel-lathcol', view.colouring); $('ck-flip').checked = view.sideSign < 0; for (const c of $('chips').children) c.classList.toggle('on', !!view.visible[c.dataset.layer]); }
  $('out-lathw').textContent = (+S.width).toFixed(2); $('out-latht').textContent = (+S.thickness).toFixed(3);
  if (S.w) showScale();
  showPattern();
}
function main() {
  view = new View($('gl')); view.attachNav($('navcube'));
  history = new History({ onStep, onHover: (cell) => view.setHover(cell), onShow: (show) => view.setWeaverMask(show), onReverse: (st) => { if (S.flip.has(st.flipKey)) S.flip.delete(st.flipKey); else S.flip.add(st.flipKey); replan(S.step, null); } });
  initLayout(); initTips(); initControls();
  // the address opens on a case and a pattern: index.html#cone5 · #cone5/mad · #Bunny/hemp
  const fromHash = () => { const [c, pt] = decodeURIComponent(location.hash.slice(1)).split('/'); return { id: c && (SYNTHETIC[c] || MODELS.some(m => m.id === c)) ? c : null, pattern: PATTERNS[pt] ? pt : null }; };
  const usePattern = (pt) => { if (!pt || pt === S.pattern) return false; S.pattern = pt; S.width = widthOf(pt); saveSettings(); return true; };
  const h0 = fromHash(); usePattern(h0.pattern); if (h0.id) { S.caseId = h0.id; $('sel-case').value = h0.id; }
  loadCase(S.caseId);
  window.addEventListener('hashchange', () => { const h = fromHash(), other = usePattern(h.pattern); if (h.id && h.id !== S.caseId) { $('sel-case').value = h.id; S.step = 0; loadCase(h.id); } else if (other && S.raw) { S.step = 0; setLattice(S.raw, S.name); } syncControls(); });
  syncControls(); window.addEventListener('pageshow', () => setTimeout(syncControls, 0));
  const loop = () => { view.render(); requestAnimationFrame(loop); }; loop();
}
main();
