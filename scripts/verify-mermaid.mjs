// Visuelle Verifikation von Mermaid-Diagrammen in einer HTML-Seite (lokal, nicht CI).
// Setup und Aufruf: docs/verify-setup.md
//
//   node scripts/verify-mermaid.mjs [html-datei] [--out <verzeichnis>]
//
// Prüft je .mermaid-Block: SVG gerendert, Mermaid-Error-Boxen, Bounding-Box-Kollisionen
// (Node×Node, Kantenlabel×Node, Kantenlabel×Kantenlabel, Cluster-Titel×Node), abgeschnittene
// Labels; dazu Konsolenfehler der Seite. Schreibt Screenshots und einen JSON-Report.
// Exit-Code: 0 = keine Befunde, 1 = Befunde, 2 = Setup-/Aufruf-/Laufzeitfehler.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
let input = 'docs/workflow-hochglanz.html';
const defaultOutDir = path.join(os.tmpdir(), 'verify-mermaid');
let outDir = defaultOutDir;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    if (!args[i + 1]) { console.error('--out braucht ein Verzeichnis'); process.exit(2); }
    outDir = args[++i];
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log('node scripts/verify-mermaid.mjs [html-datei] [--out <verzeichnis>]');
    process.exit(0);
  } else {
    input = args[i];
  }
}

const htmlPath = path.resolve(input);
if (!fs.existsSync(htmlPath)) { console.error(`Datei nicht gefunden: ${htmlPath}`); process.exit(2); }
// Nur der Default-Ordner gehört dem Skript und wird geleert — keine alten Screenshots im Ergebnis.
// Ein per --out übergebenes Verzeichnis bleibt unangetastet.
if (outDir === defaultOutDir) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Playwright neben dem Skript, im Arbeitsverzeichnis oder über NODE_PATH suchen
let pw;
for (const base of [import.meta.url, pathToFileURL(path.join(process.cwd(), 'noop.js')).href]) {
  const require = createRequire(base);
  for (const id of ['playwright', '@playwright/test', 'playwright-core']) {
    try { pw = require(id); break; } catch {}
  }
  if (pw) break;
}
if (!pw) {
  console.error('playwright nicht auflösbar — Setup siehe docs/verify-setup.md');
  process.exit(2);
}

let browser;
try {
  browser = await pw.chromium.launch();
} catch (e) {
  console.error(`Chromium startet nicht (npx playwright install chromium?): ${e.message}`);
  process.exit(2);
}

