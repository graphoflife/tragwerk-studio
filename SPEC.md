# Tragwerk Studio – Interface Specification (internal contract)

Static browser app (GitHub Pages), plain ES modules, no build step. Every module in
`js/fem`, `js/mesh`, `js/lib`, `js/design` must be **pure JS without DOM access** so it runs in
the browser, in a Web Worker and in Node 18 (`package.json` has `"type": "module"`).
Use relative imports with explicit `.js` extensions. No external dependencies.

## 1. Units (internal, consistent)

| quantity | unit |
|---|---|
| length | m |
| force | kN |
| mass | t (tonne) → kN = t·m/s² |
| stress, E, G, strengths | kN/m² (1 N/mm² = 1000 kN/m²) |
| density `rho` | t/m³ (steel 7.85) |
| line load | kN/m |
| surface load | kN/m² |
| moment | kNm |
| temperature | K (°C differences) |
| angles in model data | degrees |
| g | 9.81 m/s² |

The UI converts for display only.

## 2. Model (JSON, `model.version = 1`)

All entity arrays hold plain objects with unique integer `id` (>0, unique per array).
References are by id. Consumers build `Map`s themselves. Unknown/optional fields may be absent.

```js
model = {
  version: 1,
  meta: { name, author, description, created, modified },
  settings: {
    meshSize: 1.0,            // target FE size for domains [m]
    beamDivisions: 4,         // default FE subdivisions per line element (>=1)
    g: 9.81,
    code: 'EC',               // design code family: 'EC' (Eurocode EN 1990–1995/1998) | 'SIA' (SIA 260/261/262/263/265)
  },
  nodes:     [{ id, x, y, z }],
  lines:     [{ id, n1, n2, element: LineElement | null }],   // element null = pure geometry
  domains:   [Domain],
  materials: [Material],
  sections:  [Section],
  supports:  [Support],
  loadGroups:[LoadGroup],
  loadCases: [LoadCase],
  loads:     [Load],
  combinations: [Combination],
}
```

### 2.1 LineElement
```js
{
  type: 'beam' | 'truss' | 'rib' | 'rigid' | 'spring',
  material: materialId, section: sectionId,   // not needed for rigid/spring
  beta: 0,                    // rotation of local axes about local x [deg]
  releases: { i: [b,b,b,b,b,b], j: [b,b,b,b,b,b] }, // true = released local dof (ux,uy,uz,rx,ry,rz) at end i/j (beam/rib only)
  nl: null | 'tension' | 'compression',       // tension-/compression-only (truss) – nonlinear analysis only
  k: [kx,ky,kz,krx,kry,krz],  // spring only, GLOBAL directions [kN/m, kNm/rad]
  divisions: undefined | n,   // override settings.beamDivisions
  design: { Ky:1, Kz:1, KLT:1, C1:1.0, steelCheck:true,  // buckling length factors (L_cr = K·L), optional
            rc: { cover, dia, diaStirrup, fyk, tBeam:true, l0Factor:1 } }, // RC beams; tBeam = T-beam with slab
  ecc: undefined | number | 'auto', // eccentricity along local z (m); 'auto' = below a slab with flush top faces.
                                    // The mesher puts the element axis on an offset node row and couples it with
                                    // rigid elements (mesh beam field `ecc` = offset along local z).
}
```
`rib` = beam that is eccentric/attached to a domain; treat exactly like `beam`.
`rigid` = very stiff beam (solver uses stiffness ≈ 1e4 × max beam stiffness of the model, or E=1e10, A=1, I=1).

**Local axes of a line** (from node n1 → n2):
- `ex = normalize(p2 - p1)`
- reference `r = (0,0,1)`; if `|ex·r| > 0.999` (vertical member) use `r = (1,0,0)`
- `ey = normalize(r × ex)`, `ez = ex × ey`
- then rotate `ey, ez` about `ex` by `beta` (right-hand rule).
- Horizontal beam along +X → ey=+Y, ez=+Z (strong axis bending My in vertical plane).
- Section: `Iy` = strong-axis inertia (bending about local y, height `h` along local z).

