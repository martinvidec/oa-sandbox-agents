# Anforderungsanalyse: Agentic Multi-Agent Workflow

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Agenten-Interface-Datei | Muss | `AGENTS.md` im Repo-Root mit Konventionen, Direktiven und Rollen-Briefings; CLAUDE.md importiert sie (`@AGENTS.md`) |
| FA-02 | Worktree-Arbeitsmodell | Muss | Definierte Konvention: Bare-Repo-Klon ODER `git worktree` pro Coding-Aufgabe unter `worktrees/<issue-nr>-<slug>/`; dokumentiert in AGENTS.md |
| FA-03 | Issue-Templates | Muss | `feature`, `bug`, `experiment` mit Pflichtfeldern: Ziel, Akzeptanzkriterien (Checkliste), Scope-Grenzen, Agent-Hinweise |
| FA-04 | Workflow-Labels | Muss | Label-Set: `agent:ready`, `agent:in-progress`, `agent:review`, `needs-human`, `blocked` |
| FA-05 | Auftrags-Pipeline | Muss | Definierter Ablauf Auftrag→Spec→Issue→Worktree→PR→Review→CI→Merge; dokumentiert (`docs/workflow.md`) und in AGENTS.md referenziert |
| FA-06 | Coding-Delegation-Skill | Muss | Hermes-Skill `delegate-coding`: Claude Code pro Issue im eigenen Worktree, Prompt = Issue-Nummer + AGENTS.md-Pflicht, Budget-Caps (`--max-turns`) |
| FA-07 | Review-Schritt | Soll | Unabhängiger Reviewer-Run (zweiter Claude-Code-Run mit sauberem Kontext) auf jedem PR vor Human-Merge; Befunde als PR-Kommentare |
| FA-08 | CI-Pipeline | Soll | GitHub Actions: Lint + Smoke-Checks auf jedem PR; grün = Merge-Voraussetzung (D3-Pattern) |
| FA-09 | Project-Board | Kann | GitHub Project (Backlog→Ready→In Progress→Review→Done) als Statusübersicht |
| FA-10 | Spec-driven Development | Soll | Für größere Features: Spec-Datei `docs/specs/<feature>.md` vor Issue-Erstellung (Schritt 1–4 dieses Skills) |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Keine eigene Infrastruktur | Hosting | Nur GitHub + lokale Agenten (Martins Plattform-Präferenz) |
| NFA-02 | Writes single-threaded | Architektur | Kein paralleler Schreibzugriff zweier Agenten auf denselben Worktree/Pfad (Cognition-Lektion) |
| NFA-03 | Budget-Guards | Betrieb | Delegationen immer mit `--max-turns`; keine `--dangerously-skip-permissions` ohne enge `--allowedTools` |
| NFA-04 | Auditierbarkeit | Betrieb | Jede Agenten-Aktion nachvollziehbar (Issue, Branch, PR, Kommentare) — keine lokalen Datei-Dead-Ends |
| NFA-05 | Maschinenlesbarkeit | Doku | Docs strukturiert/prägnant; Akzeptanzkriterien automatisch prüfbar wo möglich |

## 3. Akzeptanzkriterien

- [ ] AGENTS.md + CLAUDE.md existieren und definieren Rollen, Worktree-Konvention, Pipeline
- [ ] Issue-Templates im Repo; ein Test-Issue mit allen Pflichtfelden angelegt
- [ ] Label-Set angelegt und dokumentiert
- [ ] Erster End-to-End-Lauf dokumentiert: Auftrag → Issue → Worktree → Claude-Code-PR → Review-Run → Merge-Entscheidung (auch manuell getestet)
- [ ] Workflow-Doku (`docs/workflow.md`) beschreibt jeden Schritt reproduzierbar
- [ ] CI-Workflow läuft auf einem Test-PR grün

## 4. Abhängigkeiten zu anderen Anforderungen

- FA-06 (Review) hängt an FA-02 (Worktree) und FA-01 (AGENTS.md als Review-Basis).
- FA-08 (CI) hängt an FA-03/FA-04 (PRs entstehen aus Issues mit Labels).

## 5. Priorisierung

1. FA-01, FA-02, FA-03, FA-04 (Repo-Grundlage) — zuerst
2. FA-05 + FA-06 (Pipeline + Review) — Kern
3. FA-07 (CI), FA-09 (Board) — Absicherung/Übersicht
4. FA-10 (Spec-driven) — laufend, für größere Features
