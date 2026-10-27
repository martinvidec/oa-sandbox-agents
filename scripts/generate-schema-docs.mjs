// Generierung der Schema-Dokumentation aus den DSL-Schemata (Issue #68).
//
//   node scripts/generate-schema-docs.mjs [--out <pfad>] [--check]
//
// Mit --check wird die Generierung in einen Temp-Puffer geschrieben und gegen die
// eingecheckte Datei verglichen (CI-Invariante: generiert ≡ eingecheckt) — kein Schreiben.
//
// Die Schemata sind die normative Quelle der DSL-Struktur (JSON-Schemata, ajv) und liegen
// in scripts/dsl-schemas.mjs. Dieses Skript erzeugt aus ihnen eine Markdown-Doku, die
// pro Schema alle Keys, Datentypen, Pflichtfelder, Enum-Werte und Constraints (minLength,
// pattern, anyOf, const) auflistet. Die Doku ist generiert — sie nicht von Hand pflegen,
// sondern die Schemata in scripts/dsl-schemas.mjs ändern und das Skript erneut laufen lassen.
//
// Exit-Code: 0 = Doku geschrieben bzw. (--check) deckungsgleich, 1 = Divergenz/Fehler.

import {
  registrySchema,
  rolesSchema,
  statesSchema,
  rulesSchema,
  pipelineSchema,
} from './dsl-schemas.mjs';

const args = process.argv.slice(2);
let outPath = 'docs/schema.md';
let check = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') {
    check = true;
  } else if (args[i] === '--out') {
    if (!args[i + 1]) { console.error('--out braucht einen Pfad'); process.exit(2); }
    outPath = args[++i];
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/generate-schema-docs.mjs [--out <pfad>] [--check]');
    process.exit(0);
  } else {
    console.error(`unbekanntes Argument: ${args[i]}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Rekursive Aufbereitung eines JSON-Schemas in eine Markdown-Struktur.
// ---------------------------------------------------------------------------

const SCHEMA_NAMES = {
  registrySchema: 'registry.yaml',
  rolesSchema: 'roles.yaml',
  statesSchema: 'states.yaml',
  rulesSchema: 'rules.yaml',
  pipelineSchema: 'pipeline.yaml',
};

// Liefert eine kompakte Typ-/Constraint-Beschreibung eines JSON-Schema-Objekts.
function describeSchema(schema) {
  if (!schema || typeof schema !== 'object') return '—';
  const parts = [];
  if (schema.type) parts.push(`\`${schema.type}\``);
  if (schema.const !== undefined) parts.push(`\`${schema.const}\``);
  if (schema.enum) parts.push(`enum: ${schema.enum.map(v => `\`${v}\``).join(' | ')}`);
  if (schema.pattern) parts.push(`pattern: \`${schema.pattern}\``);
  if (schema.minLength !== undefined) parts.push(`minLength: ${schema.minLength}`);
  if (schema.minimum !== undefined) parts.push(`minimum: ${schema.minimum}`);
  if (schema.minItems !== undefined) parts.push(`minItems: ${schema.minItems}`);
  if (schema.uniqueItems) parts.push('uniqueItems');
  if (schema.anyOf) parts.push('anyOf (siehe unten)');
  if (schema.properties) parts.push('object');
  if (schema.items) parts.push(schema.items.type === 'object' ? 'array of objects' : `array of \`${schema.items.type}\``);
  return parts.join(', ') || 'beliebig';
}

// Zerlegt ein Schema-Objekt rekursiv in eine Liste von Zeilen, die pro Key den
// Typ/Constraints und die Kinder auflisten.
function renderProperties(schema, indent = 0, path = '') {
  const lines = [];
  const required = schema.required ?? [];
  if (!schema.properties) return lines;

  for (const [key, sub] of Object.entries(schema.properties)) {
    const isRequired = required.includes(key);
    const star = isRequired ? ' *' : '';
    const desc = describeSchema(sub);
    lines.push(`${'  '.repeat(indent)}- \`${key}\`${star} — ${desc}`);

    // Kinder: Properties oder Items rekursiv
    const childSchemas = [];
    if (sub.properties) childSchemas.push({ label: '', schema: sub });
    if (sub.items?.properties) childSchemas.push({ label: 'Item:', schema: sub.items });
    if (sub.anyOf) {
      sub.anyOf.forEach((variant, i) => {
        if (variant.properties) childSchemas.push({ label: `anyOf-Variante ${i + 1}:`, schema: variant });
      });
    }

    for (const { label, schema: child } of childSchemas) {
      if (label) lines.push(`${'  '.repeat(indent + 1)}- ${label}`);
      lines.push(...renderProperties(child, label ? indent + 2 : indent + 1, path ? `${path}.${key}` : key));
    }
  }
  return lines;
}

function renderSchemaDoc(name, schema) {
  const out = [];
  out.push(`### \`${name}\``);
  out.push('');
  out.push('Top-Level-Keys (alle mit `additionalProperties: false` — keine Extra-Keys):');
  out.push('');
  const required = schema.required ?? [];
  out.push('Pflicht: ' + (required.length ? required.map(k => `\`${k}\``).join(', ') : 'keine'));
  out.push('');
  out.push(...renderProperties(schema));
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Hauptprogramm
// ---------------------------------------------------------------------------

const header = `# Schema-Dokumentation der Workflow-DSL

> Generiert aus \`scripts/dsl-schemas.mjs\` via \`node scripts/generate-schema-docs.mjs\`.
> Keys und zulässige Werte sind als JSON-Schemata im Validator definiert — hier als lesbarer
> Auszug. Normative Quelle bleibt das Schema; Änderungen gehören in \`scripts/dsl-schemas.mjs\`,
> danach das Skript erneut ausführen (\`node scripts/generate-schema-docs.mjs\`).
>
> **Legende:** \`*\` = Pflichtfeld (im \`required\`-Array). Alle Objekte sind streng — unbekannte
> Keys werden vom Validator (ajv) hart abgelehnt. Freitextfelder (\`source\`, \`description\`,
> \`reason\` …) sind bewusst locker; wo Ebene 2 (Konsistenzprüfung) semantisch prüft, steht im
> Schema nur \`${'`type: string`'}\`, damit der Befund mit Begründung aus der Prüfung kommt.

`;

const sections = Object.entries(SCHEMA_NAMES).map(([name, file]) => {
  const schema = { registrySchema, rolesSchema, statesSchema, rulesSchema, pipelineSchema }[name];
  return { heading: file, schema, doc: renderSchemaDoc(name, schema) };
});

let body = header;
for (const s of sections) {
  body += `## ${s.heading}\n\n${s.doc}\n`;
}

const fs = await import('node:fs');
if (check) {
  if (!fs.existsSync(outPath)) {
    console.error(`❌ Schema-Doku fehlt: ${outPath}`);
    process.exit(1);
  }
  const existing = fs.readFileSync(outPath, 'utf-8');
  if (existing !== body) {
    console.error(`❌ Schema-Doku nicht deckungsgleich: ${outPath} — bitte 'node scripts/generate-schema-docs.mjs' ausführen und committen.`);
    process.exit(1);
  }
  console.log(`✅ Schema-Doku deckungsgleich: ${outPath} (${body.split('\n').length} Zeilen)`);
} else {
  fs.writeFileSync(outPath, body, 'utf-8');
  console.log(`✅ Schema-Doku geschrieben: ${outPath} (${body.split('\n').length} Zeilen)`);
}
