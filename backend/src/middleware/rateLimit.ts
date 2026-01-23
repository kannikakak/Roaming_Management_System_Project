import { Request, Response, NextFunction } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getKey(req: Request) {
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  return `${ip}:${req.path}`;
}

export function createRateLimiter(options: RateLimitOptions) {
  const windowMs = Math.max(1000, options.windowMs);
  const max = Math.max(1, options.max);
  const message = options.message || "Too many requests. Please try again later.";

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getKey(req);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
}
