# Quellen — Agentic Multi-Agent Workflow 2026

**Suchdatum:** 2026-09-08 · Primär = Original-Doku/Eigenbericht des Anbieters; Sekundär = Analyse/Zusammenfassung Dritter.

## Teil 1: Multi-Agent-Rollen & Debatten (F1)

1. **Cognition — „Multi-Agents: What's Actually Working" (Walden Yan, 04/2026)** — https://cognition.ai/blog/multi-agents-working — PRIMÄR. Revision von „Don't Build Multi-Agents": Multi-Agent funktioniert mit single-threaded Writes; Devin Review findet ~2 Bugs/PR (58 % schwer). Kein Affiliate-Bias, aber Eigeninteresse (Devin).
2. **Anthropic — „How we built our multi-agent research system" (06/2025)** — https://www.anthropic.com/engineering/multi-agent-research-system — PRIMÄR. Orchestrator-Worker, +90,2 % vs. Single-Agent, ~15× Token-Kosten, 80 % Varianz durch Token-Usage, 8 Prompt-Prinzipien.
3. **Anthropic — „Building multi-agent systems: When and how to use them"** — https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them — PRIMÄR. Drei Situationen, in denen Multi-Agent gewinnt; Verification-Subagent-Muster; 3–10× Token-Kosten.
4. **Claude Code Docs — Subagents** — https://code.claude.com/docs/en/sub-agents — PRIMÄR. Kontext-Isolation, Parallel-Research, Best Practices.
5. **Claude Code Docs — Agent Teams** — https://code.claude.com/docs/en/agent-teams — PRIMÄR. Team Lead + Teammates, experimentell.
6. **„Why multi-agent workflows fail in production"** — https://openwalrus.xyz/blog/multi-agent-coordination — SEKUNDÄR. Überblick Failure Modes (Kontext reist nicht, Cloud-Umgebungsfehler bei Cursor).
7. **„The Agentic Org Chart" (codewithrashid)** — https://codewithrashid.com/blog/day-7-multi-agent — SEKUNDÄR. Gute Aufarbeitung der Cognition-Revision („writes single-threaded, agents contribute intelligence").
8. **„One Agent or Fifteen?" (noderguru)** — https://noderguru.dev/en/blog/multi-agent-system-architecture-en — SEKUNDÄR. Task-Shape-Heuristik: Research = Multi-Agent-fit, Coding = Anti-fit.
9. **arXiv — „Why Do Multi-Agent LLM Systems Fail" (via Sekundärquellen referenziert)** — Primärquelle nicht direkt geprüft — UNSICHERHEIT: nur über Zweittexte erfasst.

## Teil 2: Repo-Handling & Worktrees (F2)

10. **Claude Code Docs — Worktrees (via 13labs-Guide)** — https://code.claude.com/docs/en/worktrees (referenziert in [11]) — PRIMÄR. `-w` → `.claude/worktrees/<name>`, Branch `worktree-<name>`.
11. **13labs — „Run Parallel AI Coding Agents Without Conflicts"** — https://13labs.au/guides/run-parallel-ai-coding-agents-without-conflicts — SEKUNDÄR. Worktree pro Agent, Budget-Caps, 24h-Autonomie-Bericht (Khmelinskaya, 05/2026).
12. **DevToolLab — „Claude Code Git Worktrees: Run 5 AI Agents in Parallel (2026)"** — https://devtoollab.com/blog/claude-code-git-worktrees-parallel-agents-guide-2026 — SEKUNDÄR (vorsichtig: Content-Site). Cherny-Tipp (02/2026), Ansatz-Vergleichstabelle.
13. **Nimbalyst — „Git Worktrees for AI Coding Agents: Complete Guide"** — https://nimbalyst.com/blog/git-worktrees-for-ai-coding-agents-complete-guide — SEKUNDÄR. Branch-Locking, agentree-Tool, Fallstricke (package.json-Race).
14. **noqta — „Git Worktrees for Parallel AI Agents: 2026 Guide"** — https://noqta.tn/en/blog/git-worktrees-parallel-ai-coding-agents-guide-2026 — SEKUNDÄR. Port-Konflikte, Disk-Verbrauch, Grok Build (SWE-Bench 70,8 %).
15. **agentic.schule — „One Trunk, Many Branches"** — https://agentic.schule/en/blog/2026-07-agentic-coding-git-worktrees — SEKUNDÄR. Trunk-based + kurze Agent-Branches.
16. **developersdigest — „Git Worktrees + Claude Code: The 2026 Playbook"** — https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide — SEKUNDÄR. Grit-Projekt-Post-mortem (Scott Chacon, ~45 Mrd. Tokens: 14B Claude Code / 12B Cursor+GPT / 16B composer-2), Conductor-Mac-App.
17. **GitButler-Blog — Grit-Projekt-Post-mortem (via [16] referenziert)** — nicht direkt extrahiert — SEKUNDÄR/PRIMÄR.

