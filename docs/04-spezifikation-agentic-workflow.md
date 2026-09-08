# Spezifikation: Agentic Multi-Agent Workflow

## 1. Übersicht

Umsetzung des gebilligten Entwurfs im Repo oa-sandbox-agents in 6 umsetzbaren Einheiten (E1–E6). Grundlage: `01-konzept`, `02-ist-analyse`, `03-anforderungsanalyse` + Deep-Research (`agentic-workflow/report.md`).

## 2. Technisches Design

### 2.1 Architektur

```
Martin (Telegram: DM oder repo-Thread)
   ▼
Hermes Lead (default-Profil)  ← Orchestrator
   ├─ @research / @deep-research        → Recherche, Spec-Vorarbeit
   ├─ Claude Code (Coder)      1× Worktree pro Issue → Branch → Draft-PR
   ├─ Claude Code (Reviewer)   2. Run, sauberer Kontext → PR-Kommentare
   └─ Claude Code (Tester)     nach Bedarf (E2E/QA-Aufgaben)
   ▼
GitHub: Issues (Queue) → PR → CI → Martin merged
```

Repo-Layout (Soll):

```
oa-sandbox-agents/
├── AGENTS.md                      # Agenten-Interface (FA-01)
├── CLAUDE.md                      # importiert @AGENTS.md
├── docs/                          # Spec-Doku (01–04) + workflow.md + specs/
├── .github/ISSUE_TEMPLATE/        # feature.md, bug.md, experiment.md (FA-03)
├── .github/workflows/ci.yml       # Lint + Smoke (FA-08)
├── agentic-workflow/              # Research (vorhanden)
└── worktrees/                     # gitignore'd, Konvention in AGENTS.md (FA-02)
```

### 2.2 Datenmodell

n. z. (kein App-Code). „Daten" = GitHub-Entities: Issue-Templates (YAML-Felder), Labels, Project-Board-Felder.

### 2.3 Schnittstellen

- `gh` CLI (Issues, PRs, Labels, Projects) — auth: silversurfer-openaustria-org.
- Hermes-Delegation: `hermes -p <profil> chat -q` (Research) und neue Skill-Funktion `delegate-coding` → Claude Code Headless (`claude -p`) im Worktree.
- GitHub Actions als CI-Gate.

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| # | Einheit | Inhalt | Aufwand |
|---|---|---|---|
| E1 | Repo-Grundlage | AGENTS.md + CLAUDE.md (Rollen, Worktree-Konvention, Pipeline-Regeln, Budget-Guards) | Klein |
| E2 | Issue-Templates + Labels | feature/bug/experiment-Templates (YAML), Label-Set FA-04 | Klein |
| E3 | Workflow-Doku | `docs/workflow.md`: Pipeline-Diagramm, Rollen, Worktree-Befehle, Merge-Regeln (nur Martin, grünes CI) | Klein |
| E4 | Skill delegate-coding | Hermes-Skill: Issue→Worktree→claude -p→PR, mit --max-turns und AGENTS.md-Pflicht im Prompt | Mittel |
| E5 | CI-Pipeline | .github/workflows/ci.yml (markdown-lint + Repo-Konvention-Checks) | Klein |
| E6 | Pilot-Lauf | Einen realen Mini-Auftrag komplett durch die Pipeline laufen lassen und Ergebnis dokumentieren | Mittel |

### 3.2 Reihenfolge der Implementierung

1. E1 → E2 → E3 (Repo-Grundlage, ein PR oder zwei)
2. E4 (Skill) parallel zu E5 (CI)
3. E6 (Pilot) zuletzt — validiert alles

## 4. Testplan

- E2: Template-Render-Test (Issue über Web/gh anlegen, Felder erscheinen)
- E4: Dry-Run des Skills gegen Test-Issue (Worktree entsteht, Branch, kein Push ohne PR)
- E5: CI auf Test-PR grün
- E6: End-to-End-Durchlauf mit dokumentierten Artefakten (Issue-#, PR-#, Review-Kommentare)

## 5. Migration / Deployment

- Keine Migration (leeres Sandbox-Repo). Branch-Protection auf `main` erst aktivieren, wenn E5-CI stabil grün ist.

## 6. Referenzen

- [Konzept](01-konzept-agentic-workflow.md) · [Ist-Analyse](02-ist-analyse-agentic-workflow.md) · [Anforderungsanalyse](03-anforderungsanalyse-agentic-workflow.md)
- `agentic-workflow/report.md` (Deep-Research), `agentic-workflow/entwurf.md`
