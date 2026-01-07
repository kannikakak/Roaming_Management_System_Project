"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const register = (dbPool) => async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: 'All fields are required.' });
    }
    try {
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        await dbPool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, hashedPassword, role]);
        res.json({ message: 'Registration successful.' });
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email already exists.' });
        }
        res.status(500).json({ message: 'Database error.' });
    }
};
exports.register = register;
const login = (dbPool) => async (req, res) => {
    const { email, password } = req.body;
    try {
        const [results] = await dbPool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (results.length === 0)
            return res.status(400).json({ message: 'Invalid credentials.' });
        const user = results[0];
        const match = await bcryptjs_1.default.compare(password, user.password);
        if (!match)
            return res.status(400).json({ message: 'Invalid credentials.' });
        res.json({ message: 'Login successful.', user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }
    catch {
        res.status(500).json({ message: 'Database error.' });
    }
};
exports.login = login;
