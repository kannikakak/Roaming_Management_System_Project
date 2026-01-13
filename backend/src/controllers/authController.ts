import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Pool } from 'mysql2/promise';

export const register = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'All fields are required.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user directly with role
    const [userResult]: any = await dbPool.query(
      'INSERT INTO users (`name`, `email`, `password`, `role`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [name, email, hashedPassword, role]
    );

    res.json({ message: 'Registration successful.' });
  } catch (err: any) {
    console.error('Registration error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Email already exists.' });
    }
    res.status(500).json({ message: 'Database error.' });
  }
};

export const login = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  try {
    // Query user by email
    const [results]: any = await dbPool.query(
      `SELECT id, name, email, password, role FROM users WHERE email = ?`,
      [email]
    );
    if (results.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const user = results[0];
    if (!user.password) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Database error.' });
  }
};