### 2.2 Domain (surface element)
```js
{
  id, nodes: [nodeIds...],        // outer polygon, ≥3 corner nodes, planar, no repeat of first
  holes: [[nodeIds...], ...],     // optional
  type: 'shell' | 'plate' | 'membrane' | 'panel',   // panel = load panel (no stiffness, not meshed): panel: { dist: 'two'|'x'|'y' }
  material: id, thickness: 0.2,   // [m]
  meshSize: undefined | h,        // override settings.meshSize
  rc: { coverB: 0.03, coverT: 0.03, diaX: 0.012, diaY: 0.012, fyk: 500000 },  // RC design params (optional;
                                  //   legacy cover/dia apply to both faces/directions; x = outer layer)
  rcProv: { xb: { dia, s }, yb, xt, yt },  // provided reinforcement per layer (optional, m)
}
```
**Local axes of a domain**: `n` = Newell normal of the outer polygon. Orient so that
`n·Z > 1e-6`; if `|n·Z| <= 1e-6`: orient so `n·Y > 1e-6`; else `n·X > 0`. `ez = n`.
`ex` = projection of global X onto the plane; if its length < 1e-6 use projection of global Y.
`ey = ez × ex`. Horizontal slab → ex=X, ey=Y, ez=Z.

Model-level lists (optional, see `js/core/parts.js` and `js/core/seclines.js`):
```js
parts: [{ id, name, nodes:[ids], lines:[ids], domains:[ids] }],   // user parts (Teile)
storeys: [{ id, z, name? }],                                      // storey levels (Geschosse)
sectionLines: [{ id, name, a:[x,y,z], b:[x,y,z], on:true }],      // result section lines
```

### 2.3 Material
```js
{ id, name, type: 'steel'|'concrete'|'timber'|'aluminium'|'other',
  E, G, nu, rho, alpha,              // kN/m², kN/m², –, t/m³, 1/K
  fy, fu,                            // steel/aluminium [kN/m²]
  fck, fctm,                         // concrete [kN/m²]
  timber: { fmk, ft0k, fc0k, fvk, ft90k, fc90k, E0mean, E005, Gmean, rhok, kind:'solid'|'glulam', serviceClass:1 },
  gammaM: undefined }                // optional override of partial factor
```

### 2.4 Section
```js
{ id, name, shape: 'I'|'RHS'|'CHS'|'RECT'|'CIRC'|'T'|'L'|'U'|'BOX'|'GENERIC',
  family: 'IPE'|'HEA'|...|'PARAM'|'GENERIC',
  fabrication: 'rolled'|'welded'|'cold',
  dims: {...},                       // m; see below
  A, Iy, Iz, It, Iw,                 // m², m⁴, m⁴, m⁴, m⁶
  Wely, Welz, Wply, Wplz,            // m³
  Avy, Avz,                          // shear areas m² (0/undefined → no shear deformation)
  iy, iz, ymax?, zmax? }             // m
```
dims per shape: `I`: h,b,tw,tf,r · `RHS`: h,b,t,r · `CHS`: d,t · `RECT`: h,b · `CIRC`: d ·
`T`: h,b,tw,tf · `L`: h,b,t · `U`: h,b,tw,tf · `BOX`: h,b,tw,tf · `GENERIC`: none.
`h` is along local z, `b` along local y.

### 2.5 Support
```js
{ id, type: 'node', node: id,  dofs: [d,d,d,d,d,d], uplift: false }
{ id, type: 'line', line: id,  dofs: [d,d,d,d,d,d] }   // per unit length, global directions
{ id, type: 'surface', domain: id, k: [kx,ky,kz] }     // Winkler bedding kN/m³, DOMAIN local axes
```
`d` = `'F'` (fixed / rigid) or a number ≥ 0 (spring stiffness; 0 = free). Order: ux,uy,uz,rx,ry,rz, global.
`uplift: true` → the Z component only acts in compression (reaction Rz ≥ 0, i.e. resists downward
movement only) – nonlinear analysis only; linear analysis treats it as bilateral.

