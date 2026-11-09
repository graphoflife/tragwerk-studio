// Drawing toolkit shared by the result views: visibility of mesh elements, deformed geometry,
// ghost mesh, extreme value labels and filled diagrams.
import * as THREE from 'three';
import { label } from './vp-util.js';
import { fmt } from '../core/units.js';

export const NSUB = 8;
export const GRAY = { r: 0.72, g: 0.74, b: 0.78 };

// Results are drawn (and their extremes taken) only for visible elements – hidden objects and the
// part filter (Teile/Geschosse) apply to results as in AxisVM. null = everything visible.
export function meshVisibility(st, mesh) {
  const h = st.view.hidden;
  if (!h.lines.size && !h.domains.size && !h.nodes.size) return null;
  const beam = Uint8Array.from(mesh.beams, (b) => (b.line != null && h.lines.has(b.line) ? 0 : 1));
  const shell = Uint8Array.from(mesh.shells, (s) => (h.domains.has(s.domain) ? 0 : 1));
  const node = new Uint8Array(mesh.nodes.length / 3);
  mesh.beams.forEach((b, i) => { if (beam[i]) { node[b.n1] = 1; node[b.n2] = 1; } });
  mesh.shells.forEach((s, e) => { if (shell[e]) s.nodes.forEach((n) => { node[n] = 1; }); });
  return { beam, shell, node };
}
export const visBeam = (vp, i) => !vp.vis || vp.vis.beam[i] === 1;
export const visShell = (vp, e) => !vp.vis || vp.vis.shell[e] === 1;
export const visNode = (vp, i) => !vp.vis || vp.vis.node[i] === 1;

