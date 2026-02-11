import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthUser = {
  id: number;
  email: string;
  role: string;
  roles?: string[];
};

type JwtPayload = AuthUser & {
  iat?: number;
  exp?: number;
};

const getJwtSecret = () => String(process.env.JWT_SECRET || "").trim();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return res.status(500).json({ message: "JWT secret is not configured" });
  }
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, jwtSecret) as JwtPayload;
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      roles: Array.isArray((payload as any).roles)
        ? ((payload as any).roles as string[])
        : undefined,
    };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    const userRoles = req.user?.roles || (role ? [role] : []);
    const hasAny = userRoles.some((r) => roles.includes(r));
    if (!hasAny) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}
