import express from 'express';
import { json } from 'body-parser';
import dotenv from 'dotenv';
import cors from 'cors';
import { dbPool } from './db';
import { setRoutes } from './routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Use CORS middleware
app.use(cors());

app.use(json());

// Test DB connection safely
const testDatabase = async () => {
    try {
        console.log('🔄 Testing database connection...');
        console.log('Database config:', {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT,
        });
        
        const connection = await dbPool.getConnection();
        console.log('✅ Database connected successfully (pool)');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        return false;
    }
};

const startServer = async () => {
    const dbConnected = await testDatabase();
    
    if (!dbConnected) {
        console.error('❌ Cannot start server without database connection');
        console.error('Make sure:');
        console.error('  1. MySQL is running on port 3306');
        console.error('  2. Database "roaming_interconnect_system" exists');
        console.error('  3. Credentials are correct (root/12345678)');
        process.exit(1);
    }

    setRoutes(app, dbPool);

    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
};

startServer();
