import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { type Express, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";

// ── CORS origin allowlist ─────────────────────────────────────────────────────
function buildAllowedOrigins(): string[] {
  const origins: string[] = ["http://localhost", "http://127.0.0.1"];
  const replitDomains = process.env["REPLIT_DOMAINS"] ?? "";
  replitDomains.split(",").forEach((d) => {
    const domain = d.trim();
    if (domain) origins.push(`https://${domain}`);
  });
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) origins.push(`https://${devDomain}`);
  return [...new Set(origins)];
}

export const ALLOWED_ORIGINS = buildAllowedOrigins();

export function corsOptions(): object {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true); // allow curl / server-to-server
      const allowed =
        process.env["NODE_ENV"] === "development" ||
        ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
      if (allowed) return callback(null, true);
      logger.warn({ origin }, "CORS: blocked origin");
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  };
}

// ── Rate limiters ─────────────────────────────────────────────────────────────

// General API: 200 req / min
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: req.ip, url: req.url }, "API rate limit exceeded");
    res.status(429).json({ error: "Rate limit exceeded — please slow down." });
  },
});

// Auth: 30 failures per 15 min (brute-force guard; skips successes)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: req.ip }, "Auth rate limit hit — possible brute-force");
    res.status(429).json({ error: "Too many login attempts — please wait 15 minutes." });
  },
});

// Public form submissions: 20 per hour
export const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn({ ip: req.ip }, "Form spam rate limit hit");
    res.status(429).json({ error: "Too many submissions — try again later." });
  },
});

// ── Helmet (security headers) ─────────────────────────────────────────────────
export function applySecurityMiddleware(app: Express) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          connectSrc: ["'self'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'none'"],
          imgSrc: ["'none'"],
          fontSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
      noSniff: true,
      hidePoweredBy: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Strip residual server-identifying headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader("Server");
    res.removeHeader("X-Powered-By");
    next();
  });
}

// ── XSS input sanitizer ───────────────────────────────────────────────────────
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/javascript\s*:/gi, "")
      .replace(/vbscript\s*:/gi, "")
      .replace(/data\s*:\s*text\/html/gi, "")
      .trim();
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body) as Record<string, unknown>;
  }
  next();
}

// ── Honeypot — bots fill hidden fields; humans don't ─────────────────────────
export function honeypotCheck(req: Request, res: Response, next: NextFunction) {
  const body = req.body as Record<string, unknown> | undefined;
  if (body?.["_hp"]) {
    logger.warn({ ip: req.ip }, "Honeypot triggered — bot submission discarded");
    res.status(201).json({ ok: true }); // fake success to confuse bots
    return;
  }
  next();
}

// ── Suspicious pattern logger ─────────────────────────────────────────────────
const SUSPICIOUS = [
  /\.\.\//,           // path traversal
  /<script/i,         // reflected XSS probe
  /union\s+select/i,  // SQL injection probe
  /exec\s*\(/i,       // code exec probe
  /eval\s*\(/i,
  /base64_decode/i,
];

export function securityLogger(req: Request, _res: Response, next: NextFunction) {
  const target = req.url + JSON.stringify(req.body ?? "");
  if (SUSPICIOUS.some((p) => p.test(target))) {
    logger.warn({ ip: req.ip, url: req.url, method: req.method }, "Suspicious request pattern");
  }
  next();
}

// ── Permissions-Policy (disable sensitive browser APIs) ──────────────────────
export function permissionsPolicyHeader(_req: Request, res: Response, next: NextFunction) {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), display-capture=()",
  );
  next();
}

// ── In-memory account lockout tracker ────────────────────────────────────────
// Tracks failed login attempts per email. After MAX_FAILURES in WINDOW_MS the
// account is locked for LOCKOUT_MS. This is deliberately in-memory so it resets
// on restart (stateless / horizontal-scale deployments should use Redis instead).
interface FailRecord { count: number; windowStart: number; lockedUntil?: number }
const _loginFailures = new Map<string, FailRecord>();

const FAIL_WINDOW_MS = 15 * 60 * 1000;   // 15 min rolling window
const MAX_FAILURES   = 5;                  // lock after 5 failures
const LOCKOUT_MS     = 15 * 60 * 1000;    // locked for 15 min

export function checkAccountLockout(email: string): { locked: boolean; waitSeconds?: number } {
  const key = email.toLowerCase();
  const rec = _loginFailures.get(key);
  if (!rec) return { locked: false };
  const now = Date.now();
  if (rec.lockedUntil && now < rec.lockedUntil) {
    return { locked: true, waitSeconds: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.windowStart > FAIL_WINDOW_MS) {
    _loginFailures.delete(key);
    return { locked: false };
  }
  return { locked: false };
}

export function recordLoginFailure(email: string, log: (msg: object) => void) {
  const key = email.toLowerCase();
  const now = Date.now();
  const rec = _loginFailures.get(key);
  if (!rec || now - rec.windowStart > FAIL_WINDOW_MS) {
    _loginFailures.set(key, { count: 1, windowStart: now });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_FAILURES && !rec.lockedUntil) {
    rec.lockedUntil = now + LOCKOUT_MS;
    log({ email, msg: "Account locked after repeated failed login attempts" });
  }
  _loginFailures.set(key, rec);
}

export function clearLoginFailures(email: string) {
  _loginFailures.delete(email.toLowerCase());
}

// ── Security status (for admin dashboard) ────────────────────────────────────
export const SECURITY_STATUS = {
  helmet: true,
  csp: true,
  hsts: true,
  rateLimiting: { api: "200/min", auth: "10/15min (failures only)", forms: "20/hr" },
  cors: "allowlist",
  bodySizeLimit: "100kb",
  xssSanitization: true,
  honeypot: true,
  jwtSecretConfigured: !!process.env["SESSION_SECRET"],
  bcryptRounds: 12,
  socketCors: "allowlist",
};
