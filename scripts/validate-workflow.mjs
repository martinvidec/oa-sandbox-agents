// Validierung der Workflow-DSL unter workflow/ (Spec: docs/specs/dsl-workflow.md, § 3).
// Setup und Aufruf: docs/validate-setup.md
//
//   node scripts/validate-workflow.mjs [--root <verzeichnis>] [--json] [--selftest]
//
// Ebene 1  Schema: roles.yaml, states.yaml, rules.yaml und pipeline.yaml gegen JSON-Schemata
//          (ajv), Referenzauflösung.
// Ebene 2  Konsistenz: Wildcard-Sicherheitsanalyse der Tool-Allowlists (Argument-Wildcard ok;
//          Wert-Wildcard, Injektionsformen wie -C/-c/--git-dir=…, Verkettungs- und
//          Umlenkungszeichen, Variablen-Expansion, nicht-terminale Wildcards und blanke
//          Sammelpattern hart falsch), Subsumptionsvergleich gegen die Verbotsformen
//          (eine Freigabe darf weder unter ein Verbot fallen noch eines mit abdecken),
//          beidseitiger Abgleich der `Bash(…)`-Formen aus den D2-Abschnitten von AGENTS.md
//          gegen die Tool-Sets der DSL und Zustandsmaschinen-Checks (Erreichbarkeit, Owner
//          je Übergang, Invarianten). Dazu die Regel-Konsistenz von rules.yaml (Vokabular für
//          `on`/`check`/`assert`, Abdeckung von D1–D8, Querverweise gegen die fetten
//          Überschriften von AGENTS.md) und die Pipeline-Konsistenz von pipeline.yaml
//          (strukturierte pre-/postconditions gegen Rollen, Zustände, Fakten und Regeln).
// Ebene 3  Runtime-Replay: nicht in diesem MVP (Spec § 5.5).
//
// Exit-Code: 0 = keine Fehler (Warnungen erlaubt), 1 = Fehler gefunden,
//            2 = Setup-, Aufruf- oder Laufzeitfehler.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
let root = process.cwd();
let jsonOut = false;
let selftestOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') {
    if (!args[i + 1]) { console.error('--root braucht ein Verzeichnis'); process.exit(2); }
    root = args[++i];
  } else if (args[i] === '--json') {
    jsonOut = true;
  } else if (args[i] === '--selftest') {
    selftestOnly = true;
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/validate-workflow.mjs [--root <verzeichnis>] [--json] [--selftest]');
    process.exit(0);
  } else {
    console.error(`unbekanntes Argument: ${args[i]}`);
    process.exit(2);
  }
}

// js-yaml und ajv neben dem Skript, im Arbeitsverzeichnis oder über NODE_PATH suchen —
// dieselbe Konvention wie bei scripts/verify-mermaid.mjs, kein Install im Repo
// (AGENTS.md D2, „Warum Playwright nicht im Repo-Root installiert wird").
function resolveModule(id) {
  for (const base of [import.meta.url, pathToFileURL(path.join(process.cwd(), 'noop.js')).href]) {
    try { return createRequire(base)(id); } catch {}
  }
  return null;
}
// Erst laden, wenn wirklich YAML gelesen wird: `--selftest` prüft nur die Formanalyse und
// kommt ohne Setup aus — so lässt sie sich auch dort laufen, wo ajv/js-yaml fehlen.
function ladeModule() {
  const yamlMod = resolveModule('js-yaml');
  const ajvMod = resolveModule('ajv');
  if (!yamlMod || !ajvMod) {
    const fehlt = [!yamlMod && 'js-yaml', !ajvMod && 'ajv'].filter(Boolean).join(', ');
    console.error(`${fehlt} nicht auflösbar — Setup siehe docs/validate-setup.md`);
    process.exit(2);
  }
  return { YAML: yamlMod.default ?? yamlMod, Ajv: ajvMod.default ?? ajvMod };
}

const errors = [];
const warnings = [];
const err = (where, code, message) => errors.push({ where, code, message });
const warn = (where, code, message) => warnings.push({ where, code, message });

// ---------------------------------------------------------------- Ebene 2: Wildcard-Analyse

