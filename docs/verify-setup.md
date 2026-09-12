# Visuelle Diagramm-Verifikation mit Playwright

Mermaid-Diagramme (z.B. in [`workflow-hochglanz.html`](workflow-hochglanz.html)) lassen sich
nicht am Diff prüfen: Ob Nodes, Kantenlabels oder Cluster-Titel überlappen, zeigt erst der
gerenderte Browser-Stand. Dafür gibt es [`scripts/verify-mermaid.mjs`](../scripts/verify-mermaid.mjs).
Es läuft **lokal, nicht in CI**.

## One-time Setup

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

Alternativ findet das Skript Playwright auch, wenn es im Repo-Root oder im Arbeitsverzeichnis
installiert ist; dann `node_modules/`, `package.json` und `package-lock.json` **nicht committen**.

## Aufruf

Aus dem Repo-Root bzw. Worktree:

```bash
NODE_PATH=~/.cache/oa-verify/node_modules node scripts/verify-mermaid.mjs
```

- Erstes Argument: HTML-Datei, Default `docs/workflow-hochglanz.html`.
- `--out <verzeichnis>`: Ziel für Screenshots und Report, Default `<tmpdir>/verify-mermaid`
  (bewusst außerhalb des Repos).

```bash
NODE_PATH=~/.cache/oa-verify/node_modules node scripts/verify-mermaid.mjs docs/andere-seite.html --out /tmp/verify-42
```

Die Seite lädt Mermaid ggf. von einem CDN — der Lauf braucht dann Netzzugang.

## Was geprüft wird

Je `.mermaid`-Block:

| Prüfung | Report-Feld |
|---|---|
| SVG gerendert | `svg` |
| Mermaid-Error-Boxen (Syntaxfehler) | `errorBoxes` |
| Node × Node überlappt | `nodeOverlaps` |
| Kantenlabel × Node überlappt | `labelNodeOverlaps` |
| Kantenlabel × Kantenlabel überlappt | `labelLabelOverlaps` |
| Cluster-Titel × Node überlappt | `clusterTitleOverlaps` |
| Label größer als sein Rahmen (abgeschnitten) | `clippedLabels` |

Kollisionen stammen aus den Bounding-Boxen (`getBoundingClientRect`, 1 px Toleranz); jeder Eintrag
nennt das Überlappungsmaß als Breite × Höhe der Schnittfläche. Dazu kommen Konsolenfehler der Seite.

## Ausgabe

- `verify-diagram-<n>.png` — je Diagramm (`.diagram-container`, sonst der `.mermaid`-Block)
- `verify-fullpage.png` — ganze Seite
- `verify-report.json` — derselbe JSON-Report, der auch auf stdout geht; `findings` fasst alle Befunde zusammen

Exit-Code: `0` keine Befunde, `1` Befunde, `2` Setup- oder Aufruffehler (Playwright/Chromium fehlt,
Datei nicht gefunden).

## Einsatz in der Pipeline

Diagramm-PRs belegen die Verifikation mit Screenshots im PR-Kommentar — siehe
[`workflow.md`](workflow.md), Review-Schleife.
