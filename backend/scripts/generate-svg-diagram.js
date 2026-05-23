/**
 * Generates a standalone SVG use case diagram.
 * No external dependencies — pure Node.js.
 *
 * Usage:
 *   node scripts/generate-svg-diagram.js [output.svg]
 *
 * Default output: <repo-root>/use_case_diagram.svg
 * Open in any browser, Inkscape, Figma, or draw.io (Extras > Edit Diagram).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── SVG escape ────────────────────────────────────────────────────────────────
const esc = s =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── Text wrap ─────────────────────────────────────────────────────────────────
function wrap(text, maxChars) {
  const words  = text.split(' ');
  const lines  = [];
  let   curr   = '';
  for (const w of words) {
    const next = curr ? `${curr} ${w}` : w;
    if (next.length > maxChars && curr) { lines.push(curr); curr = w; }
    else curr = next;
  }
  if (curr) lines.push(curr);
  return lines;
}

// ── SVG element builders ──────────────────────────────────────────────────────
function pkg(x, y, w, h, title, accent) {
  const HDR = 28;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#f8f9fa" stroke="${accent}" stroke-width="1.5"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${HDR}" rx="7" fill="${accent}" opacity="0.18"/>`,
    `<rect x="${x}" y="${y+HDR-4}" width="${w}" height="4" fill="${accent}" opacity="0.18"/>`,
    `<text x="${x+w/2}" y="${y+HDR/2+5}" text-anchor="middle" font-size="11.5" font-weight="700"`,
    `      font-family="Arial,sans-serif" fill="#2d3748">${esc(title)}</text>`,
  ].join('\n');
}

function usecase(cx, cy, rx, ry, label) {
  const lines   = wrap(label, Math.floor((rx * 2 - 10) / 6.5));
  const lineH   = 13;
  const startY  = cy - ((lines.length - 1) * lineH) / 2;
  const tspans  = lines.map((l, i) =>
    `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${esc(l)}</tspan>`
  ).join('');
  return [
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"`,
    `         fill="#fffdf0" stroke="#d4a800" stroke-width="1.5"/>`,
    `<text x="${cx}" y="${startY}" text-anchor="middle" dominant-baseline="middle"`,
    `      font-size="10" font-family="Arial,sans-serif" fill="#2d3748">${tspans}</text>`,
  ].join('\n');
}

function actor(x, y, label, fill, stroke) {
  const cx = x + 20;
  const lines  = wrap(label, 13);
  const labelY = y + 68;
  const tspans = lines.map((l, i) =>
    `<tspan x="${cx}" dy="${i === 0 ? 0 : 13}">${esc(l)}</tspan>`
  ).join('');
  return [
    `<circle cx="${cx}" cy="${y+10}" r="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
    `<line x1="${cx}" y1="${y+20}" x2="${cx}" y2="${y+44}" stroke="${stroke}" stroke-width="1.5"/>`,
    `<line x1="${cx-14}" y1="${y+29}" x2="${cx+14}" y2="${y+29}" stroke="${stroke}" stroke-width="1.5"/>`,
    `<line x1="${cx}" y1="${y+44}" x2="${cx-12}" y2="${y+62}" stroke="${stroke}" stroke-width="1.5"/>`,
    `<line x1="${cx}" y1="${y+44}" x2="${cx+12}" y2="${y+62}" stroke="${stroke}" stroke-width="1.5"/>`,
    `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="11"`,
    `      font-family="Arial,sans-serif" fill="#2d3748">${tspans}</text>`,
  ].join('\n');
}

function edge(x1, y1, x2, y2, type, label) {
  const dash   = (type === 'include' || type === 'extend') ? 'stroke-dasharray="6 4"' : '';
  const color  = type === 'assoc' ? '#aaaaaa' : '#777777';
  const marker = type === 'assoc'   ? '' :
                 type === 'general' ? 'marker-end="url(#arrowBlock)"' :
                                      'marker-end="url(#arrowOpen)"';
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 5;
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`,
    `      stroke="${color}" stroke-width="1.2" ${dash} ${marker}/>`,
    label
      ? `<text x="${mx}" y="${my}" text-anchor="middle" font-size="9"` +
        ` font-style="italic" font-family="Arial,sans-serif" fill="#666">${esc(label)}</text>`
      : '',
  ].join('\n');
}

// ── Layout constants ──────────────────────────────────────────────────────────
const UC_RX  = 78;   // use-case ellipse x-radius
const UC_RY  = 26;   // use-case ellipse y-radius
const UC_W   = UC_RX * 2;
const UC_H   = UC_RY * 2;
const GAP_X  = 18;
const GAP_Y  = 14;
const PAD    = 22;
const HDR    = 28;
const COL_G  = 44;

const PKG2 = 2 * UC_W + GAP_X + 2 * PAD; // two-column package width
const PKG1 = UC_W + 2 * PAD;             // one-column package width

const pkgH = rows =>
  HDR + PAD + rows * (UC_H + GAP_Y) - GAP_Y + PAD;

// ── Data ──────────────────────────────────────────────────────────────────────
const elements = [];   // SVG strings, drawn in order
const edgesLayer = []; // edges drawn last (on top of packages, below actors)
const ucPos  = {};     // id → { cx, cy }
const actPos = {};     // id → { cx, cy }

function addPkg(id, label, x, y, cols, ucList) {
  const rows = Math.ceil(ucList.length / cols);
  const w = cols === 2 ? PKG2 : PKG1;
  const h = pkgH(rows);
  elements.push(pkg(x, y, w, h, label, '#8896ab'));

  ucList.forEach((uc, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx  = x + PAD + col * (UC_W + GAP_X) + UC_RX;
    const cy  = y + HDR + PAD + row * (UC_H + GAP_Y) + UC_RY;
    elements.push(usecase(cx, cy, UC_RX, UC_RY, uc.label));
    ucPos[uc.id] = { cx, cy };
  });

  return h;
}

function addActor(id, label, x, y, fill, stroke) {
  elements.push(actor(x, y, label, fill, stroke));
  actPos[id] = { cx: x + 20, cy: y + 30 };
}

function addEdge(srcId, tgtId, type, label) {
  const s = actPos[srcId] || ucPos[srcId];
  const t = actPos[tgtId] || ucPos[tgtId];
  if (s && t) edgesLayer.push(edge(s.cx, s.cy, t.cx, t.cy, type, label || ''));
}

// ── Build packages ────────────────────────────────────────────────────────────
const C1X = 200;
const C2X = C1X + PKG2 + COL_G;
const C3X = C2X + PKG2 + COL_G;

let y1 = 50;
addPkg('p_auth', 'Authentication & Account', C1X, y1, 2, [
  { id: 'uc_login',    label: 'Login (Local)' },
  { id: 'uc_sso',      label: 'Login via Microsoft SSO' },
  { id: 'uc_2fa',      label: 'Two-Factor Authentication (2FA)' },
  { id: 'uc_reset',    label: 'Forgot / Reset Password' },
  { id: 'uc_profile',  label: 'Manage Profile & Password' },
  { id: 'uc_register', label: 'Register Account' },
]);
y1 += pkgH(3) + 36;

addPkg('p_file', 'File & Data Explorer', C1X, y1, 2, [
  { id: 'uc_fileexp', label: 'Browse & Preview Files' },
  { id: 'uc_filedet', label: 'View File Details' },
  { id: 'uc_export',  label: 'Export Data (CSV/Excel/PDF/JSON/XML)' },
]);
y1 += pkgH(2) + 36;

addPkg('p_anal', 'Analytics & Insights', C1X, y1, 2, [
  { id: 'uc_dash',       label: 'View Dashboard Analytics' },
  { id: 'uc_dq',         label: 'Analyze Data Quality' },
  { id: 'uc_impact',     label: 'View Impact Analysis' },
  { id: 'uc_scorecard',  label: 'View Partner Scorecard' },
  { id: 'uc_complaints', label: 'Investigate Complaints' },
  { id: 'uc_insights',   label: 'View Advanced Insights' },
  { id: 'uc_charts',     label: 'Generate AI-Assisted Charts' },
]);

let y2 = 50;
addPkg('p_proj', 'Project Management', C2X, y2, 1, [
  { id: 'uc_projects', label: 'Create / Manage Projects' },
]);
y2 += pkgH(1) + 36;

addPkg('p_ing', 'Data Ingestion', C2X, y2, 2, [
  { id: 'uc_upload',  label: 'Upload Files (CSV / XLSX)' },
  { id: 'uc_sources', label: 'Configure Ingestion Sources' },
  { id: 'uc_inghist', label: 'Monitor Ingestion History' },
  { id: 'uc_fsync',   label: 'Sync Files via Folder Agent' },
]);
y2 += pkgH(2) + 36;

addPkg('p_ops', 'Operations Monitoring', C2X, y2, 2, [
  { id: 'uc_opscenter', label: 'View Operations Center (Control Tower)' },
  { id: 'uc_opssnap',   label: 'View Operations Snapshot' },
  { id: 'uc_alerts',    label: 'Manage Alerts' },
]);
y2 += pkgH(2) + 36;

addPkg('p_rep', 'Reporting & Delivery', C2X, y2, 2, [
  { id: 'uc_templates',   label: 'Create / Manage Report Templates' },
  { id: 'uc_repbuild',    label: 'Build Reports (Slide Builder)' },
  { id: 'uc_replib',      label: 'View Reports Library' },
  { id: 'uc_schedules',   label: 'Schedule Report Delivery' },
  { id: 'uc_delhist',     label: 'View Delivery History' },
  { id: 'uc_send',        label: 'Send Report via Email / Telegram' },
]);

let y3 = 50;
addPkg('p_notif', 'Notifications & Search', C3X, y3, 1, [
  { id: 'uc_notifs',   label: 'View Notifications' },
  { id: 'uc_search',   label: 'Global Search' },
  { id: 'uc_activity', label: 'View My Activity' },
]);
y3 += pkgH(3) + 36;

addPkg('p_admin', 'Administration', C3X, y3, 2, [
  { id: 'uc_usermgmt',  label: 'Manage Users' },
  { id: 'uc_roles',     label: 'Assign Roles & Permissions' },
  { id: 'uc_auditlogs', label: 'View Audit Logs' },
  { id: 'uc_syshealth', label: 'Monitor System Health' },
  { id: 'uc_security',  label: 'Configure Security & Compliance' },
  { id: 'uc_retention', label: 'Manage Data Retention' },
  { id: 'uc_backup',    label: 'Backup & Restore Database' },
  { id: 'uc_agentkeys', label: 'Rotate Agent API Keys' },
]);

// ── Place actors ──────────────────────────────────────────────────────────────
const totalH = Math.max(y1 + pkgH(4), y2 + pkgH(3), y3 + pkgH(4));
const midY   = 50 + totalH / 2;

addActor('a_viewer',  'Viewer',  30, midY - 310, '#c9e6ff', '#3b82f6');
addActor('a_analyst', 'Analyst', 30, midY - 40,  '#c6f0c2', '#16a34a');
addActor('a_admin',   'Admin',   30, midY + 230, '#ffc9c9', '#dc2626');

const RX = C3X + PKG2 + 50;
addActor('a_msidp',   'Microsoft\nIdentity Provider', RX, midY - 390, '#fff3c4', '#ca8a04');
addActor('a_fagent',  'Folder Sync\nAgent',           RX, midY - 170, '#fff3c4', '#ca8a04');
addActor('a_sched',   'Scheduler /\nTime Trigger',    RX, midY +  60, '#fff3c4', '#ca8a04');
addActor('a_deliv',   'Email / Telegram\nDelivery',   RX, midY + 270, '#fff3c4', '#ca8a04');

// ── Edges ─────────────────────────────────────────────────────────────────────
// Actor inheritance
addEdge('a_analyst', 'a_viewer',  'general');
addEdge('a_admin',   'a_analyst', 'general');

// Viewer associations
['uc_login','uc_sso','uc_2fa','uc_reset','uc_profile','uc_register',
 'uc_projects','uc_fileexp','uc_filedet',
 'uc_dash','uc_dq','uc_scorecard','uc_complaints','uc_opscenter',
 'uc_notifs','uc_search','uc_activity'].forEach(id => addEdge('a_viewer', id, 'assoc'));

// Analyst associations (additional)
['uc_upload','uc_sources','uc_inghist','uc_fsync','uc_export',
 'uc_impact','uc_insights','uc_charts','uc_opssnap','uc_alerts',
 'uc_templates','uc_repbuild','uc_replib','uc_schedules','uc_delhist'].forEach(id => addEdge('a_analyst', id, 'assoc'));

// Admin associations (additional)
['uc_usermgmt','uc_roles','uc_auditlogs','uc_syshealth',
 'uc_security','uc_retention','uc_backup','uc_agentkeys'].forEach(id => addEdge('a_admin', id, 'assoc'));

// External actor associations
addEdge('a_msidp',  'uc_sso',       'assoc');
addEdge('a_fagent', 'uc_fsync',     'assoc');
addEdge('a_sched',  'uc_schedules', 'assoc');
addEdge('a_sched',  'uc_send',      'assoc');
addEdge('a_deliv',  'uc_send',      'assoc');

// Include / extend
addEdge('uc_sso',      'uc_2fa',       'include', '<<include>>');
addEdge('uc_login',    'uc_2fa',       'extend',  '<<extend>>');
addEdge('uc_upload',   'uc_dq',        'include', '<<include>>');
addEdge('uc_upload',   'uc_impact',    'include', '<<include>>');
addEdge('uc_schedules','uc_send',      'include', '<<include>>');
addEdge('uc_repbuild', 'uc_templates', 'extend',  '<<extend>>');

// ── Assemble SVG ──────────────────────────────────────────────────────────────
const W = RX + 100;
const H = totalH + 120;

const defs = `
<defs>
  <marker id="arrowOpen" markerWidth="10" markerHeight="7"
          refX="9" refY="3.5" orient="auto">
    <polyline points="0,0 9,3.5 0,7" fill="none" stroke="#777" stroke-width="1.2"/>
  </marker>
  <marker id="arrowBlock" markerWidth="10" markerHeight="8"
          refX="9" refY="4" orient="auto">
    <polygon points="0,0 10,4 0,8" fill="none" stroke="#555" stroke-width="1.2"/>
  </marker>
</defs>`;

const title = `
<text x="${W/2}" y="30" text-anchor="middle" font-size="17" font-weight="bold"
      font-family="Arial,sans-serif" fill="#1a202c">
  Roaming &amp; Interconnect Management System — Use Case Diagram
</text>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${defs}
  ${title}
  <!-- packages + use cases -->
  ${elements.join('\n  ')}
  <!-- edges -->
  ${edgesLayer.join('\n  ')}
</svg>
`;

// ── Write file ─────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const outPath   = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(REPO_ROOT, 'use_case_diagram.svg');

fs.writeFileSync(outPath, svg, 'utf-8');
console.log('SVG diagram saved to:');
console.log(`  ${outPath}`);
console.log('');
console.log('Open options:');
console.log('  • Browser : drag the .svg file into any browser tab');
console.log('  • VS Code : open the file (auto-previews SVG)');
console.log('  • draw.io : Extras > Edit Diagram > paste SVG, or File > Open');
console.log('  • Figma   : File > Place Image');
