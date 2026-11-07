// app.js — state, the page's controls and the frame loop of the WeaveTogether practice.
// Lattice (OBJ or synthetic) → weave.js (strands, crossings, over/under) → planner.js (start, order, sub-steps with
// their crossings in weaving order, pieces, clips) → view.js (the 3-D scene with the path of the order) + history.js
// (the play bar with the weave direction and the over / under sequence).
import { parseOBJ, buildWeave, chargeSummary, medianEdge, orientConsistent, orientOutward } from './weave.js';
import { SYNTHETIC } from './lattices.js';
import { planWeave, describeStep, START_RULES, ORDER_RULES } from './planner.js';
import { View } from './view.js';
import { History } from './history.js';

const $ = (id) => document.getElementById(id);
const MODELS = [
  { id: 'v4Cone_sharp', file: 'models/v4Cone_sharp_v4_135v.obj', label: 'v4 cone — one 4 at the apex (TryTriWeave)' },
  { id: 'cylinder', file: 'models/cylinder_v3_290v.obj', label: 'capped cylinder — six 5s on each crease (TryTriWeave)' },
  { id: 'Tube', file: 'models/Tube_v6_216v.obj', label: 'open tube — no singularity (TryTriWeave)' },
  { id: 'Tube230', file: 'models/Tube_v6_230v.obj', label: 'open tube, 230 cells (TryTriWeave)' },
  { id: 'Bunny', file: 'models/Bunny_v3_309v.obj', label: 'Bunny — 61 singular cells (TryTriWeave)' },
  { id: 'srf', file: 'models/srf_v6_365v.obj', label: 'srf — open surface, three 5s and a 7 (TryTriWeave)' },
  { id: 'torus', file: 'models/genus1_torus_v6_696v.obj', label: 'torus — 696 cells, five closed strands (TryTriWeave)' },
  { id: 'treeBig', file: 'models/treeBig_v9_527v.obj', label: 'tree — 527 cells, thirty 7s (TryTriWeave)' },
];
const SAVED = JSON.parse(localStorage.getItem('sp.settings') || '{}');
const S = {                                                        // the state
  caseId: 'cone5', w: null, plan: null, a: 1, meta: {}, name: '', lastW: null,
  scale: SAVED.scale ?? 1, lengthCm: SAVED.lengthCm ?? 80, overlap: SAVED.overlap ?? 2, hold: SAVED.hold ?? 4, distribution: SAVED.distribution || 'start',
  width: SAVED.width ?? 0.2, thickness: SAVED.thickness ?? 0.05, rule: 'half', strategy: SAVED.strategy || 'spiral', deactive: SAVED.deactive || 'hanging',
  picked: -1, picking: false, step: 0, tick: null, follow: SAVED.follow || 'off', selPiece: -1, flip: new Set(), lastCell: -1,
};
let view, history;
const saveSettings = () => localStorage.setItem('sp.settings', JSON.stringify({ scale: S.scale, lengthCm: S.lengthCm, overlap: S.overlap, hold: S.hold, distribution: S.distribution, width: S.width, thickness: S.thickness, strategy: S.strategy, deactive: S.deactive, follow: S.follow }));
const maxLength = () => (S.lengthCm > 0 && S.scale > 0 ? S.lengthCm / S.scale : 0);   // the length limit in model units
const cm = (modelUnits) => modelUnits * S.scale;                                        // S.scale: centimetres per model unit
const lathOpts = () => ({ a: S.a, width: S.width * S.a, thickness: S.thickness * S.a });

