# AGENTS.md — Agenten-Interface

> Pflichtlektüre für JEDEN Agenten (Claude Code, Hermes-Profile, Copilot, ...), der in diesem Repo arbeitet. Dies ist der zentrale Contract zwischen Repo und Agent.

## Rollen

| Rolle | Realisierung | Scope |
|---|---|---|
| **Orchestrator/Lead** | Hermes default-Profil (Telegram) | Nimmt Aufträge, legt Issues an, delegiert, fasst zusammen. Schreibt KEINEN Code. |
| **Researcher** | Hermes @research / @deep-research | Recherche, Analyse, Spec-Vorarbeit → `agentic-workflow/` bzw. `docs/` |
| **Coder** | Claude Code (headless, 1 Worktree pro Issue) | Implementiert Issue in eigenem Worktree, Branch, Commits, Draft-PR |
| **Reviewer** | Claude Code, 2. Run mit sauberem Kontext | Reviewt PR gegen AGENTS.md + Akzeptanzkriterien, Befunde als PR-Kommentare |
| **Tester** | Claude Code / oa-playwright-cli (nach Bedarf) | E2E/QA-Aufgaben in eigenem Worktree |

## Arbeitsaufträge (Pipeline)

Auftrag (Martin, Telegram oder Issue) → ggf. Spec (`docs/specs/`) → **GitHub Issue** (Template, Akzeptanzkriterien, `agent:ready`) → Lead delegiert (`agent:in-progress`) → Coder im eigenen Worktree → Draft-PR (`Closes #N`) → CI grün → `agent:review` (durch den Coder; bei D7: Lead) → Reviewer-Run → Lead hebt Draft-Status auf → **Merge nur durch Martin** bei grünem CI.

Labels — jeder Übergang hat genau einen Owner, sonst bleiben abgebrochene Runs falsch etikettiert liegen:

| Label | wird gesetzt von | Auslöser |
|---|---|---|
| `agent:ready` | Lead (bzw. Issue-Template automatisch) | Issue ist briefing-fertig |
| `agent:in-progress` | Lead beim Delegieren | Coder-Run startet |
| `agent:review` | Coder, sobald Draft-PR offen und CI grün (Lead, wenn er nach D7 vollendet) | PR wartet auf Reviewer-Run |
| `needs-human` / `blocked` | jeder Agent, der nicht weiterkommt | Rückfrage an Martin nötig / externe Blockade |

Nach dem Merge räumt `Closes #N` das Issue selbst ab; Labels müssen dann nicht mehr nachgezogen werden.

## Worktree-Konvention (PFLICHT bei paralleler Arbeit)

1 Worktree pro Coding-Aufgabe, nie zwei Agenten im selben Verzeichnis:

```bash
# im Repo-Root:
git worktree add worktrees/<issue-nr>-<slug> -b feat/<issue-nr>-<slug> origin/main
cd worktrees/<issue-nr>-<slug>
# ... arbeiten, committen ...
git push -u origin HEAD        # PFLICHT-Form, siehe Warnung unten
gh pr create --draft           # Body: Closes #N + Akzeptanzkriterien
```

Aufräumen erst **nach dem Merge**, und zwar vom Repo-Root aus (ein Worktree kann sich
nicht selbst entfernen). **Owner: Lead** — der Coder-Run ist mit dem PR beendet und läuft
zum Merge-Zeitpunkt nicht mehr. Jeder Befehl einzeln, nie verkettet (siehe D2):

```bash
# Arbeitsverzeichnis: <repo-root>, nicht der Worktree
git checkout main
git pull
git worktree remove worktrees/<issue-nr>-<slug>
git worktree prune
git branch -D feat/<issue-nr>-<slug>
```

