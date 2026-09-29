// Validierung der Workflow-DSL unter workflow/ (Spec: docs/specs/dsl-workflow.md, § 3).
// Setup und Aufruf: docs/validate-setup.md
//
//   node scripts/validate-workflow.mjs [--root <verzeichnis>] [--json] [--selftest]
//
// Ebene 1  Schema: roles.yaml und states.yaml gegen JSON-Schemata (ajv), Referenzauflösung.
// Ebene 2  Konsistenz: Wildcard-Sicherheitsanalyse der Tool-Allowlists (Argument-Wildcard ok;
//          Wert-Wildcard, Injektionsformen wie -C/-c/--git-dir=…, Verkettungs- und
//          Umlenkungszeichen, Variablen-Expansion, nicht-terminale Wildcards und blanke
//          Sammelpattern hart falsch), Subsumptionsvergleich gegen die Verbotsformen
//          (eine Freigabe darf weder unter ein Verbot fallen noch eines mit abdecken)
//          und Zustandsmaschinen-Checks (Erreichbarkeit, Owner je Übergang, Invarianten).
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
// Verbotsliste für den Subsumptionsteil des Selbsttests — dieselben Formen und Modi wie in
// roles.yaml, hier aber fest verdrahtet, damit der Selbsttest ohne die YAML-Dateien läuft.
const VERBOTSFORMEN_TEST = [
  { pattern: 'Bash(git *)', directive: 'D2', match: 'blanket', reason: 'blankes Sammelpattern' },
  { pattern: 'Bash(git push *)', directive: 'D2', except: ['Bash(git push -u origin HEAD)'], reason: 'Push-Guard' },
  { pattern: 'Bash(gh pr merge *)', directive: 'D1', reason: 'Merge nur durch Martin' },
  { pattern: 'Bash(gh pr edit *)', directive: 'D2', reason: 'ersetzt den PR-Body vollständig' },
  { pattern: 'Bash(gh issue edit *)', directive: 'D2', except: ['Bash(gh issue edit --add-label *)', 'Bash(gh issue edit --remove-label *)', 'Bash(gh issue edit --body *)'], reason: 'ersetzt den Issue-Body vollständig' },
  { pattern: 'Bash(gh pr comment --edit-last *)', directive: 'D4', match: 'konvention', reason: 'ersetzt den letzten eigenen Kommentar' },
];
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

function runSelftest() {
  const ergebnis = [];
  const fall = (name, entry, erwartet, gefunden, ok, code) => {
    ergebnis.push({ fall: name, entry, erwartet, gefunden, ok });
    if (!ok) err('selftest', code, `${name}: \`${entry}\` — erwartet ${erwartet}, gefunden: ${gefunden.join(', ') || 'nichts'}`);
  };
  for (const f of HISTORISCHE_VERSTOESSE) {
    const hart = classifyToolPattern(f.entry).filter(b => b.level === 'error').map(b => b.code);
    fall(f.id, f.entry, f.code, hart, hart.includes(f.code), 'historischer-fall-nicht-gefangen');
  }
  for (const entry of ERLAUBTE_FORMEN) {
    const hart = classifyToolPattern(entry).filter(b => b.level === 'error').map(b => b.code);
    fall('erlaubte Form', entry, 'kein Fehler', hart, hart.length === 0, 'fehlalarm');
  }
  for (const f of VERBOTS_VERSTOESSE) {
    const codes = verbotsbefunde(f.entry, VERBOTSFORMEN_TEST).map(b => b.code);
    fall(f.id, f.entry, f.code, codes, codes.includes(f.code), 'verbotsbezug-nicht-gefangen');
  }
  for (const entry of VERBOTS_ERLAUBT) {
    const codes = verbotsbefunde(entry, VERBOTSFORMEN_TEST).map(b => b.code);
    fall('erlaubt trotz Verbotsliste', entry, 'kein Befund', codes, codes.length === 0, 'fehlalarm');
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

const rolesSchema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'source', 'forbidden_tools', 'roles'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    forbidden_tools: forbiddenList,
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

const selftest = runSelftest();
if (selftestOnly) {
  const ok = errors.length === 0;
  if (jsonOut) console.log(JSON.stringify({ ok, selftest, errors, warnings }, null, 2));
  else {
    console.log('Selbsttest der Wildcard-Sicherheitsanalyse');
    for (const s of selftest) console.log(`  ${s.ok ? 'ok  ' : 'FEHL'} ${s.entry.replace(/\n/g, '\\n')} → erwartet: ${s.erwartet}, gefunden: ${s.gefunden.join(', ') || '—'}`);
    if (!ok) for (const e of errors) console.log(`  Fehler: ${e.message}`);
  }
  process.exit(ok ? 0 : 1);
}

const { YAML, Ajv } = ladeModule();
const ajv = new Ajv({ allErrors: true, strict: false });
const roles = ladeYaml('workflow/roles.yaml');
const states = ladeYaml('workflow/states.yaml');
const rolesOk = pruefeSchema(ajv, rolesSchema, roles, 'workflow/roles.yaml');
const statesOk = pruefeSchema(ajv, statesSchema, states, 'workflow/states.yaml');

let toolEintraege = 0;
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

const ok = errors.length === 0;
const report = {
  ok,
  root,
  geprueft: { rollen: rolesOk ? roles.roles.length : 0, tool_eintraege: toolEintraege, zustaende: statesOk ? states.states.length : 0, uebergaenge: statesOk ? states.transitions.length : 0 },
  selftest,
  errors,
  warnings,
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Workflow-DSL-Validierung');
  console.log(`  Selbsttest der Sicherheitsanalyse: ${selftest.filter(s => s.ok).length}/${selftest.length} Fälle wie erwartet`);
  console.log(`  workflow/roles.yaml:  ${report.geprueft.rollen} Rollen, ${report.geprueft.tool_eintraege} Tool-Einträge`);
  console.log(`  workflow/states.yaml: ${report.geprueft.zustaende} Zustände, ${report.geprueft.uebergaenge} Übergänge`);
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
