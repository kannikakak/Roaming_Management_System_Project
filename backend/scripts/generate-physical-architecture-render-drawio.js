/**
 * Generates a draw.io (.drawio) physical architecture diagram for the
 * Roaming & Interconnect System using the requested Render + Aiven layout.
 *
 * Usage:
 *   node scripts/generate-physical-architecture-render-drawio.js [output-path]
 *
 * Default output:
 *   ../../docs/PHYSICAL_ARCHITECTURE_RENDER_AIVEN.drawio
 */

'use strict';

const fs = require('fs');
const path = require('path');

let seq = 2;
const uid = () => `pa${seq++}`;

const esc = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function vertex(id, label, style, x, y, w, h, parent = '1') {
  return (
    `    <mxCell id="${id}" value="${esc(label)}" style="${esc(style)}" vertex="1" parent="${parent}">` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>` +
    `</mxCell>`
  );
}

function edge(id, label, style, src, tgt, points = []) {
  const value = label ? ` value="${esc(label)}"` : '';
  const pts = points.length
    ? `<Array as="points">${points
        .map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`)
        .join('')}</Array>`
    : '';
  return (
    `    <mxCell id="${id}"${value} style="${esc(style)}" edge="1" source="${src}" target="${tgt}" parent="1">` +
    `<mxGeometry relative="1" as="geometry">${pts}</mxGeometry>` +
    `</mxCell>`
  );
}

const style = {
  outer:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6b7280;' +
    'fontSize=20;fontStyle=1;align=left;verticalAlign=top;spacingTop=20;spacingLeft=20;',
  dashedZone:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#94a3b8;dashed=1;' +
    'dashPattern=8 8;fontSize=18;align=center;verticalAlign=top;spacingTop=14;',
  actor:
    'shape=mxgraph.android.phone;whiteSpace=wrap;html=1;strokeColor=#334155;fillColor=#ffffff;' +
    'fontSize=16;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;',
  simpleActor:
    'shape=mxgraph.gcp2.user;whiteSpace=wrap;html=1;strokeColor=#334155;fillColor=#ffffff;' +
    'fontSize=15;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;',
  frontend:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7ed;strokeColor=#f97316;strokeWidth=3;' +
    'fontSize=18;fontStyle=1;',
  backend:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#eff6ff;strokeColor=#2563eb;strokeWidth=3;' +
    'fontSize=18;fontStyle=1;',
  db:
    'shape=mxgraph.basic.cylinder2;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;' +
    'fillColor=#faf5ff;strokeColor=#d946ef;strokeWidth=3;fontSize=18;fontStyle=1;',
  disk:
    'shape=mxgraph.flowchart.direct_access_storage;whiteSpace=wrap;html=1;fillColor=#f5f3ff;' +
    'strokeColor=#7c3aed;strokeWidth=2;fontSize=15;',
  service:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f0fdfa;strokeColor=#0891b2;strokeWidth=2;fontSize=15;',
  auth:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f3ff;strokeColor=#7c3aed;strokeWidth=2;fontSize=15;',
  repo:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#eef2ff;strokeColor=#4f46e5;strokeWidth=2;fontSize=15;',
  agent:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fdf2f8;strokeColor=#db2777;strokeWidth=2;fontSize=15;',
  label:
    'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=14;fontStyle=2;',
  edge:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#4b5563;fontSize=13;html=1;rounded=1;',
  edgeBlue:
    'endArrow=block;endFill=1;strokeWidth=2.5;strokeColor=#2563eb;fontSize=13;html=1;rounded=1;',
  edgePurple:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#7c3aed;fontSize=13;html=1;rounded=1;',
  edgePink:
    'endArrow=block;endFill=1;strokeWidth=2;strokeColor=#db2777;fontSize=13;html=1;rounded=1;',
  edgeDashed:
    'endArrow=block;endFill=1;dashed=1;strokeWidth=2;strokeColor=#64748b;fontSize=13;html=1;rounded=1;'
};

const cells = [];

function addVertex(label, cellStyle, x, y, w, h, parent) {
  const id = uid();
  cells.push(vertex(id, label, cellStyle, x, y, w, h, parent));
  return id;
}

function addEdge(label, cellStyle, src, tgt, points) {
  cells.push(edge(uid(), label, cellStyle, src, tgt, points));
}

const OUTER = addVertex('Physical Architecture Diagram', style.outer, 40, 40, 1700, 900);
const CLOUD = addVertex('Cloud Hosting', style.dashedZone, 360, 140, 1260, 600);

const USER = addVertex('Admin / Analyst / Viewer', style.simpleActor, 70, 350, 90, 120);
const BROWSER = addVertex('Web Browser', style.actor, 200, 360, 90, 110);
const AGENT = addVertex('Folder Sync Agent Host\nOptional Remote Ingestion', style.agent, 70, 580, 220, 90);
const REPO = addVertex('Developer + Git Repository', style.repo, 120, 800, 220, 70);

const FRONTEND = addVertex('Frontend Web Service\nReact + TypeScript', style.frontend, 430, 260, 250, 90);
const BACKEND = addVertex('Backend Web Service\nNode.js + Express API', style.backend, 860, 260, 280, 90);
const DB = addVertex('Aiven Managed MySQL\nMySQL over TLS :3306', style.db, 1410, 245, 180, 120);

const SCHED = addVertex('Scheduler Worker', style.service, 820, 420, 150, 60);
const ETL = addVertex('Analytics ETL', style.service, 990, 420, 150, 60);
const INGEST = addVertex('Ingestion Runner', style.service, 820, 500, 150, 60);
const BACKUP = addVertex('Backup Scheduler', style.service, 990, 500, 150, 60);

const UPLOADS = addVertex('Render Disk\n/app/uploads', style.disk, 520, 520, 180, 85);
const BACKUPS = addVertex('Render Disk\n/app/backups', style.disk, 520, 635, 180, 85);

const ENV = addVertex('Render Environment / Secrets\nJWT_SECRET, DB_HOST,\nOAuth, Resend, Teams', style.repo, 1220, 450, 260, 95);
const MS = addVertex('Microsoft Identity Platform', style.auth, 1410, 430, 210, 65);
const EMAIL = addVertex('Resend API or SMTP', style.service, 1410, 530, 210, 65);
const TEAMS = addVertex('Microsoft Teams Webhook', style.service, 1410, 630, 210, 65);

addEdge('HTTPS', style.edgeBlue, USER, BROWSER);
addEdge('HTTPS', style.edgeBlue, BROWSER, FRONTEND);
addEdge('REST API Requests', style.edgeBlue, FRONTEND, BACKEND);
addEdge('REST API Responses', style.edge, BACKEND, FRONTEND);

addEdge('Database Access\n(SQL over TLS)', style.edgePurple, BACKEND, DB);

addEdge('Stores uploads / assets', style.edgePurple, BACKEND, UPLOADS);
addEdge('Stores backup snapshots', style.edgePurple, BACKEND, BACKUPS);

addEdge('OAuth / OpenID Connect', style.edgePurple, BACKEND, MS);
addEdge('Email delivery', style.edge, BACKEND, EMAIL);
addEdge('Report / alert delivery', style.edge, BACKEND, TEAMS);

addEdge('runtime config', style.edgeDashed, ENV, BACKEND);
addEdge('agent upload', style.edgePink, AGENT, BACKEND, [{ x: 500, y: 625 }, { x: 500, y: 305 }]);

addEdge('auto deploy', style.edgeDashed, REPO, FRONTEND, [{ x: 430, y: 835 }, { x: 430, y: 305 }]);
addEdge('auto deploy', style.edgeDashed, REPO, BACKEND, [{ x: 760, y: 835 }, { x: 760, y: 305 }]);

addEdge('', style.edgeDashed, SCHED, BACKEND);
addEdge('', style.edgeDashed, ETL, BACKEND);
addEdge('', style.edgeDashed, INGEST, BACKEND);
addEdge('', style.edgeDashed, BACKUP, BACKEND);

const outputArg = process.argv[2];
const outputFile = outputArg
  ? path.resolve(outputArg)
  : path.resolve(__dirname, '..', '..', 'docs', 'PHYSICAL_ARCHITECTURE_RENDER_AIVEN.drawio');

const xml = `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" type="device" version="21.0.0">
  <diagram name="Physical Architecture" id="physical-architecture-render-aiven">
    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1"
      connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1800" pageHeight="1000" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

fs.writeFileSync(outputFile, xml, 'utf8');
console.log(`draw.io diagram written to: ${outputFile}`);
