"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = require("body-parser");
const promise_1 = require("mysql2/promise");
const index_1 = require("./routes/index");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Store connection globally
let dbConnection;
// Middleware
app.use((0, body_parser_1.json)());
// Database connection
const initDatabase = async () => {
    try {
        console.log('Connecting to:', {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
        });
        dbConnection = await (0, promise_1.createConnection)({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT) || 3306,
        });
        console.log('✅ Database connected successfully');
        return dbConnection;
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
};
// Start the server
const startServer = async () => {
    await initDatabase();
    // Initialize routes and pass connection
    (0, index_1.setRoutes)(app, dbConnection);
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
};
startServer();
