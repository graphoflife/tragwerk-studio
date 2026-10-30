// Reinforcement layouts from required areas: bar meshes for slabs (Ø/s), bars for beams (n Ø),
// stirrups (Ø/s, n legs). Pure ES module (no DOM). Units: m, m², m²/m.
//
// Bar diameters: SIA 262 / Swiss practice 6 … 40 mm (incl. 26, 30, 34), EC practice (incl. 25, 28, 32).
// Slab spacing in 25 mm steps between sMin (100 mm) and sMax (EC 9.3.1.1(3): main bars ≤ min(3h, 400 mm),
// default 250 mm; distribution bars use the same limit here – simplified).
// Beam bars: per layer n·Ø + (n − 1)·max(Ø, 20 mm) ≤ b − 2(c + Øbü) (EC 8.2(2), aggregate ignored); the
// choice balances few layers against diameters close to the preferred one (≤ 3 layers, Ø ≤ 34 mm).
// Stirrup spacing ≤ min(0.75·d, 300 mm) (EC 9.2.2(6), also used for SIA).

export const BAR_DIAS = {
  SIA: [0.006, 0.008, 0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.026, 0.030, 0.034, 0.040],
  EC: [0.006, 0.008, 0.010, 0.012, 0.014, 0.016, 0.020, 0.025, 0.028, 0.032, 0.040],
};

export const barArea = (dia) => Math.PI * dia * dia / 4;

/** Area per metre of a bar mesh layer Ø/s. */
export const meshArea = (dia, s) => (dia > 0 && s > 0 ? barArea(dia) / s : 0);

const dias = (code) => BAR_DIAS[code === 'SIA' ? 'SIA' : 'EC'];

/**
 * Slab layer for a required area (m²/m), starting with the preferred diameter.
 * @returns { dia, s, area } or null when nothing is required; { …, insufficient:true } if Ø40/sMin is not enough
 */
export function suggestMesh(as, { dia = 0.012, code = 'EC', sMin = 0.1, sMax = 0.25, step = 0.025 } = {}) {
  if (!(as > 1e-7)) return null;
  const list = dias(code).filter((d) => d >= dia - 1e-9);
  for (const d of list.length ? list : [dia]) {
    const sReq = barArea(d) / as;
    const s = Math.min(sMax, Math.floor((sReq + 1e-9) / step) * step);
    if (s >= sMin - 1e-9) return { dia: d, s, area: meshArea(d, s) };
  }
  const d = (list.length ? list : [dia]).slice(-1)[0];
  return { dia: d, s: sMin, area: meshArea(d, sMin), insufficient: true };
}

/**
 * Longitudinal beam bars for a required area As (m²).
 * @returns { n, dia, area, layers } or null
 */
export function suggestBars(As, { b = 0.3, cover = 0.03, diaStirrup = 0.01, dia = 0.016, code = 'EC', nMin = 2, maxLayers = 3 } = {}) {
  if (!(As > 1e-8)) return null;
  const clear = b - 2 * (cover + diaStirrup);
  const list = dias(code).filter((d) => d >= Math.min(dia, 0.012) - 1e-9 && d >= 0.010 && d <= 0.034 + 1e-9);
  const i0 = Math.max(0, list.findIndex((d) => d >= dia - 1e-9));
  let best = null;
  list.forEach((d, i) => {
    const n = Math.max(nMin, Math.ceil(As / barArea(d) - 1e-9));
    const gap = Math.max(d, 0.02);
    const perLayer = Math.max(2, Math.floor((clear + gap) / (d + gap)));
    const layers = Math.ceil(n / perLayer);
    if (layers > maxLayers) return;
    // score: every extra layer costs 2, every diameter step away from the preferred one costs 1
    const score = 2 * (layers - 1) + Math.abs(i - i0) + (i < i0 ? 0.5 : 0);
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && n * barArea(d) < best.area)) best = { n, dia: d, area: n * barArea(d), layers, score };
  });
  if (!best) { const d = list[list.length - 1]; const n = Math.max(nMin, Math.ceil(As / barArea(d))); return { n, dia: d, area: n * barArea(d), layers: maxLayers, insufficient: true }; }
  delete best.score;
  return best;
}

/**
 * Stirrups for a required asw (m²/m) with nLegs legs.
 * @returns { dia, s, legs, area } (area = provided asw in m²/m) or null
 */
export function suggestStirrups(asw, { dia = 0.008, legs = 2, d = 0.5, step = 0.025 } = {}) {
  if (!(asw > 1e-8)) return null;
  const sMax = Math.min(0.75 * d, 0.3);
  for (const ds of [dia, 0.010, 0.012, 0.014, 0.016].filter((x) => x >= dia - 1e-9)) {
    const sReq = legs * barArea(ds) / asw;
    const s = Math.min(Math.floor((sMax + 1e-9) / step) * step, Math.floor((sReq + 1e-9) / step) * step);
    if (s >= 0.075) return { dia: ds, s, legs, area: legs * barArea(ds) / s };
  }
  return { dia: 0.016, s: 0.075, legs, area: legs * barArea(0.016) / 0.075, insufficient: true };
}
