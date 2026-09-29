// Validierung der Workflow-DSL unter workflow/ (Spec: docs/specs/dsl-workflow.md, § 3).
// Setup und Aufruf: docs/validate-setup.md
//
//   node scripts/validate-workflow.mjs [--root <verzeichnis>] [--json] [--selftest]
//
// Ebene 1  Schema: roles.yaml und states.yaml gegen JSON-Schemata (ajv), Referenzauflösung.
// Ebene 2  Konsistenz: Wildcard-Sicherheitsanalyse der Tool-Allowlists (Argument-Wildcard ok;
//          Wert-Wildcard und Injektionsformen wie -C/-c sowie blanke Sammelpattern hart falsch)
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
const yamlMod = resolveModule('js-yaml');
const ajvMod = resolveModule('ajv');
if (!yamlMod || !ajvMod) {
  const fehlt = [!yamlMod && 'js-yaml', !ajvMod && 'ajv'].filter(Boolean).join(', ');
  console.error(`${fehlt} nicht auflösbar — Setup siehe docs/validate-setup.md`);
  process.exit(2);
}
const YAML = yamlMod.default ?? yamlMod;
const Ajv = ajvMod.default ?? ajvMod;

const errors = [];
const warnings = [];
const err = (where, code, message) => errors.push({ where, code, message });
const warn = (where, code, message) => warnings.push({ where, code, message });

// ---------------------------------------------------------------- Ebene 2: Wildcard-Analyse

