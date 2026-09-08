# Agentic Multi-Agent Workflow für Software-Entwicklung mit gemeinsamem Git-Repository
## State of the Art 2026, KI-optimiert

**Suchdatum:** 2026-09-08 · **Autor:** @deep-research (Hermes Agent) · **Auftraggeber:** Martin (Solo-Entwickler, macOS)

---

## Executive Summary

Der Stand 2026 lässt sich in fünf Sätzen zusammenfassen:

1. **Multi-Agent ist für Recherche ideal, für Coding vorsichtig zu dosieren.** Die 2025er Cognition-These „Don't Build Multi-Agents" wurde 2026 präzisiert, nicht widerlegt: Multi-Agent funktioniert, wenn **Schreibzugriffe single-threaded bleiben** und Beiträger nur „Intelligenz" (Review, Recherche, Spezifikation) liefern — nicht parallel in dieselben Dateien schreiben (Cognition, „Multi-Agents: What's Actually Working", 04/2026).
2. **Die dominierende Architektur ist ein Lead/Orchestrator + Subagents** (Anthropic-Orchestrator-Worker-Pattern, Claude Code Subagents/Agent Teams, Copilot Agent HQ mit Claude/Codex) — nicht ein flaches „Team" aus gleichberechtigten Rollen.
3. **Isolation über git worktrees ist zum De-facto-Standard geworden** (Claude Code `-w`/`--worktree`, `.claude/worktrees/`, Hermes Worktree-Modus, Copilot-Agenten in ephemeren VMs, Codex-App). Parallelität ohne Worktrees gilt als Anfängerfehler.
4. **Das Repo selbst wird zum Agenten-Interface:** `AGENTS.md` (Linux-Foundation-Standard, 60.000+ Repos, native Lese-Unterstützung in 20+ Tools) + GitHub Issues als Auftragsqueue + Spec-Driven Development (GitHub Spec Kit: Constitution → Spec → Plan → Tasks → Implement) + GitHub MCP Server.
5. **Human-in-the-loop konzentriert sich auf Merge und Deploy.** Coding-Agenten (Copilot/Codex/Claude auf Agent HQ) dürfen per Design ihre eigenen PRs **nicht** selbst mergen; CI-Gates (Tests, Lint, Typecheck) + Protected Branch übernehmen die automatisierte Qualitätssicherung.

**Kernaussagen mit Confidence:**

| Kernaussage | Confidence | Begründung |
|---|---|---|
| Orchestrator+Subagents schlägt freie Agenten-Teams für Solo-Dev | **Hoch** | Konsens über Anthropic, Cognition, GitHub-Blog, Praxisberichte |
| git worktree pro parallel arbeitendem Agent | **Hoch** | In allen großen Tools nativ eingebaut; zahllose unabhängige Guides |
| AGENTS.md als Repo-Standard | **Hoch** | Linux-Foundation-Stewardship, 60k+ Repos; Claude Code nutzt CLAUDE.md (Import-Workaround) |
| Issues als Auftrags-Pipeline (Assign → Draft-PR → Review) | **Hoch** | Copilot Coding Agent, Codex auf Agent HQ, Claude — produktiv dokumentiert |
| Exakte Benchmarks (SWE-Bench-Zahlen, AI-PR-Anteile) | **Mittel** | Selbstberichtete Werte, Contamination-Caveats; sekundäre Quellen teilweise widersprüchlich |

---

## Teilfrage 1: Welche Agenten-Rollen braucht ein Multi-Agent-Softwareteam?

### 1.1 Die Debatte: Cognition vs. Anthropic — und ihre Auflösung 2026

