import bcrypt from "bcryptjs";
import { Pool } from "mysql2/promise";

type UserSchemaInfo = {
  hasFullName: boolean;
  hasPasswordHash: boolean;
  hasName: boolean;
  hasPassword: boolean;
  hasRole: boolean;
  hasIsActive: boolean;
  hasUserRolesTable: boolean;
  hasRolesTable: boolean;
  hasAuthProvider: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function parseBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

async function getUserSchemaInfo(dbPool: Pool): Promise<UserSchemaInfo> {
  const [columns]: any = await dbPool.query("SHOW COLUMNS FROM users");
  const names = new Set(columns.map((c: any) => String(c.Field)));

  const [tables]: any = await dbPool.query("SHOW TABLES");
  const tableNames = new Set(tables.map((r: any) => String(Object.values(r)[0])));

  return {
    hasFullName: names.has("full_name"),
    hasPasswordHash: names.has("password_hash"),
    hasName: names.has("name"),
    hasPassword: names.has("password"),
    hasRole: names.has("role"),
    hasIsActive: names.has("is_active"),
    hasUserRolesTable: tableNames.has("user_roles"),
    hasRolesTable: tableNames.has("roles"),
    hasAuthProvider: names.has("auth_provider"),
  };
}

async function ensureAdminRoleId(dbPool: Pool) {
  const [rows]: any = await dbPool.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
  if (rows?.length) return Number(rows[0].id);
  const [result]: any = await dbPool.query("INSERT INTO roles (name) VALUES ('admin')");
  return Number(result.insertId);
}

async function ensureUserHasAdminRole(dbPool: Pool, userId: number) {
  const roleId = await ensureAdminRoleId(dbPool);
  await dbPool.query("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [
    userId,
    roleId,
  ]);
}

export async function ensureBootstrapAdmin(dbPool: Pool) {
  const emailRaw = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const passwordRaw = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!emailRaw || !passwordRaw) return;

  const email = normalizeEmail(emailRaw);
  const name = (process.env.BOOTSTRAP_ADMIN_NAME || "Admin").trim() || "Admin";
  const resetPassword = parseBool(process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD, false);

  let schema: UserSchemaInfo;
  try {
    schema = await getUserSchemaInfo(dbPool);
  } catch (err) {
    console.warn("⚠️  Bootstrap admin skipped (schema unavailable):", err);
    return;
  }

  try {
    if (schema.hasFullName && schema.hasPasswordHash) {
      const [rows]: any = await dbPool.query(
        `SELECT id, password_hash as passwordHash${schema.hasAuthProvider ? ", auth_provider as authProvider" : ""}
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [email]
      );
      if (!rows.length) {
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);

        const columns = ["full_name", "email", "password_hash"];
        const placeholders = ["?", "?", "?"];
        const values: any[] = [name, email, hashedPassword];

        if (schema.hasAuthProvider) {
          columns.push("auth_provider");
          placeholders.push("?");
          values.push("local");
        }
        if (schema.hasIsActive) {
          columns.push("is_active");
          placeholders.push("?");
          values.push(1);
        }

        const [result]: any = await dbPool.query(
          `INSERT INTO users (${columns.join(", ")}, created_at) VALUES (${placeholders.join(", ")}, NOW())`,
          values
        );
        const userId = Number(result.insertId);

        if (schema.hasUserRolesTable && schema.hasRolesTable) {
          await ensureUserHasAdminRole(dbPool, userId);
        }

        console.log(`✅ Bootstrapped admin user created: ${email}`);
        return;
      }

      const userId = Number(rows[0].id);
      if (schema.hasUserRolesTable && schema.hasRolesTable) {
        await ensureUserHasAdminRole(dbPool, userId);
      }

      if (resetPassword) {
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);
        await dbPool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
          hashedPassword,
          userId,
        ]);
        console.log(`✅ Bootstrapped admin password reset: ${email}`);
      }

      return;
    }

    if (schema.hasName && schema.hasPassword && schema.hasRole) {
      const [rows]: any = await dbPool.query(
        `SELECT id, password as passwordHash FROM users WHERE email = ? LIMIT 1`,
        [email]
      );
      if (!rows.length) {
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);
        const [result]: any = await dbPool.query(
          "INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', NOW(), NOW())",
          [name, email, hashedPassword]
        );
        console.log(`✅ Bootstrapped admin user created: ${email}`);
        return;
      }

      if (resetPassword) {
        const userId = Number(rows[0].id);
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);
        await dbPool.query("UPDATE users SET password = ?, role = 'admin' WHERE id = ?", [
          hashedPassword,
          userId,
        ]);
        console.log(`✅ Bootstrapped admin password reset: ${email}`);
      }

      return;
    }

    console.warn("⚠️  Bootstrap admin skipped (unsupported user schema).");
  } catch (err) {
    console.warn("⚠️  Bootstrap admin failed:", err);
  }
}