// Binaries, bei denen die Form hart geprüft wird: Unter ihnen liegen verbotene Unterbefehle
// (`git push origin HEAD:main`, `gh pr merge`, `gh pr edit`) oder sie führen beliebigen Code aus
// (`node`, `npm`, `bash`, `env`). Für sie gilt: blankes Sammelpattern = Fehler, und jedes `*`
// außerhalb der letzten Position = Fehler (AGENTS.md D2, „Kein blankes `Bash(git *)`" und
// „Weder `git -C` noch `cd`" — der `*` matcht beliebigen Text, auch die nachfolgenden Tokens).
const BLANKET_HARD = ['git', 'gh', 'node', 'npm', 'npx', 'bash', 'sh', 'zsh', 'env', 'python', 'python3'];
// Flags, die Arbeitsverzeichnis, Konfiguration oder ausgeführtes Programm bestimmen: In einem
// Freigabe-Pattern sind sie eine Injektionsform (Blocker B1 aus PR #27). Verglichen wird der
// Token-Teil vor einem `=`, damit auch `--git-dir=*` und `-c foo=bar` erkannt werden.
const INJECTION_FLAGS = ['-C', '-c', '--config', '--config-env', '--exec', '--exec-path', '--git-dir', '--work-tree', '--upload-pack', '--receive-pack', '--namespace'];
// Verkettung, Umlenkung und Hintergrundstart: Jedes davon macht aus einem Pattern mehr als den
// einen freigegebenen Befehl. Längere Formen stehen vorn, damit `&&` nicht zusätzlich als `&`
// und `||` nicht zusätzlich als `|` gemeldet wird.
const CHAIN_TOKENS = ['&&', '||', '>>', '$(', ';', '|', '&', '>', '<', '`'];
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Die exakte Form des Push-Guards (AGENTS.md D2, „Kein blankes `Bash(git *)`").
const PUSH_GUARD = 'git push -u origin HEAD';
// Git-Unterbefehle, die den Worktree oder das Remote verändern — für `restrict_git_tools_to`
// (Prüf-Run des Leads: „Am Worktree liest der Prüf-Run ausschließlich", AGENTS.md D2).
const GIT_SCHREIBEND = ['add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'fetch', 'gc', 'init', 'merge', 'mv', 'pull', 'push', 'rebase', 'remote', 'reset', 'restore', 'revert', 'rm', 'stash', 'submodule', 'switch', 'tag', 'worktree'];

// Welche Verkettungs-/Umlenkungszeichen stecken im Token? Gefundene Zeichen werden aus dem Rest
// entfernt, damit Teilstücke längerer Formen nicht doppelt zählen.
function verkettungen(token) {
  const gefunden = new Set();
  let rest = token;
  for (const c of CHAIN_TOKENS) {
    if (rest.includes(c)) { gefunden.add(c); rest = rest.split(c).join(' '); }
  }
  return gefunden;
}

// Klassifiziert einen Freigabe-Eintrag. Ergebnis: Liste von Befunden mit level 'error'|'warn'.
// Heuristik über die Pattern-Form, nicht über die Semantik des Tools (Spec § 8): unklare Formen
// sind Warnungen, die dokumentierten Verstoßformen sind Fehler.
export function classifyToolPattern(entry) {
  const found = [];
  const add = (level, code, message) => found.push({ level, code, entry, message });

  const m = /^([A-Za-z][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(entry);
  if (!m) {
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(entry)) return found; // reines Tool wie `Read`
    add('error', 'unparsbar', 'kein gültiger Freigabe-Eintrag (erwartet `Tool` oder `Tool(<form>)`)');
    return found;
  }
  const [, tool, cmd] = m;
  if (tool !== 'Bash') {
    if (cmd.includes('*')) add('warn', 'nicht-bash-wildcard', `Wildcard in einem ${tool}-Eintrag — Form nicht klassifizierbar`);
    return found;
  }
  if (!cmd.trim()) {
    add('error', 'leeres-pattern', 'leeres Bash-Pattern — matcht nichts Definiertes');
    return found;
  }
  if (/[\n\r]/.test(cmd)) {
    add('error', 'befehlskette', 'Zeilenumbruch im Pattern — eine zweite Zeile ist ein zweiter Befehl und hängt an einer eigenen Freigabe (D2)');
  }

  const tokens = cmd.trim().split(/\s+/);
  for (const t of tokens) {
    const treffer = verkettungen(t);
    for (const c of treffer) {
      add('error', 'befehlskette', `Verkettungs-/Umlenkungszeichen \`${c}\` im Pattern — verkettete Kommandos hängen an einer eigenen Freigabe (D2)`);
    }
    // `$(` ist bereits als Befehlskette gemeldet; `$VAR`/`${VAR}` ist der eigene Fall:
    // Der Wert steht nicht im Pattern, die Freigabe deckt also unbekannten Text ab.
    if (!treffer.has('$(') && /\$\{?[A-Za-z_]/.test(t)) {
      add('error', 'variable-expansion', `\`${t}\` — Variablen-Expansion im Pattern; der Wert steht außerhalb der Freigabe und bestimmt mit, was ausgeführt wird`);
    }
    // Zuweisung mit Wildcard im Wert — an jeder Position, auch hinter `env` (Fall NODE_PATH=…).
    if (ASSIGNMENT.test(t) && t.includes('*')) {
      add('error', 'wert-wildcard', `\`${t}\` — Wildcard in Wert-Position einer Zuweisung; sie bestimmt mit, welcher Code im Lauf geladen wird (D2, „Warum nicht inline \`NODE_PATH=… node scripts/verify-mermaid.mjs\`")`);
    }
  }

  // Literale Zuweisungen vor dem Binary: Warnung — sie gehören in die Umgebung, nicht in die
  // Allowlist. (Die Wildcard-Variante ist oben schon hart gemeldet.)
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i])) {
    if (!tokens[i].includes('*')) {
      add('warn', 'inline-zuweisung', `\`${tokens[i]}\` — Zuweisung im Pattern; sie gehört in die Umgebung des Runs`);
    }
    i++;
  }
  const rest = tokens.slice(i);
  if (rest.length === 0) {
    add('error', 'nur-zuweisung', 'Pattern besteht nur aus Zuweisungen, kein Befehl');
    return found;
  }

  const binary = rest[0];
  if (binary.includes('*')) {
    add('error', 'binary-wildcard', 'Wildcard in der Position des Befehls selbst — matcht beliebige Programme');
    return found;
  }
  const hartesBinary = BLANKET_HARD.includes(binary);

  for (const t of rest.slice(1)) {
    const name = t.split('=')[0];
    if (INJECTION_FLAGS.includes(name)) {
      add('error', 'injektionsflag', `\`${t}\` im Pattern — bestimmt Arbeitsverzeichnis, Konfiguration oder ausgeführtes Programm (Blocker B1 aus PR #27; D2, „Weder \`git -C\` noch \`cd\`")`);
    }
  }

  // Der Push-Guard ist genau eine Form; jede andere `git push`-Variante muss an einer Freigabe
  // hängen bleiben (D2) — insbesondere das `git push origin HEAD:main`, vor dem D1 warnt.
  if (binary === 'git' && rest[1] === 'push' && rest.join(' ') !== PUSH_GUARD) {
    add('error', 'push-guard', `\`${rest.join(' ')}\` — einzige freigegebene Push-Form ist \`${PUSH_GUARD}\`; jede andere Variante deckt auch \`git push origin HEAD:main\` ab (D1/D2)`);
  }

  // Blankes Sammelpattern: Binary ohne festen Subcommand davor.
  if (rest.length === 1 || (rest.length === 2 && rest[1] === '*')) {
    if (hartesBinary) {
      add('error', 'sammelpattern', `\`${cmd}\` — blankes Sammelpattern für \`${binary}\`; es deckt auch die Formen ab, die D1/D2 verbieten bzw. führt beliebigen Code aus`);
    } else {
      add('warn', 'sammelpattern-unklar', `\`${cmd}\` — Sammelpattern ohne festen Subcommand; Reichweite nicht überprüfbar`);
    }
  }

  // Wildcard-Positionen: nur das abschließende alleinstehende `*` ist ein Argument-Wildcard.
  // Bei den harten Binaries ist jedes `*` außerhalb der letzten Position ein Fehler — es matcht
  // beliebigen Text samt der nachfolgenden Tokens und hebelt damit jede Einengung aus.
  for (let k = 1; k < rest.length; k++) {
    const t = rest[k];
    if (!t.includes('*')) continue;
    const last = k === rest.length - 1;
    if (t === '*' && last) continue; // Argument-Wildcard — die gewollte Form
    const level = !last && hartesBinary ? 'error' : 'warn';
    if (t === '*') {
      add(level, 'wildcard-mittig', `\`*\` in Position ${k + 1} von ${rest.length} — der \`*\` matcht beliebigen Text, auch die nachfolgenden Tokens`);
    } else {
      add(level, 'wildcard-eingebettet', `\`${t}\` — Wildcard innerhalb eines Tokens; matcht mehr als das gemeinte Argument`);
    }
  }
  return found;
}

// ------------------------------------------------- Ebene 2: Subsumption gegen die Verbotsformen

// Zerlegt einen Bash-Eintrag in die festen Tokens bis zum ersten `*` plus die Angabe, ob danach
// beliebiger Text folgen kann. `null` heißt: für einen Subsumptionsvergleich untauglich
// (kein Bash-Eintrag, Zuweisung vorweg, Wildcard in Binary-Position) — solche Formen meldet
// classifyToolPattern ohnehin für sich.
export function patternPraefix(entry) {
  const m = /^Bash\(([\s\S]*)\)$/.exec(entry ?? '');
  if (!m || !m[1].trim()) return null;
  const tokens = m[1].trim().split(/\s+/);
  if (ASSIGNMENT.test(tokens[0]) || tokens[0].includes('*')) return null;
  const fest = [];
  let offen = false;
  for (const t of tokens) {
    if (t.includes('*')) { offen = true; break; }
    fest.push(t);
  }
  return { fest, offen };
}

// `a` deckt `b` ab: alles, was `b` erlaubt, erlaubt auch `a`.
export function deckt(a, b) {
  if (!a || !b) return false;
  if (a.fest.length > b.fest.length) return false;
  for (let k = 0; k < a.fest.length; k++) if (a.fest[k] !== b.fest[k]) return false;
  return a.offen ? true : !b.offen && a.fest.length === b.fest.length;
}

// Vergleicht einen Freigabe-Eintrag mit einer Verbotsliste. Drei Modi (Feld `match`):
//   subsumption (Default) — verboten ist die Form selbst und alles, was unter sie fällt;
//                           zusätzlich jede Freigabe, die das Verbot mit abdeckt.
//   blanket               — das Verbot meint die Freigabeform selbst (`Bash(git *)`), nicht jeden
//                           Befehl darunter: geprüft wird nur, ob eine Freigabe sie mit abdeckt.
//   konvention            — die Form lässt sich durch die Freigabeform nicht ausschließen (ein
//                           breiteres, erlaubtes Pattern deckt sie ab); geprüft wird nur, dass sie
//                           nicht ausdrücklich als Eintrag auftaucht. Den Riegel setzt die Regel.
// `except` nennt die ausdrücklich erlaubten Formen unterhalb eines Verbots (Push-Guard,
// Label-Formen von `gh issue edit`, die D8-Zusatzfreigabe `--body`).
export function verbotsbefunde(entry, liste) {
  const found = [];
  const p = patternPraefix(entry);
  for (const f of liste ?? []) {
    const modus = f.match ?? 'subsumption';
    if (entry === f.pattern) {
      found.push({ code: 'verbotener-eintrag', f, message: `\`${entry}\` ist als verboten geführt (${f.directive}) — ${f.reason}` });
      continue;
    }
    if (modus === 'konvention') continue;
    const fp = patternPraefix(f.pattern);
    if (!p || !fp) continue;
    if (deckt(p, fp)) {
      found.push({ code: 'freigabe-deckt-verbot', f, message: `\`${entry}\` deckt die Verbotsform \`${f.pattern}\` mit ab (${f.directive}) — ${f.reason}` });
    } else if (modus !== 'blanket' && deckt(fp, p) && !(f.except ?? []).includes(entry)) {
      found.push({ code: 'verbotene-form', f, message: `\`${entry}\` fällt unter die Verbotsform \`${f.pattern}\` (${f.directive}) — ${f.reason}` });
    }
  }
  return found;
}

// ------------------------------------ Ebene 2c: D2-Prosa von AGENTS.md gegen die Tool-Sets
//
// render-agents.mjs vergleicht nur die beiden Marker-Bereiche (Rollen- und Label-Tabelle). Die
// Tool-Sets stehen in der Begründungsprosa von D2 und bleiben Handtext (Spec § 6) — ohne
// Abgleich können Prosa und DSL auseinanderlaufen, ohne dass CI es merkt (M6 aus PR #45).

// Grenzen des D2-Abschnitts: die D2-Aufzählung bis zur nächsten Direktiven-Aufzählung.
const D2_START = /^\s*-\s+\*\*D2\b/;
const D2_ENDE = /^\s*-\s+\*\*D[3-8]\b/;

// Fenced-Code-Blöcke fliegen vor der Extraktion raus: Ihre Backticks würden die Inline-Spans
// verschieben, und ein Befehlsbeispiel im Block ist keine Freigabeform (`git fetch origin` im
// Sync-Block von D8 steht ohne `Bash(…)` da).
function ohneCodebloecke(text) {
  return text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
}

// Der D2-Abschnitt als Text; `null`, wenn AGENTS.md keine D2-Aufzählung hat.
export function d2Abschnitt(markdown) {
  const zeilen = (markdown ?? '').split('\n');
  const von = zeilen.findIndex(z => D2_START.test(z));
  if (von === -1) return null;
  let bis = zeilen.length;
  for (let i = von + 1; i < zeilen.length; i++) {
    if (D2_ENDE.test(zeilen[i])) { bis = i; break; }
  }
  return zeilen.slice(von, bis).join('\n');
}

// Alle Backtick-eingefassten `Bash(…)`-Formen eines Textstücks samt Position. Robust gegen
// Zeilenumbrüche: In der Prosa ist ein Aufzählungspunkt über mehrere Zeilen umbrochen, eine Form
// kann also mitten im Backtick-Span umbrechen — der Whitespace innerhalb des Spans wird deshalb
// auf ein Leerzeichen normalisiert. Der Span muss auf `)` enden; „`Bash(a) und Bash(b)`" in einem
// Span wäre keine Freigabeform und fällt auf.
function bashVorkommen(text) {
  const vorkommen = [];
  for (const m of (text ?? '').matchAll(/`(Bash\([^`]*\))`/g)) {
    vorkommen.push({ form: m[1].replace(/\s+/g, ' ').trim(), von: m.index, bis: m.index + m[0].length });
  }
  return vorkommen;
}

// Dieselben Formen ohne Position, Reihenfolge erhalten, Dubletten entfernt.
export function inlineBashFormen(text) {
  const formen = [];
  for (const v of bashVorkommen(text)) if (!formen.includes(v.form)) formen.push(v.form);
  return formen;
}

// Zitat-Span: Ein Querverweis nennt die Überschrift des Zielpunkts wörtlich in „…" (AGENTS.md,
// Querverweis-Konvention — „Ein Verweis … nennt dessen fett gesetzte Überschrift wörtlich"). Die
// Konvention ist damit maschinell auswertbar: Was in einem solchen Span steht, ist zitiert.
const ZITAT_SPAN = /„[^„]*?"/g;

// Formen, die im Textstück ausschließlich innerhalb eines Zitat-Spans stehen. Kommt dieselbe Form
// einmal zitiert und einmal frei vor — in der Coder-Zeile von D2 ist
// `Bash(node scripts/verify-mermaid.mjs *)` beides: Set-Eintrag und Zitat im Querverweis —, zählt
// sie nicht als Zitat. Ein Zitat-Span ohne schließendes `"` wird nicht erkannt; die Form gilt dann
// als frei genannt (dokumentiert in docs/validate-setup.md, Ebene 2c).
export function zitierteFormen(text) {
  const spans = [...(text ?? '').matchAll(ZITAT_SPAN)].map(m => [m.index, m.index + m[0].length]);
  const nurZitat = new Map();
  for (const v of bashVorkommen(text)) {
    const drin = spans.some(([von, bis]) => v.von >= von && v.bis <= bis);
    nurZitat.set(v.form, (nurZitat.get(v.form) ?? true) && drin);
  }
  return new Set([...nurZitat].filter(([, drin]) => drin).map(([form]) => form));
}

// Das Label eines Aufzählungspunkts: der Text vor dem ersten `:`, sofern er ohne Backtick und
// ohne Fettung auskommt. Die Set-Punkte sehen so aus (`  - Coder: …`), die Begründungspunkte
// tragen eine fett gesetzte Überschrift (`  - **Kein blankes …**`) und liefern hier `null`.
function blockLabel(text) {
  const m = /^([^:\n`*]{1,80}):/.exec(text);
  return m ? m[1].trim() : null;
}

// Zerlegt den D2-Abschnitt in Aufzählungspunkte samt ihrer Fortsetzungszeilen.
export function d2Bloecke(abschnitt) {
  const rohe = [];
  for (const zeile of ohneCodebloecke(abschnitt ?? '').split('\n')) {
    const m = /^(\s*)-\s+(.*)$/.exec(zeile);
    if (m) rohe.push({ indent: m[1].length, zeilen: [m[2]] });
    else if (rohe.length) rohe.at(-1).zeilen.push(zeile.trim());
  }
  return rohe.map(b => {
    const text = b.zeilen.join('\n');
    return { indent: b.indent, label: blockLabel(text), formen: inlineBashFormen(text), zitate: zitierteFormen(text) };
  });
}

// „Lead (Delegation, Labels, …)" → `lead`; die Klammer ist Erläuterung, nicht Rollenname.
function labelKern(label) {
  return (label ?? '').toLowerCase().replace(/\(.*$/s, '').trim();
}
function passtZuRolle(label, rolle) {
  const l = labelKern(label);
  if (!l) return false;
  const name = (rolle.name ?? '').toLowerCase();
  return l === rolle.id || l === name || name.split('/').map(s => s.trim()).includes(l);
}

const istBash = e => /^Bash\(/.test(e ?? '');
const bedingteFormen = rolle => (rolle.conditional_tools ?? []).flatMap(
  c => [...(c.grants ?? []), ...(c.denies ?? []), ...(c.restrict_git_tools_to ?? [])]);

// Beidseitiger Abgleich der D2-Prosa gegen die Tool-Sets von roles.yaml:
//   Richtung a — jede in D2 genannte `Bash(…)`-Form braucht eine Entsprechung in der DSL. In
//     einem Set-Punkt zählt nur das Set der eigenen Rolle plus deren conditional_tools; in der
//     Begründungsprosa zählt die ganze DSL, weil die Punkte quer über die Rollen argumentieren.
//   Richtung b — jeder `Bash(…)`-Eintrag aus `allowed_tools` braucht einen Beleg im Set-Punkt
//     seiner Rolle. `conditional_tools` sind ausgenommen: Sie stehen laut D2 gerade NICHT im
//     Minimal-Set (Sync-Einträge, D8-Basiswechsel, D7-Vollendung), ihre Begründung steht am
//     Eintrag selbst (`reason`).
// In der Begründungsprosa gilt auch eine Verbotsform als Entsprechung: Die Punkte nennen sie als
// Gegenbeispiel, und der Subsumptionsvergleich belegt sie (`Bash(git -C worktrees/* status)` unter
// `Bash(git -C * status)`). **Im Set-Punkt gilt das nicht** (M1 zu PR #48): Eine Form, die unter
// ein Verbot der Rolle fällt oder in ihrem `must_not_include` steht, sagt das Gegenteil eines
// Belegs — stünde sie dort unerkannt, listete die Prosa ein verbotenes Tool im Minimal-Set, und
// der Lead gäbe es beim Delegieren frei. Zulässig ist im Set-Punkt nur das Zitat: die Form
// innerhalb eines Zitat-Spans „…" (Querverweis-Konvention, `zitierteFormen`), so wie die
// Coder- und die Lead-Zeile von D2 auf „**Kein blankes `Bash(gh issue edit *)`**" verweisen.
// Alles, was in keine dieser Kategorien fällt, steht als Ausnahme mit Begründung in der DSL
// (`d2_prose_check.excluded_entries`, je mit `side`, `directive` und `reason`) — eine stille
// Ausnahme im Skript gibt es nicht.
export function d2Abgleich(markdown, roles) {
  const befunde = [];
  const add = (code, message) => befunde.push({ code, message });
  const abschnitt = d2Abschnitt(markdown);
  if (abschnitt === null) {
    add('d2-abschnitt-fehlt', 'kein Aufzählungspunkt `- **D2 …**` gefunden — der Abgleich hat keine Quelle');
    return { befunde, geprueft: 0, ausnahmen: [] };
  }

  const rollen = roles.roles ?? [];
  const ausnahmen = (roles.d2_prose_check?.excluded_entries ?? []).map(a => ({ ...a, genutzt: false }));
  const ausnahme = (entry, side) => {
    const a = ausnahmen.find(x => x.entry === entry && x.side === side);
    if (a) a.genutzt = true;
    return Boolean(a);
  };

  const alleVerbote = [...(roles.forbidden_tools ?? []), ...rollen.flatMap(r => r.forbidden_tools ?? [])];
  const verbotsFormen = alleVerbote.map(f => f.pattern);
  const exceptFormen = alleVerbote.flatMap(f => f.except ?? []);
  const dslUniversum = new Set([
    ...rollen.flatMap(r => [...(r.allowed_tools ?? []), ...(r.must_not_include ?? []), ...bedingteFormen(r)]),
    ...verbotsFormen, ...exceptFormen,
  ]);
  const alsVerbotBelegt = e => verbotsFormen.includes(e) || exceptFormen.includes(e) || verbotsbefunde(e, alleVerbote).length > 0;

  const bloecke = d2Bloecke(abschnitt);
  const setBloecke = [];
  for (const [i, b] of bloecke.entries()) {
    if (!b.label) continue;
    const rolle = rollen.find(r => passtZuRolle(b.label, r));
    if (rolle) setBloecke.push({ ...b, index: i, rolle });
  }
  let geprueft = 0;

  for (const rolle of rollen) {
    const eigene = setBloecke.filter(s => s.rolle.id === rolle.id);
    if (eigene.length > 1) {
      add('prosa-set-doppelt', `\`${rolle.id}\`: der D2-Abschnitt nennt ${eigene.length} Set-Punkte für die Rolle (${eigene.map(s => `„${s.label}"`).join(', ')}) — welcher gilt, ist nicht entscheidbar`);
    }
    if (eigene.length === 0) {
      if (rolle.d2_set) add('prosa-set-fehlt', `\`${rolle.id}\`: \`d2_set\` ist true, aber der D2-Abschnitt von AGENTS.md nennt kein Minimal-Set für die Rolle`);
      continue;
    }
    if (!rolle.d2_set) {
      add('prosa-set-ohne-d2-set', `\`${rolle.id}\`: der D2-Abschnitt nennt ein Minimal-Set („${eigene[0].label}"), in der DSL ist \`d2_set\` aber false`);
    }
    const prosaFormen = [...new Set(eigene.flatMap(s => s.formen))];
    const dslFormen = (rolle.allowed_tools ?? []).filter(istBash);
    // Zitat gilt nur, wenn die Form in jedem Set-Punkt der Rolle, der sie nennt, zitiert ist.
    const zitate = new Set(prosaFormen.filter(e => eigene.every(s => !s.formen.includes(e) || s.zitate.has(e))));
    // Verbote der Rolle: die globalen plus ihre eigenen. Rollen-eigene Verbote gelten nur für sie —
    // `Bash(node scripts/verify-mermaid.mjs *)` ist im Reviewer-Set verboten und im Coder-Set Pflicht.
    const rollenVerbote = [...(roles.forbidden_tools ?? []), ...(rolle.forbidden_tools ?? [])];
    const mustNot = new Set((rolle.must_not_include ?? []).filter(istBash));
    const keineFreigabe = e => mustNot.has(e) || verbotsbefunde(e, rollenVerbote).length > 0;

    // Richtung b: Allowlist-Eintrag ohne Beleg im Set-Punkt der eigenen Rolle.
    for (const e of dslFormen) {
      geprueft++;
      if (prosaFormen.includes(e)) continue;
      if (ausnahme(e, 'roles_yaml')) continue;
      add('dsl-ohne-prosa', `\`${rolle.id}\`/allowed_tools: \`${e}\` kommt im D2-Set-Punkt „${eigene[0].label}" von AGENTS.md nicht vor — Prosa und DSL laufen auseinander`);
    }
    // Richtung a: Form im Set-Punkt, die die DSL für diese Rolle nicht führt. `must_not_include`
    // gehört bewusst NICHT ins Universum — die Liste sagt, was im Set nicht stehen darf.
    const eigenesUniversum = new Set([...dslFormen, ...bedingteFormen(rolle).filter(istBash)]);
    for (const e of prosaFormen) {
      geprueft++;
      if (ausnahme(e, 'agents_md')) continue;
      if (keineFreigabe(e)) {
        if (zitate.has(e)) continue;
        add('zitat-nicht-freigabe', `AGENTS.md D2, Set-Punkt „${eigene[0].label}": \`${e}\` ist für \`${rolle.id}\` keine Freigabeform (Verbotsform aus \`forbidden_tools\` bzw. Eintrag in \`must_not_include\`) — im Set-Punkt zählt sie nicht als Beleg. Als Querverweis gehört sie in einen Zitat-Span „…" (Querverweis-Konvention), sonst listet der Set-Punkt ein verbotenes Tool`);
        continue;
      }
      if (eigenesUniversum.has(e)) continue;
      add('prosa-ohne-dsl', `AGENTS.md D2, Set-Punkt „${eigene[0].label}": \`${e}\` hat in roles.yaml keine Entsprechung für \`${rolle.id}\` (weder im Set noch in \`conditional_tools\`)`);
    }
  }

  // Begründungsprosa: Punkte, die keinen Set-Punkt bilden. Sie argumentieren quer über die
  // Rollen („steht in allen drei Sets"), deshalb genügt hier ein Beleg irgendwo in der DSL.
  const setIndizes = new Set(setBloecke.map(s => s.index));
  for (const [i, b] of bloecke.entries()) {
    if (setIndizes.has(i)) continue;
    for (const e of b.formen) {
      geprueft++;
      if (dslUniversum.has(e) || alsVerbotBelegt(e) || ausnahme(e, 'agents_md')) continue;
      add('prosa-ohne-dsl', `AGENTS.md D2, Begründungsprosa: \`${e}\` hat in roles.yaml keine Entsprechung (kein Set-Eintrag, keine Zusatzfreigabe, keine Verbotsform)`);
    }
  }

  // Eine Ausnahme, die nichts ausnimmt, ist die stille Variante mit Zusatzschritt: Sie bleibt
  // stehen, wenn die Abweichung längst behoben ist, und deckt beim nächsten Mal zu viel ab.
  for (const a of ausnahmen) {
    if (!a.genutzt) {
      add('ausnahme-ohne-bezug', `d2_prose_check/\`${a.entry}\` (side: ${a.side}): der Abgleich findet die Abweichung nicht — die Ausnahme nimmt nichts aus`);
    }
  }

  return { befunde, geprueft, ausnahmen };
}

// ------------------------------------------------- Ebene 2d: Regel-Konsistenz (rules.yaml)
//
// `rules.yaml` macht die Direktiven prüfbar. Damit das mehr ist als eine Umformatierung der
// Prosa, prüft diese Ebene die Regeln gegen ihre eigenen Vokabulare: Ein `check`, das keine
// Quelle hat, ein `assert` über einen erfundenen Fakt oder ein `source`, der in AGENTS.md
// keine fett gesetzte Überschrift ist, machen aus einer Regel eine Behauptung.

// Operatoren von `assert` und ihr Operand. Die Zuordnung ist nicht Geschmackssache:
// `is_true` mit einem `value` daneben liest sich wie ein Vergleich und ist keiner.
const ASSERT_OPERATOREN = {
  is_true: null, is_false: null,
  equals: 'value', not_equals: 'value', matches: 'value',
  one_of: 'values', none_of: 'values',
};
// D6 — Keine eigene Infrastruktur: Es gibt GitHub und den lokalen Rechner, sonst nichts.
const INFRASTRUKTUR = ['github', 'local'];

// Die fett gesetzten Überschriften einer Markdown-Datei — die Zielmenge der
// Querverweis-Konvention von AGENTS.md. Der abschließende Satzpunkt (`.` bzw. `:`) gehört
// laut Konvention zum Satz, nicht zur Überschrift, und wird deshalb hier abgeschnitten:
// „**Eskalation:**" ist die Überschrift „Eskalation". Gelesen wird nicht-gierig, damit Formen
// wie `Bash(git *)` innerhalb der Fettung nicht stören.
//
// Als Überschrift zählt nur die **erste Fettung einer Aufzählungszeile, die mit ihr beginnt**
// (`- **X** …`, beliebig eingerückt) — in dieser Form stehen die Punkt-Titel von AGENTS.md
// durchgehend. Jede Fettung zu sammeln wäre zu großzügig: AGENTS.md ist voll von
// Inline-Betonungen (`**nicht**`, `**Vollständig**`, `**PFLICHT**`), und ein Verweis darauf
// löste dann genauso auf wie einer auf einen echten Punkt-Titel — also bliebe gerade der
// Fehlermodus unentdeckt, vor dem die Querverweis-Konvention warnt (Review-Befund N3 zu
// PR #49).
//
// **Grenze der Prüfung:** Es ist eine Existenzprüfung, keine Zuordnungsprüfung. Nicht geprüft
// wird, ob die zitierte Überschrift unter derjenigen Direktive steht, die die Regel als
// `directive` führt — ein Verweis auf den Geschwister-Punkt daneben fällt hier nicht auf und
// bleibt Sache des Reviewer-Runs.
const UEBERSCHRIFT_ZEILE = /^\s*[-*]\s+\*\*(.+?)\*\*/;
export function fetteUeberschriften(markdown) {
  const gefunden = new Set();
  for (const zeile of (markdown ?? '').split('\n')) {
    const m = zeile.match(UEBERSCHRIFT_ZEILE);
    if (!m) continue;
    const text = m[1].trim().replace(/[.:]+$/, '').trim();
    if (text) gefunden.add(text);
  }
  return gefunden;
}

// Prüft rules.yaml gegen sich selbst und gegen den Kontext:
//   fremdeFaktIds  — Fakt-IDs aus states.yaml (Kollisionen sind Fehler: beide Listen bilden
//                    ein Vokabular, das pipeline.yaml referenziert)
//   ueberschriften — die fetten Überschriften von AGENTS.md; `null` schaltet die Auflösung ab
//   dateiExistiert — Existenzprüfung für `source.doc`
//   genutztAnderswo — was pipeline.yaml referenziert (für die „ungenutzt"-Warnungen)
export function regelKonsistenz(rules, ctx) {
  const befunde = [];
  const add = (code, message, level = 'error') => befunde.push({ code, message, level });
  const {
    fremdeFaktIds = new Set(), ueberschriften = null, dateiExistiert = () => true,
    genutztAnderswo = {},
  } = ctx ?? {};
  const extern = {
    fakten: genutztAnderswo.fakten ?? new Set(),
    trigger: genutztAnderswo.trigger ?? new Set(),
    regeln: genutztAnderswo.regeln ?? new Set(),
  };

  const quellen = new Map();
  for (const q of rules.check_sources ?? []) {
    if (quellen.has(q.id)) add('doppelte-id', `check_sources: \`${q.id}\` doppelt vergeben`);
    quellen.set(q.id, q);
    if (!INFRASTRUKTUR.includes(q.infrastructure)) {
      add('fremde-infrastruktur', `check_sources/\`${q.id}\`: \`infrastructure: ${q.infrastructure}\` — es gibt nur \`${INFRASTRUKTUR.join('` und `')}\` (D6 — Keine eigene Infrastruktur)`);
    }
  }

  const trigger = new Map();
  for (const t of rules.triggers ?? []) {
    if (trigger.has(t.id)) add('doppelte-id', `triggers: \`${t.id}\` doppelt vergeben`);
    trigger.set(t.id, t);
    if (!quellen.has(t.observable_via)) {
      add('unbekannte-check-quelle', `triggers/\`${t.id}\`: observable_via \`${t.observable_via}\` steht nicht in \`check_sources\` — das Ereignis wäre nicht beobachtbar`);
    }
  }

  const fakten = new Map();
  for (const f of rules.facts ?? []) {
    if (fakten.has(f.id)) add('doppelte-id', `facts: \`${f.id}\` doppelt vergeben`);
    fakten.set(f.id, f);
    if (fremdeFaktIds.has(f.id)) {
      add('fakt-id-kollision', `facts/\`${f.id}\`: die ID gibt es auch in workflow/states.yaml — beide Listen bilden ein Vokabular, bei doppelter ID ist nicht entscheidbar, welcher Fakt gemeint ist`);
    }
    if (!quellen.has(f.check)) add('unbekannte-check-quelle', `facts/\`${f.id}\`: check \`${f.check}\` steht nicht in \`check_sources\``);
  }

  const genutzteFakten = new Set();
  const genutzteQuellen = new Set();
  const genutzteTrigger = new Set();

  // Querverweis: genau eine Belegstelle, und sie muss auflösbar sein.
  const pruefeQuelle = (wo, quelle) => {
    const hat = ['agents_md', 'doc'].filter(k => quelle?.[k] !== undefined);
    if (hat.length === 0) { add('quelle-fehlt', `${wo}: source nennt weder \`agents_md\` noch \`doc\` — die Regel hat keine belegte Herkunft`); return; }
    if (hat.length > 1) { add('quelle-doppelt', `${wo}: source nennt \`agents_md\` UND \`doc\` — welche Stelle gilt, ist nicht entscheidbar`); return; }
    if (quelle.doc !== undefined) {
      for (const datei of quelle.doc.match(/\b(?:[\w.-]+\/)*[\w.-]+\.(?:md|ya?ml|mjs)\b/g) ?? []) {
        if (!dateiExistiert(datei)) add('quelldatei-fehlt', `${wo}: source.doc nennt \`${datei}\` — die Datei gibt es im Repo nicht`);
      }
      return;
    }
    const text = quelle.agents_md;
    if (/[.:]$/.test(text)) {
      add('ueberschrift-satzpunkt', `${wo}: source.agents_md \`${text}\` endet auf einen Satzpunkt — Querverweise zitieren den Überschriftentext ohne ihn (AGENTS.md, Querverweis-Konvention, „Satzpunkt")`);
      return;
    }
    if (ueberschriften && !ueberschriften.has(text)) {
      add('ueberschrift-fehlt', `${wo}: source.agents_md \`${text}\` kommt in AGENTS.md nicht als fett gesetzte Überschrift vor — toter Querverweis`);
    }
  };

  // `assert`: entweder ein Blatt (fact + operator) oder eine Verknüpfung `all_of`/`any_of`
  // aus Blättern. Jeder genannte Fakt muss existieren UND aus derselben Quelle kommen, die
  // die Regel als `check` führt — sonst prüft niemand dort, wo die Regel es behauptet.
  const pruefeAssert = (wo, a, regelCheck, tiefe = 0) => {
    const zweige = ['all_of', 'any_of'].filter(k => Array.isArray(a?.[k]));
    if (zweige.length > 1) { add('assert-form', `${wo}: assert nennt \`all_of\` und \`any_of\` zugleich`); return; }
    if (zweige.length === 1) {
      const z = zweige[0];
      if (tiefe > 0) { add('assert-form', `${wo}: \`${z}\` ist geschachtelt — vorgesehen ist eine Ebene aus Blättern`); return; }
      if (a.fact !== undefined) { add('assert-form', `${wo}: assert nennt \`${z}\` und zugleich ein eigenes \`fact\``); return; }
      if (a[z].length < 2) add('assert-form', `${wo}: \`${z}\` mit ${a[z].length} Zweig — eine Verknüpfung braucht mindestens zwei`);
      for (const zweig of a[z]) pruefeAssert(wo, zweig, regelCheck, tiefe + 1);
      return;
    }
    if (a?.fact === undefined) { add('assert-form', `${wo}: assert nennt weder ein \`fact\` noch \`all_of\`/\`any_of\``); return; }
    const op = a.operator;
    if (!(op in ASSERT_OPERATOREN)) {
      add('unbekannter-operator', `${wo}: operator \`${op}\` — erlaubt sind ${Object.keys(ASSERT_OPERATOREN).map(o => `\`${o}\``).join(', ')}`);
    } else {
      const gesetzt = ['value', 'values'].filter(k => a[k] !== undefined);
      const soll = ASSERT_OPERATOREN[op] ? [ASSERT_OPERATOREN[op]] : [];
      if (gesetzt.join(',') !== soll.join(',')) {
        add('assert-operand', `${wo}: operator \`${op}\` erwartet ${soll.length ? `\`${soll[0]}\`` : 'keinen Operanden'}, gefunden: ${gesetzt.length ? gesetzt.map(k => `\`${k}\``).join(', ') : 'keinen'}`);
      }
    }
    genutzteFakten.add(a.fact);
    const f = fakten.get(a.fact);
    if (!f) { add('unbekannter-fakt', `${wo}: assert nennt \`${a.fact}\` — kein Fakt aus \`facts\``); return; }
    if (f.check !== regelCheck) {
      add('fakt-quelle-abweichend', `${wo}: die Regel führt \`check: ${regelCheck}\`, der Fakt \`${a.fact}\` kommt aber aus \`${f.check}\` — dann prüft niemand dort, wo die Regel es behauptet`);
    }
  };

  // Abdeckung: jede Direktive entweder als Regel oder ausdrücklich als Prosa-Konvention.
  const abgedeckt = new Set();
  const regelIds = new Set();
  const regelListe = rules.rules ?? [];

  for (const [i, r] of regelListe.entries()) {
    const wo = `rules/\`${r.id}\``;
    if (regelIds.has(r.id)) add('doppelte-id', `${wo}: Regel-ID doppelt vergeben`);
    regelIds.add(r.id);
    if (i === 0 && r.id !== 'DSL_self_validation') {
      add('selbstvalidierung-nicht-erste', `rules: erste Regel ist \`${r.id}\` — zuerst erklärt die DSL ihre eigene Prüfpflicht (\`DSL_self_validation\`)`);
    }
    genutzteTrigger.add(r.on);
    const t = trigger.get(r.on);
    if (!t) add('unbekannter-trigger', `${wo}: on \`${r.on}\` steht nicht in \`triggers\``);
    genutzteQuellen.add(r.check);
    if (!quellen.has(r.check)) add('unbekannte-check-quelle', `${wo}: check \`${r.check}\` steht nicht in \`check_sources\``);
    pruefeAssert(wo, r.assert, r.check);
    pruefeQuelle(wo, r.source);
    if (r.directive) abgedeckt.add(r.directive);
    // Review-Befunde sind ausdrücklich KEIN D8-Fall (AGENTS.md D8, „Abgrenzung zur
    // Review-Schleife"). Eine D8-Regel an diesem Trigger wäre genau die Verwechslung,
    // die #11 ausgelöst hat.
    if (r.directive === 'D8' && r.on === 'review_finding') {
      add('d8-review-schleife', `${wo}: D8-Regel am Trigger \`review_finding\` — Review-Befunde an einem offenen PR sind kein D8-Fall (AGENTS.md D8, „Abgrenzung zur Review-Schleife"); sie gehören in die Review-Schleife von docs/workflow.md`);
    }
    if (t?.pipeline && !extern.regeln.has(r.id)) {
      add('regel-ohne-pipeline-bezug', `${wo}: hängt am Pipeline-Trigger \`${r.on}\`, wird aber von keinem Schritt in workflow/pipeline.yaml referenziert — dann prüft sie niemand an der Stelle, an der sie greift`, 'warn');
    }
  }
  if (regelListe.length === 0) {
    add('selbstvalidierung-nicht-erste', 'rules: keine einzige Regel — `DSL_self_validation` fehlt');
  }
  const selbst = regelListe.find(r => r.id === 'DSL_self_validation');
  if (selbst && (selbst.on !== 'workflow_change' || selbst.check !== 'ci_run')) {
    add('selbstvalidierung-form', `rules/\`DSL_self_validation\`: erwartet \`on: workflow_change\` und \`check: ci_run\` (gefunden: \`${selbst.on}\`/\`${selbst.check}\`) — die Selbstprüfung hängt am CI-Lauf des ändernden PRs`);
  }

  for (const k of rules.documented_conventions ?? []) {
    const wo = `documented_conventions/\`${k.id}\``;
    if (regelIds.has(k.id)) add('doppelte-id', `${wo}: ID doppelt vergeben`);
    regelIds.add(k.id);
    pruefeQuelle(wo, k.source);
    // Ohne `directive` deckt der Eintrag keine Direktive ab — das ist erlaubt (der Cleanup
    // steht in der Worktree-Konvention, nicht in D1–D8) und darf die Abdeckungsprüfung
    // unten nicht mit einem leeren Eintrag verwässern.
    if (k.directive) abgedeckt.add(k.directive);
  }

  for (let n = 1; n <= 8; n++) {
    const d = `D${n}`;
    if (!abgedeckt.has(d)) {
      add('direktive-ohne-abdeckung', `\`${d}\` kommt weder als Regel noch als \`documented_conventions\`-Eintrag vor — jede Direktive ist entweder prüfbar oder ausdrücklich als Prosa-Konvention geführt`);
    }
  }

  // Vokabeln, die niemand benutzt: kein Fehler, aber sie täuschen Umfang vor.
  for (const id of fakten.keys()) {
    if (!genutzteFakten.has(id) && !extern.fakten.has(id)) {
      add('fakt-ungenutzt', `facts/\`${id}\`: kein \`assert\` und kein \`fact_check\` aus workflow/pipeline.yaml verlangt den Fakt`, 'warn');
    }
  }
  for (const id of quellen.keys()) {
    if (!genutzteQuellen.has(id)) add('check-quelle-ungenutzt', `check_sources/\`${id}\`: keine Regel führt \`check: ${id}\``, 'warn');
  }
  for (const id of trigger.keys()) {
    if (!genutzteTrigger.has(id) && !extern.trigger.has(id)) {
      add('trigger-ungenutzt', `triggers/\`${id}\`: keine Regel und kein Pipeline-Schritt hängt daran`, 'warn');
    }
  }

  return { befunde, geprueft: regelListe.length + (rules.documented_conventions ?? []).length, regelIds };
}

// -------------------------------------------- Ebene 2e: Pipeline-Konsistenz (pipeline.yaml)
//
// Die Bedingungen sind strukturierte Felder statt freier Strings — nur deshalb lässt sich
// prüfen, ob das Genannte existiert (Lektion R7 aus PR #45). Genau vier Formen, je eine pro
// Eintrag; jede Referenz wird gegen roles.yaml, states.yaml bzw. rules.yaml aufgelöst.
const CI_KONKLUSIONEN = ['success', 'failure', 'pending'];
const BEDINGUNGSARTEN = ['label_check', 'actor_check', 'ci_check', 'fact_check'];

export function pipelineKonsistenz(pipeline, ctx) {
  const befunde = [];
  const add = (code, message, level = 'error') => befunde.push({ code, message, level });
  const {
    rollen = new Map(), zustaende = new Map(), faktIds = new Set(), regelIds = new Set(),
    uebergaenge = [], doneState = null, maxReviewLoops = null,
  } = ctx ?? {};

  const schritte = new Map();
  for (const s of pipeline.steps ?? []) {
    if (schritte.has(s.id)) add('doppelte-id', `steps: Schritt-ID \`${s.id}\` doppelt vergeben`);
    schritte.set(s.id, s);
  }
  const rolleOk = r => r === 'human' || rollen.has(r);
  const genutzteRegeln = new Set();
  const genutzteFakten = new Set();
  const genutzteTrigger = new Set();

  const pruefeBedingung = (wo, b) => {
    const schluessel = Object.keys(b ?? {});
    const fremd = schluessel.filter(k => !BEDINGUNGSARTEN.includes(k));
    if (fremd.length) {
      add('unbekannte-bedingung', `${wo}: \`${fremd.join('`, `')}\` ist keine der vier Bedingungsformen (${BEDINGUNGSARTEN.map(a => `\`${a}\``).join(', ')})`);
    }
    const arten = BEDINGUNGSARTEN.filter(k => b?.[k] !== undefined);
    if (arten.length === 0) { add('unbekannte-bedingung', `${wo}: Bedingung ohne erkennbare Form — freie Strings gibt es hier nicht`); return; }
    if (arten.length > 1) { add('unbekannte-bedingung', `${wo}: ${arten.length} Bedingungsformen in einem Eintrag (\`${arten.join('`, `')}\`) — eine pro Eintrag, sonst ist die Verknüpfung ungesagt`); return; }
    const art = arten[0];
    const v = b[art];
    if (art === 'label_check') {
      const z = zustaende.get(v.state);
      if (!z) add('unbekannter-zustand', `${wo}/label_check: \`${v.state}\` ist kein Zustand aus workflow/states.yaml`);
      else if (!z.label) add('label-check-ohne-label', `${wo}/label_check: der Zustand \`${v.state}\` trägt kein Label — ein Label-Check darauf prüft nichts`);
    } else if (art === 'actor_check') {
      if (!rolleOk(v.role)) add('unbekannte-rolle', `${wo}/actor_check: \`${v.role}\` ist keine Rolle aus workflow/roles.yaml und nicht \`human\``);
    } else if (art === 'ci_check') {
      if (!CI_KONKLUSIONEN.includes(v.conclusion)) {
        add('unbekannte-ci-konklusion', `${wo}/ci_check: \`${v.conclusion}\` — erlaubt sind ${CI_KONKLUSIONEN.map(c => `\`${c}\``).join(', ')}`);
      }
    } else {
      genutzteFakten.add(v.fact);
      if (!faktIds.has(v.fact)) {
        add('unbekannter-fakt', `${wo}/fact_check: \`${v.fact}\` ist kein Fakt aus workflow/states.yaml oder workflow/rules.yaml`);
      }
      if (typeof v.expected !== 'boolean') {
        add('fact-check-erwartung', `${wo}/fact_check: \`expected\` ist \`${v.expected}\` — erwartet wird \`true\` oder \`false\``);
      }
    }
  };

  if (!schritte.has(pipeline.first)) add('unbekannter-schritt', `first: \`${pipeline.first}\` ist kein Schritt`);

  for (const s of pipeline.steps ?? []) {
    const wo = `steps/\`${s.id}\``;
    if (!rolleOk(s.actor)) {
      add('unbekannte-rolle', `${wo}: actor \`${s.actor}\` ist keine Rolle aus workflow/roles.yaml und nicht \`human\``);
    }
    const rolle = rollen.get(s.actor);
    if (s.delegated) {
      if (s.actor === 'human') {
        add('delegation-an-mensch', `${wo}: \`delegated: true\`, actor ist aber \`human\` — ein Mensch bekommt kein \`--max-turns\``);
      } else if (rolle && (!rolle.delegated || !rolle.budget)) {
        add('schritt-ohne-budget', `${wo}: der Schritt ist ein delegierter Run, \`${s.actor}\` trägt in workflow/roles.yaml aber kein \`budget\` mit \`delegated: true\` (D2 — Delegationen immer mit \`--max-turns\`)`);
      }
    }
    for (const feld of ['state_before', 'state_after']) {
      if (!zustaende.has(s[feld])) add('unbekannter-zustand', `${wo}: ${feld} \`${s[feld]}\` ist kein Zustand aus workflow/states.yaml`);
    }
    // D1: In den Endzustand *führt* kein Agenten-Schritt. Geprüft wird der Zustandswechsel,
    // nicht das bloße Stehen in `done`: Hinter dem Merge liegt der Cleanup-Schritt (Lead,
    // `done` → `done`), der keinen Übergang auslöst und deshalb auch nichts an D1 rührt —
    // er räumt auf, was der Merge hinterlässt. Ohne die Einschränkung auf den Wechsel
    // meldete der Wächter genau diesen Schritt als Agenten-Merge.
    if (doneState && s.state_after === doneState && s.state_before !== s.state_after && s.actor !== 'human') {
      add('d1-merge-schritt', `${wo}: führt nach \`${doneState}\`, actor ist aber \`${s.actor}\` — der Merge gehört Martin (D1 — Merge nur durch Martin)`);
    }
    // Ein Zustandswechsel braucht einen Übergang, und dessen Owner ist der Akteur des Schritts.
    if (s.state_before !== s.state_after && zustaende.has(s.state_before) && zustaende.has(s.state_after)) {
      const passend = uebergaenge.filter(t => t.from === s.state_before && t.to === s.state_after);
      if (passend.length === 0) {
        add('uebergang-fehlt', `${wo}: \`${s.state_before}\` → \`${s.state_after}\`, workflow/states.yaml kennt aber keinen solchen Übergang`);
      } else if (!passend.some(t => t.owner === s.actor || t.owner_fallback === s.actor || t.owner === 'any_agent')) {
        add('uebergang-owner', `${wo}: der Übergang \`${passend.map(t => t.id).join('`/`')}\` gehört \`${passend.map(t => t.owner).join('`/`')}\`, der Schritt aber \`${s.actor}\``);
      }
    }
    for (const [i, b] of (s.preconditions ?? []).entries()) pruefeBedingung(`${wo}/preconditions[${i}]`, b);
    for (const [i, b] of (s.postconditions ?? []).entries()) pruefeBedingung(`${wo}/postconditions[${i}]`, b);
    for (const r of s.rules ?? []) {
      genutzteRegeln.add(r);
      if (!regelIds.has(r)) add('unbekannte-regel', `${wo}: rules nennt \`${r}\` — keine Regel aus workflow/rules.yaml`);
    }
    for (const n of s.next ?? []) {
      if (!schritte.has(n)) { add('unbekannter-schritt', `${wo}: next \`${n}\` ist kein Schritt`); continue; }
      const ziel = schritte.get(n);
      if (ziel.state_before !== s.state_after) {
        add('schritt-zustandsbruch', `${wo}: endet in \`${s.state_after}\`, der Folgeschritt \`${n}\` setzt aber \`${ziel.state_before}\` voraus`);
      }
    }
    if (s.loop) {
      if (!schritte.has(s.loop.to)) add('unbekannter-schritt', `${wo}/loop: to \`${s.loop.to}\` ist kein Schritt`);
      const t = uebergaenge.find(x => x.id === s.loop.transition);
      if (!t) {
        add('unbekannter-uebergang', `${wo}/loop: transition \`${s.loop.transition}\` steht nicht in workflow/states.yaml`);
      } else if (t.loop !== true) {
        add('schleife-nicht-markiert', `${wo}/loop: \`${t.id}\` ist in workflow/states.yaml nicht \`loop: true\` — die Schleife wäre nicht zählbar`);
      }
      if (maxReviewLoops !== null && s.loop.max !== maxReviewLoops) {
        add('schleifen-limit', `${wo}/loop: max ${s.loop.max}, workflow/states.yaml nennt \`max_review_loops: ${maxReviewLoops}\` — zwei Grenzen für dieselbe Schleife`);
      }
      if (s.loop.trigger) genutzteTrigger.add(s.loop.trigger);
    }
  }

  // Erreichbarkeit ab `first`, Schleifenkanten eingeschlossen.
  const erreicht = new Set(schritte.has(pipeline.first) ? [pipeline.first] : []);
  for (let geaendert = true; geaendert;) {
    geaendert = false;
    for (const s of pipeline.steps ?? []) {
      if (!erreicht.has(s.id)) continue;
      for (const n of [...(s.next ?? []), ...(s.loop ? [s.loop.to] : [])]) {
        if (schritte.has(n) && !erreicht.has(n)) { erreicht.add(n); geaendert = true; }
      }
    }
  }
  for (const s of pipeline.steps ?? []) {
    if (!erreicht.has(s.id)) add('schritt-unerreichbar', `steps/\`${s.id}\`: von \`${pipeline.first}\` aus nicht erreichbar`);
  }

  return { befunde, geprueft: (pipeline.steps ?? []).length, genutzteRegeln, genutzteFakten, genutzteTrigger };
}

