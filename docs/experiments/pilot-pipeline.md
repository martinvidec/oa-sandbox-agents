# Pilot: Pipeline einmal vollständig durchlaufen (Issue #1 / E6)

> Dogfooding-Protokoll des ersten End-to-End-Durchlaufs durch die in `AGENTS.md` und
> `docs/workflow.md` beschriebene Multi-Agent-Pipeline. Zweck: Lücken und Reibungen
> finden, nicht das Ergebnis schönschreiben.

| | |
|---|---|
| Issue | martinvidec/oa-sandbox-agents#1 („E6 Pilot: Pipeline einmal vollständig durchlaufen") |
| Datum | 2026-09-10 |
| Rolle in diesem Lauf | Coder (Claude Code, headless, eigener Worktree) |
| Worktree | `worktrees/1-pilot` |
| Branch | `feat/1-pilot` (von `origin/main` @ `ce5e227`) |
| Ausgangs-Labels | `agent:in-progress` (vom Lead gesetzt) |
| Scope | Nur Doku — kein Produktiv-Code, keine CI-Änderung (Vorgabe aus dem Issue) |

## 1. Durchlauf

| Schritt (laut `docs/workflow.md`) | Ergebnis | Reibung |
|---|---|---|
| 1–2 Issue mit Template, Akzeptanzkriterien, Scope, Agent-Hinweisen | vorhanden, ausreichend | keine — es war keine Rückfrage nötig |
| 3 Worktree + Branch nach Konvention | `worktrees/1-pilot`, `feat/1-pilot` | Upstream falsch gesetzt → **F1** |
| Kontext lesen (`AGENTS.md`, `CLAUDE.md`, `docs/workflow.md`, Spec E6) | klar, widerspruchsfrei bis auf Pfadangaben → **F6** | — |
| 4 Implementierung (Doku) + Commit | dieser PR | — |
| 4 Push + Draft-PR mit `Closes #1` | siehe PR | `git push` schlägt fehl → **F1** |
| 5 CI | grün (nur Existenz- und YAML-Checks) → **F9** | — |
| 6 Reviewer-Run | **offen** — muss ein separater Run mit sauberem Kontext sein, den der Lead startet; der Coder kann dieses Kriterium nicht selbst abhaken → **F11** | — |
| 7–8 Meldung an Martin, Merge | offen (D1) | — |
| 9 Worktree entfernen | offen, Ablauf war unterbestimmt → **F2** | — |

## 2. Befunde

Sortiert nach Schwere. „Fix hier" = in diesem PR behoben; „Folge-Issue" = bewusst
nicht angefasst (D3 — kein Scope-Ausweitung; zusätzlich Doku-only-Vorgabe des Issues).

### F1 — Die dokumentierte Worktree-Zeile erzeugt eine D1-Falle (hoch, Fix hier)

`git worktree add worktrees/<n>-<slug> -b feat/<n>-<slug> origin/main` setzt den
Upstream des neuen Branches auf `origin/main`. Mit `push.default=simple` (Default)
bricht ein einfaches `git push` ab — und Git schlägt in seiner Fehlermeldung als
**erste** Option ausgerechnet den Direkt-Push auf `main` vor:

```
fatal: The upstream branch of your current branch does not match
the name of your current branch.  To push to the upstream branch
on the remote, use

    git push origin HEAD:main
```

Ein Agent, der diese Fehlermeldung befolgt, pusht am PR vorbei auf `main` und
verletzt D1. Das ist kein hypothetisches Risiko: die Meldung ist der naheliegendste
Selbstheilungs-Pfad im Fehlerfall.

**Fix hier:** In `AGENTS.md` und `docs/workflow.md` ist der Push-Schritt jetzt explizit
`git push -u origin HEAD` und ein Push auf `main` ausdrücklich als D1-Verstoß benannt.

### F2 — Worktree-Cleanup unvollständig und aus dem Worktree heraus nicht ausführbar (mittel, Fix hier)

`git worktree remove worktrees/<n>-<slug>` stand als Einzeiler im Anschluss an
`cd worktrees/<n>-<slug>`. Aus dem Worktree heraus scheitert der Befehl (der aktuelle
Worktree kann sich nicht selbst entfernen), und offen blieb: Wer räumt wann auf, und
was passiert mit dem lokalen Branch nach dem Merge?

