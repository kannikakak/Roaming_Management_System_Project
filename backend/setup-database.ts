#!/usr/bin/env node

/**
 * Database Setup Script
 * Run this to initialize your MySQL database
 * 
 * Usage: npx ts-node setup-database.ts
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'roaming_interconnect_system';
const DB_PORT = Number(process.env.DB_PORT) || 3306;

async function setupDatabase() {
    let connection;

    try {
        // Connect without database first
        console.log(`🔄 Connecting to MySQL at ${DB_HOST}:${DB_PORT}...`);
        connection = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            port: DB_PORT,
        });

        console.log('✅ Connected to MySQL');

        // Read SQL file
        const sqlFilePath = path.join(__dirname, 'setup-db.sql');
        const sql = fs.readFileSync(sqlFilePath, 'utf8');

        // Execute SQL statements
        const statements = sql.split(';').filter((stmt) => stmt.trim());

        for (const statement of statements) {
            if (statement.trim()) {
                console.log(`▶️  Executing: ${statement.substring(0, 50).trim()}...`);
                await connection.execute(statement);
            }
        }

        console.log('✅ Database setup completed successfully!');
        console.log(`📊 Database "${DB_NAME}" is ready`);

    } catch (error) {
        console.error('❌ Database setup failed:', error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

setupDatabase();
