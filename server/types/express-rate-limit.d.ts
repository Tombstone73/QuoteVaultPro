declare module "express-rate-limit" {
  import type { Request, RequestHandler } from "express";

  type RateLimitOptions = {
    windowMs: number;
    max: number;
    standardHeaders?: boolean;
    legacyHeaders?: boolean;
    keyGenerator?: (req: Request) => string;
    message?: unknown;
  };

  export function ipKeyGenerator(ip: string): string;

  const rateLimit: (options: RateLimitOptions) => RequestHandler;
  export default rateLimit;
}
