# Tragwerk Studio – 3D-FEM im Browser

Modulare Finite-Elemente-Software für Tragwerke, angelehnt an den Arbeitsablauf von AxisVM:
Geometrie → Elemente → Lasten → Netz → Statik → Knicken → Schwingung → Stahlbeton → Stahl → Holz → Bericht.
Läuft vollständig im Browser als statische Website (z.B. GitHub Pages) – keine Installation, kein Server, keine Build-Tools.

> Unabhängiges Projekt, nicht mit der Inter-CAD Kft. verbunden und weder von ihr unterstützt noch geprüft. AxisVM ist ein Produkt und eine Marke der Inter-CAD Kft.; der Name wird hier nur als Verweis auf deren Software verwendet.

## Funktionen

| Modul | Inhalt |
|---|---|
| **1 Geometrie** | Knoten, Linien, Polylinien, Rechtecke, Polygone, Kreisbögen; Arbeitsebenen XY/XZ/YZ mit Raster; Fangen (Knoten, Mitten, Raster, orthogonal); Koordinateneingabe `x y z` / `@dx dy dz`; Verschieben/Kopieren (mehrfach, mit Verbindungsstäben), Drehen, Spiegeln, Skalieren, Teilen, Schnittpunkte, Knoten vereinen; DXF-Import/-Export; parametrische Generatoren (3D-Rahmen, Fachwerk, Stahlhalle, Decke, Gebäude, Zylinderschale/Kuppel/Silo); **Teile und Geschosse** (siehe unten) |
| **2 Elemente** | Material- und Querschnittsbibliothek (S235–S460, C12/15–C50/60, C16–GL32h, Aluminium; IPE, HEA, HEB, HEM, IPN, UPN, SHS, RHS, CHS, L + parametrische Querschnitte); Balken, Fachwerkstäbe (auch nur Zug/Druck), Rippen, Starrstäbe, Federn; Stabendgelenke; **Exzentrizität** (Rippen/Unterzüge bündig unter der Platte oder mit Versatz, über Starrstäbe gekoppelt); Platten, Schalen, Scheiben mit Öffnungen; Knoten-, Linien- und Flächenlager (Federn, Bettung, abhebend) |
| **3 Lasten** | Lastfälle und Lastgruppen (γ/ψ), Eigengewicht, Knotenlasten, Gleich-/Trapez-/Teillasten (global, lokal, projiziert), Einzellasten und -momente, Flächenlasten (konstant, **linear veränderlich**, **hydrostatisch**), **Linien- und Einzellasten frei auf Flächen**, **Lastflächen** (Lastverteilung ohne Steifigkeit auf Balken, Rippen und Wände, zwei- oder einachsig), Temperatur (gleichmässig + Gradient), Stützensenkung, Schnee & Wind (vereinfacht); Kombinationen von Hand oder automatisch nach **EN 1990** bzw. **SIA 260** |
| **4 Netz** | Automatische Vernetzung (strukturiert oder Delaunay → Vierecke), konforme Netze zwischen Wänden, Decken, Unterzügen und Stützen; Modellprüfung |
| **5 Statik** | Lineare Statik, Superposition, Umhüllende; nichtlinear: Theorie II. Ordnung (P-Δ), Zug-/Druckstäbe, abhebende Lager. Ergebnisse: Verformung, Verschiebungen eX…eR, Stabschnittgrössen Nx/Vy/Vz/Tx/My/Mz, Flächenschnittgrössen nx…vy, Hauptwerte, Spannungen, Auflagerkräfte; **Schnittlinien** über Flächen mit Diagramm, Extremwerten, Integral und CSV-Export |
| **6 Knicken** | Lineare Stabilitätsanalyse (Stäbe und Schalen), kritische Lastfaktoren αcr und Knickformen |
| **7 Schwingung** | Eigenfrequenzen und -formen (animiert), Massenbeteiligung; Antwortspektrenverfahren nach **EN 1998-1** bzw. **SIA 261** (SRSS/CQC) |
| **8 Stahlbeton** | **EN 1992-1-1 / SIA 262**: Bewehrungsparameter je Fläche (Deckung oben/unten, Ø je Richtung, Stahlsorte) mit Skizze der statischen Höhen; Flächenbemessung nach Wood-Armer mit **axb, ayb, axt, ayt** als *erforderlich / vorhanden / fehlend* (vorgegebene Grundbewehrung Ø/s, Zulagen); Bewehrungsvorschlag (z.B. Ø12/150); Querkraft vEd/vRd,c; **Durchstanzen** an Stützen und Punktlagern (Innen-/Rand-/Eckstütze automatisch); **Plattenbalken**: Rippen in der Plattenebene mit mitwirkender Breite beff und den Plattenschnittgrössen innerhalb beff; Balken mit Längs- und Bügelbewehrung, Stabvorschlag (z.B. 8 Ø25, 2 Lagen) und Querschnittsskizze; **Stützen** (Rechteck/Kreis): Schlankheit, Imperfektion und Theorie II. Ordnung nach dem Modellstützenverfahren (Nennkrümmung), zweiachsige N-M-Interaktion, Bewehrungsvorschlag und Interaktionsdiagramm; **Bemessungsprotokoll** (was wurde wie gerechnet, massgebende Kombination, Ort) |
| **9 Stahl** | **EN 1993-1-1 / SIA 263**: Querschnittsklassen, Festigkeit, Biegeknicken, Biegedrillknicken, Interaktion; Ausnutzung gesamt oder je Nachweis; Detailfenster mit Schnittgrössenverläufen und allen Nachweisen |
| **10 Holz** | **EN 1995-1-1 / SIA 265**, gleiche Darstellung wie Stahl |
| **11 Bericht** | Tabellenbrowser (bearbeitbar, sortierbar, CSV/Excel), Druck-/PDF-Bericht mit Ansichten, Modell als JSON speichern/laden, Screenshots |

