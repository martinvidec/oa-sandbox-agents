# AGENTS.md — Agenten-Interface

> Pflichtlektüre für JEDEN Agenten (Claude Code, Hermes-Profile, Copilot, ...), der in diesem Repo arbeitet. Dies ist der zentrale Contract zwischen Repo und Agent.

## Rollen

| Rolle | Realisierung | Scope |
|---|---|---|
| **Orchestrator/Lead** | Hermes default-Profil (Telegram) | Nimmt Aufträge, legt Issues an, delegiert, fasst zusammen. Schreibt KEINEN Code. |
| **Researcher** | Hermes @research / @deep-research | Recherche, Analyse, Spec-Vorarbeit → `agentic-workflow/` bzw. `docs/` |
| **Coder** | Claude Code (headless, 1 Worktree pro Issue) | Implementiert Issue in eigenem Worktree, Branch, Commits, Draft-PR |
| **Reviewer** | Claude Code, 2. Run mit sauberem Kontext | Reviewt PR gegen AGENTS.md + Akzeptanzkriterien, Befunde als PR-Kommentare |
| **Tester** | Claude Code / oa-playwright-cli (nach Bedarf) | E2E/QA-Aufgaben in eigenem Worktree |

## Arbeitsaufträge (Pipeline)

Auftrag (Martin, Telegram oder Issue) → ggf. Spec (`docs/specs/`) → **GitHub Issue** (Template, Akzeptanzkriterien, `agent:ready`) → Lead delegiert (`agent:in-progress`) → Coder im eigenen Worktree → Draft-PR (`Closes #N`) → CI grün → `agent:review` (durch den Coder; bei D7: Lead) → Reviewer-Run → Lead hebt Draft-Status auf → **Merge nur durch Martin** bei grünem CI.

Labels — jeder Übergang hat genau einen Owner, sonst bleiben abgebrochene Runs falsch etikettiert liegen:

| Label | wird gesetzt von | Auslöser |
|---|---|---|
| `agent:ready` | Lead (bzw. Issue-Template automatisch) | Issue ist briefing-fertig |
| `agent:in-progress` | Lead beim Delegieren | Coder-Run startet |
| `agent:review` | Coder, sobald Draft-PR offen und CI grün (Lead, wenn er nach D7 vollendet) | PR wartet auf Reviewer-Run |
| `needs-human` / `blocked` | jeder Agent, der nicht weiterkommt | Rückfrage an Martin nötig / externe Blockade |

Nach dem Merge räumt `Closes #N` das Issue selbst ab; Labels müssen dann nicht mehr nachgezogen werden.

## Worktree-Konvention (PFLICHT bei paralleler Arbeit)

1 Worktree pro Coding-Aufgabe, nie zwei Agenten im selben Verzeichnis:

```bash
# im Repo-Root:
git worktree add worktrees/<issue-nr>-<slug> -b feat/<issue-nr>-<slug> origin/main
cd worktrees/<issue-nr>-<slug>
# ... arbeiten, committen ...
git push -u origin HEAD        # PFLICHT-Form, siehe Warnung unten
gh pr create --draft           # Body: Closes #N + Akzeptanzkriterien
```

Aufräumen erst **nach dem Merge**, und zwar vom Repo-Root aus (ein Worktree kann sich
nicht selbst entfernen). **Owner: Lead** — der Coder-Run ist mit dem PR beendet und läuft
zum Merge-Zeitpunkt nicht mehr. Jeder Befehl einzeln, nie verkettet (siehe D2):

```bash
# Arbeitsverzeichnis: <repo-root>, nicht der Worktree
git checkout main
git pull
git worktree remove worktrees/<issue-nr>-<slug>
git worktree prune
git branch -D feat/<issue-nr>-<slug>
```

