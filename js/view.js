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
import { smoothSurface } from './smooth.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FAMILY_HEX, valenceHex } from './colormap.js';
import { NavCube } from './navcube.js';
import { WEAVER, WEAVER_HEX } from './weavers.js';

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const cssColor = (name, fallback) => new THREE.Color(cssVar(name, fallback));
const Z_UP = new THREE.Vector3(0, 0, 1);
const HOME_DIR = new THREE.Vector3(-0.85, -1.15, 0.7).normalize();
const POLE_EPS = 2e-3;
const FAR = 1e6;
const MAX_ACTIVE = 12;                                             // strips of one sub-step the shader can hold
const CROSS_SEC = 0.2;                                             // the crossing section: this much of a segment on either side of a crossing
/** THE VIVID BAND of a strip that is crossed at the current step: its whole length in lattice edges, centred on the
 *  crossing (1.5 = from three quarters of an edge before the crossing to three quarters after — Ji's drawing of
 *  16 Nov, the lattice as the scale). Tune it here: 1.0 is shorter, 2.0 reaches the next crossings but one. */
const BAND = 1.5;
const MAX_BAND = 64;                                               // crossings of one step the shader can hold (the latest ones)
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
/** the tint of the woven part: the piece's hue with `less` of its saturation taken away (Ji, 11 Nov: "5 %–10 % less … we
 *  cannot tell from colour between the active weaving part and the woven part"), so the strip in hand stands out */
const WOVEN_LESS = 0.10;
function calm(rgb, less = WOVEN_LESS) {
  const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), hsl = {}; c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s * (1 - less), hsl.l, THREE.SRGBColorSpace); return [c.r, c.g, c.b];
}
const WOVEN_RGB = LIGHT_RGB.map(c => calm(c));
/** one hue, light → dark: how much the shape asks of a strip (colour 'by stress') */
const STRESS_LO = hex2rgb('#dfe7f1'), STRESS_HI = hex2rgb('#1d4f91');
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** colour 'by marker': the strips without a mark (woven · the strip in hand), light and dark theme */
const MARK_REST = hex2rgb('#e6e6e3'), MARK_HAND = hex2rgb('#8f9298'), MARK_REST_DARK = hex2rgb('#8d9096'), MARK_HAND_DARK = hex2rgb('#d5d7da');
const WEAVER_RGB = WEAVER_HEX.map(hex2rgb), WEAVER_LIGHT = WEAVER_RGB.map(rgb => { const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).lerp(new THREE.Color('#ffffff'), 0.45); return [c.r, c.g, c.b]; });
const FAMILY_RGB = FAMILY_HEX.map(hex2rgb), FAMILY_LIGHT = FAMILY_RGB.map(rgb => { const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).lerp(new THREE.Color('#ffffff'), 0.55); return [c.r, c.g, c.b]; });
const CENTRE_LIGHT = [hex2rgb('#e3a85a'), hex2rgb('#d07a1c')], CENTRE_DARK = [hex2rgb('#c9954f'), hex2rgb('#f0a23c')];   // the hemp leaf's centre strips: woven · in hand
/** the strips of one band (the star weave: S4, S4b, S4c …) in shades of one colour — b a little lighter, c a little darker
 *  …: side by side they read as strips, not as one wide one */
function plyShade(s, rgb) { if (!s.guest || s.kind !== 'ply' || !s.tag) return rgb; const k = s.tag.charCodeAt(0) - 97, f = (k % 2 ? 1 : -1) * 0.12 * Math.ceil(k / 2); return f > 0 ? mix3(rgb, [1, 1, 1], f) : mix3(rgb, [0, 0, 0], -f); }
const ATTR = ['s0', 'wIn', 'sIn', 's1', 'pid', 'arc', 'ws'];   // arc: the place along its strip, in crossings (m + u between its m-th crossing and the next: the vivid bands are cut out of it); ws = (weaver + 1) + 16 · flags, packed (WebGL has 16 vertex attributes): the weaver whose work it is (of the nearer crossing on a lath, of the crossing a remainder hangs from, of the crossing for a clip ring; −1 none), flags 1 = in the selected set, 2 = hovered (Lengths charts), 4 = a side wall of a strip of a banded weave (drawn darker)

