// Gemeinsamer Kern der Workflow-Generierung: baut die generierten Fragmente für WORKFLOW.md
// und den aktiv-Block für AGENTS.md aus der DSL und vergleicht generiert gegen eingecheckt.
// Benutzt von scripts/render-workflow.mjs (CLI) und scripts/validate-workflow.mjs (Checks).
//
// Die Tabellen-Anteile stammen aus dem früheren scripts/render-agents.mjs — der Vergleich ist
// mit derselben Whitespace-Toleranz gebaut (Zellen getrimmt, Trennzeile normalisiert), der
// Zelltext selbst muss zeichengenau übereinstimmen.

// Zelltext aus der DSL: Ein `|` würde die Tabellenspalte sprengen und beim Vergleich als
// zusätzliche Zelle auftauchen — es wird escaped, Zeilenumbrüche werden zu Leerzeichen.
// Ein bereits escaptes `\|` bleibt, wie es ist.
export const zellText = wert => String(wert).replace(/\s*[\r\n]+\s*/g, ' ').replace(/(?<!\\)\|/g, '\\|');
const zeile = zellen => `| ${zellen.join(' | ')} |`;
const tabelle = (kopf, reihen) => [zeile(kopf), `|${kopf.map(() => '---').join('|')}|`, ...reihen.map(r => zeile(r.map(zellText)))].join('\n');

export function rollenTabelle(roles) {
  return tabelle(['Rolle', 'Realisierung', 'Scope'],
    roles.roles.map(r => [`**${r.name}**`, r.realization, r.scope]));
}

export function labelTabelle(states) {
  const byId = new Map(states.states.map(s => [s.id, s]));
  const reihen = states.label_table.map(row => {
    const erster = byId.get(row.states[0]);
    if (!erster) throw new Error(`label_table verweist auf unbekannten Zustand: ${row.states[0]}`);
    // Sammelzeilen tragen ihre Felder selbst, Einzelzeilen erben sie vom Zustand.
    const label = row.label ?? `\`${erster.label}\``;
    const setBy = row.set_by ?? erster.set_by;
    const trigger = row.trigger ?? erster.trigger;
    if (!label || !setBy || !trigger) throw new Error(`label_table-Zeile unvollständig: ${row.states.join(', ')}`);
    return [label, setBy, trigger];
  });
  return tabelle(['Label', 'wird gesetzt von', 'Auslöser'], reihen);
}

// Übergänge samt Owner, Auslöser und Belegen; darunter die Invarianten als Zeilen.
export function uebergaengeTabelle(states) {
  const reihen = states.transitions.map(t => {
    return [
      `\`${t.id}\``,
      `\`${t.from}\` → \`${t.to}\``,
      `\`${t.owner}\`${t.owner_fallback ? ` (Fallback: \`${t.owner_fallback}\`)` : ''}`,
      t.trigger,
      t.requires?.length ? t.requires.map(f => `\`${f}\``).join(', ') : '—',
      t.directive ? `\`${t.directive}\`` : (t.source ?? '—'),
    ];
  });
  const inv = states.invariants;
  const invarianten = [
    `\`max_review_loops\`: ${inv.max_review_loops} (Schleifenübergang \`${inv.loop_transition}\`, Ausstieg \`${inv.loop_escape}\`)`,
    `\`done_state\`: \`${inv.done_state}\`, nur über Übergänge mit Owner \`${inv.done_by}\`, requires: ${inv.done_requires.map(f => `\`${f}\``).join(', ')}`,
  ].map(l => `- ${l}`);
  return `${tabelle(['Übergang', 'von → nach', 'Owner', 'Auslöser', 'requires', 'Beleg'], reihen)}\n\nInvarianten:\n\n${invarianten.join('\n')}`;
}

// Regeln (D1–D8 als prüfbare Invarianten) und die dokumentierten Konventionen.
const assertText = a => {
  if (a.fact !== undefined) {
    const op = a.operator;
    const operand = a.value !== undefined ? ` = ${zellText(a.value)}` : a.values !== undefined ? ` ∈ [${a.values.map(zellText).join(', ')}]` : '';
    return `\`${a.fact}\` ${op}${operand}`;
  }
  const zweig = a.all_of ? 'all_of' : 'any_of';
  return `${zweig}: ${a[zweig].map(assertText).join(' ∧ ')}`;
};
export function regelnTabelle(rules) {
  const reihen = rules.rules.map(r => [
    `\`${r.id}\``,
    r.directive ?? '—',
    `\`${r.on}\``,
    assertText(r.assert),
    `\`${r.check}\``,
    r.remedy,
  ]);
  const konventionen = (rules.documented_conventions ?? []).map(k =>
    `- \`${k.id}\`${k.directive ? ` (${k.directive})` : ''}: ${k.convention} — *nicht prüfbar:* ${k.why_not_checkable}`);
  return `${tabelle(['Regel', 'Direktive', 'on', 'assert', 'check', 'remedy'], reihen)}\n\nDokumentierte Konventionen (bewusst keine Regel mit weichem \`assert\`):\n\n${konventionen.join('\n')}`;
}