- **`-D`, nicht `-d`:** Wird der PR per Squash gemerged (so geschehen bei PR #2), landen die
  Branch-Commits nicht als solche auf `main`; `git branch -d` verweigert das Löschen dann als
  „not fully merged". `-D` ist nach einem gemergten PR korrekt, weil der Inhalt via Squash
  bereits auf `main` liegt. Vorher prüfen, dass der PR wirklich gemerged ist
  (`gh pr view <n> --json state,mergedAt`).

- **Push immer als `git push -u origin HEAD`.** `git worktree add -b <branch> origin/main`
  setzt den Upstream auf `origin/main`; ein blankes `git push` bricht deshalb ab und Git
  schlägt in der Fehlermeldung `git push origin HEAD:main` vor. Dieser Vorschlag pusht am
  PR vorbei auf `main` und ist ein **D1-Verstoß** — nie befolgen. Direkte Pushes auf `main`
  sind für Agenten ausnahmslos verboten.
- Basis ist `origin/main` — außer das Issue baut auf einem offenen PR auf (D8).
- `worktrees/` ist gitignored.
- Branch-Naming: `feat/<issue-nr>-<slug>`, `fix/<issue-nr>-<slug>`, `docs/<issue-nr>-<slug>`.
  Slug: 1–3 Wörter aus dem Issue-Titel, kleingeschrieben, mit Bindestrichen.
- Writes bleiben single-threaded: ein Issue = ein Worktree = ein Branch = ein PR.

## Direktiven

- **D1 — Merge nur durch Martin** bei vollständig grünem CI. Agenten mergen nie (`gh pr merge` verboten).
- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`; kein `--dangerously-skip-permissions` ohne enge `--allowedTools`. Minimal-Set, damit ein headless-Run nicht mitten in der Aufgabe an einer Freigabe hängen bleibt:
  - Coder: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git push -u origin HEAD)`, `Bash(gh issue view *)`, `Bash(gh issue edit *)` (für das Label), `Bash(gh label list *)`, `Bash(gh pr create *)`, `Bash(gh pr view *)`, `Bash(gh pr comment *)`, `Bash(gh run list *)`, `Bash(gh run view *)`
  - Reviewer: `Read`, `Glob`, `Grep`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr comment *)` — **kein** `Write`/`Edit`
  - Lead (Delegation, Labels, Draft→Ready, Cleanup): `Bash(gh issue create *)`, `Bash(gh issue edit *)`, `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr ready *)`, `Bash(gh run list *)`, `Bash(gh run view *)`, `Bash(gh label list *)`, `Bash(git worktree *)`, `Bash(git checkout main)`, `Bash(git pull)`, `Bash(git branch -D *)` — **kein** `gh pr merge` (D1)
  - **Kein blankes `Bash(git *)`.** Das erlaubt exakt das `git push origin HEAD:main`, vor dem
    D1 warnt. Der Push-Guard wird als exakte Form `Bash(git push -u origin HEAD)` freigegeben;
    jede andere Push-Variante muss an einer Freigabe hängen bleiben.
  - In headless-Runs Shell-Befehle einzeln absetzen: verkettete Kommandos (`a; b`) lösen eine eigene Freigabe aus, auch wenn jeder Teil erlaubt wäre. Das gilt auch für die Beispielblöcke in dieser Datei.
- **D3 — Kleine PRs:** Ein PR = ein Issue. Keine Scope-Ausweitung ohne neues Issue.
- **D4 — Akzeptanzkriterien:** Ein Issue gilt erst erledigt, wenn jede Akzeptanzkriterium-Checkliste abgehakt/automatisiert verifiziert ist. Kriterien, die außerhalb der eigenen Rolle liegen (Reviewer-Run, Merge), hakt man **nicht** selbst ab, sondern benennt sie im PR mit Owner als offen.
- **D5 — Doku bleibt im Repo:** Ergebnisse, Specs, ADRs → `docs/`; niemals nur lokal.
- **D6 — Keine eigene Infrastruktur:** Nur GitHub + lokale Agenten.
- **D7 — Abgebrochener Coder-Run:** Endet ein Coder-Run an `--max-turns`, prüft der Lead den Worktree (`git status`, `git diff`, `git log origin/main..HEAD`) gegen die Akzeptanzkriterien des Issues.
  - **Vollständig** (belegbar: `git diff` zeigt die Umsetzung jedes Akzeptanzkriteriums) → der Lead committet den Worktree-Stand **unverändert** und vollendet: `git push -u origin HEAD`, `gh pr create --draft` (`Closes #N`), nach grünem CI `agent:review`. Die dafür nötigen Einträge nimmt er aus dem Coder-Set (D2).
  - **Unvollständig** → Fix-Run in **demselben** Worktree/Branch delegieren, wieder mit `--max-turns`. Jede inhaltliche Nachbesserung ist ein Fix-Run — der Lead schreibt keinen Code (Rollen-Tabelle).
  - **Eskalation:** Bricht auch der Fix-Run ab → `needs-human`, Rückfrage an Martin.
  - Der Budget-Guard gilt pro Run, nicht pro Zyklus: Vollenden oder Fix-Run verletzen D2 nicht — jeder weitere Run bekommt aber wieder ein eigenes `--max-turns`.
  - Randnotiz: D7 ist für den Abbruch an `--max-turns` formuliert. Bricht ein Run anders ab (Crash, Hänger an einer Freigabe), prüft der Lead den Worktree ebenso und verfährt wie oben.
- **D8 — Abhängige Issues:** Baut ein Issue inhaltlich auf einem noch nicht gemergten PR auf, wird der Worktree von dessen Branch angelegt statt von `origin/main` — sonst fehlt dem Coder der Vorgänger-Stand und es entstehen doppelte PRs (so geschehen bei #10/#12).
  - **Worktree:** `git worktree add worktrees/<issue-nr>-<slug> -b feat/<issue-nr>-<slug> origin/<pr-branch>`
  - **Lead:** trägt die Basis in die Agent-Hinweise des Issues ein und nennt die Basis-Branch-Referenz im Delegations-Prompt. **Ohne Basis-Angabe gilt `origin/main`.**
  - Push weiterhin nur `git push -u origin HEAD`. Der PR-Body nennt die Abhängigkeit („baut auf #X auf — nach #X mergen"); die Reihenfolge entscheidet Martin (D1).
  - D7-Prüfung gegen die Basis: `git log origin/<pr-branch>..HEAD` statt `origin/main..HEAD`.

## Repo-Struktur

```
docs/              Spec-Doku (01-konzept … 04-spezifikation), workflow.md
docs/specs/        Feature-Specs (bei Bedarf — noch nicht angelegt, entsteht beim ersten größeren Auftrag)
docs/experiments/  Ergebnisse von Experiment-Issues (z.B. pilot-pipeline.md)
agentic-workflow/  Research (entwurf, report, quellen)
.github/           ISSUE_TEMPLATE/, workflows/ci.yml
worktrees/         gitignore'd, Arbeitsverzeichnisse der Coding-Agenten
```

Bekannte Lücken der Pipeline (aus dem Pilot-Durchlauf): [`docs/experiments/pilot-pipeline.md`](docs/experiments/pilot-pipeline.md).
