/**
 * Generates a PNG from a PlantUML .puml file using the public PlantUML server.
 * No Java or local PlantUML install required.
 *
 * Usage:
 *   node scripts/generate-diagram.js [path/to/file.puml] [output.png]
 *
 * Defaults:
 *   input  → ../../../use_case_diagram.puml  (repo root)
 *   output → ../../../use_case_diagram.png   (repo root)
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

// ── PlantUML 6-bit encoding ────────────────────────────────────────────────
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6(b) {
  return ALPHABET[b & 0x3F];
}

function encode3bytes(b1, b2, b3) {
  return (
    encode6( b1 >> 2) +
    encode6(((b1 & 0x3) << 4) | (b2 >> 4)) +
    encode6(((b2 & 0xF) << 2) | (b3 >> 6)) +
    encode6(  b3 & 0x3F)
  );
}

function encodePlantUML(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i += 3) {
    const b1 = buf[i];
    const b2 = i + 1 < buf.length ? buf[i + 1] : 0;
    const b3 = i + 2 < buf.length ? buf[i + 2] : 0;
    out += encode3bytes(b1, b2, b3);
  }
  return out;
}
// ──────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const inputArg  = process.argv[2];
const outputArg = process.argv[3];

const inputFile  = inputArg
  ? path.resolve(inputArg)
  : path.join(REPO_ROOT, 'use_case_diagram.puml');

const outputFile = outputArg
  ? path.resolve(outputArg)
  : inputFile.replace(/\.puml$/i, '.png');

// ── Read & validate ────────────────────────────────────────────────────────
if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const pumlSource = fs.readFileSync(inputFile, 'utf-8');
console.log(`Input : ${inputFile}`);
console.log(`Output: ${outputFile}`);

// ── Compress + encode ──────────────────────────────────────────────────────
const compressed = zlib.deflateRawSync(Buffer.from(pumlSource, 'utf-8'), { level: 9 });
const encoded    = encodePlantUML(compressed);

const formats = { png: 'png', svg: 'svg', txt: 'txt' };
const ext     = path.extname(outputFile).slice(1).toLowerCase();
const format  = formats[ext] || 'png';

const serverUrl = `https://www.plantuml.com/plantuml/${format}/${encoded}`;
console.log(`\nFetching from PlantUML server...`);

// ── Download ───────────────────────────────────────────────────────────────
const dest = fs.createWriteStream(outputFile);

https.get(serverUrl, (res) => {
  if (res.statusCode !== 200) {
    console.error(`Server returned HTTP ${res.statusCode}`);
    process.exit(1);
  }
  res.pipe(dest);
  dest.on('finish', () => {
    dest.close();
    console.log(`Done! Diagram saved to:\n  ${outputFile}`);
  });
}).on('error', (err) => {
  fs.unlink(outputFile, () => {});
  console.error('Request failed:', err.message);
  process.exit(1);
});
