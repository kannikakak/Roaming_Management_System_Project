import express, { Express } from 'express';
import { json, urlencoded } from 'body-parser';
import cors from 'cors';
import { createConnection, Connection } from 'mysql2/promise';
import { setRoutes } from './routes/index';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Store connection globally
let dbConnection: Connection;

// Middleware
app.use(cors());
app.use(json());
app.use(urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // Serve uploaded files statically

// Database connection
const initDatabase = async (): Promise<Connection> => {
    try {
        console.log('Connecting to:', {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
        });

        const connection = await createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT) || 3306,
        });
        console.log('✅ Database connected successfully');
        dbConnection = connection;
        return connection;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
};

// Start the server
const startServer = async () => {
    await initDatabase();
    setRoutes(app, dbConnection);
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
};

startServer();