import { Request, Response } from "express";
import { Pool } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { ALLOWED_ROLES, Role, normalizeRole as normalizeRoleConst } from "../constants/roles";
import { writeAuditLog } from "../utils/auditLogger";

type UserSchemaInfo = {
  hasFullName: boolean;
  hasName: boolean;
  hasRole: boolean;
  hasIsActive: boolean;
  hasUserRolesTable: boolean;
  hasRolesTable: boolean;
};

async function getUserSchemaInfo(dbPool: Pool): Promise<UserSchemaInfo> {
  const [columns]: any = await dbPool.query("SHOW COLUMNS FROM users");
  const names = new Set(columns.map((c: any) => String(c.Field)));

  const [tables]: any = await dbPool.query("SHOW TABLES");
  const tableNames = new Set(tables.map((r: any) => String(Object.values(r)[0])));

  return {
    hasFullName: names.has("full_name"),
    hasName: names.has("name"),
    hasRole: names.has("role"),
    hasIsActive: names.has("is_active"),
    hasUserRolesTable: tableNames.has("user_roles"),
    hasRolesTable: tableNames.has("roles"),
  };
}

export const listUsers = (dbPool: Pool) => async (_req: Request, res: Response) => {
  try {
    const schema = await getUserSchemaInfo(dbPool);
    if (schema.hasUserRolesTable && schema.hasRolesTable) {
      const [rows] = await dbPool.query(
        `SELECT u.id, u.full_name as name, u.email, u.is_active as isActive,
                GROUP_CONCAT(r.name) as roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id
         ORDER BY u.id DESC`
      );
      return res.json(rows);
    }

    const nameCol = schema.hasFullName ? "full_name" : "name";
    const [rows] = await dbPool.query(
      `SELECT id, ${nameCol} as name, email, role, ${schema.hasIsActive ? "is_active" : "1"} as isActive
       FROM users ORDER BY id DESC`
    );
    return res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Failed to list users" });
  }
};

export const updateUserRole = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  const { role } = req.body as { role?: string };
  if (!role) return res.status(400).json({ message: "role is required" });

  try {
    const schema = await getUserSchemaInfo(dbPool);
    let previousRole: string | null = null;
    if (schema.hasUserRolesTable && schema.hasRolesTable) {
      const [prevRows]: any = await dbPool.query(
        `SELECT GROUP_CONCAT(r.name) as roles
         FROM user_roles ur
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?
         GROUP BY ur.user_id`,
        [userId]
      );
      previousRole = prevRows?.[0]?.roles || null;
      const [roles]: any = await dbPool.query("SELECT id FROM roles WHERE name = ? LIMIT 1", [
        role,
      ]);
      if (!roles.length) return res.status(400).json({ message: "Invalid role" });
      const roleId = roles[0].id as number;

      await dbPool.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await dbPool.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
        userId,
        roleId,
      ]);
      await writeAuditLog(dbPool, {
        req,
        action: "user_role_changed",
        details: {
          targetUserId: userId,
          previousRole,
          nextRole: role,
        },
      });
      return res.json({ ok: true });
    }

    if (schema.hasRole) {
      const [prevRows]: any = await dbPool.query(
        "SELECT role FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      previousRole = prevRows?.[0]?.role || null;
      await dbPool.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
      await writeAuditLog(dbPool, {
        req,
        action: "user_role_changed",
        details: {
          targetUserId: userId,
          previousRole,
          nextRole: role,
        },
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ message: "Role management not supported for this schema" });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Failed to update role" });
  }
};

export const updateUserStatus = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  const { isActive } = req.body as { isActive?: boolean };
  if (isActive === undefined) {
    return res.status(400).json({ message: "isActive is required" });
  }

  try {
    const schema = await getUserSchemaInfo(dbPool);
    if (!schema.hasIsActive) {
      return res.status(400).json({ message: "User status is not supported for this schema" });
    }
    await dbPool.query("UPDATE users SET is_active = ? WHERE id = ?", [
      isActive ? 1 : 0,
      userId,
    ]);
    return res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Failed to update status" });
  }
};

