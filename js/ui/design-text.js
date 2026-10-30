// UI texts for design results: translated engine messages, check names, reinforcement suggestions.
import { t } from '../i18n.js';
import { fmt, fmtNum } from '../core/units.js';
import { suggestMesh, suggestBars, suggestStirrups } from '../design/rebar.js';

export const CHECK_NAMES = {
  N: 'Normalkraft', Vy: 'Querkraft Vy', Vz: 'Querkraft Vz', T: 'Torsion', My: 'Biegung My', Mz: 'Biegung Mz',
  'M+N': 'Biegung + Normalkraft', 'FB-y': 'Biegeknicken y', 'FB-z': 'Biegeknicken z', LTB: 'Biegedrillknicken', Interaction: 'Stabilität: Interaktion',
};
export const checkName = (k) => t(CHECK_NAMES[k] || k);

export const LAYER_NAMES = { axb: 'x unten', ayb: 'y unten', axt: 'x oben', ayt: 'y oben' };
export const layerName = (k) => t(LAYER_NAMES[k] || k);

export const POS_NAMES = { interior: 'Innenstütze', edge: 'Randstütze', corner: 'Eckstütze' };

const mm = (v) => Math.round(v * 1000);
/** "Ø12/150" for a slab layer */
export const meshText = (m) => (m ? `Ø${mm(m.dia)}/${mm(m.s)}` : '–');
/** "4 Ø20" for beam bars */
export const barsText = (b) => (b ? `${b.n} Ø${mm(b.dia)}` + (b.layers > 1 ? ` (${t('{n} Lagen', { n: b.layers })})` : '') : '–');
/** "Ø10/200 (2-schnittig)" for stirrups */
export const stirrupText = (s) => (s ? `Ø${mm(s.dia)}/${mm(s.s)} (${t('{n}-schnittig', { n: s.legs })})` : '–');

/** Suggested slab layer for an area, respecting the bar diameter of the layer. */
export function slabSuggestion(as, layer, layout, code) {
  const dia = layer[1] === 'x' ? layout?.diaX : layout?.diaY;
  return suggestMesh(as, { dia: dia || 0.012, code });
}
export function beamSuggestion(r, code) {
  const s = r.section || {};
  const mx = (a) => Math.max(0, ...(a || [0]).filter(Number.isFinite));
  const opt = { b: s.bw || r.b, cover: s.cover ?? 0.03, diaStirrup: s.diaStirrup ?? 0.01, dia: s.dia ?? 0.02, code };
  return {
    bot: suggestBars(mx(r.AsBot), opt),
    top: suggestBars(mx(r.AsTop), { ...opt, b: s.bf > 0 ? Math.min(s.bf, s.bw * 3) : opt.b }),
    stirrups: suggestStirrups(mx(r.Asw), { dia: Math.min(s.diaStirrup ?? 0.008, 0.012), d: s.d || r.d }),
  };
}

export const reinfText = (v) => fmt('reinf', v);

