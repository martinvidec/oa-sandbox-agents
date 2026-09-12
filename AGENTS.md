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
  Umlaute werden transkribiert: `ä`→`ae`, `ö`→`oe`, `ü`→`ue`, `ß`→`ss` (Beispiel:
  „Nachschärfung" → `nachschaerfung`).
- **Worktree-Ordner und Branch tragen denselben `<issue-nr>-<slug>`** — nur das Präfix
  (`feat/`, `fix/`, `docs/`) unterscheidet sie: `worktrees/13-d8-dependent-issues` ↔
  `docs/13-d8-dependent-issues`, nicht `worktrees/13-d8-dependent`. Sonst findet der Lead
  beim Cleanup bzw. der D7-Prüfung den Worktree nicht über den Branch-Namen.
- Writes bleiben single-threaded: ein Issue = ein Worktree = ein Branch = ein PR.

## Direktiven

> **Querverweis-Konvention (gilt für alle Direktiven):** Ein Verweis auf einen Punkt dieser Datei
> nennt dessen **fett gesetzte Überschrift wörtlich** — „D8, „`main` holen"", nicht eine sinngemäße
> Umschreibung wie „D8, Basiswechsel". D2, D7 und D8 haben mehrere Unterpunkte mit ähnlichem Thema;
> eine Umschreibung trifft dann leicht den Geschwister-Punkt daneben statt den, an dem die Regel
> tatsächlich steht. Wer einen Verweis schreibt oder verschiebt, kopiert die Überschrift aus dem
> Ziel-Punkt.
>
> **Satzpunkt:** Viele Überschriften tragen ihren abschließenden Punkt innerhalb der Fettung
> („**Kein blankes `Bash(git *)`.**"). Der gehört zum Satz, nicht zur Überschrift — **Verweise
> zitieren ohne ihn**: „**Kein blankes `Bash(git *)`**". „Wörtlich" meint den Überschriftentext,
> nicht die Interpunktion drumherum.

- **D1 — Merge nur durch Martin** bei vollständig grünem CI. Agenten mergen nie (`gh pr merge` verboten).
- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`; kein `--dangerously-skip-permissions` ohne enge `--allowedTools`. Minimal-Set, damit ein headless-Run nicht mitten in der Aufgabe an einer Freigabe hängen bleibt:
  - Coder: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(git add *)`, `Bash(git commit *)`, `Bash(git push -u origin HEAD)`, `Bash(gh issue view *)`, `Bash(gh issue edit --add-label *)`, `Bash(gh issue edit --remove-label *)` (nur Labels; Aufrufform und Begründung in „**Kein blankes `Bash(gh issue edit *)`**"), `Bash(gh label list *)`, `Bash(gh pr create *)`, `Bash(gh pr view *)`, `Bash(gh pr comment *)`, `Bash(gh run list *)`, `Bash(gh run view *)`; die Sync-Einträge (D8) `Bash(git fetch origin)` und `Bash(git merge origin/main)` nur im Sync-Run („`main` holen"), vom Lead zusätzlich freigegeben
  - Reviewer: `Read`, `Glob`, `Grep`, `Bash(git diff *)`, `Bash(git log *)`, `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr comment *)` — **kein** `Write`/`Edit`
  - Lead (Delegation, Labels, Draft→Ready, D7-Prüfung, Cleanup): `Read`, `Glob`, `Grep`, `Bash(gh issue create *)`, `Bash(gh issue edit --add-label *)`, `Bash(gh issue edit --remove-label *)` (nur Labels; die D8-Basisänderung braucht eine eigene Zusatzfreigabe, siehe „**Kein blankes `Bash(gh issue edit *)`**"), `Bash(gh issue view *)`, `Bash(gh pr view *)`, `Bash(gh pr comment *)` (CI-Beleg und Rückmeldungen am PR, D4), `Bash(gh pr ready *)`, `Bash(gh run list *)`, `Bash(gh run view *)`, `Bash(gh label list *)`, `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)` (für die D7-Prüfung und die D8-Vorprüfung, die dafür im Worktree-Verzeichnis laufen — siehe nächster Punkt), `Bash(git worktree *)`, `Bash(git checkout main)`, `Bash(git pull)`, `Bash(git branch -D *)` — **kein** `gh pr merge` (D1); im D7-Vollendungsfall kommen die dafür nötigen Einträge aus dem Coder-Set
  - **Lead-Run arbeitet im Worktree-Verzeichnis:** Der Lead arbeitet vom Repo-Root. Dort zeigen `git status --long` und `git diff HEAD` den Root-Checkout, `HEAD` ist `main` — nicht der Worktree. Die D7-Prüfung und die D8-Vorprüfung laufen deshalb als eigener Lead-Run, der in `worktrees/<issue-nr>-<slug>` startet — genau wie die D7-Vollendung (D7, **Vollständig**) —, mit den vorhandenen Einträgen `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`, jeder Befehl einzeln.
    - **Allowlist des Prüf-Runs: von den `git`-Einträgen des Lead-Sets nur diese drei lesenden** — `Bash(git status *)`, `Bash(git diff *)`, `Bash(git log *)`. Dazu kommen `Read`, `Glob`, `Grep` und die `gh …`-Einträge des Lead-Sets **vollständig**, also auch die schreibenden (`gh issue create`, `gh issue edit --add-label`/`--remove-label`, `gh pr comment`, `gh pr ready`): Sie arbeiten auf GitHub, brauchen kein Arbeitsverzeichnis und fassen den Worktree nicht an — der Prüf-Run braucht sie, um im Anschluss Labels zu setzen oder `needs-human` zu melden. Eingeengt wird also nur der `git`-Teil: Am Worktree liest der Prüf-Run ausschließlich. Die schreibenden `git`-Einträge des Lead-Sets werden für ihn **nicht** freigegeben — weder `Bash(git pull)` noch `Bash(git checkout main)`, `Bash(git worktree *)` oder `Bash(git branch -D *)`.
    - **`git pull` ist im Prüf-Run nicht erlaubt.** Der Eintrag steht im Lead-Set ausschließlich für das Cleanup vom Repo-Root (`git checkout main`, dann `git pull` auf `main`). Im Worktree-Verzeichnis würde er stattdessen den Upstream des Feature-Branches in diesen mergen — vor dem ersten Push ist das `origin/main` (`git worktree add -b <branch> origin/main` setzt den Upstream dorthin, siehe Worktree-Konvention), nach `git push -u origin HEAD` `origin/<branch>`. In beiden Fällen ist es ein Merge in den Feature-Branch, und den behält D8 dem Coder-Sync-Run vor („`main` holen"), weil Konflikte aufzulösen Code ist (Rollen-Tabelle). Der Lead merged nie selbst; braucht der Worktree `main`, delegiert er einen Sync-Run.
    - Weder `git -C` noch `cd`: Ein Eintrag wie `Bash(git -C worktrees/* status)` hebelt den Push-Guard aus, weil der `*` beliebigen Text matcht — `git -C worktrees/x push origin HEAD:main --repo status` passt durch, und `git -C worktrees/x -c core.fsmonitor=<cmd> status` führt beliebige Befehle aus. `cd worktrees/… && git status --long` ist eine Kette und hängt an einer eigenen Freigabe (letzter Punkt von D2).
    - Delegation, Labels, Cleanup und `git worktree list` laufen weiter vom Repo-Root — mit dem vollen Lead-Set, `git pull` inklusive.
  - **Kein blankes `Bash(git *)`.** Das erlaubt exakt das `git push origin HEAD:main`, vor dem
    D1 warnt. Der Push-Guard wird als exakte Form `Bash(git push -u origin HEAD)` freigegeben;
    jede andere Push-Variante muss an einer Freigabe hängen bleiben.
  - **Kein `gh pr edit` — in keinem der drei Sets.** Der Befehl fehlt nicht versehentlich, er ist bewusst draußen: `gh pr edit <n> --body …` ersetzt den PR-Body **vollständig** (kein „Checkbox anhaken", sondern Read-Modify-Write an einem Dokument, das ein anderer Run geschrieben hat). Ein headless-Run, der nur „CI grün" abhaken will, löscht dabei leicht `Closes #N` — dann schließt das Issue beim Merge nicht mehr (Pipeline) — oder die Owner-Vermerke aus D4. `gh pr edit <n> --base <branch>` hängt den PR zusätzlich an einen anderen Ziel-Branch um, in einer D8-Kette unbemerkt. Eine engere Freigabeform, die nur den Body-Anhang erlaubt, gibt es nicht. Belege, die erst **nach** `gh pr create` anfallen — allen voran „CI grün" —, gehen deshalb als PR-Kommentar raus (`Bash(gh pr comment *)`, steht in allen drei Sets); die Konvention dazu in D4.
  - **Kein blankes `Bash(gh issue edit *)`.** `gh issue edit <n> --body …` hat dieselbe Sprengkraft wie `gh pr edit --body` („**Kein `gh pr edit` — in keinem der drei Sets**", Punkt darüber): Es ersetzt den Issue-Body **vollständig** und trifft dabei die Akzeptanzkriterien, die Scope-Grenzen und die Agent-Hinweise samt D8-Basis — also genau die Vorgaben, gegen die D4 und der Reviewer prüfen. Ein blankes Pattern lässt das durch, obwohl Coder und Lead `gh issue edit` nur für **Labels** brauchen (Label-Tabelle). Freigegeben sind deshalb nur `Bash(gh issue edit --add-label *)` und `Bash(gh issue edit --remove-label *)`.
    - **Aufrufform: Label-Flag zuerst, Issue-Nummer zuletzt** — `gh issue edit --add-label agent:review --remove-label agent:in-progress <n>`. `gh` erlaubt Flags vor dem Positionsargument; in der umgekehrten Reihenfolge (`gh issue edit <n> --add-label …`) würde das Pattern nicht matchen und ein headless-Run an einer Freigabe hängen bleiben (Punkt „**Befehle immer in der exakt freigegebenen Form — kein blankes `git status`/`git diff`**" unten).
    - **Der `*` am Ende schließt `--body` nicht technisch aus** — er matcht beliebigen Text, genauso wie beim `git -C`-Beispiel oben; dasselbe gilt für `--body-file`/`-F` und für `--title`, das den Issue-Titel ersetzt. Die Einengung nimmt den Freibrief weg, den Riegel setzt die Regel: **Kein Agent ändert Body oder Titel eines Issues**, weder um eine Checkbox abzuhaken noch um etwas zu ergänzen. Auch der Issue-Body wird nicht nachgepflegt; Belege gehören an den PR (D4).
    - **Einzige Ausnahme — die D8-Basisänderung.** Nur der Lead stellt die Basis in den Agent-Hinweisen auf `origin/main` um (D8, „**Danach gilt `<basis>` = `origin/main`**" und „**Worktree noch nicht angelegt**"). Dafür gibt er sich `Bash(gh issue edit --body *)` als Zusatzfreigabe für genau diesen Run frei — wie die Sync-Einträge im Coder-Set —, liest den Body vorher mit `gh issue view <N>` und schreibt ihn unverändert zurück bis auf die Basis-Zeile. Im Standard-Lead-Set steht der Eintrag **nicht**.
      - **Nur die Inline-Form `--body`.** `gh issue edit` kennt auch `--body-file`/`-F`; die Zusatzfreigabe deckt sie **nicht** ab, und sie wird auch nicht zusätzlich freigegeben. Ein headless-Run, der zu `-F` greift, bliebe an einer Freigabe hängen (Punkt „**Befehle immer in der exakt freigegebenen Form — kein blankes `git status`/`git diff`**" unten) — er braucht sie aber gar nicht: Um eine Body-Datei zu schreiben, bräuchte der Lead `Write`, und das steht aus gutem Grund nicht im Lead-Set (Rollen-Tabelle: Der Lead schreibt keinen Code). Der Body geht also als Inline-Argument raus, mehrzeilig in einfachen Anführungszeichen, Flag vor der Nummer: `gh issue edit --body '<voller Body>' <N>`.
  - **Befehle immer in der exakt freigegebenen Form — kein blankes `git status`/`git diff`.**
    Ein Eintrag wie `Bash(git status *)` matcht den argumentlosen Aufruf `git status` je nach
    Version des Matchers **nicht**: Das `*` steht für Argumente, die dann fehlen. Ein headless-Run
    bliebe mitten in der D7-Prüfung an einer Freigabe hängen. Deshalb stehen die Befehlsbeispiele
    in dieser Datei immer mit Argument: `git status --long` statt blankem `git status`,
    `git diff HEAD` statt blankem `git diff`. Wer ein Beispiel abwandelt, behält die Argument-Form
    bei. Den Eintrag zusätzlich argumentlos freizugeben (`Bash(git status)`) ist nicht nötig und
    bläht das Minimal-Set auf.
    - **`--long`, nicht `--short`/`--porcelain`.** `--long` ist das Default-Format: die Ausgabe ist
      dieselbe wie beim blanken `git status`, nur mit Argument. Die Kurzformate verschweigen den
      Merge-Zustand („All conflicts fixed but you are still merging.") — genau den, auf den D7 und
      D8 vor jedem Sync-Run prüfen. Sie zeigen zwar die geänderten Pfade, unaufgelöste Konflikte
      inklusive (`UU`), aber keinen Hinweis auf den laufenden Merge; ein Merge, dessen Konflikte
      bereits gestaged sind, sähe in `--short` deshalb aus wie ein normaler Arbeitsstand.
    - **`git diff HEAD`, nicht blankes `git diff`.** Der Zusatz ändert die Semantik zum Besseren:
      Blankes `git diff` zeigt nur unstaged Änderungen, `git diff HEAD` staged und unstaged
      zusammen — also die uncommitteten Änderungen, die D7 sucht. Untracked Dateien zeigt keins
      von beiden; die kommen aus `git status --long`.
  - In headless-Runs Shell-Befehle einzeln absetzen: verkettete Kommandos (`a; b`) lösen eine eigene Freigabe aus, auch wenn jeder Teil erlaubt wäre. Das gilt auch für die Beispielblöcke in dieser Datei.
- **D3 — Kleine PRs:** Ein PR = ein Issue. Keine Scope-Ausweitung ohne neues Issue.
- **D4 — Akzeptanzkriterien:** Ein Issue gilt erst erledigt, wenn jede Akzeptanzkriterium-Checkliste abgehakt/automatisiert verifiziert ist. Kriterien, die außerhalb der eigenen Rolle liegen (Reviewer-Run, Merge), hakt man **nicht** selbst ab, sondern benennt sie im PR mit Owner als offen.
  - **Der PR-Body ist der Stand bei `gh pr create` und wird nicht nachgepflegt.** Kriterien, deren Beleg erst danach vorliegt, bleiben dort unabgehakt und mit Owner als offen benannt. „CI grün" ist immer so ein Fall: CI startet erst mit Push und PR, der Body ist zum Zeitpunkt seiner Erstellung also zwangsläufig unbelegt — ein vorab gesetztes Häkchen wäre genau der Fehler aus `docs/workflow.md`, „Häkchen nur mit Beleg".
  - **Der Beleg folgt als PR-Kommentar**, nicht als Body-Änderung: `gh pr comment <n> --body "CI grün: Run <id>, conclusion success"` (`Bash(gh pr comment *)` steht in allen drei Sets; `gh pr edit` in keinem — Begründung in D2). Der Beleg ist datiert und lässt den PR-Body unangetastet: `Closes #N` und die Owner-Vermerke kann ein Kommentar nicht kippen — darin liegt der Unterschied in der Sprengkraft. **„Append-only" ist das Pattern `Bash(gh pr comment *)` allerdings nicht**: Der `*` matcht auch die Flags, die vorhandene Kommentare anfassen. `gh pr comment <n> --edit-last` ersetzt den letzten **eigenen** Kommentar in place, der Beleg wäre dann doch überschreibbar; `gh pr comment <n> --delete-last --yes` löscht ihn ganz — `--yes` überspringt die Löschbestätigung, in einem headless-Run läuft das also ohne Rückfrage durch. Die Konvention verlangt deshalb pro Beleg einen **neuen** Kommentar; `--edit-last` und `--delete-last` sind in keinem Run vorgesehen. Für „CI grün" ist das derselbe Nachweis, den der Coder ohnehin führen muss, bevor er `agent:review` setzt (Label-Tabelle) — er hält ihn nur zusätzlich am PR fest.
- **D5 — Doku bleibt im Repo:** Ergebnisse, Specs, ADRs → `docs/`; niemals nur lokal.
- **D6 — Keine eigene Infrastruktur:** Nur GitHub + lokale Agenten.
- **D7 — Abgebrochener Coder-Run:** Endet ein Coder-Run an `--max-turns`, prüft der Lead den Worktree gegen die Akzeptanzkriterien des Issues — mit `<basis>` = `origin/main`, bei D8-Basis `origin/<pr-branch>`, nach dem Merge des Vorgängers und dem Sync wieder `origin/main` (D8, „**Danach gilt `<basis>` = `origin/main`**"): `git status --long`, `git diff HEAD` (uncommittete Änderungen, staged wie unstaged), `git log <basis>..HEAD` (Commits des Runs), `git diff <basis>...HEAD` (committete Änderungen) — jeweils einzeln in einem Lead-Run, der im Worktree-Verzeichnis startet (D2, Lead-Run arbeitet im Worktree-Verzeichnis).
  - **D8-Basis, Vorgänger #X inzwischen gemergt** (vorher `gh pr view <X> --json state,mergedAt`): Vor dem Sync läuft keine Prüfung (D8, „**Auslöser**"), der Lead braucht also zuerst einen Sync-Run („`main` holen"). **Vor dem Delegieren** prüft er `git status --long` in einem Lead-Run im Worktree-Verzeichnis (D2, „**Allowlist des Prüf-Runs: von den `git`-Einträgen des Lead-Sets nur diese drei lesenden**"): Meldet es einen laufenden Merge (`MERGE_HEAD` gesetzt — ein früherer Sync-Run ist mitten im Merge abgebrochen), delegiert er **keinen** Sync-Run, sondern setzt `needs-human`; bis zu Martins Entscheidung startet kein Run in diesem Worktree (D8, „`main` holen"). Der WIP-Commit unten würde in diesem Zustand Konfliktmarker einchecken und mit dem nächsten Push veröffentlichen. Sonst delegiert er den Sync-Run; der prüft `git status --long` zu Beginn selbst noch einmal (D8, „`main` holen"). Liegen im Worktree uncommittete Änderungen, committet der Sync-Run den Worktree-Stand zuerst **unverändert** (`git add -A`, `git commit -m "wip: Stand des abgebrochenen Runs (D7)"`) und holt erst danach `main`. Ohne diesen Commit verweigert `git merge` den Merge, sobald die Änderungen Dateien berühren, die der Merge ändert — und bei einem Konflikt ließe sich der Stand des abgebrochenen Runs nicht mehr sauber vom Merge trennen. Nach erfolgreichem Sync prüft der Lead gegen `<basis>` = `origin/main`; der vormals uncommittete Anteil steckt jetzt in `git diff origin/main...HEAD`. Vollständig → der Lead vollendet ohne eigenen Commit (Push, PR, Label wie unten); unvollständig → Fix-Run wie unten.
  - **Vollständig** (belegbar: beide Diffs zusammen zeigen die Umsetzung jedes Akzeptanzkriteriums) → der Lead committet den Worktree-Stand **unverändert** und vollendet: `git push -u origin HEAD`, `gh pr create --draft` (`Closes #N`), nach grünem CI `agent:review`. Die dafür nötigen Einträge nimmt er aus dem Coder-Set (D2); dieser Run startet wie ein Coder-Run im Worktree-Verzeichnis, damit die Einträge in exakt dieser Form greifen (kein `git -C`, D2).
  - **Unvollständig** → Fix-Run in **demselben** Worktree/Branch delegieren, wieder mit `--max-turns`. Jede inhaltliche Nachbesserung ist ein Fix-Run — der Lead schreibt keinen Code (Rollen-Tabelle).
  - **Eskalation:** Bricht auch der Fix-Run ab → `needs-human`, Rückfrage an Martin. Für den Abbruch eines **Sync-Runs** gilt D8 — und zwar je nach Zustand ein anderer Punkt:
    - mitten im Merge (`git status --long` meldet einen laufenden Merge, `MERGE_HEAD` gesetzt) → D8, „**`main` holen**": kein Wiederholungsversuch, `needs-human`, und bis zu Martins Entscheidung startet niemand einen weiteren Run in diesem Worktree.
    - nicht mitten im Merge → D8, „**Sync-Run bricht ab, nicht mitten im Merge**": genau **ein** erneuter Sync-Run, danach `needs-human`. Ausnahme aus „**Zählung — höchstens zwei Sync-Versuche pro Sync-Anlass**": War der abgebrochene Versuch schon der Sync des D7-Fix-Runs, gibt es keinen Wiederholungsversuch → direkt `needs-human`. Die Obergrenze steht ebenfalls in diesem Unterpunkt.
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
      - **Worktree noch nicht angelegt** → es ist kein D8-Fall mehr. Der Lead ändert die Basis in den Agent-Hinweisen des Issues auf `origin/main` (`gh issue edit --body … <N>` — Zusatzfreigabe für genau diesen Run, D2, „**Kein blankes `Bash(gh issue edit *)`**") und nennt beim Delegieren `origin/main`, damit kein Worktree vom veralteten oder gelöschten `origin/<pr-branch>` angelegt wird.

      Zusätzlich prüft jeder, der am abhängigen Branch einen Vergleich oder Run startet, vorher `gh pr view <X> --json state,mergedAt`. Ist #X gemergt, läuft **kein** weiterer Vergleich und keine inhaltliche Nachbesserung, bevor `main` im abhängigen Branch ist.
    - **`main` holen:** Ein Coder-Run im **selben** Worktree/Branch, Befehle einzeln (D2):

      ```bash
      git fetch origin
      git merge origin/main
      git push -u origin HEAD
      ```

      Das ist der erste Schritt des nächsten Fix-Runs; steht keiner an (z.B. vor dem Reviewer-Run), delegiert der Lead dafür einen eigenen Run. Der Run beginnt mit `git status --long` (zweite Absicherung zur Lead-Vorprüfung, D7): Meldet es einen laufenden Merge (`MERGE_HEAD` gesetzt), committet er **nichts**, führt keinen der drei Befehle aus und setzt `needs-human`. Sonst gilt: Liegen im Worktree uncommittete Änderungen (abgebrochener Run), committet der Sync-Run sie zuerst unverändert (D7). Der Lead macht es nicht selbst — Merge-Konflikte aufzulösen ist Code (Rollen-Tabelle). `Bash(git fetch origin)` und `Bash(git merge origin/main)` stehen nicht im Standard-Coder-Set (D2, Sync-Einträge); der Lead gibt sie für diesen Run in genau dieser Form zusätzlich frei. Kann der Run einen Konflikt nicht sauber auflösen → `needs-human`. `git merge --abort` ist auch im Sync-Run nicht freigegeben: Der Worktree bleibt dann mitten im Merge stehen (Konfliktmarker, `MERGE_HEAD` gesetzt). Der Run nennt diesen Zustand in der Rückfrage an Martin; bis zu dessen Entscheidung startet niemand einen weiteren Run in diesem Worktree.
    - **Sync-Run bricht ab, nicht mitten im Merge** (z.B. nach dem WIP-Commit vor `git merge` oder nach dem Merge vor dem Push; `git status --long` im Worktree-Verzeichnis meldet keinen laufenden Merge — Lead-Run, D2): Es gilt die D7-Eskalation — ein Wiederholungsversuch, dann `needs-human`. Der Lead delegiert **einen** erneuten Sync-Run in demselben Worktree/Branch, wieder mit `--max-turns`; der setzt mit denselben drei Befehlen fort (bereits gemachte WIP- oder Merge-Commits bleiben, `git merge origin/main` meldet dann ggf. „Already up to date" — ist `origin/main` inzwischen weitergezogen, holt er nur die seither hinzugekommenen Commits). Bricht auch dieser ab → `needs-human` (D7, Eskalation). Ein erneuter Sync-Run ist keine inhaltliche Nachbesserung und zählt nicht als Review-Schleife.
      - **Zählung — höchstens zwei Sync-Versuche pro Sync-Anlass.** Sync-Anlass ist der Merge eines Vorgängers #X, dessen `main`-Stand in den abhängigen Branch muss. Als Versuch zählt jeder Run, der den Sync ausführt: eigener Sync-Run, Sync-Run vor der D7-Prüfung oder erster Schritt eines Fix-Runs. War der abgebrochene Versuch der erste Schritt eines Fix-Runs, zählt der Abbruch zugleich als Abbruch dieses Fix-Runs (D7); der erneute Sync-Run ist dann auch der Sync vor dessen D7-Prüfung — kein dritter Versuch. War es schon der D7-Fix-Run, gibt es keinen Wiederholungsversuch → direkt `needs-human` (D7, Eskalation).
    - **Kein Rebase:** Der Branch ist bereits gepusht; nach einem Rebase ginge nur ein Force-Push, und der scheitert am Push-Guard `git push -u origin HEAD` (D2) — gewollt.
    - **Danach gilt `<basis>` = `origin/main`** für alle Vergleiche, die D7-Prüfung und den Review; auch `gh pr diff` zeigt dann nur noch die Arbeit dieses Issues, weil die Merge-Base jetzt der `main`-Stand samt #X ist. Nicht mehr gegen einen lokal noch vorhandenen `origin/<pr-branch>` vergleichen — der Diff enthielte alles, was mit `main` hereinkam. Nach einem Squash-Merge von #X listet `git log origin/main..HEAD` weiterhin die Original-Commits von #X (sie liegen nicht als solche auf `main`); maßgeblich für den Inhalt ist `git diff origin/main...HEAD`. Nach dem Sync ändert der Lead die Basis in den Agent-Hinweisen des Issues auf `origin/main` (`gh issue edit --body … <N>` — Zusatzfreigabe für genau diesen Run, D2, „**Kein blankes `Bash(gh issue edit *)`**"), damit Fix-, Reviewer- und D7-Runs nicht mehr gegen `origin/<pr-branch>` vergleichen.
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