/** the step attributes on a material; kind: 'lath' | 'hang' | 'mark' (clip rings) | 'cut' (joint lines) */
function stepify(mat, u, kind) {
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    const decl = ATTR.map(k => `attribute float ${k};`).join('\n') + '\nattribute vec3 color2;\n' + ATTR.map(k => `varying float v_${k};`).join('\n') + '\nvarying vec3 vCol2;';
    const copy = ATTR.map(k => `v_${k} = ${k};`).join(' ') + ' vCol2 = color2;';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + decl).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + copy);
    const head = '#include <common>\n' + ATTR.map(k => `varying float v_${k};`).join('\n') + '\nvarying vec3 vCol2;\nuniform float uStep;\nuniform float uCell;\nuniform float uFinal;\nuniform float uActSurface;\nuniform float uDeactive;\nuniform float uActive[' + MAX_ACTIVE + '];\nuniform float uBandPid[' + MAX_BAND + '];\nuniform float uBandArc[' + MAX_BAND + '];\nuniform float uBandN;\nuniform float uBandReach;\nuniform float uSel;\nuniform float uSelEnd;\nuniform float uSelSet;\nuniform float uHover;\nuniform float uWHide;\nuniform vec3 uGrey;\nuniform vec3 uCanvas;';
    const act = 'bool isAct = false; for (int i = 0; i < ' + MAX_ACTIVE + '; i++) if (abs(uActive[i] - v_pid) < 0.5) isAct = true;';
    // the vivid band: this part lies within BAND / 2 lattice edges of a crossing its strip has with the strip in hand,
    // made at this step up to the current tick (Ji, update 5: vivid where the strip in hand crosses, nowhere else, and
    // not before it is woven there)
    const band = 'bool isBand = false; for (int i = 0; i < ' + MAX_BAND + '; i++) { if (float(i) >= uBandN) break; if (abs(uBandPid[i] - v_pid) < 0.5 && abs(uBandArc[i] - v_arc) <= uBandReach) isBand = true; }';   // only the bands in use are looked at
    // dim what is not looked at: the hovered strips (a Lengths bar under the mouse), else the selected piece, else the
    // selected set (a click or a window on the Lengths charts)
    // (flag 4: a side wall of a strip of a banded weave — darker, so that every strip has an edge and the layers read)
    const wall = 'if (mod(floor(floor(floor(v_ws + 0.5) / 16.0) * 0.25 + 0.01), 2.0) > 0.5) diffuseColor.rgb *= 0.5;';
    const dim = 'float slD = floor(floor(v_ws + 0.5) / 16.0); if (uHover > 0.5 ? mod(floor(slD * 0.5 + 0.01), 2.0) < 0.5 : uSel >= 0.0 ? (v_pid < uSel - 0.5 || v_pid > uSelEnd + 0.5) : (uSelSet > 0.5 && mod(slD, 2.0) < 0.5)) diffuseColor.rgb = mix(diffuseColor.rgb, uCanvas, 0.62);';
    let test, colour = '';
    const hideW = 'float wvD = mod(floor(v_ws + 0.5), 16.0) - 1.0; if (uWHide > 0.5 && wvD > -0.5 && mod(floor(uWHide / exp2(wvD)), 2.0) > 0.5) discard;';   // a weaver switched off in the History bar
    if (kind === 'lath') {
      test = [act, band, 'if (uStep < v_sIn || uStep >= v_s1) discard;',
        'if (uDeactive > 1.5 && uStep < v_s0) discard;',
        'if (uDeactive > 0.5 && uDeactive < 1.5 && uStep < v_wIn && !(isAct && uActSurface > 0.5)) discard;'].join('\n');
      colour = ['if (uStep < v_s0) diffuseColor.rgb = (isAct || isBand) ? vCol2 : uGrey;',
        'else if (uFinal > 0.5 || isAct || isBand) diffuseColor.rgb = vCol2;', wall, dim].join('\n');
    } else if (kind === 'hang') {
      test = 'if (uDeactive < 0.5 || uDeactive > 1.5 || uStep < v_s0 || uStep >= v_s1) discard;';
      colour = act + '\n' + band + '\ndiffuseColor.rgb = (isAct || isBand) ? vCol2 : uGrey;\n' + dim;
    } else if (kind === 'cut') {
      test = 'if (uStep >= v_s1) discard;\nif (uDeactive < 0.5) { if (uStep < v_sIn) discard; } else if (uStep < v_s0) discard;';
      colour = dim;
    } else {
      test = 'if (uStep < v_s0 || uStep >= v_s1) discard;';
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', head).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + hideW + '\n' + test);
    if (colour) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + colour);
  };
  mat.customProgramCacheKey = () => 'sp11-' + kind + '-' + mat.type;
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
    this.visible = { surface: true, lattice: false, cells: true, path: true, active: true, laths: true, hang: true, clips: false, cuts: true, stroke: true, hover: true, selection: true, bbox: true, markers: false, centres: true };   // a fresh page (Ji, 11 Nov): no lattice lines, no clip rings, the bounding box shown
    this.scale = 1;                                                 // centimetres per model unit (the bounding-box labels)
    this.u = { uStep: { value: FAR - 1 }, uCell: { value: -1 }, uFinal: { value: 0 }, uActSurface: { value: 0 }, uDeactive: { value: 1 }, uActive: { value: new Float32Array(MAX_ACTIVE).fill(-1) }, uBandPid: { value: new Float32Array(MAX_BAND).fill(-9) }, uBandArc: { value: new Float32Array(MAX_BAND) }, uBandN: { value: 0 }, uBandReach: { value: BAND }, uSel: { value: -1 }, uSelEnd: { value: -1 }, uSelSet: { value: 0 }, uHover: { value: 0 }, uWHide: { value: 0 }, uGrey: { value: new THREE.Vector3(0.6, 0.6, 0.59) }, uCanvas: { value: new THREE.Vector3(0.9, 0.9, 0.9) } };
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
    if (this.w) { this.recolour(); this.setStep(this.step, this.tick); if (this.markers) this.setMarkers(this.markers); if (this.centreCells) this.setCentres(this.centreCells); }
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
    if (mode !== 'roll') {
      // 'align' since 11 Nov (Ji: "we only do the yaw and pitch … once it rolls they lose orientation of their weave with the
      // digital model"): the view turns to the side of the model the cell is on — round the vertical axis and up or down —
      // and the model stays upright. The camera comes to stand on the cell's normal, never steeper than 65° above or below
      // the horizon (the weave is not seen from its pole); where the normal points straight up or down the view keeps
      // the side it is on. The user's distance stays, the transition is the smooth one.
      const horiz = Math.hypot(n.x, n.y), el = Math.max(-65, Math.min(65, THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, n.z)))))) * Math.PI / 180;
      const az = horiz > 0.15 ? Math.atan2(n.y, n.x) : Math.atan2(d0.y, d0.x);
      this._alignUp = null;
      this.lookFrom(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)), { dist, target: p, ms, tiltFrom: d0, up: Z_UP, smooth: true });
      return;
    }
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
    if (name === 'laths') { for (const k of ['hang']) { this.visible[k] = on; if (this.layers[k]) this.layers[k].visible = on; } }
    if (name === 'path') this.setPath();
    if (name === 'bbox' && on && !this.layers.bbox) this.setBBox();
  }
  setStrokeVisible(on) { this.setVisible('stroke', on); }
  /** centimetres per model unit: relabels the bounding box */
  setScale(cmPerUnit) { this.scale = cmPerUnit; if (this.w) this.setBBox(); }

  // --- the model ---------------------------------------------------------------------------------------------------
  setModel(w, plan, opts, more = {}) {
    this.w = w; this.plan = plan; this.opts = { ...opts }; this._curves = null; this._hosts = null; this._xing = null; this._band = null; this._tband = null; this._layerOf = null; this.selPiece = -1; this.selRange = null; this.selSet = null; this.hoverIds = null; this.u.uSel.value = -1; this.u.uSelEnd.value = -1; this.u.uSelSet.value = 0; this.u.uHover.value = 0;
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
  segLenOf(si, j) { if (j < 0) return 0; const s = this.w.strands[si]; if (s.len) return s.len[j] || 0; const [t, k] = s.segs[j]; return this.w.segLen[3 * t + k]; }   // (a guest strand — guests.js — carries its own)
  /** a segment is laid once both its crossings are made */
  segLaid(si, j, step) { const s = this.w.strands[si], K = s.knots.length; return this.plan.knotStep[s.knots[j]] <= step && this.plan.knotStep[s.knots[(j + 1) % K]] <= step; }

  // --- laths ----------------------------------------------------------------------------------------------------
  _knotFrame(si, i) {
    const w = this.w, plan = this.plan, s = w.strands[si], e = s.knots[i], sg = this.sideSign, thk = this.opts.thickness, lift = 0.015 * this.opts.a;
    const over = w.over(si, i);                                     // read from the lath side (w.side follows sideSign)
    // the layer of the strip here: 0 on the surface, 1 on one strip; a pattern can be three strips deep and gives the layer
    // itself, also half-way between two (patterns.js: w.level) — a loose end at the rim lies on the surface, in a pattern
    // with stacks where its strip is
    const lv = plan.rim[e] ? (w.lev ? w.level(si, i) : 0) : (w.level ? w.level(si, i) : (over ? 1 : 0));
    let h = lift + (0.5 + lv) * thk, x = 0;                         // x: what a joint adds
    // over a joint: the strip beneath carries the end laid on it, which lies between that strip and this one (Ji, update 5)
    if (over && !plan.rim[e] && w.knotStrands[e].length === 2) { const ks = w.knotStrands[e], u = ks[0][0] === si && ks[0][1] === i ? ks[1] : ks[0]; if (this._layers(u[0])[u[1]] > 1) { h += thk; x = thk; } }
    // (a strip of a banded weave lies beside its lattice strand's line — _plyCurve: its crossing there, not where the two
    //  straight strips of bands.js meet)
    if (w.cover && w.path && w.path[si]) { const path = w.path[si], c = this._beside(path, path.tau[path.kn ? path.kn[i] : i]); return { p: c.p, n: [sg * c.n[0], sg * c.n[1], sg * c.n[2]], h: h + this._strandCurve(si).dzKnot(i), x, e }; }
    return { p: [w.edgeMid[3 * e], w.edgeMid[3 * e + 1], w.edgeMid[3 * e + 2]], n: [sg * w.edgeNrm[3 * e], sg * w.edgeNrm[3 * e + 1], sg * w.edgeNrm[3 * e + 2]], h, x, e };
  }
  /** how many strips lie on each other at every crossing of strand si (2 in the overlap of a joint) */
  _layers(si) {
    if (!this._layerOf) this._layerOf = new Map();
    let L = this._layerOf.get(si); if (L) return L;
    L = new Uint8Array(this.w.strands[si].knots.length);
    const P = this.plan && this.plan.pieces ? this.plan.pieces[si] : null; if (P && P.list) for (const pc of P.list) for (const i of pc.knots) L[i]++;
    this._layerOf.set(si, L); return L;
  }
  /** the index along piece pc of its crossing at strand knot ki (its own crossing there, else the one in a joint's overlap) */
  _pieceIndex(pc, ki, wantOwn = true) {
    const n = pc.knots.length, oT = pc.ovTail | 0, oH = pc.ovHead | 0; let any = -1;
    for (let m = 0; m < n; m++) if (pc.knots[m] === ki) { if ((m >= oT && m < n - oH) === wantOwn) return m; if (any < 0) any = m; }
    return any;
  }
  /** the vivid bands of step `st` up to `tick`: around every crossing made so far in the step, the strip that the strip
   *  in hand crosses there (both strips of a crossing between two strips already in hand; at a joint's overlap the strip
   *  crossing it, and the end itself when another strip is in hand) → uBandPid / uBandArc */
  _setBands(st, tick) {
    const P = this.u.uBandPid.value, A = this.u.uBandArc.value, list = [];
    const pass = (si, ki, pc) => { if (pc && si >= 0) { const m = this._pieceIndex(pc, ki); if (m >= 0) list.push([pc.id, m]); } };
    if (st && st.knots && st.kind !== 'done') {
      const hand = st.kind === 'add' && st.piece ? st.piece.id : -1;
      for (let i = 0; i <= Math.min(tick, st.knots.length - 1); i++) {
        const q = st.knots[i]; if (q.rim || !(q.over >= 0) || !(q.under >= 0)) continue;
        if (q.join) {
          if (q.pcOver && q.subject && q.pcOver.id === q.subject.id) pass(q.under, q.underI, q.pcUnder); else pass(q.over, q.overI, q.pcOver);
          if (q.subject && q.subject.id !== hand && q.m >= 0) list.push([q.subject.id, q.m]);
        } else {
          if (q.lay || !(q.pcOver && q.pcOver.id === hand)) pass(q.over, q.overI, q.pcOver);
          if (q.lay || !(q.pcUnder && q.pcUnder.id === hand)) pass(q.under, q.underI, q.pcUnder);
        }
      }
    }
    P.fill(-9); const use = list.slice(-MAX_BAND); use.forEach(([pid, m], k) => { P[k] = pid; A[k] = m; }); this.u.uBandN.value = use.length;
  }
  /** half the width of the band along lattice edge e in which the strips of a pattern with stacks change layer: an
   *  eighth of the strip width (the sections of a lath lie along the edge there, see _strandCurve: the step can be
   *  short; a wide band would reach into the bands of the other edges at the two cells of the edge) — and no wider
   *  than the strips' segments beside the edge allow */
  _edgeBand(e) {
    if (!this._band) this._band = new Map();
    let d = this._band.get(e); if (d !== undefined) return d;
    const w = this.w, W = this.opts.width, [va, vb] = w.edges[e]; let len = Infinity;
    for (const t of w.edgeTris[e]) for (let k = 0; k < 3; k++) { const v = w.F[3 * t + k]; if (v === va || v === vb) len = Math.min(len, w.segLen[3 * t + k]); }
    d = Math.max(0.02 * this.opts.a, Math.min(0.12 * W, 0.86 * len - 0.25 * W));
    this._band.set(e, d); return d;
  }
  /** a triangle whose three strips go round (no stack): its middle, and half the width of the bands along the three
   *  lines through the middle parallel to its edges, in which its strips change layer (see _strandCurve) */
  _triBand(t) {
    if (!this._tband) this._tband = new Map();
    let r = this._tband.get(t); if (r) return r;
    const w = this.w, v = [0, 1, 2].map(k => { const i = w.F[3 * t + k]; return [w.V[3 * i], w.V[3 * i + 1], w.V[3 * i + 2]]; });
    const ab = sub3(v[1], v[0]), ac = sub3(v[2], v[0]), bc = sub3(v[2], v[1]), per = Math.hypot(...ab) + Math.hypot(...ac) + Math.hypot(...bc);
    r = { g: [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3],
      del: Math.max(0.02 * this.opts.a, Math.min(0.25 * this.opts.width, 0.45 * Math.hypot(...cross3(ab, ac)) / Math.max(per, 1e-9))) };   // (the radius of the inscribed circle: 2 · area / perimeter)
    this._tband.set(t, r); return r;
  }
  /** the centreline of a strand: a centripetal Catmull-Rom spline through its crossings (the lath bends smoothly, and
   *  consecutive segments share their section at the crossing — no gap or notch, as WeaveSim's render), the over /
   *  under height blended along each segment on top of it. `_curveAt(si, j, u, flat)` → the point of original segment
   *  j at u (u may run a little past [0, 1] into the neighbouring segments). */
  _strandCurve(si) {
    if (!this._curves) this._curves = new Map();
    let C = this._curves.get(si); if (C) return C;
    if (this.w.cover && this.w.path && this.w.path[si]) { C = this._plyCurve(si); this._curves.set(si, C); return C; }   // a strip of a banded weave
    const s = this.w.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, P = [], N = [], H = [];
    const hold = Math.min(0.36, Math.max(0, (this.opts.width / Math.max(this.opts.a, 1e-9) - 0.3) * 0.72));   // 0 up to a width of 0.3 a (the open weave, as it was), a third of the segment for strips that close on each other
    const X = [];                                                  // what a joint adds to the height at a crossing
    for (let i = 0; i < K; i++) { const F = this._knotFrame(si, i); P.push(F.p); N.push(F.n); H.push(F.h); X.push(F.x || 0); }
    const wv = this.w, wide = !!wv.midLevel, W = this.opts.width, thk = this.opts.thickness, lift = 0.015 * this.opts.a;
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
    // A PATTERN WITH STACKS (patterns.js: w.midLevel — strips so wide that three lie on each other in every triangle of
    // the lattice). The layer of a strip is then a thing of the place, not of the strip's length: in a triangle the strip
    // lies in its layer of the stack there, and it changes layer where it passes into the next triangle — along the
    // lattice edge, which runs at 60° across the strip, in a band of `_edgeBand` on either side. The two strips that
    // cross on the edge change layer in the same band, so the upper one stays above the lower one everywhere. In a
    // triangle whose three strips go round (no stack) no order holds for the whole triangle: there a strip is on top
    // (1½) towards the edge where it crosses over, underneath (½) towards the edge where it crosses under, and changes
    // across the two lines through the middle of the triangle parallel to those edges — the three strips then part
    // along the three such lines, the pinwheel: beside every crossing the right strip is on top.
    // layerAt(j, p): the layer of the strip at the point p of the surface beside its segment j. The lath is given the
    // layer at its two edges and on its centreline (its section tilts and bends: kp, km — height per width, either half).
    // And the layers are counted from the lattice itself, not from each strip's own curve — on a curved surface a wide
    // flat section would cut through the strips beside it. Between two crossings a strip lies on one triangle of the
    // lattice, and its sections there are cut along the rays from the corner of that triangle the strip goes round
    // (fanAt): at either crossing the section then lies on the lattice edge itself, where the surface folds, and every
    // piece of the strip in between is flat on its triangle.
    let layerAt = null, fanAt = null;
    if (wide) {
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit = (x) => Math.max(-1, Math.min(1, x));
      const M = [], BAND = [], MID = [], CYC = [];
      for (let i = 0; i < K; i++) {                                // the forward normal of the lattice edge at crossing i, in the surface
        const e = s.knots[i], [va, vb] = wv.edges[e], g = [wv.V[3 * vb] - wv.V[3 * va], wv.V[3 * vb + 1] - wv.V[3 * va + 1], wv.V[3 * vb + 2] - wv.V[3 * va + 2]];
        let m = nrm3(cross3(g, N[i])); if (dot(m, sub3(at(i + 1), at(i - 1))) < 0) m = neg3(m);
        M.push(m); BAND.push(this._edgeBand(e));
      }
      for (let j = 0; j < nseg; j++) {
        const m = wv.midLevel(si, j); MID.push(m);
        CYC.push(m === null ? { ...this._triBand(s.segs[j][0]), sIn: wv.over(si, j) ? 1 : -1, sOut: wv.over(si, (j + 1) % K) ? 1 : -1 } : null);
      }
      const R = (jj, p) => {                                       // the layer in the triangle of segment jj, as it is at p
        if (MID[jj] !== null) return MID[jj];
        const c = CYC[jj], q = sub3(p, c.g);                       // (towards the edge it came in by: −M there; towards the one it leaves by: +M)
        return 1 + 0.25 * (c.sIn * unit(-dot(q, M[jj]) / c.del) + c.sOut * unit(dot(q, M[(jj + 1) % K]) / c.del));
      };
      const past = (i, p) => dot(sub3(p, P[i]), M[i]);              // how far p lies past the lattice edge at crossing i
      const across = (i, p) => Math.max(0, Math.min(1, 0.5 + 0.5 * past(i, p) / BAND[i]));   // 0 before that edge, 1 past it
      layerAt = (j, p) => {
        const r = R(j, p), jp = s.closed ? (j - 1 + K) % K : j - 1, jn = s.closed ? (j + 1) % K : j + 1; let L = r;
        if (jp >= 0 && jp !== j) L += (R(jp, p) - r) * (1 - across(j, p));
        if (jn < nseg && jn !== j) L += (R(jn, p) - r) * across((j + 1) % K, p);
        return L;
      };
      const PL = [];                                               // the triangle of every segment: its plane, and the corner the strip goes round
      for (let j = 0; j < nseg; j++) {
        const [t, k] = s.segs[j], v = [0, 1, 2].map(m => { const i = wv.F[3 * t + m]; return [wv.V[3 * i], wv.V[3 * i + 1], wv.V[3 * i + 2]]; });
        PL.push({ o: v[k], n: nrm3(cross3(sub3(v[1], v[0]), sub3(v[2], v[0]))) });
      }
      // the section of the strip through the point p of its curve in segment j (nn: the normal there, b: across the strip):
      // → { c: p brought onto the triangle along nn, bv: along the section, as long as it takes to go one unit across }
      fanAt = (j, p, nn, b) => {
        const T = PL[j], den = dot(nn, T.n), z = Math.abs(den) > 0.2 ? dot(sub3(T.o, p), T.n) / den : 0, c = [p[0] + z * nn[0], p[1] + z * nn[1], p[2] + z * nn[2]];
        const r = sub3(c, T.o), l = Math.hypot(r[0], r[1], r[2]), sn = l > 1e-9 ? dot(r, b) / l : 0;
        return { c, bv: Math.abs(sn) > 0.4 ? [r[0] / (l * sn), r[1] / (l * sn), r[2] / (l * sn)] : b };   // (a ray too close to the strip's own direction: straight across)
      };
    }
    const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
    const flatAt = (j, u) => {                                     // the spline alone, u allowed a little outside [0, 1]
      if (u < 0) { if (j > 0 || s.closed) return flatAt(s.closed ? (j - 1 + K) % K : j - 1, u + 1); u = 0; }
      if (u > 1) { if (j + 1 < nseg || s.closed) return flatAt(s.closed ? (j + 1) % K : j + 1, u - 1); u = 1; }
      return spline(j, u);
    };
    const point = (j, u, flat) => {                                // segment j at u, u allowed a little outside [0, 1]
      if (u < 0) { if (j > 0 || s.closed) return point(s.closed ? (j - 1 + K) % K : j - 1, u + 1, flat); u = 0; }
      if (u > 1) { if (j + 1 < nseg || s.closed) return point(s.closed ? (j + 1) % K : j + 1, u - 1, flat); u = 1; }
      const j1 = (j + 1) % K, nn = nrm3(lerp3(N[j], N[j1], u)), p = spline(j, u);
      if (wide && !flat) {                                         // the layers on the centreline and at the two edges of the strip
        const b = nrm3(cross3(nn, sub3(flatAt(j, u + 0.02), flatAt(j, u - 0.02)))), hw = Math.max(W / 2, 1e-9);
        const { c, bv } = fanAt(j, p, nn, b);
        const Lc = layerAt(j, c), Ll = layerAt(j, [c[0] + hw * bv[0], c[1] + hw * bv[1], c[2] + hw * bv[2]]), Lr = layerAt(j, [c[0] - hw * bv[0], c[1] - hw * bv[1], c[2] - hw * bv[2]]);
        const hc = lift + (0.5 + Lc) * thk + X[j] + (X[j1] - X[j]) * ease(u);
        return { p: [c[0] + hc * nn[0], c[1] + hc * nn[1], c[2] + hc * nn[2]], n: nn, kp: (Ll - Lc) * thk / hw, km: (Lc - Lr) * thk / hw, bv };
      }
      // the height runs from one crossing's layer to the next one's; a wide strip stays in its layer beside a crossing —
      // where it lies on or under the strip it crosses — and changes layer in the middle of the segment (`hold`)
      const ub = hold > 0 ? Math.max(0, Math.min(1, (u - hold) / (1 - 2 * hold))) : u;
      const hh = flat ? 0 : H[j] + (H[j1] - H[j]) * ease(ub);
      return { p: [p[0] + hh * nn[0], p[1] + hh * nn[1], p[2] + hh * nn[2]], n: nn };
    };
    C = { nseg, point };
    this._curves.set(si, C); return C;
  }
  /** the line of lattice strand h as the hexagonal weave has it: a centripetal Catmull-Rom spline through its crossings on
   *  the lattice (the edge midpoints), no heights. → at(t): { p, n, t: the tangent } at t = crossing index + fraction (a
   *  closed strand goes round; an open one stops at its ends) */
  /** the smooth surface under the lattice (smooth.js: Loop's subdivision, through every crossing) — made once for a
   *  lattice and kept with it; null if it could not be made, if it is not evenly round (a turn of more than 8° from one fine
   *  face to the next: the rim of a capped cylinder 9°, a tree's forks 25 – 30°, the Bunny's ears 70°), or with
   *  view.smooth = false — the strips of a band then lie beside their strand's line with that strand's normal, as they
   *  did until 20 November. Why the limit: on the surface every strip of a band turns with it, and where it turns sharply
   *  the flat places two strips share no longer fit side by side; a band that is stiff across does better there
   *  (places with the wrong strip on top, rays from above, surface / stiff: dodecahedron 0 / 755, tube · 84 3 / 7,
   *  5-cone 1 / 1, capped cylinder · 104 44 / 0, tree · 188 266 / 19). */
  _surface() {
    const wb = this.w.base || this.w; if (this.smooth === false || !wb || !wb.F) return null;
    if (wb._smooth === undefined) { try { wb._smooth = smoothSurface(wb, 4); } catch (err) { console.warn('no smooth surface for this lattice:', err); wb._smooth = null; } }
    return wb._smooth && wb._smooth.rough <= 8 ? wb._smooth : null;
  }
  _hostCurve(h) {
    if (!this._hosts) this._hosts = new Map();
    let H = this._hosts.get(h); if (H) return H;
    const wb = this.w.base || this.w, s = wb.strands[h], K = s.knots.length, M = wb.edgeMid, Nm = wb.edgeNrm;
    // ON THE SMOOTH SURFACE (20 Nov): between two crossings the strand is a straight line in the coordinates of the lattice
    // face it runs through — from the middle of one edge to the middle of the next, the two edges meeting in a corner
    const SF = this._surface(), nsg = s.closed ? K : K - 1, sgs = SF && nsg > 0 ? new Array(nsg) : null;
    if (sgs) for (let j = 0; j < nsg; j++) { const e0 = wb.edges[s.knots[j]], e1 = wb.edges[s.knots[(j + 1) % K]], f = s.segs && s.segs[j] ? s.segs[j][0] : -1, A = e0[0] === e1[0] || e0[0] === e1[1] ? e0[0] : e0[1] === e1[0] || e0[1] === e1[1] ? e0[1] : -1;
      const c = f >= 0 ? [wb.F[3 * f], wb.F[3 * f + 1], wb.F[3 * f + 2]] : [], k = c.indexOf(A), m0 = c.indexOf(e0[0] === A ? e0[1] : e0[0]), m1 = c.indexOf(e1[0] === A ? e1[1] : e1[0]);
      sgs[j] = A >= 0 && k >= 0 && m0 >= 0 && m1 >= 0 && m0 !== m1 ? [f, k, m0, m1] : null; }
    const onS = sgs && sgs.every(Boolean);
    const P = s.knots.map(e => [M[3 * e], M[3 * e + 1], M[3 * e + 2]]), N = s.knots.map(e => [Nm[3 * e], Nm[3 * e + 1], Nm[3 * e + 2]]);
    const pick = (i) => s.closed ? P[((i % K) + K) % K] : (i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1], 2 * P[0][2] - P[1][2]] : i >= K ? [2 * P[K - 1][0] - P[K - 2][0], 2 * P[K - 1][1] - P[K - 2][1], 2 * P[K - 1][2] - P[K - 2][2]] : P[i]);
    const knot = (p, q, t) => t + Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
    const spline = (j, u) => {
      const P0 = pick(j - 1), P1 = pick(j), P2 = pick(j + 1), P3 = pick(j + 2);
      const t0 = 0, t1 = knot(P0, P1, t0), t2 = knot(P1, P2, t1), t3 = knot(P2, P3, t2);
      if (t1 - t0 < 1e-9 || t2 - t1 < 1e-9 || t3 - t2 < 1e-9) return lerp3(P1, P2, u);
      const t = t1 + u * (t2 - t1), mix = (a, b, wa, wb) => [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
      const A1 = mix(P0, P1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0)), A2 = mix(P1, P2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)), A3 = mix(P2, P3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
      const B1 = mix(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0)), B2 = mix(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
      return mix(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
    };
    const pt = (t) => {
      let j = Math.floor(t), u = t - j;
      if (s.closed) j = ((j % K) + K) % K; else if (t <= 0) { j = 0; u = 0; } else if (t >= K - 1) { j = Math.max(0, K - 2); u = 1; }
      return { p: spline(j, u), n: nrm3(lerp3(N[j], N[(j + 1) % K], u)) };
    };
    const at = (t) => { const c = pt(t), a = pt(t - 0.02), b = pt(t + 0.02); let d = sub3(b.p, a.p); if (Math.hypot(d[0], d[1], d[2]) < 1e-12) d = sub3(P[Math.min(K - 1, 1)], P[0]); return { p: c.p, n: c.n, t: nrm3(d) }; };
    const ptS = (t) => {
      let j = Math.floor(t), u = t - j;
      if (s.closed) j = ((j % K) + K) % K; else if (t <= 0) { j = 0; u = 0; } else if (t >= K - 1) { j = Math.max(0, K - 2); u = 1; }
      const [f, k, m0, m1] = sgs[j], wt = [0, 0, 0]; wt[k] = 0.5; wt[m0] += 0.5 * (1 - u); wt[m1] += 0.5 * u;
      const R = SF.at(f, wt[1], wt[2]); R.f = f; R.b1 = wt[1]; R.b2 = wt[2]; return R;
    };
    const hS = SF ? 2 / SF.n : 0;      // (the tangent over one fine cell to either side: the surface is flat within a cell)
    const atS = (t) => { const c = ptS(t), a = ptS(t - hS), b = ptS(t + hS); let d = sub3(b.p, a.p); const k = d[0] * c.n[0] + d[1] * c.n[1] + d[2] * c.n[2]; d = [d[0] - k * c.n[0], d[1] - k * c.n[1], d[2] - k * c.n[2]];
      if (Math.hypot(d[0], d[1], d[2]) < 1e-12) return at(t); return { p: c.p, n: c.n, t: nrm3(d), f: c.f, b1: c.b1, b2: c.b2 }; };
    H = { K, at: onS ? atS : at, smooth: !!onS }; this._hosts.set(h, H); return H;
  }
  /** the line of a strip of a banded weave (pp: its w.path) at t: the point beside its lattice strand's line, the
   *  lattice's normal there, the tangent, the direction across */
  _beside(pp, t) {
    const c = this._hostCurve(pp.host).at(t), b = nrm3(cross3(c.n, c.t)), q = [c.p[0] + pp.off * b[0], c.p[1] + pp.off * b[1], c.p[2] + pp.off * b[2]];
    if (c.f === undefined || !pp.off) return { p: q, n: c.n, t: c.t, b };
    // (on the smooth surface: the point of the surface next to the place beside the strand's line, and the surface's own
    //  normal there — a band is as round across as the surface is, and two strips that cross agree on the plane they share)
    const R = this._surface().near(q, { f: c.f, b1: c.b1, b2: c.b2 }); if (!R.ok) return { p: q, n: c.n, t: c.t, b };      // (not found — a sharp place: as it was)
    const k = c.t[0] * R.n[0] + c.t[1] * R.n[1] + c.t[2] * R.n[2], tt = nrm3([c.t[0] - k * R.n[0], c.t[1] - k * R.n[1], c.t[2] - k * R.n[2]]);
    return { p: R.p, n: R.n, t: tt, b: nrm3(cross3(R.n, tt)) };
  }
  /** WHERE TWO STRIPS OF A BANDED WEAVE REALLY CROSS (crossing a of strip si, as its w.path counts them) — and the plane
   *  they share there. A strip follows the line of its own lattice strand, a spline through that strand's
   *  crossings, moved sideways: two such lines meet exactly only at a crossing of the lattice. Everywhere else the
   *  place bands.js counts for the crossing lies a little off along either strip, and the two lines pass over each
   *  other at a distance — on the sphere a few tenths of a strip's thickness, on the Bunny more than a thickness at
   *  one crossing in seven (up to thirteen): there the strip beneath came out on top of the one that should cover it.
   *  WeaveSim settles this by contact (theory §8): the gap of two laths along their common normal is what their two
   *  sections need, and what is missing pushes them apart, equal and opposite. Nothing is simulated here, so the end
   *  of that is built in: the place is found (three steps of Newton, never more than one strip width from where it
   *  was counted), and the two strips are given one plane to share there — through the point half-way between their
   *  two lines, across the mean of their two normals. Over the whole place they share, each strip lies in that plane
   *  (_plyCurve: lie) — the one beneath in it, the one on top one thickness above — whatever its own line does there.
   *  → { t: where along this strip (as path.tau), to: where along the other, pc, pn: a point of the plane and its
   *  normal (pn null: the two do not meet where they are counted to) } — one record for the two strips of a crossing;
   *  null where there is none */
  _crossing(si, a) {
    const wv = this.w, P1 = wv.path[si], so = P1.ps[a]; if (so < 0) return null;
    const ao = P1.pa[a], first = si < so || (si === so && a <= ao), key = first ? si * 1e6 + a : so * 1e6 + ao;
    if (!this._xing) this._xing = new Map();
    let R = this._xing.get(key);
    if (!R) {
      const [sa, ia, sb, ib] = first ? [si, a, so, ao] : [so, ao, si, a], PA = wv.path[sa], PB = wv.path[sb], W = this.opts.width;
      const speed = (pp, t) => { const p = this._beside(pp, t - 0.01).p, q = this._beside(pp, t + 0.01).p; return Math.max(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 0.02, 1e-9); };
      const t0a = PA.tau[ia], t0b = PB.tau[ib], va = speed(PA, t0a), vb = speed(PB, t0b), ra = W / va, rb = W / vb;
      let ta = t0a, tb = t0b, off = 0, pc = null, pn = null;
      for (let it = 0; it < 4; it++) {
        const A = this._beside(PA, ta), B = this._beside(PB, tb), n = nrm3([A.n[0] + B.n[0], A.n[1] + B.n[1], A.n[2] + B.n[2]]), d = sub3(B.p, A.p);
        const flat = (x) => { const k = dot3(x, n); return [x[0] - k * n[0], x[1] - k * n[1], x[2] - k * n[2]]; }, ua = flat(A.t), ub = flat(B.t), dd = flat(d);
        off = Math.hypot(dd[0], dd[1], dd[2]); pc = [0.5 * (A.p[0] + B.p[0]), 0.5 * (A.p[1] + B.p[1]), 0.5 * (A.p[2] + B.p[2])]; pn = n; if (it === 3) break;
        const a11 = dot3(ua, ua), a12 = -dot3(ua, ub), a22 = dot3(ub, ub), r1 = dot3(dd, ua), r2 = -dot3(dd, ub), det = a11 * a22 - a12 * a12; if (det < 0.03) break;   // (the two run side by side: no place to find)
        ta = Math.max(t0a - ra, Math.min(t0a + ra, ta + (r1 * a22 - a12 * r2) / det / va));
        tb = Math.max(t0b - rb, Math.min(t0b + rb, tb + (a11 * r2 - a12 * r1) / det / vb));
      }
      if (off > 0.25 * W) pn = null;                               // (they do not meet where they are counted to: nothing to go by)
      R = { ta, tb, pc, pn }; this._xing.set(key, R);
    }
    return first ? { t: R.ta, to: R.tb, pc: R.pc, pn: R.pn } : { t: R.tb, to: R.ta, pc: R.pc, pn: R.pn };
  }
  /** A STRIP OF A BANDED WEAVE (guests.js, bands.js: the star weave — every strand of the lattice in n strips). The strips
   *  of a band lie against each other, a hair apart: each is the line of the band's lattice strand moved sideways by its
   *  place in the band (w.path[si]: host, off) — true parallels, so they stay side by side round every bend. A crossing
   *  of the strip lies at `tau` along that line (crossing index of the host + fraction); a segment of the strip runs
   *  from one of its crossings to the next.
   *
   *  THE HEIGHT IS A SEAT (Ji, 20 Nov: at the corners of a centre the strip beneath showed through the one on top —
   *  "perhaps you could try to solve it by looking at weavesim", its contact, theory §8: two laths cannot occupy the
   *  same space; a section that is turned against the other needs more room, and the push that keeps the two apart
   *  turns it back until it lies flat). Nothing is simulated here, so the end of that is built in: where two strips
   *  cross, both lie FLAT over the whole place they share — the one beneath on whatever it lies on, the one on top one
   *  thickness higher — and a strip changes its layer only between such places:
   *    · on a strip it lies on: one layer up over all of that strip's width (two of them side by side carry it across
   *      the hair between them);
   *    · under a strip that lies on it: flat — it does not begin to rise there;
   *    · between a strip it lies on and the next one of the same band, when that one lies on it: down within the hair
   *      between the two (and the last `dip` of the first one's width) — a step as steep as the hair is narrow;
   *    · beyond the last strip it lies on: down over `run`, or sooner where a strip that lies on it begins.
   *  The edge of a strip runs askew across this one (60° and more), so a seat is a parallelogram, and the sections that
   *  bound it are askew too (`seams`: where the edge of every strip it crosses meets this one's centreline, and how
   *  much sooner or later its two edges). With sections straight across, the corners of a seat were ramps a third of a
   *  strip width long in which the strip on top was half-way down and the one beneath half-way up: there they showed
   *  through each other. Over the overlap of a joint: two layers up.
   *
   *  AND ITS LIE IS THE PLANE THE TWO SHARE (`lie`; why: _crossing). The two strips of a crossing follow two different
   *  lines, which pass over each other at a distance and at a slant — so over the place they share both are laid into
   *  one plane, half-way between the two lines; from one such place to the next the strip goes straight from the one
   *  plane to the other. Layers are counted from that plane.
   *  → { nseg, point(j, u, flat) } as _strandCurve, and frame(j, u), level(j, p, u), lie(j, p, normal, u),
   *  pressed(j, p, u), seams(j, uA, uB, half-width, length), dzKnot(i): the lie at the strip's i-th crossing */
  _plyCurve(si) {
    const wv = this.w, s = wv.strands[si], K = s.knots.length, nseg = s.closed ? K : K - 1, path = wv.path[si], H = this._hostCurve(path.host), Kh = H.K;
    const W = this.opts.width, thk = this.opts.thickness, lift = 0.015 * this.opts.a, sg = this.sideSign, hw = Math.max(W / 2, 1e-9), flip = wv.side < 0;
    const pitch = Math.max(path.pitch || W, W), dip = 0.04 * W, run = 0.3 * W, skin = 0.02 * W, tol = 1e-7 * W;
    const beside = (pp, t) => this._beside(pp, t);
    const idx = (i) => (path.kn ? path.kn[i] : i), nQ = path.n;
    const across = (p, S) => (p[0] - S.x[0]) * S.perp[0] + (p[1] - S.x[1]) * S.perp[1] + (p[2] - S.x[2]) * S.perp[2];   // how far p lies from the line of strip S, to either side
    // every crossing of the strip: the line of the strip it crosses there (a point of it, and the direction across it),
    // whether this strip lies on that one, how many strips lie on each other there (2 in the overlap of a joint) — and,
    // on either side of that line, how far this strip is fully up (pe) and where it is down again (re)
    const X = new Array(nQ).fill(null);
    for (let a = 0; a < nQ; a++) {
      if (path.ps[a] < 0) continue;
      const pp = wv.path[path.ps[a]], R = this._crossing(si, a), c = beside(pp, R.to), over = (path.ov[a] === 1) !== flip;   // (the other strip's line where the two really cross)
      X[a] = { x: c.p, perp: c.b, over, host: pp.host, wt: over ? Math.max(1, this._layers(path.ps[a])[pp.ki ? pp.ki[path.pa[a]] : path.pa[a]] | 0) : 0, pe: [hw, hw], re: [hw + run, hw + run],
        two: (this._layers(si)[path.ki ? path.ki[a] : a] | 0) > 1,   // (two: this strip is two strips thick here itself — the overlap of a joint)
        t: R.t, pc: R.pc, pn: R.pn, dir: 1, dz: 0 };               // (where along this strip, the plane the two share there — _crossing; dir, dz: below)
      // (dir: which way along this strip the distance from the other's line counts; dz: how far the plane lies above this strip's own line where the two cross)
      const own = beside(path, R.t); X[a].dir = dot3(own.t, c.b) < 0 ? -1 : 1;
      if (R.pn) { const k = sg * dot3(R.pn, own.n); X[a].dz = Math.abs(k) > 1e-6 ? dot3(R.pn, sub3(R.pc, own.p)) / k : 0; }
    }
    for (let a = 0; a < nQ; a++) {
      const S = X[a]; if (!S || !S.over) continue;
      for (const nb of [a - 1, a + 1]) {                           // the strips of the same band on either side of it
        const b = s.closed ? ((nb % nQ) + nQ) % nQ : nb; if (b < 0 || b >= nQ || b === a) continue;
        const N = X[b]; if (!N || N.host !== S.host) continue;
        const dN = across(N.x, S), D = Math.abs(dN), k = dN >= 0 ? 0 : 1; if (D > 1.6 * pitch || D < 0.4 * pitch) continue;
        if (N.over) { S.pe[k] = D / 2 + tol; S.re[k] = D / 2 + run; }                                   // it carries this strip too: no dip between the two
        else { S.pe[k] = Math.max(0.2 * hw, hw - dip); S.re[k] = Math.max(S.pe[k] + 0.02 * W, D - hw); }   // it lies on this strip: down by its edge
      }
    }
    const reach = (path.per | 0) + 1, bias = 0.012 * thk * ((si * 7) % 5);   // (bias: two strips never in one plane where a band is wider than the lattice allows)
    const near = (j) => { const a0 = idx(j) - reach, a1 = (j + 1 < K ? idx(j + 1) : idx(0) + nQ) + reach, S = []; for (let q = a0; q <= a1; q++) { const a = s.closed ? ((q % nQ) + nQ) % nQ : q; if (a >= 0 && a < nQ && X[a] && !S.includes(X[a])) S.push(X[a]); } return S; };
    const nearOf = new Map(), sitesOf = (j) => { let S = nearOf.get(j); if (!S) { S = near(j); nearOf.set(j, S); } return S; };
    /** THE LIE OF THE STRIP at p, a point of its own flat ribbon beside segment j (nn: the normal its section stands
     *  on): how far the plane it shares with the strip it crosses there lies above the ribbon. Inside the place two
     *  strips share: that plane, all of it, tilt and all — both strips lie in it, so the one on top is on top to its
     *  corners. Between two such places: straight from the one plane's height to the next one's (so that nothing bends
     *  where no section stands), each plane's tilt fading out within three quarters of a strip width of its place.
     *  (Why: _crossing.) */
    const fade = 0.75 * W, round = s.closed ? Kh : 0;
    // (the strips a point of the strip has to do with — at u of segment j: the crossing nearest to it along the strip and
    //  two on either side; never one further on whose line, drawn out straight, happens to pass by)
    let pk = null, pk0 = 0, pk1 = 0;
    const pick = (j, u) => {
      pk = sitesOf(j); const n = pk.length; pk0 = 0; pk1 = n; if (n <= 5) return;
      const [t0, t1] = span(j), t = t0 + u * (t1 - t0); let k0 = 0, best = Infinity;
      for (let k = 0; k < n; k++) { let d = pk[k].t - t; if (round) d -= round * Math.round(d / round); d = Math.abs(d); if (d < best) { best = d; k0 = k; } }
      pk0 = Math.max(0, k0 - 2); pk1 = Math.min(n, k0 + 3);
    };
    const lie = (j, p, nn, u) => {
      let m = null, em = Infinity, q = null, eq = Infinity;       // the strip passed last, and the one that comes next: how far their lines are behind and ahead
      pick(j, u); for (let i = pk0; i < pk1; i++) { const S = pk[i], e = across(p, S) * S.dir; if (e >= 0) { if (e < em) { em = e; m = S; } } else if (-e < eq) { eq = -e; q = S; } }
      if (!m && !q) return 0;
      const plane = (S) => { if (!S.pn) return 0; const k = dot3(S.pn, nn); return Math.abs(k) > 0.2 ? S.dz + Math.max(-0.6 * W, Math.min(0.6 * W, dot3(S.pn, sub3(S.pc, p)) / k - S.dz)) : S.dz; };   // (never further from the strip's own lie than a strip would bend)
      const gm = m ? em - hw : Infinity, gq = q ? eq - hw : Infinity;   // (how far outside either place)
      if (gm <= tol && gq <= tol) return 0.5 * (plane(m) + plane(q));
      if (gm <= tol) return plane(m);
      if (gq <= tol) return plane(q);
      const part = (S, g) => S.dz + (plane(S) - S.dz) * Math.max(0, 1 - g / fade);
      if (!q) return part(m, gm);
      if (!m) return part(q, gq);
      const f = gm / (gm + gq);
      return (1 - f) * part(m, gm) + f * part(q, gq);
    };
    /** the layer of the strip at point p beside segment j: 0 on the surface, 1 on a strip … */
    const level = (j, p, u) => {
      let L = 0, cap = 1, seat = 0, under = false;
      pick(j, u); for (let i = pk0; i < pk1; i++) {
        const S = pk[i], d = across(p, S), ad = Math.abs(d);
        if (!S.over) { if (ad <= hw + tol) under = true; continue; }
        const k = d >= 0 ? 0 : 1; if (ad >= S.re[k]) continue;
        if (S.wt > cap) cap = S.wt;
        if (ad <= S.pe[k] + tol) { L += S.wt; seat += S.wt; } else L += S.wt * (S.re[k] - ad) / (S.re[k] - S.pe[k]);
      }
      return Math.min(cap, under ? seat : L);                     // under a strip that lies on it: flat, on what it lies on there
    };
    /** is the strip pressed flat at p: under a strip that lies on it and has room for one strip only — the end of a
     *  joint that comes down past the strip it is joined to is down by the edge of such a strip (setLaths: raise) */
    const pressed = (j, p, u) => { pick(j, u); for (let i = pk0; i < pk1; i++) { const S = pk[i]; if (!S.over && !S.two && Math.abs(across(p, S)) <= hw + tol) return true; } return false; };
    const span = (j) => { const t0 = path.tau[idx(j)]; let t1 = path.tau[idx((j + 1) % K)]; if (s.closed && j === K - 1) t1 += Kh; return [t0, t1]; };   // (a closed strip: its last segment goes on round the host's line)
    /** the strip's line at u of its segment j: the point on the surface, the normal, the tangent and the direction across */
    const flat0 = lift + 0.5 * thk + bias;                          // (the middle of the strip's thickness when it lies on its own line; base: with its lie on the centreline)
    const frame0 = (j, u) => { const [t0, t1] = span(j), C = beside(path, t0 + u * (t1 - t0)), nn = [sg * C.n[0], sg * C.n[1], sg * C.n[2]]; return { c: C.p, n: nn, t: C.t, b: nrm3(cross3(nn, C.t)), flat: flat0 }; };
    const frame = (j, u) => { const F = frame0(j, u); F.base = flat0 + lie(j, F.c, F.n, u); return F; };
    /** the section straight across at u: the frame, and the layer at the edge on the side of +b, on the centreline and at the other edge */
    const sect = (j, u) => { const F = frame(j, u), c = F.c, b = F.b; F.L = [level(j, [c[0] + hw * b[0], c[1] + hw * b[1], c[2] + hw * b[2]], u), level(j, c, u), level(j, [c[0] - hw * b[0], c[1] - hw * b[1], c[2] - hw * b[2]], u)]; return F; };
    /** THE SEAMS of segment j between uA and uB: the lines at which the layer of the strip begins or ends to change —
     *  the edges of the seats on the strips it lies on, where it is down again, the edges of the strips that lie on it.
     *  Each as the places along the strip (arc from the segment's start; the segment is `len` long) of its edge on the
     *  side of +b, of its centreline and of its other edge: [s₊, s₀, s₋] — he: half the width of the strip as it is drawn */
    const seams = (j, uA, uB, he, len) => {
      const S = sitesOf(j); if (!S.length) return [];
      const FA = frame0(j, uA), FB = frame0(j, uB), out = [], more = 3 * he / len;   // (a seam that crosses the centreline a little before or after this part can still cut a corner of it)
      for (const Sx of S) {
        const dA = across(FA.c, Sx), dB = across(FB.c, Sx); if (Math.abs(dB - dA) < 1e-12) continue;
        // (… and the edges of every strip it crosses: there its lie changes from the plane of that place to the way to the next)
        for (const tg of Sx.over ? [Sx.pe[0], Sx.re[0], -Sx.pe[1], -Sx.re[1], ...(Math.abs(Sx.pe[0] - hw) > 0.01 * W ? [hw] : []), ...(Math.abs(Sx.pe[1] - hw) > 0.01 * W ? [-hw] : [])] : [hw, hw + skin, -hw, -hw - skin]) {
          const u = uA + (tg - dA) / (dB - dA) * (uB - uA); if (!(u > uA - more && u < uB + more)) continue;
          let uc = Math.max(uA, Math.min(uB, u)), tp = 0, bp = 0, s1 = 0, fc = null;
          for (let it = 0; it < 4; it++) {                         // (the line bends: on to where it meets the seam — or to the end of the part, when that comes first — so that the corners are told from the frame the section is drawn from, and lie on the seam to the last digit: `level` asks on which side of it a corner is)
            const F = frame0(j, uc); tp = F.t[0] * Sx.perp[0] + F.t[1] * Sx.perp[1] + F.t[2] * Sx.perp[2]; bp = F.b[0] * Sx.perp[0] + F.b[1] * Sx.perp[1] + F.b[2] * Sx.perp[2];
            fc = F.c; if (Math.abs(tp) < 0.08) break;
            s1 = uc * len + (tg - across(F.c, Sx)) / tp;
            const un = Math.max(uA, Math.min(uB, s1 / len)); if (Math.abs(un - uc) * len < 1e-10 * W) break; uc = un;
          }
          if (Math.abs(tp) < 0.08) continue;                      // (the two run almost side by side there: no seam across this strip)
          if (Math.hypot(fc[0] - Sx.x[0], fc[1] - Sx.x[1], fc[2] - Sx.x[2]) > 5 * W) continue;   // (not that strip itself: its line drawn out straight, far from where the two cross)
          const sh = he * bp / tp;                                // the edge on the side of +b meets the seam this much sooner
          out.push([s1 - sh, s1, s1 + sh]);
        }
      }
      return out;
    };
    const point = (j, u, flat) => {
      if (flat) { const [t0, t1] = span(j), C = beside(path, t0 + u * (t1 - t0)); return { p: C.p, n: [sg * C.n[0], sg * C.n[1], sg * C.n[2]] }; }
      const S = sect(j, u), hcn = S.base + S.L[1] * thk, q = { p: [S.c[0] + hcn * S.n[0], S.c[1] + hcn * S.n[1], S.c[2] + hcn * S.n[2]], n: S.n };
      if (S.L[0] !== S.L[1] || S.L[2] !== S.L[1]) { q.kp = (S.L[0] - S.L[1]) * thk / hw; q.km = (S.L[1] - S.L[2]) * thk / hw; }
      return q;
    };
    return { nseg, point, sect, frame, level, seams, pressed, lie, dzKnot: (i) => (i < nseg ? frame(i, 0) : frame(Math.max(0, i - 1), 1)).base - flat0 };
  }
  _curveAt(si, j, u, flat = false) {
    const C = this._strandCurve(si), eps = 0.02, q = C.point(j, u, flat), a = C.point(j, u - eps, flat), b = C.point(j, u + eps, flat);
    let t = sub3(b.p, a.p); if (Math.hypot(...t) < 1e-12) t = sub3(C.point(j, 1, flat).p, C.point(j, 0, flat).p);
    return { p: q.p, n: q.n, t: nrm3(t), kp: q.kp, km: q.km, bv: q.bv };
  }
  /** where a hanging stub leaves piece pc beyond its knot m (fwd: along the walk, else back): past the crossing section
   *  (the laid box beside the crossing) along the curve's tangent there → {c0, n, t, used} (used: strip length taken) */
  _stubStart(si, pc, m, fwd) {
    const dir = this.walkDir(si), i = pc.knots[m], j = this.walkSeg(si, pc.q0 + (fwd ? m : m - 1));
    if (j < 0) { const F0 = this._knotFrame(si, i); return { c0: [F0.p[0] + F0.h * F0.n[0], F0.p[1] + F0.h * F0.n[1], F0.p[2] + F0.h * F0.n[2]], n: F0.n, t: this._knotTangent(si, i).map(x => (fwd ? 1 : -1) * dir * x), used: 0 }; }
    const cs = this.w.cover && this.w.strands[si].guest ? 0 : CROSS_SEC;   // (a strip beside a strand of a banded weave has no crossing section: its remainder hangs from the crossing itself)
    const fromA = (fwd ? dir > 0 : dir < 0), u = fromA ? cs : 1 - cs, c = this._curveAt(si, j, u, false);
    return { c0: c.p, n: c.n, t: fromA ? c.t : neg3(c.t), used: cs * this.segLenOf(si, j) };
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
      secs.push({ p: [c.p[0] + r * c.n[0], c.p[1] + r * c.n[1], c.p[2] + r * c.n[2]], n: c.n, t: c.t, kp: c.kp, km: c.km, bv: c.bv });
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
    const NONE = { s0: 0, wIn: 0, sIn: 0, s1: FAR, h0: -1, h1: -1 };
    const weaverOfPiece = (pid) => (pid >= 0 && plan.pieceList[pid] && plan.pieceList[pid].weaver >= 0 ? plan.pieceList[pid].weaver : 0);
    const stepWeaver = (kStep) => (kStep >= 0 && kStep < plan.steps.length && plan.steps[Math.floor(kStep)].weaver >= 0 ? plan.steps[Math.floor(kStep)].weaver : -1);
    this._curves = null; this._hosts = null; this._xing = null; this._band = null; this._tband = null; this._layerOf = null;  // the strand curves follow the lath side, the width and the plan's joints
    const stepCell = (kStep) => kStep >= 0 && kStep < plan.steps.length ? plan.steps[Math.floor(kStep)].cellIdx : -1;   // the cell at which a crossing is made
    const push = (D, p, nn, si, pid, at, arc = -99) => { D.pos.push(...p); D.nrm.push(...nn); D.col.push(0, 0, 0); D.col2.push(0, 0, 0); for (const k of ATTR) D[k].push(k === 'pid' ? pid : k === 'arc' ? arc : k === 'ws' ? 1 + (at.wv !== undefined ? at.wv : weaverOfPiece(pid)) + (at.wall ? 64 : 0) : at[k]); D.vertStrand.push(si); D.vertPiece.push(pid); };
    const sweep = (D, secs, si, pid, at0, wd, th, atOf = null, arcs = null) => {   // atOf(i): the attributes of the i-th box, else `at`; arcs[i]: the place of section i along its strip
      // (a section can tilt and bend across the strip — s.kp, s.km: height per width on either side of the centreline —
      //  and run askew — s.bv, in place of straight across: a pattern with stacks, see _strandCurve; the top and the
      //  bottom of such a box are two faces, one on either side)
      const corner = (s, dw, dh) => { const b = s.bv || nrm3(cross3(s.n, s.t)), hk = dh + dw * ((dw >= 0 ? s.kp : s.km) || 0); return [s.p[0] + dw * b[0] + hk * s.n[0], s.p[1] + dw * b[1] + hk * s.n[1], s.p[2] + dw * b[2] + hk * s.n[2]]; };
      for (let i = 0; i + 1 < secs.length; i++) {
        const A = secs[i], B = secs[i + 1], bA = nrm3(cross3(A.n, A.t)), bB = nrm3(cross3(B.n, B.t)), at = atOf ? atOf(i) : at0, nA = neg3(A.n), nB = neg3(B.n);
        const faces = A.kp !== undefined || B.kp !== undefined
          ? [{ nA: A.n, nB: B.n, q: [[-1, 1], [0, 1]] }, { nA: A.n, nB: B.n, q: [[0, 1], [1, 1]] }, { nA, nB, q: [[1, -1], [0, -1]] }, { nA, nB, q: [[0, -1], [-1, -1]] }, { nA: bA, nB: bB, q: [[1, 1], [1, -1]] }, { nA: neg3(bA), nB: neg3(bB), q: [[-1, -1], [-1, 1]] }]
          : [{ nA: A.n, nB: B.n, q: [[-1, 1], [1, 1]] }, { nA, nB, q: [[1, -1], [-1, -1]] }, { nA: bA, nB: bB, q: [[1, 1], [1, -1]] }, { nA: neg3(bA), nB: neg3(bB), q: [[-1, -1], [-1, 1]] }];
        for (const f of faces) {
          const v0 = D.pos.length / 3;
          const c = [corner(A, f.q[0][0] * wd / 2, f.q[0][1] * th / 2), corner(A, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[1][0] * wd / 2, f.q[1][1] * th / 2), corner(B, f.q[0][0] * wd / 2, f.q[0][1] * th / 2)];
          const nn = [f.nA, f.nA, f.nB, f.nB];
          for (let k = 0; k < 4; k++) push(D, c[k], nn[k], si, pid, at, arcs ? arcs[k < 2 ? i : i + 1] : -99);
          D.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2); D.faceStrand.push(si, si); D.facePiece.push(pid, pid);
        }
      }
      // the two ends
      for (const [S, flip, at, arc] of [[secs[0], -1, atOf ? atOf(0) : at0, arcs ? arcs[0] : -99], [secs[secs.length - 1], 1, atOf ? atOf(secs.length - 2) : at0, arcs ? arcs[secs.length - 1] : -99]]) {
        const v0 = D.pos.length / 3, nn = flip < 0 ? neg3(S.t) : S.t;
        const c = [corner(S, -wd / 2, -th / 2), corner(S, wd / 2, -th / 2), corner(S, wd / 2, th / 2), corner(S, -wd / 2, th / 2)];
        for (let k = 0; k < 4; k++) push(D, c[k], nn, si, pid, at, arc);
        if (flip < 0) D.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); else D.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        D.faceStrand.push(si, si); D.facePiece.push(pid, pid);
      }
    };
    const stubs = [], cutsAt = [];
    // THE LATH OF A BANDED WEAVE (w.cover — the star weave: flat strips a hair apart, a crossing every strip width). A
    // strip lies flat where it crosses another — on it, or under it — and changes its layer between two such places,
    // often within the hair between two strips of the band it crosses (_plyCurve: the seat). The edges of those places
    // run askew across the strip, so its sections do too: one along every seam (`seams`), its three corners — the two
    // edges and the middle — each at its own place along the strip, so that the seat is one flat piece from edge to
    // edge and the step beside it is a step everywhere at once. A few more sections stand where nothing happens, askew
    // as their neighbours are; the ends of a part are straight across. Along a run of sections the corners are shared;
    // the side walls and the risers of the steps are marked (wall) and drawn darker — on a strip two hundredths of a
    // lattice edge thick that edge line is what lets one read which strip lies on which (Ji, 19 Nov night: "I could
    // clearly read the layer, which is important"; 20 Nov: the strip beneath must not show through).
    const bandPart = (si, j, part, dir) => {
      const C = this._strandCurve(si), len = Math.max(this.segLenOf(si, j), 1e-9), pid = part.pc.id, at = part.at, hwS = (part.level ? 0.72 : 1) * width / 2, uA = part.uA, uB = part.uB;
      const atA = uA === 0 ? { ...at, s0: at.h0, wIn: Math.min(at.wIn, at.h0) } : at, atB = uB === 1 ? { ...at, s0: at.h1, wIn: Math.min(at.wIn, at.h1) } : at;
      const wv0 = stepWeaver(at.h0), wv1 = stepWeaver(at.h1), wvP = weaverOfPiece(pid), wvOf = (u) => { const nearA = u < 0.5; let x = nearA ? wv0 : wv1; if (x < 0) x = nearA ? wv1 : wv0; return x >= 0 ? x : wvP; };
      const own = !w.strands[si].guest, sA = uA * len, sB = uB * len, tiny = 1e-5 * a, maxDs = 0.1 * a, cl = (x) => Math.max(sA, Math.min(sB, x));
      // the seams that cut this part, in a row along the strip; no corner goes back along its edge; the two ends
      const seamsIn = []; for (const s3 of C.seams(j, uA, uB, hwS, len)) if (s3.some(x => x > sA + tiny && x < sB - tiny)) seamsIn.push({ s: s3.map(cl), hard: 0 });
      seamsIn.sort((x, y) => (x.s[1] - y.s[1]) || ((x.s[0] + x.s[2]) - (y.s[0] + y.s[2])));
      const Q = [{ s: [sA, sA, sA], hard: 1 }];
      for (const q of [...seamsIn, { s: [sB, sB, sB], hard: 1 }]) {
        const p = Q[Q.length - 1]; for (let k = 0; k < 3; k++) if (q.s[k] < p.s[k]) q.s[k] = p.s[k];
        if (q.s.every((x, k) => x - p.s[k] <= tiny)) { p.hard = Math.max(p.hard, q.hard); continue; }
        Q.push(q);
      }
      if (Q.length < 2) return;
      // where the attributes change (the ends of the crossing sections and the middle — a strip beside a strand, a guest,
      // is threaded in one go: no crossing sections of its own), and none further apart than a tenth of a lattice edge:
      // sections askew as their neighbours are
      const between = (A, B, f, hard) => ({ s: [0, 1, 2].map(k => A.s[k] + (B.s[k] - A.s[k]) * f), hard });
      const put = (sc, hard) => {
        for (let i = 0; i + 1 < Q.length; i++) {
          const A = Q[i], B = Q[i + 1]; if (sc > B.s[1] + tiny) continue;
          if (sc - A.s[1] <= tiny) A.hard = Math.max(A.hard, hard); else if (B.s[1] - sc <= tiny) B.hard = Math.max(B.hard, hard); else Q.splice(i + 1, 0, between(A, B, (sc - A.s[1]) / (B.s[1] - A.s[1]), hard));
          return;
        }
      };
      for (const u of own ? [CROSS_SEC, 0.5, 1 - CROSS_SEC] : wv0 !== wv1 ? [0.5] : []) if (u > uA + 1e-6 && u < uB - 1e-6) put(u * len, 1);
      if (part.kinks) for (const u of part.kinks) if (u > uA + 1e-6 && u < uB - 1e-6) put(u * len, 0);   // (where the end of a joint is down again)
      for (let i = 0; i + 1 < Q.length; i++) { const A = Q[i], B = Q[i + 1], k = Math.ceil((B.s[1] - A.s[1]) / maxDs); if (k > 1) { const add = []; for (let q = 1; q < k; q++) add.push(between(A, B, q / k, 0)); Q.splice(i + 1, 0, ...add); i += add.length; } }
      // the corners of every section — beside the strip's line at the section's middle, each its own way along — and
      // their heights
      const raise = (u, p3) => (typeof part.raise === 'function' ? part.raise(u, C.pressed(j, p3, u)) : part.raise);
      const all = Q.map((q) => {
        const u = Math.max(uA, Math.min(uB, q.s[1] / len)), S = C.frame(j, u);
        const pos = [0, 1, 2].map(k => { const dx = q.s[k] - q.s[1], y = (1 - k) * hwS; return [S.c[0] + dx * S.t[0] + y * S.b[0], S.c[1] + dx * S.t[1] + y * S.b[1], S.c[2] + dx * S.t[2] + y * S.b[2]]; });
        return { S, u, s: q.s, uk: q.s.map(x => x / len), pos, hard: q.hard, h: pos.map((p3, k) => S.flat + C.lie(j, p3, S.n, q.s[k] / len) + C.level(j, p3, q.s[k] / len) * thk + raise(q.s[k] / len, p3)) };
      });
      // (a section where nothing changes — every corner runs straight on from the one before to the one after — is left out again)
      const secs = [all[0]];
      for (let i = 1; i < all.length; i++) {
        const q = all[i], p0 = secs[secs.length - 1], p1 = all[i + 1];
        if (!q.hard && p1 && p1.s[1] - p0.s[1] <= maxDs) {
          let straight = true;
          for (let k = 0; k < 3 && straight; k++) { const d = p1.s[k] - p0.s[k], f = d > tiny ? (q.s[k] - p0.s[k]) / d : 0.5; if (Math.abs(q.h[k] - (p0.h[k] + (p1.h[k] - p0.h[k]) * f)) > 0.04 * thk || (d <= tiny && Math.abs(p1.h[k] - p0.h[k]) > 0.04 * thk)) straight = false; }
          if (straight) continue;
        }
        secs.push(q);
      }
      const nSec = secs.length, us = secs.map(q => [q.u, q.hard]), ht = thk / 2;
      const P = (q, side, dh) => { const k = 1 - side, p3 = q.pos[k], n = q.S.n, h = q.h[k] + dh; return [p3[0] + h * n[0], p3[1] + h * n[1], p3[2] + h * n[2]]; };   // side +1 · 0 · −1, dh: above the middle of the strip's thickness
      const arcOf = (u) => part.m + (dir > 0 ? u : 1 - u), arcAt = (q, side) => arcOf(q.uk[1 - side]), keyOf = new Map();
      const attrs = (i) => {                                       // the attributes of the box from section i to i + 1 (the crossing sections come with their crossing; whose work it is)
        const u0 = us[i][0], u1 = us[i + 1][0], base = !own ? at : uA === 0 && u1 <= CROSS_SEC + 1e-9 ? atA : uB === 1 && u0 >= 1 - CROSS_SEC - 1e-9 ? atB : at, wv = wvOf((u0 + u1) / 2), key = (base === at ? 0 : base === atA ? 1 : 2) * 16 + wv;
        let A = keyOf.get(key); if (!A) { A = { key, top: { ...base, wv }, wall: { ...base, wv, wall: 1 } }; keyOf.set(key, A); } return A;
      };
      const ring = (q, A) => {                                     // ten corners: the top (three), the bottom (three), a wall on either side (two each)
        const v0 = L.pos.length / 3, S = q.S, dn = neg3(S.n);
        for (const sd of [1, 0, -1]) push(L, P(q, sd, ht), S.n, si, pid, A.top, arcAt(q, sd));
        for (const sd of [1, 0, -1]) push(L, P(q, sd, -ht), dn, si, pid, A.top, arcAt(q, sd));
        push(L, P(q, 1, ht), S.b, si, pid, A.wall, arcAt(q, 1)); push(L, P(q, 1, -ht), S.b, si, pid, A.wall, arcAt(q, 1));
        push(L, P(q, -1, ht), neg3(S.b), si, pid, A.wall, arcAt(q, -1)); push(L, P(q, -1, -ht), neg3(S.b), si, pid, A.wall, arcAt(q, -1));
        return v0;
      };
      const quad = (p, q, r, t, want) => {                          // two triangles, facing the way of `want` — told by the quad's two diagonals: two of its corners can be one point (a seam that ends at the end of a part), and one of the two triangles is then all there is
        const at3 = (i) => [L.pos[3 * i], L.pos[3 * i + 1], L.pos[3 * i + 2]], nq = cross3(sub3(at3(r), at3(p)), sub3(at3(t), at3(q)));
        if (nq[0] * want[0] + nq[1] * want[1] + nq[2] * want[2] >= 0) L.idx.push(p, q, r, p, r, t); else L.idx.push(p, r, q, p, t, r);
        L.faceStrand.push(si, si); L.facePiece.push(pid, pid);
      };
      let prev = -1, prevKey = -1;
      for (let i = 0; i + 1 < nSec; i++) {
        const q0 = secs[i], q1 = secs[i + 1], A = attrs(i), ra = A.key === prevKey ? prev : ring(q0, A), rb = ring(q1, A), n0 = q0.S.n, b0 = q0.S.b;
        // the top, in two halves — where the strip steps from one layer to the next within less than its rise, the step
        // is a riser: drawn as a wall, facing the way it looks
        // (each half by itself, and by the corners that rise: where a seam ends at the end of a part two sections share a corner, and a gentle slope beside it is no riser)
        const dh = [0, 1, 2].map(k => q1.h[k] - q0.h[k]), ds = [0, 1, 2].map(k => q1.s[k] - q0.s[k]), steep = (k) => Math.abs(dh[k]) <= 0.05 * thk || Math.abs(dh[k]) > 1.2 * ds[k];
        for (const k of [0, 1]) {
          if (Math.max(Math.abs(dh[k]), Math.abs(dh[k + 1])) > 0.3 * thk && steep(k) && steep(k + 1)) {
            const v0 = L.pos.length / 3, dn = dh[k] + dh[k + 1] < 0 ? 1 : -1, tn = nrm3([dn * q0.S.t[0] + 0.35 * n0[0], dn * q0.S.t[1] + 0.35 * n0[1], dn * q0.S.t[2] + 0.35 * n0[2]]);
            for (const q of [q0, q1]) for (const sd of [1 - k, -k]) push(L, P(q, sd, ht), tn, si, pid, A.wall, arcAt(q, sd));
            quad(v0, v0 + 2, v0 + 3, v0 + 1, tn);
          } else quad(ra + k, rb + k, rb + k + 1, ra + k + 1, n0);
        }
        quad(ra + 3, rb + 3, rb + 4, ra + 4, neg3(n0)); quad(ra + 4, rb + 4, rb + 5, ra + 5, neg3(n0));   // the bottom
        quad(ra + 6, rb + 6, rb + 7, ra + 7, b0); quad(ra + 8, rb + 8, rb + 9, ra + 9, neg3(b0));         // the walls
        prev = rb; prevKey = A.key;
      }
      for (const [q, A, tn] of [[secs[0], attrs(0), neg3(secs[0].S.t)], [secs[nSec - 1], attrs(nSec - 2), secs[nSec - 1].S.t]]) {   // the two ends
        const v0 = L.pos.length / 3; for (const [sd, dh] of [[1, ht], [-1, ht], [-1, -ht], [1, -ht]]) push(L, P(q, sd, dh), tn, si, pid, A.wall, arcAt(q, sd));
        quad(v0, v0 + 1, v0 + 2, v0 + 3, tn);
      }
    };
    w.strands.forEach((s, si) => {
      const K = s.knots.length, nseg = s.closed ? K : K - 1; if (nseg < 1) return;
      const P = plan.pieces[si], dir = this.walkDir(si), cover = new Map();   // original segment index → the parts of pieces on it
      for (const pc of P.list) {
        // (a guest strip — guests.js — is threaded in one go, or laid in as its crossings are made: pc.at says when it
        //  passes each of its crossings, the overlap of its joint included)
        const n = pc.knots.length, kStep = pc.at ? Array.from(pc.at) : pc.knots.map(i => plan.knotStep[s.knots[i]]);
        // the overlap of a joint is not woven by this strip: it is laid over the strip it is joined to when the joint is
        // made (the planner's joint tick) — else when this strip is woven up to it — and never shown before that, even
        // though the crossings under it were made earlier by the other strip (no strip woven at both ends: Ji, 11 Nov)
        // — crossing by crossing, each at its own tick (pc.ovAt: "overlap 1 … k", update 5)
        if (!pc.at) { const oT = Math.min(pc.ovTail | 0, n - 1), oH = Math.min(pc.ovHead | 0, n - 1 - oT), jt = pc.joinAt || {}, ot = pc.ovAt || {};
          if (oT) { const t = Math.max(jt.tail ?? 0, Math.min(kStep[oT], jt.tail ?? Infinity)); for (let m = 0; m < oT; m++) kStep[m] = Math.max(kStep[m], ot[m] ?? t); }
          if (oH) { const t = Math.max(jt.head ?? 0, Math.min(kStep[n - oH - 1], jt.head ?? Infinity)); for (let m = n - oH; m < n; m++) kStep[m] = Math.max(kStep[m], ot[m] ?? t); } }
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
          const at = { s0: tail ? kStep[0] : head ? kStep[n - 1] : Math.max(h0, h1), wIn: tail ? kStep[0] : head ? kStep[n - 1] : Math.max(preMin[m], sufMin[m + 1]), sIn: pc.intro, s1: FAR, h0, h1 };
          if (dir < 0) { const t = at.h0; at.h0 = at.h1; at.h1 = t; }
          // (m: the segment runs from the piece's m-th crossing to its next one; ov: it lies in a joint's overlap — on the
          //  strip this one is joined to, from that strip's last own crossing on)
          const oT = pc.ovTail | 0, oH = pc.ovHead | 0;
          if (!cover.has(j)) cover.set(j, []);
          // (an end that goes on beneath the strip it is joined to — the earlier strip's spare end under the later one, Ji 18 Nov:
          //  "first always on the bottom" — sorts below it: −1)
          const inT = oT > 0 && m <= oT - 1, inH = oH > 0 && m >= n - oH - 1;
          cover.get(j).push({ pc, uA, uB, at, partial: tail || head, m, ov: inT ? (pc.underTail ? -1 : 1) : inH ? (pc.underHead ? -1 : 1) : 0 });
        }
        // the hanging remainder: from the outermost woven crossing straight on, as long as what is left of the piece
        const halfAfter = this.segLenOf(si, this.walkSeg(si, pc.q1)) / 2, halfBefore = this.segLenOf(si, this.walkSeg(si, pc.q0 - 1)) / 2;
        const stubFrom = (m, fwd) => this._stubStart(si, pc, m, fwd);
        const segU = (m, fwd) => this.segLenOf(si, this.walkSeg(si, pc.q0 + (fwd ? m : m - 1))) || this.segLenOf(si, this.walkSeg(si, pc.q0 + (fwd ? m - 1 : m))) || 0.5 * a;   // the length of one step along the strip there
        for (let m = 0; m < n; m++) {
          if (m + 1 < n && sufMin[m + 1] > kStep[m]) {
            let rest = halfAfter; for (let q = m; q + 1 < n; q++) rest += this.segLenOf(si, this.walkSeg(si, pc.q0 + q));
            const f = stubFrom(m, true); rest -= f.used;
            if (rest > 0.05 * a) stubs.push({ si, pc, c0: f.c0, nn: f.n, t: f.t, rest, s0: kStep[m], s1: sufMin[m + 1], arc0: m + f.used / segU(m, true), arc1: m + (f.used + rest) / segU(m, true) });
          }
          if (m > 0 && preMin[m - 1] > kStep[m]) {
            let rest = halfBefore; for (let q = 0; q < m; q++) rest += this.segLenOf(si, this.walkSeg(si, pc.q0 + q));
            const f = stubFrom(m, false); rest -= f.used;
            if (rest > 0.05 * a) stubs.push({ si, pc, c0: f.c0, nn: f.n, t: f.t, rest, s0: kStep[m], s1: preMin[m - 1], arc0: m - f.used / segU(m, false), arc1: m - (f.used + rest) / segU(m, false) });
          }
        }
        // a strip picked up before any of its crossings is made (the first strip of the weave) hangs straight through
        // the place of the crossing it will make first, as long as itself — not on the surface (Design update 6)
        { let mMin = 0; for (let m = 1; m < n; m++) if (kStep[m] < kStep[mMin]) mMin = m;
          if (kStep[mMin] > pc.intro) {
            const F0 = this._knotFrame(si, pc.knots[mMin]), c0 = [F0.p[0] + F0.h * F0.n[0], F0.p[1] + F0.h * F0.n[1], F0.p[2] + F0.h * F0.n[2]], t = this._knotTangent(si, pc.knots[mMin]).map(x => x * dir);
            const after = pc.length - pc.arcOf(mMin), before = pc.arcOf(mMin);
            if (after > 0.05 * a) stubs.push({ si, pc, c0, nn: F0.n, t, rest: after, s0: pc.intro, s1: kStep[mMin], arc0: mMin, arc1: mMin + after / segU(mMin, true) });
            if (before > 0.05 * a) stubs.push({ si, pc, c0, nn: F0.n, t: neg3(t), rest: before, s0: pc.intro, s1: kStep[mMin], arc0: mMin, arc1: mMin - before / segU(mMin, false) });
          } }
        // the joint lines: the end of a piece with a next one, the start of a piece with a previous one
        if (P.nPieces > 1 && (s.closed || pc.p < P.nPieces - 1)) cutsAt.push({ si, pc, j: this.walkSeg(si, pc.q1), s0: kStep[n - 1] });
        if (P.nPieces > 1 && (s.closed || pc.p > 0)) cutsAt.push({ si, pc, j: this.walkSeg(si, pc.q0 - 1), s0: kStep[0] });
      }
      // sweep the parts: the end laid over in a joint lies on top of the strip it is joined to (Ji, update 5: "strip 2 on
      // top of strip 1, between it and the crossing strip") — else the piece picked up later on top of the one already
      // there — a little narrower, and comes down to the surface past the end of the piece below
      for (const [j, parts] of cover) {
        parts.sort((x, y) => (x.ov - y.ov) || (x.pc.intro - y.pc.intro) || (x.pc.p - y.pc.p));
        parts.forEach((part, k) => {
          const lower = parts.slice(0, k).filter(e => e.uA < part.uB && part.uA < e.uB);
          part.level = lower.length;
          part.raise = lower.length ? (u) => { let r = 0; for (const e of lower) { const d = u < e.uA ? e.uA - u : u > e.uB ? u - e.uB : 0; r += thk * Math.max(0, 1 - d / 0.3); } return r; } : 0;
          if (w.cover) {                                             // a strip of a banded weave: its own sections (below)
            // the end laid over in a joint is drawn narrower only where it lies on the strip it is joined to: past that
            // strip's end it has its width again, and is down on what it lies on within little more than half a strip
            // width — at once, by the edge of a strip that lies on it and has room for one strip only (_plyCurve:
            // pressed). (Until 20 Nov it stayed narrow to the end of its segment and came down over a third of it, into
            // the next strip's place: there it showed through the strip on top.)
            if (lower.length) {
              const down = 0.6 * width / Math.max(this.segLenOf(si, j), 1e-9);
              part.raise = (u, flat) => { if (flat) return 0; let r = 0; for (const e of lower) { const d = u < e.uA ? e.uA - u : u > e.uB ? u - e.uB : 0; r += thk * Math.max(0, 1 - d / down); } return r; };
              part.kinks = []; for (const e of lower) part.kinks.push(e.uA - down, e.uB + down);
            }
            const ends = [part.uA, part.uB]; for (const e of lower) for (const u of [e.uA, e.uB]) if (u > part.uA + 1e-9 && u < part.uB - 1e-9 && !ends.some(x => Math.abs(x - u) < 1e-9)) ends.push(u);
            ends.sort((x, y) => x - y);
            for (let c = 0; c + 1 < ends.length; c++) bandPart(si, j, ends.length === 2 ? part : { ...part, uA: ends[c], uB: ends[c + 1], level: lower.filter(e => e.uA < ends[c + 1] - 1e-9 && ends[c] < e.uB - 1e-9).length }, dir);
            return;
          }
          const SUB = 10, at = part.at;                                 // ten boxes: the crossing section (a fifth) ends on a box boundary
          // the crossing section: the boxes within a fifth of the segment of a crossing are laid and coloured as soon as
          // that crossing is made, whatever the segment's other crossing — so the over / under at a crossing shows by
          // colour (Design update 6, "more sections for crossing") — and the colour runs one step past it; they are
          // drawn from then on too (a hanging remainder leaves the strip past them), the rest of the segment as before
          const atA = part.uA === 0 ? { ...at, s0: at.h0, wIn: Math.min(at.wIn, at.h0) } : at, atB = part.uB === 1 ? { ...at, s0: at.h1, wIn: Math.min(at.wIn, at.h1) } : at;
          const uOf = (i) => part.uA + (part.uB - part.uA) * i / SUB;
          // whose work a box is (colour 'by weaver', the History check boxes): the weaver of the nearer of the segment's
          // two crossings, the other one where that end has none — not the weaver who threaded the strip (Ji, 9 Nov:
          // "multiplayer is not multitasking")
          const wv0 = stepWeaver(at.h0), wv1 = stepWeaver(at.h1), wvP = weaverOfPiece(part.pc.id);
          const wvOf = (i) => { const near = uOf(i + 0.5) < 0.5; let x = near ? wv0 : wv1; if (x < 0) x = near ? wv1 : wv0; return x >= 0 ? x : wvP; };
          sweep(L, this._segSections(si, j, SUB, part.raise, false, part.uA, part.uB), si, part.pc.id, at, part.level ? 0.72 * width : width, thk, (i) => ({ ...(part.uA === 0 && uOf(i + 1) <= CROSS_SEC + 1e-9 ? atA : part.uB === 1 && uOf(i) >= 1 - CROSS_SEC - 1e-9 ? atB : at), wv: wvOf(i) }),
            Array.from({ length: SUB + 1 }, (_, i) => part.m + (dir > 0 ? uOf(i) : 1 - uOf(i))));
        });
      }
      for (const c of cutsAt) {
        if (c.si !== si || c.j < 0) continue;
        const part = (cover.get(c.j) || []).find(e => e.pc === c.pc); if (!part) continue;
        const r = typeof part.raise === 'function' ? part.raise(0.5) : 0, q = this._segSections(si, c.j, 2, r, false, 0.45, 0.55)[1];
        const b = nrm3(cross3(q.n, q.t)), e = Math.max(0.02 * a, 0.08 * width), hw = (part.level ? 0.42 : 0.56) * width, hh = 0.62 * thk;
        const box = []; for (const [dw, dh, dt] of [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) box.push([q.p[0] + dw * hw * b[0] + dh * hh * q.n[0] + dt * e * q.t[0], q.p[1] + dw * hw * b[1] + dh * hh * q.n[1] + dt * e * q.t[1], q.p[2] + dw * hw * b[2] + dh * hh * q.n[2] + dt * e * q.t[2]]);
        const wvC = stepWeaver(c.s0), v0 = X.pos.length / 3; for (const p of box) push(X, p, q.n, si, c.pc.id, { ...NONE, s0: c.s0, sIn: c.pc.intro, wv: wvC >= 0 ? wvC : weaverOfPiece(c.pc.id) });
        X.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    });
    for (const st of stubs) {
      const { c0, nn, t } = st, c1 = [c0[0] + st.rest * t[0], c0[1] + st.rest * t[1], c0[2] + st.rest * t[2]];
      const wvS = stepWeaver(st.s0);                               // the weaver who holds it: the one who made the crossing it hangs from
      sweep(H, [{ p: c0, n: nn, t }, { p: c1, n: nn, t }], st.si, st.pc.id, { ...NONE, s0: st.s0, wIn: st.s0, sIn: st.pc.intro, s1: st.s1, wv: wvS >= 0 ? wvS : weaverOfPiece(st.pc.id) }, width, thk, null, [st.arc0, st.arc1]);
    }
    // a ring at every crossing while it is a clip point
    for (let e = 0; e < w.nE; e++) {
      if (plan.rim[e] || w.knotStrands[e].length !== 2 || plan.lockStep[e] <= plan.knotStep[e]) continue;
      const [[sa, ia]] = w.knotStrands[e], F0 = this._knotFrame(sa, ia), p = F0.p, nn = F0.n, s = w.strands[sa], K = s.knots.length;
      const t = this._knotTangent(sa, ia);
      const b = nrm3(cross3(nn, t)), r0 = 0.85 * width, r1 = r0 + Math.max(0.12 * width, 0.02 * a), hc = lift + 2.2 * thk + 0.03 * a, cc = [p[0] + hc * nn[0], p[1] + hc * nn[1], p[2] + hc * nn[2]], NSEG = 14;
      const base = C.pos.length / 3, at = { ...NONE, s0: plan.knotStep[e], s1: plan.lockStep[e], wv: stepWeaver(plan.knotStep[e]) };
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
    this.cutGeo = geo(X); this.cutVertPiece = Int32Array.from(X.vertPiece);
    this._setLayer('cuts', new THREE.Mesh(this.cutGeo, stepify(new THREE.MeshBasicMaterial({ color: this.colFg, side: THREE.DoubleSide }), this.u, 'cut')));
    this._flagPieces();
    this.recolour();
    this.setStep(this.step, this.tick);
  }

  /** the cells a pattern is centred on (the star weave's centres), shown only while they are picked on the model (Ji,
   *  19 Nov: the ring that was always there "blocks the view"): a small ring on each; null / []: none */
  setCentres(cells = null) {
    this.centreCells = cells && cells.length ? cells.slice() : null;
    const w = this.w; if (!w || !this.centreCells) { this._setLayer('centres', null); return; }
    const a = this.opts.a, g = new THREE.Group(), map = this._ringTexture('#' + this.colAccent.getHexString());
    for (const c of this.centreCells) { if (!(c >= 0 && c < w.nV)) continue; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })), p = this.lifted(c, 0.12 * a); sp.position.set(p[0], p[1], p[2]); sp.scale.set(0.42 * a, 0.42 * a, 1); g.add(sp); }
    g.renderOrder = 6; this._setLayer('centres', g.children.length ? g : null);
  }

  /** the light and the vivid colour of a piece: 'piece' (Tol light, one hue per piece) | 'family' (TryTriWeave's three) |
   *  'weaver' (the colour of the weaver who threads it — the laths themselves are coloured by who weaves each part) */
  pieceColours(pid, mode = this.colouring) {
    const plan = this.plan, w = this.w, pc = plan.pieceList[pid], si = pc.strand;
    // by marker (Ji, 18 Nov): a strip the weaver has marked takes its mark's colour, every other strip a neutral grey — a
    // little lighter than the grey of what is not woven yet, so the woven part still reads
    if (mode === 'marker') { const c = this.markOfPiece ? this.markOfPiece.get(pid) : null; if (c) return [c, vivid(c, this.dark)]; return this.dark ? [MARK_REST_DARK, MARK_HAND_DARK] : [MARK_REST, MARK_HAND]; }
    // the centre strips of the hemp leaf (guests.js) are no strand of the lattice and no family: the orange of the sheet
    if (w.strands[si].guest && w.strands[si].kind === 'centre' && (mode === 'piece' || mode === 'family')) return this.dark ? [CENTRE_DARK[0], CENTRE_DARK[1]] : [CENTRE_LIGHT[0], CENTRE_LIGHT[1]];
    if (mode === 'family') { const f = w.family[si] >= 0 ? w.family[si] % 3 : 3; return [plyShade(w.strands[si], FAMILY_LIGHT[f]), vivid(FAMILY_RGB[f], this.dark)]; }
    if (mode === 'weaver') { const rgb = WEAVER_RGB[(pc.weaver >= 0 ? pc.weaver : 0) % WEAVER_RGB.length]; return [WEAVER_LIGHT[(pc.weaver >= 0 ? pc.weaver : 0) % WEAVER_RGB.length], vivid(rgb, this.dark)]; }
    // by part: the part of the shape the strip is threaded in (shape.js ringParts) — the seven largest parts a hue each, the
    // rest grey; by stress: what the shape asks of the strip per length (shape.js strandStress), one hue, light to dark
    if (mode === 'part' && this.figure) { const k = this.figure.partOfPiece[pid]; if (k < 0 || k >= 7) { const g = [this.u.uGrey.value.x, this.u.uGrey.value.y, this.u.uGrey.value.z]; return [g, vivid(g, this.dark)]; } return [WOVEN_RGB[k], vivid(LIGHT_RGB[k], this.dark)]; }
    if (mode === 'stress' && this.figure) { const t = this.figure.stressOfPiece[pid] || 0, c = mix3(STRESS_LO, STRESS_HI, t); return [c, mix3(c, [0, 0, 0], 0.25)]; }
    const h = (plan.label[si] - 1 + 3 * pc.p) % LIGHT_RGB.length; return [plyShade(w.strands[si], WOVEN_RGB[h]), vivid(LIGHT_RGB[h], this.dark)];
  }
  /** the reference marks (Ji, 18 Nov: "there is no colour or reference between their model and the digital 3D canvas …
   *  mark cells or strips as spatial references"): the cells and strips the weaver has marked on the physical piece.
   *  list: [{ kind: 'cell', cell, hex } | { kind: 'strip', piece, hex }]. A marked cell gets a ring in its colour (the
   *  layer 'markers'); with the laths coloured 'by marker' a marked strip takes its colour, the others a neutral grey. */
  setMarkers(list = []) {
    this.markers = list; this.markOfPiece = new Map();
    for (const m of list) if (m.kind === 'strip' && m.piece >= 0) this.markOfPiece.set(m.piece, hex2rgb(m.hex));
    const w = this.w; if (!w || !this.plan) { this._setLayer('markers', null); return; }
    const a = this.opts.a, g = new THREE.Group();
    for (const m of list) {
      if (m.kind !== 'cell' || !(m.cell >= 0 && m.cell < w.nV)) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._ringTexture(m.hex), transparent: true, depthWrite: false })), p = this.lifted(m.cell, 0.13 * a);
      sp.position.set(p[0], p[1], p[2]); sp.scale.set(0.82 * a, 0.82 * a, 1); sp.renderOrder = 6; sp.userData = { kind: 'cell', cell: m.cell, mark: true };
      g.add(sp);
    }
    this._setLayer('markers', g.children.length ? g : null);
    if (this.colouring === 'marker') this.recolour();
  }
  /** an open ring in the mark's colour with a thin edge of the ground, so that it reads on any strip under it */
  _ringTexture(hex) {
    const key = 'mark|' + hex + (this.dark ? '|d' : '|l'); if (this.labelCache.has(key)) return this.labelCache.get(key);
    const S = 128, cv = document.createElement('canvas'); cv.width = S; cv.height = S; const ctx = cv.getContext('2d'), r = S / 2 - 16;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, r, 0, 2 * Math.PI); ctx.lineWidth = 28; ctx.strokeStyle = this.dark ? 'rgba(22,24,26,0.9)' : 'rgba(255,255,255,0.95)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, r, 0, 2 * Math.PI); ctx.lineWidth = 19; ctx.strokeStyle = hex; ctx.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    this.labelCache.set(key, tex); return tex;
  }
  /** what the figure says about every strip: { partOfPiece: Int32Array (rank of its part by size, −1 none), stressOfPiece: Float32Array 0…1 } */
  setFigure(fig) { this.figure = fig; if (this.colouring === 'part' || this.colouring === 'stress') this.recolour(); }
  pieceHex(pid, mode = this.colouring) { const [l, v] = this.pieceColours(pid, mode); return [rgb2hex(l), rgb2hex(v)]; }
  /** the light and the vivid colour of weaver i */
  weaverColours(i) { const k = (i >= 0 ? i : 0) % WEAVER_RGB.length; return [WEAVER_LIGHT[k], vivid(WEAVER_RGB[k], this.dark)]; }
  /** 'by weaver' colours each part of a strip by the weaver who weaves it there (the vertex attribute ws), the other
   *  modes by the piece */
  recolour(mode = this.colouring) {
    this.colouring = mode;
    if (!this.lathGeo) return;
    for (const [g, vp] of [[this.lathGeo, this.lathVertPiece], [this.hangGeo, this.hangVertPiece]]) {
      const c1 = g.attributes.color.array, c2 = g.attributes.color2.array, cache = new Map(), ws = g.attributes.ws.array, byW = mode === 'weaver';
      for (let i = 0; i < vp.length; i++) {
        const wvI = byW ? Math.max(0, (Math.round(ws[i]) % 16) - 1) : 0, key = byW ? -1 - wvI : vp[i];
        let c = cache.get(key); if (!c) { c = byW ? this.weaverColours(wvI) : this.pieceColours(vp[i]); cache.set(key, c); }
        c1[3 * i] = c[0][0]; c1[3 * i + 1] = c[0][1]; c1[3 * i + 2] = c[0][2]; c2[3 * i] = c[1][0]; c2[3 * i + 1] = c[1][1]; c2[3 * i + 2] = c[1][2];
      }
      g.attributes.color.needsUpdate = true; g.attributes.color2.needsUpdate = true;
    }
  }

  setDeactive(mode) { this.u.uDeactive.value = mode === 'surface' ? 0 : mode === 'hidden' ? 2 : 1; this.setStroke(this.step); }
  /** the weavers shown (History bar check boxes): show[i] false hides weaver i's strips, clips, path, dots and badge */
  setWeaverMask(show = null) {
    this.wShow = show && show.length ? show.slice() : null;
    let m = 0; if (this.wShow) this.wShow.forEach((on, i) => { if (!on) m += 2 ** i; });
    this.u.uWHide.value = m;
    if (this.plan) { this.setPath(); this.setActive(this.step); this.setStroke(this.step); }
  }
  weaverShown(i) { return !this.wShow || i < 0 || this.wShow[i] !== false; }
  /** the weaver colour as a three.js colour */
  weaverColour(i) { return new THREE.Color(WEAVER_HEX[(i >= 0 ? i : 0) % WEAVER_HEX.length]); }

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
    this._setBands(st, tick);
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
   *  regular cell closed so far; with several weavers each path and each dot in its weaver's colour, a weaver switched off
   *  in the History bar left out */
  setPath() {
    const w = this.w, plan = this.plan; if (!w || !plan) return;
    const a = this.opts.a, multi = (plan.K || 1) > 1, cur = this.curCell();
    const lineOf = (arr, col, dashed, opacity) => {
      const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(arr), 3));
      if (!dashed) return new THREE.Line(ge, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity }));
      const ln = new THREE.Line(ge, new THREE.LineDashedMaterial({ color: col, dashSize: 0.22 * a, gapSize: 0.16 * a, transparent: true, opacity })); ln.computeLineDistances(); return ln;
    };
    let g = null;
    if (this.visible.path && plan.paths) {                         // one path per weaver, solid through its steps so far
      g = new THREE.Group();
      plan.paths.forEach((P, i) => {
        if (!this.weaverShown(i)) return;
        const col = multi ? this.weaverColour(i) : this.colFg, colAhead = multi ? this.weaverColour(i) : this.colDim;
        const done = [], ahead = [];
        for (const pt of P) { const p = this.lifted(pt.cell, 0.09 * a); if (pt.k <= this.step) done.push(...p); else { if (!ahead.length && done.length) ahead.push(...done.slice(-3)); ahead.push(...p); } }
        if (done.length >= 6) g.add(lineOf(done, col, false, 0.9));
        if (ahead.length >= 6) g.add(lineOf(ahead, colAhead, true, multi ? 0.55 : 0.7));
      });
      g.renderOrder = 4;
    } else if (this.visible.path) {
      g = new THREE.Group();
      const pts = plan.order.map(v => this.lifted(v, 0.09 * a)), done = [], ahead = [];
      for (let i = 0; i < pts.length; i++) { if (i <= cur) done.push(...pts[i]); if (i >= Math.max(cur, 0)) ahead.push(...pts[i]); }
      if (done.length >= 6) g.add(lineOf(done, this.colFg, false, 0.9));
      if (ahead.length >= 6) g.add(lineOf(ahead, this.colDim, true, 0.7));
      g.renderOrder = 4;
    }
    let d = null;
    if (this.visible.path) {
      const cells = [], wv = [];
      for (let v = 0; v < w.nV; v++) { if (this.singularSet.has(v) || !this.isClosed(v)) continue; const i = multi ? this.cellWeaver(v) : 0; if (!this.weaverShown(i)) continue; cells.push(v); wv.push(i); }
      if (cells.length) {
        d = new THREE.Group();
        const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.07 * a, 0.115 * a, 18), new THREE.MeshBasicMaterial({ color: multi ? 0xffffff : this.colFg, side: THREE.DoubleSide }), cells.length);
        const fill = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07 * a, 18), new THREE.MeshBasicMaterial({ color: this.dark ? 0x26282c : 0xffffff, side: THREE.DoubleSide }), cells.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1), nn = new THREE.Vector3(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
        cells.forEach((v, k) => { nn.set(w.N[3 * v], w.N[3 * v + 1], w.N[3 * v + 2]).multiplyScalar(this.sideSign); q.setFromUnitVectors(up, nn); pos.fromArray(this.lifted(v, 0.09 * a)); m4.compose(pos, q, sc); ring.setMatrixAt(k, m4); fill.setMatrixAt(k, m4); if (multi) ring.setColorAt(k, this.weaverColour(wv[k])); });
        ring.instanceMatrix.needsUpdate = true; fill.instanceMatrix.needsUpdate = true; if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
        ring.renderOrder = 4; fill.renderOrder = 3; d.add(fill, ring);
      }
    }
    // the picked starts of several weavers: the weaver's letter on a disc of its colour
    if (this.starts && this.starts.length) {
      if (!d) d = new THREE.Group();
      this.starts.forEach((v, i) => { if (v >= 0 && v < w.nV && this.weaverShown(i)) d.add(this._disc(WEAVER[i], WEAVER_HEX[i % WEAVER_HEX.length], this.lifted(v, 0.16 * a), 0.42 * a, { kind: 'cell', cell: v }, false, 0.95, true, '#ffffff')); });
    }
    if (d) { if (!g) g = new THREE.Group(); g.add(d); }
    this._setLayer('path', g);
  }
  /** the weaver of the step that closes cell v */
  cellWeaver(v) { const plan = this.plan, st = plan.steps[plan.stepOf[v]]; return st && st.weaver >= 0 ? st.weaver : 0; }
  /** the starts the weavers were given (cells, one per weaver), drawn as letters on the path layer; null: none */
  setStarts(cells) { this.starts = cells && cells.length ? cells.slice() : null; if (this.plan) this.setPath(); }
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
    const w = this.w, plan = this.plan; if (!w || !plan || step < 0 || step >= plan.steps.length || plan.steps[step].kind === 'done' || plan.steps[step].guest) { this._setLayer('active', null); return; }   // (a guest strip's step — guests.js — is no cell's)
    const st = plan.steps[step], a = this.opts.a, g = new THREE.Group(), closed = st.closes && this.tick >= st.nTicks - 1;
    const multi = (plan.K || 1) > 1, ink = multi ? WEAVER_HEX[(st.weaver >= 0 ? st.weaver : 0) % WEAVER_HEX.length] : this.dark ? '#e4e5e3' : '#404045';
    if (multi && !this.weaverShown(st.weaver)) { this._setLayer('active', null); return; }
    g.add(this._disc(multi || plan.kind === 'sequence' ? WEAVER[st.weaver >= 0 ? st.weaver : 0] : String(st.cellIdx + 1), ink, this.lifted(st.cell, 0.12 * a), 0.4 * a, { kind: 'cell', cell: st.cell }, closed, 0.95, true, closed ? null : (multi || !this.dark ? '#ffffff' : '#1d1f22')));
    this._setLayer('active', g);
  }
  setHover(cell) {
    const w = this.w, plan = this.plan; if (!w || !plan || cell < 0) { this._setLayer('hover', null); return; }
    const a = this.opts.a, g = new THREE.Group();
    g.add(this._disc('', '#E0302A', this.lifted(cell, 0.14 * a), 0.55 * a, { kind: 'cell', cell }, false, 0.95, false));   // a solid red dot (Ji, 9 Nov)
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
  _strokeRaise() { return 0.72 * this.opts.thickness + Math.min(0.015 * this.opts.a, 0.3 * this.opts.thickness); }   // (never higher than a thin strip is thick: Ji, 19 Nov night — on the star's flat strips the bar showed through the strip crossing over it)
  /** a dot at a crossing: on top of the crossing, above whichever strip is over there */
  _knotTop(si, i) {
    const F = this._knotFrame(si, i), w = this.w; let top = 1;
    if (w.level) for (const [s, j] of w.knotStrands[F.e]) top = Math.max(top, w.level(s, j));       // (a pattern three strips deep)
    const r = 0.015 * this.opts.a + (0.5 + top) * this.opts.thickness + this._strokeRaise(); return [F.p[0] + r * F.n[0], F.p[1] + r * F.n[1], F.p[2] + r * F.n[2]];
  }
  /** the full-length stroke of one piece: solid (or dashed) over its woven extent, thin over the remainder — on the
   *  surface, along the hanging stub, or not at all, as the remainder is displayed. `us` = the step uniform. */
  _pieceStroke(D, pc, us, dashed) {
    const w = this.w, plan = this.plan, si = pc.strand, s = w.strands[si], a = this.opts.a, thk = this.opts.thickness, width = this.opts.width;
    const raise = this._strokeRaise(), wd = (dashed ? 0.13 : 0.15) * width, th = 0.4 * thk, thin = 0.07 * width, dir = this.walkDir(si);
    const n = pc.knots.length, kStep = pc.at ? Array.from(pc.at) : pc.knots.map(i => plan.knotStep[s.knots[i]]);
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
      const q = own[own.length - 1], m1 = q.pos, all = own.map(x => x.pos), prev = all.slice(0, -1);
      if (!arrow) { const lo = Math.min(...all), hi = Math.max(...all); if (hi > lo) bar(pc, lo, hi); return; }   // through the last crossing passed, no head
      // the way this tick runs along the strip: the step's direction; in a joint's overlap from the other strip's end
      // into its woven part (q.dir) — the part passed before (on either side) keeps its bar
      const d = q.join ? q.dir : stp.dir, back = prev.filter(m => (d > 0 ? m < m1 : m > m1)), m0 = back.length ? (d > 0 ? Math.min(...back) : Math.max(...back)) : m1;
      if (prev.length) { const lo = Math.min(...prev), hi = Math.max(...prev); if (hi > lo) bar(pc, lo, hi); }
      const ki = pc.knots[m1];
      const sign = d * this.walkDir(si), T = behind(si, ki, sign, tipBack), Bh = behind(si, ki, sign, tipBack + headLen);
      const rr = raise + 0.08 * thk, lift = (c) => [c.p[0] + rr * c.n[0], c.p[1] + rr * c.n[1], c.p[2] + rr * c.n[2]];
      const bb = nrm3(cross3(Bh.n, Bh.t)), base = lift(Bh), tip = lift(T), hw = 0.55 * L;
      tri(A, Bh.n, tip, [base[0] + hw * bb[0], base[1] + hw * bb[1], base[2] + hw * bb[2]], [base[0] - hw * bb[0], base[1] - hw * bb[1], base[2] - hw * bb[2]]);
      const wB = Bh.j >= 0 ? walkPos(pc, Bh.j, Bh.u) : null;
      if (wB === null) {                                             // the strand ends just here: a straight stem
        const tail = [base[0] - stemLen * Bh.t[0], base[1] - stemLen * Bh.t[1], base[2] - stemLen * Bh.t[2]];
        this._strokeBoxes(B, [{ p: tail, n: Bh.n, t: Bh.t }, { p: base, n: Bh.n, t: Bh.t }], wd, th); return;
      }
      const wStart = m1 === m0 ? (() => { const S0 = behind(si, ki, sign, tipBack + headLen + stemLen); return S0.j >= 0 ? walkPos(pc, S0.j, S0.u) : null; })() : m0;
      if (wStart === null) bar(pc, wB - (d > 0 ? 0.3 : -0.3), wB); else bar(pc, wStart, wB + (d > 0 ? 0.004 : -0.004));
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
    const selIds = (this.hoverIds && this.hoverIds.length ? this.hoverIds : this.selPiece >= 0 ? [this.selPiece] : this.selSet ? [...this.selSet] : []).slice(0, 600);
    if (selIds.length) { const D2 = { pos: [], nrm: [], idx: [] }; for (const id of selIds) if (plan.pieceList[id]) this._pieceStroke(D2, plan.pieceList[id], us, true); const g2 = new THREE.Group(); if (D2.pos.length) g2.add(mesh(D2, this.colFg)); g2.renderOrder = 3; this._setLayer('selection', g2.children.length ? g2 : null); }
    else this._setLayer('selection', null);
  }
  selectPiece(id) { this.selPiece = id; this.selRange = null; this.selSet = null; this.u.uSelSet.value = 0; this.u.uSel.value = id; this.u.uSelEnd.value = id; this._flagPieces(); this.setStroke(this.step); }
  /** a set of selected pieces (a click or a window on the Lengths charts); null / [] clears it */
  selectPieces(ids) {
    this.selSet = ids && ids.length ? new Set(ids) : null; this.selPiece = -1; this.selRange = null;
    this.u.uSel.value = -1; this.u.uSelEnd.value = -1; this.u.uSelSet.value = this.selSet ? 1 : 0;
    this._flagPieces(); this.setStroke(this.step);
  }
  /** the pieces under the mouse on a Lengths chart (a strand's strips, a strip, a window being drawn); null ends it */
  hoverPieces(ids) {
    this.hoverIds = ids && ids.length ? ids.slice() : null; this.u.uHover.value = this.hoverIds ? 1 : 0;
    this._flagPieces(); this.setStroke(this.step);
  }
  /** highlight pieces a…b while a bar is hovered (kept for callers of the range form); a < 0 ends it */
  selectRange(a, b = a) { if (a < 0) { this.hoverPieces(null); return; } const ids = []; for (let i = a; i <= b; i++) ids.push(i); this.hoverPieces(ids); }
  /** the per-vertex flags of the laths, remainders and joint lines (ws = weaver + 1 + 16 · flags): 1 selected, 2 hovered */
  _flagPieces() {
    const n = this.plan ? this.plan.pieceList.length : 0, f = new Uint8Array(Math.max(1, n));
    if (this.selSet) for (const id of this.selSet) if (id >= 0 && id < n) f[id] |= 1;
    if (this.hoverIds) for (const id of this.hoverIds) if (id >= 0 && id < n) f[id] |= 2;
    for (const [g, vp] of [[this.lathGeo, this.lathVertPiece], [this.hangGeo, this.hangVertPiece], [this.cutGeo, this.cutVertPiece]]) {
      if (!g || !vp || !g.attributes.ws) continue;
      const a = g.attributes.ws.array; let changed = false;
      for (let i = 0; i < vp.length; i++) { const old = Math.round(a[i]), v = (old % 16) + 16 * (vp[i] >= 0 && vp[i] < n ? f[vp[i]] : 0) + 64 * (Math.floor(old / 64) % 2); if (a[i] !== v) { a[i] = v; changed = true; } }   // (64: the wall flag, kept)
      if (changed) g.attributes.ws.needsUpdate = true;
    }
  }

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
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg3 = (a) => [-a[0], -a[1], -a[2]];
const nrm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