// --------------------------------------------------------------------------------- Selbsttest

// Verstoßformen, die die Analyse hart melden muss. Die ersten drei sind die historischen Fälle
// aus der Spec (§ 7, AK 3), die übrigen die Durchrutscher aus dem Review zu PR #45.
// Der Selbsttest läuft bei jedem Lauf mit: Fällt einer davon durch, ist der Validator kaputt.
const HISTORISCHE_VERSTOESSE = [
  { id: 'B1 (-C-Wildcard, PR #27)', entry: 'Bash(git -C worktrees/* status)', code: 'injektionsflag' },
  { id: 'NODE_PATH=-Inline-Prefix', entry: 'Bash(NODE_PATH=* node scripts/verify-mermaid.mjs *)', code: 'wert-wildcard' },
  { id: 'blankes git *', entry: 'Bash(git *)', code: 'sammelpattern' },
  { id: 'Push an main vorbei (D1)', entry: 'Bash(git push origin HEAD:main)', code: 'push-guard' },
  { id: 'Push-Sammelform', entry: 'Bash(git push *)', code: 'push-guard' },
  { id: 'Injektionsflag in =-Form', entry: 'Bash(git --git-dir=* status)', code: 'injektionsflag' },
  { id: 'Injektionsflag --exec-path=', entry: 'Bash(git --exec-path=/tmp status)', code: 'injektionsflag' },
  { id: 'Zuweisung hinter env', entry: 'Bash(env NODE_PATH=* node scripts/verify-mermaid.mjs *)', code: 'wert-wildcard' },
  { id: 'mittiger * deckt --body ab', entry: 'Bash(gh issue edit * --add-label *)', code: 'wildcard-mittig' },
  { id: 'Wildcard vor festem Subcommand', entry: 'Bash(git * status)', code: 'wildcard-mittig' },
  { id: 'blankes node *', entry: 'Bash(node *)', code: 'sammelpattern' },
  { id: 'blankes bash *', entry: 'Bash(bash *)', code: 'sammelpattern' },
  { id: 'Umlenkung', entry: 'Bash(git log > /tmp/log)', code: 'befehlskette' },
  { id: 'Hintergrundstart', entry: 'Bash(gh run list & )', code: 'befehlskette' },
  { id: 'Variablen-Expansion', entry: 'Bash(git commit -m $MSG)', code: 'variable-expansion' },
  { id: 'Variablen-Expansion ${}', entry: 'Bash(gh pr comment ${NR} --body *)', code: 'variable-expansion' },
  { id: 'Zeilenumbruch', entry: 'Bash(git status --long\ngit push origin HEAD:main)', code: 'befehlskette' },
];
// Formen, die erlaubt bleiben müssen — ein Fehlalarm hier macht die Analyse unbrauchbar.
const ERLAUBTE_FORMEN = [
  'Read', 'Write', 'Bash(git status *)', 'Bash(git push -u origin HEAD)', 'Bash(git pull)',
  'Bash(git branch -D *)', 'Bash(gh issue edit --add-label *)', 'Bash(node scripts/verify-mermaid.mjs *)',
  'Bash(git worktree *)', 'Bash(git merge origin/main)', 'Bash(git fetch origin)',
  'Bash(gh pr comment *)', 'Bash(gh issue edit --body *)', 'Bash(git checkout main)',
];
// Die Verbotsformen für den Subsumptionsteil kommen aus `forbidden_tools` von roles.yaml und
// werden dem Selbsttest übergeben: Eine zweite, handgepflegte Kopie der Liste im Skript würde
// stumm auseinanderlaufen (Review-Befund R2 zu PR #45). Die Fälle unten behalten ihre
// Beispielformen — sie sind das Geprüfte, nicht die Regel, gegen die geprüft wird.
//
// Freigaben, die ein Verbot mit abdecken (Sammelpattern auf Subcommand-Ebene) bzw. darunter
// fallen — beides muss der Subsumptionsvergleich hart melden.
const VERBOTS_VERSTOESSE = [
  { id: 'gh pr * deckt gh pr merge ab', entry: 'Bash(gh pr *)', code: 'freigabe-deckt-verbot' },
  { id: 'gh issue * deckt gh issue edit ab', entry: 'Bash(gh issue *)', code: 'freigabe-deckt-verbot' },
  { id: 'git push origin HEAD:main fällt unter git push *', entry: 'Bash(git push origin HEAD:main)', code: 'verbotene-form' },
  { id: 'gh issue edit --body-file fällt unter gh issue edit *', entry: 'Bash(gh issue edit --body-file *)', code: 'verbotene-form' },
  { id: 'Konventionsform als Eintrag', entry: 'Bash(gh pr comment --edit-last *)', code: 'verbotener-eintrag' },
];
// Gegenrichtung: Diese Freigaben dürfen aus dem Subsumptionsvergleich keinen Befund erzeugen.
const VERBOTS_ERLAUBT = [
  'Bash(git status *)', 'Bash(git push -u origin HEAD)', 'Bash(gh pr view *)', 'Bash(gh pr create *)',
  'Bash(gh pr comment *)', 'Bash(gh issue edit --add-label *)', 'Bash(gh issue edit --body *)',
  'Bash(gh issue create *)', 'Bash(git worktree *)',
];

