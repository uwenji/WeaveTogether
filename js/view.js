// view.js — the three.js scene of the practice (Z up): the lattice surface (the target shape), its edges, the singular
// cells as labelled discs, the path of the order, the start and the active cell, and the laths as swept rectangular
// sections with real thickness — under laths on the surface, over laths climbing onto them.
// The laths follow a centripetal Catmull-Rom spline through the crossings of their strand (smooth, no gap at a
// crossing, as WeaveSim renders them). Lath states (Ji's notation, Design updates 3–5): the strip being added or
// continued in its vivid colour along its whole length with a thin centre line on its top face (its path), the part
// threaded in this sub-step as a thick bar (passed) and a bold signage arrow at the crossing of the current tick
// (current) — the marks follow the strip over and under; every part woven at the current cell vivid, the colour running
// one step past the crossing; the woven parts of earlier cells in Paul Tol's light scheme; the part of a strip in hand
// that is not woven yet in grey — hanging straight off its outermost woven crossing (the material's own tangent),
// along its future path on the surface, or not at all; at the end everything vivid. A clicked strip gets a dashed
// stroke and everything else is dimmed. Every vertex of the static geometry carries the (fractional) sub-step at
// which its part is laid (s0, both crossings made), at which it is inside the woven extent of its strip (wIn), at
// which its strip is picked up (sIn), at which it goes away (s1), the sub-steps of its two crossings (h0, h1), the
// cells at which those were made (c0, c1, and c2 for the crossing one further beside a crossing) and its piece id, so
// scrubbing is a handful of uniforms; only the strokes and arrows of the sub-step are rebuilt.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FAMILY_HEX, valenceHex } from './colormap.js';
import { NavCube } from './navcube.js';

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const cssColor = (name, fallback) => new THREE.Color(cssVar(name, fallback));
const Z_UP = new THREE.Vector3(0, 0, 1);
const HOME_DIR = new THREE.Vector3(-0.85, -1.15, 0.7).normalize();
const POLE_EPS = 2e-3;
const FAR = 1e6;
const MAX_ACTIVE = 12;                                             // strips of one sub-step the shader can hold
const CROSS_SEC = 0.2;                                             // the crossing section: this much of a segment on either side of a crossing
/** Paul Tol's light qualitative scheme (without its pale grey): the tint of a woven piece. The vivid colour of the strips
 *  of the sub-step is the same hue, darker and more saturated — the dark band of his banded scheme. */
export const LIGHT_HEX = ['#77AADD', '#EE8866', '#EEDD88', '#FFAABB', '#99DDFF', '#44BB99', '#BBCC33', '#AAAA00'];
/** sRGB hex → linear rgb (three's working space: vertex colours and colour uniforms are linear) */
const hex2rgb = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const rgb2hex = (rgb) => '#' + new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).getHexString();
export function vivid(rgb, dark = false) {
  const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), hsl = {}; c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(1, Math.max(0.65, hsl.s * 1.3)), dark ? Math.max(0.5, hsl.l - 0.1) : Math.min(hsl.l, 0.45), THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}
export const LIGHT_RGB = LIGHT_HEX.map(hex2rgb);
const FAMILY_RGB = FAMILY_HEX.map(hex2rgb), FAMILY_LIGHT = FAMILY_RGB.map(rgb => { const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).lerp(new THREE.Color('#ffffff'), 0.55); return [c.r, c.g, c.b]; });
const ATTR = ['s0', 'wIn', 'sIn', 's1', 'pid', 'h0', 'h1', 'c0', 'c1', 'c2'];   // c2: the cell of the crossing one further, on the sub-box beside a crossing (the colour runs one step past it)

