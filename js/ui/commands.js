// Command registry (used by ribbon, menus, command palette and keyboard shortcuts) and ribbon layout.
import { t } from '../i18n.js';
import { toast } from './dom.js';
import { intersectLines, mergeNodes } from '../core/model.js';
import { deleteSelection } from './dialogs/delete.js';
import { openMaterials, openSections, openLoadCases, openCombinations, autoCombinations } from './dialogs/manage.js';
import { assignLineElement, editReleases, supportDialog, quickSupport, domainFromSelection, addHoleFromSelection, designParams } from './dialogs/assign.js';
import { nodeLoadDialog, lineLoadDialog, surfaceLoadDialog, temperatureDialog, settlementDialog, toggleSelfWeight, snowWindDialog } from './dialogs/loads.js';
import { transformDialog, splitDialog } from './dialogs/transform.js';
import { generatorDialog } from './dialogs/generators.js';
import { runStatic, runModalDialog, runBucklingDialog, runSpectrumDialog, runDesign, meshGenerate, meshSettings, checkModel } from './dialogs/analysis.js';
import { rcParamsDialog, rcProvidedDialog, rcProtocolDialog, rcBeamDetail, memberDetail } from './dialogs/rc.js';
import { settingsDialog, modelInfoDialog } from './dialogs/settings.js';
import { openTables } from './dialogs/tables.js';
import { openReport } from './dialogs/report.js';
import { welcomeDialog, shortcutsDialog, examplesDialog } from './dialogs/help.js';

export const MODULES = [
  { id: 'geometry', label: 'Geometrie', icon: 'polyline', mod: 'lavender' },
  { id: 'elements', label: 'Elemente', icon: 'beam', mod: 'sky' },
  { id: 'loads', label: 'Lasten', icon: 'loadLine', mod: 'rose' },
  { id: 'mesh', label: 'Netz', icon: 'mesh', mod: 'mint' },
  { id: 'static', label: 'Statik', icon: 'diagram', mod: 'lemon' },
  { id: 'buckling', label: 'Knicken', icon: 'buckling', mod: 'peach' },
  { id: 'vibration', label: 'Schwingung', icon: 'vibration', mod: 'teal' },
  { id: 'rc', label: 'Stahlbeton', icon: 'concrete', mod: 'lilac' },
  { id: 'steel', label: 'Stahl', icon: 'steel', mod: 'sky' },
  { id: 'timber', label: 'Holz', icon: 'timber', mod: 'peach' },
  { id: 'report', label: 'Bericht', icon: 'report', mod: 'slate' },
];

