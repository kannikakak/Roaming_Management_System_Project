import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
import { Pool } from "mysql2/promise";

const jwtSecret = (process.env.JWT_SECRET || "dev_secret_change_me") as jwt.Secret;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

type UserSchemaInfo = {
  hasFullName: boolean;
  hasPasswordHash: boolean;
  hasName: boolean;
  hasPassword: boolean;
  hasRole: boolean;
  hasProfileImageUrl: boolean;
  hasIsActive: boolean;
  hasUserRolesTable: boolean;
  hasRolesTable: boolean;
};

const schemaCache: { info?: UserSchemaInfo } = {};

async function getUserSchemaInfo(dbPool: Pool): Promise<UserSchemaInfo> {
  if (schemaCache.info) return schemaCache.info;

  const [columns]: any = await dbPool.query("SHOW COLUMNS FROM users");
  const names = new Set(columns.map((c: any) => String(c.Field)));

  const [tables]: any = await dbPool.query("SHOW TABLES");
  const tableNames = new Set(
    tables.map((r: any) => String(Object.values(r)[0]))
  );

  schemaCache.info = {
    hasFullName: names.has("full_name"),
    hasPasswordHash: names.has("password_hash"),
    hasName: names.has("name"),
    hasPassword: names.has("password"),
    hasRole: names.has("role"),
    hasProfileImageUrl: names.has("profile_image_url"),
    hasIsActive: names.has("is_active"),
    hasUserRolesTable: tableNames.has("user_roles"),
    hasRolesTable: tableNames.has("roles"),
  };

  return schemaCache.info;
}

export const register = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields are required." });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const schema = await getUserSchemaInfo(dbPool);

    if (schema.hasFullName && schema.hasPasswordHash && schema.hasUserRolesTable && schema.hasRolesTable) {
      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();

        const [roleRows]: any = await conn.query("SELECT id FROM roles WHERE name = ? LIMIT 1", [
          role,
        ]);
        if (!roleRows.length) {
          await conn.rollback();
          return res.status(400).json({ message: "Invalid role." });
        }
        const roleId = roleRows[0].id as number;

        const [userResult]: any = await conn.query(
          "INSERT INTO users (full_name, email, password_hash, created_at) VALUES (?, ?, ?, NOW())",
          [name, email, hashedPassword]
        );
        const userId = userResult.insertId as number;

        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
          userId,
          roleId,
        ]);

        await conn.commit();
        res.json({ message: "Registration successful." });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } else if (schema.hasName && schema.hasPassword && schema.hasRole) {
      await dbPool.query(
        "INSERT INTO users (`name`, `email`, `password`, `role`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, NOW(), NOW())",
        [name, email, hashedPassword, role]
      );
      res.json({ message: "Registration successful." });
    } else {
      return res.status(500).json({ message: "User schema is missing required columns." });
    }
  } catch (err: any) {
    console.error("Registration error:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email already exists." });
    }
    res.status(500).json({ message: "Database error." });
  }
};

export const login = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }
  try {
    const schema = await getUserSchemaInfo(dbPool);

    if (schema.hasFullName && schema.hasPasswordHash && schema.hasUserRolesTable && schema.hasRolesTable) {
      const [results]: any = await dbPool.query(
        `SELECT u.id, u.full_name, u.email, u.password_hash${schema.hasProfileImageUrl ? ", u.profile_image_url" : ""}${schema.hasIsActive ? ", u.is_active" : ""},
                GROUP_CONCAT(r.name) as roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.email = ?
         GROUP BY u.id`,
        [email]
      );
      if (results.length === 0) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const user = results[0];
      if (schema.hasIsActive && user.is_active === 0) {
        return res.status(403).json({ message: "Account disabled." });
      }
      if (!user.password_hash) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const role = user.roles ? String(user.roles).split(",")[0] : "viewer";
      const token = jwt.sign(
        { id: user.id, email: user.email, role },
        jwtSecret,
        { expiresIn: jwtExpiresIn }
      );

      res.json({
        message: "Login successful.",
        token,
        user: {
          id: user.id,
          name: user.full_name,
          email: user.email,
          role,
          profileImageUrl: schema.hasProfileImageUrl ? user.profile_image_url || null : null,
        },
      });
    } else if (schema.hasName && schema.hasPassword && schema.hasRole) {
      const [results]: any = await dbPool.query(
        `SELECT id, name, email, password, role${schema.hasIsActive ? ", is_active" : ""} FROM users WHERE email = ?`,
        [email]
      );
      if (results.length === 0) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const user = results[0];
      if (schema.hasIsActive && user.is_active === 0) {
        return res.status(403).json({ message: "Account disabled." });
      }
      if (!user.password) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(400).json({ message: "Invalid credentials." });
      }

      const role = user.role || "viewer";
      const token = jwt.sign(
        { id: user.id, email: user.email, role },
        jwtSecret,
        { expiresIn: jwtExpiresIn }
      );

      res.json({
        message: "Login successful.",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role,
          profileImageUrl: null,
        },
      });
    } else {
      return res.status(500).json({ message: "User schema is missing required columns." });
    }
  } catch (err: any) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Database error." });
  }
};

