import { Request, Response } from "express";
import { Pool } from "mysql2/promise";

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
    if (schema.hasUserRolesTable && schema.hasRolesTable) {
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
      return res.json({ ok: true });
    }

    if (schema.hasRole) {
      await dbPool.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
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
