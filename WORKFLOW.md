# WORKFLOW.md — der aktive Workflow

> Generiert aus der aktiven DSL-Instanz (`workflow/registry.yaml` → `workflow/claude-pipeline/*.yaml`)
> mit `node scripts/render-workflow.mjs --write` bzw. `--write-workflow-only`; CI prüft generiert
> gegen eingecheckt. Änderungen an Rollen, Tool-Sets, Budgets, Labels oder Pipeline-Schritten
> gehören in die DSL, nicht in diese Datei ([`docs/validate-setup.md`](docs/validate-setup.md)).
> Kurzübersicht und die Begründungsprosa der Direktiven (D1–D8) stehen in [`AGENTS.md`](AGENTS.md).

## Rollen

<!-- dsl:roles-table:start -->
| Rolle | Realisierung | Scope |
|---|---|---|
| **Orchestrator/Lead** | Hermes default-Profil (Telegram) | Nimmt Aufträge, legt Issues an, delegiert, fasst zusammen. Schreibt KEINEN Code. |
| **Researcher** | Hermes @research / @deep-research | Recherche, Analyse, Spec-Vorarbeit → `agentic-workflow/` bzw. `docs/` |
| **Coder** | Claude Code (headless, 1 Worktree pro Issue) | Implementiert Issue in eigenem Worktree, Branch, Commits, Draft-PR |
| **Reviewer** | Claude Code, 2. Run mit sauberem Kontext | Reviewt PR gegen AGENTS.md + Akzeptanzkriterien, Befunde als PR-Kommentare |
| **Tester** | Claude Code / oa-playwright-cli (nach Bedarf) | E2E/QA-Aufgaben in eigenem Worktree |
<!-- dsl:roles-table:end -->

## Labels

<!-- dsl:label-table:start -->
| Label | wird gesetzt von | Auslöser |
|---|---|---|
| `agent:ready` | Lead (bzw. Issue-Template automatisch) | Issue ist briefing-fertig |
| `agent:in-progress` | Lead beim Delegieren | Coder-Run startet |
| `agent:review` | Coder, sobald Draft-PR offen und CI grün (Lead, wenn er nach D7 vollendet) | PR wartet auf Reviewer-Run |
| `needs-human` / `blocked` | jeder Agent, der nicht weiterkommt | Rückfrage an Martin nötig / externe Blockade |
<!-- dsl:label-table:end -->

## Übergänge und Invarianten

<!-- dsl:transitions-table:start -->
| Übergang | von → nach | Owner | Auslöser | requires | Beleg |
|---|---|---|---|---|---|
| `delegate` | `ready` → `in_progress` | `lead` | Lead delegiert den Coder-Run (eigener Worktree, `--max-turns`) | — | `D2` |
| `hand_to_review` | `in_progress` → `review` | `coder` (Fallback: `lead`) | Draft-PR offen UND CI grün als PR-Kommentar belegt | `draft_pr_open`, `ci_green` | `D4` |
| `review_finding_fix` | `review` → `in_progress` | `lead` | Review-Befunde: Lead delegiert den Fix-Run im selben Worktree/Branch (Coder) | — | docs/workflow.md — Review-Schleife, Schritt 4 |
| `merge` | `review` → `done` | `human` | Martin merged den PR bei grünem CI | `merged`, `ci_green` | `D1` |
| `escalate_ready` | `ready` → `needs_human` | `any_agent` | Briefing unklar, Rückfrage an Martin nötig | — | AGENTS.md — Arbeitsaufträge (Pipeline): Labels mit genau einem Owner je Übergang; Semantik definiert in dieser Datei (label_state.ausloeser) |
| `escalate_in_progress` | `in_progress` → `needs_human` | `any_agent` | Run bricht ab (Fix-Run, Sync-Run mitten im Merge) oder kommt nicht weiter | — | `D7` |
| `escalate_review` | `review` → `needs_human` | `any_agent` | Mehr als `max_review_loops` Schleifen oder Reviewer kommt nicht weiter | — | docs/workflow.md — Review-Schleife, Schritt 5: maximal zwei Schleifen, danach `needs-human` |
| `block_in_progress` | `in_progress` → `blocked` | `any_agent` | Externe Blockade während des Runs | — | AGENTS.md — Arbeitsaufträge (Pipeline): Labels mit genau einem Owner je Übergang; Semantik definiert in dieser Datei (label_state.ausloeser) |
| `block_review` | `review` → `blocked` | `any_agent` | Externe Blockade während der Review-Schleife | — | AGENTS.md — Arbeitsaufträge (Pipeline): Labels mit genau einem Owner je Übergang; Semantik definiert in dieser Datei (label_state.ausloeser) |
| `resume_after_human` | `needs_human` → `in_progress` | `lead` | Martin hat entschieden; der Lead delegiert den nächsten Run | `human_decision` | `D7` |
| `resume_after_block` | `blocked` → `in_progress` | `lead` | Blockade aufgelöst; der Lead delegiert den nächsten Run | `blocker_resolved` | AGENTS.md — Arbeitsaufträge (Pipeline): Labels mit genau einem Owner je Übergang; Semantik definiert in dieser Datei (label_state.ausloeser) |

