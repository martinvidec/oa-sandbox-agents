// Runtime-Replay (Ebene 3, Spec § 5.5 — umgesetzt mit Issue #60):
// Nachträglich maschinell nachprüfen, dass ein gemergter Zyklus regelkonform gelaufen ist —
// nicht nur, dass die DSL-Dateien wohlgeformt sind (das prüft scripts/validate-workflow.mjs,
// Ebene 1–2), sondern dass die tatsächliche Ausführung den Regeln aus rules.yaml entspricht.
//
//   node scripts/replay-workflow.mjs <pr-nr> [--json] [--no-local] [--root <verzeichnis>] [--selftest]
//
// Datenquellen (ausschließlich lesend — der Replay schreibt nichts auf GitHub):
//   gh pr view <n> --json …                      — PR-Metadaten (Body, Merge-Actor, Branch)
//   gh api repos/<owner>/<repo>/issues/<n>/timeline — PR-Timeline: Kommentare, `ready_for_review`,
//                                                  `merged` (Merge-Actor!) inkl. Zeitstempeln
//   gh api repos/<owner>/<repo>/issues/<issue>/timeline — Label-Zustandsübergänge des gebundenen
//                                                  Issues (Labels hängen am Issue, nicht am PR)
//   git worktree list / git branch --list (lokal) — Ist-Zustand für `cleanup_after_merge`
//
// Subsumtion: Nur Regeln mit `runtime_checkable: true` (rules.yaml) werden geprüft; alle
// übrigen erscheinen als `nicht-pruefbar`-Befunde — ehrliche Lücke statt stiller Skip. Auch
// innerhalb prüfbarer Regeln bleiben einzelne Komponenten unerheblich unerreichbar (historische
// Draft-Status, gelöschte Worktrees/Branches) und werden einzeln als Lücke deklariert, nie als
// Annahme gefüllt.
//
// Befundmodell wie der Validator: { id, severity, rule, code, message } mit
//   severity 'fehler'        — Regelverstoß belegt (exit 1)
//   severity 'warnung'       — Hinweis ohne harten Verstoß (exit 0 bleibt)
//   severity 'nicht-pruefbar'— deklarierte Lücke samt Begründung
// Bestandene Subsumtionen laufen separat unter `bestanden` (mit Vorbehalt vermerkt, wo der
// Beleg nur im Ist-Zustand statt zum Ereigniszeitpunkt gilt).
//
// Exit-Code: 0 = keine Fehler (Warnungen und Lücken erlaubt), 1 = Fehler gefunden,
//            2 = Setup-, Aufruf- oder Laufzeitfehler.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- Argumente
const args = process.argv.slice(2);
let root = process.cwd();
let prNr = null;
let jsonOut = false;
let selftestOnly = false;
let localChecks = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') {
    if (!args[i + 1]) { console.error('--root braucht ein Verzeichnis'); process.exit(2); }
    root = path.resolve(args[++i]);
  } else if (args[i] === '--json') {
    jsonOut = true;
  } else if (args[i] === '--format') {
    const f = args[++i];
    if (f === 'json') jsonOut = true;
    else if (f !== 'human') { console.error(`unbekanntes Format: ${f}`); process.exit(2); }
  } else if (args[i] === '--no-local') {
    localChecks = false;
  } else if (args[i] === '--selftest') {
    selftestOnly = true;
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/replay-workflow.mjs <pr-nr> [--json] [--no-local] [--root <verzeichnis>] [--selftest]');
    process.exit(0);
  } else if (prNr === null && /^\d+$/.test(args[i])) {
    prNr = Number(args[i]);
  } else {
    console.error(`unbekanntes Argument: ${args[i]}`);
    process.exit(2);
  }
}
if (!selftestOnly && prNr === null) {
  console.error('Aufruf: node scripts/replay-workflow.mjs <pr-nr> [--json] [--no-local] [--root <verzeichnis>] [--selftest]');
  process.exit(2);
}

// Module wie im Validator: js-yaml/ajv neben dem Skript, im Arbeitsverzeichnis oder über
// NODE_PATH — kein Install im Repo (AGENTS.md D2).
function resolveModule(id) {
  for (const base of [import.meta.url, pathToFileURL(path.join(process.cwd(), 'noop.js')).href]) {
    try { return createRequire(base)(id); } catch {}
  }
  return null;
}

