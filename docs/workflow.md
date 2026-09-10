# Workflow: Multi-Agent-Entwicklung in diesem Repo

> Kanonischer Ablauf vom Arbeitsauftrag bis zum Merge. Details zu Rollen: `AGENTS.md`.

## Pipeline

```
Auftrag (Martin: Telegram DM/Thread ODER direkt als Issue)
  │
  1. Lead (Hermes): Rückfragen klären; bei größeren Features zuerst Spec
  │    → docs/specs/<feature>.md  (Workflow: docs/01–04, concept-analysis-spec-Skill)
  2. GitHub Issue anlegen (Template) — mit Ziel, Akzeptanzkriterien, Scope, Agent-Hinweisen
  │    Label: agent:ready
  3. Lead delegiert → Claude Code im eigenen Worktree
  │    worktrees/<issue-nr>-<slug>, Branch feat/<issue-nr>-<slug>
  │    Label: agent:in-progress
  4. Coder: implementiert, committet, push't, öffnet Draft-PR („Closes #N")
  5. CI (GitHub Actions) läuft — muss grün sein
  6. Reviewer-Run (2. Claude-Code-Instanz, sauberer Kontext)
  │    Befunde als PR-Kommentare → Coder fixt nach → Label: agent:review
  7. Lead meldet an Martin (Telegram-Thread): „PR #N fertig, CI grün, Review-Befunde: …"
  8. MARTIN merged (oder lehnt/ändert)  ← Human-in-the-Loop, keine Ausnahme
  9. Issue schließt automatisch („Closes #N"); Worktree entfernen
```

## Zuständigkeiten pro Schritt

| Schritt | Wer | Tool/Befehl |
|---|---|---|
| Issue anlegen | Lead | `gh issue create --template feature.yml --label agent:ready` |
| Worktree anlegen | Coder | `git worktree add worktrees/<n>-<slug> -b feat/<n>-<slug> origin/main` |
| Implementierung | Coder | `claude -p "<issue-brief>" --max-turns 30` im Worktree |
| PR öffnen | Coder | `gh pr create --draft` (Body: Closes #N + Akzeptanzkriterien) |
| Review | Reviewer | separater Claude-Code-Run auf dem PR-Diff |
| Merge | **Martin** | GitHub UI oder `gh pr merge` |

## Setup-Mechanismus für beliebige Repos

Dieses Repo ist der **Referenz-Implementierungsort**. Für jedes neue Repo (`<repo>`):

1. Dateien kopieren: `AGENTS.md`, `CLAUDE.md`, `.github/ISSUE_TEMPLATE/*.yml`, `.github/workflows/ci.yml`
2. Labels anlegen: `gh label create agent:ready …` (Set siehe AGENTS.md)
3. Worktree-Konvention gilt unverändert
4. Prüfen: Write-Recht des Bot-Accounts vorhanden?

Der Einrichtungsauftrag läuft als normales Issue im Ziel-Repo (Template „Experiment"), die Umsetzung übernimmt dieser Workflow selbst — Dogfooding.

## Regeln (Kurzform, verbindlich — Details in AGENTS.md)

- Merge nur durch Martin, nur bei grünem CI.
- Ein Issue = ein Worktree = ein Branch = ein PR. Writes single-threaded.
- Budget-Caps bei jeder Agenten-Delegation.
- Ergebnisse/Doku gehören ins Repo, nie nur lokal.
