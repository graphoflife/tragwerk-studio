# Tragwerk Studio – 3D-FEM im Browser

Modulare Finite-Elemente-Software für Tragwerke, angelehnt an den Arbeitsablauf von AxisVM:
Geometrie → Elemente → Lasten → Netz → Statik → Schwingung → Knicken → Bemessung → Bericht.
Läuft vollständig im Browser als statische Website (z.B. GitHub Pages) – keine Installation, kein Server, keine Build-Tools.

> Unabhängiges Projekt, nicht mit InterCAD/AxisVM verbunden.

## Funktionen

| Modul | Inhalt |
|---|---|
| **1 Geometrie** | Knoten, Linien, Polylinien, Rechtecke, Polygone, Kreisbögen; Arbeitsebenen XY/XZ/YZ mit Raster; Fangen (Knoten, Mitten, Raster, orthogonal); Koordinateneingabe `x y z` / `@dx dy dz`; Verschieben/Kopieren (mehrfach, mit Verbindungsstäben), Drehen, Spiegeln, Skalieren, Teilen, Schnittpunkte, Knoten vereinen; DXF-Import/-Export; parametrische Generatoren (3D-Rahmen, Fachwerk, Stahlhalle, Decke, Gebäude, Zylinderschale/Kuppel/Silo) |
| **2 Elemente** | Material- und Querschnittsbibliothek (S235–S460, C12/15–C50/60, C16–GL32h, Aluminium; IPE, HEA, HEB, HEM, IPN, UPN, SHS, RHS, CHS, L + parametrische Querschnitte); Balken, Fachwerkstäbe (auch nur Zug/Druck), Rippen, Starrstäbe, Federn; Stabendgelenke; Platten, Schalen, Scheiben mit Öffnungen; Knoten-, Linien- und Flächenlager (Federn, Bettung, abhebend) |
| **3 Lasten** | Lastfälle und Lastgruppen (γ/ψ), Eigengewicht, Knotenlasten, Gleich-/Trapez-/Teillasten (global, lokal, projiziert), Einzellasten und -momente, Flächenlasten, Temperatur (gleichmässig + Gradient), Stützensenkung, Schnee & Wind (vereinfacht); Kombinationen von Hand oder automatisch nach **EN 1990** bzw. **SIA 260** |
| **4 Netz** | Automatische Vernetzung (strukturiert oder Delaunay → Vierecke), konforme Netze zwischen Wänden, Decken, Unterzügen und Stützen; Modellprüfung |
| **5 Statik** | Lineare Statik, Superposition, Umhüllende; nichtlinear: Theorie II. Ordnung (P-Δ), Zug-/Druckstäbe, abhebende Lager. Ergebnisse: Verformung, Verschiebungen, Stabschnittgrössen N/Vy/Vz/T/My/Mz, Flächenschnittgrössen nx…vy, Hauptwerte, Spannungen, Auflagerkräfte |
| **6 Schwingung** | Eigenfrequenzen und -formen (animiert), Massenbeteiligung; Antwortspektrenverfahren nach **EN 1998-1** bzw. **SIA 261** (SRSS/CQC) |
| **7 Knicken** | Lineare Stabilitätsanalyse (Stäbe und Schalen), kritische Lastfaktoren αcr und Knickformen |
| **8 Bemessung** | Stahl **EN 1993-1-1 / SIA 263** (Querschnittsklassen, Festigkeit, Biegeknicken, Biegedrillknicken, Interaktion), Stahlbeton **EN 1992-1-1 / SIA 262** (Flächen nach Wood-Armer, Balken mit Biege- und Schubbewehrung), Holz **EN 1995-1-1 / SIA 265** |
| **9 Bericht** | Tabellenbrowser (bearbeitbar, sortierbar, CSV/Excel), Druck-/PDF-Bericht mit Ansichten, Modell als JSON speichern/laden, Screenshots |

