import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { Issuer, generators, Client } from "openid-client";
import { Pool } from "mysql2/promise";
import { ALLOWED_ROLES, Role, normalizeRole as normalizeRoleConst, ensureRole, pickRoleFromCsv } from "../constants/roles";

const jwtSecret = (process.env.JWT_SECRET || "dev_secret_change_me") as jwt.Secret;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";
const refreshTokenSecret = (process.env.REFRESH_TOKEN_SECRET || jwtSecret) as jwt.Secret;
const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || "30d";
const selfRegisterRoles = process.env.SELF_REGISTER_ROLES || "viewer";
const mfaTokenExpiresIn = process.env.MFA_TOKEN_EXPIRES_IN || "10m";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const msTenantId = process.env.MS_TENANT_ID || "common";
const msClientId = process.env.MS_CLIENT_ID || "";
const msClientSecret = process.env.MS_CLIENT_SECRET || "";
const msRedirectUri = process.env.MS_REDIRECT_URI || "";
const msScope = process.env.MS_SCOPE || "openid profile email";
const msDefaultRole = process.env.MS_DEFAULT_ROLE || "viewer";
const mfaIssuer = process.env.MFA_ISSUER || "Cellcard";

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
  hasRefreshTokensTable: boolean;
  hasAuthProvider: boolean;
  hasMicrosoftSub: boolean;
  hasTwoFactorSecret: boolean;
  hasTwoFactorEnabled: boolean;
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
    hasRefreshTokensTable: tableNames.has("refresh_tokens"),
    hasAuthProvider: names.has("auth_provider"),
    hasMicrosoftSub: names.has("microsoft_sub"),
    hasTwoFactorSecret: names.has("two_factor_secret"),
    hasTwoFactorEnabled: names.has("two_factor_enabled"),
  };

  return schemaCache.info;
}

function createAuthToken(userId: number, email: string, roles: Role[]) {
  const primary = roles[0] ?? ensureRole(undefined);
  const options: jwt.SignOptions = { expiresIn: jwtExpiresIn as any };
  return jwt.sign({ id: userId, email, role: primary, roles }, jwtSecret, options);
}

function createRefreshToken(userId: number, email: string, roles: Role[]) {
  const primary = roles[0] ?? ensureRole(undefined);
  const options: jwt.SignOptions = { expiresIn: refreshTokenExpiresIn as any };
  return jwt.sign(
    { id: userId, email, role: primary, roles, jti: crypto.randomUUID() },
    refreshTokenSecret,
    options
  );
}

function createMfaToken(userId: number, email: string, roles: Role[]) {
  const primary = roles[0] ?? ensureRole(undefined);
  const options: jwt.SignOptions = { expiresIn: mfaTokenExpiresIn as any };
  return jwt.sign({ id: userId, email, role: primary, roles, mfa: true }, jwtSecret, options);
}

function buildUserPayload(user: any, role: string, schema: UserSchemaInfo, roles?: Role[]) {
  const name = user.full_name ?? user.name ?? "";
  const profileImageUrl = schema.hasProfileImageUrl
    ? user.profile_image_url ?? user.profileImageUrl ?? null
    : null;
  return {
    id: user.id,
    name,
    email: user.email,
    role,
    roles: roles && roles.length ? roles : undefined,
    profileImageUrl,
    twoFactorEnabled: schema.hasTwoFactorEnabled ? Boolean(user.two_factor_enabled) : false,
  };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getTokenExpiryDate(token: string) {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000);
  }
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function getSelfRegisterRoles(): Role[] {
  const roles = selfRegisterRoles
    .split(",")
    .map((r) => normalizeRoleConst(r.trim()))
    .filter((r): r is Role => Boolean(r));
  return roles.length ? roles : [ensureRole(undefined)];
}

async function storeRefreshToken(
  dbPool: Pool,
  schema: UserSchemaInfo,
  userId: number,
  token: string
) {
  if (!schema.hasRefreshTokensTable) {
    await ensureRefreshTokensTable(dbPool, schema);
  }
  const tokenHash = hashToken(token);
  const expiresAt = getTokenExpiryDate(token);
  await dbPool.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, tokenHash, expiresAt]
  );
}