### 2.6 Loads
```js
loadGroups: [{ id, name, type: 'permanent'|'variable'|'snow'|'wind'|'accidental'|'seismic',
               gammaSup: 1.35, gammaInf: 1.0, psi0: 0.7, psi1: 0.5, psi2: 0.3,
               exclusive: false }]   // exclusive: only one case of group active at a time
loadCases:  [{ id, name, group: groupId|null, selfWeight: false, color? }]
loads: [
 { id, lc, type: 'node',  node, F: [Fx,Fy,Fz,Mx,My,Mz] },                 // global
 { id, lc, type: 'lineDist', line, dir: 'X'|'Y'|'Z'|'x'|'y'|'z', q1, q2,  // kN/m at a / b
         a: 0, b: 1, projected: false },  // a,b: relative positions 0..1 along line; uppercase=global, lowercase=local; projected only for global dirs
 { id, lc, type: 'linePoint', line, dir, F, pos: 0.5, moment: false },     // concentrated force (or moment if moment:true, about dir axis)
 { id, lc, type: 'surface', domain, dir: 'X'|'Y'|'Z'|'z', q, projected:false }, // uniform kN/m², z = domain local normal
   //  optional dist: 'linear' (q at p1 → q2 at p2, constant outside) | 'hydro' (q·(z0 − z) below z0; q = kN/m² per m)
   //  on a load panel (domain.type 'panel') the load is distributed to its lines (js/fem/panels.js)
 { id, lc, type: 'surfaceLine', domain, a:[x,y,z], b:[x,y,z], dir, q1, q2, projected }, // line load anywhere on a surface
 { id, lc, type: 'surfacePoint', domain, p:[x,y,z], dir, F },                           // point load anywhere on a surface
 { id, lc, type: 'tempLine', line, dT: 0, dTz: 0, dTy: 0 },  // uniform + linear gradients (T(+z face) - T(-z face))
 { id, lc, type: 'tempDomain', domain, dT: 0, dTz: 0 },       // dTz = T_top - T_bottom (top = +z side)
 { id, lc, type: 'nodeDisp', node, d: [6] },                   // prescribed support displacement (m / rad), only on supported dofs
]
combinations: [{ id, name, type: 'ULS'|'ULS-ACC'|'SLS-CHAR'|'SLS-FREQ'|'SLS-QP'|'CUSTOM',
                 factors: { [loadCaseId]: factor } }]
```
Negative `F`/`q` with dir `Z` = downward (gravity). Self weight (`loadCase.selfWeight`) acts in −Z.

## 3. Mesh (output of `js/mesh/mesher.js`)

```js
import { buildMesh } from './js/mesh/mesher.js';
const mesh = buildMesh(model, { meshSize?, beamDivisions? });
mesh = {
  nodes: Float64Array(3*nn),            // x,y,z
  nodeModelId: Int32Array(nn),          // model node id or 0 if generated
  beams: [{ n1, n2, line: lineId, type, material, section, beta,
            ex:[3], ey:[3], ez:[3],     // local axes (same as model line)
            relI:[6]|null, relJ:[6]|null,   // releases only on the first/last segment of a line
            t0, t1,                     // parameter range along the model line (0..1)
            nl, k }],                   // copied from LineElement
  shells: [{ nodes:[a,b,c,d], domain: domainId, type, material, thickness,
             ex:[3], ey:[3], ez:[3] }],  // domain local axes; quads only, CCW about ez
  lineNodes: { [lineId]: [{ node, t }] }, // ordered FE node chain along every model line (incl. geometry-only lines lying on domain edges / inside domains)
  domainElems: { [domainId]: [shellIdx...] },
  domainNodes: { [domainId]: [nodeIdx...] },
  modelNodeToMesh: { [modelNodeId]: meshNodeIdx },
  warnings: [string],
  stats: { nodes, beams, shells },
}
```

## 4. FEM core (`js/fem/index.js`, worker `js/fem/worker.js`)

DOF order per node: ux, uy, uz, rx, ry, rz (global). Arrays of nodal values have length `6*nn`.

```js
import { runStatic, runModal, runBuckling, runSpectrum, combineCases, envelope, lineForces } from './js/fem/index.js';

runStatic(model, mesh, { nonlinear:false, pDelta:false, cases:'all', combos:true, onProgress }) → {
  cases: { 'LC:<id>': CaseResult, 'CO:<id>': CaseResult },   // linear: combos by superposition; nonlinear: each combo solved directly
  warnings:[...], error: null | { code:'MECHANISM'|'NO_SUPPORTS'|..., message, node?, dof? }, stats:{ dofs, ms }
}
CaseResult = {
  disp: Float64Array(6*nn),              // global
  reac: Float64Array(6*nn),              // support reactions (incl. springs, line/surface supports lumped to nodes)
  beams: [ { x: Float64Array(ns), N, Vy, Vz, T, My, Mz, uy, uz } ],  // per mesh beam, ns = 11 stations, x in m from FE start, local values; uy,uz = local deflection incl. span deflection
  shells: Float64Array(nShell*4*8),      // per element corner, nodal-averaged within the same domain:
                                         // [nx, ny, nxy, mx, my, mxy, vx, vy] in domain local axes
  shellsRaw: Float64Array(nShell*4*8),   // unsmoothed corner values
}
```
**Sign conventions** (must be verified by tests):
- N > 0 tension. Simply supported beam along X, span L, uniform q downward (−Z):
  `My(L/2) = +qL²/8`, `Vz(0) = +qL/2`, `Vz(L) = −qL/2` (Vz = dMy/dx).