/** the step attributes on a material; kind: 'lath' | 'hang' | 'mark' (clip rings) | 'cut' (joint lines) */
function stepify(mat, u, kind) {
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    const decl = ATTR.map(k => `attribute float ${k};`).join('\n') + '\nattribute vec3 color2;\n' + ATTR.map(k => `varying float v_${k};`).join('\n') + '\nvarying vec3 vCol2;';
    const copy = ATTR.map(k => `v_${k} = ${k};`).join(' ') + ' vCol2 = color2;';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + decl).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + copy);
    const head = '#include <common>\n' + ATTR.map(k => `varying float v_${k};`).join('\n') + '\nvarying vec3 vCol2;\nuniform float uStep;\nuniform float uCell;\nuniform float uFinal;\nuniform float uActSurface;\nuniform float uDeactive;\nuniform float uActive[' + MAX_ACTIVE + '];\nuniform float uSel;\nuniform vec3 uGrey;\nuniform vec3 uCanvas;';
    const act = 'bool isAct = false; for (int i = 0; i < ' + MAX_ACTIVE + '; i++) if (abs(uActive[i] - v_pid) < 0.5) isAct = true;';
    const dim = 'if (uSel >= 0.0 && abs(uSel - v_pid) > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uCanvas, 0.62);';
    let test, colour = '';
    if (kind === 'lath') {
      test = [act, 'if (uStep < v_sIn || uStep >= v_s1) discard;',
        'if (uDeactive > 1.5 && uStep < v_s0) discard;',
        'if (uDeactive > 0.5 && uDeactive < 1.5 && uStep < v_wIn && !(isAct && uActSurface > 0.5)) discard;'].join('\n');
      colour = ['bool cur = abs(v_c0 - uCell) < 0.5 || abs(v_c1 - uCell) < 0.5 || abs(v_c2 - uCell) < 0.5;',
        'if (uStep < v_s0) diffuseColor.rgb = isAct ? vCol2 : uGrey;',
        'else if (uFinal > 0.5 || isAct || cur) diffuseColor.rgb = vCol2;', dim].join('\n');
    } else if (kind === 'hang') {
      test = 'if (uDeactive < 0.5 || uDeactive > 1.5 || uStep < v_s0 || uStep >= v_s1) discard;';
      colour = act + '\ndiffuseColor.rgb = isAct ? vCol2 : uGrey;\n' + dim;
    } else if (kind === 'cut') {
      test = 'if (uStep >= v_s1) discard;\nif (uDeactive < 0.5) { if (uStep < v_sIn) discard; } else if (uStep < v_s0) discard;';
      colour = dim;
    } else {
      test = 'if (uStep < v_s0 || uStep >= v_s1) discard;';
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', head).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + test);
    if (colour) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + colour);
  };
  mat.customProgramCacheKey = () => 'sp5-' + kind + '-' + mat.type;
  return mat;
}

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(38, 1, 0.01, 1000); this.persp.up.set(0, 0, 1);
    this.orthoH = 1;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000); this.ortho.up.set(0, 0, 1);
    this.camera = this.persp; this.projection = 'persp';
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.rotateSpeed = 0.7;
    this.clock = new THREE.Clock(); this.anim = null; this.turntable = false; this.turnSpeed = 12;
    canvas.addEventListener('pointerdown', () => { this.anim = null; });
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9a9ea8, 1.45); this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.35); this.key.position.set(-1.2, -1.6, 2.2); this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.7); this.fill.position.set(1.5, 0.8, 0.6); this.scene.add(this.fill);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.layers = {};
    this.visible = { surface: true, lattice: false, cells: true, path: true, active: true, laths: true, hang: true, clips: true, cuts: true, stroke: true, hover: true, selection: true, bbox: false };
    this.scale = 1;                                                 // centimetres per model unit (the bounding-box labels)
    this.u = { uStep: { value: FAR - 1 }, uCell: { value: -1 }, uFinal: { value: 0 }, uActSurface: { value: 0 }, uDeactive: { value: 1 }, uActive: { value: new Float32Array(MAX_ACTIVE).fill(-1) }, uSel: { value: -1 }, uGrey: { value: new THREE.Vector3(0.6, 0.6, 0.59) }, uCanvas: { value: new THREE.Vector3(0.9, 0.9, 0.9) } };
    this.colouring = 'piece'; this.step = FAR - 1; this.tick = -1; this.sideSign = 1; this.selPiece = -1; this.follow = 'off';
    this.raycaster = new THREE.Raycaster();
    this.labelCache = new Map();
    this.applyTheme();
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(canvas.parentElement);
    this.resize();
  }

  applyTheme() {
    this.dark = cssVar('--scheme', 'light') === 'dark';
    this.renderer.setClearColor(cssColor('--canvas', '#f6f6f5'), 1);
    this.colCanvas = cssColor('--canvas', '#f6f6f5');
    this.colMesh = cssColor('--mesh', '#e0e0de'); this.colEdge = cssColor('--mesh-edge', '#b8b8b5'); this.colKnot = cssColor('--knot', '#404045');
    this.colAccent = cssColor('--accent', '#2973c7'); this.colFg = cssColor('--fg', '#212324'); this.colWarn = cssColor('--warn', '#c26a1c'); this.colDim = cssColor('--dim', '#70737a');
    this.u.uCanvas.value.set(this.colCanvas.r, this.colCanvas.g, this.colCanvas.b);
    const grey = new THREE.Color(this.dark ? '#5e6066' : '#c6c6c3'); this.u.uGrey.value.set(grey.r, grey.g, grey.b);
    if (this.layers.surface) this.layers.surface.material.color.copy(this.colMesh);
    if (this.layers.lattice) this.layers.lattice.material.color.copy(this.colKnot);
    if (this.layers.clips) this.layers.clips.material.color.copy(this.colWarn);
    if (this.layers.cuts) this.layers.cuts.material.color.copy(this.colFg);
    this.labelCache.clear();
    if (this.nav) this.nav.applyTheme();
    if (this.w) { this.recolour(); this.setStep(this.step, this.tick); }
  }

  resize() {
    const el = this.canvas.parentElement, w = el.clientWidth || 800, h = el.clientHeight || 600, aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = aspect; this.persp.updateProjectionMatrix();
    this.ortho.left = -this.orthoH * aspect; this.ortho.right = this.orthoH * aspect; this.ortho.top = this.orthoH; this.ortho.bottom = -this.orthoH; this.ortho.updateProjectionMatrix();
    if (this.nav) this.nav.resize();
  }

  render() {
    const dt = Math.min(this.clock.getDelta(), 0.5);
    this._stepAnim();
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.nav) this.nav.render(this.camera, this.controls.target);
  }

  // --- navigation (as TryTriWeave) ---------------------------------------------------------------------------------
  attachNav(canvas) {
    this.nav = new NavCube(canvas, {
      onPick: (dir) => this.lookFrom(dir),
      onDrag: (dx, dy) => { const h = this.canvas.clientHeight || 600, k = 2 * Math.PI * this.controls.rotateSpeed / h; this.controls._rotateLeft(k * dx); this.controls._rotateUp(k * dy); },
    });
  }
  viewDir() { const d = this.camera.position.clone().sub(this.controls.target); return d.lengthSq() > 1e-18 ? d.normalize() : HOME_DIR.clone(); }
  viewDist() { return this.camera.position.distanceTo(this.controls.target); }
  centre() { return this.center ? this.center.clone() : new THREE.Vector3(); }
  fitDistance() { const d = this.bboxSize || 10, aspect = this.persp.aspect || 1; return Math.max(1.59 * d, 1.5 * d / aspect); }
  fitZoom() { const hh = this.fitDistance() * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)); return this.orthoH / hh; }
  lookFrom(dir, opts = {}) {
    const d = (dir.isVector3 ? dir.clone() : new THREE.Vector3().fromArray(dir)).normalize();
    const up1 = opts.up ? opts.up.clone().normalize() : this.camera.up.clone();
    if (1 - Math.abs(d.dot(up1)) < 1e-6) {                        // never exactly along the up axis (OrbitControls' pole)
      const t = opts.tiltFrom && Math.abs(opts.tiltFrom.dot(up1)) < 1 - 1e-9 ? opts.tiltFrom.clone().addScaledVector(up1, -opts.tiltFrom.dot(up1)).normalize() : new THREE.Vector3().crossVectors(up1, Math.abs(up1.z) < 0.9 ? Z_UP : new THREE.Vector3(0, 1, 0)).normalize();
      d.copy(up1).multiplyScalar(Math.sign(d.dot(up1)) || 1).addScaledVector(t, POLE_EPS).normalize();
    }
    this.anim = { t0: performance.now(), ms: opts.ms ?? 450, dir0: this.viewDir(), dir1: d, dist0: this.viewDist(), dist1: opts.dist ?? this.viewDist(), up0: this.camera.up.clone(), up1,
      tg0: this.controls.target.clone(), tg1: opts.target ? opts.target.clone() : this.controls.target.clone(), zoom0: this.ortho.zoom, zoom1: opts.zoom ?? this.ortho.zoom, smooth: !!opts.smooth };
    if (opts.ms === 0) this._stepAnim(performance.now() + 1);
  }
  _stepAnim(now = performance.now()) {
    const a = this.anim; if (!a) return;
    const t = Math.min(1, (now - a.t0) / Math.max(a.ms, 1));
    const e = a.smooth ? t * t * t * (t * (6 * t - 15) + 10) : (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // smootherstep: no sudden acceleration
    const dir = slerp(a.dir0, a.dir1, e), dist = a.dist0 + (a.dist1 - a.dist0) * e;
    if (a.up0.distanceToSquared(a.up1) > 1e-12) this.setUp(slerp(a.up0, a.up1, e));
    this.controls.target.copy(a.tg0).lerp(a.tg1, e);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    if (this.projection === 'ortho') { this.ortho.zoom = a.zoom0 + (a.zoom1 - a.zoom0) * e; this.ortho.updateProjectionMatrix(); }
    if (t >= 1) this.anim = null;
  }
  /** the up axis of the view (both cameras and the orbit): Z for the world, the cell's normal when following a cell */
  setUp(v) {
    const u = v.clone().normalize();
    for (const cam of [this.persp, this.ortho]) cam.up.copy(u);
    this.controls._quat.setFromUnitVectors(u, new THREE.Vector3(0, 1, 0)); this.controls._quatInverse.copy(this.controls._quat).invert();
  }
  /** follow the active cell. 'pan': the target moves, the direction stays. 'align': the view turns so that the screen's
   *  X axis runs along `tangent` (the strip that closes the cell) and the cell's normal is the screen's up — the user's
   *  tilt and distance stay, and the orbit still works around the cell. Smooth, slower for longer moves. */
  followCell(cell, mode = 'pan', tangent = null) {
    const w = this.w; if (!w) return;
    const p = new THREE.Vector3(w.V[3 * cell], w.V[3 * cell + 1], w.V[3 * cell + 2]), d0 = this.viewDir(), dist = this.viewDist();
    const far = p.distanceTo(this.controls.target) / Math.max(this.opts.a, 1e-9), ms = Math.round(450 + 350 * Math.min(1, far / 4));
    if (mode === 'pan') { this._alignUp = null; this.lookFrom(d0, { dist, target: p, ms, tiltFrom: d0, up: Z_UP, smooth: true }); return; }
    const n = new THREE.Vector3(w.N[3 * cell], w.N[3 * cell + 1], w.N[3 * cell + 2]).multiplyScalar(this.sideSign).normalize();
    let t = tangent ? new THREE.Vector3().fromArray(tangent) : new THREE.Vector3().crossVectors(this.camera.up, n);
    t.addScaledVector(n, -t.dot(n)); if (t.lengthSq() < 1e-9) t = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? Z_UP : new THREE.Vector3(1, 0, 0)); t.normalize();
    const b = new THREE.Vector3().crossVectors(n, t).normalize();
    // the tilt off the normal: the user's own when the view is still the one we aligned last time (the orbit keeps the
    // up axis, so a tilt the user chose by orbiting survives); a comfortable 34° when we come from a world-up view
    let phi = 0.6;
    if (this._alignUp) {
      const upRef = this.anim ? this.anim.up1 : this.camera.up, dirRef = this.anim ? this.anim.dir1 : d0;
      if (upRef.distanceToSquared(this._alignUp) < 1e-6) phi = Math.acos(Math.max(-1, Math.min(1, dirRef.dot(upRef))));
    }
    phi = Math.min(1.2, Math.max(0.2, phi));                                                  // 11°–69°
    // the woven part of the surface at the top of the screen, the new strip at the bottom (eye → hands → strip → object):
    // the crossings of the fan already made lie on the woven side, the ones still to make on the other; when that says
    // nothing (they lie along the strip) fall back to all the cells built so far, then to the side the view is on now
    let sgn = d0.dot(b) >= 0 ? 1 : -1;
    const plan = this.plan, ci = plan ? plan.cellIdx[cell] : -1;
    if (plan && ci > 0) {
      const side = new THREE.Vector3(), q = new THREE.Vector3();
      for (const e of plan.fan[cell]) {
        q.set(w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]).sub(p);
        side.addScaledVector(q, plan.knotCell[e] < ci ? 1 : -1);
      }
      side.addScaledVector(n, -side.dot(n));
      let sb = side.dot(b);
      if (Math.abs(sb) < 0.25 * side.length()) {
        const cen = new THREE.Vector3();
        for (let k = 0; k < ci; k++) { const v = plan.order[k]; cen.x += w.V[3 * v]; cen.y += w.V[3 * v + 1]; cen.z += w.V[3 * v + 2]; }
        cen.divideScalar(ci).sub(p); cen.addScaledVector(n, -cen.dot(n));
        sb = cen.length() > 1e-9 ? cen.dot(b) : 0;
      }
      if (Math.abs(sb) > 1e-9) sgn = sb > 0 ? -1 : 1;
    }
    const d1 = n.clone().multiplyScalar(Math.cos(phi)).addScaledVector(b, sgn * Math.sin(phi)).normalize();
    this._alignUp = n.clone();
    this.lookFrom(d1, { dist, target: p, ms, up: n, smooth: true });
  }
  orbitBy(dAz, dPol) {
    const d0 = this.viewDir(), az = Math.atan2(d0.y, d0.x) + dAz;
    const pol = Math.min(Math.PI - POLE_EPS, Math.max(POLE_EPS, Math.acos(Math.max(-1, Math.min(1, d0.z))) + dPol));
    this.lookFrom(new THREE.Vector3(Math.sin(pol) * Math.cos(az), Math.sin(pol) * Math.sin(az), Math.cos(pol)), { tiltFrom: d0 });
  }
  home(ms = 500) { this._alignUp = null; this.lookFrom(HOME_DIR, { dist: this.fitDistance(), target: this.centre(), zoom: this.fitZoom(), ms, up: Z_UP }); }
  fit(ms = 400) { this.lookFrom(this.viewDir(), { dist: this.fitDistance(), target: this.centre(), zoom: this.fitZoom(), ms, tiltFrom: this.viewDir() }); }
  /** pan the view to a cell: the target moves, the direction and the distance stay */
  panToCell(v) { this.followCell(v, 'pan'); }
  setTurntable(on, degPerSec = this.turnSpeed) { this.turntable = !!on; this.turnSpeed = degPerSec; this.controls.autoRotate = this.turntable; this.controls.autoRotateSpeed = degPerSec / 6; }
  setProjection(kind) {
    if (kind === this.projection) return;
    const dir = this.viewDir(), tg = this.controls.target.clone(), tanHalf = Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    this.anim = null;
    if (kind === 'ortho') { const hh = this.viewDist() * tanHalf; this.ortho.zoom = this.orthoH / hh; this.ortho.position.copy(this.persp.position); this.ortho.updateProjectionMatrix(); this.camera = this.ortho; }
    else { const hh = this.orthoH / this.ortho.zoom; this.persp.position.copy(tg).addScaledVector(dir, hh / tanHalf); this.camera = this.persp; }
    this.projection = kind; this.controls.object = this.camera; this.camera.lookAt(tg); this.controls.update();
  }

  _setLayer(name, obj) {
    if (this.layers[name]) { this.group.remove(this.layers[name]); disposeObject(this.layers[name]); }
    this.layers[name] = obj;
    if (obj) { obj.visible = !!this.visible[name]; this.group.add(obj); }
  }
  setVisible(name, on) {
    this.visible[name] = on; if (this.layers[name]) this.layers[name].visible = on;
    if (name === 'laths') { this.visible.hang = on; if (this.layers.hang) this.layers.hang.visible = on; }
    if (name === 'path') this.setPath();
    if (name === 'bbox' && on && !this.layers.bbox) this.setBBox();
  }
  setStrokeVisible(on) { this.setVisible('stroke', on); }
  /** centimetres per model unit: relabels the bounding box */
  setScale(cmPerUnit) { this.scale = cmPerUnit; if (this.w) this.setBBox(); }

  // --- the model ---------------------------------------------------------------------------------------------------
  setModel(w, plan, opts, more = {}) {
    this.w = w; this.plan = plan; this.opts = { ...opts }; this.selPiece = -1; this.u.uSel.value = -1;
    for (const k of Object.keys(this.layers)) this._setLayer(k, null);
    const V = w.V, n = w.nV, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], V[3 * i + c]); hi[c] = Math.max(hi[c], V[3 * i + c]); }
    this.lo = lo; this.hi = hi;
    this.bboxSize = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-9);
    this.center = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    this.singularSet = new Set(plan.singular.map(s => s.cell));
    const a = opts.a;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(V), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(w.F), 1));
    g.computeVertexNormals();
    const surf = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: this.colMesh, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    surf.userData.kind = 'surface'; surf.renderOrder = -1; this.surface = surf;
    this._setLayer('surface', surf);
    const segs = new Float32Array(w.nE * 6), lift = 0.04 * a;
    for (let e = 0; e < w.nE; e++) { const [p, q] = w.edges[e]; for (const [m, v] of [[0, p], [3, q]]) for (let c = 0; c < 3; c++) segs[6 * e + m + c] = V[3 * v + c] + this.sideSign * lift * w.N[3 * v + c]; }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(segs, 3));
    this._setLayer('lattice', new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: this.colKnot, transparent: true, opacity: 0.55 })));
    this.setLaths();
    this.setBBox();
    for (const cam of [this.persp, this.ortho]) { cam.near = this.bboxSize * 0.002; cam.far = this.bboxSize * 40; cam.updateProjectionMatrix(); }
    if (!more.keepCamera) this.home(0);
  }

  lifted(v, k) { const w = this.w, s = k * this.sideSign; return [w.V[3 * v] + s * w.N[3 * v], w.V[3 * v + 1] + s * w.N[3 * v + 1], w.V[3 * v + 2] + s * w.N[3 * v + 2]]; }

  // --- the weaver's walk along a strand (as the planner: closed strands start at `offset`, open ones may be reversed) -
  /** original segment index of weaver-segment q, or −1 past an open strand's end */
  walkSeg(si, q) { const s = this.w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1; const j = s.closed ? (((q + this.plan.offset[si]) % K) + K) % K : (this.plan.reversed[si] ? K - 2 - q : q); return (j >= 0 && j < nseg) ? j : -1; }
  /** original knot index of weaver-knot q, or −1 */
  walkKnot(si, q) { const s = this.w.strands[si], K = s.knots.length; const i = s.closed ? (((q + this.plan.offset[si]) % K) + K) % K : (this.plan.reversed[si] ? K - 1 - q : q); return (i >= 0 && i < K) ? i : -1; }
  /** +1 when the walk runs along the original segment direction, −1 on a reversed open strand */
  walkDir(si) { const s = this.w.strands[si]; return (!s.closed && this.plan.reversed[si]) ? -1 : 1; }
  segLenOf(si, j) { if (j < 0) return 0; const [t, k] = this.w.strands[si].segs[j]; return this.w.segLen[3 * t + k]; }
  /** a segment is laid once both its crossings are made */
  segLaid(si, j, step) { const s = this.w.strands[si], K = s.knots.length; return this.plan.knotStep[s.knots[j]] <= step && this.plan.knotStep[s.knots[(j + 1) % K]] <= step; }

  // --- laths ----------------------------------------------------------------------------------------------------
  _knotFrame(si, i) {
    const w = this.w, plan = this.plan, s = w.strands[si], e = s.knots[i], sg = this.sideSign, thk = this.opts.thickness, lift = 0.015 * this.opts.a;
    const over = sg > 0 ? w.over(si, i) : !w.over(si, i);
    const h = (over && !plan.rim[e]) ? lift + 1.5 * thk : lift + 0.5 * thk;
    return { p: [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]], n: [sg * w.edgeNrm[3 * e], sg * w.edgeNrm[3 * e + 1], sg * w.edgeNrm[3 * e + 2]], h, e };
  }
  /** the centreline of a strand: a centripetal Catmull-Rom spline through its crossings (the lath bends smoothly, and
   *  consecutive segments share their section at the crossing — no gap or notch, as WeaveSim's render), the over /
   *  under height blended along each segment on top of it. `_curveAt(si, j, u, flat)` → the point of original segment
   *  j at u (u may run a little past [0, 1] into the neighbouring segments). */
  _strandCurve(si) {
    if (!this._curves) this._curves = new Map();
    let C = this._curves.get(si); if (C) return C;
    const s = this.w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, P = [], N = [], H = [];
    for (let i = 0; i < K; i++) { const F = this._knotFrame(si, i); P.push(F.p); N.push(F.n); H.push(F.h); }
    const at = (i) => s.closed ? P[((i % K) + K) % K] : (i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1], 2 * P[0][2] - P[1][2]] : i >= K ? [2 * P[K - 1][0] - P[K - 2][0], 2 * P[K - 1][1] - P[K - 2][1], 2 * P[K - 1][2] - P[K - 2][2]] : P[i]);
    const knot = (p, q, t) => t + Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));   // centripetal (α = ½)
    const spline = (j, u) => {                                    // the point of segment j at u ∈ [0, 1]
      const P0 = at(j - 1), P1 = at(j), P2 = at(j + 1), P3 = at(j + 2);
      const t0 = 0, t1 = knot(P0, P1, t0), t2 = knot(P1, P2, t1), t3 = knot(P2, P3, t2);
      if (t1 - t0 < 1e-9 || t2 - t1 < 1e-9 || t3 - t2 < 1e-9) return lerp3(P1, P2, u);
      const t = t1 + u * (t2 - t1), mix = (a, b, wa, wb) => [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
      const A1 = mix(P0, P1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0)), A2 = mix(P1, P2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)), A3 = mix(P2, P3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const B1 = mix(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0)), B2 = mix(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      return mix(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
    };
    const point = (j, u, flat) => {                                // segment j at u, u allowed a little outside [0, 1]
      if (u < 0) { if (j > 0 || s.closed) return point(s.closed ? (j - 1 + K) % K : j - 1, u + 1, flat); u = 0; }
      if (u > 1) { if (j + 1 < nseg || s.closed) return point(s.closed ? (j + 1) % K : j + 1, u - 1, flat); u = 1; }
      const j1 = (j + 1) % K, nn = nrm3(lerp3(N[j], N[j1], u)), hh = flat ? 0 : H[j] + (H[j1] - H[j]) * (1 - Math.cos(Math.PI * u)) / 2, p = spline(j, u);
      return { p: [p[0] + hh * nn[0], p[1] + hh * nn[1], p[2] + hh * nn[2]], n: nn };
    };
    C = { nseg, point };
    this._curves.set(si, C); return C;
  }
  _curveAt(si, j, u, flat = false) {
    const C = this._strandCurve(si), eps = 0.02, q = C.point(j, u, flat), a = C.point(j, u - eps, flat), b = C.point(j, u + eps, flat);
    let t = sub3(b.p, a.p); if (Math.hypot(...t) < 1e-12) t = sub3(C.point(j, 1, flat).p, C.point(j, 0, flat).p);
    return { p: q.p, n: q.n, t: nrm3(t) };
  }
  /** where a hanging stub leaves piece pc beyond its knot m (fwd: along the walk, else back): past the crossing section
   *  (the laid box beside the crossing) along the curve's tangent there → {c0, n, t, used} (used: strip length taken) */
  _stubStart(si, pc, m, fwd) {
    const dir = this.walkDir(si), i = pc.knots[m], j = this.walkSeg(si, pc.q0 + (fwd ? m : m - 1));
    if (j < 0) { const F0 = this._knotFrame(si, i); return { c0: [F0.p[0] + F0.h * F0.n[0], F0.p[1] + F0.h * F0.n[1], F0.p[2] + F0.h * F0.n[2]], n: F0.n, t: this._knotTangent(si, i).map(x => (fwd ? 1 : -1) * dir * x), used: 0 }; }
    const fromA = (fwd ? dir > 0 : dir < 0), u = fromA ? CROSS_SEC : 1 - CROSS_SEC, c = this._curveAt(si, j, u, false);
    return { c0: c.p, n: c.n, t: fromA ? c.t : neg3(c.t), used: CROSS_SEC * this.segLenOf(si, j) };
  }
  /** the tangent of strand si at knot i along the original index direction (unit) */
  _knotTangent(si, i) {
    const s = this.w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1;
    return (i < nseg ? this._curveAt(si, i, 0) : this._curveAt(si, i - 1, 1)).t;
  }
  /** sections along original segment j from u = uA to uB; `raise` a number or a function of u; `flat` ignores over/under */
  _segSections(si, j, SUB = 4, raise = 0, flat = false, uA = 0, uB = 1) {
    const secs = [];
    for (let q = 0; q <= SUB; q++) {
      const u = uA + (uB - uA) * q / SUB, r = typeof raise === 'function' ? raise(u) : raise, c = this._curveAt(si, j, u, flat);
      secs.push({ p: [c.p[0] + r * c.n[0], c.p[1] + r * c.n[1], c.p[2] + r * c.n[2]], n: c.n, t: c.t });
    }
    return secs;
  }
  /** builds the laths, the hanging remainders, the clip rings and the joint lines for the whole weave */
  setLaths(opts = {}) {
    Object.assign(this.opts, opts);
    const w = this.w, plan = this.plan; if (!w || !plan) return;
    const a = this.opts.a, width = this.opts.width, thk = this.opts.thickness, lift = 0.015 * a;
    const mkD = () => { const D = { pos: [], nrm: [], col: [], col2: [], idx: [], faceStrand: [], facePiece: [], vertStrand: [], vertPiece: [] }; for (const k of ATTR) D[k] = []; return D; };
    const L = mkD(), H = mkD(), C = mkD(), X = mkD();              // laths, hanging remainders, clip rings, joint lines
    const NONE = { s0: 0, wIn: 0, sIn: 0, s1: FAR, h0: -1, h1: -1, c0: -1, c1: -1, c2: -1 };
    this._curves = null;                                           // the strand curves follow the lath side
    const stepCell = (kStep) => kStep >= 0 && kStep < plan.steps.length ? plan.steps[Math.floor(kStep)].cellIdx : -1;   // the cell at which a crossing is made
    const push = (D, p, nn, si, pid, at) => { D.pos.push(...p); D.nrm.push(...nn); D.col.push(0, 0, 0); D.col2.push(0, 0, 0); for (const k of ATTR) D[k].push(k === 'pid' ? pid : at[k]); D.vertStrand.push(si); D.vertPiece.push(pid); };
    const sweep = (D, secs, si, pid, at0, wd, th, atOf = null) => {   // atOf(i): the attributes of the i-th box, else `at`
      const corner = (s, dw, dh) => { const b = nrm3(cross3(s.n, s.t)); return [s.p[0] + dw * b[0] + dh * s.n[0], s.p[1] + dw * b[1] + dh * s.n[1], s.p[2] + dw * b[2] + dh * s.n[2]]; };
      for (let i = 0; i + 1 < secs.length; i++) {
        const A = secs[i], B = secs[i + 1], bA = nrm3(cross3(A.n, A.t)), bB = nrm3(cross3(B.n, B.t)), at = atOf ? atOf(i) : at0;
        const faces = [{ nA: A.n, nB: B.n, q: [[-1, 1], [1, 1]] }, { nA: neg3(A.n), nB: neg3(B.n), q: [[1, -1], [-1, -1]] }, { nA: bA, nB: bB, q: [[1, 1], [1, -1]] }, { nA: neg3(bA), nB: neg3(bB), q: [[-1, -1], [-1, 1]] }];
        for (const f of faces) {
          const v0 = D.pos.length / 3;
          const c = [corner(A, f.q[0][0] * wd / 2, f.q[0][1] * th / 2), corner(A, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[0][0] * wd / 2, f.q[0][1] * th / 2)];
          const nn = [f.nA, f.nA, f.nB, f.nB];
          for (let k = 0; k < 4; k++) push(D, c[k], nn[k], si, pid, at);
          D.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2); D.faceStrand.push(si, si); D.facePiece.push(pid, pid);
        }
      }
      // the two ends
      for (const [S, flip, at] of [[secs[0], -1, atOf ? atOf(0) : at0], [secs[secs.length - 1], 1, atOf ? atOf(secs.length - 2) : at0]]) {
        const v0 = D.pos.length / 3, nn = flip < 0 ? neg3(S.t) : S.t;
        const c = [corner(S, -wd / 2, -th / 2), corner(S, wd / 2, -th / 2), corner(S, wd / 2, th / 2), corner(S, -wd / 2, th / 2)];
        for (let k = 0; k < 4; k++) push(D, c[k], nn, si, pid, at);
        if (flip < 0) D.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); else D.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        D.faceStrand.push(si, si); D.facePiece.push(pid, pid);
      }
    };
    const stubs = [], cutsAt = [];
    w.strands.forEach((s, si) => {
      const K = s.knots.length, nseg = s.closed ? K : K - 1; if (nseg < 1) return;
      const P = plan.pieces[si], dir = this.walkDir(si), cover = new Map();   // original segment index → the parts of pieces on it
      for (const pc of P.list) {
        const n = pc.knots.length, kStep = pc.knots.map(i => plan.knotStep[s.knots[i]]);
        const preMin = new Array(n), sufMin = new Array(n);
        for (let m = 0; m < n; m++) preMin[m] = Math.min(kStep[m], m ? preMin[m - 1] : FAR);
        for (let m = n - 1; m >= 0; m--) sufMin[m] = Math.min(kStep[m], m + 1 < n ? sufMin[m + 1] : FAR);
        pc.kStep = kStep;
        // the physical extent of the piece: from the middle of the segment before its first crossing to the middle of
        // the one after its last; the parts are kept by original segment for the stacking at the joints
        for (let q = pc.q0 - 1; q <= pc.q1; q++) {
          const j = this.walkSeg(si, q); if (j < 0) continue;
          const tail = q === pc.q0 - 1, head = q === pc.q1, m = q - pc.q0;
          let uA = tail ? 0.5 : 0, uB = head ? 0.5 : 1; if (dir < 0) { const t = uA; uA = 1 - uB; uB = 1 - t; }
          const h0 = tail ? -1 : kStep[m], h1 = head ? -1 : kStep[m + 1];
          const at = { s0: tail ? kStep[0] : head ? kStep[n - 1] : Math.max(h0, h1), wIn: tail ? kStep[0] : head ? kStep[n - 1] : Math.max(preMin[m], sufMin[m + 1]), sIn: pc.intro, s1: FAR, h0, h1,
            c0: stepCell(tail ? kStep[0] : head ? kStep[n - 1] : h0), c1: stepCell(tail ? kStep[0] : head ? kStep[n - 1] : h1), c2: -1 };
          if (dir < 0) { const t = at.h0; at.h0 = at.h1; at.h1 = t; const u = at.c0; at.c0 = at.c1; at.c1 = u; }
          // the cells of the crossings one further along the strand, for the box beside each crossing of the segment
          const jPrev = s.closed ? (j - 1 + K) % K : j - 1, jNext2 = s.closed ? (j + 2) % K : j + 2;
          const cPrev = jPrev >= 0 ? stepCell(plan.knotStep[s.knots[jPrev]]) : -1, cNext = jNext2 < K ? stepCell(plan.knotStep[s.knots[jNext2]]) : -1;
          if (!cover.has(j)) cover.set(j, []);
          cover.get(j).push({ pc, uA, uB, at, partial: tail || head, cPrev, cNext });
        }
        // the hanging remainder: from the outermost woven crossing straight on, as long as what is left of the piece
        const halfAfter = this.segLenOf(si, this.walkSeg(si, pc.q1)) / 2, halfBefore = this.segLenOf(si, this.walkSeg(si, pc.q0 - 1)) / 2;
        const stubFrom = (m, fwd) => this._stubStart(si, pc, m, fwd);
        for (let m = 0; m < n; m++) {
          if (m + 1 < n && sufMin[m + 1] > kStep[m]) {
            let rest = halfAfter; for (let q = m; q + 1 < n; q++) rest += this.segLenOf(si, this.walkSeg(si, pc.q0 + q));
            const f = stubFrom(m, true); rest -= f.used;
            if (rest > 0.05 * a) stubs.push({ si, pc, c0: f.c0, nn: f.n, t: f.t, rest, s0: kStep[m], s1: sufMin[m + 1] });
          }
          if (m > 0 && preMin[m - 1] > kStep[m]) {
            let rest = halfBefore; for (let q = 0; q < m; q++) rest += this.segLenOf(si, this.walkSeg(si, pc.q0 + q));
            const f = stubFrom(m, false); rest -= f.used;
            if (rest > 0.05 * a) stubs.push({ si, pc, c0: f.c0, nn: f.n, t: f.t, rest, s0: kStep[m], s1: preMin[m - 1] });
          }
        }
        // a strip picked up before any of its crossings is made (the first strip of the weave) hangs straight through
        // the place of the crossing it will make first, as long as itself — not on the surface (Design update 6)
        { let mMin = 0; for (let m = 1; m < n; m++) if (kStep[m] < kStep[mMin]) mMin = m;
          if (kStep[mMin] > pc.intro) {
            const F0 = this._knotFrame(si, pc.knots[mMin]), c0 = [F0.p[0] + F0.h * F0.n[0], F0.p[1] + F0.h * F0.n[1], F0.p[2] + F0.h * F0.n[2]], t = this._knotTangent(si, pc.knots[mMin]).map(x => x * dir);
            const after = pc.length - pc.arcOf(mMin), before = pc.arcOf(mMin);
            if (after > 0.05 * a) stubs.push({ si, pc, c0, nn: F0.n, t, rest: after, s0: pc.intro, s1: kStep[mMin] });
            if (before > 0.05 * a) stubs.push({ si, pc, c0, nn: F0.n, t: neg3(t), rest: before, s0: pc.intro, s1: kStep[mMin] });
          } }
        // the joint lines: the end of a piece with a next one, the start of a piece with a previous one
        if (P.nPieces > 1 && (s.closed || pc.p < P.nPieces - 1)) cutsAt.push({ si, pc, j: this.walkSeg(si, pc.q1), s0: kStep[n - 1] });
        if (P.nPieces > 1 && (s.closed || pc.p > 0)) cutsAt.push({ si, pc, j: this.walkSeg(si, pc.q0 - 1), s0: kStep[0] });
      }
      // sweep the parts: the piece picked up later lies on top of the one already there, a little narrower, and comes
      // down to the surface past the end of the piece below
      for (const [j, parts] of cover) {
        parts.sort((x, y) => (x.pc.intro - y.pc.intro) || (x.pc.p - y.pc.p));
        parts.forEach((part, k) => {
          const lower = parts.slice(0, k).filter(e => e.uA < part.uB && part.uA < e.uB);
          part.level = lower.length;
          part.raise = lower.length ? (u) => { let r = 0; for (const e of lower) { const d = u < e.uA ? e.uA - u : u > e.uB ? u - e.uB : 0; r += thk * Math.max(0, 1 - d / 0.3); } return r; } : 0;
          const SUB = 10, at = part.at;                                 // ten boxes: the crossing section (a fifth) ends on a box boundary
          // the crossing section: the boxes within a fifth of the segment of a crossing are laid and coloured as soon as
          // that crossing is made, whatever the segment's other crossing — so the over / under at a crossing shows by
          // colour (Design update 6, "more sections for crossing") — and the colour runs one step past it; they are
          // drawn from then on too (a hanging remainder leaves the strip past them), the rest of the segment as before
          const atA = part.uA === 0 ? { ...at, s0: at.h0, wIn: Math.min(at.wIn, at.h0), c2: part.cPrev } : at, atB = part.uB === 1 ? { ...at, s0: at.h1, wIn: Math.min(at.wIn, at.h1), c2: part.cNext } : at;
          const uOf = (i) => part.uA + (part.uB - part.uA) * i / SUB;
          sweep(L, this._segSections(si, j, SUB, part.raise, false, part.uA, part.uB), si, part.pc.id, at, part.level ? 0.72 * width : width, thk, (i) => (part.uA === 0 && uOf(i + 1) <= CROSS_SEC + 1e-9 ? atA : part.uB === 1 && uOf(i) >= 1 - CROSS_SEC - 1e-9 ? atB : at));
        });
      }
      for (const c of cutsAt) {
        if (c.si !== si || c.j < 0) continue;
        const part = (cover.get(c.j) || []).find(e => e.pc === c.pc); if (!part) continue;
        const r = typeof part.raise === 'function' ? part.raise(0.5) : 0, q = this._segSections(si, c.j, 2, r, false, 0.45, 0.55)[1];
        const b = nrm3(cross3(q.n, q.t)), e = Math.max(0.02 * a, 0.08 * width), hw = (part.level ? 0.42 : 0.56) * width, hh = 0.62 * thk;
        const box = []; for (const [dw, dh, dt] of [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) box.push([q.p[0] + dw * hw * b[0] + dh * hh * q.n[0] + dt * e * q.t[0], q.p[1] + dw * hw * b[1] + dh * hh * q.n[1] + dt * e * q.t[1], q.p[2] + dw * hw * b[2] + dh * hh * q.n[2] + dt * e * q.t[2]]);
        const v0 = X.pos.length / 3; for (const p of box) push(X, p, q.n, si, c.pc.id, { ...NONE, s0: c.s0, sIn: c.pc.intro });
        X.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    });
    for (const st of stubs) {
      const { c0, nn, t } = st, c1 = [c0[0] + st.rest * t[0], c0[1] + st.rest * t[1], c0[2] + st.rest * t[2]];
      sweep(H, [{ p: c0, n: nn, t }, { p: c1, n: nn, t }], st.si, st.pc.id, { ...NONE, s0: st.s0, wIn: st.s0, sIn: st.pc.intro, s1: st.s1 }, width, thk);
    }
    // a ring at every crossing while it is a clip point
    for (let e = 0; e < w.nE; e++) {
      if (plan.rim[e] || w.knotStrands[e].length !== 2 || plan.lockStep[e] <= plan.knotStep[e]) continue;
      const [[sa, ia]] = w.knotStrands[e], F0 = this._knotFrame(sa, ia), p = F0.p, nn = F0.n, s = w.strands[sa], K = s.knots.length;
      const t = this._knotTangent(sa, ia);
      const b = nrm3(cross3(nn, t)), r0 = 0.85 * width, r1 = r0 + Math.max(0.12 * width, 0.02 * a), hc = lift + 2.2 * thk + 0.03 * a, cc = [p[0] + hc * nn[0], p[1] + hc * nn[1], p[2] + hc * nn[2]], NSEG = 14;
      const base = C.pos.length / 3, at = { ...NONE, s0: plan.knotStep[e], s1: plan.lockStep[e] };
      for (let k = 0; k < NSEG; k++) {
        const ang = 2 * Math.PI * k / NSEG, ca = Math.cos(ang), sa_ = Math.sin(ang);
        for (const r of [r0, r1]) push(C, [cc[0] + r * (ca * t[0] + sa_ * b[0]), cc[1] + r * (ca * t[1] + sa_ * b[1]), cc[2] + r * (ca * t[2] + sa_ * b[2])], nn, -1, -1, at);
        const v0 = base + 2 * k, v1 = base + 2 * ((k + 1) % NSEG);
        C.idx.push(v0, v1, v0 + 1, v0 + 1, v1, v1 + 1);
      }
    }
    const geo = (d) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(d.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(d.nrm), 3));
      for (const k of ATTR) g.setAttribute(k, new THREE.BufferAttribute(Float32Array.from(d[k]), 1));
      const col = new THREE.BufferAttribute(Float32Array.from(d.col), 3), col2 = new THREE.BufferAttribute(Float32Array.from(d.col2), 3); col.setUsage(THREE.DynamicDrawUsage); col2.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('color', col); g.setAttribute('color2', col2);
      if (d.idx.length) g.setIndex(d.idx);
      return g;
    };
    const lg = geo(L), hg = geo(H);
    const laths = new THREE.Mesh(lg, stepify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.FrontSide }), this.u, 'lath'));
    laths.userData = { kind: 'lath', faceStrand: Int32Array.from(L.faceStrand), facePiece: Int32Array.from(L.facePiece) };
    const hang = new THREE.Mesh(hg, stepify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.FrontSide }), this.u, 'hang'));
    hang.userData = { kind: 'lath', faceStrand: Int32Array.from(H.faceStrand), facePiece: Int32Array.from(H.facePiece) };
    this.lathGeo = lg; this.hangGeo = hg; this.lathVertPiece = Int32Array.from(L.vertPiece); this.hangVertPiece = Int32Array.from(H.vertPiece);
    this._setLayer('laths', laths);
    this._setLayer('hang', hang);
    this._setLayer('clips', new THREE.Mesh(geo(C), stepify(new THREE.MeshBasicMaterial({ color: this.colWarn, side: THREE.DoubleSide }), this.u, 'mark')));
    this._setLayer('cuts', new THREE.Mesh(geo(X), stepify(new THREE.MeshBasicMaterial({ color: this.colFg, side: THREE.DoubleSide }), this.u, 'cut')));
    this.recolour();
    this.setStep(this.step, this.tick);
  }

  /** the light and the vivid colour of a piece: 'piece' (Tol light, one hue per piece) | 'family' (TryTriWeave's three) */
  pieceColours(pid, mode = this.colouring) {
    const plan = this.plan, w = this.w, pc = plan.pieceList[pid], si = pc.strand;
    if (mode === 'family') { const f = w.family[si] >= 0 ? w.family[si] % 3 : 3; return [FAMILY_LIGHT[f], vivid(FAMILY_RGB[f], this.dark)]; }
    const h = (plan.label[si] - 1 + 3 * pc.p) % LIGHT_RGB.length; return [LIGHT_RGB[h], vivid(LIGHT_RGB[h], this.dark)];
  }
  pieceHex(pid, mode = this.colouring) { const [l, v] = this.pieceColours(pid, mode); return [rgb2hex(l), rgb2hex(v)]; }
  recolour(mode = this.colouring) {
    this.colouring = mode;
    if (!this.lathGeo) return;
    for (const [g, vp] of [[this.lathGeo, this.lathVertPiece], [this.hangGeo, this.hangVertPiece]]) {
      const c1 = g.attributes.color.array, c2 = g.attributes.color2.array, cache = new Map();
      for (let i = 0; i < vp.length; i++) {
        let c = cache.get(vp[i]); if (!c) { c = this.pieceColours(vp[i]); cache.set(vp[i], c); }
        c1[3 * i] = c[0][0]; c1[3 * i + 1] = c[0][1]; c1[3 * i + 2] = c[0][2]; c2[3 * i] = c[1][0]; c2[3 * i + 1] = c[1][1]; c2[3 * i + 2] = c[1][2];
      }
      g.attributes.color.needsUpdate = true; g.attributes.color2.needsUpdate = true;
    }
  }

  setDeactive(mode) { this.u.uDeactive.value = mode === 'surface' ? 0 : mode === 'hidden' ? 2 : 1; this.setStroke(this.step); }

  /** show the weave at sub-step `step` (−1: nothing), after its crossing `tick` (−1: none yet; the last tick = whole) */
  setStep(step, tick = null) {
    const plan = this.plan, st = plan && step >= 0 && step < plan.steps.length ? plan.steps[step] : null;
    if (tick === null || tick === undefined) tick = st ? st.nTicks - 1 : -1;
    if (st) tick = Math.min(tick, st.nTicks - 1);                   // a tick kept from another plan (a replan re-shows the step) is clamped
    this.step = step; this.tick = tick;
    if (!plan) return;
    const u = this.u;
    u.uStep.value = step < 0 ? -1 : step >= plan.steps.length ? plan.steps.length : (tick < 0 ? step : step + (tick + 1) / (st.nTicks + 1) + 1e-4);
    if (st && tick >= st.nTicks - 1) u.uStep.value = step + 0.9999;
    u.uCell.value = st ? st.cellIdx : -1;
    u.uFinal.value = st && st.kind === 'done' ? 1 : 0;
    u.uActSurface.value = 0;
    const act = u.uActive.value; act.fill(-1);
    if (st && st.kind === 'add') act[0] = st.piece.id;
    this.setCells(); this.setActive(step); this.setStroke(step); this.setPath();
  }
  /** is cell v closed at the current sub-step and tick? */
  isClosed(v) {
    const plan = this.plan, k = plan.stepOf[v];
    return k < this.step || (k === this.step && k < plan.steps.length && this.tick >= plan.steps[k].nTicks - 1);
  }
  /** index in the order of the last closed cell at the current step (−1 before the start) */
  curCell() {
    const plan = this.plan; if (!plan) return -1;
    if (this.step < 0) return -1; if (this.step >= plan.steps.length - 1) return plan.order.length - 1;
    const st = plan.steps[this.step]; return st.closes && this.tick >= st.nTicks - 1 ? st.cellIdx : st.cellIdx - 1;
  }

  // --- discs, dots, the path ---------------------------------------------------------------------------------------
  _labelTexture(text, fillHex, ring = false, strong = true, textHex = null) {
    const key = text + '|' + fillHex + (ring ? '|ring' : '') + (strong ? '' : '|pale') + (textHex || '');
    if (this.labelCache.has(key)) return this.labelCache.get(key);
    const S = 128, cv = document.createElement('canvas'); cv.width = S; cv.height = S; const ctx = cv.getContext('2d');
    if (ring) { ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 10, 0, 2 * Math.PI); ctx.fillStyle = this.dark ? 'rgba(30,32,34,0.85)' : 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.lineWidth = 14; ctx.strokeStyle = fillHex; ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 5, 0, 2 * Math.PI); ctx.fillStyle = fillHex; ctx.fill(); if (strong) { ctx.lineWidth = 8; ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.9)' : 'rgba(30,32,34,0.85)'; ctx.stroke(); } }
    const px = text.length <= 1 ? 76 : text.length === 2 ? 62 : text.length === 3 ? 48 : 38;
    ctx.font = `700 ${px}px "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = textHex || (ring ? (this.dark ? '#e4e5e3' : '#1b1d1f') : (strong ? '#1b1d1f' : 'rgba(27,29,31,0.6)')); if (text) ctx.fillText(text, S / 2, S / 2 + px * 0.06);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    this.labelCache.set(key, tex); return tex;
  }
  _disc(text, fillHex, p, size, userData, ring = false, opacity = 1, strong = true, textHex = null) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._labelTexture(text, fillHex, ring, strong, textHex), transparent: true, depthWrite: false, opacity }));
    sp.position.set(p[0], p[1], p[2]); sp.scale.set(size, size, 1); sp.renderOrder = 5; Object.assign(sp.userData, userData);
    return sp;
  }
  /** the singular cells: a strong outlined disc once the cell is closed, a pale smaller one before */
  setCells() {
    const w = this.w, plan = this.plan; if (!w || !plan) return;
    const a = this.opts.a, g = new THREE.Group();
    for (const s of plan.singular) {
      const woven = this.isClosed(s.cell);
      g.add(this._disc(String(s.valence), valenceHex(s.valence), this.lifted(s.cell, 0.1 * a), woven ? 0.38 * a : 0.28 * a, { kind: 'cell', cell: s.cell }, false, woven ? 1 : 0.5, woven));
    }
    this._setLayer('cells', g);
  }
  /** the path of the order on the surface: solid through the closed cells, dashed ahead — and a hollow dot at every
   *  regular cell closed so far */
  setPath() {
    const w = this.w, plan = this.plan; if (!w || !plan) return;
    const a = this.opts.a, pts = plan.order.map(v => this.lifted(v, 0.09 * a)), cur = this.curCell();
    let g = null;
    if (this.visible.path) {
      g = new THREE.Group();
      const done = [], ahead = [];
      for (let i = 0; i < pts.length; i++) { if (i <= cur) done.push(...pts[i]); if (i >= Math.max(cur, 0)) ahead.push(...pts[i]); }
      if (done.length >= 6) { const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(done), 3)); g.add(new THREE.Line(ge, new THREE.LineBasicMaterial({ color: this.colFg, transparent: true, opacity: 0.9 }))); }
      if (ahead.length >= 6) { const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(ahead), 3)); const ln = new THREE.Line(ge, new THREE.LineDashedMaterial({ color: this.colDim, dashSize: 0.22 * a, gapSize: 0.16 * a, transparent: true, opacity: 0.75 })); ln.computeLineDistances(); g.add(ln); }
      g.renderOrder = 4;
    }
    let d = null;
    if (this.visible.path) {
      const cells = []; for (let v = 0; v < w.nV; v++) if (!this.singularSet.has(v) && this.isClosed(v)) cells.push(v);
      if (cells.length) {
        d = new THREE.Group();
        const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.07 * a, 0.115 * a, 18), new THREE.MeshBasicMaterial({ color: this.colFg, side: THREE.DoubleSide }), cells.length);
        const fill = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07 * a, 18), new THREE.MeshBasicMaterial({ color: this.dark ? 0x26282c : 0xffffff, side: THREE.DoubleSide }), cells.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1), nn = new THREE.Vector3(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
        cells.forEach((v, k) => { nn.set(w.N[3 * v], w.N[3 * v + 1], w.N[3 * v + 2]).multiplyScalar(this.sideSign); q.setFromUnitVectors(up, nn); pos.fromArray(this.lifted(v, 0.09 * a)); m4.compose(pos, q, sc); ring.setMatrixAt(k, m4); fill.setMatrixAt(k, m4); });
        ring.instanceMatrix.needsUpdate = true; fill.instanceMatrix.needsUpdate = true; ring.renderOrder = 4; fill.renderOrder = 3; d.add(fill, ring);
      }
    }
    if (d) { if (!g) g = new THREE.Group(); g.add(d); }
    this._setLayer('path', g);
  }
  /** the bounding box of the lattice with its three sizes in centimetres (Display → layers → bounding box) */
  setBBox() {
    const w = this.w; if (!w || !this.lo) { this._setLayer('bbox', null); return; }
    const lo = this.lo, hi = this.hi, a = this.opts.a, g = new THREE.Group(), pts = [];
    const c = (x, y, z) => [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]];
    for (const [p, q] of [[[0,0,0],[1,0,0]], [[0,1,0],[1,1,0]], [[0,0,1],[1,0,1]], [[0,1,1],[1,1,1]], [[0,0,0],[0,1,0]], [[1,0,0],[1,1,0]], [[0,0,1],[0,1,1]], [[1,0,1],[1,1,1]], [[0,0,0],[0,0,1]], [[1,0,0],[1,0,1]], [[0,1,0],[0,1,1]], [[1,1,0],[1,1,1]]]) pts.push(...c(...p), ...c(...q));
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3));
    g.add(new THREE.LineSegments(ge, new THREE.LineDashedMaterial({ color: this.colDim, dashSize: 0.3 * a, gapSize: 0.18 * a, transparent: true, opacity: 0.9 })));
    g.children[0].computeLineDistances();
    const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], cm = (x) => `${(x * this.scale).toFixed(x * this.scale >= 100 ? 0 : 1)} cm`, off = 0.35 * a;
    const mid = (x, y, z) => [x === 0.5 ? (lo[0] + hi[0]) / 2 : x ? hi[0] + off : lo[0] - off, y === 0.5 ? (lo[1] + hi[1]) / 2 : y ? hi[1] + off : lo[1] - off, z === 0.5 ? (lo[2] + hi[2]) / 2 : z ? hi[2] + off : lo[2] - off];
    g.add(this._textSprite(`W ${cm(size[0])}`, mid(0.5, 0, 0), a), this._textSprite(`D ${cm(size[1])}`, mid(1, 0.5, 0), a), this._textSprite(`H ${cm(size[2])}`, mid(1, 0, 0.5), a));
    g.renderOrder = 6;
    this._setLayer('bbox', g);
  }
  /** a small text label on a rounded panel, as a sprite (the bounding-box sizes) */
  _textSprite(text, p, a) {
    const key = 'txt|' + text + (this.dark ? '|d' : '');
    let tex = this.labelCache.get(key);
    if (!tex) {
      const W = 256, Hh = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const ctx = cv.getContext('2d');
      ctx.font = `500 30px "IBM Plex Mono", "SFMono-Regular", Menlo, monospace`; const tw = Math.min(W - 16, ctx.measureText(text).width + 24), x0 = (W - tw) / 2;
      ctx.fillStyle = this.dark ? 'rgba(30,32,34,0.92)' : 'rgba(255,255,255,0.94)'; ctx.beginPath(); ctx.roundRect(x0, 8, tw, Hh - 16, 10); ctx.fill();
      ctx.strokeStyle = this.dark ? 'rgba(228,229,227,0.5)' : 'rgba(27,29,31,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = this.dark ? '#e4e5e3' : '#1b1d1f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, W / 2, Hh / 2 + 1);
      tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; this.labelCache.set(key, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.position.set(p[0], p[1], p[2]); sp.scale.set(2.4 * a, 0.6 * a, 1); sp.renderOrder = 7;
    return sp;
  }
  /** the active cell's badge: its number on a dark disc while the cell is being built, hollow once it is closed */
  setActive(step) {
    const w = this.w, plan = this.plan; if (!w || !plan || step < 0 || step >= plan.steps.length || plan.steps[step].kind === 'done') { this._setLayer('active', null); return; }
    const st = plan.steps[step], a = this.opts.a, g = new THREE.Group(), closed = st.closes && this.tick >= st.nTicks - 1;
    const ink = this.dark ? '#e4e5e3' : '#404045';
    g.add(this._disc(String(st.cellIdx + 1), ink, this.lifted(st.cell, 0.12 * a), 0.4 * a, { kind: 'cell', cell: st.cell }, closed, 0.95, true, closed ? null : (this.dark ? '#1d1f22' : '#ffffff')));
    this._setLayer('active', g);
  }
  setHover(cell) {
    const w = this.w, plan = this.plan; if (!w || !plan || cell < 0) { this._setLayer('hover', null); return; }
    const a = this.opts.a, g = new THREE.Group();
    g.add(this._disc('', '#' + this.colAccent.getHexString(), this.lifted(cell, 0.14 * a), 0.55 * a, { kind: 'cell', cell }, true, 0.75));
    this._setLayer('hover', g);
  }

  // --- the centre strokes ------------------------------------------------------------------------------------------
  _strokeBoxes(D, secs, wd, th, dash = 0) {
    let acc = 0, on = true;
    for (let i = 0; i + 1 < secs.length; i++) {
      const A = secs[i], B = secs[i + 1], len = Math.hypot(...sub3(B.p, A.p));
      if (dash > 0) {
        let u0 = 0;
        while (u0 < 1 - 1e-9) {
          const room = (on ? dash : 0.6 * dash) - acc, du = Math.min(1 - u0, room / Math.max(len, 1e-9)), u1 = u0 + du;
          if (on) this._box(D, { p: lerp3(A.p, B.p, u0), n: nrm3(lerp3(A.n, B.n, u0)), t: A.t }, { p: lerp3(A.p, B.p, u1), n: nrm3(lerp3(A.n, B.n, u1)), t: A.t }, wd, th);
          acc += du * len; if (acc >= (on ? dash : 0.6 * dash) - 1e-9) { acc = 0; on = !on; } u0 = u1;
        }
      } else this._box(D, A, B, wd, th);
    }
  }
  _box(D, A, B, wd, th) {
    const corner = (s, dw, dh) => { const b = nrm3(cross3(s.n, s.t)); return [s.p[0] + dw * b[0] + dh * s.n[0], s.p[1] + dw * b[1] + dh * s.n[1], s.p[2] + dw * b[2] + dh * s.n[2]]; };
    const bA = nrm3(cross3(A.n, A.t)), bB = nrm3(cross3(B.n, B.t));
    const faces = [{ nA: A.n, nB: B.n, q: [[-1, 1], [1, 1]] }, { nA: bA, nB: bB, q: [[1, 1], [1, -1]] }, { nA: neg3(bA), nB: neg3(bB), q: [[-1, -1], [-1, 1]] }, { nA: neg3(A.n), nB: neg3(B.n), q: [[1, -1], [-1, -1]] }];
    for (const f of faces) {
      const v0 = D.pos.length / 3;
      const c = [corner(A, f.q[0][0] * wd / 2, f.q[0][1] * th / 2), corner(A, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[0][0] * wd / 2, f.q[0][1] * th / 2)];
      for (let k = 0; k < 4; k++) { D.pos.push(...c[k]); D.nrm.push(...(k < 2 ? f.nA : f.nB)); }
      D.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    }
  }
  /** the stroke sits on the strip's own top face and follows it over and under (Design update 5: "the highlight
   *  follows the strip, not above the strip") — under a crossing strip it is hidden, as the strip is */
  _strokeRaise() { return 0.72 * this.opts.thickness + 0.015 * this.opts.a; }
  /** a dot at a crossing: on top of the crossing, above whichever strip is over there */
  _knotTop(si, i) { const F = this._knotFrame(si, i), r = 0.015 * this.opts.a + 1.5 * this.opts.thickness + this._strokeRaise(); return [F.p[0] + r * F.n[0], F.p[1] + r * F.n[1], F.p[2] + r * F.n[2]]; }
  /** the full-length stroke of one piece: solid (or dashed) over its woven extent, thin over the remainder — on the
   *  surface, along the hanging stub, or not at all, as the remainder is displayed. `us` = the step uniform. */
  _pieceStroke(D, pc, us, dashed) {
    const w = this.w, plan = this.plan, si = pc.strand, s = w.strands[si], a = this.opts.a, thk = this.opts.thickness, width = this.opts.width;
    const raise = this._strokeRaise(), wd = (dashed ? 0.13 : 0.15) * width, th = 0.4 * thk, thin = 0.07 * width, dir = this.walkDir(si);
    const n = pc.knots.length, kStep = pc.knots.map(i => plan.knotStep[s.knots[i]]);
    let first = -1, last = -1; kStep.forEach((v, m) => { if (v <= us) { if (first < 0) first = m; last = m; } });
    const segOf = (m) => this.walkSeg(si, pc.q0 + m), secs = (j, uA = 0, uB = 1) => this._segSections(si, j, 4, raise, false, uA, uB);
    const mode = this.u.uDeactive.value;
    const half = (j, headEnd) => { if (j < 0) return; const [uA, uB] = (headEnd ? dir > 0 : dir < 0) ? [0, 0.5] : [0.5, 1]; this._strokeBoxes(D, secs(j, uA, uB), thin, th); };
    if (first < 0) {                                                 // nothing threaded yet: the whole strip along its path (if shown)
      if (mode === 2 || !(mode === 0 || this.u.uActSurface.value > 0.5)) return;
      for (let m = 0; m + 1 < n; m++) { const j = segOf(m); if (j >= 0) this._strokeBoxes(D, secs(j), wd, th, dashed ? 0.35 * a : 0); }
      half(this.walkSeg(si, pc.q1), true); half(this.walkSeg(si, pc.q0 - 1), false);
      return;
    }
    for (let m = first; m < last; m++) { const j = segOf(m); if (j >= 0) this._strokeBoxes(D, secs(j), wd, th, dashed ? 0.35 * a : 0); }
    if (mode === 2) return;
    const stub = (m, fwd) => {
      const f = this._stubStart(si, pc, m, fwd), t = f.t;
      let rest = fwd ? this.segLenOf(si, this.walkSeg(si, pc.q1)) / 2 : this.segLenOf(si, this.walkSeg(si, pc.q0 - 1)) / 2;
      if (fwd) for (let q = m; q + 1 < n; q++) rest += this.segLenOf(si, segOf(q)); else for (let q = 0; q < m; q++) rest += this.segLenOf(si, segOf(q));
      rest -= f.used;
      if (rest < 0.05 * a) return;
      // through the hanging lath (a little thicker than it), so the line shows from either side of a strip in the air
      const c0 = f.c0, c1 = [c0[0] + rest * t[0], c0[1] + rest * t[1], c0[2] + rest * t[2]];
      this._strokeBoxes(D, [{ p: c0, n: f.n, t }, { p: c1, n: f.n, t }], thin, 1.3 * thk);
    };
    if (mode === 0 || last === n - 1) { for (let m = last; m + 1 < n; m++) { const j = segOf(m); if (j >= 0) this._strokeBoxes(D, secs(j), thin, th); } half(this.walkSeg(si, pc.q1), true); }
    else stub(last, true);
    if (mode === 0 || first === 0) { for (let m = 0; m < first; m++) { const j = segOf(m); if (j >= 0) this._strokeBoxes(D, secs(j), thin, th); } half(this.walkSeg(si, pc.q0 - 1), false); }
    else stub(first, false);
  }
  /** the tangent of strand si at knot i along the weaver's walk (unit) */
  _walkTangent(si, i) { const u = this._knotTangent(si, i); return this.walkDir(si) > 0 ? u : neg3(u); }
  /** the marks of a sub-step (Ji's render_update-09, after Kinneir & Calvert's signage arrow): add / continue → the
   *  strip whole with its thin centre line (its path), the part threaded in this sub-step as a thick bar from its first
   *  crossing to the current one (passed), and a bold arrow at the crossing of the current tick pointing in the weaving
   *  direction (current); lay → a dot at every crossing of the sub-step (made: black, the current one larger, to come:
   *  pale), and the bar of the strip threaded just before at this cell stays, so the crossing that closes the cell reads
   *  together with the strip that brought it; no other strip is highlighted */
  setStroke(step) {
    const w = this.w, plan = this.plan; if (!w || !plan) { this._setLayer('stroke', null); this._setLayer('selection', null); return; }
    const width = this.opts.width, thk = this.opts.thickness, raise = this._strokeRaise(), us = this.u.uStep.value;
    const mesh = (D, colour) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(D.pos), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(D.nrm), 3)); geo.setIndex(D.idx); return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })); };
    const dots = (list, colour, r) => { if (!list.length) return null; const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: colour }), list.length); const m4 = new THREE.Matrix4(); list.forEach((p, k) => { m4.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(k, m4); }); inst.instanceMatrix.needsUpdate = true; return inst; };
    const tri = (D, nn, a, b, c) => { const v0 = D.pos.length / 3; for (const q of [a, b, c]) { D.pos.push(...q); D.nrm.push(...nn); } D.idx.push(v0, v0 + 1, v0 + 2); };
    const quad = (D, nn, a, b, c, d) => { tri(D, nn, a, b, c); tri(D, nn, a, c, d); };
    const g = new THREE.Group(), D = { pos: [], nrm: [], idx: [] }, B = { pos: [], nrm: [], idx: [] }, A = { pos: [], nrm: [], idx: [] }, pale = this.dark ? 0x6a6d73 : 0xb9bbbe;
    // the arrow stands before the crossing of the current tick, its tip at the edge of the crossing strip, so the
    // crossing itself shows who is over by colour (Design update 6); its stem is the bar itself, which runs along the
    // strip from the first crossing of the sub-step (or a short way back) up to the head — one continuous mark
    const L = 0.8 * width, tipBack = 0.55 * width, headLen = 0.72 * L, stemLen = 1.1 * L, wd = 0.42 * width, th = 0.5 * thk;
    /** walk back from knot ki against the threading direction (sign = ±1 in original index) by arc length `back`
     *  → {p, n, t (the threading direction), j, u} on the strand curve; j = −1 when the strand ends first */
    const behind = (si, ki, sign, back) => {
      const s = w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, N = 24;
      let j = sign > 0 ? (s.closed ? (ki - 1 + K) % K : ki - 1) : ki, u = sign > 0 ? 1 : 0, left = back;
      if (j < 0 || j >= nseg) { const F = this._knotFrame(si, ki), t = this._knotTangent(si, ki).map(x => x * sign); return { p: [F.p[0] + F.h * F.n[0] - back * t[0], F.p[1] + F.h * F.n[1] - back * t[1], F.p[2] + F.h * F.n[2] - back * t[2]], n: F.n, t, j: -1, u: 0 }; }
      let prev = this._curveAt(si, j, u, false);
      for (let guard = 0; guard < 4000 && left > 0; guard++) {
        const un = sign > 0 ? u - 1 / N : u + 1 / N;
        if (un < -1e-9 || un > 1 + 1e-9) {
          const jn = sign > 0 ? j - 1 : j + 1, jw = s.closed ? ((jn % K) + K) % K : jn;
          if (jw < 0 || jw >= nseg) break;
          j = jw; u = sign > 0 ? 1 : 0; continue;
        }
        const c = this._curveAt(si, j, un, false), d = Math.hypot(c.p[0] - prev.p[0], c.p[1] - prev.p[1], c.p[2] - prev.p[2]);
        if (d >= left) { const f = left / d; return { p: lerp3(prev.p, c.p, f), n: nrm3(lerp3(prev.n, c.n, f)), t: sign > 0 ? c.t : neg3(c.t), j, u: u + (un - u) * f }; }
        left -= d; u = un; prev = c;
      }
      return { p: prev.p, n: prev.n, t: sign > 0 ? prev.t : neg3(prev.t), j, u };
    };
    /** walk-space position (walk segment + u) of a point (j, u) of the strand, for piece pc; null if off the piece */
    const walkPos = (pc, j, u) => {
      const si = pc.strand, s = w.strands[si], K = s.knots.length, rev = this.walkDir(si) < 0;
      let q; if (s.closed) { q = (((j - plan.offset[si]) % K) + K) % K; if (q < pc.q0) q += K; } else q = rev ? K - 2 - j : j;
      const m = q - pc.q0; if (m < -1 || m > pc.knots.length) return null;
      return m + (rev ? 1 - u : u);
    };
    /** the bar along the strip of piece pc between walk positions wa and wb (either order) */
    const bar = (pc, wa, wb) => {
      const si = pc.strand, rev = this.walkDir(si) < 0, lo = Math.min(wa, wb), hi = Math.max(wa, wb);
      for (let m = Math.floor(lo); m < Math.ceil(hi); m++) {
        const uA = Math.max(0, lo - m), uB = Math.min(1, hi - m), j = this.walkSeg(si, pc.q0 + m);
        if (j < 0 || uB - uA < 0.01) continue;
        this._strokeBoxes(B, this._segSections(si, j, 4, raise + 0.05 * thk, false, rev ? 1 - uB : uA, rev ? 1 - uA : uB), wd, th);
      }
    };
    /** the mark of strip sub-step `stp` at tick `upTo`: the bar from its first crossing to the current one — up to the
     *  arrow's head when the current tick is one of the strip's own crossings (`arrow`), through it otherwise */
    const strokeStrip = (stp, upTo, arrow) => {
      const pc = stp.piece, si = pc.strand, own = stp.knots.slice(0, upTo + 1).filter(q => q.pos >= 0);
      if (!own.length) return;
      const m0 = own[0].pos, q = own[own.length - 1], m1 = q.pos;
      if (!arrow) { if (m1 !== m0) bar(pc, m0, m1); return; }        // through the last crossing passed, no head
      const [sj, ki] = w.knotStrands[q.e].find(([a]) => a === si) || w.knotStrands[q.e][0];
      const sign = stp.dir * this.walkDir(si), T = behind(si, ki, sign, tipBack), Bh = behind(si, ki, sign, tipBack + headLen);
      const rr = raise + 0.08 * thk, lift = (c) => [c.p[0] + rr * c.n[0], c.p[1] + rr * c.n[1], c.p[2] + rr * c.n[2]];
      const bb = nrm3(cross3(Bh.n, Bh.t)), base = lift(Bh), tip = lift(T), hw = 0.55 * L;
      tri(A, Bh.n, tip, [base[0] + hw * bb[0], base[1] + hw * bb[1], base[2] + hw * bb[2]], [base[0] - hw * bb[0], base[1] - hw * bb[1], base[2] - hw * bb[2]]);
      const wB = Bh.j >= 0 ? walkPos(pc, Bh.j, Bh.u) : null;
      if (wB === null) {                                             // the strand ends just here: a straight stem
        const tail = [base[0] - stemLen * Bh.t[0], base[1] - stemLen * Bh.t[1], base[2] - stemLen * Bh.t[2]];
        this._strokeBoxes(B, [{ p: tail, n: Bh.n, t: Bh.t }, { p: base, n: Bh.n, t: Bh.t }], wd, th); return;
      }
      const wStart = m1 === m0 ? (() => { const S0 = behind(si, ki, sign, tipBack + headLen + stemLen); return S0.j >= 0 ? walkPos(pc, S0.j, S0.u) : null; })() : m0;
      if (wStart === null) bar(pc, wB - (stp.dir > 0 ? 0.3 : -0.3), wB); else bar(pc, wStart, wB + (stp.dir > 0 ? 0.004 : -0.004));
    };
    const st = step >= 0 && step < plan.steps.length ? plan.steps[step] : null;
    if (st && st.kind === 'add') {
      if (st.piece.id !== this.selPiece) this._pieceStroke(D, st.piece, us, false);
      // the crossings between strips in hand that lead the sub-step: dots
      const made = [], cur = [], todo = [];
      st.knots.forEach((q, i) => { if (!q.lay) return; const [[sa, ia]] = w.knotStrands[q.e], p = this._knotTop(sa, ia); (i === this.tick ? cur : i < this.tick ? made : todo).push(p); });
      for (const [list, col, r] of [[made, this.colFg, 0.2 * width], [cur, this.colFg, 0.3 * width], [todo, pale, 0.16 * width]]) { const m = dots(list, col, r); if (m) g.add(m); }
      if (this.tick >= 0) strokeStrip(st, this.tick, !st.knots[this.tick].lay);
    } else if (st && (st.kind === 'lay' || st.kind === 'close')) {
      const made = [], cur = [], todo = [];
      st.knots.forEach((q, i) => { const [[sa, ia]] = w.knotStrands[q.e], p = this._knotTop(sa, ia); (i === this.tick ? cur : i < this.tick ? made : todo).push(p); });
      for (const [list, col, r] of [[made, this.colFg, 0.2 * width], [cur, this.colFg, 0.3 * width], [todo, pale, 0.16 * width]]) { const m = dots(list, col, r); if (m) g.add(m); }
      // the strip threaded just before at this cell keeps its path and its bar
      for (let k = step - 1; k >= st.first; k--) { const prev = plan.steps[k]; if (prev.kind === 'add') { if (prev.piece.id !== this.selPiece) this._pieceStroke(D, prev.piece, us, false); strokeStrip(prev, prev.knots.length - 1, false); break; } }
    }
    if (D.pos.length) g.add(mesh(D, this.colFg));
    if (B.pos.length) g.add(mesh(B, this.colFg));
    if (A.pos.length) g.add(mesh(A, this.colFg));
    g.renderOrder = 3;
    this._setLayer('stroke', g.children.length ? g : null);
    if (this.selPiece >= 0) { const D2 = { pos: [], nrm: [], idx: [] }; this._pieceStroke(D2, plan.pieceList[this.selPiece], us, true); const g2 = new THREE.Group(); if (D2.pos.length) g2.add(mesh(D2, this.colFg)); g2.renderOrder = 3; this._setLayer('selection', g2.children.length ? g2 : null); }
    else this._setLayer('selection', null);
  }
  selectPiece(id) { this.selPiece = id; this.u.uSel.value = id; this.setStroke(this.step); }

  // --- picking -----------------------------------------------------------------------------------------------------
  pick(clientX, clientY) {
    if (!this.w) return null;
    const r = this.canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(nd, this.camera);
    const targets = [];
    if (this.layers.cells?.visible) targets.push(...this.layers.cells.children);
    if (this.layers.laths?.visible) targets.push(this.layers.laths);
    if (this.layers.hang?.visible) targets.push(this.layers.hang);
    if (this.layers.surface) targets.push(this.layers.surface);
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      const o = h.object, kind = o.userData.kind;
      if (kind === 'cell') return { kind: 'cell', cell: o.userData.cell, point: h.point, onDisc: true };
      if (kind === 'lath') {
        const g = o.geometry, ix = g.index.array[3 * h.faceIndex], A = g.attributes, s0 = A.s0.array[ix], sIn = A.sIn.array[ix], s1 = A.s1.array[ix], wIn = A.wIn.array[ix];
        const isHang = o === this.layers.hang, mode = this.u.uDeactive.value;
        const us = this.u.uStep.value;
        if (isHang) { if (mode !== 1 || us < s0 || us >= s1) continue; }
        else { if (us < sIn || us >= s1 || (mode === 2 && us < s0) || (mode === 1 && us < wIn)) continue; }
        return { kind: 'lath', strand: o.userData.faceStrand[h.faceIndex], piece: o.userData.facePiece[h.faceIndex], point: h.point };
      }
      if (kind === 'surface') {
        const F = this.w.F, V = this.w.V, f = h.faceIndex; let best = -1, bd = Infinity;
        for (const vi of [F[3 * f], F[3 * f + 1], F[3 * f + 2]]) { const d = h.point.distanceTo(new THREE.Vector3(V[3 * vi], V[3 * vi + 1], V[3 * vi + 2])); if (d < bd) { bd = d; best = vi; } }
        return { kind: 'cell', cell: best, point: h.point, onSurface: true };
      }
    }
    return null;
  }

  screenshotDataURL() { this.render(); return this.canvas.toDataURL('image/png'); }
}

function slerp(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a.dot(b))), om = Math.acos(dot);
  if (om < 1e-6) return b.clone();
  if (om > Math.PI - 1e-3) {
    let m = new THREE.Vector3().crossVectors(a, Math.abs(a.z) < 0.9 ? Z_UP : new THREE.Vector3(0, 1, 0)).normalize();
    m = new THREE.Vector3().crossVectors(m, a).normalize();
    return t < 0.5 ? slerp(a, m, 2 * t) : slerp(m, b, 2 * t - 1);
  }
  const s = Math.sin(om);
  return a.clone().multiplyScalar(Math.sin((1 - t) * om) / s).addScaledVector(b, Math.sin(t * om) / s).normalize();
}
function disposeObject(o) { o.traverse?.(x => { x.geometry?.dispose?.(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach(m => m.dispose?.()); }); }
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg3 = (a) => [-a[0], -a[1], -a[2]];
const nrm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
