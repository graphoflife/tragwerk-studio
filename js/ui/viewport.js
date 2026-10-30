// Three.js viewport: model rendering, camera, picking, snapping, tool previews.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { colors3d, LineFactory, label, disposeGroup, makePoints, triangulatePolygon } from './vp-util.js';
import { buildSupports, buildLoads, buildAxes } from './vp-glyphs.js';
import { buildResults } from './vp-results.js';
import { V, P, lineAxes, domainAxes, centroid, modelBounds } from '../core/model.js';
import { sectionOutline } from '../lib/sections.js';
import { h } from './dom.js';
import { t } from '../i18n.js';

const PLANES = {
  XY: { n: [0, 0, 1], map: (u, v, o) => [u, v, o], unmap: (p) => [p[0], p[1]] },
  XZ: { n: [0, 1, 0], map: (u, v, o) => [u, o, v], unmap: (p) => [p[0], p[2]] },
  YZ: { n: [1, 0, 0], map: (u, v, o) => [o, u, v], unmap: (p) => [p[1], p[2]] },
};
export { PLANES };

export class Viewport {
  constructor(container, store) {
    this.el = container;
    this.store = store;
    this.C = colors3d();
    this.lines = new LineFactory();
    this.handler = null;
    this.leftOrbit = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels';
    container.appendChild(this.labelRenderer.domElement);

    this.gizmo = h('div.axis-gizmo');
    container.appendChild(this.gizmo);

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.01, 1e6);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.camera = this.persp;
    this.camera.position.set(12, -16, 10);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a8, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(0.6, -0.9, 1.4);
    this.scene.add(dl);
    this.camLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.scene.add(this.camLight);

    this.groups = {};
    for (const k of ['grid', 'domains', 'model', 'render', 'supports', 'loads', 'axes', 'labels', 'mesh', 'results', 'sel', 'hover', 'tool']) {
      const g = new THREE.Group();
      g.name = k;
      this.groups[k] = g;
      this.scene.add(g);
    }
    this.groups.sel.renderOrder = 20;

