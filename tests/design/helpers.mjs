// Shared helpers for the design tests (hand-made models / meshes / CaseResults – no solver needed).

/** Single straight member along +X from (0,0,0) to (L,0,0). */
export function lineModel({ L, sec, mat, design, type = 'beam', code } = {}) {
  return {
    version: 1,
    settings: code ? { code } : {},
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: L, y: 0, z: 0 }],
    lines: [{ id: 1, n1: 1, n2: 2, element: { type, material: 1, section: 1, beta: 0, design } }],
    materials: [{ id: 1, ...mat }],
    sections: [{ id: 1, ...sec }],
    loadGroups: [], loadCases: [{ id: 1, name: 'LC1', group: null }], combinations: [],
  };
}

/** Mesh with nSeg beam segments for line `line` (only the fields the design code needs). */
export function lineMesh(nSeg = 4, line = 1) {
  return {
    beams: Array.from({ length: nSeg }, (_, i) => ({ n1: i, n2: i + 1, line, t0: i / nSeg, t1: (i + 1) / nSeg })),
    shells: [],
  };
}

/** CaseResult whose beam stations follow functions of x (m from line start). */
export function lineCase(mesh, L, fns) {
  return {
    beams: mesh.beams.map((b) => {
      const x0 = b.t0 * L, le = (b.t1 - b.t0) * L;
      const x = Float64Array.from({ length: 11 }, (_, k) => (k * le) / 10);
      const g = (q) => Float64Array.from(x, (xx) => (fns[q] ? fns[q](x0 + xx) : 0));
      return { x, N: g('N'), Vy: g('Vy'), Vz: g('Vz'), T: g('T'), My: g('My'), Mz: g('Mz'), uy: g('x'), uz: g('x') };
    }),
  };
}

export const near = (a, b, rel = 0.01) => Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-12);

export function runner(name) {
  let n = 0;
  return {
    test(title, fn) { fn(); n++; console.log('ok -', title); },
    done() { console.log(`${name}: ${n} tests passed`); },
  };
}

// Library-like section data (m, m², m⁴, m⁶) – values from the Arcelor/Euronorm tables.
export const IPE300 = {
  name: 'IPE 300', shape: 'I', family: 'IPE', fabrication: 'rolled',
  dims: { h: 0.300, b: 0.150, tw: 0.0071, tf: 0.0107, r: 0.015 },
  A: 53.81e-4, Iy: 8356e-8, Iz: 603.8e-8, It: 20.12e-8, Iw: 125.9e-9,
  Wely: 557.1e-6, Welz: 80.5e-6, Wply: 628.4e-6, Wplz: 125.2e-6,
};
export const HEB200 = {
  name: 'HEB 200', shape: 'I', family: 'HEB', fabrication: 'rolled',
  dims: { h: 0.200, b: 0.200, tw: 0.009, tf: 0.015, r: 0.018 },
  A: 78.08e-4, Iy: 5696e-8, Iz: 2003e-8, It: 59.28e-8, Iw: 171.1e-9,
  Wely: 569.6e-6, Welz: 200.3e-6, Wply: 642.5e-6, Wplz: 305.8e-6,
};
export const S235 = { name: 'S235', type: 'steel', E: 210e6, G: 81e6, nu: 0.3, rho: 7.85, fy: 235000, fu: 360000 };
