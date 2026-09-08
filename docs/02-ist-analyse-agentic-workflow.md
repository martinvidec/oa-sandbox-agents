# Ist-Analyse: Agentic Multi-Agent Workflow

## 1. Aktueller Zustand

**Agenten-Landschaft (funktioniert bereits):**
- Hermes Lead (default-Profil) am Telegram-Bot, Empfang in Gruppe/Topics.
- `@research` (schnell) und `@deep-research` (Orchestrator mit Sub-Agents) via `hermes -p <profil> chat -q` im Hintergrund; Sub-Profile haben eigenen OPENROUTER_API_KEY.
- Claude Code v2.1.241 (Claude Max) als "force multiplier" für schweres Coding.
- Research-Pipeline etabliert: report.md + quellen.md, Kurzfassung ins Telegram-Topic.

**Repo oa-sandbox-agents (minimal):**
- Nur README.md, keine `AGENTS.md`/`CLAUDE.md`, keine Issue-Templates, kein Project-Board, keine definierten Labels, keine CI.

**Workflow-Praxis (aus school-flow übernommene Lektionen):**
- CLAUDE.md-Direktiven-Konvention bewährt (D1–D7: grünes CI vor Merge, deterministische E2E, native parent/sub-issues).
- GitHub Flow issue-basiert (Branch pro Issue, PR mit `Closes #N`).
- Kein Worktree-Setup vorhanden — bisher sequenzielle Arbeit, keine parallelen Coding-Agenten.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `agentic-workflow/entwurf.md` | Zielentwurf (v0.1, gebilligt) | Basis für die Spec |
| `agentic-workflow/report.md` | Deep-Research State of the Art 2026 | Belegbasis (worktrees, AGENTS.md, Pipeline) |
| `agentic-workflow/quellen.md` | 29 Quellen | Referenz |
| `~/.hermes/skills/delegate-research/` | Delegations-Skill Research | Erweiterungspunkt für Coding-Delegation |
| school-flow `CLAUDE.md` | Direktiven-Vorbild | Pattern-Quelle, wird nicht geändert |

## 3. Bestehende Abhängigkeiten

- GitHub-Auth: `silversurfer-openaustria-org` (Write auf oa-sandbox-agents ✅).
- Telegram Bot + Gruppe für Zustellung (Topics General=1, Research=2, DeepRes=3).
- Hermes-Profile default/research/deep-research; Claude Code lokal.

## 4. Bekannte Einschränkungen

- 403 auf oa-research (kein Write) — irrelevant nach Repo-Korrektur.
- Lokales macOS-System (RTX-3070-Angabe betrifft Martins anderes System): Worktree-Parallität durch RAM/Disk begrenzt → klein anfangen (2).
- GLM-5.3-flash als Bot-Modell: 24K-Kontext, gute Orchestrierung, kein Ersatz für Coding (dafür Claude Code).

## 5. Risiken bei Änderung

- Skills sind user-owned (Hintergrund-Curator darf sie nicht patchen) — Skill-Erweiterungen bewusst im Vordergrund machen.
- Parallele Agenten ohne Worktrees kollidieren (Cognition-These) — deshalb von Anfang an Worktree-Pflicht.
- Auto-Reviewer-False-Positives (arXiv 2607.21997) — Reviewer-Ergebnisse nur als Filter, nicht als Gate v1.