- **Cognition (Walden Yan), „Don't Build Multi-Agents" (Mid-2025):** Zwei Prinzipien: (1) Kontext und vollständige Agent-Traces teilen, nicht nur Einzelbotschaften; (2) Aktionen tragen implizite Entscheidungen — parallele Agenten ohne geteilten Kontext treffen inkompatible Entscheidungen (Stil, Code-Patterns, Edge-Case-Behandlung) → fragiles Ergebnis.
- **Anthropic, „How we built our multi-agent research system" (06/2025):** Orchestrator-Worker-Architektur für **Recherche**: Lead-Researcher plant, spawnt 3–5 Subagents parallel, jeder mit eigenem Kontextfenster; +90,2 % gegenüber Einzel-Agent auf internem Research-Eval. Aber: ~15× Token-Kosten gegenüber Chat, 4× gegenüber Einzel-Agent; 80 % der Leistungsvarianz allein durch Token-Verbrauch erklärt.
- **Auflösung (2026):** Cognition revidiert in „Multi-Agents: What's Actually Working" (04/2026): Multi-Agent lohnt, wenn **Writes single-threaded** bleiben. Das funktionierende Muster: **Coder + unabhängiger Reviewer** („Devin Review") — der Reviewer startet mit **sauberem Kontext** (kein Bias des Schreibers) und findet im Schnitt ~2 Bugs pro PR, davon ~58 % schwere (Logikfehler, fehlende Edge Cases, Security). Devin und Devin Review iterieren now nativ gegeneinander, bevor ein Mensch den PR sieht.
- **Anthropic präzisiert ebenfalls** („Building multi-agent systems: When and how to use them"): Multi-Agent lohnt nur bei (a) Kontext-Pollution, (b) echter Parallelisierbarkeit, (c) klarer Spezialisierung. Sonst übersteigen die Koordinationskosten den Nutzen. Das konsistent funktionierende Muster: der **Verification Subagent** — ein dedizierter Tester/Validierer, der blackbox-testet, ohne die Entstehungsgeschichte zu kennen („Telephone-Game-Problem" umgangen).

### 1.2 Rollenmodell: was State of the Art ist, was überflüssig ist

**Bewährt (State of the Art):**

| Rolle | Evidenz | Bemerkung |
|---|---|---|
| **Orchestrator/Lead** | Anthropic LeadResearcher, Claude Code Main Session, Hermes Lead | Einziger Schreiber der Endsynthese; „one writer, one source of truth" |
| **Coder/Implementierer** | Devin, Claude Code, Codex, Copilot Coding Agent | Kernrolle; idealerweise mit isoliertem Worktree |
| **Tester/Verifier (unabhängig)** | Devin Review, Anthropic Verification-Subagent | **Wichtigste Zweitrolle**; sauberer Kontext ist der Qualitätshebel |
| **Code-Reviewer** | Devin Review, Copilot Code Review, Claude `/review`, pr-agent | Teilweise mit Tester identisch; Bias-Isolation durch eigenen Kontext |
| **Research/Spec-Agent** | Anthropic Research-Feature, Spec Kit `/speckit.specify` | Parallelisierbar (textbook multi-agent fit) |

**Überflüssig / Overhead für kleine Teams (Evidenz):**