// --- lattice in -------------------------------------------------------------------------------------------------
async function loadCase(id) {
  S.caseId = id; status('loading…');
  let data;
  if (SYNTHETIC[id]) data = SYNTHETIC[id].make();
  else {
    const m = MODELS.find(x => x.id === id); if (!m) return;
    try { const r = await fetch(m.file); if (!r.ok) throw new Error(r.status); data = parseOBJ(await r.text()); data.meta.name = data.meta.name || m.id; }
    catch (err) { status(`could not load ${m.file} (${err.message}) — serve the folder over http`); return; }
  }
  setLattice(data, data.meta.name || id);
}
function setLattice(data, name) {
  const V = Float64Array.from(data.V), F = Int32Array.from(data.F);
  const flips = orientConsistent(F), flipped = orientOutward(V, F);
  const w = buildWeave(V, F);
  S.w = w; S.a = data.meta.a || medianEdge(w); S.meta = data.meta; S.name = name; S.picked = -1; S.selPiece = -1; S.flip = new Set(); S.lastCell = -1;
  if (S.rule === 'pick') S.rule = 'half';
  $('sel-start').value = S.rule;
  const cs = chargeSummary(w), hist = Object.entries(cs.hist).map(([n, c]) => `${c} × ${n}`).join(', ');
  const closed = w.strands.filter(s => s.closed).length;
  $('ro-lattice').textContent = `${name}\n${w.nV} cells (${cs.nInterior} interior) · ${w.nE} crossings · ${w.nT} triangles · χ = ${w.chi}\nsides: ${hist} · Σ(6 − n) = ${cs.charge}\n${w.strands.length} strands (${closed} closed) · parity conflicts ${w.parityConflicts}${w.selfConflicts ? ' · self-crossing conflicts ' + w.selfConflicts : ''}\na = ${S.a.toFixed(3)} model units (${data.meta.a ? 'from the file' : 'median edge'})${flips ? ` · ${flips} triangles re-oriented` : ''}${flipped ? ' · winding flipped outward' : ''}`;
  $('i-lattice').dataset.stage = w.parityConflicts ? 'warn' : 'ok';
  $('sum-file').textContent = name;
  showScale();
  $('st-model').textContent = `${name} · ${w.nV} cells · ${w.nE} crossings · ${w.strands.length} strands`;
  replan(0);
  status('');
}

// --- plan -------------------------------------------------------------------------------------------------------
function replan(step = S.step, tick = null) {
  const w = S.w; if (!w) return;
  const plan = planWeave(w, { start: S.rule === 'pick' && S.picked >= 0 ? S.picked : undefined, rule: S.rule === 'pick' ? 'half' : S.rule, strategy: S.strategy, maxLength: maxLength(), overlap: S.overlap, distribution: S.distribution, hold: S.hold, flip: S.flip });
  S.plan = plan; S.selPiece = -1; S.lastCell = -1;
  try { view.setModel(w, plan, lathOpts(), { keepCamera: S.lastW === w }); view.setScale(S.scale); view.setDeactive(S.deactive); }
  catch (err) { console.error(err); status('the view could not be rebuilt: ' + err.message); }   // the History bar must still get the new plan
  S.lastW = w;
  const longest = Math.max(...plan.pieceList.map(p => p.length)), nAdd = plan.steps.filter(s => s.kind === 'add').length, nEmpty = plan.steps.filter(s => s.kind === 'close').length;
  const nLay = plan.steps.filter(s => s.kind === 'lay').length, nLayX = plan.steps.reduce((n, s) => n + (s.kind === 'lay' ? s.nTicks : s.knots.filter(q => q.lay).length), 0);
  const nCont = plan.steps.filter(s => s.kind === 'add' && s.cont).length;
  $('ro-plan').textContent = `start: cell #${plan.start} (${w.boundary[plan.start] ? 'rim' : w.valence[plan.start] + ' sides'}) · ${S.rule === 'pick' && S.picked >= 0 ? 'picked' : START_RULES[S.rule === 'pick' ? 'half' : S.rule].split(':')[0]} · ${ORDER_RULES[S.strategy].split(':')[0]}\n${plan.order.length} cells in the tour (${plan.skipped} woven by their neighbours) · ${plan.steps.length} sub-steps: ${nAdd - nCont} strips added, ${nCont} continued${nLay ? ', ' + nLay + ' only crossing strips in hand' : ''} · ${nLayX} crossings between strips in hand${nEmpty ? ' · ' + nEmpty + ' checkpoints' : ''} · ${w.nE} crossings · ${plan.singular.length} singular cells\n${w.strands.length} strands → ${plan.nPiecesAll} pieces, longest ${cm(longest).toFixed(0)} cm (${(longest / S.a).toFixed(1)} a) · total ${cm(plan.totalLen).toFixed(0)} cm\nmoves to a cell not touching the last ${plan.jumps} · at most ${plan.maxClips} clips held`;
  $('sum-disc').textContent = `${plan.nPiecesAll} pieces · ${plan.order.length} cells`;
  $('st-pill').textContent = `${plan.order.length} cells · ${plan.steps.length} sub-steps`;
  if (S.rule === 'rim' && !w.boundary[plan.start]) status('no rim on this lattice — started at the most reachable cell'); else status('');
  history.setPlan(plan, Math.min(step, plan.steps.length - 1), tick, { colourOf: (pid) => view.pieceHex(pid), cm });
}