async function issueTokens(
  dbPool: Pool,
  schema: UserSchemaInfo,
  userId: number,
  email: string,
  roles: Role[]
) {
  const token = createAuthToken(userId, email, roles);
  const refreshToken = createRefreshToken(userId, email, roles);
  await storeRefreshToken(dbPool, schema, userId, refreshToken);
  return { token, refreshToken };
}

async function loadUserForToken(dbPool: Pool, schema: UserSchemaInfo, userId: number) {
  if (schema.hasFullName && schema.hasUserRolesTable && schema.hasRolesTable) {
    const selectProfile = schema.hasProfileImageUrl ? ", u.profile_image_url" : "";
    const selectIsActive = schema.hasIsActive ? ", u.is_active" : "";
    const selectTwoFactor = schema.hasTwoFactorEnabled ? ", u.two_factor_enabled" : "";
    const [rows]: any = await dbPool.query(
      `SELECT u.id, u.full_name, u.email${selectProfile}${selectIsActive}${selectTwoFactor},
              GROUP_CONCAT(r.name) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
       GROUP BY u.id`,
      [userId]
    );
    if (!rows.length) return null;
    const user = rows[0];
    if (schema.hasIsActive && user.is_active === 0) return null;
    const primaryRole = pickRoleFromCsv(user.roles, "viewer");
    const roles: Role[] = String(user.roles || "")
      .split(",")
      .map((r: string) => normalizeRoleConst(r))
      .filter((r): r is Role => Boolean(r));
    const rolesArr = roles.length ? roles : [primaryRole];
    return { id: user.id, email: user.email, roles: rolesArr };
  }

  const selectIsActive = schema.hasIsActive ? ", is_active" : "";
  const [rows]: any = await dbPool.query(
    `SELECT id, email, role${selectIsActive} FROM users WHERE id = ?`,
    [userId]
  );
  if (!rows.length) return null;
  const user = rows[0];
  if (schema.hasIsActive && user.is_active === 0) return null;
  const role = ensureRole(user.role);
  return { id: user.id, email: user.email, roles: [role] };
}

async function ensureRefreshTokensTable(dbPool: Pool, schema: UserSchemaInfo) {
  if (schema.hasRefreshTokensTable) return;
  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      replaced_by_token_hash VARCHAR(128) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`
  );
  schema.hasRefreshTokensTable = true;
  if (schemaCache.info) schemaCache.info.hasRefreshTokensTable = true;
}

function getFrontendCallbackUrl() {
  return `${frontendUrl.replace(/\/$/, "")}/auth/microsoft/callback`;
}

let microsoftClientPromise: Promise<Client> | null = null;

async function getMicrosoftClient() {
  if (!msClientId || !msClientSecret || !msRedirectUri) {
    throw new Error("Microsoft OAuth is not configured.");
  }
  if (!microsoftClientPromise) {
    const issuerUrl = `https://login.microsoftonline.com/${msTenantId}/v2.0/.well-known/openid-configuration`;
    microsoftClientPromise = Issuer.discover(issuerUrl).then((issuer) => {
      return new issuer.Client({
        client_id: msClientId,
        client_secret: msClientSecret,
        redirect_uris: [msRedirectUri],
        response_types: ["code"],
      });
    });
  }
  return microsoftClientPromise;
}

function generateRandomPassword() {
  return crypto.randomBytes(32).toString("hex");
}