    // own pointer handling first (so it can configure OrbitControls before it sees the event)
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.rotateSpeed = 0.9;
    this.controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => this.handler?.leave?.());
    this.canvas.addEventListener('dblclick', (e) => this.handler?.dblclick?.(this.evt(e)));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.raycaster = new THREE.Raycaster();
    this.domainMesh = null;
    this.domainFaceIds = [];
    this.renderPending = false;
    this.animating = null;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    store.on('model', () => { this.dirty('model'); });
    store.on('selection', () => this.dirty('sel'));
    store.on('view', () => this.dirty('model'));
    store.on('results', () => this.dirty('model'));
    store.on('resultView', () => this.dirty('results'));
    store.on('lc', () => this.dirty('loads'));
    this._dirty = new Set(['model']);
    this.flush();
    this.zoomExtents(false);
  }

  /* ---------------- rendering loop ---------------- */
  dirty(what) {
    this._dirty.add(what);
    if (!this._flushQueued) {
      this._flushQueued = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  flush() {
    this._flushQueued = false;
    const d = this._dirty;
    this._dirty = new Set();
    if (d.has('model')) {
      this.computeScale();
      this.buildGrid();
      this.buildModel();
      this.buildOverlays();
      this.buildResults();
      this.buildSelection();
    } else {
      if (d.has('loads')) this.buildOverlays();
      if (d.has('results')) { this.buildModel(); this.buildOverlays(); this.buildResults(); this.buildSelection(); }
      if (d.has('sel')) this.buildSelection();
    }
    this.requestRender();
  }

  requestRender() {
    this.renderCount = (this.renderCount || 0) + 1;
    if (this.renderPending || this.animating) return;
    this.renderPending = true;
    requestAnimationFrame(() => { this.renderPending = false; this.render(); });
  }

  render() {
    this.camLight.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.updateGizmo();
  }

  startAnimation(fn) {
    this.animating = fn;
    const t0 = performance.now();
    const loop = () => {
      if (this.animating !== fn) return;
      fn((performance.now() - t0) / 1000);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stopAnimation() {
    if (!this.animating) return;
    this.animating = null;
    this.requestRender();
  }

  resize() {
    const w = Math.max(1, this.el.clientWidth), hh = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, hh);
    this.labelRenderer.setSize(w, hh);
    this.persp.aspect = w / hh;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.lines.setResolution(w, hh);
    this.width = w; this.height = hh;
    this.requestRender();
  }

  updateOrthoFrustum() {
    const w = Math.max(1, this.el.clientWidth), hh = Math.max(1, this.el.clientHeight);
    const dist = this.camera.position.distanceTo(this.controls?.target || new THREE.Vector3());
    const halfH = this.orthoHalfH || dist * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.left = -halfH * w / hh; this.ortho.right = halfH * w / hh;
    this.ortho.top = halfH; this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }

  setPerspective(on) {
    if ((this.camera === this.persp) === on) return;
    const from = this.camera, to = on ? this.persp : this.ortho;
    const target = this.controls.target.clone();
    if (!on) {
      const dist = from.position.distanceTo(target);
      this.orthoHalfH = dist * Math.tan((this.persp.fov * Math.PI) / 360);
      to.zoom = 1;
      to.position.copy(from.position);
      this.updateOrthoFrustum();
    } else {
      const halfH = this.orthoHalfH / (from.zoom || 1);
      const dist = halfH / Math.tan((this.persp.fov * Math.PI) / 360);
      const dir = from.position.clone().sub(target).normalize();
      to.position.copy(target.clone().add(dir.multiplyScalar(dist)));
    }
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.controls.object = to;
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
  }

  /* ---------------- scale helpers ---------------- */
  computeScale() {
    const b = modelBounds(this.store.model);
    this.bounds = b;
    this.sz = Math.max(0.04, b.size * 0.018);
    this.C = colors3d();
  }

  /* ---------------- grid ---------------- */
  buildGrid() {
    const g = this.groups.grid;
    disposeGroup(g, this.lines);
    const v = this.store.view;
    if (!v.showGrid) return;
    const wp = v.workplane, pl = PLANES[wp.plane];
    let step = v.grid.step || 1;
    const b = this.bounds;
    const [cu, cv] = pl.unmap(b.center);
    const ext = Math.max(b.size * 0.9, step * 10);
    while (ext * 2 / step > 160) step *= 2;
    const u0 = Math.floor((cu - ext) / step) * step, u1 = Math.ceil((cu + ext) / step) * step;
    const v0 = Math.floor((cv - ext) / step) * step, v1 = Math.ceil((cv + ext) / step) * step;
    const minor = [], major = [];
    const isMajor = (x) => Math.abs(Math.round(x / (step * 5)) * step * 5 - x) < step * 1e-3;
    for (let u = u0; u <= u1 + 1e-9; u += step) (isMajor(u) ? major : minor).push(...pl.map(u, v0, wp.offset), ...pl.map(u, v1, wp.offset));
    for (let vv = v0; vv <= v1 + 1e-9; vv += step) (isMajor(vv) ? major : minor).push(...pl.map(u0, vv, wp.offset), ...pl.map(u1, vv, wp.offset));
    const a = this.lines.make(minor, this.C.grid, 1, { opacity: 0.9 });
    const m = this.lines.make(major, this.C.gridMajor, 1.2, { opacity: 0.9 });
    if (a) { a.renderOrder = -2; g.add(a); }
    if (m) { m.renderOrder = -1; g.add(m); }
    // global axes at origin
    const L = Math.max(1, step * 2);
    const ax = [[[0, 0, 0, L, 0, 0], this.C.axisX], [[0, 0, 0, 0, L, 0], this.C.axisY], [[0, 0, 0, 0, 0, L], this.C.axisZ]];
    for (const [pos, col] of ax) { const ln = this.lines.make(pos, col, 2.2); if (ln) g.add(ln); }
  }

  /* ---------------- model ---------------- */
  isResultMode() { return !!this.store.resultView.kind; }

  buildModel() {
    for (const k of ['model', 'domains', 'render', 'labels', 'mesh']) disposeGroup(this.groups[k], this.lines);
    const { model, idx, view } = this.store;
    const C = this.C, ghost = this.isResultMode();
    const hidden = view.hidden;

    // nodes
    if (view.showNodes || view.labelsNodes) {
      const pos = [];
      for (const n of model.nodes) if (!hidden.nodes.has(n.id)) pos.push(n.x, n.y, n.z);
      if (pos.length && view.showNodes && !ghost) this.groups.model.add(makePoints(pos, C.node, 6));
    }

    // lines by type
    const byType = new Map();
    for (const l of model.lines) {
      if (hidden.lines.has(l.id)) continue;
      const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
      if (!a || !b) continue;
      const tp = l.element?.type || 'geom';
      if (!byType.has(tp)) byType.set(tp, []);
      byType.get(tp).push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const renderMode = view.renderMode;
    for (const [tp, pos] of byType) {
      const col = ghost ? C.ghost : (C[tp] ?? C.geom);
      const w = tp === 'geom' ? 1.3 : (renderMode === 'render' ? 1 : 3);
      const ln = this.lines.make(pos, col, ghost ? 1.4 : w, { opacity: renderMode === 'render' && tp !== 'geom' ? 0.5 : 1, dashed: tp === 'rigid' });
      if (ln) this.groups.model.add(ln);
    }

    // domains
    this.buildDomains(ghost);
    if (renderMode === 'render' && !ghost) this.buildRendered();

    // labels
    if (!ghost || view.labelsNodes || view.labelsLines) {
      let count = 0;
      if (view.labelsNodes) {
        for (const n of model.nodes) {
          if (hidden.nodes.has(n.id) || count++ > 1500) continue;
          this.groups.labels.add(label(String(n.id), [n.x, n.y, n.z], 'node'));
        }
      }
      if (view.labelsLines) {
        for (const l of model.lines) {
          if (hidden.lines.has(l.id) || count++ > 3000) continue;
          const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
          this.groups.labels.add(label(String(l.id), [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], 'line'));
        }
        for (const d of model.domains) {
          const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
          this.groups.labels.add(label('D' + d.id, centroid(pts), 'line'));
        }
      }
    }

    // FE mesh
    const mesh = this.store.results.mesh;
    if (view.showMesh && mesh) {
      const pos = [], X = mesh.nodes;
      for (const s of mesh.shells) {
        const nn = s.nodes.filter((x) => x >= 0);
        for (let i = 0; i < nn.length; i++) {
          const a = nn[i], b = nn[(i + 1) % nn.length];
          pos.push(X[3 * a], X[3 * a + 1], X[3 * a + 2], X[3 * b], X[3 * b + 1], X[3 * b + 2]);
        }
      }
      const ln = this.lines.make(pos, C.mesh, 1, { opacity: 0.75 });
      if (ln) this.groups.mesh.add(ln);
      const np = [];
      for (const b of mesh.beams) for (const i of [b.n1, b.n2]) np.push(X[3 * i], X[3 * i + 1], X[3 * i + 2]);
      if (np.length) this.groups.mesh.add(makePoints(np, C.mesh, 4));
    }
  }

  buildDomains(ghost) {
    const { model, idx, view } = this.store;
    const C = this.C;
    this.domainMesh = null;
    this.domainFaceIds = [];
    if (!model.domains.length) return;
    const pos = [], col = [], faceIds = [];
    const outline = [];
    const c = new THREE.Color();
    for (const d of model.domains) {
      if (view.hidden.domains.has(d.id)) continue;
      const pts = d.nodes.map((id) => idx.nodes.get(id)).filter(Boolean).map(P);
      if (pts.length < 3) continue;
      const holes = (d.holes || []).map((hh) => hh.map((id) => P(idx.nodes.get(id))));
      const ax = domainAxes(pts);
      let tri;
      try { tri = triangulatePolygon(pts, holes, ax); } catch (e) { continue; }
      c.set(ghost ? C.ghost : (C[d.type] ?? C.shell));
      for (const t3 of tri.tris) {
        for (const k of t3) { pos.push(...tri.pts[k]); col.push(c.r, c.g, c.b); }
        faceIds.push(d.id);
      }
      for (const ring of [pts, ...holes]) {
        for (let i = 0; i < ring.length; i++) outline.push(...ring[i], ...ring[(i + 1) % ring.length]);
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const wire = view.renderMode === 'wire';
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: wire ? 0.0 : (ghost ? 0.18 : C.domainOpacity),
      side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    this.groups.domains.add(mesh);
    this.domainMesh = mesh;
    this.domainFaceIds = faceIds;
    const ol = this.lines.make(outline, ghost ? C.ghost : C.geom, 1.2, { opacity: 0.8 });
    if (ol) this.groups.domains.add(ol);
  }

  // "Rendered" view: extruded cross-sections and slabs with thickness
  buildRendered() {
    const { model, idx, view } = this.store;
    const C = this.C;
    const groups = new Map();
    const push = (key, tris) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(...tris); };
    for (const l of model.lines) {
      const el = l.element;
      if (!el || view.hidden.lines.has(l.id) || !['beam', 'rib', 'truss'].includes(el.type)) continue;
      const sec = idx.sections.get(el.section);
      if (!sec) continue;
      let ol;
      try { ol = sectionOutline(sec); } catch (e) { ol = null; }
      if (!ol?.outer?.length) continue;
      const a = P(idx.nodes.get(l.n1)), b = P(idx.nodes.get(l.n2));
      push(el.type, extrude(ol, a, b, lineAxes(a, b, el.beta || 0)));
    }
    for (const d of model.domains) {
      if (view.hidden.domains.has(d.id)) continue;
      const pts = d.nodes.map((id) => P(idx.nodes.get(id)));
      const holes = (d.holes || []).map((hh) => hh.map((id) => P(idx.nodes.get(id))));
      const ax = domainAxes(pts);
      push('slab_' + d.type, slab(pts, holes, ax, d.thickness || 0.2));
    }
    for (const [key, tris] of groups) {
      if (!tris.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      geo.computeVertexNormals();
      const tp = key.replace('slab_', '');
      const mat = new THREE.MeshStandardMaterial({
        color: C[tp] ?? C.beam, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
        transparent: key.startsWith('slab'), opacity: key.startsWith('slab') ? 0.92 : 1,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      this.groups.render.add(new THREE.Mesh(geo, mat));
    }
  }

  buildOverlays() {
    for (const k of ['supports', 'loads', 'axes']) disposeGroup(this.groups[k], this.lines);
    const v = this.store.view;
    if (v.showSupports) buildSupports(this, this.groups.supports);
    if (v.showLoads && !this.isResultMode() && this.store.activeLC) buildLoads(this, this.groups.loads, this.store.activeLC);
    if (v.showAxes) buildAxes(this, this.groups.axes);
  }

  buildResults() {
    disposeGroup(this.groups.results, this.lines);
    this.stopAnimation();
    if (!this.isResultMode()) { this.resultInfo = null; return; }
    try {
      this.resultInfo = buildResults(this, this.groups.results);
    } catch (e) {
      console.error(e);
      this.resultInfo = { error: e.message };
    }
    this.store.emit('legend', this.resultInfo);
  }

  /* ---------------- selection highlight ---------------- */
  buildSelection() {
    const g = this.groups.sel;
    disposeGroup(g, this.lines);
    const { selection: s, idx } = this.store;
    const C = this.C;
    if (s.nodes.size) {
      const pos = [];
      for (const id of s.nodes) { const n = idx.nodes.get(id); if (n) pos.push(n.x, n.y, n.z); }
      if (pos.length) { const p = makePoints(pos, C.sel, 11, { depthTest: false }); p.renderOrder = 30; g.add(p); }
    }
    if (s.lines.size) {
      const pos = [];
      for (const id of s.lines) {
        const l = idx.lines.get(id); if (!l) continue;
        const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const ln = this.lines.make(pos, C.sel, 4.5, { depthTest: false });
      if (ln) { ln.renderOrder = 25; g.add(ln); }
    }
    if (s.domains.size) g.add(...this.domainOverlay([...s.domains], C.sel, 0.35));
    this.requestRender();
  }

  domainOverlay(ids, color, opacity) {
    const { idx } = this.store;
    const pos = [], outline = [];
    for (const id of ids) {
      const d = idx.domains.get(id); if (!d) continue;
      const pts = d.nodes.map((n) => P(idx.nodes.get(n)));
      const holes = (d.holes || []).map((hh) => hh.map((n) => P(idx.nodes.get(n))));
      try {
        const tri = triangulatePolygon(pts, holes, domainAxes(pts));
        for (const t3 of tri.tris) for (const k of t3) pos.push(...tri.pts[k]);
      } catch (e) { /* ignore */ }
      for (let i = 0; i < pts.length; i++) outline.push(...pts[i], ...pts[(i + 1) % pts.length]);
    }
    const out = [];
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      m.renderOrder = 22;
      out.push(m);
    }
    const ol = this.lines.make(outline, color, 2.5, { depthTest: false });
    if (ol) { ol.renderOrder = 23; out.push(ol); }
    return out;
  }

  setHover(hit) {
    const key = hit ? hit.kind + hit.id : '';
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    const g = this.groups.hover;
    disposeGroup(g, this.lines);
    if (hit) {
      const { idx } = this.store, C = this.C;
      if (hit.kind === 'node') {
        const n = idx.nodes.get(hit.id);
        if (n) g.add(makePoints([n.x, n.y, n.z], C.hover, 14, { ring: true, depthTest: false }));
      } else if (hit.kind === 'line') {
        const l = idx.lines.get(hit.id);
        if (l) {
          const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
          const ln = this.lines.make([a.x, a.y, a.z, b.x, b.y, b.z], C.hover, 5, { depthTest: false, opacity: 0.85 });
          if (ln) { ln.renderOrder = 24; g.add(ln); }
        }
      } else if (hit.kind === 'domain') {
        g.add(...this.domainOverlay([hit.id], C.hover, 0.22));
      }
    }
    this.requestRender();
  }

  /* ---------------- tool preview ---------------- */
  // segments: rubber band · ghost: preview of transformed geometry · axes: constraint lines {a, b, color}
  // guides: dashed helper lines (e.g. projection of the hovered point onto the constraint)
  setToolPreview({ segments = [], points = [], snap = null, polys = [], ghost = [], axes = [], guides = [] } = {}) {
    const g = this.groups.tool;
    disposeGroup(g, this.lines);
    const C = this.C;
    for (const ax of axes) {
      const ln = this.lines.make([...ax.a, ...ax.b], ax.color, 1.6, { depthTest: false, opacity: 0.85 });
      if (ln) { ln.renderOrder = 38; g.add(ln); }
    }
    if (guides.length) {
      const ln = this.lines.make(guides.flat(), C.mesh, 1.2, { depthTest: false, dashed: true, dashSize: this.sz * 0.35, gapSize: this.sz * 0.25 });
      if (ln) { ln.renderOrder = 39; g.add(ln); }
    }
    if (ghost.length) {
      const ln = this.lines.make(ghost.flat(), C.sel, 2.6, { depthTest: false, opacity: 0.55 });
      if (ln) { ln.renderOrder = 39; g.add(ln); }
    }
    if (segments.length) {
      const ln = this.lines.make(segments.flat(), C.sel, 2.2, { depthTest: false, dashed: false });
      if (ln) { ln.renderOrder = 40; g.add(ln); }
    }
    for (const poly of polys) {
      if (poly.length < 3) continue;
      try {
        const tri = triangulatePolygon(poly, [], domainAxes(poly));
        const pos = [];
        for (const t3 of tri.tris) for (const k of t3) pos.push(...tri.pts[k]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.sel, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
        g.add(m);
      } catch (e) { /* degenerate */ }
    }
    if (points.length) g.add(makePoints(points.flat(), C.sel, 9, { depthTest: false }));
    if (snap) {
      const col = { node: 0x2fae7d, mid: 0x8e6cf0, grid: C.sel, free: 0x9aa1b5, line: 0x3b7ee8, proj: 0xe8a33b, typed: C.sel }[snap.kind] ?? C.sel;
      const p = makePoints(snap.p, col, 18, { ring: true, depthTest: false });
      p.renderOrder = 50;
      g.add(p);
    }
    this.requestRender();
  }

  /* ---------------- events ---------------- */
  evt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, button: e.button, raw: e };
  }

  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { this._down = { x: e.clientX, y: e.clientY, button: 0, touch: true, orbit: true }; return; }
    const orbit = this.leftOrbit || e.altKey;
    this.controls.mouseButtons.LEFT = orbit ? THREE.MOUSE.ROTATE : -1;
    this._down = { x: e.clientX, y: e.clientY, button: e.button, orbit };
    if (e.button === 0 && !orbit) {
      this.canvas.setPointerCapture(e.pointerId);
      this.handler?.down?.(this.evt(e));
    }
  }

  onMove(e) {
    const ev = this.evt(e);
    const d = this._down;
    if (d && d.button !== 0) return; // camera interaction
    if (d && d.orbit) return;
    this.lastMouse = ev;
    this.handler?.move?.(ev, !!d);
  }

  onUp(e) {
    const d = this._down;
    this._down = null;
    if (!d) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    if (d.touch) {
      // a tap acts like a mouse click; a drag has already rotated the view
      if (!moved && !this.leftOrbit) { const ev = this.evt(e); this.handler?.move?.(ev, false); this.handler?.down?.(ev); this.handler?.up?.(ev, false); }
      return;
    }
    if (d.button === 0 && !d.orbit) {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      this.handler?.up?.(this.evt(e), moved);
    } else if (d.button === 2 && !moved) {
      this.handler?.context?.(this.evt(e));
    }
  }

  /* ---------------- projection & picking ---------------- */
  project(p) {
    if (this._camVersion !== this.renderCount) { this.camera.updateMatrixWorld(); this._camVersion = this.renderCount; }
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height, z: v.z, ok: v.z < 1 && v.z > -1 };
  }

  ray(x, y) {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.camera);
    return this.raycaster.ray;
  }

  pick(x, y, filter = { nodes: true, lines: true, domains: true }) {
    const { model, idx, view } = this.store;
    const hidden = view.hidden;
    let best = null;
    if (filter.nodes) {
      let bd = 9;
      for (const n of model.nodes) {
        if (hidden.nodes.has(n.id)) continue;
        const s = this.project([n.x, n.y, n.z]);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = { kind: 'node', id: n.id, p: [n.x, n.y, n.z], z: s.z }; }
      }
      if (best) return best;
    }
    if (filter.lines) {
      let bd = 7;
      const proj = new Map();
      const pj = (id) => { if (!proj.has(id)) { const n = idx.nodes.get(id); proj.set(id, this.project([n.x, n.y, n.z])); } return proj.get(id); };
      for (const l of model.lines) {
        if (hidden.lines.has(l.id)) continue;
        const a = pj(l.n1), b = pj(l.n2);
        if (!a.ok || !b.ok) continue;
        const r = distToSeg(x, y, a, b);
        if (r.d < bd) {
          bd = r.d;
          const pa = P(idx.nodes.get(l.n1)), pb = P(idx.nodes.get(l.n2));
          best = { kind: 'line', id: l.id, t: r.t, p: V.lerp(pa, pb, r.t) };
        }
      }
      if (best) return best;
    }
    if (filter.domains && this.domainMesh) {
      this.ray(x, y);
      const hits = this.raycaster.intersectObject(this.domainMesh, false);
      if (hits.length) {
        const fi = hits[0].faceIndex;
        const p = hits[0].point;
        return { kind: 'domain', id: this.domainFaceIds[fi], p: [p.x, p.y, p.z] };
      }
    }
    return null;
  }

  boxSelect(x0, y0, x1, y1, crossing, filter) {
    const { model, idx, view } = this.store;
    const hidden = view.hidden;
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    const inside = (s) => s.ok && s.x >= minx && s.x <= maxx && s.y >= miny && s.y <= maxy;
    const proj = new Map();
    for (const n of model.nodes) proj.set(n.id, this.project([n.x, n.y, n.z]));
    const out = { nodes: [], lines: [], domains: [] };
    if (filter.nodes) for (const n of model.nodes) if (!hidden.nodes.has(n.id) && inside(proj.get(n.id))) out.nodes.push(n.id);
    if (filter.lines) {
      for (const l of model.lines) {
        if (hidden.lines.has(l.id)) continue;
        const a = proj.get(l.n1), b = proj.get(l.n2);
        const ia = inside(a), ib = inside(b);
        if ((ia && ib) || (crossing && (ia || ib || segRect(a, b, minx, miny, maxx, maxy)))) out.lines.push(l.id);
      }
    }
    if (filter.domains) {
      for (const d of model.domains) {
        if (hidden.domains.has(d.id)) continue;
        const ins = d.nodes.map((id) => inside(proj.get(id)));
        if (ins.every(Boolean) || (crossing && ins.some(Boolean))) out.domains.push(d.id);
      }
    }
    return out;
  }

  /* ---------------- workplane & snapping ---------------- */
  workplanePoint(x, y) {
    const wp = this.store.view.workplane, pl = PLANES[wp.plane];
    const ray = this.ray(x, y);
    const n = new THREE.Vector3(...pl.n);
    const plane = new THREE.Plane(n, -wp.offset);
    const out = new THREE.Vector3();
    if (!ray.intersectPlane(plane, out)) return null;
    return [out.x, out.y, out.z];
  }

  // Object snaps (node, line midpoint, nearest point on line) take priority over workplane snaps
  // (grid, free). Returns { p, kind, obj, label, node?, line? }.
  snap(x, y, { from = null, ortho = false, allowMid = true } = {}) {
    const v = this.store.view;
    const { model, idx } = this.store;
    if (v.snapNodes) {
      const hit = this.pick(x, y, { nodes: true });
      if (hit) return { p: hit.p, kind: 'node', node: hit.id, obj: true, label: t('Knoten {id}', { id: hit.id }) };
    }
    if (v.snapMid && allowMid) {
      let bd = 10, best = null;
      for (const l of model.lines) {
        if (v.hidden.lines.has(l.id)) continue;
        const a = idx.nodes.get(l.n1), b = idx.nodes.get(l.n2);
        const m = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
        const s = this.project(m);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = { p: m, kind: 'mid', line: l.id, obj: true, label: t('Mitte Linie {id}', { id: l.id }) }; }
      }
      if (best) return best;
    }
    if (v.snapLine) {
      const hit = this.pick(x, y, { lines: true });
      if (hit) return { p: hit.p.map((c) => Math.round(c * 1e6) / 1e6), kind: 'line', line: hit.id, obj: true, label: t('Auf Linie {id}', { id: hit.id }) };
    }
    let p = this.workplanePoint(x, y);
    if (!p) return null;
    const wp = v.workplane, pl = PLANES[wp.plane];
    let kind = 'free';
    if (v.grid.snap) {
      const st = v.grid.step || 1;
      let [u, w] = pl.unmap(p);
      u = Math.round(u / st) * st; w = Math.round(w / st) * st;
      p = pl.map(u, w, wp.offset);
      kind = 'grid';
    }
    if ((ortho || v.ortho) && from) {
      const d = V.sub(p, from);
      const k = [0, 1, 2].reduce((a, b) => (Math.abs(d[b]) > Math.abs(d[a]) ? b : a), 0);
      p = [...from]; p[k] += d[k];
    }
    return { p: p.map((c) => Math.round(c * 1e6) / 1e6), kind, obj: false, label: kind === 'grid' ? t('Raster') : t('Arbeitsebene {p}', { p: wp.plane }) };
  }

  // Point on the line (p0 + s·u) closest to the mouse ray – used for axis constraints
  closestOnLine(x, y, p0, u) {
    const ray = this.ray(x, y);
    const o = [ray.origin.x, ray.origin.y, ray.origin.z], d = [ray.direction.x, ray.direction.y, ray.direction.z];
    const w0 = V.sub(o, p0);
    const a = V.dot(d, d), b = V.dot(d, u), c = V.dot(u, u), dd = V.dot(d, w0), e = V.dot(u, w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return null;
    const s = (a * e - b * dd) / den;
    return V.add(p0, V.mul(u, s));
  }

  // Intersection of the mouse ray with the plane through p0 with normal n
  rayPlane(x, y, p0, n) {
    const ray = this.ray(x, y);
    const out = new THREE.Vector3();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...n), new THREE.Vector3(...p0));
    return ray.intersectPlane(plane, out) ? [out.x, out.y, out.z] : null;
  }

  /* ---------------- camera views ---------------- */
  setView(name) {
    const b = modelBounds(this.store.model);
    this.bounds = b;
    const dirs = {
      iso: [1, -1.25, 0.95], iso2: [-1, -1.25, 0.95], top: [0, -1e-4, 1], bottom: [0, 1e-4, -1],
      front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
    };
    const d = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
    const target = new THREE.Vector3(...b.center);
    const dist = this.fitDistance(b);
    this.controls.target.copy(target);
    this.camera.position.copy(target.clone().add(d.multiplyScalar(dist)));
    if (this.camera === this.ortho) { this.orthoHalfH = b.size * 0.6; this.ortho.zoom = 1; this.updateOrthoFrustum(); }
    this.controls.update();
    this.requestRender();
  }

  fitDistance(b) {
    const r = b.size * 0.5 + 0.3;
    const fov = (this.persp.fov * Math.PI) / 180;
    const aspect = Math.max(0.3, this.width / this.height);
    return r / Math.sin(Math.min(fov, fov * aspect) / 2) * 1.05;
  }

  zoomExtents(keepDir = true) {
    const b = modelBounds(this.store.model);
    this.bounds = b;
    const target = new THREE.Vector3(...b.center);
    let dir = this.camera.position.clone().sub(this.controls.target);
    if (!keepDir || dir.lengthSq() < 1e-12) dir = new THREE.Vector3(1, -1.25, 0.95);
    dir.normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target.clone().add(dir.multiplyScalar(this.fitDistance(b))));
    if (this.camera === this.ortho) { this.orthoHalfH = b.size * 0.6; this.ortho.zoom = 1; this.updateOrthoFrustum(); }
    this.controls.update();
    this.requestRender();
  }

  zoomTo(points) {
    if (!points.length) return;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    const b = { center: V.mul(V.add(min, max), 0.5), size: Math.max(V.dist(min, max), 1) };
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(...b.center);
    this.camera.position.copy(this.controls.target.clone().add(dir.multiplyScalar(this.fitDistance(b))));
    if (this.camera === this.ortho) { this.orthoHalfH = b.size * 0.6; this.ortho.zoom = 1; this.updateOrthoFrustum(); }
    this.controls.update();
  }

  screenshot() {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  // Render with an opaque background (for reports)
  snapshot(width = 1400, height = 900) {
    const oldW = this.width, oldH = this.height;
    const bg = this.C.bg;
    this.renderer.setClearColor(bg, 1);
    this.renderer.setSize(width, height, false);
    this.persp.aspect = width / height; this.persp.updateProjectionMatrix();
    const oldHalf = this.orthoHalfH;
    this.updateOrthoFrustum();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(oldW, oldH);
    this.persp.aspect = oldW / oldH; this.persp.updateProjectionMatrix();
    this.orthoHalfH = oldHalf;
    this.resize();
    return url;
  }

  updateGizmo() {
    const m = this.camera.matrixWorldInverse;
    const axes = [['X', [1, 0, 0], 'var(--danger)'], ['Y', [0, 1, 0], 'var(--success)'], ['Z', [0, 0, 1], 'var(--accent)']];
    const items = axes.map(([n, v, c]) => {
      const p = new THREE.Vector3(...v).transformDirection(m);
      return { n, x: 46 + p.x * 30, y: 46 - p.y * 30, z: p.z, c };
    }).sort((a, b) => a.z - b.z);
    this.gizmo.innerHTML = `<svg viewBox="0 0 92 92" width="92" height="92">${items.map((i) =>
      `<line x1="46" y1="46" x2="${i.x}" y2="${i.y}" stroke="${i.c}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<circle cx="${i.x}" cy="${i.y}" r="8" fill="${i.c}" opacity="0.9"/>` +
      `<text x="${i.x}" y="${i.y + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="Inter,sans-serif">${i.n}</text>`).join('')}</svg>`;
  }

  refreshTheme() {
    this.C = colors3d();
    this.dirty('model');
  }
}

/* ---------------- geometry helpers ---------------- */
function distToSeg(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(a.x + t * dx - x, a.y + t * dy - y), t };
}

function segRect(a, b, x0, y0, x1, y1) {
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  return edges.some(([ax, ay, bx, by]) => segInter(a.x, a.y, b.x, b.y, ax, ay, bx, by));
}
function segInter(p0x, p0y, p1x, p1y, q0x, q0y, q1x, q1y) {
  const d = (p1x - p0x) * (q1y - q0y) - (p1y - p0y) * (q1x - q0x);
  if (Math.abs(d) < 1e-12) return false;
  const s = ((q0x - p0x) * (q1y - q0y) - (q0y - p0y) * (q1x - q0x)) / d;
  const t = ((q0x - p0x) * (p1y - p0y) - (q0y - p0y) * (p1x - p0x)) / d;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

function extrude(ol, a, b, ax) {
  const out = [];
  const at = (base, y, z) => [base[0] + ax.ey[0] * y + ax.ez[0] * z, base[1] + ax.ey[1] * y + ax.ez[1] * z, base[2] + ax.ey[2] * y + ax.ez[2] * z];
  const rings = [ol.outer, ...(ol.holes || [])];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const q0 = ring[i], q1 = ring[(i + 1) % ring.length];
      const A0 = at(a, q0[0], q0[1]), A1 = at(a, q1[0], q1[1]), B0 = at(b, q0[0], q0[1]), B1 = at(b, q1[0], q1[1]);
      out.push(...A0, ...A1, ...B1, ...A0, ...B1, ...B0);
    }
  }
  try {
    const tris = THREE.ShapeUtils.triangulateShape(ol.outer.map(([y, z]) => new THREE.Vector2(y, z)), (ol.holes || []).map((hh) => hh.map(([y, z]) => new THREE.Vector2(y, z))));
    const all = [...ol.outer, ...(ol.holes || []).flat()];
    for (const [i, j, k] of tris) {
      out.push(...at(a, ...all[i]), ...at(a, ...all[k]), ...at(a, ...all[j]));
      out.push(...at(b, ...all[i]), ...at(b, ...all[j]), ...at(b, ...all[k]));
    }
  } catch (e) { /* skip caps */ }
  return out;
}

function slab(pts, holes, ax, t) {
  const out = [];
  const off = (p, s) => V.add(p, V.mul(ax.ez, s * t / 2));
  const tri = triangulatePolygon(pts, holes, ax);
  for (const [i, j, k] of tri.tris) {
    out.push(...off(tri.pts[i], 1), ...off(tri.pts[j], 1), ...off(tri.pts[k], 1));
    out.push(...off(tri.pts[i], -1), ...off(tri.pts[k], -1), ...off(tri.pts[j], -1));
  }
  for (const ring of [pts, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      out.push(...off(p, -1), ...off(q, -1), ...off(q, 1), ...off(p, -1), ...off(q, 1), ...off(p, 1));
    }
  }
  return out;
}