// --- one sub-step (and one crossing of it) -----------------------------------------------------------------------
function onStep(k, tick) {
  const w = S.w, plan = S.plan; if (!plan) return;
  S.step = k; S.tick = tick;
  view.setStep(k, tick);
  $('st-step').textContent = k >= 0 ? describeStep(w, plan, k) : 'nothing woven yet';
  // the camera follows the cell: once per cell, aligned with the strip that closes it
  const st = k >= 0 ? plan.steps[k] : null;
  if (S.follow !== 'off' && st && st.kind !== 'done' && st.cellIdx !== S.lastCell) { S.lastCell = st.cellIdx; view.followCell(st.cell, S.follow, S.follow === 'align' ? cellTangent(plan.steps[st.last]) : null); }
  if (!st) S.lastCell = -1;
}
/** the direction of the strip that closes a cell: its side of the cell (the last add of the cell, else the strip on top
 *  of its last crossing), along its weaving direction */
function cellTangent(st) {
  const w = S.w, plan = S.plan, c = st.cell; let si = -1, i = -1, sign = 1;
  for (let k = st.last; k >= st.first; k--) { const q = plan.steps[k]; if (q.kind === 'add') { si = q.piece.strand; i = q.piece.knots[0]; sign = q.dir; if (q.knots.length) { const pass = w.knotStrands[q.knots[0].e].find(([sj]) => sj === si); if (pass) i = pass[1]; } break; } }
  if (si < 0 && st.knots && st.knots.length) { const q = st.knots[0]; if (q.over >= 0) { si = q.over; i = q.overI; } else { [si, i] = w.knotStrands[q.e][0]; } }
  if (si < 0) return null;
  const side = w.cellSegs[c].find(([t, kk]) => w.segStrand[3 * t + kk] === si);     // the strip's side of the cell
  if (side) {
    const [t, kk] = side, j = w.segIndex[3 * t + kk], s = w.strands[si], K = s.knots.length, e0 = s.knots[j], e1 = s.knots[(j + 1) % K];
    const d = [w.edgeMid[3 * e1] - w.edgeMid[3 * e0], w.edgeMid[3 * e1 + 1] - w.edgeMid[3 * e0 + 1], w.edgeMid[3 * e1 + 2] - w.edgeMid[3 * e0 + 2]], f = view.walkDir(si) * sign;
    return d.map(x => x * f);
  }
  const t = view._walkTangent(si, i); return t.map(x => x * sign);
}
function selectPiece(id) { S.selPiece = S.selPiece === id ? -1 : id; view.selectPiece(S.selPiece); }
/** the scale: the model's bounding box in centimetres, the lattice edge a in centimetres (File → scale) */
function showScale() {
  const w = S.w; if (!w) return;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < w.nV; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], w.V[3 * i + c]); hi[c] = Math.max(hi[c], w.V[3 * i + c]); }
  S.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  $('nb-scale').value = +S.scale.toFixed(3);
  for (const [id, c] of [['nb-w', 0], ['nb-d', 1], ['nb-h', 2]]) $(id).value = +cm(S.size[c]).toFixed(1);
  $('ro-scale').textContent = `lattice edge a = ${cm(S.a).toFixed(1)} cm (${S.a.toFixed(2)} model units × ${S.scale.toFixed(2)})`;
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
  const pieces = plan.pieceList.map(pc => ({ label: pc.label, strand: plan.label[pc.strand], lengthCm: +cm(pc.length).toFixed(1), crossings: pc.knots.map(i => ({ tick: plan.tick(pc.strand, i), edge: w.strands[pc.strand].knots[i], over: w.over(pc.strand, i), step: plan.knotStep[w.strands[pc.strand].knots[i]] })), pickedUp: pc.intro, holdsFrom: pc.holdStep, bends: pc.bends, curvatureDeg: +pc.curvature.toFixed(1), twistDeg: +pc.twist.toFixed(1) }));
  const steps = plan.steps.map(st => ({ step: st.k, kind: st.kind, cell: st.cell, cellIndex: st.cellIdx, sides: st.valence, strip: st.piece ? st.piece.label : undefined, direction: st.dir, closesCell: !!st.closes, crossings: (st.knots || []).map(q => ({ edge: q.e, over: q.pcOver ? q.pcOver.label : null, under: q.pcUnder ? q.pcUnder.label : null, clip: !!q.clip })), clipOff: (st.knots || []).filter(q => q.release).map(q => q.e).concat(st.released || []) }));
  const json = JSON.stringify({ lattice: S.name, a: S.a, scale: S.scale, aCm: cm(S.a), lengthCm: S.lengthCm, overlap: S.overlap, hold: S.hold, distribution: S.distribution, strategy: S.strategy, start: plan.start, cells, crossings, pieces, steps }, null, 1);
  showModal('Export plan', 'cells (ring, step), crossings (step made, clip until, over / under with piece and tick), pieces with their crossings, the sub-steps', json, `${S.name}_plan.json`);
}
function exportTapes() {
  const w = S.w, plan = S.plan; if (!plan) return;
  const rows = ['piece,tick,over_under,partner_piece,partner_tick,cell_a,cell_b,sides_a,sides_b,step'];
  for (const pc of plan.pieceList) for (const i of pc.knots) {
    const e = w.strands[pc.strand].knots[i], [a, b] = w.edges[e], other = w.knotStrands[e].filter(([q, j]) => !(q === pc.strand && j === i))[0];
    rows.push([pc.label, plan.tick(pc.strand, i), plan.rim[e] ? 'rim' : (w.over(pc.strand, i) ? 'over' : 'under'), other ? plan.pieceAt(other[0], other[1]).label : '', other ? plan.tick(other[0], other[1]) : '', a, b, w.valence[a], w.valence[b], plan.knotStep[e] + 1].join(','));
  }
  showModal('Export tapes (CSV)', 'one row per crossing of every piece, in tick order', rows.join('\n'), `${S.name}_tapes.csv`);
}
function showModal(title, hint, text, filename) {
  $('modal-title').textContent = title; $('modal-hint').textContent = hint; $('modal-text').value = text;
  const a = $('modal-download'); a.download = filename; if (a.href) URL.revokeObjectURL(a.href); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  $('modal').hidden = false;
}
window.sp = { exportPlan, exportTapes, state: S, get view() { return view; }, get history() { return history; } };