// Fälle für den beidseitigen D2-Prosa-Abgleich. Geprüft wird gegen eine Miniatur-DSL und ein
// Miniatur-AGENTS.md: Der Selbsttest soll die Vergleichslogik prüfen, nicht den jeweiligen Stand
// der echten Dateien — der ist der eigentliche Lauf. Jede Richtung hat mehrere Fälle, die melden
// müssen, und mehrere, die schweigen müssen; ein Fehlalarm hier wäre so teuer wie ein
// Durchrutscher. Erwartet wird die **vollständige** Befundliste (`codes`), nicht nur ein
// enthaltener Code: Ein zusätzlicher Fehlalarm im selben Fall fiele sonst nicht auf (M2 zu PR #48).
const D2_MINI_ROLLEN = {
  forbidden_tools: [
    { pattern: 'Bash(git *)', directive: 'D2', match: 'blanket', reason: 'blankes Sammelpattern' },
    // Damit der Set-Punkt-Check gegen eine echte Verbotsform läuft und nicht nur gegen eine
    // unbeteiligte: `Bash(gh pr merge *)` steht in der echten roles.yaml genauso (M1 zu PR #48).
    { pattern: 'Bash(gh pr merge *)', directive: 'D1', reason: 'Merge nur durch Martin' },
  ],
  d2_prose_check: { file: 'AGENTS.md', excluded_entries: [] },
  roles: [
    {
      id: 'coder', name: 'Coder', d2_set: true,
      allowed_tools: ['Read', 'Bash(git status *)', 'Bash(git add *)'],
      must_not_include: ['Bash(gh pr edit *)'],
      conditional_tools: [{ id: 'sync_run', directive: 'D8', reason: 'Sync-Einträge, D8', grants: ['Bash(git merge origin/main)'] }],
    },
  ],
};
// Variante mit zweiter Rolle ohne D2-Set — für `prosa-set-ohne-d2-set`.
const D2_MINI_MIT_TESTER = {
  ...D2_MINI_ROLLEN,
  roles: [...D2_MINI_ROLLEN.roles, { id: 'tester', name: 'Tester', d2_set: false }],
};
// Miniatur-DSL mit einer Ausnahme; `side` unterscheidet die beiden Richtungen.
const d2MiniMitAusnahme = (entry, side, reason) => ({
  ...D2_MINI_ROLLEN,
  d2_prose_check: { file: 'AGENTS.md', excluded_entries: [{ entry, side, directive: 'D2', reason }] },
});
// Miniatur-AGENTS.md: D2-Aufzählung, ein Set-Punkt (Folgezeilen davon als Umbruch), beliebig viele
// weitere Punkte, dann D3 — mehr braucht die Abschnittsgrenze nicht.
const d2Mini = (setZeilen, ...weitere) => [
  '- **D2 — Budget-Guards:** Delegationen immer mit `--max-turns`. Minimal-Set:',
  ...setZeilen.map((z, i) => (i === 0 ? `  - ${z}` : `    ${z}`)),
  ...weitere.map(z => `  - ${z}`),
  '- **D3 — Kleine PRs:** Ein PR = ein Issue.',
].join('\n');
// Der vollständige Set-Punkt der Miniatur-Rolle: enthält genau die `Bash(…)`-Einträge ihrer
// Allowlist, erzeugt also für sich genommen keinen Befund.
const D2_SET_PUNKT = 'Coder: `Read`, `Bash(git status *)`, `Bash(git add *)`';
const D2_FAELLE = [
  // --- Richtung a (Prosa → DSL), melden
  {
    id: 'Richtung a: Prosa-Form ohne DSL-Entsprechung',
    md: d2Mini([`${D2_SET_PUNKT}, \`Bash(gh run view *)\``]),
    codes: ['prosa-ohne-dsl'],
  },
  {
    id: 'Richtung a: Verbotsform im Set-Punkt ist kein Beleg',
    md: d2Mini([`${D2_SET_PUNKT}, \`Bash(gh pr merge *)\``]),
    codes: ['zitat-nicht-freigabe'],
  },
  {
    id: 'Richtung a: Form unterhalb einer Verbotsform im Set-Punkt ist kein Beleg',
    md: d2Mini([`${D2_SET_PUNKT}, \`Bash(gh pr merge --squash *)\``]),
    codes: ['zitat-nicht-freigabe'],
  },
  {
    id: 'Richtung a: must_not_include-Form im Set-Punkt ist kein Beleg',
    md: d2Mini([`${D2_SET_PUNKT}, \`Bash(gh pr edit *)\``]),
    codes: ['zitat-nicht-freigabe'],
  },
  // --- Richtung a, Gegenrichtung (schweigen)
  {
    id: 'Richtung a Gegenrichtung: Verbotsform in der Begründungsprosa',
    md: d2Mini([D2_SET_PUNKT], 'Kein blankes `Bash(git *)`.'),
    codes: [],
  },
  {
    id: 'Richtung a Gegenrichtung: Verbotsform im Set-Punkt, aber als Zitat',
    md: d2Mini([`${D2_SET_PUNKT} (Begründung in „**Kein \`Bash(gh pr merge *)\`**")`]),
    codes: [],
  },
  {
    id: 'Richtung a Gegenrichtung: Zeilenumbruch mitten im Backtick-Span',
    md: d2Mini(['Coder: `Read`, `Bash(git status *)`, `Bash(git', 'add *)`']),
    codes: [],
  },
  {
    id: 'Richtung a Gegenrichtung: Ausnahme (side: agents_md) greift',
    md: d2Mini([D2_SET_PUNKT], 'Argumentlos (`Bash(git status)`) ist nicht nötig.'),
    roles: d2MiniMitAusnahme('Bash(git status)', 'agents_md', 'bläht das Minimal-Set auf'),
    codes: [],
  },
  // --- Richtung b (DSL → Prosa), melden
  {
    id: 'Richtung b: Allowlist-Eintrag ohne Prosa-Beleg',
    md: d2Mini(['Coder: `Read`, `Bash(git status *)`']),
    codes: ['dsl-ohne-prosa'],
  },
  {
    id: 'Richtung b: mehrere Allowlist-Einträge ohne Prosa-Beleg',
    md: d2Mini(['Coder: `Read`']),
    codes: ['dsl-ohne-prosa', 'dsl-ohne-prosa'],
  },
  {
    id: 'Richtung b: Ausnahme (side: roles_yaml) ohne Bezug',
    md: d2Mini([D2_SET_PUNKT]),
    roles: d2MiniMitAusnahme('Bash(git add *)', 'roles_yaml', 'längst behobene Abweichung'),
    codes: ['ausnahme-ohne-bezug'],
  },
  // --- Richtung b, Gegenrichtung (schweigen)
  {
    id: 'Richtung b Gegenrichtung: conditional_tools brauchen keinen Beleg',
    md: d2Mini([D2_SET_PUNKT]),
    codes: [],
  },
  {
    id: 'Richtung b Gegenrichtung: Ausnahme (side: roles_yaml) greift',
    md: d2Mini(['Coder: `Read`, `Bash(git status *)`']),
    roles: d2MiniMitAusnahme('Bash(git add *)', 'roles_yaml', 'bewusst nicht in der Prosa'),
    codes: [],
  },
  {
    id: 'Richtung b Gegenrichtung: Nicht-Bash-Einträge brauchen keinen Beleg',
    md: d2Mini(['Coder: `Bash(git status *)`, `Bash(git add *)`']),
    codes: [],
  },
  // --- Struktur: d2_set, Set-Punkte, Quelle
  {
    id: 'Set-Punkt fehlt trotz d2_set',
    md: d2Mini(['Kein Set, nur Prosa mit `Bash(git status *)` und `Bash(git add *)`.']),
    codes: ['prosa-set-fehlt'],
  },
  {
    id: 'Set-Punkt trotz d2_set: false',
    md: d2Mini([D2_SET_PUNKT], 'Tester: `Read`'),
    roles: D2_MINI_MIT_TESTER,
    codes: ['prosa-set-ohne-d2-set'],
  },
  {
    id: 'zwei Set-Punkte für dieselbe Rolle',
    md: d2Mini([D2_SET_PUNKT], D2_SET_PUNKT.replace('Coder:', 'Coder (Fix-Run):')),
    codes: ['prosa-set-doppelt'],
  },
  {
    id: 'D2-Abschnitt fehlt',
    md: '- **D1 — Merge nur durch Martin**\n- **D3 — Kleine PRs:** Ein PR = ein Issue.',
    codes: ['d2-abschnitt-fehlt'],
  },
  {
    id: 'Ausnahme (side: agents_md) ohne Bezug',
    md: d2Mini([D2_SET_PUNKT]),
    roles: d2MiniMitAusnahme('Bash(gh pr view *)', 'agents_md', 'veraltete Ausnahme'),
    codes: ['ausnahme-ohne-bezug'],
  },
];