## Teil 3: Issues, Specs, Doku (F3)

18. **agents.md (offizielle Spec-Seite)** — https://agents.md/ — PRIMÄR. Spec, Monorepo-Nesting (88 Dateien im OpenAI-Repo), Linux-Foundation-Stewardship via Agentic AI Foundation.
19. **codersera — „AGENTS.md Complete Guide 2026" (23.05.2026)** — https://codersera.com/blog/agents-md-complete-guide-2026/ — SEKUNDÄR. 60.000+ Repos, Tool-Matrix (Claude Code: CLAUDE.md-Workaround `@AGENTS.md`), GitHub-Blog-Referenz „lessons from 2,500+ repos".
20. **genno-whittlery — „2026-agents-md-standard.md"** — https://github.com/genno-whittlery/agent-notes/blob/main/2026-agents-md-standard.md — SEKUNDÄR (persönliche Notizen, vorsichtig). Adoption-Map: Claude Code No / Gemini CLI No, Rest Yes.
21. **GitHub Spec Kit — offizielle Doku** — https://github.github.com/spec-kit/ + https://github.com/github/spec-kit — PRIMÄR. Spec→Plan→Tasks→Implement, 30+ Agent-Integrationen.
22. **Shiplight — „GitHub Spec Kit Workflow: A Practical Guide"** — https://www.shiplight.ai/blog/spec-driven-development-with-spec-kit — SEKUNDÄR (Product-Blog der Firma, aber methodisch sauber). Befehls-Pipeline inkl. `/speckit.taskstoissues`, 120k+ Stars.
23. **github/spec-kit — AGENTS.md des eigenen Repos** — https://github.com/github/spec-kit/blob/main/AGENTS.md — PRIMÄR (Beispiel-Datei).

## Teil 4: Auftrags-Pipeline & Auto-Review (F4)

24. **GitHub Docs — Copilot create/update issues** — https://docs.github.com/en/copilot/how-tos/copilot-on-github/copilot-for-github-tasks/use-copilot-to-create-or-update-issues — PRIMÄR. Issue-Drafting, Sub-Issue-Bäume, Assign-to-Copilot.
25. **GitHub Blog — „From idea to PR: Copilot's agentic workflows"** — https://github.blog/ai-and-ml/github-copilot/from-idea-to-pr-a-guide-to-github-copilots-agentic-workflows/ — PRIMÄR. Issue→Branch→Draft-PR-Loop, copilot-setup-steps.yml, Do/Don't-Tabelle.
26. **codex.danielvaughan.com — „Codex as a GitHub Copilot Coding Agent" (03/2026)** — https://codex.danielvaughan.com/2026/03/28/codex-github-copilot-coding-agent-issue-assignment/ — SEKUNDÄR. Agent HQ: Claude+Codex issue-assignable (Changelog 26.02.2026), `gh issue assign N --assignee @codex`, Merge-Verbot für Agenten, Batch-Muster 10–20 Issues.
27. **Microsoft Learn — Copilot Code Review (Azure DevOps)** — https://learn.microsoft.com/en-us/azure/devops/repos/git/copilot-code-reviews — PRIMÄR. Limits: ≤100 Dateien, ≤10 GB.
28. **arXiv 2607.21997 — „Go Home Copilot, You're Drunk" (2026)** — https://arxiv.org/html/2607.21997v2 — PRIMÄR (peer-review-naiv). False-Positive-/Intentional-Design-Kategorien bei Agent-Review-Kommentaren.
29. **dev.to/pwd9000 — „Mastering Code Reviews with GitHub Copilot"** — https://dev.to/pwd9000/mastering-code-reviews-with-github-copilot-the-definitive-guide-3nfp — SEKUNDÄR. „Review the reviewer"-Kalibrierungspraxis.

## Teil 5: KI-optimiertes Repo & Benchmarks (F5)