// ---------------------------------------------------------------- DSL laden
// Gebundener Workflow laut registry.yaml (genau ein Eintrag mit `active: true`); aus states.yaml
// kommt die erwartete Label-Sequenz, aus rules.yaml die Runtime-Prüfbarkeit je Regel.
function ladeDsl(root) {
  const yamlMod = resolveModule('js-yaml');
  if (!yamlMod) {
    console.error('js-yaml nicht auflösbar — Setup siehe docs/validate-setup.md');
    process.exit(2);
  }
  const YAML = yamlMod.default ?? yamlMod;
  const lese = rel => YAML.load(fs.readFileSync(path.join(root, rel), 'utf8'));
  const registry = lese('workflow/registry.yaml');
  const aktiv = (registry.workflows ?? []).filter(w => w.active);
  if (aktiv.length !== 1) { console.error('registry.yaml: genau ein Eintrag mit `active: true` erwartet'); process.exit(2); }
  const instanz = `workflow/${aktiv[0].id}`;
  return {
    id: aktiv[0].id,
    rules: lese(`${instanz}/rules.yaml`),
    states: lese(`${instanz}/states.yaml`),
  };
}

// Erwartete Zustandssequenz des Normalzyklus: aus der Label-Tabelle von states.yaml gelesen
// (Reihenfolge der Tabelle = aufsteigender Pipeline-Pfad), abgeschlossen durch den Endzustand.
function erwarteteSequenz(states) {
  const reihe = (states.label_table ?? [])
    .map(row => row.label ?? states.states.find(s => s.id === row.states[0])?.label)
    .filter(l => l && !l.includes('/')); // Sammelzeilen (blocked/needs-human) sind keine Pflichtstation
  return reihe;
}

// ---------------------------------------------------------------- Sequenz aus der Timeline
// Label-Zuordnung Label → Zustands-ID (AGENTS.md-Label-Tabelle, in states.yaml verdrahtet).
const LABEL_ZU_ZUSTAND = {
  'agent:ready': 'ready',
  'agent:in-progress': 'in_progress',
  'agent:review': 'review',
  'needs-human': 'needs_human',
  'blocked': 'blocked',
};

// Rein: Label-Ereignisse aus beliebig vielen Timelines einsammeln, nach Zeitstempel sortiert.
export function extrahiereLabelEreignisse(timelines) {
  const ereignisse = [];
  for (const liste of timelines) {
    for (const e of liste ?? []) {
      if (e.event !== 'labeled' && e.event !== 'unlabeled') continue;
      const name = e.label?.name;
      if (!name || !(name in LABEL_ZU_ZUSTAND)) continue;
      ereignisse.push({ ereignis: e.event, label: name, zustand: LABEL_ZU_ZUSTAND[name], at: e.created_at, actor: e.actor?.login ?? null });
    }
  }
  ereignisse.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return ereignisse;
}

