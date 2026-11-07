// UI texts for design results: translated engine messages, check names, reinforcement suggestions.
import { t, getLang } from '../i18n.js';
import { Msg } from '../core/messages.js';
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

// Messages of the calculation modules are structured (core/messages.js): shown in the UI language,
// severity from the message table – no parsing of English sentences.
export function designMessage(m, show = null) {
  return m instanceof Msg ? m.format(getLang(), show) : String(m ?? '');
}
export const messageLevel = (m) => (m instanceof Msg ? m.level : 'info');
/** messages other than the given codes (e.g. the slab shear warning shown separately) */
export const withoutCodes = (list, ...codes) => (list || []).filter((m) => !(m instanceof Msg && codes.includes(m.code)));

export const etaText = (eta) => `${fmtNum((eta || 0) * 100, 3)} %`;
export { fmt };
