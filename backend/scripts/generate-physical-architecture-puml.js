/**
 * Generates a PlantUML physical architecture diagram for the
 * Roaming & Interconnect System (Render + Aiven cloud deployment).
 *
 * Usage:
 *   node scripts/generate-physical-architecture-puml.js [output-path]
 *
 * Default output:
 *   ../../docs/PHYSICAL_ARCHITECTURE_RENDER_AIVEN.puml
 *
 * Render the .puml file:
 *   VS Code  : install "PlantUML" extension (jebbs.plantuml) → press Alt+D
 *   Online   : https://www.plantuml.com/plantuml/uml/
 *   CLI      : java -jar plantuml.jar docs/PHYSICAL_ARCHITECTURE_RENDER_AIVEN.puml
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap text in a PlantUML rectangle with a colour */
const rect = (alias, label, colour) =>
  `  rectangle "${label}" as ${alias} ${colour}`;

/** Wrap text in a PlantUML database shape with a colour */
const db = (alias, label, colour) =>
  `  database "${label}" as ${alias} ${colour}`;

// ── Skinparam block ───────────────────────────────────────────────────────────
const SKINPARAMS = `
skinparam shadowing           false
skinparam backgroundColor     #FFFFFF
skinparam defaultTextAlignment center
skinparam ArrowColor          #6B7280
skinparam ArrowFontColor      #374151
skinparam ArrowFontSize       10
skinparam ArrowThickness      1.5

skinparam package {
  BackgroundColor #FAFAFA
  BorderColor     #CBD5E1
  FontSize        12
  FontStyle       bold
  RoundCorner     8
}

skinparam rectangle {
  BackgroundColor #F8FAFC
  BorderColor     #94A3B8
  FontSize        11
  RoundCorner     6
}

skinparam database {
  BackgroundColor #FDF4FF
  BorderColor     #A855F7
  FontSize        11
  BorderThickness 2
}

skinparam actor {
  BackgroundColor #F1F5F9
  BorderColor     #475569
  FontSize        11
  FontStyle       bold
}
`.trim();

// ── Zone 1 — Client Side ──────────────────────────────────────────────────────
const ZONE1 = `
package "Client Side" as Z1 #F8FAFC {
  actor "Admin / Analyst / Viewer" as USER
  rectangle "Web Browser" as BROWSER #DBEAFE
}

package "Folder Sync Host\\n(optional)" as Z2 #FFF1F5 {
  rectangle "<b>Folder Sync Agent</b>\\n<size:9>folder-sync-agent.js\\nwatches local / shared drive</size>" as AGENT #FECDD3
}

package "Developer" as Z3 #EEF2FF {
  rectangle "<b>Git Repository</b>\\n<size:9>GitHub / GitLab\\npushes trigger CI/CD</size>" as GIT #C7D2FE
}
`.trim();

// ── Zone 2 — Render Cloud ─────────────────────────────────────────────────────
const ZONE2 = `
package "Render Cloud" as CLOUD #F0F9FF {

  rectangle "<b>Frontend Web Service</b>\\n<size:10>React + TypeScript  ·  Nginx  ·  Port 443\\nServes the React SPA as a static build</size>" as FE #DCFCE7

  rectangle "<b>Backend Web Service</b>\\n<size:10>Node.js / Express  ·  Port 5000\\nJWT Auth  ·  Rate Limiter  ·  multer  ·  bcrypt</size>" as BE #DBEAFE

  package "Background Workers  (all run inside the backend process)" as WORKERS #E0F2FE {
    rectangle "<b>Scheduler</b>  ·  services/scheduler.ts\\n<size:9>Sends scheduled report emails and Teams notifications</size>"       as W1 #BAE6FD
    rectangle "<b>Analytics ETL</b>  ·  services/analyticsEtl.ts\\n<size:9>Transforms file_rows into analytics aggregate tables</size>" as W2 #BAE6FD
    rectangle "<b>Ingestion Runner</b>  ·  services/ingestionRunner.ts\\n<size:9>Polls INGEST_HOST_PATH for new CSV / XLSX files</size>" as W3 #BAE6FD
    rectangle "<b>Backup Scheduler</b>  ·  services/backupScheduler.ts\\n<size:9>Runs periodic database snapshot backups</size>"         as W4 #BAE6FD
  }

  database "Render Disk  —  /app/uploads\\n<size:9>Uploaded files and generated assets</size>" as DISK_UP #F3E8FF
  database "Render Disk  —  /app/backups\\n<size:9>Database backup snapshot files</size>"      as DISK_BK #F3E8FF

  rectangle "Render Environment Secrets\\n<size:9>JWT_SECRET  ·  DB_HOST  ·  DB_PASSWORD\\nMS_CLIENT_ID  ·  RESEND_API_KEY  ·  DATA_ENCRYPTION_KEY</size>" as ENV #FEF9C3
}
`.trim();

