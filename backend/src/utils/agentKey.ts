import crypto from "crypto";

export const generateAgentKey = () => crypto.randomBytes(32).toString("hex");

export const hashAgentKey = (rawKey: string) =>
  crypto.createHash("sha256").update(String(rawKey || "").trim()).digest("hex");

export const buildAgentKeyHint = (rawKey: string) => {
  const cleaned = String(rawKey || "").trim();
  if (!cleaned) return null;
  const visible = cleaned.slice(-6);
  return `...${visible}`;
};

export const readAgentKeyFromRequest = (req: {
  headers?: Record<string, any>;
  body?: Record<string, any>;
}) => {
  const fromHeader = String(req.headers?.["x-agent-key"] || "").trim();
  if (fromHeader) return fromHeader;
  const authHeader = String(req.headers?.authorization || "").trim();
  if (/^bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^bearer\s+/i, "").trim();
    if (token) return token;
  }
  const fromBody = String(req.body?.agentKey || "").trim();
  if (fromBody) return fromBody;
  return "";
};