Weiteres: Hell-/Dunkelmodus, Deutsch/Englisch, wählbare Einheiten, Rückgängig/Wiederholen, Autosave im Browser, Befehlssuche (`Ctrl+K`), Kontextmenüs, Tooltips mit Tastenkürzeln, 13 Beispielmodelle (u.a. Flachdecke mit Durchstanzen, Plattenbalkendecke).

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

Die Bedienung folgt AxisVM: Menüzeile (*Datei · Editieren · Einstellungen · Ansichten · Fenster · Hilfe*), Register mit den Werkzeugen des Moduls (Geometrie, Elemente, Lasten, Netz, Statik, Knicken, Eigenschwingung, Bewehrung, Stahlbemessung, Holzbemessung), links die Symbolleiste mit Ausklappgruppen (Auswahl, Zoom, Ansichten, Darstellungsart, Transformationen, Arbeitsebenen, Geometriewerkzeuge, Teile, Schnittlinien, Suche, Darstellungsoptionen, Modellinfo), oben rechts das Infofenster, unten rechts Koordinatenfenster und Schnellschalter, unten die Informationszeile mit der Anleitung zum laufenden Befehl. Farben wie in AxisVM: Auswahl magenta, Fachwerkstäbe rot, Balken blau, Platten rot, Schalen grün, Scheiben blau; Hintergrund weiss, hellgrau, dunkelgrau oder schwarz (*Einstellungen*).

**Befehle mit Auswahl:** Jeder Befehl, der Objekte braucht (Linienelemente, Lager, Lasten, Transformationen …), lässt sich in beide Richtungen bedienen: Objekte wählen, Befehl drücken → das Fenster öffnet sofort; oder Befehl drücken → die **Auswahl-Symbolleiste** erscheint (+ hinzufügen, − entfernen, ± umschalten, Alles, Vorherige, Teile, Filter), Objekte wählen, OK (Enter / Rechtsklick).

| Aktion | Maus / Taste |
|---|---|
| Auswählen | Klick; Fenster ziehen (→ nur ganz innen, ← auch geschnitten); `Shift` hinzufügen, `Ctrl` entfernen, `Alt` doppelt markieren (Knoten zum Verbinden beim Kopieren); `Num*` alles |
| Verschieben mit der Maus | Knoten oder Linie anfassen und ziehen – gehört das Objekt zur Auswahl, wandert die ganze Auswahl mit; beim Ziehen Koordinaten tippen (`X 2 Enter`), `Esc` bricht ab |
| Ansicht | Mausrad zoomt zum Cursor, Doppelklick Mausrad alles zeigen, mittlere Taste schwenken (`Ctrl` schneller), `Alt`+mittlere Taste drehen; `Ctrl+1` vorne (X-Z), `Ctrl+2` oben (X-Y), `Ctrl+3` Seite (Y-Z), `Ctrl+4` Perspektive, `Ctrl+W` alles, `+`/`−` Zoom, `Alt+F5/F6/F7` Draht/Flächen/gerendert |
| Werkzeugbuchstaben | je Register: Geometrie `N` Knoten, `L` Linie, `R` Rechteck, `P` Polygon, `A` Bogen um Mittelpunkt, `B` Bogen durch 3 Punkte, `D` Linien teilen, `I` Schnittpunkte; Elemente `L` Linienelemente, `T` Knotenlager, `U` Linienlager, `D` Fläche, `H` Öffnung; Lasten `L` Lastfälle, `C` Kombinationen, `N` Knotenlast, `B` Einzellast, `J` Linienlast, `H`/`D` Flächenlast, `A`/`I` Punkt-/Linienlast auf Fläche, `P` Lastfläche, `G` Eigengewicht, `O`/`W` Schnee/Wind |
| Transformationen | `Shift+T` Verschieben, `Shift+R` Drehen, `Shift+M` Spiegeln, `Shift+S` Skalieren: Methode (schrittweise, aufteilen, Abstand/Winkel, mehrfach, verschieben, abtrennen), N, Knoten zum Verbinden (keine, doppelmarkierte, alle), Elemente/Lasten kopieren – dann die Punkte im Modell anklicken |
| Bearbeiten | `Alt+Backspace` rückgängig (auch `Ctrl+Z`), `Shift+Alt+Backspace` wiederholen, `Entf` löschen, `Ctrl+E` lokales System umkehren, `Ctrl+I` Auto-Schnitt, `Leertaste` letzten Befehl wiederholen |
| Rechnen | `F5` linear |
| Sonstiges | `S` Auswahl, `Ctrl+R` Ansicht drehen, `F4` Balken direkt zeichnen, `Shift+P` Teile, `F7` Geschosse, `F10` Bericht, `F12` Tabellen, `Ctrl+Y` Darstellungsoptionen, `Ctrl+L` Lasten, `M` Netz, `Ctrl+PgUp/PgDn` Lastfall, `Shift+F1…F10` Register, `Ctrl+K` Befehlssuche, `F1` Hilfe |
| Ergebnisse abfragen | Mauszeiger über Stab/Fläche zeigt die Werte; **Doppelklick** in den Bemessungsmodulen öffnet die Berechnung im Detail (Stahl-/Holzstab: alle Nachweise; Betonbalken: Verläufe und Querschnitt; Platte: Wood-Armer-Momente und Bewehrung je Kombination) |