- Load in −y local → `Mz(L/2) > 0`, `Vy = dMz/dx`.
- Cantilever fixed at x=0, tip load P in −Z: `My(0) = −PL`, `Vz = +P`.
- Shells: `nx>0` tension; `mx>0` = tension on the −z face (sagging of a slab under downward load);
  σ_bottom = nx/t + 6mx/t², σ_top = nx/t − 6mx/t².
- Reactions: force exerted by the support on the structure (gravity load → Rz > 0).

```js
runModal(model, mesh, { nModes:6, massCase: lcId|null, massFactor:1, selfWeightMass:true, onProgress }) → {
  modes: [{ omega, f, T, shape: Float64Array(6*nn) /* mass-normalized */, partFactor:[3], effMass:[3] /* ratio 0..1 in X,Y,Z */ }],
  totalMass: [mx,my,mz], warnings, error }
runBuckling(model, mesh, { factors: {lcId: factor} , nModes:4 }) → { modes: [{ lambda, shape }], warnings, error }
runSpectrum(model, mesh, modal, { code:'EC'|'SIA', dir:'X'|'Y'|'Z', ag, soil:'A'..'E' (SIA: 'A'..'F'), zone?:'Z1a'|'Z1b'|'Z2'|'Z3a'|'Z3b' (SIA, sets agd), q:1.5, eta?, importance:1 (SIA γf: 1.0/1.2/1.4), rule:'SRSS'|'CQC', damping:0.05 }) → CaseResult (positive envelope values)
combineCases(caseResults:[CaseResult], factors:[number]) → CaseResult
envelope(caseResults:[CaseResult]) → { min: CaseResult, max: CaseResult }
lineForces(mesh, caseResult, lineId) → { x:[] /* m from line start, all stations of all segments */, N:[], Vy:[], Vz:[], T:[], My:[], Mz:[] }
```
Worker protocol: `postMessage({ id, cmd:'static'|'modal'|'buckling'|'spectrum', model, mesh, options })`
→ worker posts `{ id, type:'progress', pct, msg }` and finally `{ id, type:'result', data }` or `{ id, type:'error', message }`.
Mesh/result typed arrays are cloned (structured clone).

## 5. Design (`js/design/*.js`)

Every design function accepts an optional last argument `opts` with `opts.code: 'EC'|'SIA'`
(default: `model.settings.code ?? 'EC'`). `'SIA'` = Swiss codes: SIA 260 (basis, combinations),
SIA 261 (actions, seismic spectrum), SIA 262 (concrete), SIA 263 (steel), SIA 265 (timber).
Result objects carry `code` and clause references in `detail` strings (e.g. "SIA 263 4.5.2").

```js
import { generateCombinations } from './js/design/combinations.js';
generateCombinations(model, { uls:'6.10'|'6.10ab', sls:true }) → [Combination]  // EC0, without ids (caller assigns)
import { checkSteelMembers } from './js/design/steel.js';
checkSteelMembers(model, mesh, staticResults, caseKeys:[string]) → [{ line, eta, governing:{ check, caseKey, x }, cls, checks:{ [name]: { eta, caseKey, x, detail } } }]
import { designRCSurfaces, designRCBeams } from './js/design/concrete.js';
designRCSurfaces(model, mesh, staticResults, caseKeys) → { asCorner: Float64Array(nShell*4*4) /* [axb, ayb, axt, ayt] m²/m, max over cases */, warnings }
designRCBeams(model, mesh, staticResults, caseKeys) → [{ line, x:[], AsBot:[], AsTop:[], Asw:[] /* m²/m */ , ok, notes }]
import { checkTimberMembers } from './js/design/timber.js';
checkTimberMembers(model, mesh, staticResults, caseKeys) → same shape as checkSteelMembers
```

## 6. Libraries (`js/lib`)
```js
import { SECTION_FAMILIES, getLibrarySection, makeParametricSection, sectionOutline } from './js/lib/sections.js';
SECTION_FAMILIES = [{ key:'IPE', label:'IPE', shape:'I', names:['IPE 80', ...] }, ...]
getLibrarySection('HEB 200') → Section (without id)
makeParametricSection('RECT', { h:0.5, b:0.3 }) → Section (without id)
sectionOutline(section) → { outer:[[y,z],...], holes:[[[y,z],...]] }   // m, centroid at origin
import { MATERIAL_LIBRARY, getLibraryMaterial } from './js/lib/materials.js';
```