- **`-D`, nicht `-d`:** Wird der PR per Squash gemerged (so geschehen bei PR #2), landen die
  Branch-Commits nicht als solche auf `main`; `git branch -d` verweigert das Löschen dann als
  „not fully merged". `-D` ist nach einem gemergten PR korrekt, weil der Inhalt via Squash
  bereits auf `main` liegt. Vorher prüfen, dass der PR wirklich gemerged ist
  (`gh pr view <n> --json state,mergedAt`).

- **Push immer als `git push -u origin HEAD`.** `git worktree add -b <branch> origin/main`
  setzt den Upstream auf `origin/main`; ein blankes `git push` bricht deshalb ab und Git
  schlägt in der Fehlermeldung `git push origin HEAD:main` vor. Dieser Vorschlag pusht am
  PR vorbei auf `main` und ist ein **D1-Verstoß** — nie befolgen. Direkte Pushes auf `main`
  sind für Agenten ausnahmslos verboten. Bei D8-Basis zeigt der Upstream auf den
  Vorgänger-PR-Branch — eigene Warnung dazu in D8.
- Basis ist `origin/main` — außer das Issue baut auf einem offenen PR auf (D8).
- `worktrees/` ist gitignored.
- Branch-Naming: `feat/<issue-nr>-<slug>`, `fix/<issue-nr>-<slug>`, `docs/<issue-nr>-<slug>`.
  Slug: 1–3 Wörter aus dem Issue-Titel, kleingeschrieben, mit Bindestrichen.
- **Worktree-Ordner und Branch tragen denselben `<issue-nr>-<slug>`** — nur das Präfix
  (`feat/`, `fix/`, `docs/`) unterscheidet sie: `worktrees/13-d8-dependent-issues` ↔
  `docs/13-d8-dependent-issues`, nicht `worktrees/13-d8-dependent`. Sonst findet der Lead
  beim Cleanup bzw. der D7-Prüfung den Worktree nicht über den Branch-Namen.
- Writes bleiben single-threaded: ein Issue = ein Worktree = ein Branch = ein PR.

## Direktiven

- **D1 — Merge nur durch Martin** bei vollständig grünem CI. Agenten mergen nie (`gh pr merge` verboten).
- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`; kein `--dangerously-skip-permissions` ohne enge `--allowedTools`. Minimal-Set, damit ein headless-Run nicht mitten in der Aufgabe an einer Freigabe hängen bleibt:
  - Coder: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git push -u origin HEAD)`, `Bash(gh issue view *)`, `Bash(gh issue edit *)` (für das Label), `Bash(gh label list *)`, `Bash(gh pr create *)`, `Bash(gh pr view *)`, `Bash(gh pr comment *)`, `Bash(gh run list *)`, `Bash(gh run view *)`; die Sync-Einträge (D8) `Bash(git fetch origin)` und `Bash(git merge origin/main)` nur im Sync-Run („`main` holen"), vom Lead zusätzlich freigegeben
  - Reviewer: `Read`, `Glob`, `Grep`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr comment *)` — **kein** `Write`/`Edit`
  - Lead (Delegation, Labels, Draft→Ready, D7-Prüfung, Cleanup): `Bash(gh issue create *)`, `Bash(gh issue edit *)`, `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr ready *)`, `Bash(gh run list *)`, `Bash(gh run view *)`, `Bash(gh label list *)`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)` (alle drei nur lesend, für die D7-Prüfung), `Bash(git worktree *)`, `Bash(git checkout main)`, `Bash(git pull)`, `Bash(git branch -D *)` — **kein** `gh pr merge` (D1); die Vollendungs-Einträge (D7) nur im D7-Vollendungsfall aus dem Coder-Set
  - **Kein blankes `Bash(git *)`.** Das erlaubt exakt das `git push origin HEAD:main`, vor dem
    D1 warnt. Der Push-Guard wird als exakte Form `Bash(git push -u origin HEAD)` freigegeben;
    jede andere Push-Variante muss an einer Freigabe hängen bleiben.
  - In headless-Runs Shell-Befehle einzeln absetzen: verkettete Kommandos (`a; b`) lösen eine eigene Freigabe aus, auch wenn jeder Teil erlaubt wäre. Das gilt auch für die Beispielblöcke in dieser Datei.