Weiteres: Hell-/Dunkelmodus, Deutsch/Englisch, wählbare Einheiten, Rückgängig/Wiederholen, Autosave im Browser, Befehlssuche (`Ctrl+K`), Kontextmenüs, Tooltips mit Tastenkürzeln, 12 Beispielmodelle.

## Starten

**Online:** nach dem Deployment (siehe unten) einfach die GitHub-Pages-Adresse öffnen.

**Lokal:** ES-Module benötigen einen HTTP-Server (Doppelklick auf `index.html` genügt nicht):

```bash
python3 tools/serve.py 8080
```

Dann <http://localhost:8080> öffnen. Jeder andere statische Server funktioniert ebenfalls.

## Auf GitHub Pages veröffentlichen

1. Repository auf GitHub anlegen und den Inhalt dieses Ordners pushen (Branch `main`).
2. Auf GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Der Workflow `.github/workflows/pages.yml` führt die Tests aus und veröffentlicht die Seite bei jedem Push.

Alternativ ohne Actions: *Source: Deploy from a branch*, Branch `main`, Ordner `/ (root)`. Die Datei `.nojekyll` ist bereits vorhanden.

## Bedienung

| Aktion | Maus / Taste |
|---|---|
| Auswählen | Klick; Rechteck ziehen (→ Fenster, ← Kreuzen); `Shift` hinzufügen, `Ctrl` umschalten |
| Ansicht drehen / verschieben / zoomen | rechte Maustaste / mittlere Maustaste / Mausrad (Touch: 1 bzw. 2 Finger) |
| Zeichnen | `N` Knoten, `L` Linie, `B` Balken, `R` Rechteck, `P` Polygon, `A` Bogen, `M` Messen |
| Verändern | `V` Verschieben, `K` Kopieren, `D` Drehen (interaktiv), `Shift+M` Mehrfach kopieren (Dialog), `Q` Auswahl |
| Ansichten | `Z`/`Pos1` alles, `I` Iso, `T` oben, `F` vorne, `S` Seite, `C` Perspektive, `W` gerendert |
| Bearbeiten | `Ctrl+Z`/`Ctrl+Y`, `Entf` löschen, `H` ausblenden, `Shift+H` isolieren, `Alt+H` alles zeigen |
| Rechnen | `F5` linear, `Shift+F5` nichtlinear |
| Sonstiges | `Ctrl+K` Befehlssuche, `Shift+T` Tabellen, `Ctrl+P` Bericht, `Alt+1…9` Module, `F1` Hilfe |

### Punkteingabe wie im CAD

Alle Werkzeuge, die einen Punkt brauchen (Zeichnen, Verschieben, Kopieren, Drehen, Messen), verwenden denselben Mechanismus. Eine Anzeige am Mauszeiger zeigt Fangpunkt, Achse, ΔX/ΔY/ΔZ und die getippte Eingabe.

| Eingabe | Wirkung |
|---|---|
| Maus | Fangen an Knoten, Linienmitten, optional Linien (Statusleiste), sonst Raster der Arbeitsebene |
| `X` / `Y` / `Z` | Auf globale Achse durch den Bezugspunkt beschränken. Fährt man dann einen Knoten oder eine Mitte an, wird dieser Punkt **auf die Achse projiziert** |
| `Shift+X/Y/Z` | Auf die Ebene senkrecht zur Achse beschränken |
| `B` | Anderen Bezugspunkt wählen – relative Eingaben und Achsen beziehen sich dann darauf |
| `3` | Eine Zahl: Distanz entlang der Achse bzw. in Mausrichtung |
| `2 0 1` | dx dy dz – relativ zum Bezugspunkt (beim ersten Punkt absolut) |
| `#5 0 3` / `@2 0 0` | absolut bzw. relativ erzwingen |
| `4 6` | zwei Werte = Koordinaten in der Arbeitsebene |
| `@5<30` | polar: Länge 5, Winkel 30° in der Arbeitsebene |
| `0 3 0 x4` | beim Kopieren: 4 Kopien mit diesem Abstand |
| `Tab` / `Enter` / `Esc` | relativ↔absolut / bestätigen / Eingabe bzw. Achse löschen, dann abbrechen |

