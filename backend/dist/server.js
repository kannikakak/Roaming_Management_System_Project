"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = require("body-parser");
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
const routes_1 = require("./routes");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use((0, body_parser_1.json)());
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
        const connection = await db_1.dbPool.getConnection();
        console.log('✅ Database connected successfully (pool)');
        connection.release();
        return true;
    }
    catch (error) {
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
    (0, routes_1.setRoutes)(app, db_1.dbPool);
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
};
startServer();
