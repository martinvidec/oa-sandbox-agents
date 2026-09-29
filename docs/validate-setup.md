# Workflow-DSL: Validierung und Tabellen-Generierung

Der Workflow ist unter [`workflow/`](../workflow/) maschinenlesbar spezifiziert
(Spec: [`specs/dsl-workflow.md`](specs/dsl-workflow.md)):

| Datei | Inhalt | generiert daraus |
|---|---|---|
| [`workflow/roles.yaml`](../workflow/roles.yaml) | Rollen, Tool-Allowlists (AGENTS.md D2), Forbidden-Patterns, Budgets, `merge_allowed` (D1) | Rollen-Tabelle in AGENTS.md |
| [`workflow/states.yaml`](../workflow/states.yaml) | Label-Zustandsmaschine mit Owner je Übergang und Invarianten (`max_review_loops`, `done_requires`) | Label-Tabelle in AGENTS.md |

Zwei Skripte arbeiten darauf:

- [`scripts/validate-workflow.mjs`](../scripts/validate-workflow.mjs) — prüft die DSL
  (Schema, Wildcard-Sicherheitsanalyse der Tool-Sets, Zustandsmaschine). **Läuft in CI**
  (`.github/workflows/ci.yml`, Job `workflow-dsl`) und lokal.
- [`scripts/render-agents.mjs`](../scripts/render-agents.mjs) — generiert die beiden Tabellen
  von AGENTS.md aus der DSL und vergleicht sie mit dem eingecheckten Stand. **Läuft ebenfalls in CI.**

## One-time Setup (lokal)

> **Manueller Schritt eines Menschen (Martin), einmal pro Rechner — kein Agenten-Schritt.**
> `npm install` steht in keinem Tool-Set aus AGENTS.md D2 und lädt Pakete aus dem Netz. Kein
> Coder-, Reviewer- oder Lead-Run führt das Setup aus; fehlt es, meldet der Run das
> (`needs-human`) statt es selbst nachzuholen.

`ajv` und `js-yaml` werden **außerhalb des Repos** installiert — dieselbe Konvention wie bei
Playwright ([`verify-setup.md`](verify-setup.md)):

```bash
mkdir -p ~/.cache/oa-validate
cd ~/.cache/oa-validate
npm install ajv js-yaml
```

Voraussetzung: Node.js ≥ 18.