30. **SWE-bench — offizielle Leaderboards** — https://www.swebench.com/ + https://www.swebench.com/verified — PRIMÄR. 500 human-verifizierte Instances, mini-SWE-agent-Standard-Harness.
31. **steel.dev — SWE-Bench Verified Leaderboard (Stand 04.09.2026)** — https://leaderboard.steel.dev/leaderboards/swe-bench-verified/ — SEKUNDÄR (Aggregator, mit Methodik-/Contamination-Caveats). Claude Opus 5: 96 % (Vals.ai unabhängig: 97,0 % ±0,76), GPT-5.3 Codex ~85 %, Open-Weights ~80 %.
32. **BenchLM — SWE-Bench Verified Leaderboard (Sep 2026)** — https://benchlm.ai/benchmarks/swe-bench-verified — SEKUNDÄR. Kreuzcheck von [31]; Modellmatrix.
33. **Encore — „State of AI-Native Software Delivery 2026" (PDF)** — https://encore.dev/assets/library/state-of-ai-native-delivery-2026.pdf — SEKUNDÄR (Vendor-Report, aber Datenbasis benannt: DORA, DX 135k+ Devs, GitHub Octoverse 2025). Google 75 % AI-Code (04/2026); agentische PRs: 4,6× längeres Review-Warten, Acceptance 32,7 % vs. 84,4 % human; 43 % der KI-PRs, die QA/Staging passieren, brauchen Prod-Debugging.
34. **justanalytics — „AI Coding Agent Observability Statistics 2026"** — https://justanalytics.app/blog/ai-coding-agent-observability-statistics-2026 — SEKUNDÄR (Content-Site, **niedrige Verlässlichkeit**, aber methodiktransparent). Octoverse 2026: 41 % der AI-Code-PRs ohne meaningful Review (nicht unabhängig verifiziert); Sentry 2026: 2,3× Fehlerquote erste 48 h; Usage-Pyramide (nur 12 % autonome Task-Completion).
35. **neosantara — „Coding with AI" Übersichtsartikel** — https://neosantara.xyz/en/blog/masa-depan-coding-dengan-ai — SEKUNDÄR (**niedrige Verlässlichkeit**). ~40 % AI-Code-Anteil GitHub Q1/2026, Opsera +15–18 % Security-Vulns, Faros-Metriken.
36. **METR-RCT (2026, via dev.to referenziert)** — passive KI-Nutzung: ~19 % Verlangsamung — PRIMÄR-Studie, hier nur Sekundär erfasst — UNSICHERHEIT.
37. **dev.to/javatarz — „Multi-Agent Development Workflows with Claude Code" (04/2026)** — https://dev.to/javatarz/multi-agent-development-workflows-with-claude-code-n23 — SEKUNDÄR. Anthropic 2026 Agentic Coding Trends Report („95 % brauchen kein Multi-Agent"), Anthropic-C-Compiler-Projekt ($20k/16 Agenten/100k LOC), NBER 02/2026 (89 % Firmen: null Produktivitätseffekt).

## Teil 6: MCP & Solo-Setup (F5/F6)

38. **GitHub MCP Server (offiziell)** — https://github.com/github/github-mcp-server — PRIMÄR. Remote-Nutzung im Copilot-Workflow ([25]).
39. **Anthropic — MCP (Ökosystem-Standard)** — via [3] und [5] kontextualisiert — PRIMÄR. Tool-Testing-Agent: 40 % schnellere Task-Completion nach Description-Rewrite ([2]).
40. **aakashx — „Parallel Claude Code Agents: Safe Workflow Guide" (05/2026)** — https://www.aakashx.com/blog/parallel-claude-code-agents — SEKUNDÄR. Dispatch-Pattern mit Ownership-Boundaries pro Subagent.
41. **Nimbalyst — „Best Multi-Agent Coding Tools 2026"** — https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026 — SEKUNDÄR. Tool-Timeline 2026 (Codex-App macOS 02/2026, GitHub Agentic Workflows Preview 02/2026, Claude Cowork 03/2026), Gastown-Skepsis („bugs fixed multiple times").
42. **Medium/@ooi_yee_fei — „Parallel Development with Claude Code and Git Worktrees"** — https://medium.com/@ooi_yee_fei/parallel-ai-development-with-git-worktrees-f2524afc3e33 — SEKUNDÄR (Erfahrungsbericht). Rebase-before-pull-Modell an Agenten delegiert.

## Such-Methodik & Caveats

- ~10 Suchwellen (Websuche; Extraktion von cognition.ai per curl, da Firecrawl-Extract-Backend ausgefallen). Zwei Such-Backends fielen zwischenzeitlich aus (Firecrawl 403, Exa-Shape-Fehler) — betroffene Queries wurden über Alternativ-Backends wiederholt.
- **Vendor-Bias:** Claude-Code- und Copilot-Dokus beschreiben eigene Features positiv; Praxiszahlen (Token-Kosten, Acceptance-Rates) stammen teils von Wettbewerbern bzw. Content-Sites — im Report als Confidence mittel markiert.
- **Zeitverzug:** „State of the Art 2026" in einem sich monatlich drehenden Feld; Claude Code Agent Teams (experimentell) und Copilot Workspace (abgelöst) besonders anfällig für Veralterung.
- **Nicht verifiziert direkt:** GitButler-Grit-Post-mortem im Volltext, METR-Studie im Original, „Why Do Multi-Agent LLM Systems Fail" (Paper) — über Sekundärquellen erfasst.