/* ---------------- deformation field ---------------- */
export function nodePos(mesh, i) { const X = mesh.nodes; return [X[3 * i], X[3 * i + 1], X[3 * i + 2]]; }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Base points and displacement vectors along every mesh beam (Hermite interpolation of nodal dofs)
function beamCurves(mesh, disp) {
  const nb = mesh.beams.length;
  const base = new Float32Array(nb * (NSUB + 1) * 3), dv = new Float32Array(nb * (NSUB + 1) * 3);
  mesh.beams.forEach((b, bi) => {
    const p1 = nodePos(mesh, b.n1), p2 = nodePos(mesh, b.n2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const loc = (n) => {
      const tr = [disp[6 * n], disp[6 * n + 1], disp[6 * n + 2]], ro = [disp[6 * n + 3], disp[6 * n + 4], disp[6 * n + 5]];
      return { u: [dot(b.ex, tr), dot(b.ey, tr), dot(b.ez, tr)], r: [dot(b.ex, ro), dot(b.ey, ro), dot(b.ez, ro)] };
    };
    const a = loc(b.n1), c = loc(b.n2);
    const flex = b.type === 'beam' || b.type === 'rib';
    for (let k = 0; k <= NSUB; k++) {
      const s = k / NSUB, o = (bi * (NSUB + 1) + k) * 3;
      const ux = a.u[0] * (1 - s) + c.u[0] * s;
      let v, w;
      if (flex) {
        const N1 = 1 - 3 * s * s + 2 * s * s * s, N2 = s - 2 * s * s + s * s * s, N3 = 3 * s * s - 2 * s * s * s, N4 = -s * s + s * s * s;
        v = N1 * a.u[1] + N2 * L * a.r[2] + N3 * c.u[1] + N4 * L * c.r[2];
        w = N1 * a.u[2] - N2 * L * a.r[1] + N3 * c.u[2] - N4 * L * c.r[1];
      } else { v = a.u[1] * (1 - s) + c.u[1] * s; w = a.u[2] * (1 - s) + c.u[2] * s; }
      for (let j = 0; j < 3; j++) {
        base[o + j] = p1[j] + (p2[j] - p1[j]) * s;
        dv[o + j] = b.ex[j] * ux + b.ey[j] * v + b.ez[j] * w;
      }
    }
  });
  return { base, dv };
}

export function maxDisp(mesh, disp, vis = null) {
  let m = 0;
  const nn = mesh.nodes.length / 3;
  for (let i = 0; i < nn; i++) if (!vis || vis.node[i]) m = Math.max(m, Math.hypot(disp[6 * i], disp[6 * i + 1], disp[6 * i + 2]));
  return m;
}

// Builds deformed beams (fat lines) + shell surface; returns updater for animation.
export function deformedGeometry(vp, group, mesh, disp, scale, { colorsBeam = null, cornerColors = null, ghostShell = false, beamColor } = {}) {
  const C = vp.C;
  const { base, dv } = beamCurves(mesh, disp);
  const beamIdx = mesh.beams.map((_, i) => i).filter((i) => visBeam(vp, i));
  const segCount = beamIdx.length * NSUB;
  const pos = new Float32Array(segCount * 6);
  if (colorsBeam && beamIdx.length !== mesh.beams.length) colorsBeam = beamIdx.flatMap((bi) => colorsBeam.slice(bi * NSUB * 6, (bi + 1) * NSUB * 6));
  const updBeams = (f) => {
    let o = 0;
    for (const bi of beamIdx) {
      for (let k = 0; k < NSUB; k++) {
        const i0 = (bi * (NSUB + 1) + k) * 3, i1 = i0 + 3;
        for (let j = 0; j < 3; j++) { pos[o + j] = base[i0 + j] + f * dv[i0 + j]; pos[o + 3 + j] = base[i1 + j] + f * dv[i1 + j]; }
        o += 6;
      }
    }
  };
  updBeams(scale);
  let beamLine = null;
  if (segCount) {
    beamLine = vp.lines.make(Array.from(pos), beamColor ?? C.beam, 3, { vertexColors: colorsBeam });
    beamLine.frustumCulled = false;
    group.add(beamLine);
  }
  // shells
  const shellIdx = mesh.shells.map((_, e) => e).filter((e) => visShell(vp, e));
  const ns = shellIdx.length;
  let shellMesh = null, sBase = null, sDv = null, sPos = null, edgeLine = null, ePos = null, eBase = null, eDv = null;
  if (ns) {
    const nv = ns * 6;
    sBase = new Float32Array(nv * 3); sDv = new Float32Array(nv * 3); sPos = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const corner = [0, 1, 2, 0, 2, 3];
    const shellCol = new THREE.Color(C.shell);
    const edges = [];
    shellIdx.forEach((e, ei) => {
      const s = mesh.shells[e];
      corner.forEach((k, j) => {
        const n = s.nodes[k], o = (ei * 6 + j) * 3;
        for (let q = 0; q < 3; q++) { sBase[o + q] = mesh.nodes[3 * n + q]; sDv[o + q] = disp[6 * n + q]; }
        const c = cornerColors ? cornerColors[e * 4 + k] : (C[s.type] != null ? new THREE.Color(C[s.type]) : shellCol);
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      });
      for (let k = 0; k < 4; k++) edges.push(s.nodes[k], s.nodes[(k + 1) % 4]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: !cornerColors, opacity: cornerColors ? 1 : (ghostShell ? 0.25 : 0.55),
      depthWrite: !!cornerColors, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    shellMesh = new THREE.Mesh(geo, mat);
    shellMesh.frustumCulled = false;
    group.add(shellMesh);
    // element edges (thin)
    if (vp.store.view.showMesh || !cornerColors) {
      eBase = new Float32Array(edges.length * 3); eDv = new Float32Array(edges.length * 3); ePos = new Float32Array(edges.length * 3);
      edges.forEach((n, i) => { for (let q = 0; q < 3; q++) { eBase[3 * i + q] = mesh.nodes[3 * n + q]; eDv[3 * i + q] = disp[6 * n + q]; } });
      for (let i = 0; i < ePos.length; i++) ePos[i] = eBase[i] + scale * eDv[i];
      edgeLine = vp.lines.make(Array.from(ePos), C.mesh, 0.8, { opacity: 0.45 });
      if (edgeLine) { edgeLine.frustumCulled = false; group.add(edgeLine); }
    }
  }
  const updShells = (f) => {
    if (!shellMesh) return;
    for (let i = 0; i < sPos.length; i++) sPos[i] = sBase[i] + f * sDv[i];
    shellMesh.geometry.attributes.position.needsUpdate = true;
    if (edgeLine) {
      for (let i = 0; i < ePos.length; i++) ePos[i] = eBase[i] + f * eDv[i];
      const d = edgeLine.geometry.attributes.instanceStart.data;
      d.array.set(ePos); d.needsUpdate = true;
    }
  };
  updShells(scale);
  return {
    update(f) {
      updBeams(f);
      if (beamLine) { const d = beamLine.geometry.attributes.instanceStart.data; d.array.set(pos); d.needsUpdate = true; }
      updShells(f);
    },
  };
}

export function autoScale(vp, mesh, disp, mult) {
  const m = maxDisp(mesh, disp, vp.vis);
  if (m < 1e-14) return 0;
  return (vp.bounds.size * 0.06 / m) * (mult || 1);
}

export function fixRange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 1];
  if (Math.abs(b - a) < 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) return [a - 1e-9 - Math.abs(a) * 0.01, b + 1e-9 + Math.abs(b) * 0.01];
  return [a, b];
}

export function usedNodes(mesh) {
  const used = new Uint8Array(mesh.nodes.length / 3);
  for (const b of mesh.beams) { used[b.n1] = 1; used[b.n2] = 1; }
  for (const s of mesh.shells) for (const n of s.nodes) if (n >= 0) used[n] = 1;
  return used;
}

export function ghostMesh(vp, group, mesh) {
  const pos = [];
  const X = mesh.nodes;
  mesh.beams.forEach((b, i) => { if (visBeam(vp, i)) pos.push(X[3 * b.n1], X[3 * b.n1 + 1], X[3 * b.n1 + 2], X[3 * b.n2], X[3 * b.n2 + 1], X[3 * b.n2 + 2]); });
  const ln = vp.lines.make(pos, vp.C.ghost, 1.2, { opacity: 0.8 });
  if (ln) group.add(ln);
}

export function extremeLabels(vp, group, mesh, disp, scale, items, q) {
  if (!vp.store.view.labelsValues) return;
  const seen = new Set();
  for (const [n, v] of items) {
    if (seen.has(n)) continue;
    seen.add(n);
    const p = nodePos(mesh, n).map((x, j) => x + scale * disp[6 * n + j]);
    group.add(label(fmt(q, v), p, 'big ' + (v >= 0 ? 'pos' : 'neg')));
  }
}

export function cornerPos(mesh, k) {
  const nd = mesh.shells[Math.floor(k / 4)].nodes[k % 4];
  return [mesh.nodes[3 * nd], mesh.nodes[3 * nd + 1], mesh.nodes[3 * nd + 2]];
}

/** Filled diagram: triangles of positive and negative values in the viewport's pos/neg colours. */
export function diagramFill(vp, group, posTri, negTri, { opacity, renderOrder }) {
  for (const [tri, col] of [[posTri, vp.C.pos], [negTri, vp.C.neg]]) {
    if (!tri.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = renderOrder;
    group.add(m);
  }
}
