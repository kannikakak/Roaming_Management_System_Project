import { Request, Response, NextFunction } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
  scope?: string;
  keyBy?: "ip" | "ip-user";
  cleanupIntervalMs?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

function getClientIp(req: Request) {
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  return ip;
}

export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = Math.max(1000, options.windowMs);
  const max = Math.max(1, options.max);
  const message = options.message || "Too many requests. Please try again later.";
  const scope = (options.scope || "").trim();
  const keyBy = options.keyBy || "ip";
  const cleanupIntervalMs = Math.max(windowMs, options.cleanupIntervalMs || windowMs);
  const buckets = new Map<string, Bucket>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  const getKey = (req: Request) => {
    const ip = getClientIp(req);
    const userPart = keyBy === "ip-user" ? `:${req.user?.id || "anonymous"}` : "";
    const scopePart = scope ? `${scope}:` : "";
    return `${scopePart}${ip}${userPart}:${req.baseUrl}${req.path}`;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getKey(req);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const nextBucket = { count: 1, resetAt: now + windowMs };
      buckets.set(key, nextBucket);
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - nextBucket.count)));
      res.setHeader("X-RateLimit-Reset", String(Math.floor(nextBucket.resetAt / 1000)));
      return next();
    }

    existing.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - existing.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(existing.resetAt / 1000)));
    if (existing.count > max) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
}
