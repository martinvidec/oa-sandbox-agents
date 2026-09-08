# Entwurf: Multi-Agent-Workflow für ein Repository

> Status: **Entwurf v0.1** (vom Lead-Agent erstellt, 2026-09-08). Ergänzt durch Deep-Research-Ergebnisse (`report.md`, sobald fertig).
> Kontext: Solo-Entwickler (Martin), macOS, Claude Code + Hermes-Agenten als Lead/Orchestrator, GitHub als Backend, **keine eigene Infrastruktur**.

---

## 1. Rollenmodell — welche Agenten braucht man wirklich?

State of the Art (Claude Code Subagents, LangGraph, CrewAI, Praxisberichte) zeigt: **mehr Rollen ≠ besser**. Kleine, klare Rollen mit engem Scope schlagen große "Agentenzoo"-Setups.

| Rolle | Zweck | Realisierung | Pflicht? |
|---|---|---|---|
| **Orchestrator / Lead** | Nimmt Aufträge entgegen, zerlegt in Issues, delegiert, fasst zusammen | Hermes Lead-Profil (Telegram) | ✅ |
| **Researcher** | Recherche, Analyse, Specs, Marktbeobachtung | Hermes @research / @deep-research | ✅ |
| **Coder** | Feature-Implementierung, Branch → Commits → PR | Claude Code (v2.1.241) pro Issue | ✅ |
| **Tester / QA** | E2E-Tests schreiben/fixen, Verifikation gegen Definition-of-Done | Claude Code (2. Instanz) oder oa-playwright-cli-Skill | ⭕ (kann mit Coder kombiniert werden, aber getrennt = besser: andere "Augen" finden andere Bugs) |
| **Critic / Reviewer** | Code-Review vor Human-Merge: Security, Architektur, CLAUDE.md-Compliance | Claude Code Review-Instanz oder `gh` + Review-Prompt | ✅ (billigste Fehlervermeidung) |
| **Analyst** | Spec/Requirements-Analyse aus Research | Kann vom Researcher mit übernommen werden | ⭕ |

**Faustregel:** Orchestrator + Researcher + Coder + Reviewer sind das Minimum. Tester lohnt sich ab sobald E2E-Tests Teil der DoD sind (wie im school-flow-Repo, D4).

## 2. Repo-Lokalablage: 1× pro Agent? — **Ja, mit `git worktree`**

Nicht N Clone (Duplikate, hohe Kosten), nicht EIN Verzeichnis (Agenten stören sich gegenseitig, Build-Artefakte kollidieren). State of the Art: **ein Bare-Repo + `git worktree` pro aktiver Aufgabe**.

```
~/dev/school-flow/                  # Bare-Repo (nur .git-Daten, kein Checkout)
├── worktrees/
│   ├── feature-123-timetable/     # worktree für Issue #123 → Coder A
│   ├── feature-124-export/        # worktree für Issue #124 → Coder B
│   └── review-123/                # worktree für Review von #123
```

Vorteile:
- Ein einziger Objektspeicher → keine doppelten Downloads, kein Disk-Bloat.
- Jeder Agent hat sein **eigenes Arbeitsverzeichnis** → keine Lock-Konflikte, keine gegenseitigen Edits.
- Branches sind pro Worktree exklusiv → Agent A kann auf `feat/123` arbeiten, während Agent B auf `feat/124` arbeitet.
- `node_modules` je Worktree (oder via pnpm-Store geteilt).

```bash
git clone --bare git@github.com:martinvidec/openaustria-school-flow.git
git worktree add worktrees/feature-123 -b feat/123-timetable origin/main
```

**Muster:** Ein Issue = ein Worktree = ein Branch = ein PR. Kein Agent arbeitet an mehreren Branches in einem Verzeichnis.

## 3. Issue-/Spec-/Doku-Verwaltung: GitHub als Single Source of Truth

GitHub selbst (nicht lokale Dateien) ist die Warteschlange — das macht den Workflow plattform-nativ und auditierbar:

- **Issues** = Arbeitseinheiten (Feature, Bug, Refactor). Ein Issue pro Feature/Task.
  - **Issue-Templates** (`ISSUE_TEMPLATE/feature.md`, `bug.md`, `spec.md`) mit fixen Feldern: Ziel, Akzeptanzkriterien (checklist), Scope-Grenzen, "Agent-Hinweise".
  - **Parent/Sub-Issues** für Epics (GitHub-native Progress-Bar) — nicht nur `Refs #N`.
  - **Labels**: `agent:ready` (verifiziert, delegierbar), `agent:in-progress`, `agent:review`, `needs-human`, `blocked`.
  - **GitHub Project** (Board: Backlog → Ready → In Progress → Review → Done) als Übersicht.
- **Spec-driven Development:** Für größere Features schreibt der Researcher/Analyst zuerst eine Spec-Datei `docs/specs/<feature>.md` (Ziel, Nicht-Ziel, Datenmodell, Akzeptanzkriterien). Issue verlinkt die Spec. Erst dann Coder-Delegation.
- **Doku im Repo:**
  - `CLAUDE.md` / `AGENTS.md` im Repo-Root: zentrale Direktiven und Konventionen (bereits etabliert in Martins Repos — beibehalten und als Pflichtlesung für jeden Agenten deklarieren).
  - `docs/adr/` — Architecture Decision Records für jede wesentliche Architektur-Entscheidung.
  - `docs/specs/` — Feature-Specs (siehe oben).
- **Warum GitHub?** Issues sind von überall lesbar (Agent braucht nur `gh`), Status ist maschinenlesbar, CI/PRs hängen direkt dran, keine eigene Infrastruktur nötig.

## 4. Arbeitsaufträge für Features: die Pipeline

Der Kanonische Ablauf (vom Auftrag zum gemergten Feature):

```
Martin (Telegram DM/Topic)
   │
   ▼
Lead/Orchestrator (Hermes)
   1. Klärung / Rückfragen falls nötig
   2. Research/Analyst: Spec erstellen (bei größeren Features) → docs/specs/
   3. GitHub Issue anlegen (Template, Akzeptanzkriterien, Labels) → Label "agent:ready"
   4. Delegation: Claude Code im eigenen Worktree, Prompt = Issue-Nummer + CLAUDE.md-Pflicht
   5. Coder: Implementiert, schreibt/erweitert Tests, öffnet PR (Draft)
   6. Reviewer-Agent: Code-Review am PR (CLAUDE.md-Compliance, Security, DoD)
   7. CI (GitHub Actions): Lint, Unit, Build, E2E
   8. Reviewer: "Approve" nur wenn CI grün + Review-Kommentare adressiert
   9. Lead: Zusammenfassung an Martin im Telegram-Topic ("PR #N fertig, CI grün")
  10. Martin: Human-Merge (oder Auto-Merge für triviale/typisierte Änderungen)
   11. Issue automatisch schließen (via "Closes #N" im PR)
```

**Human-in-the-Loop-Punkte (minimal, aber wichtig):**
- Merge nach main: Martin (oder Auto-Merge nur bei `patch`-Scope + grünem CI + Reviewer-Approve).
- Neue Dependencies / Security-relevante Änderungen.
- Architektur-Entscheidungen (→ ADR-Vorschlag vom Agent, Freigabe von Martin).

**Regeln (aus school-flow CLAUDE.md übernommen, D3/D4/D5):**
- Merge nur nach **grünem CI**, kein Admin-Override.
- E2E-Tests deterministisch (throwaway fixtures).
- Issue-Relationships via GitHub-native parent/sub-issues.

## 5. Was bedeutet "KI-optimiertes Repo" konkret?

1. **Maschinenlesbare Docs zuerst:** `CLAUDE.md`/`AGENTS.md` als Contract. Strukturiert, prägnant, ohne Prosa-Rauschen. Jeder Agent liest diese zuerst.
2. **Kleine, unabhängige PRs:** Ein PR = ein Codelayout-Konzept = ein Issue. Agents arbeiten besser mit engem Scope.
3. **Klare Contracts:** Typen, Interfaces, API-Specs (z. B. OpenAPI) im Repo — Agenten können dann ohne Rückfragen Code schreiben, der "passt".
4. **Testbare Definition-of-Done:** Akzeptanzkriterien als automatisierbare Checks formulieren ("E2E-Test `x.spec.ts` grün"), nicht als Prosa.
5. **Selbstheilende CI-Fehlerpfade:** CI-Logs maschinenlesbar, klare Fehlermeldungen — Agent kann den Fehler selbst lesen und fixen.
6. **Kontextarmut vermeiden:** Repo-Struktur so, dass ein Agent mit 1–2 Datei-Leses den relevanten Kontext hat (`docs/README`, `packages/*/README`, klares Naming).
7. **MCP/Tooling:** Claude Code hat per Default File/Shell; via MCP ggf. spezifische Tools (Playwright, DB) andocken.
8. **Konventionen über Konfiguration:** Naming, Ordnerstruktur, Commit-Stil festlegen — reduziert Agent-Entscheidungen.