**Fix hier:** Cleanup-Block in `AGENTS.md` mit Repo-Root als Ausführungsort, `git worktree
prune` und Branch-Löschung; Zuständigkeit (nach Merge, Lead oder Coder-Folgerun) benannt.

### F3 — Label-Übergänge hatten keinen Owner (mittel, Fix hier)

`agent:ready → agent:in-progress → agent:review` war als Zustandskette dokumentiert,
aber nirgends stand, **wer** umlabelt. In diesem Lauf hat der Lead `agent:in-progress`
gesetzt — nach Doku hätte es auch der Coder tun können bzw. müssen. Ohne Owner bleibt
ein Issue nach einem abgebrochenen Run mit falschem Label liegen.

**Fix hier:** Label-Tabelle mit Owner und Auslöser in `AGENTS.md`, gespiegelt in der
Zuständigkeitstabelle in `docs/workflow.md`.

### F4 — Die Review-Schleife war nur als Pfeil dokumentiert (mittel, Fix hier)

`docs/workflow.md` Schritt 6 sagte: „Befunde als PR-Kommentare → Coder fixt nach".
Unterbestimmt blieb: gegen welchen Diff wird reviewt, wie signalisiert der Reviewer
„keine Befunde", in welchem Worktree passiert die Nachbesserung (Antwort: im selben,
sonst bricht „ein Issue = ein Worktree" zusammen), und wie oft wird die Schleife gedreht.

**Fix hier:** Abschnitt „Review-Schleife" in `docs/workflow.md`.

### F5 — Draft → Ready for review ist niemandes Aufgabe (niedrig, Fix hier)

Der Coder öffnet einen Draft-PR, D1 verbietet den Merge durch Agenten — aber der
Zwischenschritt „Draft-Status aufheben" war keinem zugewiesen. Ein Draft-PR ist auf
GitHub nicht mergebar; ohne Zuständigkeit bleibt der PR liegen.

**Fix hier:** In `docs/workflow.md` dem Lead zugewiesen (nach grünem CI + abgeschlossenem Review).

### F6 — Pfadangaben in `AGENTS.md` stimmten nicht mit dem Repo überein (niedrig, Fix hier)

- Die Rollentabelle nannte `research/` als Ablage des Researchers; dieses Verzeichnis
  existiert nicht, die Recherche liegt in `agentic-workflow/`.
- `docs/experiments/` war in der Repo-Struktur nicht aufgeführt, obwohl das
  Issue-Template „Experiment" genau dorthin verweist — das Verzeichnis wurde in diesem
  PR erst angelegt.
- `.github/` fehlte in der Repo-Struktur ganz.

**Fix hier:** Repo-Struktur und Rollentabelle korrigiert.

### F7 — D2 sagt „enge `--allowedTools`", aber nicht welche (mittel, Fix hier)

In diesem Lauf wurde `gh label list` vom Permission-Layer abgelehnt; ein Lauf ohne
interaktiven Menschen wäre an dieser Stelle stehen geblieben, ohne dass die Aufgabe
unmöglich gewesen wäre. Zweiter Effekt: mehrteilige Shell-Kommandos (`a; b; c`) lösen
eigene Freigaben aus, auch wenn jeder Teil für sich erlaubt wäre — in headless-Runs
also besser einzeln aufrufen.

**Fix hier:** Minimales Tool-Set pro Rolle unter D2 in `AGENTS.md` ergänzt.

### F8 — Kein PR-Template (niedrig, Folge-Issue)

Die PR-Body-Konvention (`Closes #N` + Akzeptanzkriterien als Checkliste) steht nur in
Prosa in `docs/workflow.md`. Ein `.github/PULL_REQUEST_TEMPLATE.md` würde sie
erzwingen — liegt aber außerhalb der Doku-only-Vorgabe dieses Issues.

### F9 — „CI grün" ist derzeit ein schwaches Signal (mittel, Folge-Issue)

