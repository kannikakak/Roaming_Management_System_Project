/**
 * Generates an improved draw.io physical architecture diagram for the
 * Roaming & Interconnect System (Render + Aiven cloud deployment).
 *
 * Usage:
 *   node scripts/generate-physical-architecture-v2.js [output-path]
 *
 * Default output:
 *   ../../docs/PHYSICAL_ARCHITECTURE_V2.drawio
 *
 * Open the result at:
 *   https://app.diagrams.net  →  File > Open From > Device
 *   VS Code: install "Draw.io Integration" extension (hediet.vscode-drawio)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── ID factory ────────────────────────────────────────────────────────────────
let _seq = 2; // 0 and 1 are reserved by draw.io
const uid = () => `ph${_seq++}`;

// ── XML helpers ───────────────────────────────────────────────────────────────
const esc = (v) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function cell(id, label, style, x, y, w, h) {
  return (
    `    <mxCell id="${id}" value="${esc(label)}" style="${esc(style)}" ` +
    `vertex="1" parent="1">` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>` +
    `</mxCell>`
  );
}

function link(id, label, style, src, tgt, pts) {
  const v   = label ? ` value="${esc(label)}"` : '';
  const arr = pts && pts.length
    ? `<Array as="points">${pts.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>`
    : '';
  return (
    `    <mxCell id="${id}"${v} style="${esc(style)}" ` +
    `edge="1" source="${src}" target="${tgt}" parent="1">` +
    `<mxGeometry relative="1" as="geometry">${arr}</mxGeometry>` +
    `</mxCell>`
  );
}

// ── Style definitions ─────────────────────────────────────────────────────────
const S = {
  // Containers
  frame:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8fafc;strokeColor=#334155;strokeWidth=2;' +
    'fontSize=22;fontStyle=1;align=left;verticalAlign=top;spacingTop=18;spacingLeft=24;',
  cloud:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f9ff;strokeColor=#0ea5e9;strokeWidth=2;' +
    'dashed=1;dashPattern=10 6;fontSize=17;fontStyle=1;align=center;verticalAlign=top;spacingTop=14;',
  backendBox:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#eff6ff;strokeColor=#2563eb;strokeWidth=3;' +
    'fontSize=16;fontStyle=1;align=center;verticalAlign=top;spacingTop=14;',
  workersZone:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#e0f2fe;strokeColor=#0284c7;strokeWidth=2;' +
    'dashed=1;dashPattern=6 4;fontSize=13;fontStyle=3;align=center;verticalAlign=top;spacingTop=10;',

  // Left-side actors
  user:
    'shape=mxgraph.gcp2.user;whiteSpace=wrap;html=1;strokeColor=#0f172a;fillColor=#f8fafc;' +
    'fontSize=13;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;',
  browser:
    'shape=mxgraph.cisco.computers_and_peripherals.pc;html=1;pointerEvents=1;dashed=0;' +
    'fillColor=#e2e8f0;strokeColor=#334155;strokeWidth=2;fontSize=13;' +
    'labelPosition=center;align=center;verticalLabelPosition=bottom;verticalAlign=top;',
  agent:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fdf2f8;strokeColor=#be185d;strokeWidth=2;fontSize=13;',
  repo:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#eef2ff;strokeColor=#4338ca;strokeWidth=2;fontSize=13;',

  // Cloud services
  frontend:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f0fdf4;strokeColor=#15803d;strokeWidth=3;' +
    'fontSize=15;fontStyle=1;',
  worker:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#bfdbfe;strokeColor=#1d4ed8;strokeWidth=2;fontSize=13;',
  disk:
    'shape=mxgraph.flowchart.direct_access_storage;html=1;whiteSpace=wrap;' +
    'fillColor=#faf5ff;strokeColor=#7c3aed;strokeWidth=2;fontSize=13;',
  env:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fefce8;strokeColor=#ca8a04;strokeWidth=2;' +
    'fontSize=13;fontStyle=2;',

  // External services
  db:
    'shape=mxgraph.basic.cylinder2;boundedLbl=1;backgroundOutline=1;html=1;whiteSpace=wrap;' +
    'fillColor=#fdf4ff;strokeColor=#a855f7;strokeWidth=3;fontSize=14;fontStyle=1;',
  msAuth:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f3ff;strokeColor=#6d28d9;strokeWidth=2;fontSize=13;',
  emailSvc:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ecfdf5;strokeColor=#059669;strokeWidth=2;fontSize=13;',
  teamsSvc:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#eff6ff;strokeColor=#2563eb;strokeWidth=2;fontSize=13;',

  // Edges
  eBlue:
    'endArrow=block;endFill=1;strokeWidth=2.5;strokeColor=#2563eb;fontSize=12;html=1;' +
    'edgeStyle=orthogonalEdgeStyle;rounded=1;',
  eBidir:
    'endArrow=block;endFill=1;startArrow=block;startFill=1;strokeWidth=2.5;' +
    'strokeColor=#2563eb;fontSize=12;html=1;edgeStyle=orthogonalEdgeStyle;rounded=1;',
  eGray:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#475569;fontSize=12;html=1;' +
    'edgeStyle=orthogonalEdgeStyle;rounded=1;',
  ePurple:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#7c3aed;fontSize=12;html=1;' +
    'edgeStyle=orthogonalEdgeStyle;rounded=1;',
  eGreen:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#059669;fontSize=12;html=1;' +
    'edgeStyle=orthogonalEdgeStyle;rounded=1;',
  ePink:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#be185d;fontSize=12;html=1;' +
    'edgeStyle=orthogonalEdgeStyle;rounded=1;',
  eDash:
    'endArrow=open;endFill=0;dashed=1;strokeWidth=1.5;strokeColor=#94a3b8;fontSize=11;' +
    'html=1;edgeStyle=orthogonalEdgeStyle;rounded=1;',
};

// ── Cell collectors ───────────────────────────────────────────────────────────
const cells = [];

function add(label, style, x, y, w, h) {
  const id = uid();
  cells.push(cell(id, label, style, x, y, w, h));
  return id;
}

function conn(label, style, src, tgt, pts) {
  cells.push(link(uid(), label, style, src, tgt, pts));
}

// ── Layout ────────────────────────────────────────────────────────────────────
//
//  Canvas: 2300 × 1160
//
//  LEFT  (x: 40–270)   : user, browser, folder-sync agent, developer+git
//  CLOUD (x: 290–1800) : render cloud dashed box
//    FRONTEND           : x=350, y=240, 260×120
//    BACKEND            : x=685, y=185, 700×630   (contains workers zone)
//      WORKERS ZONE     : x=705, y=410, 660×350   (dashed sub-box)
//        Scheduler      : x=725, y=460, 290×80
//        Analytics ETL  : x=1055, y=460, 290×80
//        Ingestion Runner: x=725, y=580, 290×80
//        Backup Scheduler: x=1055, y=580, 290×80
//    UPLOADS disk       : x=350, y=440, 220×90
//    BACKUPS disk       : x=350, y=590, 220×90
//    ENV/SECRETS        : x=1080, y=840, 290×100
//  RIGHT (x: 1890–2120): MySQL, Microsoft IdP, Email, Teams

// Outer title frame
add('Roaming & Interconnect System — Physical Architecture (Render + Aiven)', S.frame, 30, 30, 2260, 1070);

// Render cloud boundary
add('Render Cloud', S.cloud, 295, 100, 1510, 870);

// ── Left: Actors ──────────────────────────────────────────────────────────────
const USER    = add('Admin / Analyst\n/ Viewer',            S.user,    85,  250, 90, 110);
const BROWSER = add('Web Browser',                          S.browser, 72,  460, 100, 90);
const AGENT   = add('Folder Sync\nAgent Host\n(optional remote\ningestion)', S.agent, 45, 660, 190, 110);
const REPO    = add('Developer +\nGit Repository',          S.repo,    70,  890, 150, 80);

// ── Frontend service ──────────────────────────────────────────────────────────
const FRONTEND = add(
  'Frontend Web Service\nReact + TypeScript SPA\nNginx · Port 443',
  S.frontend, 350, 240, 260, 120
);

// ── Backend service (outer container) ────────────────────────────────────────
const BACKEND = add(
  'Backend Web Service\nNode.js / Express API · Port 5000\nJWT Auth · Rate Limiter · multer · bcrypt',
  S.backendBox, 685, 185, 700, 630
);

// Workers zone sub-box
add('Background Workers  (all run inside the backend process)', S.workersZone, 705, 410, 660, 350);

// Individual workers
const SCHED  = add('Scheduler Worker\nservices/scheduler.ts\n(email · Teams · alerts)', S.worker, 725, 460, 290, 80);
const ETL    = add('Analytics ETL Worker\nservices/analyticsEtl.ts\n(aggregates file_rows → analytics tables)', S.worker, 1055, 460, 290, 80);
const INGEST = add('Ingestion Runner\nservices/ingestionRunner.ts\n(polls INGEST_HOST_PATH)', S.worker, 725, 580, 290, 80);
const BACKUP = add('Backup Scheduler\nservices/backupScheduler.ts\n(periodic DB snapshots)', S.worker, 1055, 580, 290, 80);

// ── Storage volumes ───────────────────────────────────────────────────────────
const UPLOADS = add('Render Disk\n/app/uploads\n(files & generated assets)', S.disk, 350, 440, 220, 90);
const BACKUPS = add('Render Disk\n/app/backups\n(backup snapshots)', S.disk, 350, 590, 220, 90);

// ── Env / secrets ─────────────────────────────────────────────────────────────
const ENV = add(
  'Render Env / Secrets\nJWT_SECRET · DB_HOST\nOAuth config · RESEND_API_KEY',
  S.env, 1080, 840, 290, 100
);

// ── External services (right) ─────────────────────────────────────────────────
const DB    = add('Aiven Managed MySQL\nMySQL over TLS · Port 3306',        S.db,       1895, 205, 230, 130);
const MS    = add('Microsoft Identity Platform\nOAuth 2.0 / OpenID Connect',S.msAuth,   1895, 425, 230,  85);
const EMAIL = add('Resend API  or  SMTP\nEmail delivery',                   S.emailSvc, 1895, 580, 230,  80);
const TEAMS = add('Microsoft Teams\nWebhook · report & alert delivery',     S.teamsSvc, 1895, 730, 230,  80);

// ── Edges ─────────────────────────────────────────────────────────────────────

// User → browser → frontend → backend
conn('',              S.eGray,   USER,    BROWSER);
conn('HTTPS',         S.eBlue,   BROWSER, FRONTEND);
conn('REST  /api/*',  S.eBidir,  FRONTEND, BACKEND);

// Backend → external data / auth services
conn('SQL over TLS',                       S.ePurple, BACKEND, DB);
conn('OAuth / OpenID Connect',             S.ePurple, BACKEND, MS,    [{ x: 1820, y: 467 }]);
conn('Email delivery\n(Resend API / SMTP)', S.eGreen,  BACKEND, EMAIL, [{ x: 1825, y: 620 }]);
conn('Report & alert\ndelivery (webhook)', S.eBlue,   BACKEND, TEAMS, [{ x: 1830, y: 770 }]);

// Backend → storage disks
conn('Writes uploaded\nfiles & assets',  S.ePurple, BACKEND, UPLOADS, [{ x: 620, y: 490 }]);
conn('Writes backup\nsnapshots',         S.ePurple, BACKUP,  BACKUPS, [{ x: 640, y: 710 }]);

// Folder sync agent → backend  (routes below the disk area then up into backend left edge)
conn(
  '/api/ingest/agent-upload\n(HTTPS)',
  S.ePink,
  AGENT,
  BACKEND,
  [{ x: 260, y: 710 }, { x: 655, y: 710 }, { x: 655, y: 490 }]
);

// Developer → auto-deploy to frontend and backend
conn('Auto-deploy\n(CI/CD)', S.eDash, REPO, FRONTEND, [{ x: 215, y: 920 }, { x: 480, y: 920 }, { x: 480, y: 360 }]);
conn('Auto-deploy\n(CI/CD)', S.eDash, REPO, BACKEND,  [{ x: 215, y: 950 }, { x: 870, y: 950 }, { x: 870, y: 815 }]);

// Env / secrets → backend (dotted — runtime injection)
conn('Runtime config\n(env vars)', S.eDash, ENV, BACKEND);

// ── Assemble XML ──────────────────────────────────────────────────────────────
const xml = `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" type="device" version="21.0.0">
  <diagram name="Physical Architecture v2" id="physical-arch-render-aiven-v2">
    <mxGraphModel dx="1800" dy="1100" grid="1" gridSize="10" guides="1" tooltips="1"
      connect="1" arrows="1" fold="1" page="1" pageScale="1"
      pageWidth="2340" pageHeight="1160" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

// ── Write output ──────────────────────────────────────────────────────────────
const outArg  = process.argv[2];
const outFile = outArg
  ? path.resolve(outArg)
  : path.resolve(__dirname, '..', '..', 'docs', 'PHYSICAL_ARCHITECTURE_V2.drawio');

fs.writeFileSync(outFile, xml, 'utf8');
console.log('draw.io diagram written to:');
console.log(`  ${outFile}`);
console.log('');
console.log('Open options:');
console.log('  Online  : https://app.diagrams.net  →  File > Open From > Device');
console.log('  VS Code : install "Draw.io Integration" extension (hediet.vscode-drawio)');
