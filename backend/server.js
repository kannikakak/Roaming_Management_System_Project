const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csvParse = require('csv-parse/sync');
const XLSX = require('xlsx');
const cors = require('cors');

const app = express();
const PORT = 3001;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// Helper: get all files sorted by mtime (newest first)
function getFilesMeta() {
  return fs.readdirSync(uploadDir)
    .map(filename => {
      const stat = fs.statSync(path.join(uploadDir, filename));
      // Try to extract cardId from filename if needed (e.g., "cardId-uniquename-originalname")
      const nameParts = filename.split('-');
      let cardId = null;
      if (nameParts.length > 2 && !isNaN(Number(nameParts[0]))) {
        cardId = nameParts[0];
      }
      return {
        id: filename, // use filename as unique ID
        name: nameParts.slice(1).join('-'),
        uploadedAt: stat.mtime.toISOString(),
        path: filename,
        cardId
      };
    })
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

// Upload endpoint (no DB)
app.post('/api/files/upload', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  res.json({ success: true });
});

// List files by reading upload directory, filter by cardId if provided
app.get('/api/files', (req, res) => {
  const { cardId } = req.query;
  let files = getFilesMeta();
  if (cardId) {
    files = files.filter(f => f.cardId === cardId);
  }
  res.json({ files });
});

// Preview file data by parsing file on demand
app.get('/api/files/:id/data', (req, res) => {
  const filename = req.params.id;
  const filePath = path.join(uploadDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = path.extname(filename).toLowerCase();
  try {
    let columns = [];
    let rows = [];
    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      const records = csvParse.parse(content, { columns: true });
      if (records.length > 0) columns = Object.keys(records[0]);
      rows = records;
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      if (sheet.length > 0) columns = Object.keys(sheet[0]);
      rows = sheet;
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    res.json({ columns, rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

app.use('/uploads', express.static(uploadDir));

// Serve static frontend files (if you build React to 'build' folder)
// Uncomment if you want to serve frontend from backend
// const frontendDir = path.join(__dirname, '../frontend/build');
// app.use(express.static(frontendDir));
// app.get('*', (req, res) => {
//   res.sendFile(path.join(frontendDir, 'index.html'));
// });

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
