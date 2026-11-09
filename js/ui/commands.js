// Command registry (used by ribbon, menus, command palette and keyboard shortcuts) and ribbon layout.
import { t } from '../i18n.js';
import { toast } from './dom.js';
import { intersectLines, mergeNodes } from '../core/model.js';
import { deleteSelection } from './dialogs/delete.js';
import { newPartFromSelection, detectStoreysCmd } from './parts-ui.js';
import { openMaterials, openSections, openLoadCases, openCombinations, autoCombinations } from './dialogs/manage.js';
import { assignLineElement, editReleases, supportDialog, quickSupport, domainFromSelection, addHoleFromSelection, designParams } from './dialogs/assign.js';
import { nodeLoadDialog, lineLoadDialog, surfaceLoadDialog, temperatureDialog, settlementDialog, toggleSelfWeight, snowWindDialog } from './dialogs/loads.js';
import { transformDialog, splitDialog } from './dialogs/transform.js';
import { generatorDialog } from './dialogs/generators.js';
import { runStatic, runModalDialog, runBucklingDialog, runSpectrumDialog, runDesign, meshGenerate, meshSettings, checkModel } from './dialogs/analysis.js';
import { rcParamsDialog, rcProvidedDialog, rcProtocolDialog, rcBeamDetail } from './dialogs/rc.js';
import { memberDetail } from './dialogs/member.js';
import { designComp, isRcLayer } from './results-data.js';
import { withSelection } from './selection-tools.js';
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
  { id: 'vibration', label: 'Eigenschwingung', icon: 'vibration', mod: 'teal' },
  { id: 'rc', label: 'Bewehrung', icon: 'concrete', mod: 'lilac' },
  { id: 'steel', label: 'Stahlbemessung', icon: 'steel', mod: 'sky' },
  { id: 'timber', label: 'Holzbemessung', icon: 'timber', mod: 'peach' },
];

