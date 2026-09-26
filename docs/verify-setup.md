# Visuelle Diagramm-Verifikation mit Playwright

Mermaid-Diagramme (z.B. in [`workflow-hochglanz.html`](workflow-hochglanz.html)) lassen sich
nicht am Diff prüfen: Ob Nodes, Kantenlabels oder Cluster-Titel überlappen, zeigt erst der
gerenderte Browser-Stand. Dafür gibt es [`scripts/verify-mermaid.mjs`](../scripts/verify-mermaid.mjs).
Es läuft **lokal, nicht in CI**.

## One-time Setup

> **Manueller Schritt eines Menschen (Martin), einmal pro Rechner — kein Agenten-Schritt.**
> `npm install` und `npx playwright install` stehen in keinem Tool-Set aus AGENTS.md D2 und laden
> Pakete bzw. einen Browser aus dem Netz. Kein Coder-, Reviewer- oder Lead-Run führt das Setup aus;
> fehlt es, meldet der Run das (`needs-human`) statt es selbst nachzuholen.

Playwright wird **außerhalb des Repos** installiert, damit weder `node_modules/` noch eine
`package.json` im Worktree landen (beides ist nicht gitignored):

```bash
mkdir -p ~/.cache/oa-verify
cd ~/.cache/oa-verify
npm install playwright
npx playwright install chromium
```

Voraussetzung: Node.js ≥ 18. `npx playwright install chromium` lädt den Browser nach
`~/Library/Caches/ms-playwright` (macOS) bzw. `~/.cache/ms-playwright` (Linux) — einmal pro Rechner.