// Fälle für die Regel-Konsistenz (Ebene 2d) und die Pipeline-Konsistenz (Ebene 2e). Wie beim
// D2-Abgleich läuft der Selbsttest gegen Miniaturen, nicht gegen den echten Stand der Dateien
// — der ist der eigentliche Lauf. Verglichen wird die **vollständige** Befundliste, damit ein
// zusätzlicher Fehlalarm im selben Fall auffällt (M2 zu PR #48).
const klon = o => JSON.parse(JSON.stringify(o));

// Überschriftenerkennung (N3 zu PR #49): Nur eine Aufzählungszeile, die MIT der Fettung
// beginnt, ist ein Punkt-Titel. Inline-Betonungen im Fließtext, im Blockquote und mitten in
// einem Aufzählungspunkt sind keine — sonst löste ein Verweis auf `**offenen**` genauso auf
// wie einer auf einen echten Titel.
const UEBERSCHRIFT_QUELLE = [
  '- **D1 — Merge nur durch Martin** bei vollständig grünem CI.',
  '  - **Eskalation:** Bricht auch der Fix-Run ab → `needs-human`.',
  'Direkte Pushes auf `main` sind für Agenten **ausnahmslos** verboten.',
  '> **Querverweis-Konvention:** Ein Verweis nennt die Überschrift wörtlich.',
  '- Basis ist `origin/main` — außer das Issue baut auf einem **offenen** PR auf (D8).',
].join('\n');
const UEBERSCHRIFT_FAELLE = [
  { id: 'Überschriften: Punkt-Titel einer Aufzählungszeile', text: 'D1 — Merge nur durch Martin', ist: true },
  { id: 'Überschriften: Satzpunkt gehört nicht zur Überschrift', text: 'Eskalation', ist: true },
  { id: 'Überschriften Gegenrichtung: Inline-Fettung im Fließtext', text: 'ausnahmslos', ist: false },
  { id: 'Überschriften Gegenrichtung: Fettung im Blockquote', text: 'Querverweis-Konvention', ist: false },
  { id: 'Überschriften Gegenrichtung: Inline-Fettung mitten im Aufzählungspunkt', text: 'offenen', ist: false },
];

const MINI_UEBERSCHRIFTEN = new Set([
  'D1 — Merge nur durch Martin', 'D2 — Budget-Guards', 'D3 — Kleine PRs', 'D4 — Akzeptanzkriterien',
  'D5 — Doku bleibt im Repo', 'D6 — Keine eigene Infrastruktur', 'D7 — Abgebrochener Coder-Run',
  'D8 — Abhängige Issues',
]);
const MINI_UEBERSCHRIFT_LISTE = [...MINI_UEBERSCHRIFTEN];
// Eine Prosa-Konvention je Direktive — die Abdeckungsprüfung verlangt D1–D8 vollständig.
const miniKonvention = n => ({
  id: `D${n}_konvention`, directive: `D${n}`,
  convention: 'Prosa-Konvention', why_not_checkable: 'kein beobachtbares Artefakt',
  source: { agents_md: MINI_UEBERSCHRIFT_LISTE[n - 1] },
});
const MINI_REGELN = {
  version: 1, source: 'AGENTS.md — Direktiven',
  check_sources: [
    { id: 'gh_api', description: 'GitHub-API', infrastructure: 'github' },
    { id: 'ci_run', description: 'CI-Job', infrastructure: 'github' },
  ],
  triggers: [
    { id: 'workflow_change', description: 'PR ändert workflow/', observable_via: 'ci_run', pipeline: false },
    { id: 'pr_merged', description: 'PR gemergt', observable_via: 'gh_api', pipeline: true },
    { id: 'review_finding', description: 'Review-Befund am offenen PR', observable_via: 'gh_api', pipeline: true },
  ],
  facts: [
    { id: 'dsl_validation_exit_zero', description: 'CI-Job grün', check: 'ci_run', command: 'gh run view <id>' },
    { id: 'pr_merge_actor_role', description: 'Rolle des Merge-Actors', check: 'gh_api', command: 'gh pr view <n> --json mergedBy' },
  ],
  rules: [
    {
      id: 'DSL_self_validation', on: 'workflow_change',
      assert: { fact: 'dsl_validation_exit_zero', operator: 'is_true' },
      check: 'ci_run', remedy: 'Befunde beheben',
      source: { doc: 'docs/validate-setup.md — Einsatz in der Pipeline' },
    },
    {
      id: 'D1_merge_by_human', directive: 'D1', on: 'pr_merged',
      assert: { fact: 'pr_merge_actor_role', operator: 'equals', value: 'human' },
      check: 'gh_api', remedy: 'eskalieren',
      source: { agents_md: 'D1 — Merge nur durch Martin' },
    },
  ],
  documented_conventions: [2, 3, 4, 5, 6, 7, 8].map(miniKonvention),
};
// `review_finding` hängt in der Miniatur an der Pipeline-Schleife, `D1_merge_by_human` am
// Merge-Schritt — beides steht in pipeline.yaml, nicht in rules.yaml.
const MINI_REGEL_CTX = {
  fremdeFaktIds: new Set(['ci_green']),
  ueberschriften: MINI_UEBERSCHRIFTEN,
  dateiExistiert: d => d === 'docs/validate-setup.md',
  genutztAnderswo: { fakten: new Set(), trigger: new Set(['review_finding']), regeln: new Set(['D1_merge_by_human']) },
};
const regelnMit = fn => { const r = klon(MINI_REGELN); fn(r); return r; };

const REGEL_FAELLE = [
  { id: 'Regeln: Miniatur ohne Befund', dsl: MINI_REGELN, codes: [] },
  // --- Vokabular: Trigger, Check-Quelle, Fakt
  // Ein Vokabular-Fehler zieht die passende „ungenutzt"-Warnung nach sich: Wer `on` verbiegt,
  // lässt den bisherigen Trigger unbenutzt zurück. Die Warnung steht deshalb mit in der
  // Erwartung — der Fall prüft die vollständige Befundliste, nicht nur den Hauptbefund.
  { id: 'Regeln: unbekannter Trigger', dsl: regelnMit(r => { r.rules[1].on = 'nie_passiert'; }), codes: ['unbekannter-trigger', 'trigger-ungenutzt'] },
  { id: 'Regeln: check ohne Quelle im Vokabular', dsl: regelnMit(r => { r.rules[1].check = 'jira'; }), codes: ['unbekannte-check-quelle', 'fakt-quelle-abweichend', 'check-quelle-ungenutzt'] },
  { id: 'Regeln: Fakt verweist auf unbekannte Quelle', dsl: regelnMit(r => { r.facts[1].check = 'jira'; }), codes: ['unbekannte-check-quelle', 'fakt-quelle-abweichend'] },
  { id: 'Regeln: Trigger mit unbekanntem observable_via', dsl: regelnMit(r => { r.triggers[1].observable_via = 'jira'; }), codes: ['unbekannte-check-quelle'] },
  { id: 'Regeln: assert über erfundenen Fakt', dsl: regelnMit(r => { r.rules[1].assert.fact = 'erfunden'; }), codes: ['unbekannter-fakt', 'fakt-ungenutzt'] },
  { id: 'Regeln: Fakt aus anderer Quelle als die Regel', dsl: regelnMit(r => { r.rules[1].check = 'ci_run'; }), codes: ['fakt-quelle-abweichend', 'check-quelle-ungenutzt'] },
  { id: 'Regeln: Fakt-ID kollidiert mit states.yaml', dsl: regelnMit(r => { r.facts[1].id = 'ci_green'; r.rules[1].assert.fact = 'ci_green'; }), codes: ['fakt-id-kollision'] },
  // --- assert-Form und Operanden
  { id: 'Regeln: is_true mit Operand', dsl: regelnMit(r => { r.rules[0].assert.value = 'x'; }), codes: ['assert-operand'] },
  { id: 'Regeln: equals ohne Operand', dsl: regelnMit(r => { delete r.rules[1].assert.value; }), codes: ['assert-operand'] },
  { id: 'Regeln: unbekannter Operator', dsl: regelnMit(r => { r.rules[1].assert.operator = 'ist_vielleicht'; }), codes: ['unbekannter-operator'] },
  { id: 'Regeln: assert ohne fact und ohne Verknüpfung', dsl: regelnMit(r => { r.rules[1].assert = { operator: 'is_true' }; }), codes: ['assert-form', 'fakt-ungenutzt'] },
  { id: 'Regeln: all_of mit einem Zweig', dsl: regelnMit(r => { r.rules[1].assert = { all_of: [{ fact: 'pr_merge_actor_role', operator: 'is_true' }] }; }), codes: ['assert-form'] },
  { id: 'Regeln: all_of neben eigenem fact', dsl: regelnMit(r => { r.rules[1].assert = { fact: 'pr_merge_actor_role', operator: 'is_true', all_of: [{ fact: 'pr_merge_actor_role', operator: 'is_true' }, { fact: 'pr_merge_actor_role', operator: 'is_false' }] }; }), codes: ['assert-form', 'fakt-ungenutzt'] },
  { id: 'Regeln Gegenrichtung: all_of mit zwei Blättern', dsl: regelnMit(r => { r.rules[1].assert = { all_of: [{ fact: 'pr_merge_actor_role', operator: 'equals', value: 'human' }, { fact: 'pr_merge_actor_role', operator: 'is_true' }] }; }), codes: [] },
  { id: 'Regeln: all_of mit Blatt aus fremder Quelle', dsl: regelnMit(r => { r.rules[1].assert = { all_of: [{ fact: 'pr_merge_actor_role', operator: 'is_true' }, { fact: 'dsl_validation_exit_zero', operator: 'is_true' }] }; }), codes: ['fakt-quelle-abweichend'] },
  // --- Querverweis (source)
  { id: 'Regeln: source ohne Belegstelle', dsl: regelnMit(r => { r.rules[1].source = {}; }), codes: ['quelle-fehlt'] },
  { id: 'Regeln: source mit zwei Belegstellen', dsl: regelnMit(r => { r.rules[1].source = { agents_md: 'D1 — Merge nur durch Martin', doc: 'docs/validate-setup.md' }; }), codes: ['quelle-doppelt'] },
  { id: 'Regeln: Überschrift gibt es in AGENTS.md nicht', dsl: regelnMit(r => { r.rules[1].source = { agents_md: 'D9 — Gibt es nicht' }; }), codes: ['ueberschrift-fehlt'] },
  { id: 'Regeln: Überschrift mit Satzpunkt zitiert', dsl: regelnMit(r => { r.rules[1].source = { agents_md: 'D1 — Merge nur durch Martin:' }; }), codes: ['ueberschrift-satzpunkt'] },
  { id: 'Regeln: source.doc nennt fehlende Datei', dsl: regelnMit(r => { r.rules[0].source = { doc: 'docs/gibt-es-nicht.md — Stelle' }; }), codes: ['quelldatei-fehlt'] },
  { id: 'Regeln Gegenrichtung: Überschrift ohne Auflösung (ueberschriften = null)', dsl: regelnMit(r => { r.rules[1].source = { agents_md: 'D9 — Gibt es nicht' }; }), ctx: { ...MINI_REGEL_CTX, ueberschriften: null }, codes: [] },
  // --- Abdeckung D1–D8
  { id: 'Regeln: Direktive ohne Abdeckung', dsl: regelnMit(r => { r.documented_conventions = r.documented_conventions.filter(k => k.directive !== 'D5'); }), codes: ['direktive-ohne-abdeckung'] },
  // Eine Konvention ohne `directive` (Cleanup: Worktree-Konvention, nicht D1–D8) ist zulässig
  // und deckt nichts ab — sie darf weder melden noch eine fehlende Direktive verdecken.
  { id: 'Regeln Gegenrichtung: Konvention ohne Direktive', dsl: regelnMit(r => { r.documented_conventions.push({ id: 'cleanup_konvention', convention: 'Remote-Branch löscht der Merge', why_not_checkable: 'kein Tool-Set liest die Repo-Einstellung', source: { agents_md: 'D1 — Merge nur durch Martin' } }); }), codes: [] },
  { id: 'Regeln: Konvention ohne Direktive deckt keine Direktive ab', dsl: regelnMit(r => { r.documented_conventions = r.documented_conventions.filter(k => k.directive !== 'D5'); r.documented_conventions.push({ id: 'cleanup_konvention', convention: 'Remote-Branch löscht der Merge', why_not_checkable: 'kein Tool-Set liest die Repo-Einstellung', source: { agents_md: 'D1 — Merge nur durch Martin' } }); }), codes: ['direktive-ohne-abdeckung'] },
  {
    id: 'Regeln Gegenrichtung: Direktive als Regel statt als Konvention abgedeckt',
    dsl: regelnMit(r => {
      r.documented_conventions = r.documented_conventions.filter(k => k.directive !== 'D5');
      r.rules.push({ id: 'D5_x', directive: 'D5', on: 'workflow_change', assert: { fact: 'dsl_validation_exit_zero', operator: 'is_true' }, check: 'ci_run', remedy: 'committen', source: { agents_md: 'D5 — Doku bleibt im Repo' } });
    }),
    codes: [],
  },
  // --- DSL_self_validation
  { id: 'Regeln: DSL_self_validation nicht die erste Regel', dsl: regelnMit(r => { r.rules.reverse(); }), codes: ['selbstvalidierung-nicht-erste'] },
  { id: 'Regeln: DSL_self_validation an der falschen Quelle', dsl: regelnMit(r => { r.rules[0].check = 'gh_api'; }), codes: ['selbstvalidierung-form', 'fakt-quelle-abweichend', 'check-quelle-ungenutzt'] },
  // --- D8 vs. Review-Schleife
  {
    id: 'Regeln: D8-Regel am Trigger review_finding',
    dsl: regelnMit(r => { r.rules.push({ id: 'D8_falsch', directive: 'D8', on: 'review_finding', assert: { fact: 'pr_merge_actor_role', operator: 'is_true' }, check: 'gh_api', remedy: 'x', source: { agents_md: 'D8 — Abhängige Issues' } }); }),
    codes: ['d8-review-schleife', 'regel-ohne-pipeline-bezug'],
  },
  {
    id: 'Regeln Gegenrichtung: Nicht-D8-Regel am Trigger review_finding',
    dsl: regelnMit(r => { r.rules.push({ id: 'D4_ok', directive: 'D4', on: 'review_finding', assert: { fact: 'pr_merge_actor_role', operator: 'is_true' }, check: 'gh_api', remedy: 'x', source: { agents_md: 'D4 — Akzeptanzkriterien' } }); }),
    codes: ['regel-ohne-pipeline-bezug'],
  },
  // --- D6: Infrastruktur der Check-Quellen
  { id: 'Regeln: fremde Infrastruktur in check_sources', dsl: regelnMit(r => { r.check_sources[0].infrastructure = 'jira_cloud'; }), codes: ['fremde-infrastruktur'] },
  { id: 'Regeln Gegenrichtung: local ist erlaubt', dsl: regelnMit(r => { r.check_sources[0].infrastructure = 'local'; }), codes: [] },
  // --- IDs und ungenutzte Vokabeln (Warnungen)
  { id: 'Regeln: doppelte Regel-ID', dsl: regelnMit(r => { r.rules[1].id = 'DSL_self_validation'; }), codes: ['doppelte-id', 'regel-ohne-pipeline-bezug'] },
  { id: 'Regeln: ungenutzter Fakt', dsl: regelnMit(r => { r.facts.push({ id: 'nie_gefragt', description: 'x', check: 'gh_api', command: 'gh pr view <n>' }); }), codes: ['fakt-ungenutzt'] },
  { id: 'Regeln: ungenutzte Check-Quelle', dsl: regelnMit(r => { r.check_sources.push({ id: 'git_state', description: 'Repo-Zustand', infrastructure: 'local' }); }), codes: ['check-quelle-ungenutzt'] },
  { id: 'Regeln: Pipeline-Regel ohne Schritt-Bezug', dsl: MINI_REGELN, ctx: { ...MINI_REGEL_CTX, genutztAnderswo: { trigger: new Set(['review_finding']) } }, codes: ['regel-ohne-pipeline-bezug'] },
  { id: 'Regeln: ungenutzter Trigger', dsl: MINI_REGELN, ctx: { ...MINI_REGEL_CTX, genutztAnderswo: { regeln: new Set(['D1_merge_by_human']) } }, codes: ['trigger-ungenutzt'] },
];