// Rein: die tatsächlich gelaufene Zustandssequenz — Label-Ereignisse (nur letztes je Zustand)
// plus der Merge als Übergang in den Endzustand.
export function baueSequenz(labelEreignisse, mergedAt, endZustand) {
  const seq = [];
  const gesehen = new Map();
  for (const e of labelEreignisse) {
    if (e.ereignis === 'unlabeled') continue; // Rücknahmen bleiben in den Rohdaten sichtbar
    if (gesehen.has(e.zustand)) continue;     // erste Setzung des Zustands zählt
    gesehen.set(e.zustand, e.at);
    seq.push({ zustand: e.zustand, label: e.label, at: e.at, actor: e.actor, via: 'labeled' });
  }
  if (mergedAt) {
    seq.push({ zustand: endZustand, label: null, at: mergedAt, actor: null, via: 'merged' });
    seq.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return seq;
}

// ---------------------------------------------------------------- Subsumtion
const CI_BELEG_MUSTER = /CI gr|conclusion\s*[:=]?\s*success|Run\s+\d+/i;

// Rein: Subsumtion aller runtime_checkable-Regeln gegen die beobachteten Daten.
// `pr` = PR-Metadaten; `prTimeline`/`issueTimeline` = Timeline-Arrays; `local` =
// { verfuegbar, worktrees:[], branches:[] }; `regeln` = rules.rules aus rules.yaml;
// `endZustand` = done_state aus states.yaml.
export function subsumiere({ pr, prTimeline, issueTimeline, local, regeln, endZustand, erwarteteKette }) {
  const befunde = [];
  const bestanden = [];
  const add = (severity, rule, code, message) => befunde.push({ id: `RP-${befunde.length + 1}`, severity, rule, code, message });
  const ok = (rule, code, message) => bestanden.push({ rule, code, message });

  const regel = id => regeln.find(r => r.id === id);
  const timelines = [prTimeline ?? [], issueTimeline ?? []];
  const kommentare = timelines.flatMap(tl => tl.filter(e => e.event === 'commented' && e.body));
  const labelEreignisse = extrahiereLabelEreignisse(timelines);
  const reviewLabel = labelEreignisse.find(e => e.ereignis === 'labeled' && e.label === 'agent:review');
  const inProgressLabel = labelEreignisse.find(e => e.ereignis === 'labeled' && e.label === 'agent:in-progress');
  const readyLabel = labelEreignisse.find(e => e.ereignis === 'labeled' && e.label === 'agent:ready');
  const mergedEvent = (prTimeline ?? []).find(e => e.event === 'merged');
  const merged = !!(pr.mergedAt || mergedEvent);

  // --- D1_merge_by_human: Merge-Actor (partiell prüfbar)
  const mergeActor = mergedEvent?.actor ?? (pr.mergedBy ? { login: pr.mergedBy.login, is_bot: !!pr.mergedBy.is_bot } : null);
  if (merged && mergeActor) {
    if (mergeActor.is_bot) {
      add('fehler', 'D1_merge_by_human', 'merge-actor-bot', `Merge-Actor \`${mergeActor.login}\` ist ein Bot-Account — gemergt wurde maschinell (D1 — Merge nur durch Martin).`);
    } else {
      ok('D1_merge_by_human', 'merge-actor-gelesen', `Merge-Actor: \`${mergeActor.login}\` (kein Bot). Die Rollenzuordnung human vs. Agent-Rolle ist aus der API ohne Login-Mapping nicht ableitbar — als Komponente deklarierte Lücke, s. nicht-pruefbar.`);
      add('nicht-pruefbar', 'D1_merge_by_human', 'merge-actor-rolle', `Ob \`${mergeActor.login}\` als human oder als Agent-Rolle gilt, ist aus den GitHub-Daten nicht ableitbar (keine Login→Rolle-Zuordnung in der DSL); beobachtet ist allein der Account.`);
    }
  } else if (!merged) {
    add('warnung', 'D1_merge_by_human', 'nicht-gemergt', 'PR ist (noch) nicht gemergt — der Runtime-Replay ist ein post-merge-Prüfer; gegen einen offenen PR entsteht kein vollständiger Bericht.');
  } else {
    add('nicht-pruefbar', 'D1_merge_by_human', 'merge-actor-fehlt', 'Kein `merged`-Event und kein `mergedBy` in den Daten — der Merge-Actor ist nicht belegt.');
  }

  // --- D3_one_issue_per_pr: Closes-Zählung im PR-Body
  const closesForm = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const closes = [...(pr.body ?? '').matchAll(closesForm)].map(m => m[1]);
  if (closes.length === 1) {
    ok('D3_one_issue_per_pr', 'closes-genau-eins', `PR-Body nennt genau ein \`Closes #${closes[0]}\`.`);
  } else {
    add('fehler', 'D3_one_issue_per_pr', 'closes-zaehlung', `PR-Body nennt ${closes.length} \`Closes #N\`-Formen — D3 verlangt genau eine (Closes: ${closes.map(n => `#${n}`).join(', ') || 'keine'}).`);
  }

  // --- D4_review_label_needs_evidence: CI-Beleg vor dem agent:review-Label (partiell prüfbar)
  if (reviewLabel) {
    const beleg = kommentare
      .filter(c => !reviewLabel.at || String(c.created_at) <= String(reviewLabel.at))
      .some(c => CI_BELEG_MUSTER.test(c.body));
    if (beleg) {
      ok('D4_review_label_needs_evidence', 'ci-beleg-vor-review', 'Vor dem `agent:review`-Label liegt ein Kommentar mit CI-Beleg (Run-ID/conclusion).');
    } else {
      add('fehler', 'D4_review_label_needs_evidence', 'ci-beleg-fehlt', 'Beim Setzen von `agent:review` lag kein Kommentar mit CI-Beleg (Run-ID, `conclusion success`) vor — D4 verlangt den Beleg am PR.');
    }
    // Zweite assert-Komponente: Draft-Status zum Label-Zeitpunkt ist historisch nicht rekonstruierbar.
    add('nicht-pruefbar', 'D4_review_label_needs_evidence', 'draft-status-historisch', 'Der Draft-Status des PRs zum Zeitpunkt des `agent:review`-Labels ist aus der Timeline nicht rekonstruierbar (`ready_for_review` belegt die Rückkehr, nicht den Zustand bei jedem Label-Ereignis).');
  } else {
    add('nicht-pruefbar', 'D4_review_label_needs_evidence', 'kein-review-label', 'Kein `agent:review`-Label-Ereignis in der Timeline — die Belegpflicht ließ sich dem Zeitpunkt nicht zuordnen.');
  }

  // --- cleanup_after_merge: lokaler Ist-Zustand nach dem Merge (partiell prüfbar)
  if (merged) {
    const closesNr = closes.length === 1 ? closes[0][1] : null;
    const slug = pr.headRefName ? pr.headRefName.replace(/^(feat|fix|docs)\//, '') : null;
    if (!local.verfuegbar) {
      add('nicht-pruefbar', 'cleanup_after_merge', 'lokal-nicht-lesbar', 'Lokaler Git-Zustand nicht lesbar (--no-local) — Worktree-/Branch-Reste sind nicht geprüft.');
    } else if (!slug) {
      add('nicht-pruefbar', 'cleanup_after_merge', 'branch-unbekannt', 'Head-Branch des PRs nicht belegt — der Cleanup kann keinem Worktree-/Branch-Namen zugeordnet werden.');
    } else {
      const worktreeRest = local.worktrees.filter(w => w.includes(slug));
      const branchRest = local.branches.filter(b => b === pr.headRefName || b.endsWith(`/${slug}`));
      if (worktreeRest.length === 0 && branchRest.length === 0) {
        ok('cleanup_after_merge', 'cleanup-sauber', `Kein Worktree- und kein Branch-Rest zu \`${pr.headRefName}\` (Zeitpunkt der Entfernung nicht belegbar — Bestehen im Ist-Zustand, s. check_hint).`);
      } else {
        add('fehler', 'cleanup_after_merge', 'cleanup-rest', `Cleanup-Reste nach dem Merge: ${[...worktreeRest, ...branchRest].map(r => `\`${r}\``).join(', ')} — Worktree und lokaler Branch sollten entfernt sein (Closes-Issue: ${closesNr ? `#${closesNr}` : 'unbekannt'}).`);
      }
    }
  } else {
    add('nicht-pruefbar', 'cleanup_after_merge', 'cleanup-vor-merge', 'Ohne Merge kein Cleanup-Anlass — die Regel hängt am Trigger `pr_merged`.');
  }

  // --- Zustandssequenz gegen die erwartete Kette aus states.yaml
  if (merged) {
    if (!readyLabel) add('warnung', 'zustandssequenz', 'ready-fehlt', 'Kein `agent:ready`-Label-Ereignis — der Start der Sequenz ist nicht belegt (historische PRs können vor der Label-Ära liegen).');
    if (reviewLabel && inProgressLabel && String(inProgressLabel.at) > String(reviewLabel.at)) {
      add('fehler', 'zustandssequenz', 'label-sequenz', `\`agent:in-progress\` (${inProgressLabel.at}) liegt nach \`agent:review\` (${reviewLabel.at}) — die erwartete Kette ist ${erwarteteKette.join(' → ')}.`);
    } else if (reviewLabel && !inProgressLabel) {
      add('fehler', 'zustandssequenz', 'label-sequenz', '`agent:review` ohne vorangegangenes `agent:in-progress` — der Delegierungs-Übergang (`delegate`) ist in der Timeline nicht belegt.');
    }
    const mergedAt = mergedEvent?.created_at ?? pr.mergedAt ?? null;
    if (reviewLabel && mergedAt && String(mergedAt) < String(reviewLabel.at)) {
      add('fehler', 'zustandssequenz', 'merge-ohne-review', `Merge (${mergedAt}) liegt vor dem \`agent:review\`-Label (${reviewLabel.at}) — der Merge-Übergang verlangt den review-Zustand.`);
    } else if (!reviewLabel && merged) {
      add('fehler', 'zustandssequenz', 'merge-ohne-review', 'Merge ohne vorangegangenes `agent:review`-Label — der review-Zustand ist in der Timeline nicht belegt.');
    }
  }

  // --- Deklarierte Lücken: jede nicht runtime-checkable Regel erscheint explizit.
  for (const r of regeln) {
    if (r.runtime_checkable === false) {
      add('nicht-pruefbar', r.id, 'regel-nicht-runtime-pruefbar', `Regel \`${r.id}\` ist als \`runtime_checkable: false\` deklariert — der Replay subsumiert sie nicht (${r.check_hint ? 'unerwartet check_hint gesetzt' : 'keine Laufzeit-Prüfform deklariert'}).`);
    }
  }

  return { befunde, bestanden, labelEreignisse };
}

// ---------------------------------------------------------------- Report
function bericht(pr, seq, sub, dsl) {
  const fe = sub.befunde.filter(b => b.severity === 'fehler');
  const wa = sub.befunde.filter(b => b.severity === 'warnung');
  const np = sub.befunde.filter(b => b.severity === 'nicht-pruefbar');
  return {
    pr: { number: pr.number, title: pr.title, url: pr.url, state: pr.state, merged_at: pr.mergedAt ?? null, merged_by: pr.mergedBy?.login ?? null, head_branch: pr.headRefName ?? null },
    workflow: dsl.id,
    sequence: seq,
    findings: sub.befunde,
    bestanden: sub.bestanden,
    summary: { fehler: fe.length, warnung: wa.length, nicht_pruefbar: np.length, bestanden: sub.bestanden.length },
  };
}

function humanBericht(r) {
  const z = [];
  z.push(`Runtime-Replay — PR #${r.pr.number} „${r.pr.title}” (${r.pr.state})`);
  z.push(`  URL: ${r.pr.url}`);
  z.push(`  Workflow: ${r.workflow} · gemergt: ${r.pr.merged_at ?? '—'} · Merge-Actor: ${r.pr.merged_by ?? '—'}`);
  z.push('');
  z.push('Gelaufene Zustandssequenz (aus Label-Ereignissen + Merge):');
  for (const s of r.sequence) {
    z.push(`  ${String(s.at ?? '—').padEnd(22)} ${s.zustand.padEnd(12)} ← ${s.via === 'merged' ? 'merged-Event' : `${s.label} (${s.actor ?? '?'})`}`);
  }
  if (r.sequence.length === 0) z.push('  (keine Zustandsübergänge beobachtet)');
  z.push('');
  z.push(`Befunde (${r.summary.fehler} Fehler, ${r.summary.warnung} Warnungen, ${r.summary.nicht_pruefbar} nicht-prüfbar, ${r.summary.bestanden} bestanden):`);
  for (const b of r.findings) z.push(`  [${b.severity.toUpperCase()}] ${b.rule} — ${b.code}: ${b.message}`);
  for (const b of r.bestanden) z.push(`  [BESTANDEN] ${b.rule} — ${b.code}: ${b.message}`);
  if (r.findings.length === 0 && r.bestanden.length === 0) z.push('  (keine Subsumtionen möglich)');
  return z.join('\n');
}

// ---------------------------------------------------------------- GitHub-/Git-Zugriff (lesend)
function ghJson(argv, root) {
  const out = execFileSync('gh', argv, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
function ghTimeline(nr, repo, root) {
  // Timeline als JSON: `gh api` mit Pagination per --paginate; einzeln geparst wird die
  // Gesamtliste — `gh api --paginate` gibt ein JSON-Array pro Seite zurück, gh faltet das
  // zu einem Array zusammen (seit gh 2.x). Sicherheitshalber Array-in-Array flachen.
  const raw = execFileSync('gh', ['api', `repos/${repo}/issues/${nr}/timeline`, '--paginate'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const ganzes = JSON.parse(raw);
    return Array.isArray(ganzes) ? ganzes.flat() : [];
  } catch {
    // Mehrere JSON-Arrays hintereinander (ältere gh-Versionen) — per NDJSON-Heuristik flachen.
    const teile = raw.split('][').map((t, i) => (i === 0 ? t : '[' + t));
    const flach = [];
    for (let t of teile) {
      try { flach.push(...JSON.parse(t.endsWith(']') ? t : t + ']')); } catch {}
    }
    return flach;
  }
}
function lokalerZustand(root) {
  if (!localChecks) return { verfuegbar: false, worktrees: [], branches: [] };
  try {
    const wtRaw = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const worktrees = wtRaw.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length));
    const brRaw = execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: root, encoding: 'utf8' });
    const branches = brRaw.split('\n').map(s => s.trim()).filter(Boolean);
    return { verfuegbar: true, worktrees, branches };
  } catch (e) {
    return { verfuegbar: false, worktrees: [], branches: [] };
  }
}
function repoSlug(root) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- Selbsttest
// Die Selbsttest-Fälle liegen als Fixtures in scripts/test-fixtures/replay/ — jede Datei
// beschreibt einen vollständigen Replay-Eingangsdatensatz (PR, Timelines, lokaler Zustand,
// Miniatur-Regeln) samt erwarteter Befund-Codes. Damit bleibt die Prüflogik rein (die
// Subsumtionsfunktion weiß nichts von `gh`/`git`) und die Fälle sind ohne Netz lauffähig —
// dieselbe Struktur wie die Selbsttest-Fälle des Validators (Melder + Gegenrichtung).
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures', 'replay');

function laufeSelftest() {
  const falle = [];
  for (const datei of fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json')).sort()) {
    falle.push(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, datei), 'utf8')));
  }
  let fehler = 0;
  for (const fall of falle) {
    const sub = subsumiere(fall);
    const gefunden = sub.befunde.filter(b => b.severity === 'fehler' || b.severity === 'warnung').map(b => b.code);
    const erwartet = fall.expect_codes ?? [];
    const deckungsgleich = gefunden.length === erwartet.length && [...erwartet].sort().join('|') === [...gefunden].sort().join('|');
    if (!deckungsgleich) {
      fehler++;
      console.error(`Selbsttest FALL "${fall.id}": erwartet [${erwartet.join(', ')}], gefunden: [${gefunden.join(', ')}]`);
    }
  }
  return { faelle: falle.length, fehler };
}