- **Separater „Analyst" als eigenständige Dauerrolle** — geht im Orchestrator auf (der Lead zerlegt Aufgaben; Anthropic: „Teach the orchestrator how to delegate").
- **Mehrere gleichzeitige Coder ohne Geteilte-Verträge-Disziplin** — Cognition-Kernkritik; GitHub-Blog („Multi-agent workflows often fail") und Praxisberichte bestätigen: „bugs get fixed multiple times by different agents, designs occasionally go missing" (20–30-Parallel-Agenten-Berichte).
- **Dedizierter „QA-Manager"/„Project-Manager-Agent" als eigene Instanz** — Rollen-Duplikat des Orchestrators; Frameworks wie CrewAI/AutoGen machen das leicht, Praxisberichte zeigen hohen Koordinations-Overhead (Token-Explosion: jede Botschaft wird N-mal verarbeitet).
- **Meta-Punkt:** Anthropics 2026 Agentic Coding Trends Report: Multi-Agent „doesn't make sense for 95% of agent-assisted development tasks" (zit. nach Praxisbericht dev.to/javatarz, 04/2026). Nützlich v. a. bei **groomed Backlog unabhängiger Karten**.

### 1.3 Framework-Landschaft (Kurzbeurteilung)

| Framework | Typ | Eignung Solo-Dev |
|---|---|---|
| **Claude Code (Subagents/Agent Teams)** | CLI + nativer Orchestrator | ★★★ — Subagents (`.claude/agents/`), `-w` Worktrees, Hooks, GitHub Actions |
| **Hermes Agent** | CLI/Gateway-Orchestrator | ★★★ — delegate_task, tmux-Spawning, Worktree-Modus `-w`, cron |
| **OpenAI Codex (CLI + Agent HQ)** | CLI + Cloud-Agent | ★★★ — als Zweitagent; auf GitHub Agent HQ Issue-Assignable (seit 02/2026) |
| **GitHub Copilot Coding Agent** | Cloud (Actions/Codespaces) | ★★★ — Issue→PR-Pipeline ohne lokale Infra |
| **Devin (Cognition)** | Cloud-Agent + Review | ★★ — stark bei asynchroner Backlog-Abarbeitung, teuer |
| **OpenHands / SWE-agent** | Open-Source-Agenten | ★★ — Forschungs-nah, Scaffold-Arbeit nötig |
| **Aider** | CLI-Pair-Programmer | ★★ — solide, aber kein Multi-Agent-Orchestrator |
| **LangGraph / CrewAI / AutoGen** | Agent-Frameworks | ★ — für Solo-Dev-Workflows Overhead; nützlich, wenn man eigene Produkte baut, nicht um eigene Dev-Pipeline zu betreiben |
| **Copilot Workspace** | Legacy | — weitgehend vom Coding Agent abgelöst |

---

## Teilfrage 2: Repo-Handling — Worktrees, Isolation, Branch-Strategie

### 2.1 Das Isolations-Primitiv: git worktree

**Konsens 2026: Ein Worktree pro parallel arbeitendem Agent.** Gründe:

- Worktree = zweites Arbeitsverzeichnis, eigener Branch, eigene Dateien auf Disk; nur `.git`-Historie und Remote werden geteilt. Zwei Agenten können unabhängig editieren, testen, committen — „Nothing collides because nothing overlaps".
- Boris Cherny (Claude-Code-Erfinder, 02/2026): „Spin up 3–5 git worktrees at once, each running its own Claude session in parallel. It's the single biggest productivity unlock."
- **Nativ unterstützt in:** Claude Code (`claude -w feature-x` → `.claude/worktrees/<name>`, Branch `worktree-<name>`; `/batch` erzeugt 5–30 Worktrees für große mechanische Änderungen; Subagent-Frontmatter `isolation: worktree`), Hermes (`-w` Worktree-Modus), Codex-App (macOS Command-Center, 02/2026), Copilot/Codex-Cloud-Agenten (jede Session in ephemerer VM — Isolation inklusive, aber ohne lokale Kontrolle).
- **Wann etwas anderes gilt:** Cloud-Agenten (Copilot Coding Agent, Devin, Codex-Cloud) bringen ihre eigene Isolation mit — lokal braucht man dann gar kein Worktree-Management. Separate Vollklone (z. B. GitHub-Actions-Runner) nur, wenn die Toolchain zwingend Repo-Root-Annahmen hat.

**Vergleich (nach DevToolLab/Nimbalyst, 2026):**

| Ansatz | Isoliert | Geeignet für |
|---|---|---|
| Worktrees | Datei-Edits (Verzeichnis + Branch) | Unabhängige Tasks: Feature + Bugfix |
| Subagents (in einer Session) | nichts (nur Kontext) | Delegation innerhalb eines Tasks |
| Subagent + `isolation: worktree` | Edits + Kontext | Parallele Sub-Tasks in einer Session |
| Agent Teams | Koordination über Sessions | Ein Ziel, das sich splitten lässt (experimentell) |
| Separate Clones | alles | Cloud-CI, schwergewichtige Umgebungen |

**Bekannte Fallstricke (praxisdokumentiert):**

- **Ports/Runtimes:** Worktrees isolieren Code, nicht Laufzeitumgebungen. Dev-Server: unterschiedliche Ports pro Worktree (`PORT=3001 …`) oder Docker-Compose mit gemappten Ports.
- **Disk:** 2-GB-Repo × 4 Worktrees ≈ 10 GB. `node_modules`/venv pro Worktree neu aufsetzen oder Symlink/Cache-Strategie.
- **Branch-Locking:** Ein Branch kann nur in einem Worktree ausgecheckt sein → pro Worktree immer eigenen Branch anlegen.
- **Index-Lock-Konflikte:** nur bei gemeinsam genutztem `.git`-Verzeichnis relevant; Worktree-Operationen sind davon weitgehend befreit, aber nicht parallel `git gc`/`git commit` auf demselben Worktree fahren.
- **Umgebungskopie:** `.env` muss pro Worktree vorhanden sein (Claude Code bietet Env-File-Diff-Checker).
- **Merge-Disziplin:** Kleine, disziplinierte PRs; Rebase vor Merge; bei Konflikten Prioritäten-Regel im Agenten-Prompt hinterlegen (Praxisbericht: „rebase before pull"-Modell an den Agenten delegiert).

### 2.2 Branch-Strategie

- **Issue-based GitHub Flow** hat sich als Standard für Agenten-Workflows durchgesetzt: ein Issue = ein kurzlebiger Branch = ein PR. Passt zum Cloud-Agent-Design (Copilot/Codex öffnen automatisch Branch + Draft-PR pro Issue) und zu „small PRs" als KI-Freundlichkeits-Hebel.
- **Trunk-based** bleibt das Zielbild auf der Main-Seite: kurze Lebensdauer der Agent-Branches, schneller Merge nach CI + Review, Feature-Flags statt langer Feature-Branches. Feature-Branch-Disziplin (GitFlow) ist für Agenten-Teams kontraproduktiv (Konfliktfläche wächst mit Branch-Alter).
- **Scott Chacon's Grit-Projekt** (kompletter Git-Rewrite in Rust mit Agenten, ~45 Mrd. Tokens: 14B Claude Code, 12B Cursor/GPT/Codex, 16B Cursor composer-2) ist der größte öffentlich dokumentierte Parallel-Agent-Run und bestätigt: ohne Worktrees + Merge-Disziplin kollabiert es.

---

## Teilfrage 3: Issues, Spezifikation und Doku

### 3.1 GitHub Issues + Projects als Single Source of Truth

- **Ja, mit Einschränkungen.** Copilot Coding Agent und Codex/Claude auf Agent HQ machen das Issue zur primären Auftragseinheit: Assignee-Dropdown (auch `gh issue assign 142 --assignee @codex`), Issue-Kommentare als Feedback-Kanal (`@codex` Mention im PR iteriert den Draft), Live-Agent-Status in Issues und Projects (03/2026).
- **Copilot kann Issues selbst erstellen:** aus natürlichsprachlichem Prompt, inkl. Issue-Templates, Sub-Issue-Bäume (Epic → Features → Tasks) und Labels. Damit wird „Planung → Backlog" selbst agentisch.
- **Grenze:** Issues sind gut für „was soll passieren", schwach für Querbezüge (Architektur-Entscheidungen, Verträge). Deshalb: Specs und ADRs im Repo, Issues nur als operative Queue.

### 3.2 Spec-Driven Development

- **GitHub Spec Kit** (120.000+ Stars, 30+ Agent-Integrationen) hat die Methodik populär gemacht. Pipeline: `/speckit.constitution` (nicht-verhandelbare Prinzipien) → `/speckit.specify` (spec.md: User Stories, Anforderungen, Akzeptanzkriterien) → `/speckit.plan` (technischer Plan) → `/speckit.tasks` (abhängigkeitsbewusste Task-Liste, parallelisierbare Tasks markiert) → `/speckit.implement`. Optional: `/speckit.clarify`, `/speckit.analyze` (Konsistenz-Check), `/speckit.checklist` (Qualitäts-Gates), `/speckit.taskstoissues` (Tasks → GitHub Issues).
- **AWS Kiro** verfolgt dasselbe Prinzip (Specs als First-Class-Artefakt vor Code). **PRD-Files** (docs/prd/) sind die leichtgewichtige Variante.
- **Bewertung für Solo-Dev:** Spec Kit ist der niedrigschwelligste Einstieg — es ist nur ein Satz Markdown-Artefakte plus Agent-Slash-Commands, kein Framework-Lock-in. Jedes Artefakt füttert das nächste: der Agent hat strukturierten Kontext statt Ad-hoc-Prompts.

### 3.3 ADRs

Architecture Decision Records (docs/adr/NNNN-titel.md) bewähren sich im Agenten-Kontext als **persistentes Entscheidungs-Gedächtnis**: Agenten, die neu starten, verlieren Kontext (Cognitions Kernproblem) — ADRs sind die Datei-basierte Gegenmaßnahme. Empfehlung: leichtgewichtig (1 Seite pro Entscheidung), vom Orchestrator-Agent bei Architekturentscheidungen angelegt, in AGENTS.md verlinkt.

### 3.4 AGENTS.md / CLAUDE.md

- **AGENTS.md** ist 2026 der De-facto-Standard: plain Markdown im Repo-Root, stewarded von der **Agentic AI Foundation (Linux Foundation)**, **60.000+ Repos**, native Unterstützung in OpenAI Codex, Copilot, Cursor, Windsurf, Aider, Devin, Zed, Jules u. v. m. OpenAIs eigenes Monorepo shippt **88 nested AGENTS.md** (nächstgelegene Datei gewinnt — Monorepo-Pattern).
- **Claude Code ist die Ausnahme:** liest `CLAUDE.md`. Standard-Workaround: `CLAUDE.md` importiert `@AGENTS.md` (Symlink oder eine Import-Zeile) — so ist eine Datei kanonisch und beide Tools bedient.
- **Was rein gehört:** Stack, Build-/Test-/Lint-Kommandos (exakt!), Verzeichnis-Layout, Code-Stil-Konventionen, Branch-/Commit-Konventionen, Tabus („don't touch src/legacy/", „keine Dependencies ohne Nachfrage"), Definition of Done. Spezifisch schlägt allgemein: „2-space indentation for JS" statt „write good code".
- **Stale-Regel:** Veraltete AGENTS.md ist schlimmer als keine — im selben PR aktualisieren wie die Änderung, die sie betrifft.

### 3.5 Doku-Struktur im Repo (Empfehlung)

```
repo/
├── AGENTS.md              ← kanonisch, von allen Agenten gelesen
├── CLAUDE.md              ← Import-Zeile: @AGENTS.md (+ Claude-Spezifika)
├── README.md              ← menschliche Kurzeinführung
├── docs/
│   ├── prd/               ← PRDs / Feature-Specs (spec.md-artig)
│   ├── adr/               ← Architecture Decision Records
│   ├── architecture.md    ← Code-Map, Module-Übersicht
│   └── llms.txt           ← optional: Maschinen-Index der Doku
├── .specify/              ← Spec Kit Templates (falls genutzt)
├── .claude/
│   ├── agents/            ← Subagent-Definitionen (versioniert!)
│   ├── commands/          ← Projekt-Slash-Commands
│   └── settings.json      ← Hooks, Permissions (geteilt)
└── .github/
    ├── workflows/         ← CI
    ├── ISSUE_TEMPLATE/    ← Issue-Templates
    └── copilot-instructions.md  ← falls Copilot-Agent genutzt wird
```

---

## Teilfrage 4: Arbeitsaufträge erteilen — die Issue→PR-Pipeline

### 4.1 Der Standard-Loop 2026 (Copilot/Codex/Claude auf Agent HQ)

1. **Prompt → Issue:** Mensch (oder Orchestrator-Agent) formuliert; Copilot kann aus Chat-Skizze strukturierte Issues mit Akzeptanzkriterien + Sub-Issue-Baum entwerfen.
2. **Issue → Agent:** Assignee-Dropdown oder `gh issue assign N --assignee @copilot|@codex`. Der Agent erhält Titel, Body, alle Kommentare + Repo-Instruktionen (AGENTS.md / copilot-instructions.md).
3. **Agent arbeitet:** eigene Branch, ephemere VM (Copilot) bzw. eigene Session; kopilot-setup-steps.yml konfiguriert die Dev-Environment; Agent respektiert Custom Instructions (z. B. „npm run lint && npm run test müssen vor Commit grün sein").
4. **Draft-PR:** Agent öffnet Draft-PR (Codex: sofort leerer Draft-PR als Branch-Anker), pusht inkrementell, hält PR-Beschreibung aktuell (Task-Checkliste).
5. **Review:** Mensch reviewed; Änderungswünsche als PR-Kommentar mit `@codex`/`@copilot`-Mention → Agent iteriert.
6. **Merge:** **Nur der Mensch merged.** Codex/Copilot/Claude können eigene PRs weder ready-for-review promoten noch mergen — das ist das eingebaute Human-in-the-Loop-Design.

### 4.2 Issue-Templates als Agenten-Verträge

Gute Agent-Issues enthalten (GitHub-Blog-Empfehlung): Problem-Statement/Overview, **Akzeptanzkriterien** (prüfbar!), betroffene Dateien/Module, Out-of-Scope, ggf. Referenz auf Spec/ADR. Regel: „Keep issues tightly scoped" — ein Issue = ein PR-würdiges Increment. Batch-Muster: 10–20 gut gescopte Issues anlegen und parallel auf verschiedene Agenten verteilen (Codex/Copilot/Claude gemischt) — GitHub-Infrastruktur kümmert sich um Isolation.

### 4.3 CI-Gates

Merge-Blocker (protected main): **Tests** (Unit + kritische Integration), **Lint**, **Typecheck**. Das ist zugleich die Agenten-Rückkopplungsschleife: Agenten, die gegen CI laufen, korrigieren selbst (Loop bis grün oder Budget-Stop). Empfehlung zusätzlich: Coverage-Schwelle nur wo sinnvoll (nie als härtes Gate für agentische Refactor-PRs ohne Baseline).

### 4.4 Auto-Review

- **Copilot Code Review:** Reviewer-Auswahl „Copilot" oder automatisch für jeden PR; Limits: ≤100 geänderte Dateien, ≤10 GB Repo.
- **Devin Review:** findet im Schnitt ~2 Bugs/PR (58 % schwerwiegend); iteriert nativ gegen den Coder-Agenten.
- **pr-agent (Qodo)** und Claude `/review` / `/security-review`: gut für strukturierte Erst-Reviews (Changelog, Tests-vermisse-Check, Security-Scan).
- **Grenze (wichtig):** Studie „Go Home Copilot, You're Drunk" (arXiv 2026): erheblicher Anteil der Agent-Review-Kommentare sind **False Positives** oder verfehlen projekt-spezifische Design-Entscheidungen → Vertrauenserosion, wenn ungefiltert. Praxis-Regel: Agent-Review als **Filter vor** dem menschlichen Review, nicht als Ersatz; Review-Instruktionen im Repo pflegen und den Reviewer periodisch kalibrieren („review the reviewer").

### 4.5 Human-in-the-Loop-Punkte (konsolidiert)

1. **Issue-Freigabe** bei größeren Features (Spec akzeptieren) — oder at least Spec-Review.
2. **Merge-Gate:** protected main + required review; Agent kann nicht selbst mergen.
3. **Deploy:** menschlicher Trigger (oder separate Deploy-Approval-Umgebung).
4. **Ambiguitäten:** Issue-Kommentar-Thread als Eskalationskanal; Agent stoppt und fragt (Devin/Copilot-Verhalten).
5. **Budget/Laufzeit-Stopps:** bei lokalen Agenten `--max-turns`/`--max-budget-usd` setzen.

---

## Teilfrage 5: KI-optimiertes Repo — konkret & messbar

### 5.1 Definition

Ein KI-optimiertes Repo ist eines, in dem ein Agent **ohne Rückfragen** (a) versteht, was zu tun ist (Issues/Specs), (b) wie es bauen/testen soll (AGENTS.md, exakte Kommandos), (c) ob es erfolgreich war (CI + testbare Definition of Done), und (d) nichts kaputt macht (Worktree-Isolation, Protected Branch, Tabus in AGENTS.md). Konkret:

1. **Maschinen-lesbare Doku:** AGENTS.md (+ nested in Monorepos), llms.txt als Doku-Index, OpenAPI/JSON-Schema als explizite Verträge, Architecture-Map.
2. **Kleine PRs:** Review-Zeit sinkt mit Diff-Größe; Agent-PRs waiten ohnehin 4,6× länger auf erstes Review als human PRs (Encore/DX-Daten 2026) — Kleinteiligkeit ist der Gegenhebel. Acceptance-Rate agentischer PRs: 32,7 % vs. 84,4 % human (Encore „State of AI-Native Software Delivery 2026") → Qualität + Reviewbarkeit sind der Engpass, nicht die Generierung.
3. **Klare Contracts:** Modulgrenzen + Schnittstellen (Typen, Schemas, OpenAPI) so, dass parallele Agenten an getrennten Verträgen arbeiten können — das ist die praktische Lösung des Cognition-Problems (implizite Entscheidungen): explizite Verträge statt geteiltem Kontext.
4. **Testbare Definition of Done:** Jedes Issue mit prüfbaren Akzeptanzkriterien, die in Tests übersetzbar sind. „Tests als Verifikationsquelle": der Verification-Subagent blackbox-testet gegen Kriterien, nicht gegen Intention.
5. **MCP-Tools:** GitHub MCP Server (offiziell, remote nutzbar) für Issues/PRs/Repos; Filesystem-MCP; MCP ist 2026 das Ökosystem-Standard-Protokoll (von Anthropic 2024 initiiert, inzwischen in Copilot, Codex, Claude Code, Hermes, Cursor nativ). Tool-Beschreibungen sind qualitätskritisch (Anthropic: Tool-Testing-Agent verbesserte Task-Zeiten um 40 %).

### 5.2 Benchmarks & Praxiszahlen (mit Vorbehalten)

- **SWE-Bench Verified:** 500 human-verifizierte GitHub-Issues, Scoring per echter Test-Ausführung. Stand 09/2026: **Claude Opus 5 ~96 %** (Vals.ai unabhängig: 97,0 % ±0,76, bash-only-Harness), GPT-5.3 Codex ~85 %, Open-Weights-Spitze (GLM-5.x, DeepSeek V4, Kimi K2.6, MiniMax M2.5) ~80 %. **Caveat:** Benchmark weitgehend saturiert und kontaminationsgefährdet; Aussagekraft liegt inzwischen in within-benchmark-Rankings, nicht in Absolutwerten. Praktische Konsequenz für Martin: Einzelfallaufgaben sind im Schnitt lösbar — die Herausforderung liegt in Orchestrierung, nicht in Puzzle-Kompetenz.
- **AI-Code-Anteil:** GitHub Octoverse 2026: ~40 % des neuen Codes auf GitHub KI-assistiert/erzeugt (Sekundärquellen nennen 40–41 %); Google: 75 % des neuen Codes KI-generiert und von Ingenieuren approved (04/2026). **Caveat:** Zählmethodiken stark unterschiedlich (Autocomplete zählt mit), Zahlen aus Sekundärberichten teils inkonsistent.
- **Qualitäts-Realität:** Sentry 2026: Fehlerquoten KI-generierter Dateien in den ersten 48 h ~2,3× höher; Opsera: +15–18 % Security-Vulnerabilities; agentische PRs: geringere Acceptance-Rate (32,7 % vs. 84,4 %). METR-RCT: passive KI-Nutzung kann sogar ~19 % verlangsamen — aktives Steering + Review ist der Unterschiedsmacher. **Interpretation:** Multi-Agent-Setup ohne Review-/CI-Schleife verschlechtert die Qualität; mit richtiger Schleife (Devin-Review-Muster, CI-Gates) gewinnt man die Zeit zurück.
- **NBER 02/2026:** 89 % der Firmen berichten null Produktivitätseffekt durch KI — der Unterschied zu den 30–50 %-Beschleunigungs-Berichten liegt in der Infrastruktur um das Modell (Workflows, Gates, Specs), nicht im Modell.

### 5.3 Anti-Patterns

- Paralleles Schreiben ohne explizite Verträge (Cognitions Flappy-Bird-Beispiel: zwei UI-Agenten, zwei Stile).
- Zu große Kontexte (>70–85 % Kontextfenster: Qualitätsabfall, Halluzinationsspitzen — Claude-Code-Doku `/context`).
- Fehlende Tests → Agent hat keine Rückkopplung, „halluziniert Erfolg".
- Stale AGENTS.md/CLAUDE.md.
- 50 Subagents für simple Tasks (Anthropic-Frühversagen); ohne Effort-Scaling-Regeln im Prompt.
- Ungefiltertes Vertrauen in Agent-Review-Kommentare (False-Positive-Rate).

---

## Teilfrage 6: Zielentwurf für Martin (Solo, macOS, Claude Code + Hermes, GitHub)

### 6.1 Architektur-Entscheidungen

| Entscheidung | Empfehlung | Begründung |
|---|---|---|
| Team-Form | **Hermes als Lead/Orchestrator + Claude Code als Coder-Instanzen**; keine flachen Agent-Teams | Orchestrator-Worker-Konsens; Schreibzugriffe bleiben pro Task single-threaded |
| Parallelität | **2–4 Worktrees** (`claude -w <task>` bzw. Hermes-Worktree-Modus), nicht mehr | Cherny-Empfehlung 3–5; Solo-Review-Kapazität ist der echte Flaschenhals |
| Auftragskanal | **GitHub Issues** (Templates mit Akzeptanzkriterien) + GitHub Projects Board | Agent HQ/gh-CLI-kompatibel; Issue = Branch = PR |
| Spec-Ebene | **GitHub Spec Kit** für Features > „klein"; PRD-Files für den Rest | Markdown-Artefakte, kein Lock-in, 30+ Agent-Integrationen |
| Repo-Doku | **AGENTS.md kanonisch + CLAUDE.md importiert @AGENTS.md**, ADRs in docs/adr/ | 60k-Repo-Standard + Claude-Workaround |
| CI | Tests + Lint + Typecheck als Merge-Blocker auf protected main | Agenten-Rückkopplungsschleife + Qualitäts-Gate |
| Review | Claude `/review` oder Copilot Code Review als Filter-1, **Mensch als Reviewer-2 und Merge-Owner** | False-Positive-Rate der Auto-Reviewer; Merge-Verbot für Agenten |
| Frameworks (LangGraph/CrewAI/AutoGen) | **Nicht verwenden** | Für den eigenen Dev-Workflow Overhead; Claude Code/Hermes decken Orchestrierung nativ ab |
| Cloud-Agent-Ergänzung | Optional: Codex oder Copilot Coding Agent für Backlog-Batches über Nacht | Issue→PR ohne lokale Ressourcen; epheme VMs |

### 6.2 Konkreter Ablauf (ein Feature)

```
1. Martin: Idee → Hermes-Orchestrator: "Spezifiziere Feature X"
   → Spec Kit: /speckit.specify + /speckit.plan (Martin reviewed spec.md)
2. Orchestrator zerlegt in Tasks → /speckit.taskstoissues bzw. gh issue create
   (Template: Akzeptanzkriterien, betroffene Module, Out-of-Scope)
3. Pro Issue: gh issue assign / lokal: claude -w issue-<nr>  (Worktree, eigener Branch)
   Claude Code implementiert, läuft Tests lokal, pusht auf Branch feature/issue-<nr>,
   öffnet Draft-PR (gh pr create --draft)
4. CI (GitHub Actions): tests + lint + typecheck als required checks
5. Review-Schleife: Claude-Review-Subagent (clean context!) prüft Diff →
   Befunde in PR-Kommentar → Coder-Agent iteriert (max. 2 Zyklen) →
   Martin reviewed und merged (einziger Merge-Owner)
6. Merge → Issue schließt automatisch (closes #N im PR-Body)
7. ADR bei Architekturentscheidungen; AGENTS.md-Update im selben PR
```

### 6.3 macOS-Setup-Details

- **gh CLI** authentifiziert; `gh issue assign N --assignee @codex` für Cloud-Batches.
- **Claude Code:** `npm install -g @anthropic-ai/claude-code`; Subagents in `.claude/agents/` (versioniert); Hooks in `.claude/settings.json` (PostToolUse: Auto-Lint; PreToolUse: Blocker für `rm -rf`, force-push); Budget-Guards `--max-turns`, `--max-budget-usd` in Print-Modus.
- **Permissions:** Für unbeaufsichtigte Läufe nie `--dangerously-skip-permissions` ohne enges `--allowedTools`-Set; Push-Schutz via Settings (`ask: ["Bash(git push*)"]`); für Cloud-Agenten via Agent HQ braucht es nichts Lokales.
- **Ports/Env pro Worktree** (PORT=3001/3002 …, .env kopieren), Disk-Budget im Blick behalten.
- **Kostenrealität:** Grit-Projekt: 45 Mrd. Tokens für einen Groß-Umbau; Anthropic-C-Compiler-Projekt: $20k API für 16 Agenten/100k LOC. Für Martin: Parallelität klein halten, einfache Tasks an Haiku/Sonnet-Klasse, Budget-Caps pro Run; Anthropic-Report-Einschätzung nutzen (95 % der Tasks brauchen kein Multi-Agent) — erst parallelisieren, wenn Backlog-Disziplin steht.

### 6.4 Was Martin bewusst NICHT braucht

- Kein eigenes Orchestrator-Framework (LangGraph/AutoGen/CrewAI) für den Dev-Workflow.
- Keine eigene Infrastruktur (GitHub Actions + Agent HQ reichen; keine self-hosted Runner nötig).
- Kein 8-Rollen-Org-Chart — 3 Rollen reichen praktisch: Orchestrator, Coder(+Worktree), Verifier/Reviewer.
- Keine Langzeit-„Agenten-Persönlichkeiten" mit persistentem Memory im Repo — Kontext steckt in AGENTS.md/Specs/Issues, nicht in Agenten-Instanzen.

---

## Risiken & Caveats

1. **Benchmarks saturiert/kontaminationsgefährdet:** SWE-Bench-Topwerte (>90 %) nicht als Praxisgarantie lesen (audit-kritische Hinweise auf flawed tests bei hohen Scores).
2. **Statistiken zu AI-Code-Anteil** stammen teilweise aus Content-Marketing-Sekundärquellen (justanalytics, neosantara, dev.to) und widersprechen sich im Detail; die belastbareren Zahlen sind Google-Selbstauskunft (75 %) und Encore/DX-Reports (Review-Bottleneck). **Confidence: mittel.**
3. **Agent-Review-Verlässlichkeit:** dokumentierte False-Positive-Problematik (arXiv-Studie); Auto-Review ersetzt menschliches Review nicht.
4. **Schnelle Tool-Rotation:** Copilot Workspace weitgehend abgelöst, Agent-Teams noch experimentell (Feature-Flag), Hermes-/Claude-Code-Features ändern monatlich — Details vor Umsetzung gegen aktuelle Docs prüfen.
5. **Token-Kosten:** Multi-Agent kostet real 4–15× Einzel-Agent (Anthropic-Eigenmessung); bei Solo-Budget Parallelität und Modellklasse pro Rolle bewusst wählen.

## Offene Fragen

- Wie stabil bleibt Agent HQ als Multi-Vendor-Anker (Codex + Claude + Copilot in einer Queue) über 2026/2027?
- Reift Claude-Code-native AGENTS.md-Unterstützung (Stand: CLAUDE.md-Import-Workaround)?
- Praktikable Workflow-Automatisierung „Agent zieht selbst aus dem Ready-Backlog" (aktuell noch menschlich getriggert / bewacht)?

---

*Vollständige Quellenliste mit URLs und Bewertung: siehe quellen.md im selben Ordner.*
