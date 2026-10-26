// Generiert WORKFLOW.md aus der AKTIVEN DSL-Instanz der Registry (workflow/registry.yaml)
// und den aktiv-Block von AGENTS.md. Nachfolger von scripts/render-agents.mjs: AGENTS.md ist
// dünnschnittig — es behält nur den aktiv-Block zwischen den Markern
// `<!-- dsl:active-workflow:start/end -->`; die Detail-Tabellen (Rollen, Labels, Übergänge,
// Regeln, Pipeline-Schritte) stehen in WORKFLOW.md.
// Setup und Aufruf: docs/validate-setup.md
//
//   node scripts/render-workflow.mjs [--check|--write|--write-workflow-only|--print] [--root <verzeichnis>]
//
// --check (Default)  vergleicht generiert gegen eingecheckt (WORKFLOW.md und AGENTS.md-Block),
//                    Abweichung = Exit-Code 1
// --write            schreibt die Fragmente zwischen die Marker in WORKFLOW.md und den
//                    aktiv-Block in AGENTS.md
// --write-workflow-only schreibt NUR WORKFLOW.md — AGENTS.md bleibt unangetastet (nützlich, wenn
//                    die AGENTS.md-Struktur gerade von Hand umgebaut wird und der Marker-Bereich
//                    noch nicht konsistent mit der DSL stehen kann)
// --print            gibt die Fragmente auf stdout aus
//
// Der Vergleich läuft über scripts/render-workflow-lib.mjs (Whitespace-Toleranz wie im
// früheren render-agents.mjs: Zellen getrimmt, Trennzeile normalisiert; der Zelltext muss
// zeichengenau übereinstimmen).
//
// Exit-Code: 0 = deckungsgleich (bzw. geschrieben), 1 = Abweichung, 2 = Setup-/Aufruf-/Laufzeitfehler.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { aktiverBlock, workflowFragmente, pruefeGenerierte, markerBereich } from './render-workflow-lib.mjs';

const args = process.argv.slice(2);
let root = process.cwd();
let modus = 'check';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') {
    if (!args[i + 1]) { console.error('--root braucht ein Verzeichnis'); process.exit(2); }
    root = args[++i];
  } else if (args[i] === '--check' || args[i] === '--write' || args[i] === '--write-workflow-only' || args[i] === '--print') {
    modus = args[i].slice(2);
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/render-workflow.mjs [--check|--write|--write-workflow-only|--print] [--root <verzeichnis>]');
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

// Registry lesen und die aktive Instanz laden. registry.yaml selbst wird hier nur soweit
// geprüft, wie die Generierung es braucht (genau ein aktiver Eintrag) — die vollständigen
// Registry-Invarianten prüft scripts/validate-workflow.mjs.
const registry = ladeYaml('workflow/registry.yaml');
const aktive = (registry.workflows ?? []).filter(w => w.active);
if (aktive.length !== 1) {
  console.error(`registry.yaml: ${aktive.length} Einträge mit \`active: true\` — genau einer ist Pflicht`);
  process.exit(2);
}
// Die aktive Instanz: die vier DSL-Dateien unter workflow/<id>/.
const instanz = {
  roles: ladeYaml(`workflow/${aktive[0].id}/roles.yaml`),
  states: ladeYaml(`workflow/${aktive[0].id}/states.yaml`),
  rules: ladeYaml(`workflow/${aktive[0].id}/rules.yaml`),
  pipeline: ladeYaml(`workflow/${aktive[0].id}/pipeline.yaml`),
};

const fragmente = workflowFragmente(instanz);
const blockFragment = { id: 'active-workflow', titel: 'Aktiv-Block', quelle: 'registry.yaml', text: aktiverBlock(registry) };

if (modus === 'print') {
  for (const f of [...fragmente, blockFragment]) console.log(`<!-- dsl:${f.id}:start -->\n${f.text}\n<!-- dsl:${f.id}:end -->\n`);
  process.exit(0);
}

// --write: Fragment zwischen die Marker setzen, Rest der Datei unverändert.
function schreibe(pfad, fragment) {
  const p = path.join(root, pfad);
  if (!fs.existsSync(p)) { console.error(`Datei nicht gefunden: ${p}`); process.exit(2); }
  let text = fs.readFileSync(p, 'utf8');
  const bereich = markerBereich(text, fragment.id);
  if (!bereich) {
    console.error(`${pfad}: Marker \`<!-- dsl:${fragment.id}:start -->\` / \`<!-- dsl:${fragment.id}:end -->\` fehlen`);
    process.exit(2);
  }
  text = text.slice(0, bereich.von) + `\n${fragment.text}\n` + text.slice(bereich.bis);
  fs.writeFileSync(p, text);
  return bereich;
}

if (modus === 'write') {
  for (const f of fragmente) schreibe('WORKFLOW.md', f);
  schreibe('AGENTS.md', blockFragment);
  console.log(`WORKFLOW.md und AGENTS.md aktualisiert: ${[...fragmente, blockFragment].map(f => f.titel).join(', ')}`);
  process.exit(0);
}

if (modus === 'write-workflow-only') {
  for (const f of fragmente) schreibe('WORKFLOW.md', f);
  console.log(`WORKFLOW.md aktualisiert (AGENTS.md unangetastet): ${fragmente.map(f => f.titel).join(', ')}`);
  process.exit(0);
}

// --check
const abweichungen = [];
const werkPfad = path.join(root, 'WORKFLOW.md');
if (!fs.existsSync(werkPfad)) {
  abweichungen.push('WORKFLOW.md: Datei fehlt');
} else {
  const werk = fs.readFileSync(werkPfad, 'utf8');
  for (const b of pruefeGenerierte(werk, fragmente)) {
    abweichungen.push(`WORKFLOW.md — ${b.titel} ${b.message}`);
  }
}
const agentsPfad = path.join(root, 'AGENTS.md');
if (!fs.existsSync(agentsPfad)) {
  abweichungen.push('AGENTS.md: Datei fehlt');
} else {
  const agents = fs.readFileSync(agentsPfad, 'utf8');
  for (const b of pruefeGenerierte(agents, [blockFragment])) {
    abweichungen.push(`AGENTS.md — ${b.titel} ${b.message}`);
  }
}

if (abweichungen.length) {
  console.log('Generierte Fragmente weichen vom eingecheckten Stand ab:\n');
  for (const a of abweichungen) console.log(`  ${a}\n`);
  console.log('Beheben: `node scripts/render-workflow.mjs --write` (Quelle ist die DSL, nicht das Markdown).');
  process.exit(1);
}
console.log(`WORKFLOW.md und AGENTS.md deckungsgleich mit der aktiven Instanz \`${aktive[0].id}\`: ${[...fragmente, blockFragment].map(f => f.titel).join(', ')}`);
process.exit(0);