// Pipeline-Schritte mit pre-/postconditions. Die Bedingungen werden in kompakter Form
// aufgeschlüsselt — jede Form nennt ihren Typ, damit der Bezug zur DSL lesbar bleibt.
const bedingungText = b => {
  if (b.label_check) return `label_check: \`${b.label_check.state}\` ${b.label_check.present ? 'gesetzt' : 'nicht gesetzt'}`;
  if (b.actor_check) return `actor_check: \`${b.actor_check.role}\``;
  if (b.ci_check) return `ci_check: \`${b.ci_check.conclusion}\``;
  if (b.fact_check) return `fact_check: \`${b.fact_check.fact}\` = ${b.fact_check.expected}`;
  return zellText(JSON.stringify(b));
};
export function pipelineTabelle(pipeline) {
  const reihen = pipeline.steps.map(s => [
    `\`${s.id}\` — ${s.name}`,
    s.actor === 'human' ? '**Martin**' : `\`${s.actor}\``,
    `${s.delegated ? 'delegiert, ' : ''}\`${s.workdir}\``,
    `\`${s.state_before}\` → \`${s.state_after}\``,
    s.description,
    (s.preconditions ?? []).map(bedingungText).join('; ') || '—',
    (s.postconditions ?? []).map(bedingungText).join('; ') || '—',
    s.rules?.length ? s.rules.map(r => `\`${r}\``).join(', ') : '—',
    s.next?.length ? s.next.map(n => `\`${n}\``).join(', ') : '—',
  ]);
  return tabelle(['Schritt', 'Akteur', 'Ausführung', 'Zustand', 'Beschreibung', 'preconditions', 'postconditions', 'rules', 'next'], reihen);
}

// Alle Fragmente für WORKFLOW.md. Reihenfolge = Reihenfolge der Abschnitte in WORKFLOW.md.
export function workflowFragmente(dsl) {
  const { roles, states, rules, pipeline } = dsl;
  return [
    { id: 'roles-table', titel: 'Rollen-Tabelle', quelle: 'roles.yaml', text: rollenTabelle(roles) },
    { id: 'label-table', titel: 'Label-Tabelle', quelle: 'states.yaml', text: labelTabelle(states) },
    { id: 'transitions-table', titel: 'Übergänge und Invarianten', quelle: 'states.yaml', text: uebergaengeTabelle(states) },
    { id: 'rules-table', titel: 'Regeln und Konventionen', quelle: 'rules.yaml', text: regelnTabelle(rules) },
    { id: 'pipeline-steps', titel: 'Pipeline-Schritte', quelle: 'pipeline.yaml', text: pipelineTabelle(pipeline) },
  ];
}

// Der aktiv-Block für AGENTS.md — genau eine Zeile, der Verweis auf WORKFLOW.md.
export function aktiverBlock(registry) {
  const aktiv = registry.workflows.find(w => w.active);
  return `Aktiver Workflow: \`${aktiv.id}\` → Details in [WORKFLOW.md](WORKFLOW.md)`;
}

export function markerBereich(text, id) {
  const start = `<!-- dsl:${id}:start -->`;
  const ende = `<!-- dsl:${id}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(ende);
  if (a === -1 || b === -1 || b < a) return null;
  return { start, ende, von: a + start.length, bis: b };
}

// Whitespace-Toleranz: Zeilen trimmen, Leerzeilen ignorieren, Tabellenzellen trimmen,
// Trennzeilen auf `---` normalisieren. Der Zelltext selbst wird nicht angefasst.
export function normalisiere(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    if (!l.startsWith('|')) return l;
    const zellen = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (zellen.every(c => /^:?-{2,}:?$/.test(c))) return zellen.map(() => '---').join('|');
    return zellen.join(' | ');
  }).join('\n');
}

// Vergleicht die generierten Fragmente gegen einen eingecheckten Markdown-Text.
// Ergebnis: Liste von Befunden `{ titel, message }` — leer heißt deckungsgleich.
export function pruefeGenerierte(text, fragmente) {
  const befunde = [];
  for (const f of fragmente) {
    const bereich = markerBereich(text ?? '', f.id);
    if (!bereich) {
      befunde.push({ titel: f.titel, message: `Marker \`<!-- dsl:${f.id}:start -->\` / \`<!-- dsl:${f.id}:end -->\` fehlen` });
      continue;
    }
    const eingecheckt = text.slice(bereich.von, bereich.bis);
    if (normalisiere(eingecheckt) === normalisiere(f.text)) continue;
    befunde.push({ titel: f.titel, message: `weicht vom generierten Stand ab (Quelle: ${f.quelle})` });
  }
  return befunde;
}
