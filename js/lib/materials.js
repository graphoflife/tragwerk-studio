// Tragwerk Studio – material library (SPEC §2.3, §6)
//
// Internal units: E, G, strengths in kN/m² (1 N/mm² = 1000 kN/m²), rho in t/m³, alpha in 1/K.
// Every entry is a material template WITHOUT `id` – the caller assigns ids.
//
// Notes / deviations from SPEC.md:
//  * Extra informative fields: `norm` (code reference), `grade`, and for concrete `fcm`, `fckCube`,
//    `fctk05`, `fctk95`, `Ecm`, `epsCu3`; for steel `fy40`/`fu40` (40 mm < t <= 80 mm values);
//    for aluminium `f0` (= fy, 0.2 % proof strength).
//  * Timber: `rho` = mean density (for self weight), `timber.rhok` = characteristic density – both in
//    t/m³ (internal unit, e.g. C24: rhok = 0.35). `E` = E0mean, `G` = Gmean. Timber is orthotropic;
//    `nu` (0.3) is only a nominal value for isotropic shell elements – beams use E and G directly.
//  * Rebar B500B is listed with type 'other' (reference material for reinforcement).

const MPA = 1000; // N/mm² → kN/m²

function steel(name, fy, fu, fy40, fu40, norm) {
  const E = 210000 * MPA, nu = 0.3;
  return {
    name, type: 'steel', grade: name,
    E, G: E / (2 * (1 + nu)), nu, rho: 7.85, alpha: 1.2e-5,
    fy: fy * MPA, fu: fu * MPA, fy40: fy40 * MPA, fu40: fu40 * MPA,
    norm,
  };
}

// EN 1992-1-1 Table 3.1: [fck, fck,cube, fctm, fctk0.05, fctk0.95, Ecm (GPa)]
function concrete(fck, fckCube, fctm, fctk05, fctk95, EcmGPa) {
  const E = EcmGPa * 1e6, nu = 0.2;
  return {
    name: `C${fck}/${fckCube}`, type: 'concrete', grade: `C${fck}/${fckCube}`,
    E, G: E / (2 * (1 + nu)), nu, rho: 2.5, alpha: 1.0e-5,
    fck: fck * MPA, fctm: fctm * MPA,
    fckCube: fckCube * MPA, fcm: (fck + 8) * MPA, fctk05: fctk05 * MPA, fctk95: fctk95 * MPA,
    Ecm: E, epsCu3: 0.0035,
    norm: 'EN 1992-1-1',
  };
}

// strengths/stiffness in N/mm², densities in kg/m³
function timber(name, kind, v, norm) {
  return {
    name, type: 'timber', grade: name,
    E: v.E0mean * MPA, G: v.Gmean * MPA, nu: 0.3,
    rho: v.rhomean / 1000, alpha: 5.0e-6,
    timber: {
      fmk: v.fmk * MPA, ft0k: v.ft0k * MPA, fc0k: v.fc0k * MPA, fvk: v.fvk * MPA,
      ft90k: v.ft90k * MPA, fc90k: v.fc90k * MPA,
      E0mean: v.E0mean * MPA, E005: v.E005 * MPA, Gmean: v.Gmean * MPA,
      rhok: v.rhok / 1000, rhomean: v.rhomean / 1000,
      kind, serviceClass: 1,
    },
    norm,
  };
}

function aluminium(name, f0, fu) {
  const E = 70000 * MPA, nu = 0.3;
  return {
    name, type: 'aluminium', grade: name,
    E, G: 27000 * MPA, nu, rho: 2.7, alpha: 2.3e-5,
    fy: f0 * MPA, fu: fu * MPA, f0: f0 * MPA,
    norm: 'EN 1999-1-1',
  };
}

