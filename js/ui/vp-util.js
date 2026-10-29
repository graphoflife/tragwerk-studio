// 3D helpers shared by the viewport modules.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function isDark() {
  const th = document.documentElement.dataset.theme;
  if (th) return th === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function colors3d() {
  const dark = isDark();
  return dark ? {
    node: 0xc9cedd, nodeSel: 0xffa560, geom: 0x7d859b, beam: 0x7ab8ff, truss: 0x6fd6ae, rib: 0xbb9cff, rigid: 0xff8aa0, spring: 0xffc56b,
    plate: 0xf3c08f, shell: 0xb9a3f5, membrane: 0x86d8d8, domainOpacity: 0.38, sel: 0xffa560, hover: 0xffd29a,
    support: 0x63d3a5, load: 0xff7f9b, moment: 0xffb35c, temp: 0xff9a6b, grid: 0x2a2f3c, gridMajor: 0x363c4c,
    axisX: 0xff6b7d, axisY: 0x6be09b, axisZ: 0x6aa8ff, mesh: 0x9097ab, ghost: 0x4a5163, pos: 0x7aa7ff, neg: 0xff8fa3, react: 0x7cdcb5,
    bg: 0x14161d, text: '#e9ebf3',
  } : {
    node: 0x4b5368, nodeSel: 0xff7a2f, geom: 0x9aa1b5, beam: 0x4f93f0, truss: 0x2fb487, rib: 0x8e6cf0, rigid: 0xf06080, spring: 0xf0a030,
    plate: 0xffc896, shell: 0xc7b3ff, membrane: 0x9be3e1, domainOpacity: 0.45, sel: 0xff7a2f, hover: 0xffb070,
    support: 0x2fae7d, load: 0xf0557a, moment: 0xf0902a, temp: 0xf07a40, grid: 0xdfe3ec, gridMajor: 0xc9cfdc,
    axisX: 0xe8475c, axisY: 0x2fae6a, axisZ: 0x3b7ee8, mesh: 0x7a8296, ghost: 0xc5cad6, pos: 0x5b8def, neg: 0xec6b85, react: 0x2fae7d,
    bg: 0xf4f5fa, text: '#1e2331',
  };
}

// Colour palettes for result contours
const PALETTES = {
  pastel: ['#4f6bd8', '#59a5e8', '#64cdd0', '#8fdc9c', '#e9e27a', '#f5b56c', '#ec7f6f', '#d9506d'],
  rainbow: ['#2b3fd6', '#1f8ff0', '#19c9d1', '#3ddc6b', '#cbe03a', '#f8b51e', '#f26b1d', '#d7191c'],
  thermal: ['#1d1f3a', '#4a2a7a', '#8e2f86', '#d24467', '#f4793e', '#fbbf3b', '#fcf5a0'],
  mono: ['#e8ecf7', '#c3cdeb', '#99aadb', '#6f86c9', '#4a62b1', '#2f448a'],
  utilization: ['#5cc492', '#a6d96a', '#f2df66', '#f6a35b', '#e8566c'],
};
export const PALETTE_NAMES = Object.keys(PALETTES);

export function paletteColors(name) {
  return (PALETTES[name] || PALETTES.pastel).map((c) => new THREE.Color(c));
}

// value 0..1 → THREE.Color, with optional discrete bands
export function colorAt(cols, s, levels) {
  s = Math.min(1, Math.max(0, Number.isFinite(s) ? s : 0));
  if (levels && levels > 1) s = Math.min(levels - 1, Math.floor(s * levels)) / (levels - 1);
  const f = s * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(f)), r = f - i;
  return cols[i].clone().lerp(cols[i + 1], r);
}

export function paletteCss(name, levels) {
  const cols = paletteColors(name);
  if (!levels || levels < 2) return `linear-gradient(to top, ${cols.map((c) => '#' + c.getHexString()).join(', ')})`;
  const parts = [];
  for (let i = 0; i < levels; i++) {
    const c = '#' + colorAt(cols, i / (levels - 1)).getHexString();
    parts.push(`${c} ${(i / levels) * 100}%`, `${c} ${((i + 1) / levels) * 100}%`);
  }
  return `linear-gradient(to top, ${parts.join(', ')})`;
}