const MINI_PIPELINE_CTX = {
  rollen: new Map([
    ['coder', { delegated: true, budget: { max_turns: 30 } }],
    ['reviewer', { delegated: true, budget: { max_turns: 15 } }],
    ['lead', { delegated: true, budget: { max_turns: 15 } }],
  ]),
  zustaende: new Map([
    ['in_progress', { label: 'agent:in-progress' }],
    ['review', { label: 'agent:review' }],
    ['done', {}],
  ]),
  faktIds: new Set(['draft_pr_open', 'merged']),
  regelIds: new Set(['D1_merge_by_human', 'D3_one_issue_per_pr']),
  uebergaenge: [
    { id: 'hand_to_review', from: 'in_progress', to: 'review', owner: 'coder', owner_fallback: 'lead' },
    { id: 'review_finding_fix', from: 'review', to: 'in_progress', owner: 'lead', loop: true },
    { id: 'merge', from: 'review', to: 'done', owner: 'human' },
  ],
  doneState: 'done',
  maxReviewLoops: 2,
};
const MINI_PIPELINE = {
  version: 1, source: 'AGENTS.md — Pipeline', first: 'coder_run',
  steps: [
    {
      id: 'coder_run', name: 'Coder-Run', actor: 'coder', workdir: 'worktree', delegated: true,
      description: 'Implementierung, Draft-PR', state_before: 'in_progress', state_after: 'review',
      preconditions: [{ label_check: { state: 'in_progress', present: true } }, { actor_check: { role: 'coder' } }],
      postconditions: [{ fact_check: { fact: 'draft_pr_open', expected: true } }, { ci_check: { conclusion: 'success' } }],
      rules: ['D3_one_issue_per_pr'], next: ['merge'],
    },
    {
      id: 'merge', name: 'Merge', actor: 'human', workdir: 'n/a', delegated: false,
      description: 'Martin merged', state_before: 'review', state_after: 'done',
      preconditions: [{ actor_check: { role: 'human' } }],
      postconditions: [{ fact_check: { fact: 'merged', expected: true } }],
      rules: ['D1_merge_by_human'], next: [],
    },
  ],
};
const pipelineMit = fn => { const p = klon(MINI_PIPELINE); fn(p); return p; };
const MINI_SCHLEIFE = { to: 'coder_run', transition: 'review_finding_fix', trigger: 'review_finding', max: 2 };

const PIPELINE_FAELLE = [
  { id: 'Pipeline: Miniatur ohne Befund', dsl: MINI_PIPELINE, codes: [] },
  // --- Schritt-Referenzen und Erreichbarkeit
  { id: 'Pipeline: first ist kein Schritt', dsl: pipelineMit(p => { p.first = 'gibt_es_nicht'; }), codes: ['unbekannter-schritt', 'schritt-unerreichbar', 'schritt-unerreichbar'] },
  { id: 'Pipeline: next ist kein Schritt', dsl: pipelineMit(p => { p.steps[0].next = ['gibt_es_nicht']; }), codes: ['unbekannter-schritt', 'schritt-unerreichbar'] },
  {
    id: 'Pipeline: unerreichbarer Schritt',
    dsl: pipelineMit(p => { p.steps.push({ id: 'waise', name: 'Waise', actor: 'lead', workdir: 'worktree', delegated: false, description: 'x', state_before: 'review', state_after: 'review', preconditions: [], postconditions: [], next: [] }); }),
    codes: ['schritt-unerreichbar'],
  },
  { id: 'Pipeline: doppelte Schritt-ID', dsl: pipelineMit(p => { p.steps.push(klon(p.steps[1])); }), codes: ['doppelte-id'] },
  { id: 'Pipeline: Zustandsbruch zwischen zwei Schritten', dsl: pipelineMit(p => { p.steps[1].state_before = 'in_progress'; }), codes: ['schritt-zustandsbruch', 'uebergang-fehlt'] },
  // --- Bindung an die Zustandsmaschine
  { id: 'Pipeline: Zustandswechsel ohne Übergang', dsl: MINI_PIPELINE, ctx: { ...MINI_PIPELINE_CTX, uebergaenge: MINI_PIPELINE_CTX.uebergaenge.filter(t => t.id !== 'hand_to_review') }, codes: ['uebergang-fehlt'] },
  { id: 'Pipeline: Übergang gehört einer anderen Rolle', dsl: pipelineMit(p => { p.steps[0].actor = 'reviewer'; }), codes: ['uebergang-owner'] },
  { id: 'Pipeline Gegenrichtung: owner_fallback zählt als Owner', dsl: pipelineMit(p => { p.steps[0].actor = 'lead'; p.steps[0].preconditions[1].actor_check.role = 'lead'; }), codes: [] },
  { id: 'Pipeline: Agent führt in den Endzustand (D1)', dsl: pipelineMit(p => { p.steps[1].actor = 'lead'; p.steps[1].preconditions[0].actor_check.role = 'lead'; }), codes: ['d1-merge-schritt', 'uebergang-owner'] },
  // Gegenrichtung zum Wächter darüber: Der Cleanup-Schritt hinter dem Merge gehört dem Lead
  // und *bleibt* in `done`, statt dorthin zu führen — kein Zustandswechsel, kein Übergang,
  // kein D1-Fall. Ohne diesen Fall fiele eine Rückkehr zur alten, zustandsblinden Prüfung
  // erst im echten Lauf auf.
  {
    id: 'Pipeline Gegenrichtung: Cleanup-Schritt bleibt im Endzustand',
    dsl: pipelineMit(p => {
      p.steps[1].next = ['cleanup'];
      p.steps.push({
        id: 'cleanup', name: 'Cleanup nach dem Merge', actor: 'lead', workdir: 'repo-root', delegated: false,
        description: 'Worktree entfernen, lokalen Branch löschen', state_before: 'done', state_after: 'done',
        preconditions: [{ actor_check: { role: 'lead' } }],
        postconditions: [{ fact_check: { fact: 'merged', expected: true } }],
        next: [],
      });
    }),
    codes: [],
  },
  { id: 'Pipeline: unbekannter Zustand am Schritt', dsl: pipelineMit(p => { p.steps[0].state_before = 'nirgendwo'; }), codes: ['unbekannter-zustand'] },
  // --- strukturierte Bedingungen
  { id: 'Pipeline: label_check auf unbekannten Zustand', dsl: pipelineMit(p => { p.steps[0].preconditions[0].label_check.state = 'nirgendwo'; }), codes: ['unbekannter-zustand'] },
  { id: 'Pipeline: label_check auf Zustand ohne Label', dsl: pipelineMit(p => { p.steps[0].preconditions[0].label_check.state = 'done'; }), codes: ['label-check-ohne-label'] },
  { id: 'Pipeline: actor_check auf unbekannte Rolle', dsl: pipelineMit(p => { p.steps[0].preconditions[1].actor_check.role = 'hacker'; }), codes: ['unbekannte-rolle'] },
  { id: 'Pipeline: fact_check auf erfundenen Fakt', dsl: pipelineMit(p => { p.steps[0].postconditions[0].fact_check.fact = 'erfunden'; }), codes: ['unbekannter-fakt'] },
  { id: 'Pipeline: fact_check ohne booleschen Erwartungswert', dsl: pipelineMit(p => { p.steps[0].postconditions[0].fact_check.expected = 'ja'; }), codes: ['fact-check-erwartung'] },
  { id: 'Pipeline: ci_check mit unbekannter Konklusion', dsl: pipelineMit(p => { p.steps[0].postconditions[1].ci_check.conclusion = 'grün'; }), codes: ['unbekannte-ci-konklusion'] },
  { id: 'Pipeline: freier Schlüssel statt Bedingungsform', dsl: pipelineMit(p => { p.steps[0].preconditions.push({ stimmung: 'gut' }); }), codes: ['unbekannte-bedingung', 'unbekannte-bedingung'] },
  { id: 'Pipeline: zwei Bedingungsformen in einem Eintrag', dsl: pipelineMit(p => { p.steps[0].preconditions[0].actor_check = { role: 'coder' }; }), codes: ['unbekannte-bedingung'] },
  // --- Rollen, Budget, Regel-Referenzen
  { id: 'Pipeline: actor ist keine Rolle', dsl: pipelineMit(p => { p.steps[0].actor = 'hacker'; }), codes: ['unbekannte-rolle', 'uebergang-owner'] },
  { id: 'Pipeline: delegierter Schritt ohne Budget der Rolle', dsl: MINI_PIPELINE, ctx: { ...MINI_PIPELINE_CTX, rollen: new Map([...MINI_PIPELINE_CTX.rollen, ['coder', { delegated: true }]]) }, codes: ['schritt-ohne-budget'] },
  { id: 'Pipeline: Delegation an einen Menschen', dsl: pipelineMit(p => { p.steps[1].delegated = true; }), codes: ['delegation-an-mensch'] },
  { id: 'Pipeline: rules nennt eine unbekannte Regel', dsl: pipelineMit(p => { p.steps[0].rules = ['D9_gibt_es_nicht']; }), codes: ['unbekannte-regel'] },
  // --- Review-Schleife
  { id: 'Pipeline Gegenrichtung: Schleife passt zu states.yaml', dsl: pipelineMit(p => { p.steps[0].loop = klon(MINI_SCHLEIFE); }), codes: [] },
  { id: 'Pipeline: Schleifenlimit weicht von max_review_loops ab', dsl: pipelineMit(p => { p.steps[0].loop = { ...klon(MINI_SCHLEIFE), max: 3 }; }), codes: ['schleifen-limit'] },
  { id: 'Pipeline: Schleife nennt unbekannten Übergang', dsl: pipelineMit(p => { p.steps[0].loop = { ...klon(MINI_SCHLEIFE), transition: 'gibt_es_nicht' }; }), codes: ['unbekannter-uebergang'] },
  { id: 'Pipeline: Schleifenübergang nicht als loop markiert', dsl: pipelineMit(p => { p.steps[0].loop = { ...klon(MINI_SCHLEIFE), transition: 'merge' }; }), codes: ['schleife-nicht-markiert'] },
];

// `verbotsformen` kommt aus roles.yaml (R2). Ohne die Datei — `--selftest` ohne Setup — laufen
// die übrigen Fälle weiter und die Subsumptionsfälle werden als übersprungen ausgewiesen.
function runSelftest(verbotsformen) {
  const ergebnis = [];
  const fall = (name, entry, erwartet, gefunden, ok, code) => {
    ergebnis.push({ fall: name, entry, erwartet, gefunden, ok });
    if (!ok) err('selftest', code, `${name}: \`${entry}\` — erwartet ${erwartet}, gefunden: ${gefunden.join(', ') || 'nichts'}`);
  };
  const uebersprungen = (name, entry, erwartet) => ergebnis.push({ fall: name, entry, erwartet, gefunden: [], ok: true, uebersprungen: true });
  for (const f of HISTORISCHE_VERSTOESSE) {
    const hart = classifyToolPattern(f.entry).filter(b => b.level === 'error').map(b => b.code);
    fall(f.id, f.entry, f.code, hart, hart.includes(f.code), 'historischer-fall-nicht-gefangen');
  }
  for (const entry of ERLAUBTE_FORMEN) {
    const hart = classifyToolPattern(entry).filter(b => b.level === 'error').map(b => b.code);
    fall('erlaubte Form', entry, 'kein Fehler', hart, hart.length === 0, 'fehlalarm');
  }
  for (const f of VERBOTS_VERSTOESSE) {
    if (!verbotsformen) { uebersprungen(f.id, f.entry, f.code); continue; }
    const codes = verbotsbefunde(f.entry, verbotsformen).map(b => b.code);
    fall(f.id, f.entry, f.code, codes, codes.includes(f.code), 'verbotsbezug-nicht-gefangen');
  }
  for (const entry of VERBOTS_ERLAUBT) {
    if (!verbotsformen) { uebersprungen('erlaubt trotz Verbotsliste', entry, 'kein Befund'); continue; }
    const codes = verbotsbefunde(entry, verbotsformen).map(b => b.code);
    fall('erlaubt trotz Verbotsliste', entry, 'kein Befund', codes, codes.length === 0, 'fehlalarm');
  }
  // Verglichen wird die vollständige Befundliste, nicht nur „enthält den erwarteten Code": Ein
  // zusätzlicher Fehlalarm im selben Fall bliebe sonst unsichtbar (M2 zu PR #48).
  for (const f of D2_FAELLE) {
    const erwartet = [...f.codes].sort();
    const codes = d2Abgleich(f.md, f.roles ?? D2_MINI_ROLLEN).befunde.map(b => b.code).sort();
    const ok = codes.length === erwartet.length && erwartet.every((c, i) => c === codes[i]);
    fall(f.id, f.md, erwartet.join(', ') || 'kein Befund', codes, ok, 'd2-abgleich-fall-nicht-gefangen');
  }
  // Ebene 2d/2e gegen die Miniaturen. `entry` ist hier der Fallname statt einer Freigabeform —
  // die geprüfte Eingabe ist ein ganzes DSL-Dokument und gehört nicht in eine Zeile Ausgabe.
  for (const [faelle, fn, ctx, code] of [
    [REGEL_FAELLE, regelKonsistenz, MINI_REGEL_CTX, 'regel-konsistenz-fall-nicht-gefangen'],
    [PIPELINE_FAELLE, pipelineKonsistenz, MINI_PIPELINE_CTX, 'pipeline-konsistenz-fall-nicht-gefangen'],
  ]) {
    for (const f of faelle) {
      const erwartet = [...f.codes].sort();
      const codes = fn(f.dsl, f.ctx ?? ctx).befunde.map(b => b.code).sort();
      const ok = codes.length === erwartet.length && erwartet.every((c, i) => c === codes[i]);
      fall(f.id, f.id, erwartet.join(', ') || 'kein Befund', codes, ok, code);
    }
  }
  return ergebnis;
}

// ------------------------------------------------------------------------ Ebene 1: Schemata

const toolEntry = { type: 'string', minLength: 1 };
const forbiddenList = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['pattern', 'directive', 'reason'],
    properties: {
      pattern: toolEntry,
      directive: { type: 'string', pattern: '^D[1-8]$' },
      reason: { type: 'string', minLength: 1 },
      match: { enum: ['subsumption', 'blanket', 'konvention'] },
      except: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
    },
  },
};

// Ausnahmen des D2-Prosa-Abgleichs: strukturiert, mit Seite, Direktive und Begründung. `side`
// sagt, wo der Eintrag steht und deshalb auf der anderen Seite fehlen darf — `agents_md`: in der
// D2-Prosa genannt, bewusst ohne DSL-Eintrag; `roles_yaml`: Allowlist-Eintrag ohne Prosa-Beleg.
const d2ProseCheckSchema = {
  type: 'object', additionalProperties: false,
  required: ['file', 'excluded_entries'],
  properties: {
    file: { type: 'string', minLength: 1 },
    excluded_entries: {
      type: 'array', uniqueItems: true,
      items: {
        type: 'object', additionalProperties: false,
        required: ['entry', 'side', 'directive', 'reason'],
        properties: {
          entry: toolEntry,
          side: { enum: ['agents_md', 'roles_yaml'] },
          directive: { type: 'string', pattern: '^D[1-8]$' },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const rolesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'forbidden_tools', 'd2_prose_check', 'roles'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    forbidden_tools: forbiddenList,
    d2_prose_check: d2ProseCheckSchema,
    roles: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'realization', 'scope', 'd2_set', 'merge_allowed'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          name: { type: 'string', minLength: 1 },
          realization: { type: 'string', minLength: 1 },
          scope: { type: 'string', minLength: 1 },
          d2_set: { type: 'boolean' },
          merge_allowed: { type: 'boolean' },
          delegated: { type: 'boolean' },
          workdir: { enum: ['repo-root', 'worktree', 'n/a'] },
          budget: {
            type: 'object', additionalProperties: false,
            required: ['max_turns', 'source'],
            properties: { max_turns: { type: 'integer', minimum: 1 }, source: { type: 'string', minLength: 1 } },
          },
          allowed_tools: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
          must_not_include: { type: 'array', uniqueItems: true, items: toolEntry },
          forbidden_tools: forbiddenList,
          conditional_tools: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['id', 'directive', 'reason'],
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
                directive: { type: 'string', pattern: '^D[1-8]$' },
                reason: { type: 'string', minLength: 1 },
                grants: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
                denies: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
                restrict_git_tools_to: { type: 'array', minItems: 1, uniqueItems: true, items: toolEntry },
              },
            },
          },
        },
      },
    },
  },
};

const statesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'initial', 'facts', 'states', 'label_table', 'transitions', 'invariants'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    initial: { type: 'string', minLength: 1 },
    facts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'check'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          description: { type: 'string', minLength: 1 },
          check: { type: 'string', minLength: 1 },
        },
      },
    },
    states: {
      type: 'array', minItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'terminal'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          label: { type: 'string', minLength: 1 },
          set_by: { type: 'string', minLength: 1 },
          set_by_role: { type: 'string', minLength: 1 },
          set_by_role_fallback: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          terminal: { type: 'boolean' },
        },
      },
    },
    label_table: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['states'],
        properties: {
          states: { type: 'array', minItems: 1, items: { type: 'string' } },
          label: { type: 'string', minLength: 1 },
          set_by: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
        },
      },
    },
    transitions: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'from', 'to', 'owner', 'trigger'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          from: { type: 'string' },
          to: { type: 'string' },
          owner: { type: 'string', minLength: 1 },
          owner_fallback: { type: 'string', minLength: 1 },
          trigger: { type: 'string', minLength: 1 },
          requires: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
          loop: { type: 'boolean' },
          // Herkunft der Regel: eine Direktive aus AGENTS.md ODER eine andere Quelle
          // (`source`). Mindestens eines von beiden muss stehen — geprüft in Ebene 2.
          directive: { type: 'string', pattern: '^D[1-8]$' },
          source: { type: 'string', minLength: 1 },
        },
      },
    },
    invariants: {
      type: 'object', additionalProperties: false,
      required: ['max_review_loops', 'loop_transition', 'loop_escape', 'done_state', 'done_by', 'done_requires'],
      properties: {
        max_review_loops: { type: 'integer', minimum: 1 },
        loop_transition: { type: 'string' },
        loop_escape: { type: 'string' },
        done_state: { type: 'string' },
        done_by: { type: 'string' },
        done_requires: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
      },
    },
  },
};

