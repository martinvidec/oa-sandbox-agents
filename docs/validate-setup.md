# Workflow-DSL: Validierung und Tabellen-Generierung

Der Workflow ist unter [`workflow/`](../workflow/) maschinenlesbar spezifiziert
(Spec: [`specs/dsl-workflow.md`](specs/dsl-workflow.md)):

| Datei | Inhalt | generiert daraus |
|---|---|---|
| [`workflow/roles.yaml`](../workflow/roles.yaml) | Rollen, Tool-Allowlists (AGENTS.md D2), Forbidden-Patterns, Budgets, `merge_allowed` (D1) | Rollen-Tabelle in AGENTS.md |
| [`workflow/states.yaml`](../workflow/states.yaml) | Label-Zustandsmaschine mit Owner je Übergang und Invarianten (`max_review_loops`, `done_requires`) | Label-Tabelle in AGENTS.md |
| [`workflow/rules.yaml`](../workflow/rules.yaml) | Direktiven D1–D8 als prüfbare Invarianten (`on`/`assert`/`check`/`remedy`/`source`) plus die Punkte, die nur Prosa-Konvention sind | — (Begründungsprosa bleibt Handtext) |
| [`workflow/pipeline.yaml`](../workflow/pipeline.yaml) | Pipeline-Schritte mit strukturierten pre-/postconditions, gebunden an Rollen, Zustände, Fakten und Regeln | — |

Zwei Skripte arbeiten darauf:

- [`scripts/validate-workflow.mjs`](../scripts/validate-workflow.mjs) — prüft die DSL
  (Schema, Wildcard-Sicherheitsanalyse der Tool-Sets, Abgleich der D2-Prosa von AGENTS.md gegen
  die Tool-Sets, Zustandsmaschine). **Läuft in CI**
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
- `--selftest` — nur den Selbsttest laufen lassen (er läuft sonst bei jedem Lauf mit); geprüft
  werden Sicherheitsanalyse, Subsumptionsvergleich und D2-Prosa-Abgleich