**Beispiel:** Stütze wählen, `V`, Fusspunkt anklicken, `X` drücken, die Mitte eines anderen Trägers anfahren und klicken – die Stütze wird entlang X genau auf die Höhe dieser Mitte verschoben. Beim Drehen (`D`) Winkel tippen (`90`, `30 x11` für 11 Kopien) oder zwei Richtungen klicken; `Alt+X/Y/Z` wählt die Drehachse.

## Einheiten und Konventionen

- Intern konsistent **m, kN, t, s** (Spannungen in kN/m²); Anzeige-Einheiten unter *Einstellungen* wählbar.
- Globale Z-Achse nach oben, Eigengewicht wirkt in −Z.
- Lokale Stabachsen: x vom Anfangs- zum Endknoten, z in der vertikalen Ebene nach oben (vertikale Stäbe: z = global X), Drehung β um x. Starke Achse = y.
- Vorzeichen: N > 0 Zug; My > 0 erzeugt Zug an der Unterseite (−z); Flächenmomente mx > 0 Zug unten.
- Details der Datenformate und Schnittstellen: [SPEC.md](SPEC.md).

## Aufbau

```
index.html            Einstieg (Import-Map auf vendor/three)
css/style.css         Designsystem (Pastellfarben, hell/dunkel)
js/ui/                Oberfläche: App, Ribbon, 3D-Viewport (three.js), Werkzeuge, Dialoge
js/core/              Modell, Undo/Redo, Einheiten, Generatoren, Analyse-Runner (Web Worker)
js/mesh/              Vernetzung (CDT, strukturierte Netze)
js/fem/               FE-Löser: Balken (Timoshenko), MITC4/QM6-Schale, Skyline-LDLᵀ, Eigenwerte, Knicken, Spektrum
js/design/            Bemessung EC/SIA und Lastkombinationen
js/lib/               Material- und Querschnittsbibliothek
tests/                Node-Tests (node tests/run-all.mjs)
vendor/three/         three.js r160 (MIT)
```

Tests ausführen (Node ≥ 18): `node tests/run-all.mjs` – prüft u.a. Balken gegen Handrechnung, Navier-Platte, Euler-Knicken, Eigenfrequenzen, P-Δ, Netze, Querschnittswerte, Bemessung und alle Beispielmodelle.

## Hinweise zu den Normen

Die Nachweise sind sorgfältig umgesetzt und durch Tests gegen Handrechnungen geprüft, ersetzen aber keine geprüfte Statiksoftware. Einige SIA-Werte konnten nicht direkt an den Normtexten verifiziert werden und sollten vor produktivem Einsatz geprüft werden:

- **SIA 260:** ψ-Beiwerte der Lastgruppen (in den Lastgruppen editierbar).
- **SIA 261:** Spektrumsparameter/Ziffern; Baugrundklasse F wird mit Parametern D gerechnet; vertikales Spektrum als 0.7·agd angenommen.
- **SIA 262:** Druckzonenhöhe 0.85·x, Grenze x/d ≤ 0.35, kc = 0.55, cot α = 1.0 (Standard).
- **SIA 263:** Interaktionsformel mit ω-Beiwerten und Ziffernangaben.
- **SIA 265:** Lastdauerbeiwert ηt = 1.0 (anpassbar über die Lastgruppe).

Die Annahmen sind zusätzlich im Kopf der jeweiligen Dateien unter `js/design/` und `js/fem/spectrum.js` dokumentiert.

## Lizenzen

three.js © three.js authors, MIT-Lizenz (`vendor/three/LICENSE`). Schrift Inter / JetBrains Mono über Google Fonts (SIL OFL).
