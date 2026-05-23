/**
 * Generates a draw.io (.drawio) use case diagram for the Roaming & Interconnect System.
 * No external dependencies — uses only built-in Node.js modules.
 *
 * Usage:
 *   node scripts/generate-drawio.js [output-path]
 *
 * Default output: <repo-root>/use_case_diagram.drawio
 * Open result at: https://app.diagrams.net  or  draw.io desktop app
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── ID factory ────────────────────────────────────────────────────────────────
let _seq = 2; // 0 and 1 are reserved by draw.io
const uid = () => `c${_seq++}`;

// ── XML helpers ───────────────────────────────────────────────────────────────
const esc = s =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function vertex(id, label, style, x, y, w, h, parent = '1') {
  return (
    `    <mxCell id="${id}" value="${esc(label)}" style="${esc(style)}" ` +
    `vertex="1" parent="${parent}">` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>` +
    `</mxCell>`
  );
}

function edgeCell(id, label, style, src, tgt) {
  const v = label ? ` value="${esc(label)}"` : '';
  return (
    `    <mxCell id="${id}"${v} style="${esc(style)}" ` +
    `edge="1" source="${src}" target="${tgt}" parent="1">` +
    `<mxGeometry relative="1" as="geometry"/>` +
    `</mxCell>`
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const style = {
  actor: (fill, stroke) =>
    `shape=mxgraph.uml.actor;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};` +
    `labelPosition=center;align=center;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;`,

  usecase:
    'ellipse;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=10;',

  package:
    'swimlane;fontStyle=1;fontSize=11;fillColor=#f5f5f5;strokeColor=#aaaaaa;' +
    'fontColor=#333333;startSize=30;rounded=1;arcSize=4;',

  assoc:    'endArrow=none;html=1;',
  include:  'endArrow=open;endFill=0;dashed=1;html=1;fontSize=10;',
  extend:   'endArrow=open;endFill=0;dashed=1;html=1;fontSize=10;',
  general:  'endArrow=block;endFill=0;html=1;',
};

// ── Layout constants ──────────────────────────────────────────────────────────
const UC_W   = 155;  // use-case ellipse width
const UC_H   = 46;   // use-case ellipse height
const GAP_X  = 16;   // horizontal gap between columns of UCs inside a package
const GAP_Y  = 12;   // vertical gap between rows of UCs inside a package
const PAD    = 20;   // padding inside package (sides + bottom)
const HDR    = 30;   // swimlane header height
const COL_GAP = 42;  // gap between package columns

// Derived package widths
const PKG2 = 2 * UC_W + GAP_X + 2 * PAD; // two-column package  → 366
const PKG1 = UC_W + 2 * PAD;             // one-column  package  → 195

// Package height for a given number of UC rows
const pkgH = rows => HDR + PAD + rows * (UC_H + GAP_Y) - GAP_Y + PAD;

// ── Cell collectors ───────────────────────────────────────────────────────────
const cells = [];

function addActor(label, x, y, fill, stroke) {
  const id = uid();
  cells.push(vertex(id, label, style.actor(fill, stroke), x, y, 40, 60));
  return id;
}

function addPackage(label, x, y, w, h) {
  const id = uid();
  cells.push(vertex(id, label, style.package, x, y, w, h));
  return id;
}

// Place use-case ellipses inside a swimlane; returns array of their IDs.
function addUseCases(pkgId, labels, cols) {
  return labels.map((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rx  = PAD + col * (UC_W + GAP_X);
    const ry  = HDR + PAD + row * (UC_H + GAP_Y);
    const id  = uid();
    cells.push(vertex(id, label, style.usecase, rx, ry, UC_W, UC_H, pkgId));
    return id;
  });
}

function addAssoc(src, tgt)          { cells.push(edgeCell(uid(), '',            style.assoc,   src, tgt)); }
function addInclude(src, tgt)        { cells.push(edgeCell(uid(), '<<include>>', style.include, src, tgt)); }
function addExtend(src, tgt)         { cells.push(edgeCell(uid(), '<<extend>>',  style.extend,  src, tgt)); }
function addGeneralize(child, parent){ cells.push(edgeCell(uid(), '',            style.general, child, parent)); }

// ── Package layout (3 columns) ────────────────────────────────────────────────
const C1X = 200;
const C2X = C1X + PKG2 + COL_GAP; // 608
const C3X = C2X + PKG2 + COL_GAP; // 1016

// Column 1 ────────────────────────────────────────────────────────────────────
let y1 = 50;

const P_AUTH   = addPackage('Authentication & Account', C1X, y1, PKG2, pkgH(3));
const [ucLogin, ucSSO, uc2FA, ucResetPwd, ucProfile, ucRegister] = addUseCases(P_AUTH, [
  'Login (Local)',                  'Login via Microsoft SSO',
  'Two-Factor Authentication (2FA)', 'Forgot / Reset Password',
  'Manage Profile & Password',       'Register Account',
], 2);
y1 += pkgH(3) + 35;

const P_FILE   = addPackage('File & Data Explorer', C1X, y1, PKG2, pkgH(2));
const [ucFileExp, ucFileDet, ucExport] = addUseCases(P_FILE, [
  'Browse & Preview Files',          'View File Details',
  'Export Data (CSV/Excel/PDF/JSON/XML)',
], 2);
y1 += pkgH(2) + 35;

const P_ANAL   = addPackage('Analytics & Insights', C1X, y1, PKG2, pkgH(4));
const [ucDash, ucDQ, ucImpact, ucScorecard, ucComplaints, ucAdvInsights, ucCharts] = addUseCases(P_ANAL, [
  'View Dashboard Analytics',        'Analyze Data Quality',
  'View Impact Analysis',            'View Partner Scorecard',
  'Investigate Complaints',          'View Advanced Insights',
  'Generate AI-Assisted Charts',
], 2);

// Column 2 ────────────────────────────────────────────────────────────────────
let y2 = 50;

const P_PROJ   = addPackage('Project Management', C2X, y2, PKG1, pkgH(1));
const [ucProjects] = addUseCases(P_PROJ, ['Create / Manage Projects'], 1);
y2 += pkgH(1) + 35;

const P_ING    = addPackage('Data Ingestion', C2X, y2, PKG2, pkgH(2));
const [ucUpload, ucSources, ucIngHist, ucFSync] = addUseCases(P_ING, [
  'Upload Files (CSV / XLSX)',        'Configure Ingestion Sources',
  'Monitor Ingestion History',        'Sync Files via Folder Agent',
], 2);
y2 += pkgH(2) + 35;

const P_OPS    = addPackage('Operations Monitoring', C2X, y2, PKG2, pkgH(2));
const [ucOpsCenter, ucOpsSnap, ucAlerts] = addUseCases(P_OPS, [
  'View Operations Center\n(Control Tower)', 'View Operations Snapshot',
  'Manage Alerts',
], 2);
y2 += pkgH(2) + 35;

const P_REP    = addPackage('Reporting & Delivery', C2X, y2, PKG2, pkgH(3));
const [ucTemplates, ucReportBuild, ucReportsLib, ucSchedules, ucDelHist, ucSend] = addUseCases(P_REP, [
  'Create / Manage Report Templates', 'Build Reports (Slide Builder)',
  'View Reports Library',             'Schedule Report Delivery',
  'View Delivery History',            'Send Report via Email / Telegram',
], 2);

// Column 3 ────────────────────────────────────────────────────────────────────
let y3 = 50;

const P_NOTIF  = addPackage('Notifications & Search', C3X, y3, PKG1, pkgH(3));
const [ucNotifs, ucSearch, ucActivity] = addUseCases(P_NOTIF, [
  'View Notifications', 'Global Search', 'View My Activity',
], 1);
y3 += pkgH(3) + 35;

const P_ADMIN  = addPackage('Administration', C3X, y3, PKG2, pkgH(4));
const [ucUserMgmt, ucRoles, ucAuditLogs, ucSysHealth,
       ucSecurity, ucRetention, ucBackup, ucAgentKeys] = addUseCases(P_ADMIN, [
  'Manage Users',                     'Assign Roles & Permissions',
  'View Audit Logs',                  'Monitor System Health',
  'Configure Security & Compliance',  'Manage Data Retention',
  'Backup & Restore Database',        'Rotate Agent API Keys',
], 2);

// ── Actors ────────────────────────────────────────────────────────────────────
const totalH = Math.max(y1 + pkgH(4), y2 + pkgH(3), y3 + pkgH(4));
const midY   = 50 + totalH / 2;

// Internal actors — left side
const A_VIEWER  = addActor('Viewer',  40, midY - 300, '#dae8fc', '#6c8ebf');
const A_ANALYST = addActor('Analyst', 40, midY,       '#d5e8d4', '#82b366');
const A_ADMIN   = addActor('Admin',   40, midY + 300, '#f8cecc', '#b85450');

// External actors — right side
const RX = C3X + PKG2 + 60;
const A_MS_IDP       = addActor('Microsoft\nIdentity Provider', RX, midY - 370, '#fff2cc', '#d6b656');
const A_FOLDER_AGENT = addActor('Folder Sync\nAgent',           RX, midY - 180, '#fff2cc', '#d6b656');
const A_SCHEDULER    = addActor('Scheduler /\nTime Trigger',    RX, midY +  30, '#fff2cc', '#d6b656');
const A_DELIVERY     = addActor('Email / Telegram\nDelivery',   RX, midY + 220, '#fff2cc', '#d6b656');

// ── Actor inheritance ─────────────────────────────────────────────────────────
addGeneralize(A_ANALYST, A_VIEWER);
addGeneralize(A_ADMIN,   A_ANALYST);

// ── Viewer associations ───────────────────────────────────────────────────────
[
  ucLogin, ucSSO, uc2FA, ucResetPwd, ucProfile, ucRegister,
  ucProjects, ucFileExp, ucFileDet,
  ucDash, ucDQ, ucScorecard, ucComplaints, ucOpsCenter,
  ucNotifs, ucSearch, ucActivity,
].forEach(uc => addAssoc(A_VIEWER, uc));

// ── Analyst associations (additional) ────────────────────────────────────────
[
  ucUpload, ucSources, ucIngHist, ucFSync, ucExport,
  ucImpact, ucAdvInsights, ucCharts, ucOpsSnap, ucAlerts,
  ucTemplates, ucReportBuild, ucReportsLib, ucSchedules, ucDelHist,
].forEach(uc => addAssoc(A_ANALYST, uc));

// ── Admin associations (additional) ──────────────────────────────────────────
[
  ucUserMgmt, ucRoles, ucAuditLogs, ucSysHealth,
  ucSecurity, ucRetention, ucBackup, ucAgentKeys,
].forEach(uc => addAssoc(A_ADMIN, uc));

// ── External actor associations ───────────────────────────────────────────────
addAssoc(A_MS_IDP,       ucSSO);
addAssoc(A_FOLDER_AGENT, ucFSync);
addAssoc(A_SCHEDULER,    ucSchedules);
addAssoc(A_SCHEDULER,    ucSend);
addAssoc(A_DELIVERY,     ucSend);

// ── Include / extend relationships ───────────────────────────────────────────
addInclude(ucSSO,         uc2FA);
addExtend (ucLogin,       uc2FA);
addInclude(ucUpload,      ucDQ);
addInclude(ucUpload,      ucImpact);
addInclude(ucSchedules,   ucSend);
addExtend (ucReportBuild, ucTemplates);

// ── Assemble XML ──────────────────────────────────────────────────────────────
const CANVAS_W = RX + 150;
const CANVAS_H = totalH + 150;

const xml = `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" type="device" version="21.0.0">
  <diagram name="Use Case Diagram" id="roaming-use-cases">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1"
                  connect="1" arrows="1" fold="1" page="1" pageScale="1"
                  pageWidth="${CANVAS_W}" pageHeight="${CANVAS_H}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

// ── Write file ────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const outPath   = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(REPO_ROOT, 'use_case_diagram.drawio');

fs.writeFileSync(outPath, xml, 'utf-8');
console.log('draw.io diagram generated:');
console.log(`  ${outPath}`);
console.log('');
console.log('Open options:');
console.log('  • Online : https://app.diagrams.net  → File > Open From > Device');
console.log('  • Desktop: draw.io app → File > Open');
console.log('  • VS Code: install "Draw.io Integration" extension (hediet.vscode-drawio)');