Technisch findet das Skript Playwright auch im Repo-Root oder im Arbeitsverzeichnis — **so wird es
hier aber nicht installiert.** `.gitignore` listet nur `worktrees/`; `node_modules/`, `package.json`
und `package-lock.json` im Repo-Root sind getrackt, und das `git add -A` eines Sync- oder
WIP-Commits würde die ganze Installation einchecken und pushen (AGENTS.md D2, „Warum Playwright
nicht im Repo-Root installiert wird"). Die Installation außerhalb des Repos ist deshalb Vorgabe,
nicht Geschmacksfrage.

## Aufruf

Aus dem Repo-Root bzw. Worktree, mit `NODE_PATH` auf die Installation aus dem Setup:

```bash
export NODE_PATH=~/.cache/oa-verify/node_modules
node scripts/verify-mermaid.mjs docs/workflow-hochglanz.html
```

- Erstes Argument: HTML-Datei, Default `docs/workflow-hochglanz.html`. **In Agenten-Runs wird sie
  trotzdem immer mitgegeben** — der freigegebene Eintrag `Bash(node scripts/verify-mermaid.mjs *)`
  matcht den argumentlosen Aufruf nicht
  (AGENTS.md D2, „Verify-Aufruf: `Bash(node scripts/verify-mermaid.mjs *)`, `NODE_PATH` aus der Umgebung").
- `--out <verzeichnis>`: Ziel für Screenshots und Report, Default `<tmpdir>/verify-mermaid`
  (bewusst außerhalb des Repos, und dabei bleibt es — kein `--out` in den Worktree). Der
  Default-Ordner wird bei jedem Start geleert, damit keine Screenshots eines früheren Laufs im
  Ergebnis liegen; ein per `--out` angegebenes Verzeichnis bleibt unangetastet.

```bash
node scripts/verify-mermaid.mjs docs/andere-seite.html --out /tmp/verify-42
```

**`NODE_PATH` wird exportiert, nicht dem Befehl vorangestellt.** `NODE_PATH=… node scripts/…`
beginnt mit der Zuweisung statt mit `node` und passt damit nicht mehr auf den freigegebenen
Eintrag; freigeben müsste man eine Form mit `*` in Wert-Position, die bestimmen würde, woher das
Skript sein `playwright` lädt (Begründung: AGENTS.md D2,
„Warum nicht inline `NODE_PATH=… node scripts/verify-mermaid.mjs`"). Beim Delegieren setzt der
Lead die Variable im aufrufenden Shell-Prozess, vor `claude -p …`; im Run selbst steht dann nur der
nackte `node`-Aufruf.

Die Seite lädt Mermaid ggf. von einem CDN — der Lauf braucht dann Netzzugang.

## Was geprüft wird

Je `.mermaid`-Block:

| Prüfung | Report-Feld |
|---|---|
| SVG gerendert | `svg` |
| Mermaid-Error-Boxen (Syntaxfehler; eine Box je Fehler) | `errorBoxes` |
| Node × Node überlappt | `nodeOverlaps` |
| Kantenlabel × Node überlappt | `labelNodeOverlaps` |
| Kantenlabel × Kantenlabel überlappt | `labelLabelOverlaps` |
| Cluster-Titel × Node überlappt | `clusterTitleOverlaps` |
| Label größer als sein Rahmen (abgeschnitten) | `clippedLabels` |

Geprüft wird erst, wenn jeder `.mermaid`-Block ein SVG mit Inhalt hat (höchstens 30 s, sonst
Befund „Timeout"). Kollisionen stammen aus den Bounding-Boxen (`getBoundingClientRect`, 1 px Toleranz); jeder Eintrag
nennt das Überlappungsmaß als Breite × Höhe der Schnittfläche. Dazu kommen Konsolenfehler der Seite.

## Ausgabe

- `verify-diagram-<n>.png` — je `.mermaid`-Block; `<n>` entspricht `diagram` im Report
- `verify-fullpage.png` — ganze Seite
- `verify-report.json` — derselbe JSON-Report, der auch auf stdout geht; `findings` fasst alle Befunde zusammen

Exit-Code: `0` keine Befunde, `1` Befunde, `2` Setup-, Aufruf- oder Laufzeitfehler
(Playwright/Chromium fehlt, Datei nicht gefunden, Seite lädt nicht, Screenshot scheitert).
`1` bedeutet also immer: Die Prüfung lief durch und hat Befunde.

## Einsatz in der Pipeline

Diagramm-PRs belegen die Verifikation vor `agent:review` mit einem **neuen PR-Kommentar, der den
Report zitiert** — Exit-Code, `ok` und die vollständige `findings`-Liste, dazu die geprüfte
HTML-Datei und den Pfad des Ausgabeverzeichnisses. Coder-Pflicht, siehe
[`workflow.md`](workflow.md), Zuständigkeiten pro Schritt, „Diagramm-Beleg am PR".

```
Verify-Beleg: docs/workflow-hochglanz.html, exit 0, "ok": true, "findings": []
Screenshots lokal: /var/folders/…/verify-mermaid/ (verify-diagram-1.png, verify-fullpage.png)
```

### Die Screenshots bleiben lokal — Begründung

Der Report ist der Beleg, die PNGs sind Ergänzung für den, der lokal hinsieht. Drei Wege standen
zur Wahl:

| Weg | Bewertung |
|---|---|
| **(a) Report-JSON/Exit-Code als Beleg, Screenshots lokal** | **gewählt** |
| (b) Martin hängt die PNGs im Web-UI an | als Ergänzung möglich, taugt aber nicht als Pflichtschritt: Es ist ein Human-Schritt mitten in der Coder-Pflicht und würde `agent:review` an Martins Verfügbarkeit hängen |
| (c) Upload über Release/Artifact (`gh api`, `gh release upload`) | verworfen |

- **`gh pr comment` kann keine Dateien anhängen.** Das Hochladen von Bildern an einen Kommentar ist
  ein Web-UI-Endpunkt, kein REST-API-Aufruf — `gh` hat dafür kein Flag. Ein Agent kann PNGs also
  gar nicht an den PR bringen, ohne einen anderen Speicherort dazwischenzuschalten.
- **Gegen (c) spricht die Freigabe, nicht der Aufwand.** Ein Upload bräuchte `Bash(gh api *)` oder
  `Bash(gh release *)` im Coder-Set. `Bash(gh api *)` ist ein Universal-Schreibrecht auf die
  GitHub-API — damit ginge auch `gh api --method PUT /repos/{owner}/{repo}/pulls/{n}/merge`, also
  genau der Merge, den D1 Agenten verbietet. Der Push-Guard-Gedanke aus D2 („Kein blankes
  `Bash(git *)`") gilt hier genauso: Ein Eintrag, der ein Verbot aushebelt, kommt nicht ins Set,
  auch wenn er für den eigentlichen Zweck bequem wäre. Release-Assets als Bild-Hoster wären
  zusätzlich eigene Infrastruktur (D6).
- **Der Report trägt den Beleg inhaltlich.** Die Prüfungen aus „Was geprüft wird" sind
  maschinenlesbar und vollständig im JSON: Überlappungen mit Maß in Pixeln, Error-Boxen,
  abgeschnittene Labels, Konsolenfehler. Ein Screenshot zeigt einem Menschen dasselbe, aber
  unschärfer — er belegt nicht, *dass* geprüft wurde, sondern lädt zum Nachschauen ein.
  Der Exit-Code trennt die Fälle eindeutig: `1` heißt „geprüft, mit Befunden", `2` heißt „nicht
  geprüft" (Setup-/Laufzeitfehler) und ist damit **kein** Beleg.
- **Wer die Bilder sehen will, kommt an sie.** Sie liegen im Ausgabeverzeichnis, das der Beleg-
  Kommentar nennt; der Lauf ist auf demselben Rechner reproduzierbar (`## Aufruf`). Martin kann
  PNGs bei Bedarf manuell an den PR hängen — freiwillig, nicht als Voraussetzung für
  `agent:review`.
- **Der Reviewer prüft den Kommentar, nicht die Bilder.** `node scripts/verify-mermaid.mjs` steht
  nicht im Reviewer-Set (AGENTS.md D2, „Kein Eintrag im Reviewer-Set"). Fehlt der Beleg-Kommentar
  oder nennt er Befunde bzw. Exit-Code `1`/`2`, ist das ein Review-Befund
  ([`workflow.md`](workflow.md), Review-Schleife).
