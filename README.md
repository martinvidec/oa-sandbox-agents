# oa-sandbox-agents

Sandbox und Framework für Multi-Agent-Softwareentwicklung — GitHub als Rückgrat (Issues, PRs,
Labels, CI), Agenten arbeiten parallel in eigenen Worktrees. Kontext: [Open Austria](https://www.openaustria.org/).

## Architektur (Kurzüberblick)

- **Workflow-DSL:** [`workflow/registry.yaml`](workflow/registry.yaml) benennt die Workflow-Instanzen —
  aktuell zwei: [`claude-pipeline`](workflow/claude-pipeline/) (aktiv) und
  [`hermes-pipeline`](workflow/hermes-pipeline/) (Claude-Limit-Fallback). Eine Instanz besteht aus
  `roles.yaml`, `states.yaml`, `rules.yaml` und `pipeline.yaml`.
- **Generiertes Interface:** [`AGENTS.md`](AGENTS.md) ist dünn (Agent-Contract + aktiv-Block),
  die Details stehen generiert in [`WORKFLOW.md`](WORKFLOW.md) — Rollen-, Label-, Übergangs- und
  Pipeline-Tabellen, erzeugt mit `node scripts/render-workflow.mjs --write`. CI prüft generiert
  gegen eingecheckt.
- **Prüfung in drei Ebenen:** Validator (Schema/Linter, 160 Selbsttest-Fälle, in CI),
  Generierungs-Abgleich (generiert ≡ eingecheckt) und
  [Runtime-Replay](docs/validate-setup.md) (`scripts/replay-workflow.mjs` — prüft nach jedem
  Merge die gelebte Ausführung des Zyklus gegen die Regeln, Quelle: GitHub-Timeline + lokaler
  Git-Zustand).
- **Rollen:** Martin (Owner, mergt als Einziger) — Lead (Hermes) — Coder (Claude Code) —
  Reviewer — Researcher/Tester. Der Cleanup nach dem Merge ist der 5. Pipeline-Schritt.
- **Dogfooding:** das Framework entwickelt sich selbst — rund 30 validierte Pipeline-Zyklen.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Agent-Contract: Pflichtlektüre für jeden Agenten (Worktree-Konvention, Direktiven D1–D8) |
| [`WORKFLOW.md`](WORKFLOW.md) | Generiertes Interface des aktiven Workflows (Rollen, Labels, Übergänge, Regeln, Pipeline) |
| [`docs/workflow.md`](docs/workflow.md) | Kanonischer Ablauf, Review-Schleife, Workflow-Wechsel, Runtime-Replay |
| [`docs/validate-setup.md`](docs/validate-setup.md) | Prüfebenen, Skripte (Validator, Renderer, Replay), Befundkatalog, One-time Setup |
| [`docs/specs/dsl-workflow.md`](docs/specs/dsl-workflow.md) | Spec der Workflow-DSL |
| [`docs/schema.md`](docs/schema.md) | Generierte Schema-Doku (Keys, Datentypen, Enums, Constraints) — generiert aus `scripts/dsl-schemas.mjs`, CI prüft ≡ |
| [`docs/workflow-hochglanz.html`](docs/workflow-hochglanz.html) | Hochglanz-Darstellung (live via [GitHub Pages](https://martinvidec.github.io/oa-sandbox-agents/)) |
| [`agentic-workflow/`](agentic-workflow/) | Research: Entwurf, Report, Quellen |

## Benutzung (Kurzform)

1. Auftrag → [GitHub Issue](.github/ISSUE_TEMPLATE/) mit Akzeptanzkriterien, Label `agent:ready`.
2. Lead delegiert → Coder im eigenen Worktree (`worktrees/<issue-nr>-<slug>`, Branch `feat|fix|docs/<issue-nr>-<slug>`, Basis `origin/main`).
3. Implementierung, `git push -u origin HEAD`, Draft-PR mit `Closes #N`, CI grün belegen.
4. Reviewer-Run → Draft-Status weg → **Merge nur durch Martin** (D1).
5. Cleanup durch den Lead (Worktree + lokaler Branch), Runtime-Replay nach dem Merge.

Ein Workflow-Wechsel (z. B. auf `hermes-pipeline`) läuft über die Registry — die Prozedur
steht in [`docs/workflow.md`](docs/workflow.md), Abschnitt „Workflow-Wechsel“.

## Mitwirken

Vorschläge, Issues und Pull Requests sind willkommen — siehe [`AGENTS.md`](AGENTS.md)
für die Arbeitskonventionen.

---

*Dieses README wurde mit Unterstützung eines KI-Agenten erstellt.*