- **D3 — Kleine PRs:** Ein PR = ein Issue. Keine Scope-Ausweitung ohne neues Issue.
- **D4 — Akzeptanzkriterien:** Ein Issue gilt erst erledigt, wenn jede Akzeptanzkriterium-Checkliste abgehakt/automatisiert verifiziert ist. Kriterien, die außerhalb der eigenen Rolle liegen (Reviewer-Run, Merge), hakt man **nicht** selbst ab, sondern benennt sie im PR mit Owner als offen.
- **D5 — Doku bleibt im Repo:** Ergebnisse, Specs, ADRs → `docs/`; niemals nur lokal.
- **D6 — Keine eigene Infrastruktur:** Nur GitHub + lokale Agenten.
- **D7 — Abgebrochener Coder-Run:** Endet ein Coder-Run an `--max-turns`, prüft der Lead den Worktree gegen die Akzeptanzkriterien des Issues — mit `<basis>` = `origin/main`, bei D8-Basis `origin/<pr-branch>`, nach dem Merge des Vorgängers und dem Sync wieder `origin/main` (D8, Basiswechsel): `git status`, `git diff` (uncommittete Änderungen), `git log <basis>..HEAD` (Commits des Runs), `git diff <basis>...HEAD` (committete Änderungen).
  - **D8-Basis, Vorgänger #X inzwischen gemergt** (vorher `gh pr view <X> --json state,mergedAt`): Vor dem Sync läuft keine Prüfung (D8, Basiswechsel), der Lead braucht also zuerst einen Sync-Run („`main` holen"). **Vor dem Delegieren** prüft er `git status` (lesend, Lead-Set): Meldet es einen laufenden Merge (`MERGE_HEAD` gesetzt — ein früherer Sync-Run ist mitten im Merge abgebrochen), delegiert er **keinen** Sync-Run, sondern setzt `needs-human`; bis zu Martins Entscheidung startet kein Run in diesem Worktree (D8, „`main` holen"). Der WIP-Commit unten würde in diesem Zustand Konfliktmarker einchecken und mit dem nächsten Push veröffentlichen. Sonst delegiert er den Sync-Run: Liegen im Worktree uncommittete Änderungen, committet der Sync-Run den Worktree-Stand zuerst **unverändert** (`git add -A`, `git commit -m "wip: Stand des abgebrochenen Runs (D7)"`) und holt erst danach `main`. Ohne diesen Commit verweigert `git merge` den Merge, sobald die Änderungen Dateien berühren, die der Merge ändert — und bei einem Konflikt ließe sich der Stand des abgebrochenen Runs nicht mehr sauber vom Merge trennen. Nach erfolgreichem Sync prüft der Lead gegen `<basis>` = `origin/main`; der vormals uncommittete Anteil steckt jetzt in `git diff origin/main...HEAD`. Vollständig → der Lead vollendet ohne eigenen Commit (Push, PR, Label wie unten); unvollständig → Fix-Run wie unten.
  - **Vollständig** (belegbar: beide Diffs zusammen zeigen die Umsetzung jedes Akzeptanzkriteriums) → der Lead committet den Worktree-Stand **unverändert** und vollendet: `git push -u origin HEAD`, `gh pr create --draft` (`Closes #N`), nach grünem CI `agent:review`. Die dafür nötigen Einträge nimmt er aus dem Coder-Set (D2).
  - **Unvollständig** → Fix-Run in **demselben** Worktree/Branch delegieren, wieder mit `--max-turns`. Jede inhaltliche Nachbesserung ist ein Fix-Run — der Lead schreibt keinen Code (Rollen-Tabelle).
  - **Eskalation:** Bricht auch der Fix-Run ab → `needs-human`, Rückfrage an Martin.
  - Der Budget-Guard gilt pro Run, nicht pro Zyklus: Vollenden oder Fix-Run verletzen D2 nicht — jeder weitere Run bekommt aber wieder ein eigenes `--max-turns`.
  - Randnotiz: D7 ist für den Abbruch an `--max-turns` formuliert. Bricht ein Run anders ab (Crash, Hänger an einer Freigabe), prüft der Lead den Worktree ebenso und verfährt wie oben.