## 6. Konkreter Zielentwurf für Martin

**Setup (1× einrichten):**
- Bare-Repo `~/dev/<repo>/` + `worktrees/`-Konvention.
- GitHub: Issue-Templates, Project-Board, Branch-Protection (Merge nur mit grünem CI + Review), Labels.
- `CLAUDE.md` je Repo mit Direktiven (bereits vorhanden → als Pflicht Referenz im Delegations-Prompt).
- Hermes Lead-Profil + @research/@deep-research (vorhanden).
- Claude Code als Coder/Reviewer (vorhanden).

**Pro Feature (Routineablauf):**
1. Martin formuliert Wunsch (Telegram).
2. Lead: klären → ggf. Spec (Researcher) → Issue mit Template + `agent:ready`.
3. Lead: Claude-Code-Delegation im Worktree mit Issue-Link.
4. Reviewer-Instanz + CI als Gate.
5. Lead postet Ergebnis ins Telegram-Topic, Martin merged.

**Keine eigene Infrastruktur nötig:** GitHub (Issues, Actions, Projects, Branch-Protection) + lokale Agenten — passt zu Martins Präferenz (serverless/plattform-native).

## 7. Deep-Research-Ergebnisse (eingearbeitet)

`report.md` + `quellen.md` (Stand 2026-09-08, @deep-research). Wichtigste Bestätigungen/Korrekturen zu obigem Entwurf:

- **Architektur:** Lead/Orchestrator + Subagents ist der Konsens — kein flaches "Team" gleichberechtigter Rollen. Kritisch: **Writes single-threaded** (Cognition 2026); parallele Agenten nur in separaten Worktrees, never in dieselben Dateien.
- **Reviewer/Tester-Pattern bestätigt:** unabhängiger Reviewer mit sauberem Kontext findet ~2 Bugs/PR (davon ~58 % schwere); "Verification Subagent" ist das stabileste Multi-Agent-Muster. Auto-Reviewer haben aber False-Positive-Raten → Kalibrierung nötig.
- **Repo-Ablage:** `git worktree` pro Agent ist De-facto-Standard (Claude Code `--worktree`, Copilot-VMs, Codex) — wie in §2 skizziert.
- **Doku:** `AGENTS.md` (Linux Foundation, 60k+ Repos) wird zum kanonischen Standard; CLAUDE.md kann `@AGENTS.md` importieren → empfohlen, beides zu pflegen. Spec Kit (Constitution → Spec → Plan → Tasks → Implement) für größere Features.
- **Pipeline:** Issue (mit Akzeptanzkriterien) → Agent-Assign → Draft-PR → CI-Gates → Auto-Review → **nur der Mensch merged** (Coding-Agenten dürfen ihre PRs per Design nicht selbst mergen).
- **KI-optimiert (Datenpunkt):** agentische PRs haben ohne Review-Schleife nur ~32,7 % Acceptance vs. 84,4 % — Qualität entsteht in der CI/Review-Schleife, nicht in der Generierung.
- **Budget-Guards:** `--max-turns`/Budget-Caps setzen; keine `--dangerously-skip-permissions` ohne enge `--allowedTools`.

Offene Punkte aus §7 bleiben: Auto-Merge-Kriterien, Reviewer-Setup, Worktree-Anzahl auf Martins Hardware.

---
*Verwandt: `../autonome-software-agentur/` (früherer Entwurf), `~/silversurfer.openaustria.org/research/agentic-workflow/` (Original-Deep-Research-Ordner).*