### Teile und Geschosse

Wie in AxisVM lassen sich Modellteile gezielt ein- und ausblenden (Knopf **Teile** in der linken Leiste, `Shift+P`, oder Seitenleiste *Modell*):

- **Eigene Teile:** Elemente auswählen → *Aus Auswahl*. Auswahl hinzufügen/entfernen, umbenennen, löschen. Solange ein eigener Teil aktiv ist, landen neu gezeichnete Elemente automatisch darin.
- **Geschosse:** *Erkennen* ermittelt die Höhenlagen aus horizontalen Flächen und Stützen. Ein Geschoss umfasst die Decke auf seiner Höhe und die Stützen und Wände darunter. Ein Klick setzt die Arbeitsebene auf das Geschoss.
- **Logische Teile:** nach Material, Querschnitt und Elementtyp.
- Angehakte Teile werden angezeigt (Vereinigung), nichts angehakt = alles sichtbar. Der Filter gilt auch für **Ergebnisse**: Farbskala, Extremwerte und Diagramme beziehen sich nur auf die sichtbaren Teile. *Alle zeigen* (Schnellschalter) bzw. das ✕ beim Hinweis „Teile: n“ hebt den Filter auf; der Zoom *Alles zeigen* (`Ctrl+W`) passt auf die sichtbaren Teile ein.

### Schnittlinien

Werkzeug **Schnittlinie** (Module Statik und Stahlbeton): zwei Punkte auf einer Fläche klicken (Punkte rasten auf der Fläche ein). Das Diagramm zeigt die aktuelle Flächenkomponente (z.B. mx, nx, eZ, vR, axb, vEd/vRd,c) entlang der Linie, auch über mehrere Flächen; Öffnungen bleiben als Lücke. In der Seitenleiste lassen sich Schnittlinien ein-/ausschalten, umbenennen und löschen; das **Diagrammfenster** zeigt den Verlauf, Max/Min mit Lage, das **Integral** (z.B. Gesamtmoment eines Plattenstreifens aus mx, Gesamtbewehrung aus axt) und exportiert die Werte als CSV.

### Punkteingabe und Koordinatenfenster (wie AxisVM)

Alle Werkzeuge, die einen Punkt brauchen (Zeichnen, Transformationen, Ziehen, Messen), verwenden dieselbe Eingabe. Das **Koordinatenfenster** unten rechts zeigt X Y Z L und r a h des Cursors – mit dem Schalter **d** relativ zum relativen Ursprung (dX dY dZ dL), sonst absolut. Der relative Ursprung folgt jedem gesetzten Punkt.