Invarianten:

- `max_review_loops`: 2 (Schleifenübergang `review_finding_fix`, Ausstieg `escalate_review`)
- `done_state`: `done`, nur über Übergänge mit Owner `human`, requires: `merged`, `ci_green`
<!-- dsl:transitions-table:end -->

## Regeln und Konventionen

<!-- dsl:rules-table:start -->
| Regel | Direktive | on | assert | check | remedy |
|---|---|---|---|---|---|
| `DSL_self_validation` | — | `workflow_change` | `dsl_validation_exit_zero` is_true | `ci_run` | Befunde beheben und neu pushen. Kein `agent:review`, solange der Job rot ist — der CI-Beleg ist zugleich der DSL-Beleg. |
| `D1_merge_by_human` | D1 | `pr_merged` | `pr_merge_actor_role` equals = human | `gh_api` | Ein Agenten-Merge lässt sich nicht zurücknehmen: Workflow-Bug-Issue anlegen, `needs-human` am betroffenen Issue setzen, Rückfrage an Martin. |
| `D1_no_merge_tool` | D1 | `workflow_change` | `no_merge_tool_in_any_set` is_true | `process_exit` | `gh pr merge` aus dem Set entfernen bzw. `merge_allowed: false` setzen — der Merge gehört Martin, nicht einem Tool-Set. |
| `D2_delegation_budget` | D2 | `workflow_change` | `delegated_roles_have_budget` is_true | `process_exit` | `budget.max_turns` samt Quelle an der Rolle nachtragen — eine Delegation ohne `--max-turns` gibt es nicht. |
| `D2_allowlist_form` | D2 | `workflow_change` | `tool_allowlist_analysis_clean` is_true | `process_exit` | Freigabeform auf die exakte Form zurückschneiden (Push-Guard `git push -u origin HEAD`, kein `-C`, kein Sammelpattern) — oder den Eintrag streichen. |
| `D3_one_issue_per_pr` | D3 | `pr_opened` | `pr_closes_exactly_one_issue` is_true | `gh_api` | Scope-Ausweitung bekommt ein eigenes Issue und einen eigenen PR; der PR-Body nennt genau ein `Closes #N`. |
| `D4_review_label_needs_evidence` | D4 | `review_label_set` | all_of: `pr_is_draft_at_review` is_true ∧ `ci_green_evidence_comment` is_true | `gh_api` | CI-Beleg als **neuen** PR-Kommentar nachreichen (`gh pr comment <n> --body "CI grün: Run <id>, conclusion success"`), den PR-Body nicht anfassen; bis dahin `agent:review` zurücknehmen. |
| `D5_nothing_stays_local` | D5 | `run_end` | all_of: `worktree_clean_after_run` is_true ∧ `head_pushed_to_origin` is_true | `git_state` | Ergebnis committen UND pushen (`git push -u origin HEAD`; Specs und Protokolle nach `docs/`); nichts bleibt nur im Worktree und nichts nur im lokalen Branch liegen. |
| `D6_checks_stay_on_github_and_local` | D6 | `workflow_change` | `check_sources_only_github_and_local` is_true | `process_exit` | Prüfung auf `gh`, `git`, ein Skript aus `scripts/` oder einen CI-Job zurückführen — oder sie streichen. Eigene Dienste gibt es nicht. |
| `D7_no_run_in_merging_worktree` | D7 | `run_start` | `worktree_merge_in_progress` is_false | `git_state` | Keinen Run starten, nichts committen (ein `git add -A` checkte Konfliktmarker ein): `needs-human` setzen und den Zustand in der Rückfrage an Martin benennen. |
| `D8_worktree_base_is_pr_branch` | D8 | `worktree_create` | `branch_contains_declared_base` is_true | `git_state` | Worktree von `origin/<pr-branch>` neu anlegen (die Basis steht in den Agent-Hinweisen des Issues); den Vorgänger-Stand nicht nachkopieren — genau daran scheiterte #11. |
| `D8_sync_before_compare` | D8 | `predecessor_merged` | `dependent_branch_contains_main` is_true | `git_state` | Sync-Run im selben Worktree delegieren (`git fetch origin`, `git merge origin/main`, `git push -u origin HEAD`); vorher läuft kein Vergleich und keine inhaltliche Nachbesserung. |
| `cleanup_after_merge` | — | `pr_merged` | all_of: `worktree_removed` is_true ∧ `local_branch_absent` is_true | `git_state` | Vom Repo-Root aufräumen, jeden Befehl einzeln: `git checkout main`, `git pull`, `git worktree remove worktrees/<issue-nr>-<slug>`, `git worktree prune`, `git branch -D <präfix>/<issue-nr>-<slug>` — davor `gh pr view <n> --json state,mergedAt` als Merge-Beleg, und im Zuge des Merge-Replys statt als nachgeschobener Run (sonst läuft die Freigabe-Rückfrage in den Timeout). |