// Binaries, bei denen ein blankes Sammelpattern (`git *`) ein Verbot aushebelt und deshalb
// hart falsch ist — nicht nur eine Warnung (AGENTS.md D2, „Kein blankes `Bash(git *)`").
const BLANKET_HARD = ['git', 'gh'];
// Flags, die Arbeitsverzeichnis, Konfiguration oder ausgeführtes Programm bestimmen: In einem
// Freigabe-Pattern sind sie eine Injektionsform (Blocker B1 aus PR #27).
const INJECTION_FLAGS = ['-C', '-c', '--config', '--config-env', '--exec-path', '--git-dir', '--work-tree', '--upload-pack', '--receive-pack'];
const CHAIN_CHARS = [';', '&&', '||', '|', '`', '$('];
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Klassifiziert einen Freigabe-Eintrag. Ergebnis: Liste von Befunden mit level 'error'|'warn'.
// Heuristik über die Pattern-Form, nicht über die Semantik des Tools (Spec § 8): unklare Formen
// sind Warnungen, die drei historischen Verstoßformen sind Fehler.
export function classifyToolPattern(entry) {
  const found = [];
  const add = (level, code, message) => found.push({ level, code, entry, message });

  const m = /^([A-Za-z][A-Za-z0-9_]*)\((.*)\)$/.exec(entry);
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

  const tokens = cmd.trim().split(/\s+/);
  for (const t of tokens) {
    for (const c of CHAIN_CHARS) {
      if (t.includes(c)) add('error', 'befehlskette', `Verkettungszeichen \`${c}\` im Pattern — verkettete Kommandos hängen an einer eigenen Freigabe (D2)`);
    }
  }

  // Zuweisungen vor dem Binary: Wert-Wildcard = hart falsch (Fall NODE_PATH=…),
  // literale Zuweisung = Warnung — sie gehört in die Umgebung, nicht in die Allowlist.
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i])) {
    if (tokens[i].includes('*')) {
      add('error', 'wert-wildcard', `\`${tokens[i]}\` — Wildcard in Wert-Position einer Zuweisung; sie bestimmt mit, welcher Code im Lauf geladen wird (D2, „Warum nicht inline \`NODE_PATH=… node scripts/verify-mermaid.mjs\`")`);
    } else {
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

  for (const t of rest.slice(1)) {
    if (INJECTION_FLAGS.includes(t)) {
      add('error', 'injektionsflag', `\`${t}\` im Pattern — bestimmt Arbeitsverzeichnis, Konfiguration oder ausgeführtes Programm (Blocker B1 aus PR #27; D2, „Weder \`git -C\` noch \`cd\`")`);
    }
  }

  // Blankes Sammelpattern: Binary ohne festen Subcommand davor.
  if (rest.length === 1 || (rest.length === 2 && rest[1] === '*')) {
    if (BLANKET_HARD.includes(binary)) {
      add('error', 'sammelpattern', `\`${cmd}\` — blankes Sammelpattern für \`${binary}\`; es deckt auch die Formen ab, die D1/D2 verbieten`);
    } else {
      add('warn', 'sammelpattern-unklar', `\`${cmd}\` — Sammelpattern ohne festen Subcommand; Reichweite nicht überprüfbar`);
    }
  }

  // Wildcard-Positionen: nur das abschließende alleinstehende `*` ist ein Argument-Wildcard.
  for (let k = 1; k < rest.length; k++) {
    const t = rest[k];
    if (!t.includes('*')) continue;
    const last = k === rest.length - 1;
    if (t === '*' && last) continue; // Argument-Wildcard — die gewollte Form
    if (t === '*') {
      add('warn', 'wildcard-mittig', `\`*\` in Position ${k + 1} von ${rest.length} — der \`*\` matcht beliebigen Text, auch die nachfolgenden Tokens`);
    } else {
      add('warn', 'wildcard-eingebettet', `\`${t}\` — Wildcard innerhalb eines Tokens; matcht mehr als das gemeinte Argument`);
    }
  }
  return found;
}

// Die drei historischen Verstoßformen aus der Spec (§ 7, AK 3). Der Selbsttest läuft bei jedem
// Lauf mit: Die Analyse muss sie hart als Fehler melden, sonst ist der Validator selbst kaputt.
const HISTORISCHE_VERSTOESSE = [
  { id: 'B1 (-C-Wildcard, PR #27)', entry: 'Bash(git -C worktrees/* status)', code: 'injektionsflag' },
  { id: 'NODE_PATH=-Inline-Prefix', entry: 'Bash(NODE_PATH=* node scripts/verify-mermaid.mjs *)', code: 'wert-wildcard' },
  { id: 'blankes git *', entry: 'Bash(git *)', code: 'sammelpattern' },
];
// Formen, die erlaubt bleiben müssen — ein Fehlalarm hier macht die Analyse unbrauchbar.
const ERLAUBTE_FORMEN = [
  'Read', 'Write', 'Bash(git status *)', 'Bash(git push -u origin HEAD)', 'Bash(git pull)',
  'Bash(git branch -D *)', 'Bash(gh issue edit --add-label *)', 'Bash(node scripts/verify-mermaid.mjs *)',
];

function runSelftest() {
  const ergebnis = [];
  for (const fall of HISTORISCHE_VERSTOESSE) {
    const befunde = classifyToolPattern(fall.entry);
    const hart = befunde.filter(b => b.level === 'error');
    const getroffen = hart.some(b => b.code === fall.code);
    ergebnis.push({ fall: fall.id, entry: fall.entry, erwartet: fall.code, gefunden: hart.map(b => b.code), ok: getroffen });
    if (!getroffen) {
      err('selftest', 'historischer-fall-nicht-gefangen', `${fall.id}: \`${fall.entry}\` wurde nicht hart als \`${fall.code}\` gemeldet (gefunden: ${hart.map(b => b.code).join(', ') || 'nichts'})`);
    }
  }
  for (const entry of ERLAUBTE_FORMEN) {
    const hart = classifyToolPattern(entry).filter(b => b.level === 'error');
    ergebnis.push({ fall: 'erlaubte Form', entry, erwartet: 'kein Fehler', gefunden: hart.map(b => b.code), ok: hart.length === 0 });
    if (hart.length) err('selftest', 'fehlalarm', `erlaubte Form \`${entry}\` als Fehler gemeldet: ${hart.map(b => b.code).join(', ')}`);
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
  required: ['version', 'source', 'initial', 'states', 'label_table', 'transitions', 'invariants'],
  properties: {
    version: { const: 1 },
    source: { type: 'string', minLength: 1 },
    initial: { type: 'string', minLength: 1 },
    states: {
      type: 'array', minItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'description', 'terminal'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          label: { type: 'string', minLength: 1 },
          set_by: { type: 'string', minLength: 1 },
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
          directive: { type: 'string', pattern: '^D[1-8]$' },
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
    for (const s of selftest) console.log(`  ${s.ok ? 'ok  ' : 'FEHL'} ${s.entry} → erwartet: ${s.erwartet}, gefunden: ${s.gefunden.join(', ') || '—'}`);
    if (!ok) for (const e of errors) console.log(`  Fehler: ${e.message}`);
  }
  process.exit(ok ? 0 : 1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const roles = ladeYaml('workflow/roles.yaml');
const states = ladeYaml('workflow/states.yaml');
const rolesOk = pruefeSchema(ajv, rolesSchema, roles, 'workflow/roles.yaml');
const statesOk = pruefeSchema(ajv, statesSchema, states, 'workflow/states.yaml');

let toolEintraege = 0;
if (rolesOk) {
  const R = 'workflow/roles.yaml';
  const ids = new Set();
  for (const rolle of roles.roles) {
    if (ids.has(rolle.id)) err(R, 'doppelte-id', `Rollen-ID \`${rolle.id}\` doppelt vergeben`);
    ids.add(rolle.id);

    // Referenzauflösung: Rollen mit D2-Set brauchen Allowlist und Budget, die anderen keine.
    if (rolle.d2_set) {
      if (!rolle.allowed_tools) err(R, 'fehlende-allowlist', `\`${rolle.id}\`: d2_set ist true, aber allowed_tools fehlt`);
      if (!rolle.budget) err(R, 'fehlendes-budget', `\`${rolle.id}\`: d2_set ist true, aber budget fehlt (D2 — Delegationen immer mit \`--max-turns\`)`);
    } else if (rolle.allowed_tools) {
      err(R, 'allowlist-ohne-d2-set', `\`${rolle.id}\`: allowed_tools ohne d2_set`);
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
      for (const b of classifyToolPattern(e)) {
        const wo = `${R} → ${rolle.id}/${quelle}`;
        if (b.level === 'error') err(wo, b.code, `\`${e}\`: ${b.message}`);
        else warn(wo, b.code, `\`${e}\`: ${b.message}`);
      }
      if (/^Bash\(\s*gh\s+pr\s+merge\b/.test(e)) err(R, 'd1-merge-tool', `\`${rolle.id}\`: \`${e}\` steht in keinem Set (D1)`);
    }

    // Verbotsformen dürfen nicht im Set stehen. Global gilt für jeden Eintrag, auch für
    // Zusatzfreigaben; rollenspezifische Verbote meinen das Standard-Set — eine Zusatzfreigabe
    // für genau einen Run ist ja gerade die dokumentierte Ausnahme (Lead, D8-Basiswechsel).
    for (const f of roles.forbidden_tools) {
      for (const { e, quelle } of alleEintraege) {
        if (e === f.pattern) err(R, 'verbotener-eintrag', `\`${rolle.id}\`/${quelle}: \`${e}\` ist global als verboten geführt (${f.directive}) — ${f.reason}`);
      }
    }
    for (const f of rolle.forbidden_tools ?? []) {
      if (allowed.includes(f.pattern)) err(R, 'verbotener-eintrag', `\`${rolle.id}\`/allowed_tools: \`${f.pattern}\` ist für diese Rolle als verboten geführt (${f.directive}) — ${f.reason}`);
    }
    for (const m of rolle.must_not_include ?? []) {
      if (allowed.includes(m)) err(R, 'must-not-include', `\`${rolle.id}\`: \`${m}\` steht in allowed_tools, obwohl must_not_include es ausschließt`);
    }

    for (const c of rolle.conditional_tools ?? []) {
      for (const g of c.grants ?? []) {
        if (allowed.includes(g)) err(R, 'redundante-zusatzfreigabe', `\`${rolle.id}\`/${c.id}: \`${g}\` ist bereits im Standard-Set — eine Zusatzfreigabe wäre wirkungslos`);
      }
      for (const d of c.denies ?? []) {
        if (allowed.includes(d)) err(R, 'widerspruechliche-denies', `\`${rolle.id}\`/${c.id}: \`${d}\` ist zugleich im Standard-Set und in denies`);
      }
      for (const t of c.restrict_git_tools_to ?? []) {
        if (!allowed.includes(t)) err(R, 'restrict-nicht-im-set', `\`${rolle.id}\`/${c.id}: \`${t}\` ist eine Einschränkung auf einen Eintrag, der nicht im Standard-Set steht`);
      }
    }
  }
  // Die Verbotsliste selbst darf keine Dubletten enthalten — sonst wird eine Form zweimal
  // begründet und die Begründungen laufen auseinander.
  const verbotene = roles.forbidden_tools.map(f => f.pattern);
  if (new Set(verbotene).size !== verbotene.length) err(R, 'doppelte-verbotsform', 'forbidden_tools nennt eine Form mehrfach');
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
    if (s.label && (!s.set_by || !s.trigger)) err(S, 'label-ohne-owner', `\`${s.id}\` hat ein Label, aber kein \`set_by\`/\`trigger\` — jeder Übergang braucht genau einen Owner`);
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
