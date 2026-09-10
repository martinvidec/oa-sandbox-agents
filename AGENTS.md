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

Auftrag (Martin, Telegram oder Issue) → ggf. Spec (`docs/specs/`) → **GitHub Issue** (Template, Akzeptanzkriterien, `agent:ready`) → Lead delegiert → Coder im eigenen Worktree → Draft-PR (`Closes #N`) → CI grün → Reviewer-Run → `agent:review` → **Merge nur durch Martin** bei grünem CI.

Labels — jeder Übergang hat genau einen Owner, sonst bleiben abgebrochene Runs falsch etikettiert liegen:

| Label | wird gesetzt von | Auslöser |
|---|---|---|
| `agent:ready` | Lead (bzw. Issue-Template automatisch) | Issue ist briefing-fertig |
| `agent:in-progress` | Lead beim Delegieren | Coder-Run startet |
| `agent:review` | Coder, sobald Draft-PR offen und CI grün | PR wartet auf Reviewer-Run |
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
nicht selbst entfernen):

```bash
cd <repo-root> && git checkout main && git pull
git worktree remove worktrees/<issue-nr>-<slug>
git worktree prune
git branch -d feat/<issue-nr>-<slug>
```

- **Push immer als `git push -u origin HEAD`.** `git worktree add -b <branch> origin/main`
  setzt den Upstream auf `origin/main`; ein blankes `git push` bricht deshalb ab und Git
  schlägt in der Fehlermeldung `git push origin HEAD:main` vor. Dieser Vorschlag pusht am
  PR vorbei auf `main` und ist ein **D1-Verstoß** — nie befolgen. Direkte Pushes auf `main`
  sind für Agenten ausnahmslos verboten.
- `worktrees/` ist gitignored.
- Branch-Naming: `feat/<issue-nr>-<slug>`, `fix/<issue-nr>-<slug>`, `docs/<issue-nr>-<slug>`.
  Slug: 1–3 Wörter aus dem Issue-Titel, kleingeschrieben, mit Bindestrichen.
- Writes bleiben single-threaded: ein Issue = ein Worktree = ein Branch = ein PR.

## Direktiven

- **D1 — Merge nur durch Martin** bei vollständig grünem CI. Agenten mergen nie (`gh pr merge` verboten).
- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`; kein `--dangerously-skip-permissions` ohne enge `--allowedTools`. Minimal-Set, damit ein headless-Run nicht mitten in der Aufgabe an einer Freigabe hängen bleibt:
  - Coder: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash(git *)`, `Bash(gh issue view *)`, `Bash(gh pr create *)`, `Bash(gh pr view *)`, `Bash(gh run list *)`, `Bash(gh run view *)`, `Bash(gh issue edit *)` (für das Label)
  - Reviewer: `Read`, `Glob`, `Grep`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr comment *)` — **kein** `Write`/`Edit`
  - In headless-Runs Shell-Befehle einzeln absetzen: verkettete Kommandos (`a; b`) lösen eine eigene Freigabe aus, auch wenn jeder Teil erlaubt wäre.
- **D3 — Kleine PRs:** Ein PR = ein Issue. Keine Scope-Ausweitung ohne neues Issue.
- **D4 — Akzeptanzkriterien:** Ein Issue gilt erst erledigt, wenn jede Akzeptanzkriterium-Checkliste abgehakt/automatisiert verifiziert ist. Kriterien, die außerhalb der eigenen Rolle liegen (Reviewer-Run, Merge), hakt man **nicht** selbst ab, sondern benennt sie im PR mit Owner als offen.
- **D5 — Doku bleibt im Repo:** Ergebnisse, Specs, ADRs → `docs/`; niemals nur lokal.
- **D6 — Keine eigene Infrastruktur:** Nur GitHub + lokale Agenten.

## Repo-Struktur

```
docs/              Spec-Doku (01-konzept … 04-spezifikation), workflow.md
docs/specs/        Feature-Specs (bei größeren Aufträgen, vor dem Issue)
docs/experiments/  Ergebnisse von Experiment-Issues (z.B. pilot-pipeline.md)
agentic-workflow/  Research (entwurf, report, quellen)
.github/           ISSUE_TEMPLATE/, workflows/ci.yml
worktrees/         gitignore'd, Arbeitsverzeichnisse der Coding-Agenten
```

Bekannte Lücken der Pipeline (aus dem Pilot-Durchlauf): [`docs/experiments/pilot-pipeline.md`](docs/experiments/pilot-pipeline.md).
