// Generiert die strukturierten Tabellen von AGENTS.md aus der Workflow-DSL (Spec § 6, Hybrid):
// Rollen-Tabelle aus workflow/roles.yaml, Label-Tabelle aus workflow/states.yaml.
// Die Begründungsprosa der Direktiven bleibt Handtext und wird hier nicht angefasst.
// Setup und Aufruf: docs/validate-setup.md
//
//   node scripts/render-agents.mjs [--check|--write|--print] [--root <verzeichnis>]
//
// --check (Default)  vergleicht generiert gegen eingecheckt, Abweichung = Exit-Code 1
// --write            schreibt die Fragmente zwischen die Marker in AGENTS.md
// --print            gibt die Fragmente auf stdout aus
//
// Verglichen wird mit Whitespace-Toleranz: Zellen werden getrimmt, die Trennzeile normalisiert.
// Der Text der Zellen muss zeichengenau übereinstimmen.
//
// Exit-Code: 0 = deckungsgleich (bzw. geschrieben), 1 = Abweichung, 2 = Setup-/Aufruf-/Laufzeitfehler.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
let root = process.cwd();
let modus = 'check';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') {
    if (!args[i + 1]) { console.error('--root braucht ein Verzeichnis'); process.exit(2); }
    root = args[++i];
  } else if (args[i] === '--check' || args[i] === '--write' || args[i] === '--print') {
    modus = args[i].slice(2);
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/render-agents.mjs [--check|--write|--print] [--root <verzeichnis>]');
    process.exit(0);
  } else {
    console.error(`unbekanntes Argument: ${args[i]}`);
    process.exit(2);
  }
}

// js-yaml über NODE_PATH — kein Install im Repo (docs/validate-setup.md).
function resolveModule(id) {
  for (const base of [import.meta.url, pathToFileURL(path.join(process.cwd(), 'noop.js')).href]) {
    try { return createRequire(base)(id); } catch {}
  }
  return null;
}
const yamlMod = resolveModule('js-yaml');
if (!yamlMod) { console.error('js-yaml nicht auflösbar — Setup siehe docs/validate-setup.md'); process.exit(2); }
const YAML = yamlMod.default ?? yamlMod;

function ladeYaml(datei) {
  const p = path.join(root, datei);
  if (!fs.existsSync(p)) { console.error(`Datei nicht gefunden: ${p}`); process.exit(2); }
  try { return YAML.load(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`YAML nicht lesbar (${datei}): ${e.message}`); process.exit(2); }
}

const roles = ladeYaml('workflow/roles.yaml');
const states = ladeYaml('workflow/states.yaml');

const zeile = zellen => `| ${zellen.join(' | ')} |`;
const tabelle = (kopf, reihen) => [zeile(kopf), `|${kopf.map(() => '---').join('|')}|`, ...reihen.map(zeile)].join('\n');

function rollenTabelle() {
  return tabelle(['Rolle', 'Realisierung', 'Scope'],
    roles.roles.map(r => [`**${r.name}**`, r.realization, r.scope]));
}

function labelTabelle() {
  const byId = new Map(states.states.map(s => [s.id, s]));
  const reihen = states.label_table.map(row => {
    const erster = byId.get(row.states[0]);
    if (!erster) { console.error(`label_table verweist auf unbekannten Zustand: ${row.states[0]}`); process.exit(2); }
    // Sammelzeilen tragen ihre Felder selbst, Einzelzeilen erben sie vom Zustand.
    const label = row.label ?? `\`${erster.label}\``;
    const setBy = row.set_by ?? erster.set_by;
    const trigger = row.trigger ?? erster.trigger;
    if (!label || !setBy || !trigger) { console.error(`label_table-Zeile unvollständig: ${row.states.join(', ')}`); process.exit(2); }
    return [label, setBy, trigger];
  });
  return tabelle(['Label', 'wird gesetzt von', 'Auslöser'], reihen);
}

const fragmente = [
  { id: 'roles-table', titel: 'Rollen-Tabelle', quelle: 'workflow/roles.yaml', text: rollenTabelle() },
  { id: 'label-table', titel: 'Label-Tabelle', quelle: 'workflow/states.yaml', text: labelTabelle() },
];

if (modus === 'print') {
  for (const f of fragmente) console.log(`<!-- dsl:${f.id}:start -->\n${f.text}\n<!-- dsl:${f.id}:end -->\n`);
  process.exit(0);
}

const agentsPfad = path.join(root, 'AGENTS.md');
if (!fs.existsSync(agentsPfad)) { console.error(`Datei nicht gefunden: ${agentsPfad}`); process.exit(2); }
let agents = fs.readFileSync(agentsPfad, 'utf8');

function markerBereich(text, id) {
  const start = `<!-- dsl:${id}:start -->`;
  const ende = `<!-- dsl:${id}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(ende);
  if (a === -1 || b === -1 || b < a) return null;
  return { start, ende, von: a + start.length, bis: b };
}

// Whitespace-Toleranz: Zeilen trimmen, Leerzeilen ignorieren, Tabellenzellen trimmen,
// Trennzeilen auf `---` normalisieren. Der Zelltext selbst wird nicht angefasst.
function normalisiere(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    if (!l.startsWith('|')) return l;
    const zellen = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (zellen.every(c => /^:?-{2,}:?$/.test(c))) return zellen.map(() => '---').join('|');
    return zellen.join(' | ');
  }).join('\n');
}

const abweichungen = [];
for (const f of fragmente) {
  const bereich = markerBereich(agents, f.id);
  if (!bereich) {
    abweichungen.push(`${f.titel}: Marker \`<!-- dsl:${f.id}:start -->\` / \`<!-- dsl:${f.id}:end -->\` fehlen in AGENTS.md`);
    continue;
  }
  const eingecheckt = agents.slice(bereich.von, bereich.bis);
  if (normalisiere(eingecheckt) === normalisiere(f.text)) continue;
  if (modus === 'write') {
    agents = agents.slice(0, bereich.von) + `\n${f.text}\n` + agents.slice(bereich.bis);
    continue;
  }
  const g = normalisiere(f.text).split('\n');
  const e = normalisiere(eingecheckt).split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(g.length, e.length); i++) {
    if (g[i] !== e[i]) diff.push(`    Zeile ${i + 1}\n      generiert:   ${g[i] ?? '—'}\n      eingecheckt: ${e[i] ?? '—'}`);
  }
  abweichungen.push(`${f.titel} (aus ${f.quelle}) weicht von AGENTS.md ab:\n${diff.join('\n')}`);
}

if (modus === 'write') {
  fs.writeFileSync(agentsPfad, agents);
  if (abweichungen.length) {
    console.error(`AGENTS.md geschrieben, aber ${abweichungen.length} Fragment(e) ohne Marker:`);
    for (const a of abweichungen) console.error(`  ${a}`);
    process.exit(2);
  }
  console.log(`AGENTS.md aktualisiert: ${fragmente.map(f => f.titel).join(', ')}`);
  process.exit(0);
}

if (abweichungen.length) {
  console.log('Generierte Tabellen weichen von AGENTS.md ab:\n');
  for (const a of abweichungen) console.log(`  ${a}\n`);
  console.log('Beheben: `node scripts/render-agents.mjs --write` (Quelle ist die DSL, nicht AGENTS.md).');
  process.exit(1);
}
console.log(`AGENTS.md deckungsgleich mit der DSL: ${fragmente.map(f => f.titel).join(', ')}`);
process.exit(0);
