import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { logger } from "../lib/logger.js";
import { db, portalUsersTable, apiKeysTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = (() => {
  const secret = process.env["SESSION_SECRET"] ?? process.env["JWT_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    logger.warn("SESSION_SECRET not set — using insecure fallback. Set it in Replit Secrets.");
    return "dev-secret-CHANGE-IN-PRODUCTION-NOW";
  }
  return secret;
})();

export interface AuthPayload {
  userId: number;
  email: string;
  role?: string;
}

export interface PortalAuthPayload {
  portalUserId: number;
  contactId: number;
  email: string;
  audience: "portal";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      portalUser?: PortalAuthPayload;
      io?: import("socket.io").Server;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    logger.warn({ ip: req.ip, err: (err as Error).message }, "JWT verification failed");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let payload: PortalAuthPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as PortalAuthPayload;
    if (payload.audience !== "portal") {
      res.status(401).json({ error: "Invalid token audience" });
      return;
    }
  } catch (err) {
    logger.warn({ ip: req.ip, err: (err as Error).message }, "Portal JWT verification failed");
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Verify the user is still active and has valid credentials in the DB.
  // Checking all three fields enforces immediate revocation for:
  //   - deactivation  (isActive=false)
  //   - credential reset (passwordHash=null + inviteAcceptedAt=null, isActive=true)
  // Without this, previously issued 30-day JWTs would remain valid after either action.
  try {
    const [portalUser] = await db
      .select({
        id:               portalUsersTable.id,
        isActive:         portalUsersTable.isActive,
        passwordHash:     portalUsersTable.passwordHash,
        inviteAcceptedAt: portalUsersTable.inviteAcceptedAt,
      })
      .from(portalUsersTable)
      .where(eq(portalUsersTable.id, payload.portalUserId))
      .limit(1);

    if (!portalUser) {
      logger.warn({ portalUserId: payload.portalUserId }, "Portal user not found during auth check");
      res.status(401).json({ error: "Portal account not found" });
      return;
    }
    if (!portalUser.isActive) {
      logger.warn({ portalUserId: payload.portalUserId }, "Portal user is deactivated");
      res.status(401).json({ error: "Portal account has been deactivated" });
      return;
    }
    // passwordHash=null and inviteAcceptedAt=null indicate a credential reset —
    // the user must re-accept their invite and set a new password before continuing.
    if (!portalUser.passwordHash || !portalUser.inviteAcceptedAt) {
      logger.warn({ portalUserId: payload.portalUserId }, "Portal user credentials have been reset");
      res.status(401).json({ error: "Portal access has been reset — please use your new invite link" });
      return;
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, "DB error during portal auth check");
    res.status(500).json({ error: "Authentication check failed" });
    return;
  }

  req.portalUser = payload;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (roles.length > 0 && req.user.role && !roles.includes(req.user.role)) {
      logger.warn({ userId: req.user.userId, role: req.user.role, required: roles }, "Insufficient role");
      res.status(403).json({ error: "Forbidden — insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * requireReadAuth — accepts either a JWT or an `apk_` API key.
 * API keys are enforced as read-only (GET only).
 * All other HTTP methods require a full JWT.
 */
export async function requireReadAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (token.startsWith("apk_")) {
    if (req.method !== "GET") {
      res.status(403).json({ error: "API keys are read-only" }); return;
    }
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    let apiKey: { id: number; userId: number; revokedAt: Date | null; scopes: string[] | null } | undefined;
    try {
      [apiKey] = await db
        .select({ id: apiKeysTable.id, userId: apiKeysTable.userId, revokedAt: apiKeysTable.revokedAt, scopes: apiKeysTable.scopes })
        .from(apiKeysTable)
        .where(eq(apiKeysTable.keyHash, hash))
        .limit(1);
    } catch (err) {
      logger.error({ err }, "requireReadAuth: DB error looking up API key");
      res.status(500).json({ error: "Internal server error" }); return;
    }
    if (!apiKey || apiKey.revokedAt) {
      res.status(401).json({ error: "Invalid or revoked API key" }); return;
    }
    // Scope check: if key has scopes, verify the request path is covered
    const keyScopes = apiKey.scopes;
    if (keyScopes && keyScopes.length > 0) {
      // req.path is relative to the mounted router; use baseUrl+path for the full path
      const fullPath = (req.baseUrl ?? "") + req.path;
      const scopePathMap: Record<string, string[]> = {
        contacts:   ["/api/contacts"],
        deals:      ["/api/deals"],
        artists:    ["/api/artists"],
        royalties:  ["/api/royalties"],
        forms:      ["/api/forms", "/api/custom-forms"],
      };
      const allowed = keyScopes.some((scope) =>
        (scopePathMap[scope] ?? []).some((prefix) => fullPath === prefix || fullPath.startsWith(prefix + "/"))
      );
      if (!allowed) {
        logger.warn({ keyId: apiKey.id, fullPath, scopes: keyScopes }, "API key scope denied");
        res.status(403).json({ error: "This API key does not have access to this resource" }); return;
      }
    }
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, apiKey.userId))
      .limit(1);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    void db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, apiKey.id));
    req.user = { userId: user.id, email: user.email, role: user.role };
    next();
    return;
  }

  // Fall through: verify as a standard JWT
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    logger.warn({ ip: req.ip, err: (err as Error).message }, "JWT verification failed (requireReadAuth)");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireSocketAuth(
  socket: { handshake: { auth: Record<string, unknown> }; data: Record<string, unknown> },
  next: (err?: Error) => void
) {
  const token = socket.handshake.auth["token"];
  if (!token || typeof token !== "string") {
    return next(new Error("No token provided"));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    socket.data.user = payload;
    next();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Socket JWT verification failed");
    next(new Error("Invalid or expired token"));
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function signPortalToken(payload: Omit<PortalAuthPayload, "audience">): string {
  return jwt.sign({ ...payload, audience: "portal" }, JWT_SECRET, { expiresIn: "30d" });
}