`node_modules/`, `package.json` und `package-lock.json` im Repo-Root sind **nicht gitignored**
(`.gitignore` listet nur `worktrees/`), weshalb das `git add -A` eines Sync- oder WIP-Commits die
ganze Installation einchecken und pushen würde (AGENTS.md D2, „Warum Playwright nicht im Repo-Root
installiert wird"). Die Installation außerhalb des Repos ist deshalb Vorgabe, nicht Geschmacksfrage.
Technisch finden die Skripte die Module auch neben sich oder im Arbeitsverzeichnis — so werden sie
hier aber nicht installiert.

In CI gilt dasselbe: Der Job installiert nach `$RUNNER_TEMP/oa-validate`, nicht ins Checkout.

## Aufruf

Aus dem Repo-Root bzw. Worktree, mit `NODE_PATH` auf die Installation aus dem Setup:

```bash
export NODE_PATH=~/.cache/oa-validate/node_modules
node scripts/validate-workflow.mjs
node scripts/render-agents.mjs --check
```

**`NODE_PATH` wird exportiert, nicht dem Befehl vorangestellt.** `NODE_PATH=… node scripts/…`
beginnt mit der Zuweisung statt mit `node` und passt damit nicht auf eine Freigabe der Form
`Bash(node scripts/validate-workflow.mjs *)`; freigeben müsste man eine Form mit `*` in
Wert-Position, die bestimmen würde, woher das Skript seine Module lädt (AGENTS.md D2, „Warum nicht
inline `NODE_PATH=… node scripts/verify-mermaid.mjs`"). Beim Delegieren setzt der Lead die Variable
im aufrufenden Shell-Prozess, vor `claude -p …`; im Run selbst steht dann nur der nackte
`node`-Aufruf. Die Sicherheitsanalyse des Validators meldet genau diese Inline-Form als Verstoß —
das ist einer ihrer drei harten Fälle.

### validate-workflow.mjs

```
node scripts/validate-workflow.mjs [--root <verzeichnis>] [--json] [--selftest]
```

- `--root` — Repo-Wurzel, Default das Arbeitsverzeichnis
- `--json` — Report als JSON statt als Text (Felder: `ok`, `geprueft`, `selftest`, `errors`, `warnings`)
- `--selftest` — nur den Selbsttest der Sicherheitsanalyse laufen lassen (er läuft sonst bei jedem Lauf mit)

Exit-Code: `0` keine Fehler (Warnungen erlaubt), `1` Fehler gefunden, `2` Setup-, Aufruf- oder
Laufzeitfehler (Module nicht auflösbar, Datei fehlt, YAML kaputt). `1` bedeutet also immer: Die
Prüfung lief durch und hat Befunde.

### render-agents.mjs

```
node scripts/render-agents.mjs [--check|--write|--print] [--root <verzeichnis>]
```

- `--check` (Default) — generiert gegen eingecheckt vergleichen; Abweichung = Exit-Code `1`
- `--write` — die Fragmente zwischen die Marker in AGENTS.md schreiben
- `--print` — die Fragmente auf stdout ausgeben

Die generierten Bereiche in AGENTS.md sind mit HTML-Kommentaren markiert
(`<!-- dsl:roles-table:start -->` … `:end`, `<!-- dsl:label-table:start -->` … `:end`). Alles
außerhalb der Marker — insbesondere die Begründungsprosa der Direktiven — bleibt Handtext und wird
nicht angefasst (Spec § 6). **Quelle ist die DSL:** Wer eine Rolle, ein Tool-Set oder ein Label
ändert, ändert `workflow/*.yaml` und lässt die Tabelle neu schreiben, nicht umgekehrt.

Verglichen wird mit Whitespace-Toleranz (Zellen getrimmt, Trennzeile normalisiert); der Zelltext
selbst muss zeichengenau übereinstimmen.

## Was geprüft wird

**Ebene 1 — Schema** (ajv): `roles.yaml` und `states.yaml` gegen JSON-Schemata im Skript, dazu die
Referenzauflösung: Rollen mit D2-Set haben Allowlist und Budget, Übergangs-Owner sind bekannte
Rollen (bzw. `human`/`any_agent`), `label_table` nennt existierende Zustände.

**Ebene 2a — Wildcard-Sicherheitsanalyse** jeder Freigabeform. Klassifiziert wird die *Form* des
Patterns, nicht die Semantik des Tools (Spec § 8) — unklare Formen sind **Warnungen**, diese Formen
sind **Fehler**:

| Befund | Form | Begründung |
|---|---|---|
| `wert-wildcard` | `NODE_PATH=* node …` | Wildcard in Wert-Position einer Zuweisung; sie bestimmt mit, welcher Code geladen wird |
| `injektionsflag` | `git -C worktrees/* status`, `-c`, `--git-dir`, … | bestimmt Arbeitsverzeichnis, Konfiguration oder ausgeführtes Programm (Blocker B1 aus PR #27) |
| `sammelpattern` | `git *`, `gh *` | blankes Sammelpattern; deckt auch die Formen ab, die D1/D2 verbieten |
| `befehlskette` | `a; b`, `a && b`, `` ` ``, `$(…)` | verkettete Kommandos hängen an einer eigenen Freigabe (D2) |
| `binary-wildcard` | `* status` | matcht beliebige Programme |
| `verbotener-eintrag` | Eintrag steht in `forbidden_tools` | exakte Verbotsform im Set |
| `d1-merge` | `merge_allowed: true`, `Bash(gh pr merge *)` | Merge nur durch Martin (D1) |

Warnungen sind u.a. `wildcard-mittig` (`*` nicht in letzter Position), `wildcard-eingebettet`
(`worktrees/*`), `inline-zuweisung` und `sammelpattern-unklar`.

Die drei historischen Verstoßformen — `-C`-Wildcard (B1), `NODE_PATH=`-Inline-Prefix und blankes
`git *` — sind als Selbsttest hinterlegt und laufen bei **jedem** Lauf mit: Meldet die Analyse
einen davon nicht mehr hart, schlägt die Validierung fehl. Ebenso geprüft wird die Gegenrichtung
(kein Fehlalarm auf `Bash(git status *)`, `Bash(git push -u origin HEAD)`,
`Bash(gh issue edit --add-label *)`, `Bash(node scripts/verify-mermaid.mjs *)` …).

**Ebene 2b — Zustandsmaschine:** jeder Zustand von `initial` aus erreichbar, kein Übergang ohne
Owner, keine Sackgasse, terminale Zustände ohne Ausgang, `done` nur über einen Übergang mit
`owner: human` und den Belegen aus `done_requires` (D1), Schleifenlimit zählbar (markierter
Schleifenübergang plus Ausstieg in denselben Zustand hinein), Label-Tabelle deckt jedes Label
genau einmal ab.

**Ebene 3 — Runtime-Replay** (letzter Zyklus aus beobachtbaren Ereignissen gegen `rules.yaml`)
ist **nicht** Teil dieses MVP (Spec § 5.5) — eigenes Folge-Issue.

## Einsatz in der Pipeline

Beide Prüfungen laufen in CI; für PRs, die `workflow/`, `AGENTS.md` oder die Skripte anfassen, ist
der CI-Beleg damit zugleich der DSL-Beleg. Ein lokaler Lauf vor dem Push spart die Schleife:

```
Validierungs-Beleg: node scripts/validate-workflow.mjs, exit 0, 0 Fehler / 0 Warnungen
                    node scripts/render-agents.mjs --check, exit 0
```

Anders als [`verify-mermaid.mjs`](../scripts/verify-mermaid.mjs) braucht das keinen eigenen
PR-Kommentar — die Prüfung ist in CI und damit im Checks-Reiter belegt.