// ── Zone 3 — External Services ───────────────────────────────────────────────
const ZONE3 = `
database "<b>Aiven Managed MySQL</b>\\n<size:9>MySQL 8  ·  TLS  ·  Port 3306\\n28 application tables</size>" as DB

rectangle "<b>Microsoft Identity Platform</b>\\n<size:9>OAuth 2.0  /  OpenID Connect\\nSSO login flow</size>" as IDP #EDE9FE

rectangle "<b>Resend API  /  SMTP</b>\\n<size:9>Email delivery\\nReports  ·  Alerts  ·  Password reset</size>" as MAIL #D1FAE5

rectangle "<b>Microsoft Teams</b>\\n<size:9>Incoming Webhook\\nScheduled reports and alerts</size>" as TEAMS #DBEAFE
`.trim();

// ── Connections ───────────────────────────────────────────────────────────────
const CONNECTIONS = `
'  User flow
USER    -right->  BROWSER : uses
BROWSER -right->  FE      : HTTPS
FE     <-right->  BE      : REST  /api/*

'  Backend → external data & auth
BE  -right->  DB    : SQL over TLS
BE  -right->  IDP   : OAuth / OIDC
BE  -right->  MAIL  : email delivery
BE  -right->  TEAMS : HTTPS webhook

'  Backend → storage
BE  -down->  DISK_UP : writes uploaded files & assets
W4  -down->  DISK_BK : writes backup snapshots

'  Folder sync agent → backend
AGENT  -right->  BE : HTTPS  /api/ingest/agent-upload

'  CI/CD auto-deploy
GIT  .right.>  FE : auto-deploy  (CI/CD)
GIT  .right.>  BE : auto-deploy  (CI/CD)

'  Env secrets → backend
ENV  .up.>  BE : injected at runtime
`.trim();

// ── Assemble the full .puml source ────────────────────────────────────────────
const PUML = `@startuml
'==============================================================
'  Roaming & Interconnect System
'  Physical Architecture — Render + Aiven Cloud Deployment
'  Generated by: scripts/generate-physical-architecture-puml.js
'==============================================================

title <size:15><b>Roaming & Interconnect System — Physical Architecture</b></size>\\n<size:11>Render Cloud  +  Aiven Managed MySQL</size>

${SKINPARAMS}

left to right direction

'──────────────────────────────────────────────────────────────
'  ZONE 1 — Client Side
'──────────────────────────────────────────────────────────────
${ZONE1}

'──────────────────────────────────────────────────────────────
'  ZONE 2 — Render Cloud
'──────────────────────────────────────────────────────────────
${ZONE2}

'──────────────────────────────────────────────────────────────
'  ZONE 3 — External Services
'──────────────────────────────────────────────────────────────
${ZONE3}

'──────────────────────────────────────────────────────────────
'  CONNECTIONS
'──────────────────────────────────────────────────────────────
${CONNECTIONS}

@enduml
`;

// ── Write output ──────────────────────────────────────────────────────────────
const outArg  = process.argv[2];
const outFile = outArg
  ? path.resolve(outArg)
  : path.resolve(__dirname, '..', '..', 'docs', 'PHYSICAL_ARCHITECTURE_RENDER_AIVEN.puml');

fs.writeFileSync(outFile, PUML, 'utf8');
console.log('PlantUML diagram written to:');
console.log('  ' + outFile);
console.log('');
console.log('Render options:');
console.log('  VS Code  : open the file, press Alt+D  (needs jebbs.plantuml extension)');
console.log('  Online   : https://www.plantuml.com/plantuml/uml/');
console.log('  CLI      : java -jar plantuml.jar ' + path.basename(outFile));
