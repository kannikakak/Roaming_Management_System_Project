/**
 * Generates a self-contained HTML physical architecture diagram.
 * Uses Mermaid.js (loaded from CDN) — open the output in any browser.
 *
 * Usage:
 *   node scripts/generate-physical-architecture-html.js [output-path]
 *
 * Default output:
 *   ../../docs/PHYSICAL_ARCHITECTURE.html
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Mermaid diagram source ────────────────────────────────────────────────────
const DIAGRAM = `
flowchart LR
    USER["👤 Admin / Analyst / Viewer"]
    BROWSER["🌐 Web Browser"]
    AGENT["📁 Folder Sync Agent Host\\n(optional remote ingestion)"]
    DEV["💻 Developer\\n+ Git Repository"]

    subgraph CLOUD["☁️  Render Cloud"]
        direction LR

        FRONTEND["🟢 Frontend Web Service\\nReact + TypeScript SPA\\nNginx · Port 443"]

        subgraph BACKEND_BOX["🔵 Backend Web Service — Node.js / Express API · Port 5000"]
            direction TB
            API["Express API\\nJWT · Rate Limiter · multer · bcrypt"]
            subgraph WORKERS["⚙️  Background Workers (inside backend process)"]
                direction LR
                W1["Scheduler Worker\\nscheduler.ts"]
                W2["Analytics ETL\\nanalyticsEtl.ts"]
                W3["Ingestion Runner\\ningestionRunner.ts"]
                W4["Backup Scheduler\\nbackupScheduler.ts"]
            end
        end

        UPLOADS[("💾 Render Disk\\n/app/uploads\\nfiles & assets")]
        BACKUPS[("💾 Render Disk\\n/app/backups\\nbackup snapshots")]
        ENV["🔑 Render Env / Secrets\\nJWT_SECRET · DB_HOST\\nOAuth config · RESEND_API_KEY"]
    end

    DB[("🗄️ Aiven Managed MySQL\\nMySQL over TLS · Port 3306")]
    MS["🔐 Microsoft Identity Platform\\nOAuth 2.0 / OpenID Connect"]
    EMAIL["📧 Resend API or SMTP\\nEmail delivery"]
    TEAMS["💬 Microsoft Teams\\nWebhook · reports & alerts"]

    USER     -->|"uses"| BROWSER
    BROWSER  -->|"HTTPS"| FRONTEND
    FRONTEND <-->|"REST /api/*"| API

    API --> |"SQL over TLS"| DB
    API -->|"OAuth / OIDC"| MS
    API -->|"email delivery"| EMAIL
    API -->|"webhook"| TEAMS

    API      -->|"write files & assets"| UPLOADS
    W4       -->|"write snapshots"| BACKUPS

    AGENT    -->|"/api/ingest/agent-upload  HTTPS"| API

    DEV      -.->|"auto-deploy CI/CD"| FRONTEND
    DEV      -.->|"auto-deploy CI/CD"| BACKEND_BOX
    ENV      -.->|"runtime config"| API

    style FRONTEND    fill:#f0fdf4,stroke:#15803d,stroke-width:3px,color:#14532d
    style BACKEND_BOX fill:#eff6ff,stroke:#2563eb,stroke-width:3px,color:#1e3a8a
    style API         fill:#dbeafe,stroke:#3b82f6,stroke-width:2px
    style WORKERS     fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,stroke-dasharray:6 4
    style W1          fill:#bfdbfe,stroke:#1d4ed8,stroke-width:2px
    style W2          fill:#bfdbfe,stroke:#1d4ed8,stroke-width:2px
    style W3          fill:#bfdbfe,stroke:#1d4ed8,stroke-width:2px
    style W4          fill:#bfdbfe,stroke:#1d4ed8,stroke-width:2px
    style UPLOADS     fill:#faf5ff,stroke:#7c3aed,stroke-width:2px
    style BACKUPS     fill:#faf5ff,stroke:#7c3aed,stroke-width:2px
    style ENV         fill:#fefce8,stroke:#ca8a04,stroke-width:2px
    style DB          fill:#fdf4ff,stroke:#a855f7,stroke-width:3px
    style MS          fill:#f5f3ff,stroke:#6d28d9,stroke-width:2px
    style EMAIL       fill:#ecfdf5,stroke:#059669,stroke-width:2px
    style TEAMS       fill:#eff6ff,stroke:#2563eb,stroke-width:2px
    style AGENT       fill:#fdf2f8,stroke:#be185d,stroke-width:2px
    style DEV         fill:#eef2ff,stroke:#4338ca,stroke-width:2px
`;

// ── HTML template ─────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Physical Architecture — Roaming &amp; Interconnect System</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f1f5f9;
      color: #1e293b;
      padding: 32px 24px 64px;
      min-height: 100vh;
    }

    header {
      max-width: 1200px;
      margin: 0 auto 28px;
    }

    header h1 {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
    }

    header p {
      margin-top: 6px;
      font-size: 14px;
      color: #64748b;
    }

    .card {
      max-width: 1400px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 40px 32px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      overflow: auto;
    }

    .mermaid { display: flex; justify-content: center; min-width: 900px; }

    .legend {
      max-width: 1400px;
      margin: 24px auto 0;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #475569;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 12px;
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      flex-shrink: 0;
    }
  </style>
</head>
<body>

  <header>
    <h1>Roaming &amp; Interconnect System — Physical Architecture</h1>
    <p>Deployment: Render (frontend + backend) · Aiven Managed MySQL · Microsoft SSO · Resend email</p>
  </header>

  <div class="card">
    <div class="mermaid">
${DIAGRAM.trim().split('\n').map(l => '      ' + l).join('\n')}
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:#15803d;"></div> Frontend (React / Nginx)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#2563eb;"></div> Backend (Express API)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#1d4ed8;"></div> Background Workers</div>
    <div class="legend-item"><div class="legend-dot" style="background:#7c3aed;"></div> Render Disk Storage</div>
    <div class="legend-item"><div class="legend-dot" style="background:#a855f7;"></div> Aiven MySQL Database</div>
    <div class="legend-item"><div class="legend-dot" style="background:#be185d;"></div> Folder Sync Agent</div>
    <div class="legend-item"><div class="legend-dot" style="background:#94a3b8;"></div> - - - Auto-deploy / Config</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
      securityLevel: 'loose',
    });
  </script>

</body>
</html>
`;

// ── Write output ──────────────────────────────────────────────────────────────
const outArg  = process.argv[2];
const outFile = outArg
  ? path.resolve(outArg)
  : path.resolve(__dirname, '..', '..', 'docs', 'PHYSICAL_ARCHITECTURE.html');

fs.writeFileSync(outFile, HTML, 'utf8');
console.log('HTML diagram written to:');
console.log('  ' + outFile);
console.log('');
console.log('Open in any browser — double-click the file or run:');
console.log('  start ' + outFile);