export const getMe = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const schema = await getUserSchemaInfo(dbPool);
  if (schema.hasFullName) {
    const selectProfile = schema.hasProfileImageUrl ? ", u.profile_image_url as profileImageUrl" : "";
    const selectRole = schema.hasUserRolesTable && schema.hasRolesTable
      ? ", GROUP_CONCAT(r.name) as roles"
      : "";
    const [rows]: any = await dbPool.query(
      `SELECT u.id, u.full_name as name, u.email${selectProfile}${selectRole}
       FROM users u
       ${schema.hasUserRolesTable && schema.hasRolesTable ? "LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id" : ""}
       WHERE u.id = ?
       GROUP BY u.id`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    return res.json({
      ...rows[0],
      profileImageUrl: schema.hasProfileImageUrl ? rows[0].profileImageUrl || null : null,
      role: rows[0].roles ? String(rows[0].roles).split(",")[0] : "viewer",
    });
  }

  const selectRole = schema.hasRole ? ", role" : "";
  const [rows]: any = await dbPool.query(
    `SELECT id, name, email${selectRole} FROM users WHERE id = ?`,
    [userId]
  );
  if (!rows.length) return res.status(404).json({ message: "User not found" });
  return res.json({
    ...rows[0],
    profileImageUrl: null,
    role: rows[0].role || "viewer",
  });
};

export const updateProfile = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { name, email } = req.body as { name?: string; email?: string };
  if (!name || !email) return res.status(400).json({ message: "name and email are required" });

  const schema = await getUserSchemaInfo(dbPool);
  const nameCol = schema.hasFullName ? "full_name" : "name";

  try {
    await dbPool.query(`UPDATE users SET ${nameCol} = ?, email = ? WHERE id = ?`, [
      name,
      email,
      userId,
    ]);

    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email already exists." });
    }
    return res.status(500).json({ message: "Database error." });
  }
};

export const changePassword = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "currentPassword and newPassword are required" });
  }

  const schema = await getUserSchemaInfo(dbPool);
  const passCol = schema.hasPasswordHash ? "password_hash" : "password";

  const [rows]: any = await dbPool.query(`SELECT ${passCol} as password FROM users WHERE id = ?`, [
    userId,
  ]);
  if (!rows.length) return res.status(404).json({ message: "User not found" });

  const match = await bcrypt.compare(currentPassword, rows[0].password);
  if (!match) return res.status(400).json({ message: "Current password is incorrect" });

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await dbPool.query(`UPDATE users SET ${passCol} = ? WHERE id = ?`, [
    hashedPassword,
    userId,
  ]);

  res.json({ ok: true });
};

export const uploadProfileImage = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!req.file) return res.status(400).json({ message: "Image file is required" });

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasProfileImageUrl) {
    return res.status(400).json({ message: "Profile image is not supported on this database." });
  }

  const fileUrl = `/uploads/profile/${req.file.filename}`;
  await dbPool.query("UPDATE users SET profile_image_url = ? WHERE id = ?", [fileUrl, userId]);

  res.json({ ok: true, profileImageUrl: fileUrl });
};

export const deleteProfileImage = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasProfileImageUrl) {
    return res.status(400).json({ message: "Profile image is not supported on this database." });
  }

  const [rows]: any = await dbPool.query(
    "SELECT profile_image_url as profileImageUrl FROM users WHERE id = ?",
    [userId]
  );
  if (rows.length && rows[0].profileImageUrl) {
    const relPath = String(rows[0].profileImageUrl).replace(/^[\\/]+/, "");
    const filePath = path.join(process.cwd(), relPath);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore missing file
    }
  }

  await dbPool.query("UPDATE users SET profile_image_url = NULL WHERE id = ?", [userId]);
  res.json({ ok: true });
};
