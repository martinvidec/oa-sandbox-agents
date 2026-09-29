# Spec: Workflow-DSL — maschinell prüfbarer Multi-Agent-Workflow

Status: Entwurf v0.1 (2026-09-26) · Quelle: Diskussion im Repo-Thread · Umsetzung: Issues dieser Serie

## 1. Ziel

Der Workflow (AGENTS.md + docs/workflow.md) wird in einer DSL so spezifiziert, dass
Fehler im Workflow maschinell gefunden werden können. Der DSL-Text ist normative
Quelle; die Markdown-Doku bleibt lesbar (Hybrid, § 6). Der Workflow bleibt von
Hermes (Lead) unverändert ausführbar — die DSL wird zur Ausführungsquelle für
Delegation, Budgets und Tool-Sets.

Nicht-Ziele: keine CI-Ersetzung, keine eigene Parser-Sprache (YAML + JSON-Schema),
keine Runtime-Automatisierung von D1 (Merge bleibt Martins Entscheidung).

## 2. Architektur: vier Schichten unter workflow/

- `workflow/roles.yaml` — Rollen mit Tool-Allowlists, Forbidden-Patterns, Budgets
  (D2 maschinenlesbar). lead.merge_allowed: false (D1 als Feld).
- `workflow/states.yaml` — Label-Zustandsmaschine (ready → in-progress → review →
  done, blocked/needs-human) mit Owner je Übergang und Invarianten
  (max_review_loops: 2, done_requires merged && ci_green).
- `workflow/rules.yaml` — Direktiven D1–D8 als prüfbare Invarianten: id, on
  (Trigger-Ereignis), assert (Bedingung über beobachtbare Fakten), check (Quelle:
  gh_api / git_state / process_exit), remedy. Nur beobachtbare Fakten, keine
  Selbstauskunft des Agenten.
- `workflow/pipeline.yaml` — Pipeline-Schritte mit pre/postconditions
  (worktree_create, coder_run, review_run, merge …).

## 3. Prüfung: drei Ebenen (scripts/validate-workflow.mjs, in CI)

1. **Statisch:** YAML gegen JSON-Schemata (ajv), Referenzauflösung (Tools,
   Zustände, Dateien, Regel-IDs existieren).
2. **Konsistenz:**
   - Allowlist-Sicherheitsanalyse: jede Wildcard-Position klassifizieren
     (Argument-Wildcard ok; Wert-Wildcard wie NODE_PATH=* und Injektionsformen wie
     -C / -c = Verstoß). Diese Analyse hätte Blocker B1 (PR #27) automatisch
     gefangen.
   - Zustandsmaschine: alle Zustände erreichbar, kein Übergang ohne Owner, done
     nur via by: human, Schleifenlimit zählbar.
   - Querverweise: Verweise in AGENTS.md auf Direktiven werden gegen DSL-IDs
     aufgelöst (tote/schiefe Verweise = Fehler).
   - Hybrid-Generierung: die strukturierten Abschnitte von AGENTS.md (Rollentabelle,
     Label-Tabelle, Tool-Sets) werden aus der DSL generiert; CI vergleicht
     generiert vs. eingecheckt.
3. **Konform (Runtime-Replay, nach jedem Merge):** der letzte Zyklus wird aus
   beobachtbaren Ereignissen (Label-Zeitstempel, Merge-Actor aus dem Audit-Log,
   Push-Form, Schleifenzahl) gegen rules.yaml gespielt; Verstoß → Workflow-Bug-Issue.

## 4. Ausführbarkeit (Lead)

Delegation wird aus der DSL generiert: --allowedTools aus roles.yaml, --max-turns
aus dem Budget-Feld, Prompt enthält die relevanten rules.yaml-Sätze des Schritts.
Der Lead ist Ausführer der DSL, nicht Interpret der Prosa.

## 5. MVP-Umfang (dieses Issue)

1. workflow/roles.yaml + workflow/states.yaml (Vollständigkeit: Coder/Reviewer/Lead
   mit den D2-Sets aus AGENTS.md; Zustände/Übergänge aus der Label-Tabelle).
2. scripts/validate-workflow.mjs: Ebene 1 (Schema) + Ebene 2 (Sicherheitsanalyse
   der Allowlists, Zustandsmaschinen-Checks). Node, keine schweren Abhängigkeiten
   (ajv + js-yaml reichen). Playwright analog: NODE_PATH-Konvention, kein Install
   im Repo (D2-Punkt „Warum Playwright nicht im Repo-Root installiert wird").
3. Hybrid-Anbindung: AGENTS.md-Rollentabelle + Label-Tabelle generieren
   (scripts/render-agents.mjs), CI-Check generiert-vs-eingecheckt; Begründungsprosa
   bleibt Handtext.
4. CI erweitert: validate-workflow im ci.yml-Workflow.
5. Runtime-Replay (Ebene 3) NICHT in diesem MVP — eigenes Folge-Issue (braucht
   Session-Log-Anbindung).

## 6. Hybrid-Entscheidung

Struktur (Tabellen, Tool-Sets, Schritte) generiert aus der DSL; die
Begründungs-Essays der Direktiven bleiben Handtext und werden per ID-Referenz an
die DSL gebunden (Linter prüft, dass jede referenzierte DSL-ID existiert).
Begründung: Die Essays tragen ihren Wert in der Begründung, nicht in der Struktur;
Generierung würde sie platten.

## 7. Akzeptanzkriterien (MVP)

- [ ] workflow/roles.yaml + states.yaml decken D2-Sets und Label-Tabelle vollständig ab
- [ ] validate-workflow.mjs: Schema-Validierung + Wildcard-Sicherheitsanalyse +
      Zustandsmaschinen-Checks, lauffähig (Lead-Testlauf mit NODE_PATH)
- [ ] Sicherheitsanalyse fängt die historischen Fälle als Verstoß: B1 (-C-Wildcard),
      NODE_PATH=-Inline-Prefix, blankes git *
- [ ] render-agents.mjs generiert Rollen-/Label-Tabelle; generiert == eingecheckt
- [ ] ci.yml führt validate-workflow aus, grün
- [ ] docs/workflow.md verweist auf die DSL als Struktur-Quelle

## 8. Risiken / Anmerkungen

- Wildcard-Klassifikation ist eine Heuristik — sie prüft Pattern-Formen, nicht die
  Semantik aller möglichen Tools. Fehlalarme werden als Warnung, nicht als Fehler
  eingestuft (ausgenommen die drei historischen Verstoßformen, die hart prüfen).
- Die DSL wird von den Agenten-Runs nicht erzwungen (Claude Code kennt sie nicht) —
  sie prüft NACHTRAGEND. Das ist bewusst: Zwang läuft über --allowedTools, Prüfung
  über das Replay.