const consoleErrors = [];
const screenshots = [];
let diagrams;
let renderTimeout = false;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });

  // Fertig gerendert: jeder .mermaid-Block hat ein SVG mit Inhalt (Mermaid legt das SVG erst leer an)
  try {
    await page.waitForFunction(() => {
      const blocks = document.querySelectorAll('.mermaid');
      return blocks.length > 0 && [...blocks].every(b => b.querySelector('svg')?.children.length > 0);
    }, null, { timeout: 30000 });
  } catch {
    renderTimeout = true;
  }

  diagrams = await page.evaluate(() => {
    const inter = (a, b, pad = 0) =>
      a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
    // Überlappungsmaß: Breite × Höhe der Schnittfläche in px
    const overlap = (a, b) =>
      `${(Math.min(a.right, b.right) - Math.max(a.left, b.left)).toFixed(0)}x${(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)).toFixed(0)}px`;
    const out = [];
    document.querySelectorAll('.mermaid').forEach((m, idx) => {
      const svg = m.querySelector('svg');
      const r = { diagram: idx + 1, svg: !!svg, errorBoxes: 0, nodes: 0, edges: 0, edgeLabels: 0, clusters: 0,
        nodeOverlaps: [], labelNodeOverlaps: [], labelLabelOverlaps: [], clippedLabels: [], clusterTitleOverlaps: [] };
      if (!svg) { out.push(r); return; }
      // Ein Syntaxfehler = eine Error-Box: nur .error-icon zählen (.error-text gehört zur selben Box)
      r.errorBoxes = svg.querySelectorAll('.error-icon').length ||
        (svg.getAttribute('aria-roledescription') === 'error' ? 1 : 0);
      const nodes = [...svg.querySelectorAll('g.node')];
      const labels = [...svg.querySelectorAll('g.edgeLabel')].filter(l => l.textContent.trim());
      r.nodes = nodes.length; r.edges = svg.querySelectorAll('.flowchart-link').length;
      r.edgeLabels = labels.length; r.clusters = svg.querySelectorAll('g.cluster').length;
      const nb = nodes.map(n => ({ id: n.id, b: n.getBoundingClientRect() }));
      for (let i = 0; i < nb.length; i++) for (let j = i + 1; j < nb.length; j++)
        if (inter(nb[i].b, nb[j].b, 1)) r.nodeOverlaps.push(`${nb[i].id} × ${nb[j].id} (${overlap(nb[i].b, nb[j].b)})`);
      const lb = labels.map(l => ({ t: l.textContent.trim(), b: (l.querySelector('.labelBkg, span, p') || l).getBoundingClientRect() }));
      for (const l of lb) for (const n of nb)
        if (inter(l.b, n.b, 1)) r.labelNodeOverlaps.push(`${l.t} × ${n.id} (${overlap(l.b, n.b)})`);
      for (let i = 0; i < lb.length; i++) for (let j = i + 1; j < lb.length; j++)
        if (inter(lb[i].b, lb[j].b, 1)) r.labelLabelOverlaps.push(`${lb[i].t} × ${lb[j].t} (${overlap(lb[i].b, lb[j].b)})`);
      // Abgeschnittene Labels: Inhalt größer als der foreignObject-Rahmen
      svg.querySelectorAll('foreignObject').forEach(fo => {
        const inner = fo.firstElementChild; if (!inner || !inner.textContent.trim()) return;
        const f = fo.getBoundingClientRect(), c = inner.getBoundingClientRect();
        const sx = f.width / (parseFloat(fo.getAttribute('width')) || f.width || 1);
        if (inner.scrollWidth * sx > f.width + 2 || inner.scrollHeight * sx > f.height + 2 || c.width > f.width + 2 || c.height > f.height + 2)
          r.clippedLabels.push(inner.textContent.trim().slice(0, 40) + ` (${c.width.toFixed(0)}x${c.height.toFixed(0)} in ${f.width.toFixed(0)}x${f.height.toFixed(0)})`);
      });
      // Cluster-Titel dürfen keine Nodes überdecken
      svg.querySelectorAll('g.cluster').forEach(cl => {
        const t = cl.querySelector('.cluster-label'); if (!t) return;
        const tb = t.getBoundingClientRect();
        for (const n of nb) if (inter(tb, n.b, 1)) r.clusterTitleOverlaps.push(`${cl.id} × ${n.id} (${overlap(tb, n.b)})`);
      });
      out.push(r);
    });
    return out;
  });

  // Screenshots je .mermaid-Block — verify-diagram-<n> entspricht "diagram": n im Report
  const targets = await page.$$('.mermaid');
  for (let i = 0; i < targets.length; i++) {
    const p = path.join(outDir, `verify-diagram-${i + 1}.png`);
    await targets[i].screenshot({ path: p });
    screenshots.push(p);
  }
  const full = path.join(outDir, 'verify-fullpage.png');
  await page.screenshot({ path: full, fullPage: true });
  screenshots.push(full);
} catch (e) {
  console.error(`Laufzeitfehler bei der Verifikation: ${e.message}`);
  process.exitCode = 2;
} finally {
  await browser.close();
}
if (process.exitCode === 2) process.exit(2);

const findings = [];
if (diagrams.length === 0) findings.push('keine .mermaid-Blöcke gefunden');
if (renderTimeout) findings.push('Timeout: nicht alle .mermaid-Blöcke haben ein SVG gerendert');
for (const d of diagrams) {
  if (!d.svg) { findings.push(`Diagramm ${d.diagram}: kein SVG`); continue; }
  if (d.errorBoxes) findings.push(`Diagramm ${d.diagram}: ${d.errorBoxes} Error-Box(en)`);
  for (const k of ['nodeOverlaps', 'labelNodeOverlaps', 'labelLabelOverlaps', 'clippedLabels', 'clusterTitleOverlaps'])
    for (const v of d[k]) findings.push(`Diagramm ${d.diagram}: ${k}: ${v}`);
}
for (const e of consoleErrors) findings.push(`Konsolenfehler: ${e}`);

const report = { file: htmlPath, ok: findings.length === 0, findings, diagrams, consoleErrors, screenshots };
fs.writeFileSync(path.join(outDir, 'verify-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
