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
  4. Coder: implementiert, committet, `git push -u origin HEAD`, Draft-PR („Closes #N")
  │    Label: agent:review (durch den Coder, sobald PR offen + CI grün)
  5. CI (GitHub Actions) läuft — muss grün sein
  6. Reviewer-Run (2. Claude-Code-Instanz, sauberer Kontext) → Review-Schleife unten
  7. Lead: hebt Draft-Status auf; meldet an Martin (Telegram-Thread):
  │    „PR #N fertig, CI grün, Review-Befunde: …"
  8. MARTIN merged (oder lehnt/ändert)  ← Human-in-the-Loop, keine Ausnahme
  9. Issue schließt automatisch („Closes #N"); Worktree entfernen (Ablauf: AGENTS.md)
```

## Zuständigkeiten pro Schritt

| Schritt | Wer | Tool/Befehl |
|---|---|---|
| Issue anlegen | Lead | `gh issue create --template feature.yml --label agent:ready` |
| Worktree anlegen | Coder | `git worktree add worktrees/<n>-<slug> -b feat/<n>-<slug> origin/main` |
| Implementierung | Coder | `claude -p "<issue-brief>" --max-turns 30` im Worktree |
| Push | Coder | `git push -u origin HEAD` (nie `HEAD:main` — D1) |
| PR öffnen | Coder | `gh pr create --draft` (Body: Closes #N + Akzeptanzkriterien) |
| Label `agent:review` | Coder | `gh issue edit <n> --add-label agent:review --remove-label agent:in-progress` |
| Review | Reviewer | separater Claude-Code-Run auf dem PR-Diff, `--max-turns 15` |
| Draft → Ready | Lead | `gh pr ready <n>` nach grünem CI + abgeschlossenem Review |
| Merge | **Martin** | GitHub UI oder `gh pr merge` |
| Worktree entfernen | Coder/Lead | nach Merge, vom Repo-Root (AGENTS.md) |

## Review-Schleife

1. Der Lead startet den Reviewer-Run — **eigener Prozess, sauberer Kontext**, kein Wissen aus dem Coding-Run.
2. Reviewt wird der vollständige PR-Diff (`gh pr diff <n>`) gegen AGENTS.md (D3, D4) und die Akzeptanzkriterien des Issues.
3. Befunde gehen als PR-Kommentare raus; der Reviewer editiert **keinen** Code. Ohne Befunde: ein Kommentar „Review ok, keine Befunde" — Schweigen zählt nicht als Freigabe.
4. Nachbesserung macht der Coder in **demselben** Worktree/Branch (sonst bricht „ein Issue = ein Worktree = ein PR").
5. Maximal zwei Schleifen; danach `needs-human` und Eskalation an Martin.
6. Akzeptanzkriterien, die nicht der Coder erfüllen kann, werden im Issue mit Owner markiert — `(Reviewer)`, `(Martin)`. Der Coder hakt sie nicht ab, sondern führt sie im PR als offen mit Owner.

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
- Kein Agent pusht auf `main` — auch dann nicht, wenn Git es in einer Fehlermeldung vorschlägt.

## Bekannte Lücken

Der Pilot-Durchlauf (Issue #1) hat offene Punkte dieser Pipeline protokolliert —
u.a. fehlendes PR-Template, schwache CI-Signale und noch nicht aktive Branch-Protection:
[`experiments/pilot-pipeline.md`](experiments/pilot-pipeline.md).