export const MATERIAL_LIBRARY = [
  // Structural steel, EN 1993-1-1 Table 3.1 (t <= 40 mm; fy40/fu40 for 40 < t <= 80 mm)
  steel('S235', 235, 360, 215, 360, 'EN 1993-1-1 / EN 10025-2'),
  steel('S275', 275, 430, 255, 410, 'EN 1993-1-1 / EN 10025-2'),
  steel('S355', 355, 510, 335, 470, 'EN 1993-1-1 / EN 10025-2'),
  steel('S420', 420, 520, 390, 520, 'EN 1993-1-1 / EN 10025-3'),
  steel('S460', 460, 540, 430, 540, 'EN 1993-1-1 / EN 10025-3'),

  // Concrete, EN 1992-1-1 Table 3.1
  concrete(12, 15, 1.6, 1.1, 2.0, 27),
  concrete(16, 20, 1.9, 1.3, 2.5, 29),
  concrete(20, 25, 2.2, 1.5, 2.9, 30),
  concrete(25, 30, 2.6, 1.8, 3.3, 31),
  concrete(30, 37, 2.9, 2.0, 3.8, 33),
  concrete(35, 45, 3.2, 2.2, 4.2, 34),
  concrete(40, 50, 3.5, 2.5, 4.6, 35),
  concrete(45, 55, 3.8, 2.7, 4.9, 36),
  concrete(50, 60, 4.1, 2.9, 5.3, 37),

  // Solid softwood, EN 338:2016 Table 1
  timber('C16', 'solid', { fmk: 16, ft0k: 8.5, fc0k: 17, fvk: 3.2, ft90k: 0.4, fc90k: 2.2, E0mean: 8000, E005: 5400, Gmean: 500, rhok: 310, rhomean: 370 }, 'EN 338 / EN 1995-1-1'),
  timber('C24', 'solid', { fmk: 24, ft0k: 14.5, fc0k: 21, fvk: 4.0, ft90k: 0.4, fc90k: 2.5, E0mean: 11000, E005: 7400, Gmean: 690, rhok: 350, rhomean: 420 }, 'EN 338 / EN 1995-1-1'),
  timber('C30', 'solid', { fmk: 30, ft0k: 19, fc0k: 24, fvk: 4.0, ft90k: 0.4, fc90k: 2.7, E0mean: 12000, E005: 8000, Gmean: 750, rhok: 380, rhomean: 460 }, 'EN 338 / EN 1995-1-1'),
  // Glued laminated timber, EN 14080:2013 Table 5
  timber('GL24h', 'glulam', { fmk: 24, ft0k: 19.2, fc0k: 24, fvk: 3.5, ft90k: 0.5, fc90k: 2.5, E0mean: 11500, E005: 9600, Gmean: 650, rhok: 385, rhomean: 420 }, 'EN 14080 / EN 1995-1-1'),
  timber('GL28h', 'glulam', { fmk: 28, ft0k: 22.3, fc0k: 28, fvk: 3.5, ft90k: 0.5, fc90k: 2.5, E0mean: 12600, E005: 10500, Gmean: 650, rhok: 425, rhomean: 460 }, 'EN 14080 / EN 1995-1-1'),
  timber('GL32h', 'glulam', { fmk: 32, ft0k: 25.6, fc0k: 32, fvk: 3.5, ft90k: 0.5, fc90k: 2.5, E0mean: 14200, E005: 11800, Gmean: 650, rhok: 440, rhomean: 490 }, 'EN 14080 / EN 1995-1-1'),

  // Aluminium, EN 1999-1-1 Table 3.2b (extruded profiles; 6061: t <= 25 mm, 6082: 5 < t <= 25 mm)
  aluminium('EN AW-6061 T6', 240, 260),
  aluminium('EN AW-6082 T6', 260, 310),

  // Reinforcing steel (reference), EN 1992-1-1 Annex C / DIN 488
  {
    name: 'Rebar B500B', type: 'other', grade: 'B500B',
    E: 200000 * MPA, G: 200000 * MPA / 2.6, nu: 0.3, rho: 7.85, alpha: 1.0e-5,
    fy: 500 * MPA, fu: 540 * MPA, fyk: 500 * MPA, ftk: 540 * MPA, epsUk: 0.05,
    norm: 'EN 1992-1-1 / DIN 488',
  },
];

function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

function normName(s) {
  return String(s ?? '').toUpperCase().replace(/[\s_-]+/g, '');
}

const BY_NAME = new Map();
for (const m of MATERIAL_LIBRARY) {
  BY_NAME.set(normName(m.name), m);
}
// convenient aliases
BY_NAME.set(normName('B500B'), MATERIAL_LIBRARY.find((m) => m.name === 'Rebar B500B'));
BY_NAME.set(normName('6061 T6'), MATERIAL_LIBRARY.find((m) => m.name === 'EN AW-6061 T6'));
BY_NAME.set(normName('6082 T6'), MATERIAL_LIBRARY.find((m) => m.name === 'EN AW-6082 T6'));
BY_NAME.set(normName('EN AW-6061-T6'), MATERIAL_LIBRARY.find((m) => m.name === 'EN AW-6061 T6'));
BY_NAME.set(normName('EN AW-6082-T6'), MATERIAL_LIBRARY.find((m) => m.name === 'EN AW-6082 T6'));

/** Returns a deep copy of the library material `name` (without id) or null if unknown. */
export function getLibraryMaterial(name) {
  const m = BY_NAME.get(normName(name));
  return m ? deepCopy(m) : null;
}