Die CI prüft die Existenz von `AGENTS.md`/`CLAUDE.md` und die YAML-Gültigkeit der
Templates/Workflows. Sie prüft **nicht**: Markdown-Links, `Closes #N` im PR-Body,
Branch-Naming, oder ob ein als „Doku-only" deklarierter PR wirklich nur Doku enthält.
Ebenso ist Branch-Protection auf `main` noch nicht aktiv (laut Spec Abschnitt 5 bewusst
erst nach stabiler CI) — D1 hängt damit aktuell an Disziplin, nicht an Technik. Zusammen
mit F1 ist das der Punkt mit dem größten Restrisiko.

### F10 — Der `delegate-coding`-Skill ist nicht im Repo (niedrig, Folge-Issue)

Die Agent-Hinweise des Issues verweisen auf den Skill `delegate-coding`; im Worktree
existiert kein `.claude/skills/`, der Skill ist aus der Coder-Rolle heraus nicht
auffindbar oder prüfbar. Für die Coder-Rolle war das folgenlos (der Skill gehört dem
Lead), steht aber in Spannung zu D5 „Doku bleibt im Repo".

### F11 — Akzeptanzkriterien ohne Owner sind vom Coder nicht abhakbar (mittel, Fix hier)

Zwei der sechs Kriterien dieses Issues liegen strukturell außerhalb der Coder-Rolle:
der Reviewer-Run (anderer Run, sauberer Kontext) und die Merge-Entscheidung (Martin, D1).
Ein Coder, der D4 wörtlich nimmt („erst erledigt, wenn jede Checkbox abgehakt ist"),
gerät hier entweder ins Stocken oder hakt Fremdkriterien fälschlich ab.

**Fix hier:** Regel in `docs/workflow.md`: Akzeptanzkriterien, die nicht der Coder erfüllt,
im Issue mit Owner markieren (`(Reviewer)`, `(Martin)`); D4 in `AGENTS.md` entsprechend präzisiert.

## 3. Was ohne Reibung funktioniert hat

- **Rollentrennung.** Coder/Reviewer/Lead sind klar genug abgegrenzt, dass in diesem Lauf
  keine Rückfrage nötig war; insbesondere „Reviewer editiert keinen PR-Code" ist eindeutig.
- **Issue-Template.** Ziel / Akzeptanzkriterien / Scope-Grenzen / Agent-Hinweise waren als
  Briefing ausreichend — die Scope-Grenzen haben mindestens zwei naheliegende
  Ausweitungen (PR-Template, CI-Checks) verhindert und in Folge-Issues umgelenkt.
- **D1–D6 als nummerierte Direktiven.** Kurz, zitierbar, in Commit- und PR-Text referenzierbar.
- **Worktree-Isolation.** Ein eigener Worktree pro Issue funktioniert mechanisch problemlos;
  `worktrees/` gitignored verhindert Selbst-Commits des Arbeitsverzeichnisses.
- **CI-Laufzeit.** Wenige Sekunden — kein Anreiz, das grüne CI zu umgehen.

## 4. Vorgeschlagene Folge-Issues

| # | Inhalt | Quelle |
|---|---|---|
| 1 | `.github/PULL_REQUEST_TEMPLATE.md` mit `Closes #N` + Akzeptanzkriterien-Checkliste | F8 |
| 2 | CI härten: Markdown-Link-Check, Branch-Naming, `Closes #N`-Check im PR-Body | F9 |
| 3 | Branch-Protection auf `main` aktivieren (D1 technisch absichern) | F9 |
| 4 | `delegate-coding`-Skill ins Repo (`.claude/skills/`) oder in `docs/workflow.md` beschreiben | F10 |

## 5. Status der Akzeptanzkriterien (Stand: Ende des Coder-Runs)

- [x] Worktree nach Konvention angelegt (`worktrees/1-pilot`, Branch `feat/1-pilot`)
- [ ] Reviewer-Run auf dem PR-Diff — **offen, Owner: Lead/Reviewer** (siehe F11)
- [x] Pipeline-Lücken/Reibungen dokumentiert (dieses Dokument, F1–F11)
- [x] `AGENTS.md` / `docs/workflow.md` nachgeschärft (F1–F7, F11)
- [x] PR offen mit `Closes #1`, CI grün
- [ ] Merge-Entscheidung — **offen, Owner: Martin** (D1)