Die Verbotsformen für den Subsumptionsteil des Selbsttests kommen aus `forbidden_tools` von
`roles.yaml`, nicht aus einer zweiten Liste im Skript: Eine handgepflegte Kopie liefe stumm
auseinander (Review-Befund R2 zu PR #45). `--selftest` liest die Datei dafür direkt mit `js-yaml`;
ist sie nicht lesbar (Modul nicht auflösbar, Datei fehlt oder kaputt) oder erfüllt sie im vollen
Lauf das Schema nicht, laufen die übrigen Fälle weiter und die Subsumptionsfälle werden als
übersprungen (`übsp`) ausgewiesen — mit Warnung, nicht als stilles Durchwinken.

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

**Ebene 1 — Schema** (ajv): `roles.yaml`, `states.yaml`, `rules.yaml` und `pipeline.yaml` gegen
JSON-Schemata im Skript, dazu die
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
| `verbotener-eintrag` | Eintrag steht in `forbidden_tools` | Verbotsform — geprüft per Subsumptionsvergleich: die Form selbst und alles, was unter sie fällt (Tokenfolge bis zum ersten `*`); Modus `match: exact` für Ausnahmen |
| `verbotene-form` | Eintrag fällt unter eine Verbotsform aus `forbidden_tools` | z. B. `Bash(git push origin HEAD:main)` unter `Bash(git push *)` (D1), `Bash(gh api --method PUT …)` unter `Bash(gh api *)` |
| `freigabe-deckt-verbot` | Sammelpattern deckt eine Verbotsform mit ab | z. B. `Bash(gh pr *)` deckt `gh pr merge` (D1) und `gh pr edit` (D2) mit — Tiefe 2 ist für Präfixe mit Verbot darunter hart |
| `d1-merge` | `merge_allowed: true`, `Bash(gh pr merge *)` | Merge nur durch Martin (D1) |

Bei Binaries aus `BLANKET_HARD` (git, gh, node, npm, npx, bash, sh, zsh, env,
python, python3) ist jedes `*` außerhalb der letzten Position ein **Fehler**
(`wildcard-mittig`/`wildcard-eingebettet`) — der `*` matcht beliebigen Text, auch
die nachfolgenden Tokens (AGENTS.md D2, Begründung zu B1). Warnung bleibt `wildcard-mittig`
nur bei Binaries außerhalb dieser Liste. Weitere Warnungen: `inline-zuweisung`
und `sammelpattern-unklar`. Auch `injektionsflag` erkennt die `=`-Schreibweise
(`--git-dir=<wert>` wird vor dem Vergleich am `=` abgeschnitten).

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

**Ebene 2c — D2-Prosa gegen die Tool-Sets** (`AGENTS.md ↔ workflow/roles.yaml`): `render-agents.mjs`
vergleicht nur die beiden Marker-Bereiche (Rollen- und Label-Tabelle). Die Tool-Sets stehen in der
Begründungsprosa von D2 und bleiben Handtext (Spec § 6) — bis hierher konnten Prosa und DSL
auseinanderlaufen, ohne dass CI es merkt (M6 aus PR #45), ausgerechnet beim wertvollsten Teil der
DSL. Der Abgleich läuft deshalb **in beide Richtungen**:

- **Prosa → DSL:** Jede Backtick-eingefasste `Bash(…)`-Form aus dem D2-Abschnitt braucht eine
  Entsprechung in der DSL. In einem Set-Punkt (`- Coder: …`, `- Reviewer: …`, `- Lead (…): …`)
  zählt nur das Set der eigenen Rolle und deren `conditional_tools`; in der Begründungsprosa
  (Punkte wie „Kein blankes `Bash(git *)`") genügt ein Beleg irgendwo in der DSL, weil diese
  Punkte quer über die Rollen argumentieren („steht in allen drei Sets").
- **DSL → Prosa:** Jeder `Bash(…)`-Eintrag aus `allowed_tools` braucht einen Beleg im Set-Punkt
  seiner Rolle. `conditional_tools` sind ausgenommen — sie stehen laut D2 gerade **nicht** im
  Minimal-Set (Sync-Einträge aus D8, D8-Basiswechsel, D7-Vollendung), ihre Begründung steht am
  Eintrag selbst (`reason`).

In der **Begründungsprosa** gilt auch eine **Verbotsform** als Entsprechung: Die Punkte nennen sie
als Gegenbeispiel, belegt wird sie über den Subsumptionsvergleich aus Ebene 2a
(`Bash(git -C worktrees/* status)` fällt unter `Bash(git -C * status)`). Abschnittsgrenze ist der
Aufzählungspunkt `- **D2 …**` bis zum nächsten `- **D3…D8 …**`; Fenced-Code-Blöcke fallen vorher
raus (ein Befehlsbeispiel wie `git fetch origin` im Sync-Block ist keine Freigabeform), und ein
Backtick-Span darf umbrechen — der Whitespace darin wird normalisiert.

**Im Set-Punkt gilt das ausdrücklich nicht.** Eine Form, die unter ein Verbot **ihrer Rolle** fällt
(globale `forbidden_tools` plus die der Rolle) oder in deren `must_not_include` steht, sagt das
Gegenteil eines Belegs. Zählte sie mit, bliebe genau die teuerste Drift folgenlos: Die Prosa listet
`Bash(gh pr merge *)` oder `Bash(gh pr edit *)` im Coder-Set, der Lead gibt es beim Delegieren frei
(M1 zu PR #48). Rollen-eigene Verbote gelten nur für ihre Rolle —
`Bash(node scripts/verify-mermaid.mjs *)` ist im Reviewer-Set verboten und im Coder-Set Pflicht.

Zulässig ist im Set-Punkt nur das **Zitat**: Die Coder- und die Lead-Zeile von D2 verweisen auf
„**Kein blankes `Bash(gh issue edit *)`**" und nennen die Verbotsform dabei wörtlich. Erkannt wird
das über die Querverweis-Konvention von AGENTS.md — ein Verweis nennt die Überschrift des
Zielpunkts wörtlich in „…", also gilt: Steht die Form **ausschließlich** innerhalb eines solchen
Zitat-Spans, ist sie zitiert und kein Set-Eintrag. Grenzen dieser Erkennung:

- Kommt dieselbe Form im Punkt einmal zitiert und einmal frei vor, zählt sie **nicht** als Zitat —
  so steht `Bash(node scripts/verify-mermaid.mjs *)` in der Coder-Zeile zu Recht beides (Eintrag
  und Querverweis) und wird als Eintrag geprüft.
- Erkannt wird nur der Span `„…"` (U+201E bis ASCII-`"`, die Schreibweise in AGENTS.md). Ein
  Querverweis in anderen Anführungszeichen oder ohne schließendes `"` gilt als frei genannt und
  meldet `zitat-nicht-freigabe`; wer eine Verbotsform ohne Zitat-Span nennen muss, trägt sie als
  Ausnahme (`side: agents_md`) mit Begründung in die DSL ein.
- Geprüft wird der Aufzählungspunkt als Ganzes, nicht der Satz: Ein Zitat-Span irgendwo im
  Set-Punkt deckt jedes Vorkommen derselben Form in diesem Punkt.

| Befund | Bedeutung |
|---|---|
| `prosa-ohne-dsl` | Form in D2 genannt, in `roles.yaml` ohne Entsprechung |
| `zitat-nicht-freigabe` | Verbotsform bzw. `must_not_include`-Eintrag im Set-Punkt, nicht als Zitat erkennbar |
| `dsl-ohne-prosa` | `allowed_tools`-Eintrag ohne Beleg im Set-Punkt seiner Rolle |
| `prosa-set-fehlt` / `prosa-set-ohne-d2-set` | `d2_set` und Set-Punkt in AGENTS.md widersprechen sich |
| `prosa-set-doppelt` | zwei Set-Punkte für dieselbe Rolle — welcher gilt, ist nicht entscheidbar |
| `ausnahme-ohne-bezug` | eine Ausnahme, die nichts ausnimmt (s. u.) |
| `d2-abschnitt-fehlt` / `prosa-datei-fehlt` | der Abgleich hat keine Quelle |

**Ausnahmen stehen in der DSL, nicht im Skript** (`d2_prose_check.excluded_entries`), je mit
`entry`, `side` (`agents_md` = in D2 genannt, bewusst ohne DSL-Eintrag; `roles_yaml` =
Allowlist-Eintrag ohne Prosa-Beleg), `directive` und `reason` — eine Ausnahme im Skript wäre eine
stille Ausnahme. Eine Ausnahme, die keine Abweichung mehr abdeckt, ist selbst ein Fehler
(`ausnahme-ohne-bezug`): Sonst bleibt sie stehen, nachdem die Abweichung behoben ist, und deckt
beim nächsten Mal zu viel ab. Derzeit gibt es genau eine — `Bash(git status)` auf Seite
`agents_md`, weil D2 die argumentlose Form ausdrücklich als Gegenbeispiel nennt („nicht nötig und
bläht das Minimal-Set auf").

Aktueller Umfang: **104 abgeglichene Formen** (Textzeile `AGENTS.md ↔ roles.yaml: … D2-Formen
abgeglichen`, JSON-Feld `geprueft.d2_prosa_formen`). Der Selbsttest prüft die Vergleichslogik gegen
eine Miniatur-DSL und ein Miniatur-AGENTS.md statt gegen den echten Stand der Dateien — der ist der
eigentliche Lauf. Jede
Richtung hat mehrere Fälle, die melden müssen, und mehrere, die schweigen müssen (Richtung a:
fehlende Entsprechung, Verbotsform, Form unterhalb einer Verbotsform, `must_not_include` — dagegen
Gegenbeispiel in der Begründungsprosa, Zitat im Set-Punkt, umbrochener Backtick-Span, greifende
Ausnahme; Richtung b entsprechend, beide `side`-Werte der Ausnahmen inklusive); dazu die
Strukturfälle zu `d2_set`, doppeltem Set-Punkt und fehlendem D2-Abschnitt. Ein Fehlalarm wäre hier
so teuer wie ein Durchrutscher, deshalb vergleicht jeder Fall die **vollständige** Befundliste —
ein zusätzlicher Fehlalarm im selben Fall fällt damit auf. `prosa-datei-fehlt` entsteht eine Ebene
darüber beim Lesen der Datei und hat deshalb keinen Selbsttest-Fall.

**Ebene 2d — Regel-Konsistenz** (`workflow/rules.yaml`): jede Regel hat `on`, `assert`, `check`,
`remedy` und `source`; `check`-Quelle kommt aus dem Fakt-Vokabular (`gh_api`, `git_state`,
`process_exit`, `ci_run`); jede Direktive D1–D8 ist entweder durch eine Regel abgedeckt oder als
`documented_convention` mit Begründung markiert (`direktive-ohne-abdeckung`), und Konventionen
verweisen sauber auf die kommende Ebene 3. Jeder `source`-Querverweis nennt eine **fette
Überschrift aus AGENTS.md wörtlich und ohne Satzpunkt** (`ueberschrift-fehlt`,
`ueberschrift-satzpunkt`, `quelldatei-fehlt`) — die Querverweis-Konvention ist damit zum ersten
Mal maschinell geprüft. Ausschließlich beobachtbare Fakten: eine Regel kann ihren `check` nicht
von einem Fakt lösen, dessen Quelle verspricht, sie maschinell zu prüfen
(`fakt-quelle-abweichend`), und der Abgleich, dass `run_aborted`-Regeln wie
`D7_escalate_after_second_abort` eine beobachtbare Zählung brauchen, bevor sie an
`needs-human`-Bedingungen hängen, ist als `documented_convention` geführt — die Abbruch-Zählung
liegt prozessual beim Lead und wird erst mit der Ebene 3 (Runtime-Replay) maschinell prüfbar.
Die Abgrenzung der Review-Schleife von D8 ist ein eigener harter Befund (`d8-review-schleife`)
**mit Gegenrichtung** — eine Nicht-D8-Regel am selben Trigger schweigt.

**Ebene 2e — Pipeline-Konsistenz** (`workflow/pipeline.yaml`): jeder Schritt referenziert nur
existierende Zustände, Labels, Rollen und Fakt-Vokabular (`unbekannte-bedingung`,
`schritt-unerreichbar`); die Bedingungen sind strukturierte Formen (`label_check`,
`actor_check`, `ci_check` — eine pro Eintrag), freie Schlüssel werden gemeldet. Die vier Schritte
bilden von `first` aus eine begehbare Kette.

| Neue Befundarten (Ebene 2d/2e, Auswahl) | Bedeutung |
|---|---|
| `direktive-ohne-abdeckung` | eine Direktive D1–D8 ohne Regel und ohne `documented_convention` |
| `ueberschrift-fehlt` / `ueberschrift-satzpunkt` | `source`-Verweis trifft keine AGENTS.md-Fettung wörtlich / inkludiert den Satzpunkt |
| `fakt-quelle-abweichend` | Regel-`check` ist nicht mit der Quelle des referenzierten Fakts vereinbar |
| `d8-review-schleife` | eine Regel mischt D8 mit der Review-Schleife (AGENTS.md, „**Abgrenzung zur Review-Schleife**") |
| `unbekannte-bedingung` / `schritt-unerreichbar` | Pipeline-Bedingung frei oder Schritt nicht von `first` erreichbar |

> **Doku-Gleichzug.** Wer ein Tool-Set ändert, ändert `roles.yaml` **und** die D2-Prosa im selben
> PR — das war vorher Disziplin und ist jetzt CI. Die Lektion gilt eine Ebene höher weiter und
> mechanisiert ist sie dort **nicht**: Diese Datei beschreibt, was der Validator prüft, und niemand
> vergleicht sie mit dem Skript. Neue Befundarten, Ausnahmen oder Aufrufoptionen gehören deshalb
> in denselben PR wie ihre Implementierung, sonst entsteht genau der Drift wieder, gegen den
> Ebene 2c gebaut ist. (M1 zu PR #49: genau diese Lücke wurde im Stufe-2-PR nachgeholt —
> Ebene 1 um `rules.yaml`/`pipeline.yaml`, Ebene 2d/2e samt Befundtabellen, aktualisierter
> Selbsttest-Beschreibung.)

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