| Eingabe | Wirkung |
|---|---|
| Maus | Fangen an Knoten, Linienmitten, optional Linien (Objektfang), sonst Raster der Zeichenebene. Wird die Arbeitsebene von der Seite gesehen (z.B. XY in der Vorderansicht), zeichnet man in der Ansichtsebene |
| `X` / `Y` / `Z` | In das Feld springen und Wert tippen (Ausdrücke wie `2*3.5`, `cos(45)`); der nächste Buchstabe wechselt das Feld, `Enter` / `Leertaste` / Klick setzt den Punkt. Beispiel: `x 12 y 0 z 0 Enter` |
| `Shift+Ctrl+L/R/A/H` | Felder L (Abstand), r, a (Winkel), h |
| `Shift+D` / `Shift+E` | Kartesische / polare Felder relativ (d) oder absolut |
| `Ctrl+Alt+X/Y/Z/L/R/A/H` | Feld sperren / entsperren – z.B. dY und dZ gesperrt: der Cursor läuft nur entlang X |
| `Einfg` / `Alt+Shift` | relativen Ursprung auf den Cursor setzen |
| `Shift` halten | Richtung in 15°-Schritten; über eine Linie gefahren: entlang der Linie; über einen Knoten: zum Knoten hin |
| `Alt+P` / `Alt+V` | parallel / senkrecht zu einer Linie (Linie anklicken) |
| `Alt+B` / `Alt+I` | Winkelhalbierende / Schnittpunkt zweier Linien |
| `2 0 1` · `#5 0 3` · `@5<30` · `… *4` | freie Eingabe: dx dy dz, absolut, polar, Anzahl Kopien |
| `Esc` | Eingabe löschen, einen Punkt zurück, dann Werkzeug beenden |

**Beispiel:** Decke wählen, zwei Eckknoten mit `Alt`+Klick doppelt markieren, `Shift+T`, Methode *Schrittweise*, N = 3, Knoten zum Verbinden *Doppelmarkierte*, Verbindung als *Balken*, OK, Startpunkt anklicken, `z 3 Enter` – drei Decken übereinander mit Stützen an den markierten Ecken.

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
js/design/            Bemessung EC/SIA (Stahl, Holz, Stahlbeton, Plattenbalken, Durchstanzen, Bewehrungsvorschlag) und Lastkombinationen
js/lib/               Material- und Querschnittsbibliothek
tests/                Node-Tests (node tests/run-all.mjs)
vendor/three/         three.js r160 (MIT)
```

Tests ausführen (Node ≥ 18): `node tests/run-all.mjs` – prüft u.a. Balken gegen Handrechnung, Navier-Platte, Euler-Knicken, Eigenfrequenzen, P-Δ, Netze, Querschnittswerte, Bemessung und alle Beispielmodelle.

## Hinweise zu den Normen

Die Nachweise sind sorgfältig umgesetzt und durch Tests gegen Handrechnungen geprüft, ersetzen aber keine geprüfte Statiksoftware. Einige SIA-Werte konnten nicht direkt an den Normtexten verifiziert werden und sollten vor produktivem Einsatz geprüft werden:

- **SIA 260:** ψ-Beiwerte der Lastgruppen (in den Lastgruppen editierbar).
- **SIA 261:** Spektrumsparameter/Ziffern; Baugrundklasse F wird mit Parametern D gerechnet; vertikales Spektrum als 0.7·agd angenommen.
- **SIA 262:** Druckzonenhöhe 0.85·x, Grenze x/d ≤ 0.35, kc = 0.55, cot α = 1.0 (Standard); Durchstanzen nach Näherungsstufe 1 (rs = 0.22·L, ke 0.9/0.7/0.65); mitwirkende Breite wie EN 1992-1-1 5.3.2.1.
- **Stahlbeton-Stützen:** EN 1992-1-1 5.8.8/5.8.9 (Nennkrümmung, λlim, zweiachsig); im SIA-Modus wird dasselbe Verfahren mit SIA-Materialwerten als Näherung zu SIA 262 4.3.7 verwendet, As,min = 0.6 % (SIA 262 5.5.4, zu prüfen).
- **Stahlbeton allgemein:** nicht nachgewiesen werden Rissbreiten, Verformungen im gerissenen Zustand, die Bemessung von Schub- und Durchstanzbewehrung sowie Verankerung/Abstufung. Bewehrungsvorschläge decken das Maximum je Fläche bzw. Stab ab.
- **SIA 263:** Interaktionsformel mit ω-Beiwerten und Ziffernangaben.
- **SIA 265:** Lastdauerbeiwert ηt = 1.0 (anpassbar über die Lastgruppe).

Die Annahmen sind zusätzlich im Kopf der jeweiligen Dateien unter `js/design/` und `js/fem/spectrum.js` dokumentiert.

## Lizenzen

Tragwerk Studio steht unter der MIT-Lizenz (`LICENSE`).

Mitgelieferte Fremdkomponenten:

- three.js © three.js authors, MIT-Lizenz (`vendor/three/LICENSE`).
- Schriften Inter © The Inter Project Authors und JetBrains Mono © The JetBrains Mono Project Authors, SIL Open Font License 1.1 (`vendor/fonts/OFL-*.txt`). Sie werden mit der Seite ausgeliefert, beim Laden geht keine Anfrage an einen Schriften-Dienst.
