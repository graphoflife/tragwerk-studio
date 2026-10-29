// Response spectrum: EC8 and SIA 261 ordinates, SDOF response, SRSS/CQC.
import assert from 'node:assert/strict';
import { runModal, runSpectrum, spectrumOrdinate, spectrumParams } from '../../js/fem/index.js';
import { cqcRho } from '../../js/fem/spectrum.js';
import { baseModel, section, buildTestMesh, close, absClose, runTests, FIX } from './helpers.mjs';

const tests = [];
const T = (n, f) => tests.push([n, f]);
const ord = (o, Tp) => spectrumOrdinate(Tp, spectrumParams(o).params);

T('EC8 type 1 design and elastic spectrum ordinates (ground C, ag = 2.0 m/s², q = 1.5)', () => {
  const o = { code: 'EC', soil: 'C', ag: 2.0, q: 1.5, importance: 1 };
  close(ord(o, 0), 2 * 1.15 * 2 / 3, 1e-12, 'T=0');
  close(ord(o, 0.1), 2.3 * (2 / 3 + 0.5 * (2.5 / 1.5 - 2 / 3)), 1e-12, 'T=0.1');
  close(ord(o, 0.4), 2.3 * 2.5 / 1.5, 1e-12, 'plateau');
  close(ord(o, 1.0), 2.3 * 2.5 / 1.5 * 0.6, 1e-12, 'T=1');
  close(ord(o, 3.0), 2.3 * 2.5 / 1.5 * 0.6 * 2 / 9, 1e-12, 'T=3');
  close(ord(o, 5.0), 0.2 * 2.0, 1e-12, 'lower bound β·ag');
  const el = { ...o, type: 'elastic', damping: 0.05 };
  close(ord(el, 0.4), 2.3 * 2.5, 1e-12, 'elastic plateau');
  close(ord({ ...el, damping: 0.02 }, 0.4), 2.3 * 2.5 * Math.sqrt(10 / 7), 1e-12, 'η for ξ = 2 %');
  close(ord({ ...o, importance: 1.4 }, 0.4), 1.4 * 2.3 * 2.5 / 1.5, 1e-12, 'γI');
  close(ord({ ...o, dir: 'Z' }, 0.1), 0.9 * 2 * 2.5 / 1.5, 1e-12, 'vertical plateau (avg = 0.9 ag)');
});

T('SIA 261 design spectrum ordinates (zone Z2, ground B, γf = 1.2, q = 2)', () => {
  const o = { code: 'SIA', zone: 'Z2', soil: 'B', q: 2, importance: 1.2, ag: 99 };
  const p = spectrumParams(o).params;
  close(p.agBase, 1.0, 1e-12, 'agd from zone overrides ag');
  close(ord(o, 0), 1.2 * 1.0 * 1.2 * 0.67, 1e-12, 'T=0');
  close(ord(o, 0.075), 1.44 * (0.67 + (2.5 / 2 - 0.67) * 0.5), 1e-12, 'T=TB/2');
  close(ord(o, 0.3), 2.5 * 1.44 / 2, 1e-12, 'plateau');
  close(ord(o, 1.0), 1.8 * 0.5, 1e-12, 'T=1');
  close(ord(o, 2.5), 1.8 * 0.5 * 2 / 2.5 ** 2, 1e-12, 'T=2.5');
  close(ord(o, 4.0), 0.1 * 1.2 * 1.0, 1e-12, 'lower bound 0.1·γf·agd');
  close(spectrumParams({ code: 'SIA', zone: 'Z3b' }).params.agBase, 1.6, 1e-12, 'Z3b');
  close(spectrumParams({ code: 'SIA', zone: 'Z1a' }).params.agBase, 0.4, 1e-12, 'Z1a');
  const f = spectrumParams({ code: 'SIA', zone: 'Z1b', soil: 'F' });
  assert.ok(f.warnings.length === 1 && f.params.S === 1.35, 'class F placeholder with warning');
  close(ord({ code: 'SIA', ag: 1.3, soil: 'A', q: 1.5 }, 0.2), 2.5 * 1.3 / 1.5, 1e-12, 'ag used without zone');
});

T('SDOF response (massless cantilever + tip mass): base shear = M·Sd(T), SRSS = CQC', () => {
  const L = 3, M = 5, E = 210e6, Iz = 6.04e-6, Iy = 8.356e-5;
  const m = baseModel();
  m.materials = [{ id: 1, E, nu: 0.3, rho: 0 }];
  m.sections.push(section(1, { A: 5.38e-3, Iy, Iz, It: 2e-7 }));
  m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: L });
  m.lines.push({ id: 1, n1: 1, n2: 2, element: { type: 'beam', material: 1, section: 1, divisions: 3 } });
  m.supports.push({ id: 1, type: 'node', node: 1, dofs: FIX });
  m.loadCases.push({ id: 1 });
  m.loads.push({ id: 1, lc: 1, type: 'node', node: 2, F: [0, 0, -M * 9.81, 0, 0, 0] });
  const mesh = buildTestMesh(m);
  const modal = runModal(m, mesh, { nModes: 3, massCase: 1, selfWeightMass: false });
  assert.equal(modal.error, null);
  for (const code of ['EC', 'SIA']) for (const rule of ['SRSS', 'CQC']) {
    const opts = { code, dir: 'X', ag: 1.6, soil: 'B', q: 1.5, rule, damping: 0.05 };
    const r = runSpectrum(m, mesh, modal, opts);
    assert.equal(r.error, null, JSON.stringify(r.error));
    // X sway of a vertical member: bending about global Y, local z = X → stiffness 3EIy/L³
    const mode = modal.modes.find((md) => md.effMass[0] > 0.99);
    const Sd = ord(opts, mode.T);
    close(r.reac[0], M * Sd, 1e-8, `${code} ${rule} base shear`);
    close(r.reac[4], M * Sd * L, 1e-8, `${code} ${rule} base moment`);
    close(r.disp[6 * mesh.modelNodeToMesh[2]], Sd / mode.omega ** 2, 1e-8, 'tip displacement');
    for (const v of r.reac) assert.ok(v >= 0);
    close(mode.omega, Math.sqrt(3 * E * Iy / L ** 3 / M), 1e-8, 'omega');
    assert.ok(r.spectrum.modes.length === 3);
  }
  close(cqcRho(10, 10, 0.05), 1, 1e-12, 'ρ(ω,ω) = 1');
  assert.ok(cqcRho(10, 20, 0.05) < 0.02, 'well separated');
});

runTests(tests);