// --- page --------------------------------------------------------------------------------------------------------
function status(msg) { $('st-msg').textContent = msg || ''; }
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
  const setTheme = (t) => { if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; localStorage.setItem('sp.theme', t); for (const c of $('theme-chips').children) c.classList.toggle('on', c.dataset.theme === t); view?.applyTheme(); if (S.plan) history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm }); };
  $('theme-chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) setTheme(c.dataset.theme); });
  setTheme(localStorage.getItem('sp.theme') || 'auto');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { view?.applyTheme(); });
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
  const og2 = document.createElement('optgroup'); og2.label = 'lattices from TryTriWeave';
  for (const m of MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; og2.appendChild(o); }
  sel.append(og1, og2); sel.value = S.caseId;
  sel.addEventListener('change', () => { S.step = 0; window.history.replaceState(null, '', '#' + sel.value); loadCase(sel.value); });
  const openFile = async (f) => { if (!f) return; try { const d = parseOBJ(await f.text()); if (!d.F.length) throw new Error('no faces'); d.meta.name = d.meta.name || f.name.replace(/\.obj$/i, ''); S.step = 0; setLattice(d, d.meta.name); } catch (err) { status(`could not read ${f.name}: ${err.message}`); } };
  $('file-obj').addEventListener('change', (e) => openFile(e.target.files[0]));
  const vp = $('viewport'); let dragDepth = 0;
  vp.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  vp.addEventListener('dragover', (e) => e.preventDefault());
  vp.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  vp.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; openFile(e.dataTransfer.files[0]); });
  // discretization
  $('sel-start').addEventListener('change', (e) => { S.rule = e.target.value; if (S.rule === 'pick') { if (S.picked < 0) armPick(); else replan(0); } else replan(0); });
  $('btn-pick').addEventListener('click', () => armPick());
  $('sel-order').value = S.strategy; $('sel-order').addEventListener('change', (e) => { S.strategy = e.target.value; saveSettings(); replan(0); });
  const num = (id, key, after) => { const el = $(id); el.value = S[key]; el.addEventListener('change', () => { const v = +el.value; if (Number.isFinite(v)) { S[key] = v; saveSettings(); after(); } }); };
  num('nb-len', 'lengthCm', () => replan()); num('nb-overlap', 'overlap', () => replan()); num('nb-hold', 'hold', () => replan());
  // the scale: × model units, or one of the three sizes of the bounding box in centimetres (the others follow)
  $('nb-scale').addEventListener('change', (e) => setScale(+e.target.value));
  for (const [id, c] of [['nb-w', 0], ['nb-d', 1], ['nb-h', 2]]) $(id).addEventListener('change', (e) => { const v = +e.target.value; if (S.size && S.size[c] > 1e-9 && Number.isFinite(v) && v > 0) setScale(v / S.size[c]); else showScale(); });
  for (const c of $('dist-chips').children) c.classList.toggle('on', c.dataset.dist === S.distribution);
  $('dist-chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; for (const x of $('dist-chips').children) x.classList.toggle('on', x === c); S.distribution = c.dataset.dist; saveSettings(); replan(); });
  $('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
  $('modal-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('modal-text').value); status('copied'); } catch { $('modal-text').select(); } });
  // display
  $('chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; c.classList.toggle('on'); view.setVisible(c.dataset.layer, c.classList.contains('on')); });
  $('sel-lathcol').addEventListener('change', (e) => { view.recolour(e.target.value); history.setPlan(S.plan, S.step, S.tick, { colourOf: (pid) => view.pieceHex(pid), cm }); });
  const slider = (id, out, fmt, cb) => { const el = $(id); el.addEventListener('input', () => { $(out).textContent = fmt(+el.value); }); el.addEventListener('change', () => cb(+el.value)); $(out).textContent = fmt(+el.value); };
  $('sl-lathw').value = S.width; $('sl-latht').value = S.thickness;
  slider('sl-lathw', 'out-lathw', (v) => v.toFixed(2), (v) => { S.width = v; saveSettings(); view.setLaths(lathOpts()); });
  slider('sl-latht', 'out-latht', (v) => v.toFixed(3), (v) => { S.thickness = v; saveSettings(); view.setLaths(lathOpts()); });
  $('sel-deactive').value = S.deactive; $('sel-deactive').addEventListener('change', (e) => { S.deactive = e.target.value; saveSettings(); view.setDeactive(S.deactive); });
  $('ck-flip').addEventListener('change', (e) => { view.sideSign = e.target.checked ? -1 : 1; view.setModel(S.w, S.plan, lathOpts(), { keepCamera: true }); view.setDeactive(S.deactive); view.setStep(S.step, S.tick); });
  $('sel-follow').value = S.follow; $('sel-follow').addEventListener('change', (e) => { S.follow = e.target.value; saveSettings(); S.lastCell = -1; if (S.follow === 'off') view.home(); else if (S.step >= 0 && S.plan) onStep(S.step, S.tick); });
  slider('sl-turn', 'out-turn', (v) => String(v), (v) => view.setTurntable(view.turntable, v));
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
    else if (e.key === 'Escape') { if (S.picking) disarmPick(); if (S.selPiece >= 0) selectPiece(S.selPiece); $('modal').hidden = true; }
  });
  // picking on the view: a cell disc tells about its cell (no jump — Ji's bug 2), a lath selects its piece, the bare
  // surface does nothing (unless a start is being picked)
  const gl = $('gl'); let down = null;
  gl.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  gl.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; } down = null;
    const h = view.pick(e.clientX, e.clientY);
    if (S.picking || e.shiftKey) { if (h && h.kind === 'cell') { S.picked = h.cell; S.rule = 'pick'; $('sel-start').value = 'pick'; disarmPick(); replan(0); } return; }
    if (!h || (h.kind === 'cell' && h.onSurface)) { if (S.selPiece >= 0) selectPiece(S.selPiece); return; }
    if (h.kind === 'cell') { const plan = S.plan, v = h.cell, k = plan.stepOf[v], ci = plan.cellIdx[v]; status(`${S.w.boundary[v] ? 'rim cell' : S.w.valence[v] + '-sided cell'} #${v}${ci >= 0 ? ` · cell ${ci + 1} of the tour` : ' · woven by its neighbours'} · closed at sub-step ${k + 1}`); }
    else if (h.kind === 'lath') selectPiece(h.piece);
  });
}
function armPick() { S.picking = true; $('gl').classList.add('arm'); $('pickhint').hidden = false; $('btn-pick').classList.add('on'); }
function disarmPick() { S.picking = false; $('gl').classList.remove('arm'); $('pickhint').hidden = true; $('btn-pick').classList.remove('on'); if (S.rule === 'pick' && S.picked < 0) { S.rule = 'half'; $('sel-start').value = 'half'; } }

function main() {
  view = new View($('gl')); view.attachNav($('navcube'));
  history = new History({ onStep, onHover: (cell) => view.setHover(cell), onReverse: (st) => { if (S.flip.has(st.flipKey)) S.flip.delete(st.flipKey); else S.flip.add(st.flipKey); replan(S.step, null); } });
  initLayout(); initTips(); initControls();
  const fromHash = () => { const hash = decodeURIComponent(location.hash.slice(1)); return hash && (SYNTHETIC[hash] || MODELS.some(m => m.id === hash)) ? hash : null; };
  const h0 = fromHash(); if (h0) { S.caseId = h0; $('sel-case').value = h0; }
  loadCase(S.caseId);
  window.addEventListener('hashchange', () => { const h = fromHash(); if (h && h !== S.caseId) { $('sel-case').value = h; S.step = 0; loadCase(h); } });
  const loop = () => { view.render(); requestAnimationFrame(loop); }; loop();
}
main();
