// Structured messages of the calculation modules (design, load panels): msg(code, params) instead of
// prose. One table holds the English and German text of every code, so the UI never parses sentences.
// toString() gives the English text (logs, tests); the UI shows msg.format(lang). Params are pre-formatted
// strings/numbers from the engine (or nested messages, e.g. the reason of a skipped member).
// Pure module (no DOM). tests/integration/messages.test.mjs keeps code and table in sync.

const warn = 'warn';
export const MESSAGES = {
  // ---- general
  'case.missing': { level: warn, en: "Result case '{key}' not available – ignored.", de: 'Ergebnisfall {key} nicht vorhanden – ignoriert' },
  'aborted.rcSurface': { level: warn, en: 'RC surface design aborted: {err}', de: 'Flächenbemessung abgebrochen: {err}' },
  'aborted.rcBeam': { level: warn, en: 'RC beam design aborted: {err}', de: 'Balkenbemessung abgebrochen: {err}' },
  'aborted.rcCol': { level: warn, en: 'RC column design aborted: {err}', de: 'Stützenbemessung abgebrochen: {err}' },
  'aborted.steel': { level: warn, en: 'Steel design aborted: {err}', de: 'Stahlbemessung abgebrochen: {err}' },
  'aborted.timber': { level: warn, en: 'Timber design aborted: {err}', de: 'Holzbemessung abgebrochen: {err}' },
  'aborted.punching': { level: warn, en: 'Punching check aborted: {err}', de: 'Durchstanznachweis abgebrochen: {err}' },
  'failed.rcBeam': { level: warn, en: 'Line {id}: RC beam design failed ({err})', de: 'Stab {id}: Bemessung fehlgeschlagen ({err})' },
  'failed.rcCol': { level: warn, en: 'Line {id}: RC column design failed ({err})', de: 'Stab {id}: Stützenbemessung fehlgeschlagen ({err})' },
  'failed.steel': { level: warn, en: 'Line {id}: steel check failed ({err})', de: 'Stab {id}: Stahlnachweis fehlgeschlagen ({err})' },
  'failed.timber': { level: warn, en: 'Line {id}: timber check failed ({err})', de: 'Stab {id}: Holznachweis fehlgeschlagen ({err})' },
  'skip.rcBeam': { level: warn, en: 'Line {id}: {reason} – RC beam design skipped', de: 'Stab {id}: {reason} – nicht bemessen' },
  'skip.rcCol': { level: warn, en: 'Line {id}: {reason} – RC column design skipped', de: 'Stab {id}: {reason} – nicht bemessen' },
  'skip.steel': { level: warn, en: 'Line {id}: {reason} – steel check skipped', de: 'Stab {id}: {reason} – nicht nachgewiesen' },
  'skip.timber': { level: warn, en: 'Line {id}: {reason} – timber check skipped', de: 'Stab {id}: {reason} – nicht nachgewiesen' },
  'skip.surface': { level: warn, en: 'Domain {id}: {reason} – RC design skipped', de: 'Fläche {id}: {reason} – nicht bemessen' },
  // ---- reasons (nested in skip.*)
  'r.noSection': { en: 'no section', de: 'kein Querschnitt' },
  'r.noMaterial': { en: 'no material', de: 'kein Material' },
  'r.notConcrete': { en: "material type '{type}' is not concrete", de: 'Materialtyp {type} ist kein Beton' },
  'r.noFck': { en: 'concrete material without fck', de: 'Betonmaterial ohne fck' },
  'r.noFy': { en: 'material without fy', de: 'Material ohne fy' },
  'r.noTimber': { en: 'material without timber properties', de: 'Material ohne Holzkennwerte' },
  'r.timberStrength': { en: 'timber strengths fmk/fc0k missing', de: 'Holzfestigkeiten fmk/fc0k fehlen' },
  'r.secProps': { en: 'section {name} lacks A/Iy/Iz', de: 'Querschnitt {name}: A/Iy/Iz fehlen' },
  'r.zeroLength': { en: 'zero length', de: 'Länge null' },
  'r.noMesh': { en: 'no mesh beams', de: 'nicht vernetzt' },
  'r.shapeRectT': { en: 'section shape {s} not supported (RECT/T only)', de: 'Querschnittsform {s} nicht unterstützt (nur Rechteck/T)' },
  'r.shapeRectCirc': { en: 'section shape {s} not supported (RECT/CIRC only)', de: 'Querschnittsform {s} nicht unterstützt (nur Rechteck/Kreis)' },
  'r.coverBeam': { en: 'cover/bar diameters too large for the section height', de: 'Betondeckung/Stabdurchmesser zu gross für die Querschnittshöhe' },
  'r.coverCol': { en: 'cover/bar diameters too large for the section', de: 'Betondeckung/Stabdurchmesser zu gross für den Querschnitt' },
  'r.noThickness': { en: 'no thickness', de: 'keine Dicke definiert' },
  'r.thin': { en: 'thickness {t} m too small for cover/dia', de: 'Dicke {t} m zu klein für Deckung und Stabdurchmesser' },
  // ---- RC surfaces
  'surf.comp': { level: warn, en: 'Domain {id}: compression reinforcement required (x/d > {xi}, {ref}) at {n} corner(s)', de: 'Fläche {id}: Druckbewehrung erforderlich (x/d > {xi}, {ref}) an {n} Punkten' },
  'surf.asMax': { level: warn, en: 'Domain {id}: As > As,max = 0.04·Ac at {n} corner(s)', de: 'Fläche {id}: As > As,max = 0.04·Ac an {n} Punkten – Platte zu dünn' },
  'surf.fail': { level: warn, en: 'Domain {id}: design not possible (section too small / missing data) at {n} corner(s)', de: 'Fläche {id}: Bemessung nicht möglich (Querschnitt zu klein) an {n} Punkten' },
  'surf.shear': { level: warn, en: 'Domain {id}: vEd > vRd,c at {n} corner(s) (max ratio {r}, {ref}) – shear reinforcement required, not designed', de: 'Fläche {id}: vEd > vRd,c an {n} Punkten (max. {r}-fach, {ref}) – Schubbewehrung erforderlich, nicht bemessen' },
  // ---- RC beams
  'beam.caseMismatch': { en: 'case {key}: station count mismatch – ignored', de: 'Fall {key}: abweichende Stationen – ignoriert' },
  'beam.noCases': { en: 'no result cases – nothing designed', de: 'keine Ergebnisfälle – nichts bemessen' },
  'beam.ecc': { en: 'eccentric member: axis {e} m from the line (local z)', de: 'exzentrischer Stab: Achse {e} m neben der Linie (lokal z)' },
  'beam.tBeam': { en: 'T-beam: beff = {beff} m ({parts} + bw), hf = {hf} m, l0 = {l0} m – slab forces within beff added (EN 1992-1-1 5.3.2.1)', de: 'Plattenbalken: beff = {beff} m ({parts} + bw), hf = {hf} m, l0 = {l0} m – Plattenschnittgrössen innerhalb beff addiert (EN 1992-1-1 5.3.2.1)' },
  'beam.comp': { level: warn, en: 'compression reinforcement required (x/d > {xi}, {ref}) e.g. at x={x} m', de: 'Druckbewehrung erforderlich (x/d > {xi}, {ref}), z.B. bei x = {x} m' },
  'beam.bendFail': { level: warn, en: 'bending design not possible at x={x} m (section too small)', de: 'Biegebemessung bei x = {x} m nicht möglich (Querschnitt zu klein)' },
  'beam.asMax': { level: warn, en: 'As > As,max = 0.04·Ac (EN 1992-1-1 9.2.1.1(3)) – section too small', de: 'As > As,max = 0.04·Ac – Querschnitt zu klein' },
  'beam.strutEC': { level: warn, en: 'VRd,max exceeded: VEd={V} kN > {VR} kN at x={x} m ({ref})', de: 'Betondruckstrebe versagt: VEd = {V} kN > VRd,max = {VR} kN bei x = {x} m ({ref}) – Querschnitt vergrössern' },
  'beam.strutSIA': { level: warn, en: 'VRd,c (concrete compression field, kc = 0.55) exceeded: VEd={V} kN > {VR} kN at x={x} m ({ref})', de: 'Betondruckfeld versagt: VEd = {V} kN > VRd,c = {VR} kN bei x = {x} m ({ref}) – Querschnitt vergrössern' },
  'beam.mz': { en: 'significant Mz – weak-axis bending not designed', de: 'Biegung um die schwache Achse (Mz) vorhanden – nicht bemessen' },
  'beam.torsion': { en: 'torsion not designed', de: 'Torsion nicht bemessen' },
  'beam.shearSIA': { en: 'shear: fixed compression field cot α = {c}, z = 0.9d ({ref})', de: 'Querkraft: Druckfeldneigung cot α = {c}, z = 0.9·d ({ref})' },
  'beam.shearEC': { en: 'shear: variable strut, cot θ {c} (≤ {max}), z = 0.9d ({ref})', de: 'Querkraft: variable Druckstrebenneigung cot θ {c} (≤ {max}), z = 0.9·d ({ref})' },
  // ---- RC columns
  'col.noCases': { en: 'no result cases – minimum reinforcement only', de: 'keine Ergebnisfälle – nur Mindestbewehrung' },
  'col.noCompression': { en: 'λ{k} = {lam}: no compression – 2nd-order effects not relevant', de: 'λ{k} = {lam}: keine Druckkraft – Theorie II. Ordnung nicht massgebend' },
  'col.slender': { en: 'λ{k} = {lam} > λlim = {lim}: slender – 2nd-order moments (nominal curvature, {ref} 5.8.8)', de: 'λ{k} = {lam} > λlim = {lim}: schlank – Momente nach Theorie II. Ordnung (Nennkrümmung, {ref} 5.8.8)' },
  'col.stocky': { en: 'λ{k} = {lam} ≤ λlim = {lim}: not slender – 2nd-order effects neglected ({ref} 5.8.3.1)', de: 'λ{k} = {lam} ≤ λlim = {lim}: gedrungen – Theorie II. Ordnung vernachlässigbar ({ref} 5.8.3.1)' },
  'col.sway': { en: 'K{k} = {K} > 1: sway member – C = 0.7, MEd = M0,max + M2 (conservative)', de: 'K{k} = {K} > 1: verschiebliches System – C = 0.7, MEd = M0,max + M2 (konservativ)' },
  'col.imperfection': { en: 'imperfection ei = l0/400 ({y} / {z} mm, {ref} 5.2(7)) and minimum eccentricity e0 = max(h/30, 20 mm) (6.1(4)), applied in one direction at a time (5.8.9(2))', de: 'Imperfektion ei = l0/400 ({y} / {z} mm, {ref} 5.2(7)) und Mindestausmitte e0 = max(h/30, 20 mm), jeweils nur in einer Richtung (5.8.9(2))' },
  'col.creep': { en: 'φef = {phi}: A = {A} (5.8.3.1), Kφ = 1 + β·φef (5.8.8.3(4))', de: 'φef = {phi}: A = {A} (5.8.3.1), Kφ = 1 + β·φef (5.8.8.3(4))' },
  'col.noCreep': { en: 'φef = 0: creep not considered (set design.rc.phiEf; 5.8.4)', de: 'φef = 0: Kriechen nicht berücksichtigt (Kriechzahl in den Bewehrungsparametern; EN 1992-1-1 5.8.4)' },
  'col.govCirc': { en: 'governing {key} (imperfection in {imp}): resultant MEd = {M} kNm vs MRd = {MR} kNm at NEd = {N} kN → η = {eta}', de: 'massgebend {key} (Imperfektion in {imp}): resultierendes MEd = {M} kNm, MRd = {MR} kNm bei NEd = {N} kN → η = {eta}' },
  'col.govBiax': { en: 'governing {key} (imperfection in {imp}): biaxial (MEdz/MRdz)^a + (MEdy/MRdy)^a, a = {a} ({ref} 5.8.9(4)); NEd = {N} kN, MEdy = {My}/{MRy}, MEdz = {Mz}/{MRz} kNm → η = {eta}', de: 'massgebend {key} (Imperfektion in {imp}): zweiachsig (MEdz/MRdz)^a + (MEdy/MRdy)^a mit a = {a} ({ref} 5.8.9(4)); NEd = {N} kN, MEdy/MRdy = {My}/{MRy}, MEdz/MRdz = {Mz}/{MRz} kNm → η = {eta}' },
  'col.e0': { en: 'minimum eccentricity e0 = {e0} mm governs MEd{k} ({ref} 6.1(4))', de: 'Mindestausmitte e0 = {e0} mm massgebend für MEd{k} ({ref} 6.1(4))' },
  'col.tension': { en: '{n} case(s) with tension: designed for N + M without imperfection / 2nd-order effects', de: '{n} Fälle mit Zug: bemessen für N + M ohne Imperfektion und Theorie II. Ordnung' },
  'col.asMinSIA': { en: 'As,min = 0.6 %·Ac = {As} cm² governs (SIA 262 5.5.4 – verify)', de: 'As,min = 0.6 %·Ac = {As} cm² massgebend (SIA 262 5.5.4 – zu prüfen)' },
  'col.asMinEC': { en: 'As,min = max(0.10·NEd/fyd, 0.002·Ac) = {As} cm² governs (EN 1992-1-1 9.5.2(2))', de: 'As,min = max(0.10·NEd/fyd, 0.002·Ac) = {As} cm² massgebend (EN 1992-1-1 9.5.2(2))' },
  'col.insufficient': { level: warn, en: 'η > 1 even with As = {pct} %·Ac – section too small', de: 'η > 1 auch mit As = {pct} %·Ac – Querschnitt zu klein' },
  'col.asMax': { level: warn, en: 'As,req = {As} cm² > As,max = 0.04·Ac = {AsMax} cm² (EN 1992-1-1 9.5.2(3)) – section too small', de: 'As,erf = {As} cm² > As,max = 0.04·Ac = {AsMax} cm² – Querschnitt zu klein' },
  'col.provMax': { level: warn, en: 'provided {n} Ø{dia} = {As} cm² > As,max = 0.04·Ac (EN 1992-1-1 9.5.2(3))', de: 'gewählt {n} Ø{dia} = {As} cm² > As,max = 0.04·Ac (EN 1992-1-1 9.5.2(3))' },
  'col.barsShort': { level: warn, en: 'no bar diameter ≤ Ø{dia} satisfies η ≤ 1 with the {n}-bar pattern', de: 'kein Stabdurchmesser ≤ Ø{dia} erfüllt η ≤ 1 mit {n} Stäben' },
  'col.dense': { en: 'denser bar pattern ({n} bars) – the {s} mm pattern is not sufficient within As,max', de: 'dichtere Stabanordnung ({n} Stäbe) – Abstand {s} mm genügt nicht' },
  'col.spacing': { level: warn, en: 'clear bar spacing {s} mm < max(Ø, 20 mm) (EN 1992-1-1 8.2(2))', de: 'lichter Stababstand {s} mm < max(Ø, 20 mm) (EN 1992-1-1 8.2(2))' },
  'col.beyond': { level: warn, en: '|NEd| exceeds the axial resistance in {n} case(s)', de: '|NEd| übersteigt den Normalkraftwiderstand in {n} Fällen' },
  'col.noShear': { en: 'shear and links not designed (links: EN 1992-1-1 9.5.3)', de: 'Querkraft und Bügel nicht bemessen (Bügel: EN 1992-1-1 9.5.3)' },
  'col.sia': { en: 'SIA 262 4.3.7 (second-order effects) approximated by the EN 1992-1-1 5.8.8 nominal-curvature method with SIA material values – verify', de: 'SIA 262 4.3.7 (Theorie II. Ordnung) näherungsweise mit der Nennkrümmungsmethode EN 1992-1-1 5.8.8 und SIA-Materialwerten – zu prüfen' },
  // ---- steel
  'st.shearBuckling': { en: 'hw/tw = {v} > 72ε: shear buckling (EN 1993-1-5) not checked', de: 'hw/tw = {v} > 72ε: Schubbeulen (EN 1993-1-5) nicht nachgewiesen' },
  'st.uSection': { en: 'U section: torsional-flexural buckling and shear-centre eccentricity not checked', de: 'U-Querschnitt: Biegedrillknicken und Schubmittelpunkt-Exzentrizität nicht nachgewiesen' },
  'st.tSection': { en: 'T section: monosymmetry in Mcr and torsional-flexural buckling neglected', de: 'T-Querschnitt: Einfachsymmetrie in Mcr und Biegedrillknicken vernachlässigt' },
  'st.lSection': { en: 'L section: checked about the geometric y/z axes (principal v-axis buckling and LTB not checked)', de: 'Winkel: um die geometrischen y/z-Achsen nachgewiesen (Knicken um die Hauptachse v und Kippen nicht nachgewiesen)' },
  'st.generic': { en: 'section shape {shape} without usable dims: class {cls} assumed, curve c', de: 'Querschnittsform {shape} ohne Abmessungen: Klasse {cls} angenommen, Knicklinie c' },
  'st.noShearArea': { en: 'no shear area – shear not checked', de: 'keine Schubfläche – Querkraft nicht nachgewiesen' },
  'st.alu': { en: 'aluminium approximated with EN 1993-1-1 rules (EN 1999 not implemented)', de: 'Aluminium näherungsweise nach EN 1993-1-1 (EN 1999 nicht umgesetzt)' },
  'st.noWel': { en: 'elastic section moduli missing – bending checks skipped', de: 'elastische Widerstandsmomente fehlen – Biegenachweise entfallen' },
  'st.noWpl': { en: 'Wpl missing – elastic moduli used', de: 'Wpl fehlt – elastische Widerstandsmomente verwendet' },
  'st.chs4': { en: 'CHS class 4 (EN 1993-1-6) treated as class 3', de: 'Rundrohr Klasse 4 (EN 1993-1-6) wie Klasse 3 behandelt' },
  'st.noIt': { en: 'It missing – LTB not checked', de: 'It fehlt – Biegedrillknicken nicht nachgewiesen' },
  'st.klt0': { en: 'KLT ≤ 0: laterally restrained, χLT = 1', de: 'KLT ≤ 0: seitlich gehalten, χLT = 1' },
  // ---- timber
  'tb.generic': { en: 'section shape {shape}: km = 1, τ = 1.5·V/A, kh = 1', de: 'Querschnittsform {shape}: km = 1, τ = 1.5·V/A, kh = 1' },
  'tb.noFvk': { en: 'fvk missing – shear not checked', de: 'fvk fehlt – Querkraft nicht nachgewiesen' },
  'tb.noFt0k': { en: 'ft0k missing – tension checked with fc0k', de: 'ft0k fehlt – Zug mit fc0k nachgewiesen' },
  'tb.duration': { en: 'case {key}: load duration unknown – medium-term assumed', de: 'Fall {key}: Lasteinwirkungsdauer unbekannt – mittel angenommen' },
  // ---- load panels (fem/panels.js)
  'panel.notSurface': { level: warn, en: 'Load {id}: only surface loads act on load panel {panel} – ignored.', de: 'Last {id}: auf Lastfläche {panel} wirken nur Flächenlasten – ignoriert' },
  'panel.noLines': { level: warn, en: 'Load {id}: load panel {panel} has no supporting lines (beams, ribs, walls) – load ignored.', de: 'Last {id}: Lastfläche {panel} hat keine tragenden Linien (Balken, Rippen, Wände) – Last ignoriert' },
};

export class Msg {
  constructor(code, p = {}) { this.code = code; this.p = p; }
  get level() { return MESSAGES[this.code]?.level || 'info'; }
  /** text in 'en' or 'de'; show(name, value) may replace a parameter for display (e.g. case key → name) */
  format(lang = 'en', show = null) {
    const m = MESSAGES[this.code];
    const tpl = (m && (m[lang] || m.en)) || this.code;
    return tpl.replace(/\{(\w+)\}/g, (s, k) => {
      const v = this.p[k];
      if (v == null) return s;
      if (v instanceof Msg) return v.format(lang, show);
      return String(show?.(k, v) ?? v);
    });
  }
  toString() { return this.format('en'); }
}

export const msg = (code, p) => new Msg(code, p);