// Schemata für rules.yaml und pipeline.yaml. Bewusst locker, wo Ebene 2d/2e semantisch prüft:
// `infrastructure`, `check`, `on`, `operator` und `conclusion` stehen hier als freie Strings,
// damit der Befund aus der Konsistenzprüfung kommt (mit Begründung und Selbsttest-Fall) und
// nicht als nackter Enum-Fehler aus ajv.
const nichtLeer = { type: 'string', minLength: 1 };
const dslId = { type: 'string', pattern: '^[a-z][a-z0-9_]*$' };
const regelId = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' };
const direktive = { type: 'string', pattern: '^D[1-8]$' };
const quelleSchema = {
  type: 'object', additionalProperties: false,
  properties: { agents_md: nichtLeer, doc: nichtLeer },
};
const assertBlatt = {
  type: 'object', additionalProperties: false,
  properties: { fact: nichtLeer, operator: nichtLeer, value: {}, values: { type: 'array', minItems: 1 } },
};
const assertSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    fact: nichtLeer, operator: nichtLeer, value: {}, values: { type: 'array', minItems: 1 },
    all_of: { type: 'array', minItems: 1, items: assertBlatt },
    any_of: { type: 'array', minItems: 1, items: assertBlatt },
  },
};

const rulesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'check_sources', 'triggers', 'facts', 'rules', 'documented_conventions'],
  properties: {
    version: { const: 1 },
    source: nichtLeer,
    check_sources: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'infrastructure'],
        properties: { id: dslId, description: nichtLeer, infrastructure: nichtLeer },
      },
    },
    triggers: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'observable_via', 'pipeline'],
        properties: { id: dslId, description: nichtLeer, observable_via: nichtLeer, pipeline: { type: 'boolean' } },
      },
    },
    facts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'check', 'command'],
        // `command` ist Pflicht: Ohne den Befehl, mit dem sich der Fakt ablesen lässt, wäre
        // „beobachtbar" eine Behauptung (Spec § 2, keine Selbstauskunft).
        properties: { id: dslId, description: nichtLeer, check: nichtLeer, command: nichtLeer },
      },
    },
    rules: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'on', 'assert', 'check', 'remedy', 'source'],
        properties: {
          id: regelId, directive: direktive, on: nichtLeer, assert: assertSchema,
          check: nichtLeer, remedy: nichtLeer, source: quelleSchema,
        },
      },
    },
    // `directive` ist optional — wie bei `rules`: Nicht jede Konvention hängt an einer
    // Direktive (der Cleanup steht in der Worktree-Konvention von AGENTS.md). Eine Direktive
    // zu erfinden, nur damit das Pflichtfeld gefüllt ist, wäre der falsche Verweis an
    // normativer Stelle; die Abdeckungsprüfung D1–D8 zählt ohnehin nur Einträge mit Feld.
    documented_conventions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'convention', 'why_not_checkable', 'source'],
        properties: {
          id: regelId, directive: direktive, convention: nichtLeer,
          why_not_checkable: nichtLeer, source: quelleSchema,
        },
      },
    },
  },
};

// Bedingungen: die vier Formen streng typisiert, unbekannte Schlüssel absichtlich erlaubt —
// sie meldet Ebene 2e als `unbekannte-bedingung` samt Aufzählung der zulässigen Formen.
const bedingungSchema = {
  type: 'object', minProperties: 1, additionalProperties: true,
  properties: {
    label_check: { type: 'object', additionalProperties: false, required: ['state', 'present'], properties: { state: nichtLeer, present: { type: 'boolean' } } },
    actor_check: { type: 'object', additionalProperties: false, required: ['role'], properties: { role: nichtLeer } },
    ci_check: { type: 'object', additionalProperties: false, required: ['conclusion'], properties: { conclusion: nichtLeer } },
    fact_check: { type: 'object', additionalProperties: false, required: ['fact', 'expected'], properties: { fact: nichtLeer, expected: {} } },
  },
};

const pipelineSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'first', 'steps'],
  properties: {
    version: { const: 1 },
    source: nichtLeer,
    first: nichtLeer,
    steps: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'actor', 'workdir', 'delegated', 'description', 'state_before', 'state_after', 'preconditions', 'postconditions', 'next'],
        properties: {
          id: dslId, name: nichtLeer, actor: nichtLeer,
          workdir: { enum: ['repo-root', 'worktree', 'n/a'] },
          delegated: { type: 'boolean' },
          description: nichtLeer,
          state_before: nichtLeer, state_after: nichtLeer,
          preconditions: { type: 'array', items: bedingungSchema },
          postconditions: { type: 'array', items: bedingungSchema },
          rules: { type: 'array', uniqueItems: true, items: nichtLeer },
          next: { type: 'array', uniqueItems: true, items: nichtLeer },
          loop: {
            type: 'object', additionalProperties: false,
            required: ['to', 'transition', 'max'],
            properties: { to: nichtLeer, transition: nichtLeer, trigger: nichtLeer, max: { type: 'integer', minimum: 1 } },
          },
        },
      },
    },
  },
};

// --------------------------------------------------------------------------------- Ablauf

function ladeYaml(datei) {
  const p = path.join(root, datei);
  if (!fs.existsSync(p)) { console.error(`Datei nicht gefunden: ${p}`); process.exit(2); }
  try {
    return YAML.load(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`YAML nicht lesbar (${datei}): ${e.message}`);
    process.exit(2);
  }
}

function pruefeSchema(ajv, schema, daten, datei) {
  const validate = ajv.compile(schema);
  if (validate(daten)) return true;
  for (const e of validate.errors) {
    err(datei, 'schema', `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (\`${e.params.additionalProperty}\`)` : ''}`);
  }
  return false;
}

// `--selftest` ohne Setup: Die Verbotsformen stehen in roles.yaml (R2), gelesen werden sie hier
// mit js-yaml allein — ajv braucht nur die Schemaprüfung. Fehlt das Modul oder die Datei, läuft
// der Selbsttest ohne den Subsumptionsteil und weist die Fälle als übersprungen aus.
function verbotsformenFuerSelbsttest() {
  const yamlMod = resolveModule('js-yaml');
  const p = path.join(root, 'workflow/roles.yaml');
  if (!yamlMod || !fs.existsSync(p)) return null;
  try {
    return ((yamlMod.default ?? yamlMod).load(fs.readFileSync(p, 'utf8')) ?? {}).forbidden_tools ?? null;
  } catch {
    return null;
  }
}

if (selftestOnly) {
  const verbotsformen = verbotsformenFuerSelbsttest();
  if (!verbotsformen) {
    warn('selftest', 'verbotsliste-nicht-geladen', 'workflow/roles.yaml nicht lesbar (js-yaml nicht auflösbar, Datei fehlt oder kaputt) — die Subsumptionsfälle wurden übersprungen; Setup siehe docs/validate-setup.md');
  }
  const selftest = runSelftest(verbotsformen);
  const ok = errors.length === 0;
  if (jsonOut) console.log(JSON.stringify({ ok, selftest, errors, warnings }, null, 2));
  else {
    console.log('Selbsttest: Sicherheitsanalyse, Subsumption, D2-Prosa-Abgleich, Regel- und Pipeline-Konsistenz');
    for (const s of selftest) console.log(`  ${s.uebersprungen ? 'übsp' : s.ok ? 'ok  ' : 'FEHL'} ${s.entry.replace(/\n/g, '\\n')} → erwartet: ${s.erwartet}, gefunden: ${s.gefunden.join(', ') || '—'}`);
    for (const w of warnings) console.log(`  Warnung: ${w.message}`);
    if (!ok) for (const e of errors) console.log(`  Fehler: ${e.message}`);
  }
  process.exit(ok ? 0 : 1);
}

const { YAML, Ajv } = ladeModule();
const ajv = new Ajv({ allErrors: true, strict: false });
const roles = ladeYaml('workflow/roles.yaml');
const states = ladeYaml('workflow/states.yaml');
const rules = ladeYaml('workflow/rules.yaml');
const pipeline = ladeYaml('workflow/pipeline.yaml');
const rolesOk = pruefeSchema(ajv, rolesSchema, roles, 'workflow/roles.yaml');
const statesOk = pruefeSchema(ajv, statesSchema, states, 'workflow/states.yaml');
const regelnOk = pruefeSchema(ajv, rulesSchema, rules, 'workflow/rules.yaml');
const pipelineOk = pruefeSchema(ajv, pipelineSchema, pipeline, 'workflow/pipeline.yaml');
// Erst nach der Schemaprüfung: Eine kaputte `forbidden_tools`-Liste würde im Selbsttest
// Folgefehler erzeugen, die vom eigentlichen Schema-Befund ablenken.
if (!rolesOk) warn('selftest', 'verbotsliste-nicht-geladen', 'workflow/roles.yaml erfüllt das Schema nicht — die Subsumptionsfälle des Selbsttests wurden übersprungen');
const selftest = runSelftest(rolesOk ? roles.forbidden_tools : null);

let toolEintraege = 0;
let prosaFormen = 0;
if (rolesOk) {
  const R = 'workflow/roles.yaml';
  const ids = new Set();

  // Die Verbotsliste selbst: keine Dubletten, und jede `except`-Form muss wirklich unter ihr
  // Verbot fallen — sonst steht dort eine Ausnahme, die nichts ausnimmt.
  const verbotene = roles.forbidden_tools.map(f => f.pattern);
  if (new Set(verbotene).size !== verbotene.length) err(R, 'doppelte-verbotsform', 'forbidden_tools nennt eine Form mehrfach');
  for (const f of roles.forbidden_tools) {
    const fp = patternPraefix(f.pattern);
    for (const e of f.except ?? []) {
      if (!deckt(fp, patternPraefix(e))) err(R, 'except-ohne-bezug', `forbidden_tools/\`${f.pattern}\`: \`${e}\` fällt gar nicht unter das Verbot — die Ausnahme nimmt nichts aus`);
    }
    if ((f.match ?? 'subsumption') === 'blanket' && (f.except ?? []).length) {
      err(R, 'except-ohne-wirkung', `forbidden_tools/\`${f.pattern}\`: \`match: blanket\` prüft keine Formen unterhalb des Verbots — \`except\` bleibt wirkungslos`);
    }
  }

  for (const rolle of roles.roles) {
    if (ids.has(rolle.id)) err(R, 'doppelte-id', `Rollen-ID \`${rolle.id}\` doppelt vergeben`);
    ids.add(rolle.id);

    // Referenzauflösung: Rollen mit D2-Set brauchen eine Allowlist, delegierte Rollen ein Budget.
    if (rolle.d2_set) {
      if (!rolle.allowed_tools) err(R, 'fehlende-allowlist', `\`${rolle.id}\`: d2_set ist true, aber allowed_tools fehlt`);
    } else if (rolle.allowed_tools) {
      err(R, 'allowlist-ohne-d2-set', `\`${rolle.id}\`: allowed_tools ohne d2_set`);
    }
    // D2 — Delegationen immer mit `--max-turns`: jede delegierte Rolle braucht ein Budget,
    // und dessen `source` muss auf eine Datei zeigen, die es im Repo gibt.
    if (rolle.delegated) {
      if (!rolle.budget) err(R, 'fehlendes-budget', `\`${rolle.id}\`: delegated ist true, aber budget fehlt (D2 — Delegationen immer mit \`--max-turns\`)`);
    } else if (rolle.budget) {
      err(R, 'budget-ohne-delegation', `\`${rolle.id}\`: budget ohne \`delegated: true\` — ein \`--max-turns\` ohne delegierten Run`);
    }
    for (const datei of (rolle.budget?.source ?? '').match(/\b(?:[\w.-]+\/)*[\w.-]+\.(?:md|ya?ml)\b/g) ?? []) {
      if (!fs.existsSync(path.join(root, datei))) err(R, 'budget-quelle-fehlt', `\`${rolle.id}\`: budget.source nennt \`${datei}\` — die Datei gibt es im Repo nicht`);
    }

    // D1 als Feld: keine Rolle darf mergen.
    if (rolle.merge_allowed !== false) err(R, 'd1-merge', `\`${rolle.id}\`: merge_allowed muss false sein (D1 — Merge nur durch Martin)`);

    const allowed = rolle.allowed_tools ?? [];
    const alleEintraege = [
      ...allowed.map(e => ({ e, quelle: 'allowed_tools' })),
      ...(rolle.conditional_tools ?? []).flatMap(c => (c.grants ?? []).map(e => ({ e, quelle: `conditional_tools/${c.id}` }))),
    ];
    for (const { e, quelle } of alleEintraege) {
      toolEintraege++;
      const wo = `${R} → ${rolle.id}/${quelle}`;
      for (const b of classifyToolPattern(e)) {
        if (b.level === 'error') err(wo, b.code, `\`${e}\`: ${b.message}`);
        else warn(wo, b.code, `\`${e}\`: ${b.message}`);
      }
      // Verbotsformen: global für jeden Eintrag, auch für Zusatzfreigaben — die dokumentierten
      // Ausnahmen (Push-Guard, Label-Formen, D8-`--body`) stehen als `except` am Verbot.
      for (const b of verbotsbefunde(e, roles.forbidden_tools)) err(wo, b.code, b.message);
      if (/^Bash\(\s*gh\s+pr\s+merge\b/.test(e)) err(R, 'd1-merge-tool', `\`${rolle.id}\`: \`${e}\` steht in keinem Set (D1)`);
    }

    // Rollenspezifische Verbote meinen das Standard-Set — eine Zusatzfreigabe für genau einen
    // Run ist ja gerade die dokumentierte Ausnahme (Lead, D8-Basiswechsel).
    for (const b of allowed.flatMap(e => verbotsbefunde(e, rolle.forbidden_tools ?? []).map(x => ({ e, ...x })))) {
      err(R, b.code, `\`${rolle.id}\`/allowed_tools: ${b.message}`);
    }
    // `must_not_include` gilt für das Standard-Set UND für die Zusatzfreigaben: Was eine Rolle
    // nie bekommen darf, darf auch kein bedingter Run ihr geben.
    const ausschluss = (rolle.must_not_include ?? []).map(pattern => ({ pattern, directive: 'D2', reason: 'must_not_include' }));
    for (const { e, quelle } of alleEintraege) {
      for (const b of verbotsbefunde(e, ausschluss)) {
        err(R, 'must-not-include', `\`${rolle.id}\`/${quelle}: \`${e}\` ist durch must_not_include \`${b.f.pattern}\` ausgeschlossen (${b.code})`);
      }
    }

    for (const c of rolle.conditional_tools ?? []) {
      for (const g of c.grants ?? []) {
        if (allowed.includes(g)) err(R, 'redundante-zusatzfreigabe', `\`${rolle.id}\`/${c.id}: \`${g}\` ist bereits im Standard-Set — eine Zusatzfreigabe wäre wirkungslos`);
      }
      for (const d of c.denies ?? []) {
        if (allowed.includes(d)) err(R, 'widerspruechliche-denies', `\`${rolle.id}\`/${c.id}: \`${d}\` ist zugleich im Standard-Set und in denies`);
      }
      if (c.restrict_git_tools_to) {
        const istGit = e => patternPraefix(e)?.fest[0] === 'git';
        for (const t of c.restrict_git_tools_to) {
          if (!allowed.includes(t)) err(R, 'restrict-nicht-im-set', `\`${rolle.id}\`/${c.id}: \`${t}\` ist eine Einschränkung auf einen Eintrag, der nicht im Standard-Set steht`);
          if (!istGit(t)) { err(R, 'restrict-nicht-git', `\`${rolle.id}\`/${c.id}: \`${t}\` ist kein \`git\`-Eintrag — \`restrict_git_tools_to\` engt nur den git-Teil ein`); continue; }
          // Die Einschränkung darf nur lesende Einträge übriglassen: Am Worktree liest der
          // Prüf-Run ausschließlich (AGENTS.md D2, „Allowlist des Prüf-Runs").
          const sub = patternPraefix(t).fest[1];
          if (GIT_SCHREIBEND.includes(sub)) {
            err(R, 'restrict-schreibender-eintrag', `\`${rolle.id}\`/${c.id}: \`${t}\` bleibt erlaubt, schreibt aber am Worktree (\`git ${sub}\`) — die Einschränkung darf nur lesende Einträge übriglassen`);
          }
        }
        const ausgeschlossen = allowed.filter(e => istGit(e) && !c.restrict_git_tools_to.includes(e));
        if (ausgeschlossen.length === 0) {
          warn(R, 'restrict-ohne-wirkung', `\`${rolle.id}\`/${c.id}: \`restrict_git_tools_to\` schließt keinen \`git\`-Eintrag des Standard-Sets aus — die Einengung hat keine Wirkung`);
        }
      }
    }
  }

  // Ebene 2c: die D2-Prosa von AGENTS.md gegen die Tool-Sets, in beide Richtungen.
  const prosaDatei = roles.d2_prose_check.file;
  const prosaPfad = path.join(root, prosaDatei);
  if (!fs.existsSync(prosaPfad)) {
    err(R, 'prosa-datei-fehlt', `d2_prose_check.file nennt \`${prosaDatei}\` — die Datei gibt es im Repo nicht`);
  } else {
    const abgleich = d2Abgleich(fs.readFileSync(prosaPfad, 'utf8'), roles);
    prosaFormen = abgleich.geprueft;
    for (const b of abgleich.befunde) err(`${prosaDatei} ↔ ${R}`, b.code, b.message);
  }
}

