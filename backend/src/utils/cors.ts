import { CorsOptions } from "cors";

const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Requested-With"];

// Preserve the existing "allow cross-origin" behavior, but make preflight handling explicit.
export function buildCorsOptions(): CorsOptions {
  return {
    origin: true,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    optionsSuccessStatus: 204,
  };
}