// Engine messages (English) → UI language
const RULES = [
  [/^Domain (\d+): (.*)$/, (m) => `${t('Fläche {id}', { id: m[1] })}: ${designMessage(m[2])}`],
  [/^Line (\d+): (.*?) – (RC beam design|steel check|timber check) skipped$/, (m) => `${t('Stab {id}', { id: m[1] })}: ${designMessage(m[2])} – ${t('nicht bemessen')}`],
  [/^Line (\d+): (.*)$/, (m) => `${t('Stab {id}', { id: m[1] })}: ${designMessage(m[2])}`],
  [/^compression reinforcement required \(x\/d > ([\d.]+), (.*?)\) at (\d+) corner\(s\)$/, (m) => t('Druckbewehrung erforderlich (x/d > {x}, {r}) an {n} Punkten', { x: m[1], r: m[2], n: m[3] })],
  [/^compression reinforcement required \(x\/d > ([\d.]+), (.*?)\) e\.g\. at x=([\d.]+) m$/, (m) => t('Druckbewehrung erforderlich (x/d > {x}, {r}), z.B. bei x = {p} m', { x: m[1], r: m[2], p: m[3] })],
  [/^As > As,max = 0\.04·Ac at (\d+) corner\(s\)$/, (m) => t('As > As,max = 0.04·Ac an {n} Punkten – Platte zu dünn', { n: m[1] })],
  [/^As > As,max = 0\.04·Ac.*section too small$/, () => t('As > As,max = 0.04·Ac – Querschnitt zu klein')],
  [/^design not possible \(section too small \/ missing data\) at (\d+) corner\(s\)$/, (m) => t('Bemessung nicht möglich (Querschnitt zu klein) an {n} Punkten', { n: m[1] })],
  [/^vEd > vRd,c at (\d+) corner\(s\) \(max ratio ([\d.]+), (.*?)\).*$/, (m) => t('vEd > vRd,c an {n} Punkten (max. {r}-fach, {c}) – Schubbewehrung erforderlich, nicht bemessen', { n: m[1], r: m[2], c: m[3] })],
  [/^concrete material without fck.*$/, () => t('Betonmaterial ohne fck')],
  [/^no thickness.*$/, () => t('keine Dicke definiert')],
  [/^thickness ([\d.]+) m too small for cover\/dia.*$/, (m) => t('Dicke {t} m zu klein für Deckung und Stabdurchmesser', { t: m[1] })],
  [/^bending design not possible at x=([\d.]+) m.*$/, (m) => t('Biegebemessung bei x = {x} m nicht möglich (Querschnitt zu klein)', { x: m[1] })],
  [/^(VRd,c \(concrete compression field, kc = 0\.55\)|VRd,max) exceeded: VEd=([\d.]+) kN > ([\d.]+) kN at x=([\d.]+) m \((.*)\)$/, (m) => t('Betondruckdiagonale versagt: VEd = {v} kN > {r} kN bei x = {x} m ({c}) – Querschnitt vergrössern', { v: m[2], r: m[3], x: m[4], c: m[5] })],
  [/^significant Mz.*$/, () => t('Biegung um die schwache Achse (Mz) vorhanden – nicht bemessen')],
  [/^torsion not designed$/, () => t('Torsion nicht bemessen')],
  [/^shear: fixed compression field cot α = ([\d.]+), z = 0\.9d \((.*)\)$/, (m) => t('Querkraft: Druckfeldneigung cot α = {c}, z = 0.9·d ({r})', { c: m[1], r: m[2] })],
  [/^shear: variable strut, cot θ (.*?) \(≤ ([\d.]+)\), z = 0\.9d \((.*)\)$/, (m) => t('Querkraft: variable Druckstrebenneigung cot θ {c} (≤ {m}), z = 0.9·d ({r})', { c: m[1], m: m[2], r: m[3] })],
  [/^T-beam: beff = ([\d.]+) m \((.*?) \+ bw\), hf = ([\d.]+) m, l0 = ([\d.]+) m.*$/, (m) => t('Plattenbalken: beff = {b} m ({i} + bw), hf = {h} m, l0 = {l} m – Plattenschnittgrössen innerhalb beff addiert (EN 1992-1-1 5.3.2.1)', { b: m[1], i: m[2], h: m[3], l: m[4] })],
  [/^no result cases.*$/, () => t('keine Ergebnisfälle – nichts bemessen')],
  [/^no section$/, () => t('kein Querschnitt')],
  [/^no mesh beams$/, () => t('nicht vernetzt')],
  [/^zero length$/, () => t('Länge null')],
  [/^section shape (\w+) not supported \(RECT\/T only\)$/, (m) => t('Querschnittsform {s} nicht unterstützt (nur Rechteck/T)', { s: m[1] })],
  [/^cover\/bar diameters too large for the section height$/, () => t('Betondeckung/Stabdurchmesser zu gross für die Querschnittshöhe')],
  [/^material without fy$/, () => t('Material ohne fy')],
  [/^material without timber properties$/, () => t('Material ohne Holzkennwerte')],
  [/^timber strengths fmk\/fc0k missing$/, () => t('Holzfestigkeiten fmk/fc0k fehlen')],
  [/^section .*lacks A\/Iy\/Iz$/, () => t('Querschnittswerte A/Iy/Iz fehlen')],
  [/^Result case '(.*)' not available.*$/, (m) => t('Ergebnisfall {k} nicht vorhanden – ignoriert', { k: m[1] })],
  [/^KLT ≤ 0: laterally restrained, χLT = 1$/, () => t('KLT ≤ 0: seitlich gehalten, χLT = 1')],
  [/^It missing – LTB not checked$/, () => t('It fehlt – Biegedrillknicken nicht nachgewiesen')],
  [/^Wpl missing – elastic moduli used$/, () => t('Wpl fehlt – elastische Widerstandsmomente verwendet')],
  [/^no shear area – shear not checked$/, () => t('keine Schubfläche – Querkraft nicht nachgewiesen')],
  [/^hw\/tw = ([\d.]+) > 72ε: shear buckling.*$/, (m) => t('hw/tw = {v} > 72ε: Schubbeulen (EN 1993-1-5) nicht nachgewiesen', { v: m[1] })],
  [/^case (.*): load duration unknown – medium-term assumed$/, (m) => t('Fall {k}: Lasteinwirkungsdauer unbekannt – mittel angenommen', { k: m[1] })],
  [/^aluminium approximated.*$/, () => t('Aluminium näherungsweise nach EN 1993-1-1 (EN 1999 nicht umgesetzt)')],
  [/^Punching check aborted: (.*)$/, (m) => t('Durchstanznachweis abgebrochen: {m}', { m: m[1] })],
  [/^(RC surface design|RC beam design|Steel design|Timber design) aborted: (.*)$/, (m) => t('Bemessung abgebrochen: {m}', { m: m[2] })],
];

export function designMessage(msg) {
  const s = String(msg || '');
  for (const [re, f] of RULES) { const m = s.match(re); if (m) return f(m); }
  return s;
}

export const etaText = (eta) => `${fmtNum((eta || 0) * 100, 3)} %`;
export { fmt };