- **D8 — Abhängige Issues:** Baut ein **neues** Issue mit eigenem D3-Scope (z.B. ein Folge-Feature) inhaltlich auf einem noch nicht gemergten PR auf, wird der Worktree von dessen Branch angelegt statt von `origin/main`.
  - **Abgrenzung zur Review-Schleife:** Review-Befunde an einem offenen PR sind **kein** D8-Fall. Sie werden in der Review-Schleife nachgebessert (`docs/workflow.md`, Review-Schleife Schritt 4): Fix-Run im **selben** Worktree/Branch, kein neues Issue, kein neuer PR. D8 greift erst, wenn die Arbeit über den Scope des offenen PRs hinausgeht und deshalb nach D3 ein eigenes Issue braucht.
  - **Ausgangslage (historisch, nicht Geltungsbereich):** #11 baute auf dem ungemergten PR #10 auf, der Worktree kam aber von `origin/main`. Dem Coder fehlte der #10-Stand; er kopierte ihn nach, sodass #10 und #12 denselben Inhalt trugen (#10 wurde ungemergt geschlossen). Da #11 nur Review-Befunde aus PR #10 umsetzte, wäre er nach heutiger Abgrenzung kein D8-Fall, sondern Review-Schleife im #10-Branch gewesen.
  - **Worktree:** `git worktree add worktrees/<issue-nr>-<slug> -b feat/<issue-nr>-<slug> origin/<pr-branch>`
  - **Lead:** trägt die Basis in die Agent-Hinweise des Issues ein und nennt die Basis-Branch-Referenz im Delegations-Prompt. **Ohne Basis-Angabe gilt `origin/main`.**
  - **Push** weiterhin nur `git push -u origin HEAD`. Bei D8-Basis zeigt der Upstream auf `origin/<pr-branch>`; ein blankes `git push` bricht deshalb ab (Branch-Name ≠ Upstream-Name, es wird nichts gepusht) und Git schlägt in der Fehlermeldung `git push origin HEAD:<pr-branch>` vor. Dieser Vorschlag schiebt die Commits in den Vorgänger-PR — kein D1-Verstoß, bricht aber „ein Issue = ein PR". Nie befolgen.
  - **Merge-Reihenfolge entscheidet Martin (D1)** — weder Coder noch Lead legen sie fest. Der PR-Body nennt nur die Abhängigkeit („baut auf #X auf"). Der PR läuft gegen `main`, sein Diff enthält also auch die Änderungen von #X; wird er zuerst gemergt, landet #X mit. Das bleibt auch nach einem Squash-Merge von #X so: Die #X-Commits landen dabei nicht als solche auf `main`, die Merge-Base bleibt alt, und `gh pr diff` zeigt die #X-Änderungen weiter, bis `main` in den abhängigen Branch geholt wird.
  - **Vergleiche gegen die Basis (bis zum Merge von #X):** alle Vergleiche (log/diff) laufen gegen `origin/<pr-branch>`, nicht gegen `origin/main` — auch die D7-Prüfung (`<basis>` = `origin/<pr-branch>`) und der Review (`docs/workflow.md`, Review-Schleife Schritt 2). Gegen `origin/main` würde die Vorgänger-Arbeit als Umsetzung dieses Issues mitgezählt.
  - **Nach dem Merge des Vorgängers wechselt die Basis auf `origin/main`.** Beim Merge von #X löscht GitHub dessen Branch automatisch, sofern „Automatically delete head branches" im Repo aktiv ist. `origin/<pr-branch>` fehlt dann nach dem nächsten Prune und in jedem frischen Clone — die Vergleiche aus dem vorigen Punkt (auch D7-Prüfung und Review) zeigen ins Leere. Ohne Prune bleibt der Ref lokal stehen, ist aber veraltet.
    - **Nicht nur wegen Auto-Delete:** Auch wenn der Branch von #X stehen bleibt, ist der Wechsel nötig. Bei Squash- oder Rebase-Merge von #X (Repo-Praxis, s. PR #2) landen die #X-Commits nicht als solche auf `main`; solange `main` nicht im abhängigen Branch ist, bleibt dessen Merge-Base mit `main` deshalb der Stand vor #X (siehe **Merge-Reihenfolge**): `gh pr diff` zeigt #X weiter mit, und `main` ist noch keine brauchbare Basis. Erst das Holen von `main` macht die Merge-Base zum `main`-Stand samt #X. Bei einem echten Merge-Commit wäre die Merge-Base schon der #X-Stand; der Sync gilt trotzdem unabhängig von der Merge-Art, damit niemand sie vorher prüfen muss. Auto-Delete macht den Wechsel nur zusätzlich dringend, weil dann auch der alte Vergleichsref fehlt.
    - **Auslöser:** Der Lead kennt die abhängigen Issues aus seinen eigenen Delegationen — er hat die D8-Basis selbst in deren Agent-Hinweise eingetragen (siehe **Lead** oben), eine Suche ist nicht nötig. Eine Suche nach PRs mit „baut auf #X auf" (`gh pr list --state open --search "baut auf #X auf"`) ist optional; `gh pr list` steht nicht im Lead-Set (D2) und braucht für diesen Run eine eigene Zusatzfreigabe. Beim Cleanup von #X prüft der Lead jedes noch offene dieser Issues (`gh issue view <N>`) und ob sein Worktree schon angelegt ist (`git worktree list`, beides im Lead-Set):
      - **Worktree angelegt** → er stößt den Schritt „`main` holen" an.
      - **Worktree noch nicht angelegt** → es ist kein D8-Fall mehr. Der Lead ändert die Basis in den Agent-Hinweisen des Issues auf `origin/main` (`gh issue edit <N>`, im Lead-Set) und nennt beim Delegieren `origin/main`, damit kein Worktree vom veralteten oder gelöschten `origin/<pr-branch>` angelegt wird.

      Zusätzlich prüft jeder, der am abhängigen Branch einen Vergleich oder Run startet, vorher `gh pr view <X> --json state,mergedAt`. Ist #X gemergt, läuft **kein** weiterer Vergleich und keine inhaltliche Nachbesserung, bevor `main` im abhängigen Branch ist.
    - **`main` holen:** Ein Coder-Run im **selben** Worktree/Branch, Befehle einzeln (D2):

      ```bash
      git fetch origin
      git merge origin/main
      git push -u origin HEAD
      ```

      Das ist der erste Schritt des nächsten Fix-Runs; steht keiner an (z.B. vor dem Reviewer-Run), delegiert der Lead dafür einen eigenen Run. Liegen im Worktree uncommittete Änderungen (abgebrochener Run), committet der Sync-Run sie zuerst unverändert (D7). Der Lead macht es nicht selbst — Merge-Konflikte aufzulösen ist Code (Rollen-Tabelle). `Bash(git fetch origin)` und `Bash(git merge origin/main)` stehen nicht im Standard-Coder-Set (D2, Sync-Einträge); der Lead gibt sie für diesen Run in genau dieser Form zusätzlich frei. Kann der Run einen Konflikt nicht sauber auflösen → `needs-human`. `git merge --abort` ist auch im Sync-Run nicht freigegeben: Der Worktree bleibt dann mitten im Merge stehen (Konfliktmarker, `MERGE_HEAD` gesetzt). Der Run nennt diesen Zustand in der Rückfrage an Martin; bis zu dessen Entscheidung startet niemand einen weiteren Run in diesem Worktree.
    - **Kein Rebase:** Der Branch ist bereits gepusht; nach einem Rebase ginge nur ein Force-Push, und der scheitert am Push-Guard `git push -u origin HEAD` (D2) — gewollt.
    - **Danach gilt `<basis>` = `origin/main`** für alle Vergleiche, die D7-Prüfung und den Review; auch `gh pr diff` zeigt dann nur noch die Arbeit dieses Issues, weil die Merge-Base jetzt der `main`-Stand samt #X ist. Nicht mehr gegen einen lokal noch vorhandenen `origin/<pr-branch>` vergleichen — der Diff enthielte alles, was mit `main` hereinkam. Nach einem Squash-Merge von #X listet `git log origin/main..HEAD` weiterhin die Original-Commits von #X (sie liegen nicht als solche auf `main`); maßgeblich für den Inhalt ist `git diff origin/main...HEAD`. Nach dem Sync ändert der Lead die Basis in den Agent-Hinweisen des Issues auf `origin/main` (`gh issue edit <N>`, im Lead-Set), damit Fix-, Reviewer- und D7-Runs nicht mehr gegen `origin/<pr-branch>` vergleichen.
    - **Hinweis `headRefOid`:** `gh pr view <X> --json headRefOid` liefert den letzten Head-Commit von #X auch nach der Branch-Löschung (`gh pr view *` steht in allen drei Sets). Das ist die Alternative zum fehlenden `origin/<pr-branch>`, wenn nur festgehalten werden soll, auf welchem #X-Stand gearbeitet wurde (z.B. in einem PR-Kommentar). Den Sync ersetzt der Wert nicht: Die Merge-Base mit `main` bleibt ohne Sync alt, „kein Vergleich vor dem Sync" (**Auslöser**) gilt weiter, und der Commit liegt lokal nur vor, wenn er vor der Löschung schon gefetcht wurde — nach einem Squash-Merge ist er von `main` aus nicht erreichbar.

## Repo-Struktur

```
docs/              Spec-Doku (01-konzept … 04-spezifikation), workflow.md
docs/specs/        Feature-Specs (bei Bedarf — noch nicht angelegt, entsteht beim ersten größeren Auftrag)
docs/experiments/  Ergebnisse von Experiment-Issues (z.B. pilot-pipeline.md)
agentic-workflow/  Research (entwurf, report, quellen)
.github/           ISSUE_TEMPLATE/, workflows/ci.yml
worktrees/         gitignore'd, Arbeitsverzeichnisse der Coding-Agenten
```

Bekannte Lücken der Pipeline (aus dem Pilot-Durchlauf): [`docs/experiments/pilot-pipeline.md`](docs/experiments/pilot-pipeline.md).