export const createUser = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, email, password, role, isActive } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    isActive?: boolean;
  };
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "name, email, password, and role are required" });
  }
  const normalizedRole = normalizeRoleConst(role);
  if (!normalizedRole) {
    return res.status(400).json({ message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}.` });
  }
  try {
    const schema = await getUserSchemaInfo(dbPool);
    const hashedPassword = await bcrypt.hash(password, 10);

    if (schema.hasUserRolesTable && schema.hasRolesTable) {
      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();
        const [roleRows]: any = await conn.query(
          "SELECT id FROM roles WHERE LOWER(name) = ? LIMIT 1",
          [normalizedRole]
        );
        if (!roleRows.length) {
          await conn.rollback();
          return res.status(400).json({ message: "Invalid role" });
        }
        const roleId = roleRows[0].id as number;
        const nameCol = schema.hasFullName ? "full_name" : "name";
        const [result]: any = await conn.query(
          `INSERT INTO users (${nameCol}, email, password_hash${schema.hasIsActive ? ", is_active" : ""}, created_at) VALUES (?, ?, ?, ${schema.hasIsActive ? "?" : ""}, NOW())`,
          schema.hasIsActive ? [name, email, hashedPassword, isActive ? 1 : 0] : [name, email, hashedPassword]
        );
        const userId = result.insertId as number;
        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
        await conn.commit();
        return res.status(201).json({ id: userId });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    const nameCol = schema.hasFullName ? "full_name" : "name";
    const roleCol = schema.hasRole ? "role" : null;
    const statusCol = schema.hasIsActive ? "is_active" : null;
    const columns = [nameCol, "email", schema.hasRole ? "password" : "password", ...(roleCol ? [roleCol] : []), ...(statusCol ? [statusCol] : []), "created_at", "updated_at"];
    const placeholders = ["?", "?", "?", ...(roleCol ? ["?"] : []), ...(statusCol ? ["?"] : []), "NOW()", "NOW()"];
    const values: any[] = [name, email, hashedPassword, ...(roleCol ? [normalizedRole] : []), ...(statusCol ? [isActive ? 1 : 0] : [])];
    const [result]: any = await dbPool.query(
      `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );
    return res.status(201).json({ id: result.insertId });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email already exists." });
    }
    return res.status(500).json({ message: err.message || "Failed to create user" });
  }
};

export const updateUser = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  const { name, email, role, isActive } = req.body as {
    name?: string;
    email?: string;
    role?: string;
    isActive?: boolean;
  };
  try {
    const schema = await getUserSchemaInfo(dbPool);
    const updates: string[] = [];
    const params: any[] = [];
    if (name) {
      const nameCol = schema.hasFullName ? "full_name" : "name";
      updates.push(`${nameCol} = ?`);
      params.push(name);
    }
    if (email) {
      updates.push("email = ?");
      params.push(email);
    }
    if (schema.hasIsActive && typeof isActive === "boolean") {
      updates.push("is_active = ?");
      params.push(isActive ? 1 : 0);
    }
    if (updates.length) {
      params.push(userId);
      await dbPool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    if (role) {
      const normalizedRole = normalizeRoleConst(role);
      if (!normalizedRole) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}.` });
      }
      let previousRole: string | null = null;
      if (schema.hasUserRolesTable && schema.hasRolesTable) {
        const [prevRows]: any = await dbPool.query(
          `SELECT GROUP_CONCAT(r.name) as roles
           FROM user_roles ur
           LEFT JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = ?
           GROUP BY ur.user_id`,
          [userId]
        );
        previousRole = prevRows?.[0]?.roles || null;
        const [roles]: any = await dbPool.query("SELECT id FROM roles WHERE LOWER(name) = ? LIMIT 1", [normalizedRole]);
        if (!roles.length) return res.status(400).json({ message: "Invalid role" });
        const roleId = roles[0].id as number;
        await dbPool.query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
        await dbPool.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
      } else if (schema.hasRole) {
        const [prevRows]: any = await dbPool.query(
          "SELECT role FROM users WHERE id = ? LIMIT 1",
          [userId]
        );
        previousRole = prevRows?.[0]?.role || null;
        await dbPool.query("UPDATE users SET role = ? WHERE id = ?", [normalizedRole, userId]);
      }
      await writeAuditLog(dbPool, {
        req,
        action: "user_role_changed",
        details: {
          targetUserId: userId,
          previousRole,
          nextRole: normalizedRole,
          source: "update_user",
        },
      });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email already exists." });
    }
    return res.status(500).json({ message: err.message || "Failed to update user" });
  }
};
