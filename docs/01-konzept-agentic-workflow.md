# Konzept: Agentic Multi-Agent Workflow

> Grundlage: Deep-Research `agentic-workflow/report.md` + `quellen.md` + `entwurf.md` (von Martin gebilligt, 2026-09-08).

## 1. Zusammenfassung

Aufbau eines Multi-Agent-Software-Workflows im Repo oa-sandbox-agents: Hermes (Lead/Orchestrator) koordiniert Research-, Coding-, Review- und Test-Aufgaben; GitHub Issues dienen als Auftragsqueue; jeder parallel arbeitende Agent erhält einen eigenen `git worktree`. Das Repo selbst wird zum Agenten-Interface (AGENTS.md, Issue-Templates, CI-Gates).

## 2. Problemstellung

Bisher laufen Agenten-Aufträge ad hoc: kein definiertes Rollenmodell, keine isolierten Arbeitsverzeichnisse, keine maschinenlesbaren Repo-Konventionen, kein definierter Weg vom Arbeitsauftrag bis zum gemergten Feature. Das führt zu Kontextverlust, Kollisionsrisiko bei Parallelarbeit und inkonsistenter Qualität.

## 3. Zielsetzung

- Definierter, wiederholbarer Workflow: Auftrag → Issue → Worktree → PR → Review → CI → Merge.
- KI-optimiertes Repo (AGENTS.md, Templates, klare Contracts, testbare DoD).
- Keine eigene Infrastruktur — nur GitHub + lokale Agenten (Hermes, Claude Code).

## 4. Lösungsidee

Lead/Orchestrator-Architektur (State of the Art 2026): Hermes als Lead, Claude Code als Coder/Reviewer/Tester in isolierten Worktrees, GitHub Issues + Projects als Queue, Human-in-the-Loop nur am Merge. Details in `04-spezifikation-agentic-workflow.md`.

## 5. Betroffene Komponenten

- Repo-Struktur oa-sandbox-agents (`AGENTS.md`, `docs/`, `.github/ISSUE_TEMPLATE/`, `worktrees/`-Konvention)
- Hermes-Skills (`delegate-research`, ggf. neue Skills für Codier-Delegation)
- GitHub-Repo-Konfiguration (Labels, Templates, Project-Board, Branch-Protection)

## 6. Abgrenzung

- **Kein** Schulungs-/Produktivcode (school-flow bleibt eigenständig).
- **Keine** eigenen Server/MCP-Backends; nur bestehende Tools.
- **Kein** Auto-Merge in v1 (Merge bleibt bei Martin).
- Kein Umbau bestehender Repos (school-flow-Konventionen dienen nur als Vorbild).

## 7. Offene Fragen

- [ ] Umfang v1: nur oa-sandbox-agents als Pilot-Repo, oder direkt Mechanismus für beliebige Repos (Setup-Skript)?
- [ ] Reviewer: zweiter Claude-Code-Run (billig, konsistent) vs. Copilot-Code-Review (extern, kalibrierungsbedürftig)?
- [ ] Wie viele parallele Worktrees v1 (Vorschlag: 2)?