export function createCommands(app) {
  const st = app.store;
  const sel = () => st.selection;
  const need = (kinds, msg) => {
    const ok = kinds.some((k) => sel()[k].size > 0);
    if (!ok) toast(msg || t('Bitte zuerst passende Objekte auswählen.'), 'info');
    return ok;
  };
  // command on selected objects: runs at once with a matching selection, otherwise asks for one first
  const onSel = (kinds, title, fn) => () => withSelection(app, kinds, t(title), fn);
  const GEO = ['nodes', 'lines', 'domains'];
  const tool = (id, opts) => () => app.tools.set(id, opts || {});
  const isTool = (id, key, val) => () => app.tools.id === id && (key ? app.tools.opts?.[key] === val : true);
  const toggleView = (k) => () => st.setView({ [k]: !st.view[k] });
  const viewOn = (k) => () => !!st.view[k];
  const showRes = (kind, component) => () => app.showResults(kind, component);
  const isRc = () => st.resultView.kind === 'rc';
  const rcLayer = () => (isRcLayer(st.resultView.component) ? st.resultView.component : 'axb');
  const rcSource = () => designComp(st.resultView.component)?.source;
  // show an RC result; runs the design that produces the component when its results are missing
  const showRc = async (patch) => {
    const comp = designComp(patch.component ?? st.resultView.component) || designComp('axb');
    if (!st.results.design[comp.source]) { const ok = await runDesign(app, comp.run); if (!ok) return; }
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
    undo: { label: 'Rückgängig', desc: 'Letzte Änderung rückgängig machen', icon: 'undo', kbd: 'Alt+Backspace', run: () => app.undo() },
    redo: { label: 'Wiederholen', desc: 'Rückgängig gemachte Änderung wiederherstellen', icon: 'redo', kbd: 'Shift+Alt+Backspace', run: () => app.redo() },
    palette: { label: 'Befehlssuche', desc: 'Alle Befehle durchsuchen und ausführen', icon: 'search', kbd: 'Ctrl+K', run: () => app.openPalette() },
    settings: { label: 'Einstellungen', desc: 'Einheiten, Darstellung, Raster', icon: 'settings', run: () => settingsDialog(app) },
    modelInfo: { label: 'Modellinfo', desc: 'Name, Autor, Beschreibung, Norm', icon: 'info', run: () => modelInfoDialog(app) },
    help: { label: 'Hilfe', desc: 'Kurzanleitung und Tastenkürzel', icon: 'help', kbd: 'F1', run: () => shortcutsDialog(app) },
    welcome: { label: 'Startseite', desc: 'Willkommensseite mit Arbeitsablauf und Beispielen', icon: 'rocket', run: () => welcomeDialog(app) },
    theme: { label: 'Hell/Dunkel', desc: 'Farbschema umschalten', icon: 'moon', run: () => app.toggleTheme() },
    lang: { label: 'Sprache', desc: 'Deutsch / English', icon: 'globe', run: () => app.toggleLang() },
    tables: { label: 'Tabellen', desc: 'Tabellenbrowser: Eingabe- und Ergebnistabellen ansehen, bearbeiten, exportieren', icon: 'table', kbd: 'F12', run: () => openTables(app) },
    report: { label: 'Bericht', desc: 'Druckfähigen Bericht mit Tabellen und Bildern erstellen', icon: 'report', kbd: 'F10', run: () => openReport(app) },
    screenshot: { label: 'Bild speichern', desc: 'Aktuelle 3D-Ansicht als PNG speichern', icon: 'camera', run: () => app.saveScreenshot() },
    panel: { label: 'Seitenleiste', desc: 'Eigenschaften-Leiste ein-/ausblenden', icon: 'panel', kbd: 'Ctrl+B', run: () => app.togglePanel() },

    // ---- view
    zoomIn: { label: 'Vergrössern', desc: 'Um den Cursor hineinzoomen (Taste +)', icon: 'zoomIn', run: () => app.vp.zoomStep(1) },
    zoomOut: { label: 'Verkleinern', desc: 'Um den Cursor herauszoomen (Taste −)', icon: 'zoomOut', run: () => app.vp.zoomStep(-1) },
    zoomFit: { label: 'Alles zeigen', desc: 'Auf das ganze Modell zoomen', icon: 'zoomFit', kbd: 'Ctrl+W', run: () => app.vp.zoomExtents() },
    viewIso: { label: 'Isometrie', desc: 'Isometrische Ansicht', icon: 'viewIso', kbd: 'Ctrl+4', run: () => app.vp.setView('iso') },
    viewTop: { label: 'Draufsicht', desc: 'Ansicht von oben (X-Y)', icon: 'viewTop', kbd: 'Ctrl+2', run: () => app.vp.setView('top') },
    viewFront: { label: 'Vorderansicht', desc: 'Ansicht von vorne (X-Z)', icon: 'viewFront', kbd: 'Ctrl+1', run: () => app.vp.setView('front') },
    viewSide: { label: 'Seitenansicht', desc: 'Ansicht von der Seite (Y-Z)', icon: 'viewSide', kbd: 'Ctrl+3', run: () => app.vp.setView('right') },
    persp: { label: 'Perspektive', desc: 'Zwischen Perspektive und Parallelprojektion wechseln', icon: 'perspective', run: () => { st.view.persp = !st.view.persp; app.vp.setPerspective(st.view.persp); app.refreshChrome(); }, active: viewOn('persp') },
    renderWire: { label: 'Drahtmodell', desc: 'Nur Linien darstellen', icon: 'wire', kbd: 'Alt+F5', run: () => st.setView({ renderMode: 'wire' }), active: () => st.view.renderMode === 'wire' },
    renderSolid: { label: 'Flächen', desc: 'Linien und transparente Flächen', icon: 'solid', kbd: 'Alt+F6', run: () => st.setView({ renderMode: 'solid' }), active: () => st.view.renderMode === 'solid' },
    renderFull: { label: 'Gerendert', desc: 'Querschnitte und Dicken körperhaft darstellen', icon: 'render', kbd: 'Alt+F7', run: () => st.setView({ renderMode: st.view.renderMode === 'render' ? 'solid' : 'render' }), active: () => st.view.renderMode === 'render' },
    labelsNodes: { label: 'Knotennummern', desc: 'Knotennummern anzeigen', icon: 'hash', run: toggleView('labelsNodes'), active: viewOn('labelsNodes') },
    labelsLines: { label: 'Elementnummern', desc: 'Linien- und Flächennummern anzeigen', icon: 'tag', run: toggleView('labelsLines'), active: viewOn('labelsLines') },
    labelsValues: { label: 'Werte', desc: 'Last- und Ergebniswerte beschriften', icon: 'dimension', run: toggleView('labelsValues'), active: viewOn('labelsValues') },
    showLoads: { label: 'Lasten', desc: 'Lasten des aktiven Lastfalls anzeigen', icon: 'loadNode', kbd: 'Ctrl+L', run: toggleView('showLoads'), active: viewOn('showLoads') },
    showSupports: { label: 'Lager', desc: 'Lager anzeigen', icon: 'supportPin', run: toggleView('showSupports'), active: viewOn('showSupports') },
    showAxes: { label: 'Lokale Achsen', desc: 'Lokale Achsen der Stäbe und Flächen anzeigen (x rot, y grün, z blau)', icon: 'axes', run: toggleView('showAxes'), active: viewOn('showAxes') },
    showMesh: { label: 'FE-Netz', desc: 'Finite-Elemente-Netz anzeigen', icon: 'mesh', kbd: 'M', run: () => { if (!st.results.mesh) meshGenerate(app, { quiet: true }); st.setView({ showMesh: !st.view.showMesh }); }, active: viewOn('showMesh') },
    showGrid: { label: 'Raster', desc: 'Raster der Arbeitsebene anzeigen', icon: 'grid', run: toggleView('showGrid'), active: viewOn('showGrid') },
    showNodes: { label: 'Knoten', desc: 'Knotenpunkte anzeigen', icon: 'node', run: toggleView('showNodes'), active: viewOn('showNodes') },
    hideSel: { label: 'Ausblenden', desc: 'Auswahl ausblenden', icon: 'eyeOff', run: () => app.hideSelection() },
    isolateSel: { label: 'Isolieren', desc: 'Nur die Auswahl anzeigen', icon: 'isolate', run: () => app.isolateSelection() },
    showAll: { label: 'Alle zeigen', desc: 'Alle ausgeblendeten Elemente und Teile wieder anzeigen', icon: 'eye', run: () => app.showAll() },
    parts: { label: 'Teile', desc: 'Teile und Geschosse ein-/ausblenden – gilt auch für Ergebnisse und deren Extremwerte', icon: 'layers', kbd: 'Shift+P', run: () => app.openParts(), active: () => st.view.parts.on.size > 0 },
    partNew: { label: 'Neuer Teil', desc: 'Teil aus der aktuellen Auswahl erzeugen', icon: 'plus', run: () => newPartFromSelection(app) },
    storeys: { label: 'Geschosse', desc: 'Geschosse aus horizontalen Flächen und Stützen erkennen – danach als Teile ein-/ausblendbar', icon: 'building', kbd: 'F7', run: () => { detectStoreysCmd(app); app.openParts(); } },

    // ---- selection
    selectAll: { label: 'Alles auswählen', desc: 'Alle sichtbaren Objekte auswählen (inkl. Lager und Lasten des aktiven Lastfalls, je nach Auswahlfilter)', icon: 'boxsel', kbd: 'Ctrl+A', run: () => app.selectAll() },
    invertSel: { label: 'Auswahl umkehren', desc: 'Auswahl invertieren', icon: 'filter', run: () => app.invertSelection() },
    // geometry tools of the left icon bar (AxisVM: Geometriewerkzeuge) – act on the running point input
    geoParallel: { label: 'Parallel', desc: 'Beim Zeichnen: Cursor parallel zu einer Linie führen – Linie anklicken', icon: 'parallel', kbd: 'Alt+P', run: () => app.geometryTool('parallel') },
    geoPerp: { label: 'Senkrecht', desc: 'Beim Zeichnen: Cursor senkrecht zu einer Linie führen – Linie anklicken', icon: 'ortho', kbd: 'Alt+V', run: () => app.geometryTool('perp') },
    geoBisector: { label: 'Winkelhalbierende', desc: 'Beim Zeichnen: Cursor entlang der Winkelhalbierenden zweier Linien führen – beide Linien anklicken', icon: 'bisector', kbd: 'Alt+B', run: () => app.geometryTool('bisector') },
    geoIntersect: { label: 'Schnittpunkt', desc: 'Beim Zeichnen: Punkt im Schnittpunkt zweier Linien setzen – beide Linien anklicken', icon: 'intersect', kbd: 'Alt+I', run: () => app.geometryTool('intersect') },
    snapGrid: { label: 'Rasterfang', desc: 'Cursor am Raster der Zeichenebene fangen', icon: 'grid', run: () => st.setView({ grid: { ...st.view.grid, snap: !st.view.grid.snap } }), active: () => !!st.view.grid.snap },
    objectSnap: { label: 'Objektfang', desc: 'Fangpunkte wählen: Knoten, Linienmitten, Punkte auf Linien', icon: 'magnet', run: () => app.openObjectSnap() },
    autoIntersect: { label: 'Auto-Schnitt', desc: 'Neue Linien an Kreuzungen und an auf ihnen liegenden Knoten automatisch teilen', icon: 'intersect', kbd: 'Ctrl+I', run: toggleView('autoIntersect'), active: viewOn('autoIntersect') },
    displayOptions: { label: 'Darstellungsoptionen', desc: 'Symbole, Beschriftungen, Lasten, Lager, Achsen, Netz ein-/ausblenden', icon: 'sliders', kbd: 'Ctrl+Y', run: () => app.openDisplayOptions() },
    reverseLines: { label: 'Lokales System umkehren', desc: 'Richtung der gewählten Linien umkehren (Anfangs- und Endknoten tauschen)', icon: 'swap', kbd: 'Ctrl+E', run: onSel(['lines'], 'Lokales System umkehren', () => {
      const ids = st.selection.lines;
      st.commit(t('Lokales System umkehren'), (m) => { for (const l of m.lines) if (ids.has(l.id)) { [l.n1, l.n2] = [l.n2, l.n1]; if (l.element?.releases) l.element.releases = { i: l.element.releases.j, j: l.element.releases.i }; } });
    }) },
    lcPrev: { label: 'Vorheriger Lastfall', desc: 'Vorherigen Lastfall aktivieren', icon: 'chevronUp', kbd: 'Ctrl+PageUp', run: () => app.stepLoadCase(-1) },
    lcNext: { label: 'Nächster Lastfall', desc: 'Nächsten Lastfall aktivieren', icon: 'chevronDown', kbd: 'Ctrl+PageDown', run: () => app.stepLoadCase(1) },
    delete: { label: 'Löschen', desc: 'Auswahl löschen – bei gemischter Auswahl lässt sich wählen, welche Objektarten (Knoten, Linien, Stäbe, Flächen, Lager, Lasten) gelöscht werden', icon: 'trash', kbd: 'Del', run: () => deleteSelection(app) },

    // ---- geometry
    toolSelect: { label: 'Auswahl', desc: 'Objekte auswählen (Klick / Rechteck)', icon: 'select', kbd: 'S', run: tool('select'), active: isTool('select') },
    toolOrbit: { label: 'Drehen', desc: 'Ansicht mit der linken Maustaste drehen', icon: 'orbit', kbd: 'Ctrl+R', run: tool('orbit'), active: isTool('orbit') },
    toolNode: { label: 'Knoten', desc: 'Knoten setzen', icon: 'node', run: tool('node'), active: isTool('node') },
    toolLine: { label: 'Linie', desc: 'Geometrielinien zeichnen (Kette)', icon: 'line', run: tool('line'), active: () => app.tools.id === 'line' && !app.tools.opts.element },
    toolRect: { label: 'Rechteck', desc: 'Rechteck aus 4 Linien zeichnen', icon: 'rect', run: tool('rect'), active: () => app.tools.id === 'rect' && !app.tools.opts.domain },
    toolPolygon: { label: 'Polygon', desc: 'Geschlossenes Polygon zeichnen', icon: 'polygon', run: tool('polygon'), active: () => app.tools.id === 'polygon' && !app.tools.opts.domain },
    toolArc: { label: 'Bogen durch 3 Punkte', desc: 'Kreisbogen durch Start-, End- und einen Bogenpunkt (in Segmente unterteilt)', icon: 'arc', run: tool('arc', { segments: 8 }), active: () => app.tools.id === 'arc' && !app.tools.opts.centre },
    toolArcCentre: { label: 'Bogen um Mittelpunkt', desc: 'Kreisbogen: Mittelpunkt, Startpunkt, dann Endwinkel (gegen den Uhrzeigersinn in der Zeichenebene)', icon: 'arc', run: tool('arc', { segments: 8, centre: true }), active: () => app.tools.id === 'arc' && !!app.tools.opts.centre },
    toolSection: { label: 'Schnittlinie', desc: 'Schnittlinie über Flächen zeichnen: Ergebnisverlauf der aktuellen Komponente entlang der Linie (z.B. mx, nx, eZ, axb), mit Diagramm und Integral', icon: 'dimension', run: tool('section'), active: isTool('section') },
    toolMeasure: { label: 'Messen', desc: 'Abstand zwischen zwei Punkten messen', icon: 'measure', run: tool('measure'), active: isTool('measure') },
    translate: { label: 'Verschieben', desc: 'Verschieben / Kopieren: Methode (schrittweise, aufteilen, Abstand, mehrfach, verschieben, abtrennen), Anzahl, Knoten zum Verbinden – dann Start- und Endpunkt des Vektors anklicken', icon: 'move', kbd: 'Shift+T', run: onSel(GEO, 'Verschieben', () => transformDialog(app, 'translate')), active: () => app.tools.id === 'transform' && app.tools.opts.kind === 'translate' && !app.tools.opts.drag },
    rotate: { label: 'Drehen', desc: 'Drehen / rotierend kopieren um eine Achse senkrecht zur Ansicht: Drehpunkt, Start- und Endpunkt anklicken', icon: 'rotate', kbd: 'Shift+R', run: onSel(GEO, 'Drehen', () => transformDialog(app, 'rotate')), active: () => app.tools.id === 'transform' && app.tools.opts.kind === 'rotate' },
    mirror: { label: 'Spiegeln', desc: 'Spiegeln / gespiegelt kopieren an einer Ebene senkrecht zur Ansicht: zwei Punkte anklicken', icon: 'mirror', kbd: 'Shift+M', run: onSel(GEO, 'Spiegeln', () => transformDialog(app, 'mirror')), active: () => app.tools.id === 'transform' && app.tools.opts.kind === 'mirror' },
    scale: { label: 'Skalieren', desc: 'Skalieren: Zentrum, Bezugspunkt und dessen neue Lage anklicken', icon: 'scale', kbd: 'Shift+S', run: onSel(GEO, 'Skalieren', () => transformDialog(app, 'scale')), active: () => app.tools.id === 'transform' && app.tools.opts.kind === 'scale' },
    split: { label: 'Teilen', desc: 'Ausgewählte Linien in gleiche Teile teilen', icon: 'split', run: onSel(['lines'], 'Teilen', () => splitDialog(app)) },
    intersect: { label: 'Schnittpunkte', desc: 'Linien an Schnittpunkten und auf ihnen liegenden Knoten teilen', icon: 'intersect', run: () => {
      const ids = [...st.selection.lines];
      const n = st.commit(t('Schnittpunkte'), (m) => intersectLines(m, ids));
      toast(n ? t('{n} Schnittpunkte erzeugt.', { n }) : t('Keine Schnittpunkte gefunden.'), n ? 'ok' : 'info');
    } },
    merge: { label: 'Knoten vereinen', desc: 'Doppelte (zusammenfallende) Knoten zusammenführen', icon: 'merge', run: () => {
      const n = st.commit(t('Knoten vereinen'), (m) => mergeNodes(m, 1e-4));
      toast(n ? t('{n} Knoten vereint.', { n }) : t('Keine doppelten Knoten gefunden.'), n ? 'ok' : 'info');
    } },
    generator: { label: 'Generatoren', desc: 'Parametrische Tragwerke erzeugen: Rahmen, Fachwerk, Halle, Decke, Gebäude, Kuppel', icon: 'sparkles', run: () => generatorDialog(app) },
    genFrame: { label: '3D-Rahmen', desc: 'Räumlicher Stockwerkrahmen', icon: 'frame3d', run: () => generatorDialog(app, 'frame') },
    genTruss: { label: 'Fachwerk', desc: 'Fachwerkträger (Pratt, Warren, Howe)', icon: 'truss', run: () => generatorDialog(app, 'truss') },
    genHall: { label: 'Halle', desc: 'Stahlhalle mit Rahmen, Pfetten und Verbänden', icon: 'hall', run: () => generatorDialog(app, 'hall') },
    genSlab: { label: 'Decke', desc: 'Platte mit Stützen oder Wänden', icon: 'slab', run: () => generatorDialog(app, 'slab') },
    genBuilding: { label: 'Gebäude', desc: 'Mehrgeschossiger Massivbau mit Decken, Wänden und Stützen', icon: 'building', run: () => generatorDialog(app, 'building') },
    genDome: { label: 'Kuppel / Schale', desc: 'Zylinderschale, Kuppel oder Silo', icon: 'dome', run: () => generatorDialog(app, 'shell') },

    // ---- elements
    materials: { label: 'Materialien', desc: 'Materialbibliothek: Stahl, Beton, Holz, Aluminium', icon: 'material', run: () => openMaterials(app) },
    sections: { label: 'Querschnitte', desc: 'Querschnittsbibliothek: IPE, HEA, HEB, RHS, CHS, Rechteck …', icon: 'section', run: () => openSections(app) },
    drawBeam: { label: 'Balken', desc: 'Balken (Biegestab) zeichnen', icon: 'beam', kbd: 'F4', run: tool('line', { element: 'beam' }), active: isTool('line', 'element', 'beam') },
    drawTruss: { label: 'Fachwerkstab', desc: 'Fachwerkstab (nur Normalkraft) zeichnen', icon: 'truss', run: tool('line', { element: 'truss' }), active: isTool('line', 'element', 'truss') },
    drawRib: { label: 'Rippe', desc: 'Rippe (Unterzug) zeichnen', icon: 'rib', run: tool('line', { element: 'rib' }), active: isTool('line', 'element', 'rib') },
    drawSpring: { label: 'Feder', desc: 'Federelement zwischen zwei Knoten', icon: 'spring', run: tool('line', { element: 'spring' }), active: isTool('line', 'element', 'spring') },
    drawRigid: { label: 'Starrstab', desc: 'Starres Element (Kopplung)', icon: 'rigid', run: tool('line', { element: 'rigid' }), active: isTool('line', 'element', 'rigid') },
    lineElements: { label: 'Linienelemente', desc: 'Fachwerkstab, Balken oder Rippe den Linien zuweisen: Material, Querschnitt, Drehwinkel, Exzentrizität, Endfreigaben. Mit Auswahl öffnet sich das Fenster sofort, sonst zuerst Linien wählen und OK', icon: 'beam', run: onSel(['lines'], 'Linienelemente', () => assignLineElement(app)) },
    rigidElements: { label: 'Starre Elemente', desc: 'Gewählte Linien als starre Kopplung (Starrstab) definieren', icon: 'rigid', run: onSel(['lines'], 'Starre Elemente', () => assignLineElement(app, { types: ['rigid'] })) },
    springElements: { label: 'Federelemente', desc: 'Gewählte Linien als Federelemente mit 6 Steifigkeiten definieren', icon: 'spring', run: onSel(['lines'], 'Federelemente', () => assignLineElement(app, { types: ['spring'] })) },
    releases: { label: 'Gelenke', desc: 'Stabendgelenke (Freigaben) definieren', icon: 'hinge', run: onSel(['lines'], 'Gelenke', () => editReleases(app)) },
    drawPlate: { label: 'Platte', desc: 'Rechteckige Platte (Biegung) zeichnen', icon: 'plate', run: tool('rect', { domain: 'plate' }), active: isTool('rect', 'domain', 'plate') },
    drawShell: { label: 'Schale', desc: 'Rechteckige Schale (Biegung + Membran) zeichnen', icon: 'shell', run: tool('rect', { domain: 'shell' }), active: isTool('rect', 'domain', 'shell') },
    drawMembrane: { label: 'Scheibe', desc: 'Rechteckige Scheibe (Membran, z.B. Wand) zeichnen', icon: 'membrane', run: tool('rect', { domain: 'membrane' }), active: isTool('rect', 'domain', 'membrane') },
    drawDomainPoly: { label: 'Fläche Polygon', desc: 'Fläche mit beliebigem Umriss zeichnen', icon: 'domain', run: tool('polygon', { domain: 'shell' }), active: () => app.tools.id === 'polygon' && !!app.tools.opts.domain && app.tools.opts.domain !== 'panel' },
    domainFromSel: { label: 'Aus Auswahl', desc: 'Fläche aus gewählten, geschlossenen Linien erzeugen', icon: 'domain', run: onSel(['lines'], 'Aus Auswahl', () => domainFromSelection(app)) },
    addHole: { label: 'Öffnung', desc: 'Gewählte geschlossene Linien als Öffnung in die gewählte Fläche einfügen', icon: 'hole', run: () => need(['domains'], t('Bitte Fläche und Öffnungslinien auswählen.')) && addHoleFromSelection(app) },
    supNode: { label: 'Knotenlager', desc: 'Lager/Federn an gewählten Knoten definieren', icon: 'supportPin', run: onSel(['nodes'], 'Knotenlager', () => supportDialog(app, 'node')) },
    supFixed: { label: 'Eingespannt', desc: 'Gewählte Knoten voll einspannen', icon: 'supportFixed', run: onSel(['nodes'], 'Eingespannt', () => quickSupport(app, 'fixed')) },
    supPinned: { label: 'Gelenkig', desc: 'Gewählte Knoten gelenkig lagern (ux, uy, uz fest)', icon: 'supportPin', run: onSel(['nodes'], 'Gelenkig', () => quickSupport(app, 'pinned')) },
    supLine: { label: 'Linienlager', desc: 'Linienlager / elastische Bettung entlang gewählter Linien', icon: 'supportLine', run: onSel(['lines'], 'Linienlager', () => supportDialog(app, 'line')) },
    supSurface: { label: 'Flächenbettung', desc: 'Elastische Bettung (Winkler) unter gewählten Flächen', icon: 'supportSurface', run: onSel(['domains'], 'Flächenbettung', () => supportDialog(app, 'surface')) },
    designParams: { label: 'Knicklängen', desc: 'Knicklängenbeiwerte und Kippparameter für Bemessung', icon: 'buckling', run: onSel(['lines'], 'Knicklängen', () => designParams(app)) },
    rcParams: { label: 'Bewehrungsparameter', desc: 'Betondeckung, Stabdurchmesser, Lagen und Stahlsorte für gewählte Flächen bzw. Betonbalken (Plattenbalken: mitwirkende Breite)', icon: 'concrete', run: () => rcParamsDialog(app) },

    // ---- loads
    loadCases: { label: 'Lastfälle', desc: 'Lastfälle und Lastgruppen verwalten', icon: 'loadCase', run: () => openLoadCases(app) },
    combinations: { label: 'Kombinationen', desc: 'Lastfallkombinationen definieren', icon: 'combination', run: () => openCombinations(app) },
    autoCombos: { label: 'Auto-Kombi', desc: 'Kombinationen nach Norm (EN 1990 / SIA 260) automatisch erzeugen', icon: 'sparkles', run: () => autoCombinations(app) },
    loadNode: { label: 'Knotenlast', desc: 'Kräfte und Momente an gewählten Knoten', icon: 'loadNode', run: onSel(['nodes'], 'Knotenlast', () => nodeLoadDialog(app)) },
    loadLine: { label: 'Linienlast', desc: 'Gleich- oder Trapezlast auf gewählte Linien/Stäbe', icon: 'loadTrap', run: onSel(['lines'], 'Linienlast', () => lineLoadDialog(app, false)) },
    loadPoint: { label: 'Einzellast', desc: 'Einzelkraft oder -moment auf gewählten Stäben', icon: 'loadPoint', run: onSel(['lines'], 'Einzellast', () => lineLoadDialog(app, true)) },
    loadSurfLine: { label: 'Linienlast auf Fläche', desc: 'Linienlast frei auf einer Fläche: zwei Punkte klicken (z.B. Wandlast auf Decke)', icon: 'loadLine', run: tool('surfaceLoad', { mode: 'line' }), active: isTool('surfaceLoad', 'mode', 'line') },
    loadSurfPoint: { label: 'Einzellast auf Fläche', desc: 'Einzellast frei auf einer Fläche: Punkt klicken (z.B. Stützenlast von oben)', icon: 'loadPoint', run: tool('surfaceLoad', { mode: 'point' }), active: isTool('surfaceLoad', 'mode', 'point') },
    drawPanel: { label: 'Lastfläche', desc: 'Lastverteilungsfläche zeichnen: verteilt Flächenlasten ohne eigene Steifigkeit auf Balken, Rippen und Wände (z.B. Holz- und Stahldecken)', icon: 'loadSurface', run: tool('polygon', { domain: 'panel' }), active: isTool('polygon', 'domain', 'panel') },
    loadSurface: { label: 'Flächenlast', desc: 'Gleichmässige Flächenlast auf gewählte Flächen', icon: 'loadSurface', run: onSel(['domains'], 'Flächenlast', () => surfaceLoadDialog(app)) },
    selfWeight: { label: 'Eigengewicht', desc: 'Eigengewicht im aktiven Lastfall ein-/ausschalten', icon: 'selfWeight', run: () => toggleSelfWeight(app), active: () => !!st.idx.loadCases.get(st.activeLC)?.selfWeight },
    loadTemp: { label: 'Temperatur', desc: 'Temperaturlast (gleichmässig und Gradient)', icon: 'temperature', run: onSel(['lines', 'domains'], 'Temperatur', () => temperatureDialog(app)) },
    loadSettle: { label: 'Stützensenkung', desc: 'Vorgegebene Auflagerverschiebung', icon: 'settlement', run: onSel(['nodes'], 'Stützensenkung', () => settlementDialog(app)) },
    snowWind: { label: 'Schnee & Wind', desc: 'Schnee- und Windlast auf gewählte Dachflächen (vereinfacht nach EN 1991 / SIA 261)', icon: 'snow', run: onSel(['domains'], 'Schnee & Wind', () => snowWindDialog(app)) },

    // ---- mesh
    meshGen: { label: 'Netz erzeugen', desc: 'Finite-Elemente-Netz generieren und anzeigen', icon: 'mesh', run: () => meshGenerate(app) },
    meshSettings: { label: 'Netzparameter', desc: 'Elementgrösse und Stabunterteilung', icon: 'meshRefine', run: () => meshSettings(app) },
    checkModel: { label: 'Modell prüfen', desc: 'Modell auf Fehler und Warnungen prüfen', icon: 'shieldCheck', run: () => checkModel(app) },

    // ---- static
    runLinear: { label: 'Linear rechnen', desc: 'Lineare Statik für alle Lastfälle und Kombinationen', icon: 'run', kbd: 'F5', run: () => runStatic(app, false) },
    runNonlinear: { label: 'Nichtlinear', desc: 'Theorie II. Ordnung (P-Δ), Zug-/Druckstäbe, abhebende Lager', icon: 'nonlinear', run: () => runStatic(app, true) },
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
    designRCCol: { label: 'Stützen bemessen', desc: 'Stahlbetonstützen: N-M-Interaktion (zweiachsig), Schlankheit und Theorie II. Ordnung (Modellstütze, Nennkrümmung), Bewehrungsvorschlag', icon: 'column', run: () => runDesign(app, 'rcCol') },
    resRcCol: { label: 'Stützen', desc: 'Ausnutzung der Stahlbetonstützen mit der vorgeschlagenen Bewehrung – Doppelklick zeigt das Interaktionsdiagramm', icon: 'column', run: () => showRc({ component: 'colEta' }), active: () => isRc() && rcSource() === 'rcCols' },
    rcProvided: { label: 'Vorhandene Bewehrung', desc: 'Gewählte Flächenbewehrung (Ø / Abstand je Lage) vorgeben – zeigt dann fehlende Zulagen', icon: 'grid', run: () => rcProvidedDialog(app) },
    resRcReq: { label: 'Erforderlich', desc: 'Erforderliche Bewehrung der gewählten Lage', icon: 'contour', run: () => showRc({ rcMode: 'req', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode !== 'prov' && st.resultView.rcMode !== 'miss' && isRcLayer(st.resultView.component) },
    resRcProv: { label: 'Vorhanden', desc: 'Vorgegebene (gewählte) Bewehrung der Lage', icon: 'grid', run: () => showRc({ rcMode: 'prov', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode === 'prov' && isRcLayer(st.resultView.component) },
    resRcMiss: { label: 'Fehlend', desc: 'Fehlende Bewehrung = erforderlich − vorhanden (Zulagen)', icon: 'alert', run: () => showRc({ rcMode: 'miss', component: rcLayer() }), active: () => isRc() && st.resultView.rcMode === 'miss' && isRcLayer(st.resultView.component) },
    resRcShear: { label: 'Schub', desc: 'Querkraftnachweis der Platte ohne Schubbewehrung: vEd / vRd,c', icon: 'stress', run: () => showRc({ component: 'vRatio' }), active: () => isRc() && st.resultView.component === 'vRatio' },
    resPunch: { label: 'Durchstanzen', desc: 'Durchstanznachweis an Stützen und Punktlagern (EN 1992-1-1 6.4 / SIA 262 4.3.6)', icon: 'target', run: () => showRc({ component: 'punch' }), active: () => isRc() && st.resultView.component === 'punch' },
    resRcBeam: { label: 'Balkenbewehrung', desc: 'Erforderliche Längsbewehrung der Betonbalken (unten/oben) und Bügel', icon: 'beam', run: () => showRc({ component: 'AsBot' }), active: () => isRc() && rcSource() === 'rcBeams' },
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
  const TOGGLES = ['autoIntersect', 'snapGrid', 'persp', 'renderFull', 'labelsNodes', 'labelsLines', 'labelsValues', 'showLoads', 'showSupports', 'showAxes', 'showMesh', 'showGrid', 'showNodes', 'selfWeight'];
  for (const id of TOGGLES) C[id].toggle = true;
  // tool letters of the tabs: shown like a shortcut, active only on their tab
  for (const map of Object.values(TAB_KEYS)) for (const [k, id] of Object.entries(map)) { C[id].tabKey = C[id].tabKey || k; C[id].kbd = C[id].kbd || k; }
  for (const [id, c] of Object.entries(C)) {
    c.id = id;
    c.label = t(c.label);
    c.desc = t(c.desc);
    c.kind = c.toggle ? 'toggle' : c.active ? 'mode' : 'action';
    // Space repeats the last command (AxisVM) – tools and dialogs, not switches, views or undo
    if (!c.toggle && !NO_REPEAT.has(id)) { const run = c.run; c.run = (...a) => { app.lastCmd = c; return run(...a); }; }
  }
  return C;
}

const NO_REPEAT = new Set(['undo', 'redo', 'palette', 'help', 'zoomIn', 'zoomOut', 'geoParallel', 'geoPerp', 'geoBisector', 'geoIntersect', 'objectSnap', 'zoomFit', 'viewIso', 'viewTop', 'viewFront', 'viewSide', 'renderWire', 'renderSolid', 'renderFull', 'toolSelect', 'toolOrbit', 'lcPrev', 'lcNext', 'displayOptions', 'panel', 'theme', 'lang', 'save', 'open', 'new']);

// AxisVM tool letters per tab (X7 manual p.33); elsewhere the letters are free
export const TAB_KEYS = {
  geometry: { N: 'toolNode', L: 'toolLine', R: 'toolRect', P: 'toolPolygon', A: 'toolArcCentre', B: 'toolArc', D: 'split', I: 'intersect' },
  elements: { L: 'lineElements', T: 'supNode', U: 'supLine', D: 'domainFromSel', H: 'addHole' },
  loads: { L: 'loadCases', C: 'combinations', N: 'loadNode', B: 'loadPoint', J: 'loadLine', H: 'loadSurface', D: 'loadSurface', A: 'loadSurfPoint', I: 'loadSurfLine', P: 'drawPanel', G: 'selfWeight', O: 'snowWind', W: 'snowWind' },
};

// Ribbon layout per module. Strings are commands; objects are custom controls rendered by the app.
export const RIBBON = {
  geometry: [
    { title: 'Zeichnen', items: ['toolNode', 'toolLine', 'toolRect', 'toolPolygon', 'toolArcCentre', 'toolArc'] },
    { title: 'Bearbeiten', items: ['translate', 'rotate', 'mirror', 'scale', 'split', 'intersect', 'merge', 'delete'] },
    { title: 'Generatoren', items: ['genFrame', 'genTruss', 'genHall', 'genSlab', 'genBuilding', 'genDome'] },
    { title: 'Arbeitsebene', items: [{ custom: 'workplane' }] },
    { title: 'Teile', items: ['parts', 'partNew', 'storeys'] },
    { title: 'Werkzeuge', items: ['toolMeasure', 'importDxf'] },
  ],
  elements: [
    { title: 'Bibliothek', items: ['materials', 'sections'] },
    { title: 'Linienelemente', items: ['lineElements', 'rigidElements', 'springElements', 'releases'] },
    { title: 'Direkt zeichnen', items: ['drawBeam', 'drawTruss', 'drawRib'] },
    { title: 'Flächenelemente', items: ['drawPlate', 'drawShell', 'drawMembrane', 'drawDomainPoly', 'domainFromSel', 'addHole'] },
    { title: 'Lager', items: ['supFixed', 'supPinned', 'supNode', 'supLine', 'supSurface'] },
    { title: 'Anzeige', items: ['showAxes', 'renderFull'] },
  ],
  loads: [
    { title: 'Lastfall', items: [{ custom: 'lcSelect' }, 'loadCases', 'combinations', 'autoCombos'] },
    { title: 'Lasten', items: ['selfWeight', 'loadNode', 'loadLine', 'loadPoint', 'loadSurface', 'loadSurfLine', 'loadSurfPoint', 'loadTemp', 'loadSettle', 'snowWind'] },
    { title: 'Lastflächen', items: ['drawPanel', 'domainFromSel'] },
    { title: 'Anzeige', items: ['showLoads', 'labelsValues', 'tables'] },
  ],
  mesh: [
    { title: 'Finite Elemente', items: ['meshGen', 'meshSettings', 'showMesh'] },
    { title: 'Prüfen', items: ['checkModel', 'merge', 'intersect'] },
  ],
  static: [
    { title: 'Berechnung', items: ['runLinear', 'runNonlinear'] },
    { title: 'Ergebnisse', items: ['resOff', 'resDeformed', 'resDisp', 'resBeam', 'resShell', 'resStress', 'resReactions'] },
    { title: 'Auswertung', items: ['toolSection', 'parts'] },
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
    { title: 'Bemessung', items: ['designRC', 'designRCBeam', 'designRCCol', 'rcProvided'] },
    { title: 'Ergebnisse', items: ['resRcReq', 'resRcProv', 'resRcMiss', 'resRcShear', 'resPunch', 'resRcBeam', 'resRcCol', 'toolSection'] },
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
};