export function createCommands(app) {
  const st = app.store;
  const sel = () => st.selection;
  const need = (kinds, msg) => {
    const ok = kinds.some((k) => sel()[k].size > 0);
    if (!ok) toast(msg || t('Bitte zuerst passende Objekte auswählen.'), 'info');
    return ok;
  };
  const tool = (id, opts) => () => app.tools.set(id, opts || {});
  const isTool = (id, key, val) => () => app.tools.id === id && (key ? app.tools.opts?.[key] === val : true);
  const toggleView = (k) => () => st.setView({ [k]: !st.view[k] });
  const viewOn = (k) => () => !!st.view[k];
  const showRes = (kind, component) => () => app.showResults(kind, component);
  const isRc = () => st.resultView.kind === 'rc';
  const rcLayer = () => (/^a[xy][bt]$/.test(st.resultView.component) ? st.resultView.component : 'axb');
  // show an RC result; designs first when there is no result yet
  const showRc = async (patch, need = 'rc') => {
    const have = need === 'rcBeam' ? st.results.rcBeams : st.results.rc;
    if (!have) { const ok = await runDesign(app, need); if (!ok) return; }
    st.setResultView({ kind: 'rc', ...patch });
    app.showSide('results');
  };

  const C = {
    // ---- file & general
    new: { label: 'Neu', desc: 'Neues leeres Modell anlegen', icon: 'filePlus', kbd: 'Alt+N', run: () => app.newModel() },
    open: { label: 'Öffnen', desc: 'Modelldatei (.json) laden', icon: 'folder', kbd: 'Ctrl+O', run: () => app.openFile() },
    save: { label: 'Speichern', desc: 'Modell als JSON-Datei herunterladen', icon: 'save', kbd: 'Ctrl+S', run: () => app.saveFile() },
    examples: { label: 'Beispiele', desc: 'Fertige Beispielmodelle öffnen', icon: 'book', run: () => examplesDialog(app) },
    importDxf: { label: 'DXF Import', desc: 'Linien und 3D-Flächen aus einer DXF-Datei importieren', icon: 'import', run: () => app.importDxf() },
    exportDxf: { label: 'DXF Export', desc: 'Geometrie als DXF-Datei exportieren', icon: 'export', run: () => app.exportDxf() },
    undo: { label: 'Rückgängig', desc: 'Letzte Änderung rückgängig machen', icon: 'undo', kbd: 'Ctrl+Z', run: () => app.undo() },
    redo: { label: 'Wiederholen', desc: 'Rückgängig gemachte Änderung wiederherstellen', icon: 'redo', kbd: 'Ctrl+Y', run: () => app.redo() },
    palette: { label: 'Befehlssuche', desc: 'Alle Befehle durchsuchen und ausführen', icon: 'search', kbd: 'Ctrl+K', run: () => app.openPalette() },
    settings: { label: 'Einstellungen', desc: 'Einheiten, Darstellung, Raster', icon: 'settings', run: () => settingsDialog(app) },
    modelInfo: { label: 'Modellinfo', desc: 'Name, Autor, Beschreibung, Norm', icon: 'info', run: () => modelInfoDialog(app) },
    help: { label: 'Hilfe', desc: 'Kurzanleitung und Tastenkürzel', icon: 'help', kbd: 'F1', run: () => shortcutsDialog(app) },
    welcome: { label: 'Startseite', desc: 'Willkommensseite mit Arbeitsablauf und Beispielen', icon: 'rocket', run: () => welcomeDialog(app) },
    theme: { label: 'Hell/Dunkel', desc: 'Farbschema umschalten', icon: 'moon', kbd: 'Shift+D', run: () => app.toggleTheme() },
    lang: { label: 'Sprache', desc: 'Deutsch / English', icon: 'globe', run: () => app.toggleLang() },
    tables: { label: 'Tabellen', desc: 'Tabellenbrowser: Eingabe- und Ergebnistabellen ansehen, bearbeiten, exportieren', icon: 'table', kbd: 'Shift+T', run: () => openTables(app) },
    report: { label: 'Bericht', desc: 'Druckfähigen Bericht mit Tabellen und Bildern erstellen', icon: 'report', kbd: 'Ctrl+P', run: () => openReport(app) },
    screenshot: { label: 'Bild speichern', desc: 'Aktuelle 3D-Ansicht als PNG speichern', icon: 'camera', run: () => app.saveScreenshot() },
    panel: { label: 'Seitenleiste', desc: 'Eigenschaften-Leiste ein-/ausblenden', icon: 'panel', kbd: 'Ctrl+B', run: () => app.togglePanel() },

    // ---- view
    zoomFit: { label: 'Alles zeigen', desc: 'Auf das ganze Modell zoomen', icon: 'zoomFit', kbd: 'Home', run: () => app.vp.zoomExtents() },
    viewIso: { label: 'Isometrie', desc: 'Isometrische Ansicht', icon: 'viewIso', kbd: 'I', run: () => app.vp.setView('iso') },
    viewTop: { label: 'Draufsicht', desc: 'Ansicht von oben (X-Y)', icon: 'viewTop', kbd: 'T', run: () => app.vp.setView('top') },
    viewFront: { label: 'Vorderansicht', desc: 'Ansicht von vorne (X-Z)', icon: 'viewFront', kbd: 'F', run: () => app.vp.setView('front') },
    viewSide: { label: 'Seitenansicht', desc: 'Ansicht von der Seite (Y-Z)', icon: 'viewSide', kbd: 'S', run: () => app.vp.setView('right') },
    persp: { label: 'Perspektive', desc: 'Zwischen Perspektive und Parallelprojektion wechseln', icon: 'perspective', kbd: 'C', run: () => { st.view.persp = !st.view.persp; app.vp.setPerspective(st.view.persp); app.refreshChrome(); }, active: viewOn('persp') },
    renderWire: { label: 'Drahtmodell', desc: 'Nur Linien darstellen', icon: 'wire', run: () => st.setView({ renderMode: 'wire' }), active: () => st.view.renderMode === 'wire' },
    renderSolid: { label: 'Flächen', desc: 'Linien und transparente Flächen', icon: 'solid', run: () => st.setView({ renderMode: 'solid' }), active: () => st.view.renderMode === 'solid' },
    renderFull: { label: 'Gerendert', desc: 'Querschnitte und Dicken körperhaft darstellen', icon: 'render', kbd: 'W', run: () => st.setView({ renderMode: st.view.renderMode === 'render' ? 'solid' : 'render' }), active: () => st.view.renderMode === 'render' },
    labelsNodes: { label: 'Knotennummern', desc: 'Knotennummern anzeigen', icon: 'hash', run: toggleView('labelsNodes'), active: viewOn('labelsNodes') },
    labelsLines: { label: 'Elementnummern', desc: 'Linien- und Flächennummern anzeigen', icon: 'tag', run: toggleView('labelsLines'), active: viewOn('labelsLines') },
    labelsValues: { label: 'Werte', desc: 'Last- und Ergebniswerte beschriften', icon: 'dimension', run: toggleView('labelsValues'), active: viewOn('labelsValues') },
    showLoads: { label: 'Lasten', desc: 'Lasten des aktiven Lastfalls anzeigen', icon: 'loadNode', run: toggleView('showLoads'), active: viewOn('showLoads') },
    showSupports: { label: 'Lager', desc: 'Lager anzeigen', icon: 'supportPin', run: toggleView('showSupports'), active: viewOn('showSupports') },
    showAxes: { label: 'Lokale Achsen', desc: 'Lokale Achsen der Stäbe und Flächen anzeigen (x rot, y grün, z blau)', icon: 'axes', run: toggleView('showAxes'), active: viewOn('showAxes') },
    showMesh: { label: 'FE-Netz', desc: 'Finite-Elemente-Netz anzeigen', icon: 'mesh', run: () => { if (!st.results.mesh) meshGenerate(app, { quiet: true }); st.setView({ showMesh: !st.view.showMesh }); }, active: viewOn('showMesh') },
    showGrid: { label: 'Raster', desc: 'Raster der Arbeitsebene anzeigen', icon: 'grid', run: toggleView('showGrid'), active: viewOn('showGrid') },
    showNodes: { label: 'Knoten', desc: 'Knotenpunkte anzeigen', icon: 'node', run: toggleView('showNodes'), active: viewOn('showNodes') },
    hideSel: { label: 'Ausblenden', desc: 'Auswahl ausblenden', icon: 'eyeOff', kbd: 'H', run: () => app.hideSelection() },
    isolateSel: { label: 'Isolieren', desc: 'Nur die Auswahl anzeigen', icon: 'isolate', kbd: 'Shift+H', run: () => app.isolateSelection() },
    showAll: { label: 'Alle zeigen', desc: 'Alle ausgeblendeten Elemente wieder anzeigen', icon: 'eye', kbd: 'Alt+H', run: () => app.showAll() },

    // ---- selection
    selectAll: { label: 'Alles auswählen', desc: 'Alle sichtbaren Objekte auswählen (inkl. Lager und Lasten des aktiven Lastfalls, je nach Auswahlfilter)', icon: 'boxsel', kbd: 'Ctrl+A', run: () => app.selectAll() },
    invertSel: { label: 'Auswahl umkehren', desc: 'Auswahl invertieren', icon: 'filter', kbd: 'Ctrl+I', run: () => app.invertSelection() },
    delete: { label: 'Löschen', desc: 'Auswahl löschen – bei gemischter Auswahl lässt sich wählen, welche Objektarten (Knoten, Linien, Stäbe, Flächen, Lager, Lasten) gelöscht werden', icon: 'trash', kbd: 'Del', run: () => deleteSelection(app) },

    // ---- geometry
    toolSelect: { label: 'Auswahl', desc: 'Objekte auswählen (Klick / Rechteck)', icon: 'select', kbd: 'Q', run: tool('select'), active: isTool('select') },
    toolMove: { label: 'Verschieben', desc: 'Auswahl interaktiv verschieben: Basispunkt, dann Zielpunkt (X/Y/Z Achse, Projektion auf Fangpunkte, Koordinaten tippen)', icon: 'move', kbd: 'V', run: tool('move'), active: isTool('move') },
    toolCopy: { label: 'Kopieren', desc: 'Auswahl interaktiv kopieren – mehrfach klicken oder dx dy dz *n für n Kopien', icon: 'copy', kbd: 'K', run: tool('copy'), active: isTool('copy') },
    toolRotate: { label: 'Drehen', desc: 'Auswahl interaktiv drehen: Drehpunkt, dann Winkel tippen oder Richtungen klicken (Alt+X/Y/Z Drehachse)', icon: 'rotate', kbd: 'D', run: tool('rotate'), active: isTool('rotate') },
    toolOrbit: { label: 'Drehen', desc: 'Ansicht mit der linken Maustaste drehen', icon: 'orbit', kbd: 'O', run: tool('orbit'), active: isTool('orbit') },
    toolNode: { label: 'Knoten', desc: 'Knoten setzen', icon: 'node', kbd: 'N', run: tool('node'), active: isTool('node') },
    toolLine: { label: 'Linie', desc: 'Geometrielinien zeichnen (Kette)', icon: 'line', kbd: 'L', run: tool('line'), active: () => app.tools.id === 'line' && !app.tools.opts.element },
    toolRect: { label: 'Rechteck', desc: 'Rechteck aus 4 Linien zeichnen', icon: 'rect', kbd: 'R', run: tool('rect'), active: () => app.tools.id === 'rect' && !app.tools.opts.domain },
    toolPolygon: { label: 'Polygon', desc: 'Geschlossenes Polygon zeichnen', icon: 'polygon', kbd: 'P', run: tool('polygon'), active: () => app.tools.id === 'polygon' && !app.tools.opts.domain },
    toolArc: { label: 'Bogen', desc: 'Kreisbogen durch 3 Punkte (in Segmente unterteilt)', icon: 'arc', kbd: 'A', run: tool('arc', { segments: 8 }), active: isTool('arc') },
    toolMeasure: { label: 'Messen', desc: 'Abstand zwischen zwei Punkten messen', icon: 'measure', kbd: 'M', run: tool('measure'), active: isTool('measure') },
    move: { label: 'Mehrfach kopieren', desc: 'Verschieben/Kopieren per Dialog: Vektor, Anzahl Kopien, Verbindungsstäbe (z.B. Stützen zwischen Geschossen)', icon: 'layers', kbd: 'Shift+M', run: () => need(['nodes', 'lines', 'domains']) && transformDialog(app, 'translate') },
    rotate: { label: 'Drehen (Dialog)', desc: 'Auswahl um eine Achse drehen oder rotierend kopieren – numerisch', icon: 'rotate', run: () => need(['nodes', 'lines', 'domains']) && transformDialog(app, 'rotate') },
    mirror: { label: 'Spiegeln', desc: 'Auswahl an einer Ebene spiegeln', icon: 'mirror', run: () => need(['nodes', 'lines', 'domains']) && transformDialog(app, 'mirror') },
    scale: { label: 'Skalieren', desc: 'Auswahl skalieren', icon: 'scale', run: () => need(['nodes', 'lines', 'domains']) && transformDialog(app, 'scale') },
    split: { label: 'Teilen', desc: 'Ausgewählte Linien in gleiche Teile teilen', icon: 'split', run: () => need(['lines'], t('Bitte Linien auswählen.')) && splitDialog(app) },
    intersect: { label: 'Schnittpunkte', desc: 'Linien an Schnittpunkten und auf ihnen liegenden Knoten teilen', icon: 'intersect', run: () => {
      const ids = [...st.selection.lines];
      const n = st.commit(t('Schnittpunkte'), (m) => intersectLines(m, ids));
      toast(n ? t('{n} Schnittpunkte erzeugt.', { n }) : t('Keine Schnittpunkte gefunden.'), n ? 'ok' : 'info');
    } },
    merge: { label: 'Knoten vereinen', desc: 'Doppelte (zusammenfallende) Knoten zusammenführen', icon: 'merge', run: () => {
      const n = st.commit(t('Knoten vereinen'), (m) => mergeNodes(m, 1e-4));
      toast(n ? t('{n} Knoten vereint.', { n }) : t('Keine doppelten Knoten gefunden.'), n ? 'ok' : 'info');
    } },
    generator: { label: 'Generatoren', desc: 'Parametrische Tragwerke erzeugen: Rahmen, Fachwerk, Halle, Decke, Gebäude, Kuppel', icon: 'sparkles', kbd: 'G', run: () => generatorDialog(app) },
    genFrame: { label: '3D-Rahmen', desc: 'Räumlicher Stockwerkrahmen', icon: 'frame3d', run: () => generatorDialog(app, 'frame') },
    genTruss: { label: 'Fachwerk', desc: 'Fachwerkträger (Pratt, Warren, Howe)', icon: 'truss', run: () => generatorDialog(app, 'truss') },
    genHall: { label: 'Halle', desc: 'Stahlhalle mit Rahmen, Pfetten und Verbänden', icon: 'hall', run: () => generatorDialog(app, 'hall') },
    genSlab: { label: 'Decke', desc: 'Platte mit Stützen oder Wänden', icon: 'slab', run: () => generatorDialog(app, 'slab') },
    genBuilding: { label: 'Gebäude', desc: 'Mehrgeschossiger Massivbau mit Decken, Wänden und Stützen', icon: 'building', run: () => generatorDialog(app, 'building') },
    genDome: { label: 'Kuppel / Schale', desc: 'Zylinderschale, Kuppel oder Silo', icon: 'dome', run: () => generatorDialog(app, 'shell') },

    // ---- elements
    materials: { label: 'Materialien', desc: 'Materialbibliothek: Stahl, Beton, Holz, Aluminium', icon: 'material', run: () => openMaterials(app) },
    sections: { label: 'Querschnitte', desc: 'Querschnittsbibliothek: IPE, HEA, HEB, RHS, CHS, Rechteck …', icon: 'section', run: () => openSections(app) },
    drawBeam: { label: 'Balken', desc: 'Balken (Biegestab) zeichnen', icon: 'beam', kbd: 'B', run: tool('line', { element: 'beam' }), active: isTool('line', 'element', 'beam') },
    drawTruss: { label: 'Fachwerkstab', desc: 'Fachwerkstab (nur Normalkraft) zeichnen', icon: 'truss', run: tool('line', { element: 'truss' }), active: isTool('line', 'element', 'truss') },
    drawRib: { label: 'Rippe', desc: 'Rippe (Unterzug) zeichnen', icon: 'rib', run: tool('line', { element: 'rib' }), active: isTool('line', 'element', 'rib') },
    drawSpring: { label: 'Feder', desc: 'Federelement zwischen zwei Knoten', icon: 'spring', run: tool('line', { element: 'spring' }), active: isTool('line', 'element', 'spring') },
    drawRigid: { label: 'Starrstab', desc: 'Starres Element (Kopplung)', icon: 'rigid', run: tool('line', { element: 'rigid' }), active: isTool('line', 'element', 'rigid') },
    assignLine: { label: 'Zuweisen', desc: 'Stabelement (Typ, Material, Querschnitt) den gewählten Linien zuweisen', icon: 'check', run: () => need(['lines'], t('Bitte Linien auswählen.')) && assignLineElement(app) },
    releases: { label: 'Gelenke', desc: 'Stabendgelenke (Freigaben) definieren', icon: 'hinge', run: () => need(['lines'], t('Bitte Stäbe auswählen.')) && editReleases(app) },
    drawPlate: { label: 'Platte', desc: 'Rechteckige Platte (Biegung) zeichnen', icon: 'plate', run: tool('rect', { domain: 'plate' }), active: isTool('rect', 'domain', 'plate') },
    drawShell: { label: 'Schale', desc: 'Rechteckige Schale (Biegung + Membran) zeichnen', icon: 'shell', run: tool('rect', { domain: 'shell' }), active: isTool('rect', 'domain', 'shell') },
    drawMembrane: { label: 'Scheibe', desc: 'Rechteckige Scheibe (Membran, z.B. Wand) zeichnen', icon: 'membrane', run: tool('rect', { domain: 'membrane' }), active: isTool('rect', 'domain', 'membrane') },
    drawDomainPoly: { label: 'Fläche Polygon', desc: 'Fläche mit beliebigem Umriss zeichnen', icon: 'domain', run: tool('polygon', { domain: 'shell' }), active: () => app.tools.id === 'polygon' && !!app.tools.opts.domain },
    domainFromSel: { label: 'Aus Auswahl', desc: 'Fläche aus gewählten, geschlossenen Linien erzeugen', icon: 'domain', run: () => need(['lines'], t('Bitte geschlossene Linienkette auswählen.')) && domainFromSelection(app) },
    addHole: { label: 'Öffnung', desc: 'Gewählte geschlossene Linien als Öffnung in die gewählte Fläche einfügen', icon: 'hole', run: () => need(['domains'], t('Bitte Fläche und Öffnungslinien auswählen.')) && addHoleFromSelection(app) },
    supNode: { label: 'Knotenlager', desc: 'Lager/Federn an gewählten Knoten definieren', icon: 'supportPin', run: () => need(['nodes'], t('Bitte Knoten auswählen.')) && supportDialog(app, 'node') },
    supFixed: { label: 'Eingespannt', desc: 'Gewählte Knoten voll einspannen', icon: 'supportFixed', run: () => need(['nodes'], t('Bitte Knoten auswählen.')) && quickSupport(app, 'fixed') },
    supPinned: { label: 'Gelenkig', desc: 'Gewählte Knoten gelenkig lagern (ux, uy, uz fest)', icon: 'supportPin', run: () => need(['nodes'], t('Bitte Knoten auswählen.')) && quickSupport(app, 'pinned') },
    supLine: { label: 'Linienlager', desc: 'Linienlager / elastische Bettung entlang gewählter Linien', icon: 'supportLine', run: () => need(['lines'], t('Bitte Linien auswählen.')) && supportDialog(app, 'line') },
    supSurface: { label: 'Flächenbettung', desc: 'Elastische Bettung (Winkler) unter gewählten Flächen', icon: 'supportSurface', run: () => need(['domains'], t('Bitte Flächen auswählen.')) && supportDialog(app, 'surface') },
    designParams: { label: 'Knicklängen', desc: 'Knicklängenbeiwerte und Kippparameter für Bemessung', icon: 'buckling', run: () => need(['lines'], t('Bitte Stäbe auswählen.')) && designParams(app) },
    rcParams: { label: 'Bewehrungsparameter', desc: 'Betondeckung, Stabdurchmesser, Lagen und Stahlsorte für gewählte Flächen bzw. Betonbalken (Plattenbalken: mitwirkende Breite)', icon: 'concrete', run: () => rcParamsDialog(app) },

    // ---- loads
    loadCases: { label: 'Lastfälle', desc: 'Lastfälle und Lastgruppen verwalten', icon: 'loadCase', run: () => openLoadCases(app) },
    combinations: { label: 'Kombinationen', desc: 'Lastfallkombinationen definieren', icon: 'combination', run: () => openCombinations(app) },
    autoCombos: { label: 'Auto-Kombi', desc: 'Kombinationen nach Norm (EN 1990 / SIA 260) automatisch erzeugen', icon: 'sparkles', run: () => autoCombinations(app) },
    loadNode: { label: 'Knotenlast', desc: 'Kräfte und Momente an gewählten Knoten', icon: 'loadNode', run: () => need(['nodes'], t('Bitte Knoten auswählen.')) && nodeLoadDialog(app) },
    loadLine: { label: 'Linienlast', desc: 'Gleich- oder Trapezlast auf gewählte Linien/Stäbe', icon: 'loadTrap', run: () => need(['lines'], t('Bitte Linien auswählen.')) && lineLoadDialog(app, false) },
    loadPoint: { label: 'Einzellast', desc: 'Einzelkraft oder -moment auf gewählten Stäben', icon: 'loadPoint', run: () => need(['lines'], t('Bitte Stäbe auswählen.')) && lineLoadDialog(app, true) },
    loadSurface: { label: 'Flächenlast', desc: 'Gleichmässige Flächenlast auf gewählte Flächen', icon: 'loadSurface', run: () => need(['domains'], t('Bitte Flächen auswählen.')) && surfaceLoadDialog(app) },
    selfWeight: { label: 'Eigengewicht', desc: 'Eigengewicht im aktiven Lastfall ein-/ausschalten', icon: 'selfWeight', run: () => toggleSelfWeight(app), active: () => !!st.idx.loadCases.get(st.activeLC)?.selfWeight },
    loadTemp: { label: 'Temperatur', desc: 'Temperaturlast (gleichmässig und Gradient)', icon: 'temperature', run: () => need(['lines', 'domains'], t('Bitte Stäbe oder Flächen auswählen.')) && temperatureDialog(app) },
    loadSettle: { label: 'Stützensenkung', desc: 'Vorgegebene Auflagerverschiebung', icon: 'settlement', run: () => need(['nodes'], t('Bitte gelagerte Knoten auswählen.')) && settlementDialog(app) },
    snowWind: { label: 'Schnee & Wind', desc: 'Schnee- und Windlast auf gewählte Dachflächen (vereinfacht nach EN 1991 / SIA 261)', icon: 'snow', run: () => need(['domains'], t('Bitte Dachflächen auswählen.')) && snowWindDialog(app) },

    // ---- mesh
    meshGen: { label: 'Netz erzeugen', desc: 'Finite-Elemente-Netz generieren und anzeigen', icon: 'mesh', run: () => meshGenerate(app) },
    meshSettings: { label: 'Netzparameter', desc: 'Elementgrösse und Stabunterteilung', icon: 'meshRefine', run: () => meshSettings(app) },
    checkModel: { label: 'Modell prüfen', desc: 'Modell auf Fehler und Warnungen prüfen', icon: 'shieldCheck', run: () => checkModel(app) },

    // ---- static
    runLinear: { label: 'Linear rechnen', desc: 'Lineare Statik für alle Lastfälle und Kombinationen', icon: 'run', kbd: 'F5', run: () => runStatic(app, false) },
    runNonlinear: { label: 'Nichtlinear', desc: 'Theorie II. Ordnung (P-Δ), Zug-/Druckstäbe, abhebende Lager', icon: 'nonlinear', kbd: 'Shift+F5', run: () => runStatic(app, true) },
    resDeformed: { label: 'Verformung', desc: 'Verformte Figur', icon: 'deformed', run: showRes('static', 'deformed'), active: () => app.isResult('static', 'deformed') },
    resDisp: { label: 'Verschiebung', desc: 'Verschiebungen als Farbverlauf (eZ)', icon: 'contour', run: showRes('static', 'eZ'), active: () => app.isResult('static', 'eZ') },
    resBeam: { label: 'Stabkräfte', desc: 'Schnittgrössenverläufe der Stäbe (My)', icon: 'diagram', run: showRes('static', 'My'), active: () => app.isResult('static', 'My') },
    resShell: { label: 'Flächenkräfte', desc: 'Momente/Kräfte in Flächen (mx)', icon: 'contour', run: showRes('static', 'mx'), active: () => app.isResult('static', 'mx') },
    resStress: { label: 'Spannungen', desc: 'Vergleichsspannungen in Flächen', icon: 'stress', run: showRes('static', 'sBot'), active: () => app.isResult('static', 'sBot') },
    resReactions: { label: 'Auflager', desc: 'Auflagerkräfte', icon: 'reactions', run: showRes('static', 'R'), active: () => app.isResult('static', 'R') },
    resOff: { label: 'Modell', desc: 'Zurück zur Modellansicht', icon: 'viewIso', run: () => app.hideResults(), active: () => !st.resultView.kind },

    // ---- vibration / buckling
    runModal: { label: 'Eigenformen', desc: 'Eigenfrequenzen und Eigenformen berechnen', icon: 'vibration', run: () => runModalDialog(app) },
    runSpectrum: { label: 'Antwortspektrum', desc: 'Erdbebenberechnung nach EN 1998 / SIA 261 (modales Antwortspektrenverfahren)', icon: 'seismic', run: () => runSpectrumDialog(app) },
    resModes: { label: 'Formen zeigen', desc: 'Eigenformen anzeigen und animieren', icon: 'animate', run: showRes('modal'), active: () => st.resultView.kind === 'modal' },
    runBuckling: { label: 'Knickanalyse', desc: 'Lineare Stabilitätsanalyse (kritische Lastfaktoren)', icon: 'buckling', run: () => runBucklingDialog(app) },
    resBuckling: { label: 'Knickformen', desc: 'Knickformen anzeigen', icon: 'animate', run: showRes('buckling'), active: () => st.resultView.kind === 'buckling' },

    // ---- design: reinforced concrete
    designRC: { label: 'Flächen bemessen', desc: 'Erforderliche Bewehrung axb, ayb, axt, ayt in Platten und Schalen (Wood-Armer, EN 1992-1-1 / SIA 262), Schubnachweis und Durchstanzen', icon: 'run', run: () => runDesign(app, 'rc') },
    designRCBeam: { label: 'Balken bemessen', desc: 'Längs- und Bügelbewehrung von Betonbalken und Rippen (Plattenbalken mit mitwirkender Plattenbreite)', icon: 'beam', run: () => runDesign(app, 'rcBeam') },
    rcProvided: { label: 'Vorhandene Bewehrung', desc: 'Gewählte Flächenbewehrung (Ø / Abstand je Lage) vorgeben – zeigt dann fehlende Zulagen', icon: 'grid', run: () => rcProvidedDialog(app) },
    resRcReq: { label: 'Erforderlich', desc: 'Erforderliche Bewehrung der gewählten Lage', icon: 'contour', run: () => showRc({ rcMode: 'req', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode !== 'prov' && st.resultView.rcMode !== 'miss' && /^a[xy][bt]$/.test(st.resultView.component) },
    resRcProv: { label: 'Vorhanden', desc: 'Vorgegebene (gewählte) Bewehrung der Lage', icon: 'grid', run: () => showRc({ rcMode: 'prov', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode === 'prov' && /^a[xy][bt]$/.test(st.resultView.component) },
    resRcMiss: { label: 'Fehlend', desc: 'Fehlende Bewehrung = erforderlich − vorhanden (Zulagen)', icon: 'alert', run: () => showRc({ rcMode: 'miss', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode === 'miss' && /^a[xy][bt]$/.test(st.resultView.component) },
    resRcShear: { label: 'Schub', desc: 'Querkraftnachweis der Platte ohne Schubbewehrung: vEd / vRd,c', icon: 'stress', run: () => showRc({ component: 'vRatio' }), active: () => isRc() && st.resultView.component === 'vRatio' },
    resPunch: { label: 'Durchstanzen', desc: 'Durchstanznachweis an Stützen und Punktlagern (EN 1992-1-1 6.4 / SIA 262 4.3.6)', icon: 'target', run: () => showRc({ component: 'punch' }), active: () => isRc() && st.resultView.component === 'punch' },
    resRcBeam: { label: 'Balkenbewehrung', desc: 'Erforderliche Längsbewehrung der Betonbalken (unten/oben) und Bügel', icon: 'beam', run: () => showRc({ component: 'AsBot' }, 'rcBeam'), active: () => isRc() && ['AsBot', 'AsTop', 'Asw'].includes(st.resultView.component) },
    rcProtocol: { label: 'Bemessungsprotokoll', desc: 'Was wurde wie bemessen? Parameter, massgebende Kombinationen, Maxima, Bewehrungsvorschlag, Nachweise', icon: 'fileText', run: () => rcProtocolDialog(app) },
    rcDetail: { label: 'Bemessungsdetails', desc: 'Ausführliche Bemessung des gewählten Balkens: Verläufe, Querschnitt, Bewehrungsvorschlag', icon: 'info', run: () => { const id = [...st.selection.lines][0]; if (!id) return toast(t('Bitte einen Betonbalken auswählen.'), 'info'); rcBeamDetail(app, id); } },
    // ---- design: steel / timber
    designSteel: { label: 'Stahlbemessung', desc: 'Querschnitts- und Stabilitätsnachweise (EN 1993-1-1 / SIA 263)', icon: 'run', run: () => runDesign(app, 'steel') },
    designTimber: { label: 'Holzbemessung', desc: 'Querschnitts- und Stabilitätsnachweise (EN 1995-1-1 / SIA 265)', icon: 'run', run: () => runDesign(app, 'timber') },
    resUtil: { label: 'Ausnutzung', desc: 'Ausnutzung η je Stab (massgebender Nachweis) – Klick auf einen Stab zeigt die Details', icon: 'gauge', run: () => app.showResults(st.tab === 'timber' ? 'timber' : 'steel', 'eta'), active: () => ['steel', 'timber'].includes(st.resultView.kind) },
    memberDetail: { label: 'Bemessungsdetails', desc: 'Alle Nachweise des gewählten Stabes mit Schnittgrössenverläufen', icon: 'info', run: () => { const id = [...st.selection.lines][0]; if (!id) return toast(t('Bitte einen Stab auswählen.'), 'info'); memberDetail(app, st.tab === 'timber' ? 'timber' : 'steel', id); } },
    codeEC: { label: 'Eurocode', desc: 'Normenfamilie Eurocode (EN 1990 – EN 1998)', icon: 'eu', run: () => app.setCode('EC'), active: () => st.model.settings.code !== 'SIA' },
    codeSIA: { label: 'SIA', desc: 'Schweizer Normen SIA 260 – 265', icon: 'swiss', run: () => app.setCode('SIA'), active: () => st.model.settings.code === 'SIA' },
  };
  // on/off switches (as opposed to actions and tool/view modes) get a distinct toggle look
  const TOGGLES = ['persp', 'renderFull', 'labelsNodes', 'labelsLines', 'labelsValues', 'showLoads', 'showSupports', 'showAxes', 'showMesh', 'showGrid', 'showNodes', 'selfWeight'];
  for (const id of TOGGLES) C[id].toggle = true;
  for (const [id, c] of Object.entries(C)) {
    c.id = id;
    c.label = t(c.label);
    c.desc = t(c.desc);
    c.kind = c.toggle ? 'toggle' : c.active ? 'mode' : 'action';
  }
  return C;
}

// Ribbon layout per module. Strings are commands; objects are custom controls rendered by the app.
export const RIBBON = {
  geometry: [
    { title: 'Zeichnen', items: ['toolSelect', 'toolNode', 'toolLine', 'toolRect', 'toolPolygon', 'toolArc'] },
    { title: 'Bearbeiten', items: ['toolMove', 'toolCopy', 'toolRotate', 'move', 'mirror', 'scale', 'split', 'intersect', 'merge', 'delete'] },
    { title: 'Generatoren', items: ['genFrame', 'genTruss', 'genHall', 'genSlab', 'genBuilding', 'genDome'] },
    { title: 'Arbeitsebene', items: [{ custom: 'workplane' }] },
    { title: 'Werkzeuge', items: ['toolMeasure', 'importDxf'] },
  ],
  elements: [
    { title: 'Bibliothek', items: ['materials', 'sections'] },
    { title: 'Stabelemente', items: ['drawBeam', 'drawTruss', 'drawRib', 'drawSpring', 'drawRigid', 'assignLine', 'releases'] },
    { title: 'Flächenelemente', items: ['drawPlate', 'drawShell', 'drawMembrane', 'drawDomainPoly', 'domainFromSel', 'addHole'] },
    { title: 'Lager', items: ['supFixed', 'supPinned', 'supNode', 'supLine', 'supSurface'] },
    { title: 'Anzeige', items: ['showAxes', 'renderFull'] },
  ],
  loads: [
    { title: 'Lastfall', items: [{ custom: 'lcSelect' }, 'loadCases', 'combinations', 'autoCombos'] },
    { title: 'Lasten', items: ['selfWeight', 'loadNode', 'loadLine', 'loadPoint', 'loadSurface', 'loadTemp', 'loadSettle', 'snowWind'] },
    { title: 'Anzeige', items: ['showLoads', 'labelsValues', 'tables'] },
  ],
  mesh: [
    { title: 'Finite Elemente', items: ['meshGen', 'meshSettings', 'showMesh'] },
    { title: 'Prüfen', items: ['checkModel', 'merge', 'intersect'] },
  ],
  static: [
    { title: 'Berechnung', items: ['runLinear', 'runNonlinear'] },
    { title: 'Ergebnisse', items: ['resOff', 'resDeformed', 'resDisp', 'resBeam', 'resShell', 'resStress', 'resReactions'] },
    { title: 'Ausgabe', items: ['tables', 'report'] },
  ],
  vibration: [
    { title: 'Dynamik', items: ['runModal', 'resModes', 'runSpectrum'] },
    { title: 'Ausgabe', items: ['tables', 'report'] },
  ],
  buckling: [
    { title: 'Stabilität', items: ['runBuckling', 'resBuckling', 'runNonlinear'] },
    { title: 'Ausgabe', items: ['tables', 'report'] },
  ],
  rc: [
    { title: 'Norm', items: ['codeEC', 'codeSIA'] },
    { title: 'Parameter', items: ['rcParams', 'materials'] },
    { title: 'Bemessung', items: ['designRC', 'designRCBeam', 'rcProvided'] },
    { title: 'Ergebnisse', items: ['resRcReq', 'resRcProv', 'resRcMiss', 'resRcShear', 'resPunch', 'resRcBeam'] },
    { title: 'Ausgabe', items: ['rcProtocol', 'rcDetail', 'tables', 'report'] },
  ],
  steel: [
    { title: 'Norm', items: ['codeEC', 'codeSIA'] },
    { title: 'Parameter', items: ['designParams', 'sections', 'materials'] },
    { title: 'Bemessung', items: ['designSteel', 'resUtil'] },
    { title: 'Ausgabe', items: ['memberDetail', 'tables', 'report'] },
  ],
  timber: [
    { title: 'Norm', items: ['codeEC', 'codeSIA'] },
    { title: 'Parameter', items: ['designParams', 'sections', 'materials'] },
    { title: 'Bemessung', items: ['designTimber', 'resUtil'] },
    { title: 'Ausgabe', items: ['memberDetail', 'tables', 'report'] },
  ],
  report: [
    { title: 'Dokumentation', items: ['report', 'tables', 'screenshot'] },
    { title: 'Datei', items: ['save', 'open', 'exportDxf', 'importDxf', 'examples'] },
    { title: 'Modell', items: ['modelInfo', 'settings'] },
  ],
};