if (statesOk) {
  const S = 'workflow/states.yaml';
  const stateById = new Map();
  for (const s of states.states) {
    if (stateById.has(s.id)) err(S, 'doppelte-id', `Zustands-ID \`${s.id}\` doppelt vergeben`);
    stateById.set(s.id, s);
  }
  const rollenIds = new Set((rolesOk ? roles.roles : []).map(r => r.id));
  // Gegen die Rollen auflösen kann nur, wer eine gültige roles.yaml hat — sonst stünde hier
  // ein Folgefehler je Übergang, der vom eigentlichen Schema-Fehler ablenkt.
  const ownerOk = o => o === 'human' || o === 'any_agent' || !rolesOk || rollenIds.has(o);

  // Fakten-Vokabular: `requires` und `done_requires` dürfen nur benannte Fakten nennen —
  // sonst prüft niemand gegen dieselbe Bedingung (Spec § 2, „Nur beobachtbare Fakten").
  const faktIds = new Set();
  for (const f of states.facts) {
    if (faktIds.has(f.id)) err(S, 'doppelte-id', `Fakt-ID \`${f.id}\` doppelt vergeben`);
    faktIds.add(f.id);
  }
  const genutzteFakten = new Set();

  if (!stateById.has(states.initial)) err(S, 'unbekannter-zustand', `initial: \`${states.initial}\` ist kein Zustand`);

  const transById = new Map();
  const ausgehend = new Map([...stateById.keys()].map(k => [k, []]));
  for (const t of states.transitions) {
    if (transById.has(t.id)) err(S, 'doppelte-id', `Übergangs-ID \`${t.id}\` doppelt vergeben`);
    transById.set(t.id, t);
    if (!stateById.has(t.from)) err(S, 'unbekannter-zustand', `\`${t.id}\`: from \`${t.from}\` ist kein Zustand`);
    else ausgehend.get(t.from).push(t);
    if (!stateById.has(t.to)) err(S, 'unbekannter-zustand', `\`${t.id}\`: to \`${t.to}\` ist kein Zustand`);
    // Kein Übergang ohne Owner, und der Owner muss eine bekannte Rolle sein.
    if (!ownerOk(t.owner)) err(S, 'unbekannter-owner', `\`${t.id}\`: owner \`${t.owner}\` ist keine Rolle aus roles.yaml und weder \`human\` noch \`any_agent\``);
    if (t.owner_fallback && !ownerOk(t.owner_fallback)) err(S, 'unbekannter-owner', `\`${t.id}\`: owner_fallback \`${t.owner_fallback}\` ist keine bekannte Rolle`);
    // Herkunft: entweder eine Direktive aus AGENTS.md oder eine andere benannte Quelle.
    // Ein falscher Direktiven-Verweis an normativer Stelle ist schlimmer als gar keiner —
    // deshalb ist `directive` optional und `source` die Alternative.
    if (!t.directive && !t.source) err(S, 'herkunft-fehlt', `\`${t.id}\`: weder \`directive\` noch \`source\` — die Regel hat keine belegte Herkunft`);
    for (const r of t.requires ?? []) {
      genutzteFakten.add(r);
      if (!faktIds.has(r)) err(S, 'unbekannter-fakt', `\`${t.id}\`: requires nennt \`${r}\` — kein Fakt aus \`facts\``);
    }
    // Owner je Übergang gegen den Owner des Ziel-Labels: Wer das Label setzt, steht am Zustand
    // (`set_by_role`); ein Übergang dorthin darf keinen anderen Owner behaupten.
    const ziel = stateById.get(t.to);
    if (ziel?.label && ziel.set_by_role) {
      const erlaubt = [ziel.set_by_role, ziel.set_by_role_fallback].filter(Boolean);
      const passt = o => erlaubt.includes(o) || (ziel.set_by_role === 'any_agent' && o !== 'human' && ownerOk(o));
      if (!passt(t.owner)) err(S, 'owner-vs-set-by', `\`${t.id}\` führt nach \`${t.to}\` (Label wird gesetzt von \`${erlaubt.join('`/`')}\`), owner ist aber \`${t.owner}\``);
      if (t.owner_fallback && !passt(t.owner_fallback)) err(S, 'owner-vs-set-by', `\`${t.id}\`: owner_fallback \`${t.owner_fallback}\` setzt das Label von \`${t.to}\` nicht (\`${erlaubt.join('`/`')}\`)`);
    }
  }
  for (const s of states.states) {
    if (s.set_by_role && !ownerOk(s.set_by_role)) err(S, 'unbekannter-owner', `\`${s.id}\`: set_by_role \`${s.set_by_role}\` ist keine bekannte Rolle`);
    if (s.set_by_role_fallback && !ownerOk(s.set_by_role_fallback)) err(S, 'unbekannter-owner', `\`${s.id}\`: set_by_role_fallback \`${s.set_by_role_fallback}\` ist keine bekannte Rolle`);
  }

  // Erreichbarkeit: jeder Zustand ab `initial` erreichbar.
  const erreicht = new Set([states.initial]);
  for (let geaendert = true; geaendert;) {
    geaendert = false;
    for (const t of states.transitions) {
      if (erreicht.has(t.from) && !erreicht.has(t.to) && stateById.has(t.to)) { erreicht.add(t.to); geaendert = true; }
    }
  }
  for (const s of states.states) {
    if (!erreicht.has(s.id)) err(S, 'unerreichbar', `Zustand \`${s.id}\` ist von \`${states.initial}\` aus nicht erreichbar`);
    const raus = ausgehend.get(s.id) ?? [];
    if (s.terminal && raus.length) err(S, 'terminal-mit-ausgang', `\`${s.id}\` ist terminal, hat aber ${raus.length} ausgehende Übergänge`);
    if (!s.terminal && raus.length === 0) err(S, 'sackgasse', `\`${s.id}\` ist nicht terminal, hat aber keinen ausgehenden Übergang`);
  }

  const inv = states.invariants;
  // `done` nur über einen Menschen (D1) und nur mit den geforderten Belegen.
  for (const r of inv.done_requires) {
    genutzteFakten.add(r);
    if (!faktIds.has(r)) err(S, 'unbekannter-fakt', `invariants.done_requires nennt \`${r}\` — kein Fakt aus \`facts\``);
  }
  for (const id of faktIds) {
    if (!genutzteFakten.has(id)) warn(S, 'fakt-ungenutzt', `Fakt \`${id}\` wird von keinem Übergang und keiner Invariante verlangt`);
  }
  if (!stateById.has(inv.done_state)) {
    err(S, 'unbekannter-zustand', `invariants.done_state: \`${inv.done_state}\` ist kein Zustand`);
  } else {
    if (!stateById.get(inv.done_state).terminal) err(S, 'done-nicht-terminal', `\`${inv.done_state}\` ist der Endzustand, aber nicht terminal`);
    const rein = states.transitions.filter(t => t.to === inv.done_state);
    if (rein.length === 0) err(S, 'done-unerreichbar', `kein Übergang führt nach \`${inv.done_state}\``);
    for (const t of rein) {
      if (t.owner !== inv.done_by) err(S, 'd1-done-owner', `\`${t.id}\` führt nach \`${inv.done_state}\`, owner ist aber \`${t.owner}\` statt \`${inv.done_by}\` (D1 — Merge nur durch Martin)`);
      if (t.owner_fallback) err(S, 'd1-done-fallback', `\`${t.id}\` führt nach \`${inv.done_state}\` und hat einen owner_fallback — der Merge kennt keine Vertretung (D1)`);
      const fehlt = inv.done_requires.filter(r => !(t.requires ?? []).includes(r));
      if (fehlt.length) err(S, 'done-requires', `\`${t.id}\`: requires fehlt ${fehlt.map(f => `\`${f}\``).join(', ')} (done_requires)`);
    }
  }
  if (rolesOk && inv.done_by !== 'human' && rollenIds.has(inv.done_by)) {
    err(S, 'd1-done-by', `done_by \`${inv.done_by}\` ist eine Agenten-Rolle — der Merge gehört dem Menschen (D1)`);
  }

  // Schleifenlimit zählbar: markierter Schleifenübergang + Ausstieg nach needs-human.
  const schleife = transById.get(inv.loop_transition);
  if (!schleife) err(S, 'unbekannter-uebergang', `invariants.loop_transition: \`${inv.loop_transition}\` ist kein Übergang`);
  else if (schleife.loop !== true) err(S, 'schleife-nicht-markiert', `\`${inv.loop_transition}\` ist als Schleifenübergang benannt, aber nicht \`loop: true\` — sonst ist die Schleife nicht zählbar`);
  else if (schleife.from === schleife.to) err(S, 'schleife-trivial', `\`${inv.loop_transition}\`: from und to sind identisch — keine zählbare Schleife`);
  else if (!states.transitions.some(t => t.from === schleife.to && t.to === schleife.from)) err(S, 'schleife-offen', `\`${inv.loop_transition}\` führt von \`${schleife.from}\` nach \`${schleife.to}\`, aber kein Übergang führt zurück — keine Schleife, die \`max_review_loops\` zählen könnte`);
  const ausstieg = transById.get(inv.loop_escape);
  if (!ausstieg) err(S, 'unbekannter-uebergang', `invariants.loop_escape: \`${inv.loop_escape}\` ist kein Übergang`);
  else if (schleife && ausstieg.from !== schleife.from) err(S, 'ausstieg-woanders', `\`${inv.loop_escape}\` startet in \`${ausstieg.from}\`, die Schleife aber in \`${schleife.from}\` — nach \`max_review_loops\` gäbe es keinen Ausweg`);
  const markiert = states.transitions.filter(t => t.loop === true).map(t => t.id);
  for (const id of markiert) {
    if (id !== inv.loop_transition) warn(S, 'weitere-schleife', `\`${id}\` ist als Schleife markiert, wird von \`max_review_loops\` aber nicht gezählt`);
  }

  // Label-Tabelle: jeder Zustand mit Label kommt in genau einer Zeile vor, Zustände ohne Label nie.
  const gesehen = new Map();
  for (const zeile of states.label_table) {
    for (const id of zeile.states) {
      if (!stateById.has(id)) { err(S, 'unbekannter-zustand', `label_table: \`${id}\` ist kein Zustand`); continue; }
      if (!stateById.get(id).label) err(S, 'label-tabelle-ohne-label', `label_table nennt \`${id}\`, der Zustand hat aber kein Label`);
      gesehen.set(id, (gesehen.get(id) ?? 0) + 1);
    }
    if (zeile.states.length > 1) {
      for (const feld of ['label', 'set_by', 'trigger']) {
        if (!zeile[feld]) err(S, 'sammelzeile-unvollstaendig', `label_table-Zeile über ${zeile.states.length} Zustände braucht ein eigenes \`${feld}\``);
      }
    }
  }
  for (const s of states.states) {
    const n = gesehen.get(s.id) ?? 0;
    if (s.label && n !== 1) err(S, 'label-tabelle-luecke', `\`${s.id}\` hat ein Label, steht aber in ${n} Zeilen der label_table (erwartet: 1)`);
    if (s.label && (!s.set_by || !s.trigger || !s.set_by_role)) err(S, 'label-ohne-owner', `\`${s.id}\` hat ein Label, aber kein \`set_by\`/\`set_by_role\`/\`trigger\` — jeder Übergang braucht genau einen Owner`);
  }
  const labels = states.states.filter(s => s.label).map(s => s.label);
  if (new Set(labels).size !== labels.length) err(S, 'doppeltes-label', 'zwei Zustände tragen dasselbe Label');
}

// -------------------------------- Ebene 2d/2e: Regeln und Pipeline gegen ihre Vokabulare
//
// Reihenfolge: erst die Pipeline, dann die Regeln. Die Pipeline liefert, welche Fakten,
// Trigger und Regeln sie referenziert — ohne das meldete Ebene 2d jede Regel, die an einem
// Pipeline-Schritt hängt, als ungenutzt.
let regelEintraege = 0;
let pipelineSchritte = 0;
// Das Fakten-Vokabular ist die Vereinigung beider Listen; die Kollisionsprüfung steht in
// Ebene 2d (`fakt-id-kollision`), damit hier keine ID stumm die andere verdeckt.
const alleFaktIds = new Set([
  ...(statesOk ? states.facts.map(f => f.id) : []),
  ...(regelnOk ? rules.facts.map(f => f.id) : []),
]);
const pipelineErgebnis = pipelineOk
  ? pipelineKonsistenz(pipeline, {
    rollen: new Map((rolesOk ? roles.roles : []).map(r => [r.id, r])),
    zustaende: new Map((statesOk ? states.states : []).map(s => [s.id, s])),
    faktIds: alleFaktIds,
    regelIds: new Set(regelnOk ? rules.rules.map(r => r.id) : []),
    uebergaenge: statesOk ? states.transitions : [],
    doneState: statesOk ? states.invariants.done_state : null,
    maxReviewLoops: statesOk ? states.invariants.max_review_loops : null,
  })
  : null;
if (pipelineErgebnis) {
  pipelineSchritte = pipelineErgebnis.geprueft;
  for (const b of pipelineErgebnis.befunde) {
    (b.level === 'warn' ? warn : err)('workflow/pipeline.yaml', b.code, b.message);
  }
}

if (regelnOk) {
  const R = 'workflow/rules.yaml';
  // Die Querverweise werden gegen dieselbe Datei aufgelöst, die schon den D2-Prosa-Abgleich
  // trägt (`d2_prose_check.file`, Default AGENTS.md) — eine zweite Angabe liefe auseinander.
  const prosaDatei = (rolesOk ? roles.d2_prose_check.file : null) ?? 'AGENTS.md';
  const prosaPfad = path.join(root, prosaDatei);
  const ueberschriften = fs.existsSync(prosaPfad) ? fetteUeberschriften(fs.readFileSync(prosaPfad, 'utf8')) : null;
  if (!ueberschriften) {
    warn(R, 'ueberschriften-nicht-geladen', `${prosaDatei} nicht lesbar — die \`source.agents_md\`-Querverweise wurden nicht aufgelöst`);
  }
  const ergebnis = regelKonsistenz(rules, {
    fremdeFaktIds: new Set(statesOk ? states.facts.map(f => f.id) : []),
    ueberschriften,
    dateiExistiert: d => fs.existsSync(path.join(root, d)),
    genutztAnderswo: {
      fakten: pipelineErgebnis?.genutzteFakten ?? new Set(),
      trigger: pipelineErgebnis?.genutzteTrigger ?? new Set(),
      regeln: pipelineErgebnis?.genutzteRegeln ?? new Set(),
    },
  });
  regelEintraege = ergebnis.geprueft;
  for (const b of ergebnis.befunde) {
    (b.level === 'warn' ? warn : err)(R, b.code, b.message);
  }
}

const ok = errors.length === 0;
const report = {
  ok,
  root,
  geprueft: {
    rollen: rolesOk ? roles.roles.length : 0,
    tool_eintraege: toolEintraege,
    d2_prosa_formen: prosaFormen,
    zustaende: statesOk ? states.states.length : 0,
    uebergaenge: statesOk ? states.transitions.length : 0,
    regeln: regelEintraege,
    pipeline_schritte: pipelineSchritte,
  },
  selftest,
  errors,
  warnings,
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Workflow-DSL-Validierung');
  console.log(`  Selbsttest der Analysen: ${selftest.filter(s => s.ok).length}/${selftest.length} Fälle wie erwartet`);
  console.log(`  workflow/roles.yaml:  ${report.geprueft.rollen} Rollen, ${report.geprueft.tool_eintraege} Tool-Einträge`);
  console.log(`  ${rolesOk ? roles.d2_prose_check.file : 'AGENTS.md'} ↔ roles.yaml: ${report.geprueft.d2_prosa_formen} D2-Formen abgeglichen`);
  console.log(`  workflow/states.yaml: ${report.geprueft.zustaende} Zustände, ${report.geprueft.uebergaenge} Übergänge`);
  console.log(`  workflow/rules.yaml:  ${report.geprueft.regeln} Regeln und dokumentierte Konventionen`);
  console.log(`  workflow/pipeline.yaml: ${report.geprueft.pipeline_schritte} Schritte`);
  if (warnings.length) {
    console.log(`\nWarnungen (${warnings.length}):`);
    for (const w of warnings) console.log(`  [${w.code}] ${w.where}: ${w.message}`);
  }
  if (errors.length) {
    console.log(`\nFehler (${errors.length}):`);
    for (const e of errors) console.log(`  [${e.code}] ${e.where}: ${e.message}`);
  }
  console.log(`\n${ok ? 'OK — keine Fehler.' : `FEHLGESCHLAGEN — ${errors.length} Fehler.`}`);
}
process.exit(ok ? 0 : 1);