// ---------------------------------------------------------------- Hauptlauf
if (selftestOnly) {
  const { faelle, fehler } = laufeSelftest();
  if (jsonOut) {
    console.log(JSON.stringify({ selftest: { faelle, fehler, ok: fehler === 0 } }, null, 2));
  } else {
    console.log(`Runtime-Replay Selbsttest: ${faelle - fehler}/${faelle} Fälle wie erwartet`);
  }
  process.exit(fehler === 0 ? 0 : 1);
}

const dsl = ladeDsl(root);
const endZustand = dsl.states.invariants?.done_state ?? 'done';
const kette = erwarteteSequenz(dsl.states);
const repo = repoSlug(root);
if (!repo) { console.error('origin-Remote nicht lesbar — Repo-Slug unbekannt'); process.exit(2); }

let pr;
try {
  pr = ghJson(['pr', 'view', String(prNr), '--repo', repo, '--json', 'number,title,state,isDraft,mergedAt,mergedBy,author,headRefName,baseRefName,body,url'], root);
} catch (e) {
  console.error(`gh pr view ${prNr} fehlgeschlagen: ${e.message}`);
  process.exit(2);
}
const closesNr = ((pr.body ?? '').match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i) ?? [])[1];
let prTimeline = [];
let issueTimeline = [];
try {
  prTimeline = ghTimeline(prNr, repo, root);
  if (closesNr) issueTimeline = ghTimeline(closesNr, repo, root);
} catch (e) {
  console.error(`gh api timeline fehlgeschlagen: ${e.message}`);
  process.exit(2);
}
const local = lokalerZustand(root);

const labelEreignisse = extrahiereLabelEreignisse([prTimeline, issueTimeline]);
const seq = baueSequenz(labelEreignisse, pr.mergedAt, endZustand);
const sub = subsumiere({ pr, prTimeline, issueTimeline, local, regeln: dsl.rules.rules ?? [], endZustand, erwarteteKette: kette });
const report = bericht(pr, seq, sub, dsl);

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(humanBericht(report));
}
process.exit(report.summary.fehler > 0 ? 1 : 0);