export const register = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "All fields are required." });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const schema = await getUserSchemaInfo(dbPool);
    const allowedSelfRegisterRoles = getSelfRegisterRoles();

    if (schema.hasFullName && schema.hasPasswordHash && schema.hasUserRolesTable && schema.hasRolesTable) {
      const normalizedRole = normalizeRoleConst(String(role));
      if (!normalizedRole) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}.` });
      }
      if (!allowedSelfRegisterRoles.includes(normalizedRole)) {
        return res.status(403).json({ message: "Role not allowed for self-registration." });
      }
      const conn = await dbPool.getConnection();
      try {
        await conn.beginTransaction();

        const [roleRows]: any = await conn.query("SELECT id FROM roles WHERE LOWER(name) = ? LIMIT 1", [
          normalizedRole,
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
      const normalizedRole = normalizeRoleConst(String(role));
      if (!normalizedRole) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(", ")}.` });
      }
      if (!allowedSelfRegisterRoles.includes(normalizedRole)) {
        return res.status(403).json({ message: "Role not allowed for self-registration." });
      }
      await dbPool.query(
        "INSERT INTO users (`name`, `email`, `password`, `role`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, NOW(), NOW())",
        [name, email, hashedPassword, normalizedRole]
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
        `SELECT u.id, u.full_name, u.email, u.password_hash${schema.hasProfileImageUrl ? ", u.profile_image_url" : ""}${schema.hasIsActive ? ", u.is_active" : ""}${schema.hasTwoFactorEnabled ? ", u.two_factor_enabled" : ""},
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

      const primaryRole = pickRoleFromCsv(user.roles, "viewer");
      const roles = String(user.roles || "")
        .split(",")
        .map((r: string) => normalizeRoleConst(r))
        .filter((r): r is Role => Boolean(r));
      const rolesArr = roles.length ? roles : [primaryRole];
      const twoFactorEnabled = schema.hasTwoFactorEnabled && user.two_factor_enabled === 1;
      if (twoFactorEnabled) {
        const mfaToken = createMfaToken(user.id, user.email, rolesArr);
        return res.json({
          requires2fa: true,
          mfaToken,
          user: { id: user.id, email: user.email },
        });
      }

      const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, rolesArr);
      res.json({
        message: "Login successful.",
        token,
        refreshToken,
        user: buildUserPayload(user, primaryRole, schema, rolesArr),
      });
    } else if (schema.hasName && schema.hasPassword && schema.hasRole) {
      const [results]: any = await dbPool.query(
        `SELECT id, name, email, password, role${schema.hasIsActive ? ", is_active" : ""}${schema.hasTwoFactorEnabled ? ", two_factor_enabled" : ""} FROM users WHERE email = ?`,
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

      const role = ensureRole(user.role);
      const rolesArr: Role[] = [role];
      const twoFactorEnabled = schema.hasTwoFactorEnabled && user.two_factor_enabled === 1;
      if (twoFactorEnabled) {
        const mfaToken = createMfaToken(user.id, user.email, rolesArr);
        return res.json({
          requires2fa: true,
          mfaToken,
          user: { id: user.id, email: user.email },
        });
      }

      const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, rolesArr);
      res.json({
        message: "Login successful.",
        token,
        refreshToken,
        user: buildUserPayload(user, role, schema, rolesArr),
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
    const selectTwoFactor = schema.hasTwoFactorEnabled ? ", u.two_factor_enabled as twoFactorEnabled" : "";
    const [rows]: any = await dbPool.query(
      `SELECT u.id, u.full_name as name, u.email${selectProfile}${selectRole}${selectTwoFactor}
       FROM users u
       ${schema.hasUserRolesTable && schema.hasRolesTable ? "LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id" : ""}
       WHERE u.id = ?
       GROUP BY u.id`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    const primaryRole = pickRoleFromCsv(rows[0].roles, "viewer");
    const roles: Role[] = String(rows[0].roles || "")
      .split(",")
      .map((r: string) => normalizeRoleConst(r))
      .filter((r): r is Role => Boolean(r));
    const rolesArr = roles.length ? roles : [primaryRole];
    return res.json({
      ...rows[0],
      profileImageUrl: schema.hasProfileImageUrl ? rows[0].profileImageUrl || null : null,
      role: primaryRole,
      roles: rolesArr,
      twoFactorEnabled: schema.hasTwoFactorEnabled ? Boolean(rows[0].twoFactorEnabled) : false,
    });
  }

  const selectRole = schema.hasRole ? ", role" : "";
  const selectTwoFactor = schema.hasTwoFactorEnabled ? ", two_factor_enabled as twoFactorEnabled" : "";
  const [rows]: any = await dbPool.query(
    `SELECT id, name, email${selectRole}${selectTwoFactor} FROM users WHERE id = ?`,
    [userId]
  );
  if (!rows.length) return res.status(404).json({ message: "User not found" });
  const primaryRole = ensureRole(rows[0].role);
  return res.json({
    ...rows[0],
    profileImageUrl: null,
    role: primaryRole,
    roles: [primaryRole],
    twoFactorEnabled: schema.hasTwoFactorEnabled ? Boolean(rows[0].twoFactorEnabled) : false,
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

export const setupTwoFactor = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasTwoFactorSecret || !schema.hasTwoFactorEnabled) {
    return res.status(400).json({ message: "Two-factor authentication is not available." });
  }

  const [rows]: any = await dbPool.query("SELECT email FROM users WHERE id = ?", [userId]);
  if (!rows.length) return res.status(404).json({ message: "User not found" });

  const email = rows[0].email as string;
  const secret = speakeasy.generateSecret({ name: `${mfaIssuer} (${email})` });
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    label: `${mfaIssuer}:${email}`,
    issuer: mfaIssuer,
    encoding: "base32",
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  await dbPool.query(
    "UPDATE users SET two_factor_secret = ?, two_factor_enabled = 0 WHERE id = ?",
    [secret.base32, userId]
  );

  res.json({ otpauthUrl, qrCodeDataUrl, secret: secret.base32 });
};

export const enableTwoFactor = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ message: "Verification code is required." });

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasTwoFactorSecret || !schema.hasTwoFactorEnabled) {
    return res.status(400).json({ message: "Two-factor authentication is not available." });
  }

  const [rows]: any = await dbPool.query(
    "SELECT two_factor_secret FROM users WHERE id = ?",
    [userId]
  );
  if (!rows.length || !rows[0].two_factor_secret) {
    return res.status(400).json({ message: "Two-factor setup is not initialized." });
  }

  const isValid = speakeasy.totp.verify({
    secret: rows[0].two_factor_secret,
    encoding: "base32",
    token: String(code).trim(),
    window: 1,
  });
  if (!isValid) return res.status(400).json({ message: "Invalid verification code." });

  await dbPool.query("UPDATE users SET two_factor_enabled = 1 WHERE id = ?", [userId]);
  res.json({ ok: true });
};

export const disableTwoFactor = (dbPool: Pool) => async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ message: "Verification code is required." });

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasTwoFactorSecret || !schema.hasTwoFactorEnabled) {
    return res.status(400).json({ message: "Two-factor authentication is not available." });
  }

  const [rows]: any = await dbPool.query(
    "SELECT two_factor_secret FROM users WHERE id = ?",
    [userId]
  );
  if (!rows.length || !rows[0].two_factor_secret) {
    return res.status(400).json({ message: "Two-factor is not enabled." });
  }

  const isValid = speakeasy.totp.verify({
    secret: rows[0].two_factor_secret,
    encoding: "base32",
    token: String(code).trim(),
    window: 1,
  });
  if (!isValid) return res.status(400).json({ message: "Invalid verification code." });

  await dbPool.query(
    "UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?",
    [userId]
  );
  res.json({ ok: true });
};

export const verifyTwoFactorLogin = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body as { mfaToken?: string; code?: string };
  if (!mfaToken || !code) {
    return res.status(400).json({ message: "mfaToken and code are required." });
  }

  let payload: any = null;
  try {
    payload = jwt.verify(mfaToken, jwtSecret) as any;
  } catch {
    return res.status(401).json({ message: "Invalid verification token." });
  }

  if (!payload?.mfa || !payload?.id) {
    return res.status(401).json({ message: "Invalid verification token." });
  }

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasTwoFactorSecret || !schema.hasTwoFactorEnabled) {
    return res.status(400).json({ message: "Two-factor authentication is not available." });
  }

  if (schema.hasFullName && schema.hasPasswordHash && schema.hasUserRolesTable && schema.hasRolesTable) {
    const selectProfile = schema.hasProfileImageUrl ? ", u.profile_image_url" : "";
    const selectIsActive = schema.hasIsActive ? ", u.is_active" : "";
    const [rows]: any = await dbPool.query(
      `SELECT u.id, u.full_name, u.email, u.two_factor_secret, u.two_factor_enabled${selectProfile}${selectIsActive},
              GROUP_CONCAT(r.name) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
       GROUP BY u.id`,
      [payload.id]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found" });

    const user = rows[0];
    if (schema.hasIsActive && user.is_active === 0) {
      return res.status(403).json({ message: "Account disabled." });
    }
    if (!user.two_factor_secret || user.two_factor_enabled !== 1) {
      return res.status(400).json({ message: "Two-factor is not enabled." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });
    if (!isValid) return res.status(400).json({ message: "Invalid verification code." });

    const primaryRole = pickRoleFromCsv(user.roles, "viewer");
    const roles: Role[] = String(user.roles || "")
      .split(",")
      .map((r: string) => normalizeRoleConst(r))
      .filter((r): r is Role => Boolean(r));
    const rolesArr = roles.length ? roles : [primaryRole];
    const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, rolesArr);
    return res.json({
      message: "Login successful.",
      token,
      refreshToken,
      user: buildUserPayload(user, primaryRole, schema, rolesArr),
    });
  }

  if (schema.hasName && schema.hasRole) {
    const selectIsActive = schema.hasIsActive ? ", is_active" : "";
    const [rows]: any = await dbPool.query(
      `SELECT id, name, email, role, two_factor_secret, two_factor_enabled${selectIsActive} FROM users WHERE id = ?`,
      [payload.id]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found" });

    const user = rows[0];
    if (schema.hasIsActive && user.is_active === 0) {
      return res.status(403).json({ message: "Account disabled." });
    }
    if (!user.two_factor_secret || user.two_factor_enabled !== 1) {
      return res.status(400).json({ message: "Two-factor is not enabled." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });
    if (!isValid) return res.status(400).json({ message: "Invalid verification code." });

    const role = ensureRole(user.role);
    const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, [role]);
    return res.json({
      message: "Login successful.",
      token,
      refreshToken,
      user: buildUserPayload(user, role, schema, [role]),
    });
  }

  return res.status(500).json({ message: "User schema is missing required columns." });
};

export const startMicrosoftLogin = () => async (_req: Request, res: Response) => {
  try {
    const client = await getMicrosoftClient();
    const nonce = generators.nonce();
    const state = jwt.sign({ nonce }, jwtSecret, { expiresIn: "10m" });
    const url = client.authorizationUrl({
      scope: msScope,
      response_type: "code",
      redirect_uri: msRedirectUri,
      state,
      nonce,
    });
    return res.redirect(url);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Microsoft login is not configured." });
  }
};

export const handleMicrosoftCallback = (dbPool: Pool) => async (req: Request, res: Response) => {
  const redirectBase = getFrontendCallbackUrl();
  const error = req.query.error ? String(req.query.error) : "";
  if (error) {
    const description = req.query.error_description
      ? String(req.query.error_description)
      : error;
    return res.redirect(
      `${redirectBase}?error=${encodeURIComponent(description)}`
    );
  }

  const stateParam = req.query.state;
  if (typeof stateParam !== "string") {
    return res.redirect(`${redirectBase}?error=Invalid%20state`);
  }

  let statePayload: any = null;
  try {
    statePayload = jwt.verify(stateParam, jwtSecret) as any;
  } catch {
    return res.redirect(`${redirectBase}?error=Invalid%20state`);
  }

  try {
    const client = await getMicrosoftClient();
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(msRedirectUri, params, {
      state: stateParam,
      nonce: statePayload?.nonce,
    });

    const claims = tokenSet.claims();
    const email = String(
      claims.email || claims.preferred_username || ""
    ).trim();
    if (!email) {
      return res.redirect(`${redirectBase}?error=Email%20not%20available`);
    }
    const normalizedEmail = email.toLowerCase();
    const name = String(claims.name || normalizedEmail.split("@")[0] || "Microsoft User");
    const sub = String(claims.sub || "");

    const schema = await getUserSchemaInfo(dbPool);
    let user: any = null;

    if (schema.hasFullName && schema.hasPasswordHash && schema.hasUserRolesTable && schema.hasRolesTable) {
      const selectProfile = schema.hasProfileImageUrl ? ", u.profile_image_url" : "";
      const selectIsActive = schema.hasIsActive ? ", u.is_active" : "";
      const selectTwoFactor = schema.hasTwoFactorEnabled ? ", u.two_factor_enabled" : "";
      const selectAuthProvider = schema.hasAuthProvider ? ", u.auth_provider" : "";
      const selectMicrosoftSub = schema.hasMicrosoftSub ? ", u.microsoft_sub" : "";
      const baseQuery = `
        SELECT u.id, u.full_name, u.email${selectProfile}${selectIsActive}${selectTwoFactor}${selectAuthProvider}${selectMicrosoftSub},
               GROUP_CONCAT(r.name) as roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE `;

      if (schema.hasMicrosoftSub && sub) {
        const [rows]: any = await dbPool.query(
          `${baseQuery}u.microsoft_sub = ? GROUP BY u.id`,
          [sub]
        );
        user = rows[0] || null;
      }

      if (!user) {
        const [rows]: any = await dbPool.query(
          `${baseQuery}u.email = ? GROUP BY u.id`,
          [normalizedEmail]
        );
        user = rows[0] || null;
      }

      if (!user) {
        const hashedPassword = await bcrypt.hash(generateRandomPassword(), 10);
        const columns = ["full_name", "email", "password_hash", "created_at"];
        const placeholders = ["?", "?", "?", "NOW()"];
        const values: any[] = [name, normalizedEmail, hashedPassword];
        if (schema.hasAuthProvider) {
          columns.push("auth_provider");
          placeholders.push("?");
          values.push("microsoft");
        }
        if (schema.hasMicrosoftSub && sub) {
          columns.push("microsoft_sub");
          placeholders.push("?");
          values.push(sub);
        }

        const conn = await dbPool.getConnection();
        try {
          await conn.beginTransaction();
          const [roleRows]: any = await conn.query(
            "SELECT id FROM roles WHERE name = ? LIMIT 1",
            [msDefaultRole]
          );
          if (!roleRows.length) {
            await conn.rollback();
            return res.redirect(`${redirectBase}?error=Role%20not%20found`);
          }
          const roleId = roleRows[0].id as number;

          const [userResult]: any = await conn.query(
            `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
            values
          );
          const userId = userResult.insertId as number;
          await conn.query(
            "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
            [userId, roleId]
          );
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }

        const [rows]: any = await dbPool.query(
          `${baseQuery}u.email = ? GROUP BY u.id`,
          [normalizedEmail]
        );
        user = rows[0] || null;
      } else {
        if (schema.hasMicrosoftSub && sub && !user.microsoft_sub) {
          await dbPool.query("UPDATE users SET microsoft_sub = ? WHERE id = ?", [
            sub,
            user.id,
          ]);
        }
        if (schema.hasAuthProvider && !user.auth_provider) {
          await dbPool.query("UPDATE users SET auth_provider = ? WHERE id = ?", [
            "microsoft",
            user.id,
          ]);
        }
      }

      if (!user) {
        return res.redirect(`${redirectBase}?error=Unable%20to%20sign%20in`);
      }
      if (schema.hasIsActive && user.is_active === 0) {
        return res.redirect(`${redirectBase}?error=Account%20disabled`);
      }

      const primaryRole = pickRoleFromCsv(user.roles, ensureRole(msDefaultRole));
      const roles: Role[] = String(user.roles || "")
        .split(",")
        .map((r: string) => normalizeRoleConst(r))
        .filter((r): r is Role => Boolean(r));
      const rolesArr = roles.length ? roles : [primaryRole];
      const twoFactorEnabled = schema.hasTwoFactorEnabled && user.two_factor_enabled === 1;
      if (twoFactorEnabled) {
        const mfaToken = createMfaToken(user.id, user.email, rolesArr);
        return res.redirect(`${redirectBase}?mfaToken=${encodeURIComponent(mfaToken)}`);
      }

      const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, rolesArr);
      return res.redirect(
        `${redirectBase}?token=${encodeURIComponent(token)}&refreshToken=${encodeURIComponent(refreshToken)}`
      );
    }

    if (schema.hasName && schema.hasRole) {
      const selectIsActive = schema.hasIsActive ? ", is_active" : "";
      const selectTwoFactor = schema.hasTwoFactorEnabled ? ", two_factor_enabled" : "";
      const selectAuthProvider = schema.hasAuthProvider ? ", auth_provider" : "";
      const selectMicrosoftSub = schema.hasMicrosoftSub ? ", microsoft_sub" : "";
      let [rows]: any = [null];

      if (schema.hasMicrosoftSub && sub) {
        [rows] = await dbPool.query(
          `SELECT id, name, email, role${selectIsActive}${selectTwoFactor}${selectAuthProvider}${selectMicrosoftSub} FROM users WHERE microsoft_sub = ? LIMIT 1`,
          [sub]
        );
      }
      if (!rows?.length) {
        [rows] = await dbPool.query(
          `SELECT id, name, email, role${selectIsActive}${selectTwoFactor}${selectAuthProvider}${selectMicrosoftSub} FROM users WHERE email = ? LIMIT 1`,
          [normalizedEmail]
        );
      }

      user = rows[0] || null;
      if (!user) {
        const hashedPassword = await bcrypt.hash(generateRandomPassword(), 10);
        const columns = ["name", "email", "password", "role", "created_at", "updated_at"];
        const placeholders = ["?", "?", "?", "?", "NOW()", "NOW()"];
        const values: any[] = [name, normalizedEmail, hashedPassword, msDefaultRole];
        if (schema.hasAuthProvider) {
          columns.push("auth_provider");
          placeholders.push("?");
          values.push("microsoft");
        }
        if (schema.hasMicrosoftSub && sub) {
          columns.push("microsoft_sub");
          placeholders.push("?");
          values.push(sub);
        }
        await dbPool.query(
          `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
          values
        );
        [rows] = await dbPool.query(
          `SELECT id, name, email, role${selectIsActive}${selectTwoFactor}${selectAuthProvider}${selectMicrosoftSub} FROM users WHERE email = ? LIMIT 1`,
          [normalizedEmail]
        );
        user = rows[0] || null;
      } else {
        if (schema.hasMicrosoftSub && sub && !user.microsoft_sub) {
          await dbPool.query("UPDATE users SET microsoft_sub = ? WHERE id = ?", [
            sub,
            user.id,
          ]);
        }
        if (schema.hasAuthProvider && !user.auth_provider) {
          await dbPool.query("UPDATE users SET auth_provider = ? WHERE id = ?", [
            "microsoft",
            user.id,
          ]);
        }
      }

      if (!user) {
        return res.redirect(`${redirectBase}?error=Unable%20to%20sign%20in`);
      }
      if (schema.hasIsActive && user.is_active === 0) {
        return res.redirect(`${redirectBase}?error=Account%20disabled`);
      }

      const role = ensureRole(user.role, ensureRole(msDefaultRole));
      const twoFactorEnabled = schema.hasTwoFactorEnabled && user.two_factor_enabled === 1;
      if (twoFactorEnabled) {
        const mfaToken = createMfaToken(user.id, user.email, [role]);
        return res.redirect(`${redirectBase}?mfaToken=${encodeURIComponent(mfaToken)}`);
      }

      const { token, refreshToken } = await issueTokens(dbPool, schema, user.id, user.email, [role]);
      return res.redirect(
        `${redirectBase}?token=${encodeURIComponent(token)}&refreshToken=${encodeURIComponent(refreshToken)}`
      );
    }

    return res.redirect(`${redirectBase}?error=User%20schema%20missing`);
  } catch (err: any) {
    console.error("Microsoft login error:", err);
    return res.redirect(`${redirectBase}?error=Microsoft%20login%20failed`);
  }
};

export const refreshToken = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body as { refreshToken?: string };
  if (!token) {
    return res.status(400).json({ message: "refreshToken is required." });
  }

  let payload: any = null;
  try {
    payload = jwt.verify(token, refreshTokenSecret) as any;
  } catch {
    return res.status(401).json({ message: "Invalid refresh token." });
  }

  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasRefreshTokensTable) {
    await ensureRefreshTokensTable(dbPool, schema);
  }

  const tokenHash = hashToken(token);
  const [rows]: any = await dbPool.query(
    "SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ? LIMIT 1",
    [tokenHash]
  );
  if (!rows.length) {
    return res.status(401).json({ message: "Invalid refresh token." });
  }
  const record = rows[0];
  if (record.revoked_at || (record.expires_at && new Date(record.expires_at) <= new Date())) {
    return res.status(401).json({ message: "Refresh token expired or revoked." });
  }

  const user = await loadUserForToken(dbPool, schema, Number(record.user_id));
  if (!user || !payload?.id || payload.id !== user.id) {
    return res.status(401).json({ message: "Invalid refresh token." });
  }

  const { token: newAccessToken, refreshToken: newRefreshToken } = await issueTokens(
    dbPool,
    schema,
    user.id,
    user.email,
    user.roles
  );
  const newTokenHash = hashToken(newRefreshToken);
  await dbPool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_token_hash = ? WHERE id = ?",
    [newTokenHash, record.id]
  );

  return res.json({ token: newAccessToken, refreshToken: newRefreshToken });
};

export const logout = (dbPool: Pool) => async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body as { refreshToken?: string };
  if (!token) {
    return res.status(400).json({ message: "refreshToken is required." });
  }
  const schema = await getUserSchemaInfo(dbPool);
  if (!schema.hasRefreshTokensTable) {
    await ensureRefreshTokensTable(dbPool, schema);
  }
  const tokenHash = hashToken(token);
  await dbPool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash]
  );
  return res.json({ ok: true });
};
