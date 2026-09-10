# AGENTS.md — Agenten-Interface

> Pflichtlektüre für JEDEN Agenten (Claude Code, Hermes-Profile, Copilot, ...), der in diesem Repo arbeitet. Dies ist der zentrale Contract zwischen Repo und Agent.

## Rollen

| Rolle | Realisierung | Scope |
|---|---|---|
| **Orchestrator/Lead** | Hermes default-Profil (Telegram) | Nimmt Aufträge, legt Issues an, delegiert, fasst zusammen. Schreibt KEINEN Code. |
| **Researcher** | Hermes @research / @deep-research | Recherche, Analyse, Spec-Vorarbeit → `research/` bzw. `docs/` |
| **Coder** | Claude Code (headless, 1 Worktree pro Issue) | Implementiert Issue in eigenem Worktree, Branch, Commits, Draft-PR |
| **Reviewer** | Claude Code, 2. Run mit sauberem Kontext | Reviewt PR gegen AGENTS.md + Akzeptanzkriterien, Befunde als PR-Kommentare |
| **Tester** | Claude Code / oa-playwright-cli (nach Bedarf) | E2E/QA-Aufgaben in eigenem Worktree |

## Arbeitsaufträge (Pipeline)

Auftrag (Martin, Telegram oder Issue) → ggf. Spec (`docs/specs/`) → **GitHub Issue** (Template, Akzeptanzkriterien, `agent:ready`) → Lead delegiert → Coder im eigenen Worktree → Draft-PR (`Closes #N`) → CI grün → Reviewer-Run → `agent:review` → **Merge nur durch Martin** bei grünem CI.

Labels: `agent:ready` → `agent:in-progress` → `agent:review` → (Merge) done. `needs-human` / `blocked` für Ausnahmen.

## Worktree-Konvention (PFLICHT bei paralleler Arbeit)

1 Worktree pro Coding-Aufgabe, nie zwei Agenten im selben Verzeichnis:

```bash
git worktree add worktrees/<issue-nr>-<slug> -b feat/<issue-nr>-<slug> origin/main
cd worktrees/<issue-nr>-<slug>
# ... arbeiten, committen, pushen, PR öffnen
git worktree remove worktrees/<issue-nr>-<slug>   # nach Merge + pull
```

- `worktrees/` ist gitignored.
- Branch-Naming: `feat/<issue-nr>-<slug>`, `fix/<issue-nr>-<slug>`, `docs/<issue-nr>-<slug>`.
- Writes bleiben single-threaded: ein Issue = ein Worktree = ein Branch = ein PR.

## Direktiven

- **D1 — Merge nur durch Martin** bei vollständig grünem CI. Agenten mergen nie (`gh pr merge` verboten).
- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`; kein `--dangerously-skip-permissions` ohne enge `--allowedTools`.
- **D3 — Kleine PRs:** Ein PR = ein Issue. Keine Scope-Ausweitung ohne neues Issue.
- **D4 — Akzeptanzkriterien:** Ein Issue gilt erst erledigt, wenn jede Akzeptanzkriterium-Checkliste abgehakt/automatisiert verifiziert ist.
- **D5 — Doku bleibt im Repo:** Ergebnisse, Specs, ADRs → `docs/`; niemals nur lokal.
- **D6 — Keine eigene Infrastruktur:** Nur GitHub + lokale Agenten.

## Repo-Struktur

```
docs/            Spec-Doku (01-konzept … 04-spezifikation), workflow.md, specs/
agentic-workflow/  Research (entwurf, report, quellen)
worktrees/       gitignore'd, Arbeitverzeichnisse der Coding-Agenten
```
