// Display units. Internal units are SI-consistent: m, kN, t, s (see SPEC.md).
// Each quantity has selectable display units: label + factor (display = internal * factor).

export const UNIT_OPTIONS = {
  len: [['m', 1], ['cm', 100], ['mm', 1000]],
  thick: [['mm', 1000], ['cm', 100], ['m', 1]],
  dim: [['mm', 1000], ['cm', 100], ['m', 1]],
  disp: [['mm', 1000], ['cm', 100], ['m', 1]],
  rot: [['mrad', 1000], ['rad', 1], ['°', 180 / Math.PI]],
  force: [['kN', 1], ['N', 1000], ['MN', 0.001]],
  moment: [['kNm', 1], ['Nm', 1000], ['MNm', 0.001]],
  lineLoad: [['kN/m', 1], ['N/m', 1000]],
  areaLoad: [['kN/m²', 1], ['N/m²', 1000]],
  lineForce: [['kN/m', 1], ['N/mm', 1]],
  lineMoment: [['kNm/m', 1], ['Nmm/mm', 1]],
  stress: [['N/mm²', 0.001], ['kN/m²', 1], ['MPa', 0.001]],
  modulus: [['N/mm²', 0.001], ['kN/m²', 1], ['GPa', 1e-6]],
  density: [['kg/m³', 1000], ['t/m³', 1]],
  area: [['cm²', 1e4], ['mm²', 1e6], ['m²', 1]],
  inertia: [['cm⁴', 1e8], ['mm⁴', 1e12], ['m⁴', 1]],
  secMod: [['cm³', 1e6], ['mm³', 1e9], ['m³', 1]],
  warping: [['cm⁶', 1e12], ['mm⁶', 1e18], ['m⁶', 1]],
  reinf: [['cm²/m', 1e4], ['mm²/m', 1e6]],
  reinfBeam: [['cm²', 1e4], ['mm²', 1e6]],
  springK: [['kN/m', 1], ['kN/mm', 0.001]],
  springR: [['kNm/rad', 1]],
  lineSpring: [['kN/m²', 1]],
  bedding: [['kN/m³', 1], ['MN/m³', 0.001]],
  temp: [['K', 1]],
  alpha: [['1/K', 1]],
  freq: [['Hz', 1]],
  period: [['s', 1]],
  angle: [['°', 1]],
  mass: [['t', 1], ['kg', 1000]],
  accel: [['m/s²', 1], ['g', 1 / 9.81]],
  ratio: [['', 1]],
  percent: [['%', 100]],
  none: [['', 1]],
};

const DEFAULTS = { len: 'm', thick: 'mm', dim: 'mm', disp: 'mm', rot: 'mrad', force: 'kN', moment: 'kNm', stress: 'N/mm²', modulus: 'N/mm²', density: 'kg/m³', area: 'cm²', inertia: 'cm⁴', secMod: 'cm³', warping: 'cm⁶', reinf: 'cm²/m', reinfBeam: 'cm²' };

let prefs = { ...DEFAULTS };
let decimals = 4;
try {
  const s = JSON.parse(localStorage.getItem('ts.units') || 'null');
  if (s?.units) prefs = { ...prefs, ...s.units };
  if (s?.decimals != null) decimals = s.decimals;
} catch (e) { /* ignore */ }

function unitOf(q) {
  const opts = UNIT_OPTIONS[q] || UNIT_OPTIONS.none;
  const sel = prefs[q];
  return opts.find((o) => o[0] === sel) || opts[0];
}
export function unitLabel(q) { return unitOf(q)[0]; }
export function toDisplay(q, v) { return v * unitOf(q)[1]; }
export function fromDisplay(q, v) { return v / unitOf(q)[1]; }
export function getUnitPrefs() { return { units: { ...prefs }, decimals }; }
export function setUnitPrefs(units, dec) {
  prefs = { ...prefs, ...units };
  if (dec != null) decimals = dec;
  try { localStorage.setItem('ts.units', JSON.stringify({ units: prefs, decimals })); } catch (e) { /* ignore */ }
}

// Format a plain number with sensible significant digits.
export function fmtNum(v, digits) {
  if (v == null || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const d = digits ?? decimals;
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e7 || a < 1e-4) return v.toExponential(Math.max(1, d - 1)).replace('e+', 'e');
  // significant digit based rounding, trimmed trailing zeros
  const mag = Math.floor(Math.log10(a));
  const dp = Math.max(0, Math.min(8, d - 1 - mag));
  let s = v.toFixed(dp);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

// Format an internal value of quantity q for display, optionally with unit.
export function fmt(q, v, { unit = true, digits } = {}) {
  if (v == null || Number.isNaN(v)) return '–';
  const s = fmtNum(toDisplay(q, v), digits).replace('-', '−');
  const u = unitLabel(q);
  return unit && u ? `${s} ${u}` : s;
}
