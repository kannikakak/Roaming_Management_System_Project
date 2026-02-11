import express, { Express } from 'express';
import { json, urlencoded } from 'body-parser';
import cors from 'cors';
import { dbPool } from './db';
import { setRoutes } from './routes/index';
import { startBackupScheduler } from "./services/backupScheduler";
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app: Express = express();
const PORT = process.env.PORT || 3000;


// Middleware
app.use(cors());
app.use(json());
app.use(urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // Serve uploaded files statically

// Database pool is imported from db.ts

// Start the server
const startServer = async () => {
    // Optionally, test the connection here if you want
    setRoutes(app, dbPool);
    await startBackupScheduler(dbPool);
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
};

startServer();