export class LineFactory {
  constructor() { this.mats = new Set(); this.res = new THREE.Vector2(1, 1); }
  setResolution(w, h) { this.res.set(w, h); for (const m of this.mats) m.resolution.set(w, h); }
  // positions: flat array [x,y,z, x,y,z ...] (2 vertices per segment)
  make(positions, color, width = 2, { opacity = 1, vertexColors = null, dashed = false, depthTest = true } = {}) {
    if (!positions.length) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    const mat = new LineMaterial({
      color: vertexColors ? 0xffffff : color, linewidth: width, vertexColors: !!vertexColors,
      transparent: opacity < 1, opacity, dashed, depthTest,
      dashSize: 0.1, gapSize: 0.08,
    });
    if (vertexColors) geo.setColors(vertexColors);
    mat.resolution.copy(this.res);
    this.mats.add(mat);
    const ln = new LineSegments2(geo, mat);
    if (dashed) ln.computeLineDistances();
    ln.userData.lineMat = mat;
    return ln;
  }
  release(obj) {
    obj.traverse((o) => { if (o.userData.lineMat) this.mats.delete(o.userData.lineMat); });
  }
}

// Instanced arrow heads (cones). add(tip, dir, color) then build().
export class ArrowBatch {
  constructor(headLen, headRad) {
    this.items = [];
    this.headLen = headLen;
    this.headRad = headRad;
  }
  add(tip, dir, color, scale = 1) { this.items.push({ tip, dir, color, scale }); }
  build() {
    if (!this.items.length) return null;
    const geo = new THREE.ConeGeometry(this.headRad, this.headLen, 14);
    geo.translate(0, -this.headLen / 2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.items.forEach((it, i) => {
      const d = new THREE.Vector3(...it.dir).normalize();
      q.setFromUnitVectors(up, d);
      m.compose(new THREE.Vector3(...it.tip), q, new THREE.Vector3(it.scale, it.scale, it.scale));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.set(it.color));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }
}

export function label(text, pos, cls = '') {
  const div = document.createElement('div');
  div.className = 'vp-label ' + cls;
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.set(pos[0], pos[1], pos[2]);
  return obj;
}

export function disposeGroup(group, lines) {
  for (const child of [...group.children]) {
    lines?.release(child);
    child.traverse((o) => {
      if (o.isCSS2DObject && o.element?.parentNode) o.element.parentNode.removeChild(o.element);
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { mm.map?.dispose?.(); mm.dispose?.(); });
    });
    group.remove(child);
  }
}

let dotTex = null;
export function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = '#fff'; g.fill();
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

let ringTex = null;
export function ringTexture() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2);
  g.lineWidth = 7; g.strokeStyle = '#fff'; g.stroke();
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

export function makePoints(positions, color, size, { ring = false, depthTest = true, vertexColors = null } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  const mat = new THREE.PointsMaterial({
    color: vertexColors ? 0xffffff : color, size, sizeAttenuation: false, map: ring ? ringTexture() : dotTexture(),
    transparent: true, alphaTest: 0.4, depthTest, vertexColors: !!vertexColors,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 5;
  return pts;
}

// Triangulate a planar polygon (+holes) given in 3D with local axes; returns triangle index list into the concatenated point list
export function triangulatePolygon(outer3, holes3, ax) {
  const o = ax.origin || outer3[0];
  const to2 = (p) => new THREE.Vector2(
    (p[0] - o[0]) * ax.ex[0] + (p[1] - o[1]) * ax.ex[1] + (p[2] - o[2]) * ax.ex[2],
    (p[0] - o[0]) * ax.ey[0] + (p[1] - o[1]) * ax.ey[1] + (p[2] - o[2]) * ax.ey[2]);
  const contour = outer3.map(to2);
  const holes = (holes3 || []).map((hh) => hh.map(to2));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  return { tris, pts: [...outer3, ...(holes3 || []).flat()] };
}
