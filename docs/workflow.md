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
  │    worktrees/<issue-nr>-<slug>, Branch feat/<issue-nr>-<slug> (gleicher Slug)
  │    Basis: origin/main, bei offenem Vorgänger-PR dessen Branch
  │    (Lead nennt ihn im Delegations-Prompt; AGENTS.md D8)
  │    Label: agent:in-progress
  4. Coder: implementiert, committet, `git push -u origin HEAD`, Draft-PR („Closes #N")
  │    Abbruch an --max-turns: Lead prüft den Worktree gegen die Akzeptanzkriterien
  │    (Lead-Run im Worktree-Verzeichnis: git status|diff|log, kein git -C) →
  │    vollständig: Lead committet unverändert, Push/PR; sonst Fix-Run;
  │    bricht auch der ab: needs-human (AGENTS.md D7)
  │    D8-Basis und Vorgänger inzwischen gemergt: vorher git status im
  │    Worktree-Verzeichnis — laufender Merge → needs-human, kein Sync-Run;
  │    sonst erst Sync-Run (committet Uncommittetes unverändert, holt main),
  │    dann Prüfung gegen origin/main; bricht der Sync-Run ab (nicht mitten
  │    im Merge): ein neuer Sync-Run, bricht auch der ab: needs-human —
  │    höchstens zwei Sync-Versuche je gemergtem Vorgänger; Ausnahme: war der
  │    abgebrochene Versuch schon der Sync des D7-Fix-Runs, gibt es keinen
  │    Wiederholungsversuch → direkt needs-human (AGENTS.md D8, „Zählung —
  │    höchstens zwei Sync-Versuche pro Sync-Anlass")
  5. CI (GitHub Actions) läuft — muss grün sein
  │    Beleg als PR-Kommentar, nicht im PR-Body (der wird nicht nachgepflegt; AGENTS.md D4)
  │    Diagramm-PR: zusätzlich Verify-Beleg als PR-Kommentar (Zuständigkeiten, „Diagramm-Beleg am PR")
  │    Label: agent:review — setzt der Coder (bei D7: Lead), sobald Draft-PR offen UND CI grün belegt ist
  6. Reviewer-Run (2. Claude-Code-Instanz, sauberer Kontext) → Review-Schleife unten
  7. Lead: hebt Draft-Status auf; meldet an Martin (Telegram-Thread):
  │    „PR #N fertig, CI grün, Review-Befunde: …"
  8. MARTIN merged (oder lehnt/ändert)  ← Human-in-the-Loop, keine Ausnahme
  9. Issue schließt automatisch („Closes #N"); Lead entfernt den Worktree (Ablauf: AGENTS.md)
```

## Zuständigkeiten pro Schritt

| Schritt | Wer | Tool/Befehl |
|---|---|---|
| Issue anlegen | Lead | `gh issue create --template feature.yml --label agent:ready` |
| Worktree anlegen | Coder | `git worktree add worktrees/<n>-<slug> -b feat/<n>-<slug> origin/main` (abhängiges Issue: `origin/<pr-branch>`, AGENTS.md D8) |
| Implementierung | Coder | `claude -p "<issue-brief>" --max-turns 30` im Worktree |
| Push | Coder | `git push -u origin HEAD` (nie `HEAD:main` — D1) |
| PR öffnen | Coder | `gh pr create --draft` (Body: Closes #N + Akzeptanzkriterien) |
| CI-Beleg am PR | Coder (bei D7: Lead) | `gh pr comment <n> --body "CI grün: Run <id>, conclusion success"` — der PR-Body wird **nicht** nachgepflegt, `gh pr edit` steht in keinem Tool-Set (AGENTS.md D2, D4) |
| Diagramm-Beleg am PR | Coder (bei D7: Lead) | Nur wenn der PR ein Diagramm ändert (z.B. Mermaid in `docs/workflow-hochglanz.html`): **Pflicht vor `agent:review`.** Lokal `scripts/verify-mermaid.mjs` laufen lassen (Setup: [`verify-setup.md`](verify-setup.md)) und einen **neuen** PR-Kommentar mit den Screenshots und dem Ergebnis (`ok`/`findings` aus dem Report) anlegen, wie jeder Beleg (Häkchen nur mit Beleg, unten). Meldet der Report Befunde, erst nachbessern; visuelle Akzeptanzkriterien gelten ohne diesen Beleg nicht als erfüllt |
| Label `agent:review` | Coder (bei D7: Lead) | `gh issue edit --add-label agent:review --remove-label agent:in-progress <n>` — Label-Flag zuerst, Nummer zuletzt; `gh issue edit` ist nur in dieser Form freigegeben (AGENTS.md D2) |
| Review | Reviewer | separater Claude-Code-Run auf dem PR-Diff, `--max-turns 15`, Tool-Set siehe AGENTS.md D2 |
| Draft → Ready | Lead | `gh pr ready <n>` nach grünem CI + abgeschlossenem Review; Tool-Set: `Bash(gh pr ready *)`, `Bash(gh pr view *)`, `Bash(gh run list *)`, `Bash(gh run view *)` (vollständiges Lead-Set: AGENTS.md D2) |
| Merge | **Martin** | GitHub UI oder `gh pr merge` |
| Worktree entfernen | **Lead** | nach Merge, vom Repo-Root, Befehle einzeln (AGENTS.md) — nicht der Coder, dessen Run mit dem PR endet |

## Review-Schleife

1. Der Lead startet den Reviewer-Run — **eigener Prozess, sauberer Kontext**, kein Wissen aus dem Coding-Run.
2. Reviewt wird der vollständige PR-Diff (`gh pr diff <n>`) gegen AGENTS.md (D3, D4) und die Akzeptanzkriterien des Issues. Dafür braucht der Reviewer `Bash(gh issue view *)` in seinem Tool-Set — ohne das kommt er nicht an die Akzeptanzkriterien und kann D4 nicht prüfen (im Pilot-Run empirisch gescheitert). Bei D8-Basis enthält `gh pr diff` auch den Vorgänger-PR (der PR läuft gegen `main`) — dann stattdessen `git diff origin/<pr-branch>...HEAD` (HEAD = PR-Branch) reviewen, damit nur die Arbeit dieses Issues geprüft wird (AGENTS.md D8). Das gilt nur bis zum Merge des Vorgängers: Vorher `gh pr view <X> --json state,mergedAt` prüfen. Ist #X gemergt und `main` per Sync-Run im PR-Branch, gilt `git diff origin/main...HEAD` (bzw. wieder `gh pr diff`), nicht mehr `origin/<pr-branch>...HEAD` — der Diff enthielte sonst alles, was mit `main` hereinkam. Den Sync-Stand erkennt der Reviewer an den Agent-Hinweisen des Issues (nach dem Sync nennt der Lead dort wieder `origin/main` als Basis) oder daran, dass `git log HEAD..origin/main` leer ist — das setzt einen nach dem Merge von #X gefetchten `origin/main` voraus; im Zweifel gelten die Agent-Hinweise. Ist #X gemergt, `main` aber noch nicht im Branch, startet kein Review: Der Reviewer schreibt nur einen PR-Kommentar „kein Review, Sync fehlt" und endet; der Lead delegiert daraufhin den Sync-Run und danach einen neuen Reviewer-Run (AGENTS.md D8, „**Auslöser**" und „**Danach gilt `<basis>` = `origin/main`**").
3. Befunde gehen als PR-Kommentare raus; der Reviewer editiert **keinen** Code. Ohne Befunde: ein Kommentar „Review ok, keine Befunde" — Schweigen zählt nicht als Freigabe.
   - **Diagramm-PRs:** Der Reviewer prüft, ob der Verify-Beleg des Coders am PR steht (Pflicht und Ablauf: Zuständigkeiten pro Schritt, „Diagramm-Beleg am PR"). Fehlt der Kommentar oder meldet der Report Befunde (Error-Boxen, Überlappungen, abgeschnittene Labels), ist das ein Review-Befund.
4. Nachbesserung macht der Coder in **demselben** Worktree/Branch (sonst bricht „ein Issue = ein Worktree = ein PR") — kein neues Issue, auch kein D8-Folge-Issue (Abgrenzung: AGENTS.md D8).
5. Maximal zwei Schleifen; danach `needs-human` und Eskalation an Martin.
6. Akzeptanzkriterien, die nicht der Coder erfüllen kann, werden im Issue mit Owner markiert — `(Reviewer)`, `(Martin)`. Der Coder hakt sie nicht ab, sondern führt sie im PR als offen mit Owner.

## Häkchen nur mit Beleg

Status- und DoD-Häkchen (Issue-Checklisten, Protokolle in `docs/experiments/`, PR-Beschreibungen)
werden **erst gesetzt, wenn der Beleg vorliegt** — nicht vorausschauend, weil man das Ergebnis
erwartet. Im Pilot-Durchlauf waren zwei Status als erledigt protokolliert, bevor der CI-Lauf
überhaupt durch war.

- „CI grün" erst nach `gh run list --branch <branch>` bzw. `gh run view <id>` mit `conclusion: success`.
- „Review erledigt" erst, wenn der Review-Kommentar am PR steht (Schweigen zählt nicht).
- „Merged" erst nach `gh pr view <n> --json state,mergedAt`.
- Ist der Beleg noch offen, bleibt das Häkchen leer und der Punkt wird mit Owner als offen benannt (D4).

**Im PR-Body bleibt „CI grün" dauerhaft unabgehakt** — der Body ist der Stand bei `gh pr create`,
CI läuft erst danach an. Nachgepflegt wird er nicht: `gh pr edit` steht in keinem Tool-Set, weil
`--body` den Body vollständig ersetzt und dabei `Closes #N` oder die Owner-Vermerke kippen kann
(AGENTS.md D2). Der Beleg kommt stattdessen als PR-Kommentar (`gh pr comment`, Zuständigkeiten-
Tabelle oben) — datiert und ohne Zugriff auf den Body. Pro Beleg ein **neuer** Kommentar, weder
`--edit-last` noch `--delete-last`: Das Pattern `Bash(gh pr comment *)` deckt beide ab (bei
`--delete-last` samt `--yes`, das die Löschbestätigung überspringt), die Konvention sieht sie nicht
vor (AGENTS.md D4). Dasselbe gilt für den **Issue**-Body — auch er wird nicht nachgepflegt, Agenten
ändern ihn nicht (AGENTS.md D2, „Kein blankes `Bash(gh issue edit *)`"). Einzige Ausnahme: der Lead
stellt die D8-Basis in den Agent-Hinweisen auf `origin/main` um, mit einer Zusatzfreigabe für genau
diesen Run (AGENTS.md D2, „Einzige Ausnahme — die D8-Basisänderung"). Wer den PR liest, findet den
Status damit an zwei Stellen: den Checks-Reiter von GitHub und den Beleg-Kommentar.

## Setup-Mechanismus für beliebige Repos

Dieses Repo ist der **Referenz-Implementierungsort**. Für jedes neue Repo (`<repo>`):

1. Dateien kopieren: `AGENTS.md`, `CLAUDE.md`, `.github/ISSUE_TEMPLATE/*.yml`, `.github/workflows/ci.yml`
2. Labels anlegen: `gh label create agent:ready …` (Set siehe AGENTS.md)
3. Worktree-Konvention gilt unverändert
4. Prüfen: Write-Recht des Bot-Accounts vorhanden?

Der Einrichtungsauftrag läuft als normales Issue im Ziel-Repo (Template „Experiment"), die Umsetzung übernimmt dieser Workflow selbst — Dogfooding.

## Regeln (Kurzform, verbindlich — Details in AGENTS.md)

- Merge nur durch Martin, nur bei grünem CI — bei abhängigen PRs entscheidet er auch die Reihenfolge (AGENTS.md D8).
- Ein Issue = ein Worktree = ein Branch = ein PR. Writes single-threaded.
- Budget-Caps bei jeder Agenten-Delegation.
- Ergebnisse/Doku gehören ins Repo, nie nur lokal.
- Kein Agent pusht auf `main` — auch dann nicht, wenn Git es in einer Fehlermeldung vorschlägt.

## Bekannte Lücken

Der Pilot-Durchlauf (Issue #1) hat offene Punkte dieser Pipeline protokolliert —
u.a. fehlendes PR-Template, schwache CI-Signale und noch nicht aktive Branch-Protection:
[`experiments/pilot-pipeline.md`](experiments/pilot-pipeline.md).