Dokumentierte Konventionen (bewusst keine Regel mit weichem `assert`):

- `D2_status_long_not_short` (D2): `git status --long` statt `--short`/`--porcelain` — nur `--long` zeigt den laufenden Merge, auf den D7 und D8 prüfen. — *nicht prüfbar:* Die Ausgabeform eines Befehls innerhalb eines headless-Runs hinterlässt kein Artefakt in Repo oder GitHub. Sichtbar wäre sie erst im Session-Log — das ist Ebene 3 (Runtime-Replay, Spec § 5.5) und gehört nicht in dieses MVP.
- `D2_single_commands` (D2): In headless-Runs werden Shell-Befehle einzeln abgesetzt; verkettete Kommandos (`a; b`) lösen eine eigene Freigabe aus. — *nicht prüfbar:* Betrifft die Aufrufe innerhalb eines Runs, nicht sein Ergebnis. Die Freigabe-PATTERN prüft `D2_allowlist_form` (Befund `befehlskette`), den tatsächlichen Aufruf erst Ebene 3.
- `D2_verify_out_outside_worktree` (D2): `--out` von `verify-mermaid.mjs` zeigt nie in den Worktree; Default ist `<tmpdir>/verify-mermaid`. — *nicht prüfbar:* Ein Ziel außerhalb des Repos hinterlässt dort definitionsgemäß nichts Beobachtbares. Nur der Fehlgriff fiele auf — als eingecheckte Screenshots, und die fängt `D5_nothing_stays_local` erst, wenn sie wirklich committet wurden.
- `D7_escalate_after_second_abort` (D7): Nach dem Abbruch des Fix-Runs — bzw. des zweiten Sync-Versuchs — wird kein weiterer Run delegiert, sondern `needs-human` gesetzt. — *nicht prüfbar:* Die Konvention hängt an einer Zählung („Zählung — höchstens zwei Sync-Versuche pro Sync-Anlass"), und die ist nicht beobachtbar: `gh issue view <n> --json labels` zeigt, OB `needs-human` steht, nicht, der wievielte Abbruch gerade vorliegt. Als Regel am Ereignis „Run bricht ab" formuliert war sie falsch verdrahtet und ist deshalb hier gelandet (Review-Befund M2 zu PR #49): Das Ereignis feuert bei JEDEM Abbruch, nach dem ersten verlangt D7 aber gerade keinen `needs-human`, sondern einen Fix-Run bzw. genau einen erneuten Sync-Run (D8, „Sync-Run bricht ab, nicht mitten im Merge") — die Regel hätte den korrekten Ablauf als Verstoß gemeldet. Die Zählung liegt prozessual beim Lead und wird erst mit dem Runtime-Replay über die Run-Historie prüfbar (Ebene 3, Spec § 5.5).
- `D3_no_scope_creep` (D3): Keine Scope-Ausweitung ohne neues Issue — ein PR setzt genau das um, was die Akzeptanzkriterien seines Issues verlangen. — *nicht prüfbar:* Ob ein Diff über den Scope hinausgeht, ist eine inhaltliche Beurteilung gegen den Issue-Text. Maschinell prüfbar ist nur die Zählung (`D3_one_issue_per_pr`: genau ein `Closes #N`); den Rest prüft der Reviewer-Run.
- `D4_pr_body_not_maintained` (D4): Der PR-Body ist der Stand bei `gh pr create` und wird nicht nachgepflegt; Belege kommen als neue PR-Kommentare. — *nicht prüfbar:* Eine Body-Änderung wäre nur an der Bearbeitungshistorie erkennbar. `gh pr view --json body` liefert allein den aktuellen Stand; an die Historie käme man über `gh api` — und `Bash(gh api *)` ist als Universal-Schreibrecht verboten (D1). Den Riegel setzt deshalb das Tool-Set: `gh pr edit` steht in keinem der drei Sets.
- `cleanup_remote_branch_by_setting`: Den Remote-Branch löscht der Merge selbst, sofern die Repo-Einstellung „Automatically delete head branches" (`delete_branch_on_merge`) aktiv ist. Ihre Aktivierung ist ein einmaliger Admin-Schritt Martins; kein Agent versucht sie. — *nicht prüfbar:* Zwei voneinander unabhängige Gründe. Erstens ist die Löschung eine Nebenwirkung des Merges, die niemand ausführt: Es gibt keinen Akteur, der sie versäumen und nachbessern könnte — bleibt sie aus, ist die Einstellung aus, und das ist ein Admin-Schritt (docs/validate-setup.md, „One-time Setup (GitHub-Repo): `delete_branch_on_merge`"), kein Agenten-Befund. Zweitens ist sie mit keinem Tool-Set ablesbar: `gh api repos/{owner}/{repo}` nennt das Feld, aber `Bash(gh api *)` ist als Universal-Schreibrecht verboten (D1); `gh pr view <n> --json headRefName` liefert nur den Namen des Branches, nicht seine Existenz; und ein lokaler Blick über `git branch -r` hinge an einem `git fetch --prune`, das im Lead-Set nicht steht — ein veralteter Remote-Ref antwortete falsch. Ein `assert` darüber wäre also genau die Regel, die nur so tut, als prüfe sie etwas.
- `D8_review_loop_is_not_d8` (D8): Review-Befunde an einem offenen PR sind kein D8-Fall: Sie werden im selben Worktree/Branch nachgebessert — kein neues Issue, kein neuer PR. — *nicht prüfbar:* Es ist eine Abgrenzung, keine Invariante: Sie sagt, wann D8 NICHT greift. Ihre maschinelle Entsprechung ist die Zustandsmaschine (`review_finding_fix` in workflow/states.yaml, Owner Lead, `loop: true`) — und der Validator-Befund `d8-review-schleife`, der jede D8-Regel am Trigger `review_finding` meldet.
<!-- dsl:rules-table:end -->

## Pipeline-Schritte

<!-- dsl:pipeline-steps:start -->
| Schritt | Akteur | Ausführung | Zustand | Beschreibung | preconditions | postconditions | rules | next |
|---|---|---|---|---|---|---|---|---|
| `worktree_create` — Worktree anlegen | `lead` | `repo-root` | `in_progress` → `in_progress` | 1 Worktree pro Coding-Aufgabe, Branch `feat\|fix\|docs/<issue-nr>-<slug>`, Basis `origin/main` — außer das Issue baut auf einem offenen PR auf (D8). | actor_check: `lead`; label_check: `in_progress` gesetzt | fact_check: `branch_contains_declared_base` = true | `D8_worktree_base_is_pr_branch` | `coder_run` |
| `coder_run` — Coder-Run | `coder` | delegiert, `worktree` | `in_progress` → `review` | Implementierung im Worktree, Commits, `git push -u origin HEAD`, Draft-PR mit `Closes #N`, CI-Beleg als PR-Kommentar, dann `agent:review`. | actor_check: `coder`; label_check: `in_progress` gesetzt; fact_check: `worktree_merge_in_progress` = false | fact_check: `draft_pr_open` = true; fact_check: `pr_closes_exactly_one_issue` = true; ci_check: `success`; fact_check: `ci_green_evidence_comment` = true; fact_check: `worktree_clean_after_run` = true; label_check: `review` gesetzt | `D7_no_run_in_merging_worktree`, `D3_one_issue_per_pr`, `D4_review_label_needs_evidence`, `D5_nothing_stays_local`, `D8_sync_before_compare` | `review_run` |
| `review_run` — Reviewer-Run | `reviewer` | delegiert, `worktree` | `review` → `review` | Zweiter Claude-Code-Run mit sauberem Kontext, prüft den PR-Diff gegen AGENTS.md (D3, D4) und die Akzeptanzkriterien; Befunde als PR-Kommentare, kein Edit am PR-Code. | actor_check: `reviewer`; label_check: `review` gesetzt; fact_check: `pr_is_draft_at_review` = true; ci_check: `success` | fact_check: `review_comment_present` = true | `D8_sync_before_compare` | `merge` |
| `merge` — Merge | **Martin** | `n/a` | `review` → `done` | Martin merged bei vollständig grünem CI — Human-in-the-Loop, keine Ausnahme (D1). `Closes #N` schließt das Issue. | actor_check: `human`; label_check: `review` gesetzt; ci_check: `success` | fact_check: `merged` = true | `D1_merge_by_human` | `cleanup` |
| `cleanup` — Cleanup nach dem Merge | `lead` | `repo-root` | `done` → `done` | Vom Repo-Root, Befehle einzeln: `git checkout main`, `git pull`, `git worktree remove worktrees/<issue-nr>-<slug>`, `git worktree prune`, `git branch -D <präfix>/<issue-nr>-<slug>` — nach belegtem Merge (`gh pr view <n> --json state,mergedAt`). | actor_check: `lead`; fact_check: `merged` = true | fact_check: `worktree_removed` = true; fact_check: `local_branch_absent` = true | `cleanup_after_merge` | — |
<!-- dsl:pipeline-steps:end -->
