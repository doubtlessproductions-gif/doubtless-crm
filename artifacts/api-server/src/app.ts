import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
import webhookReceivers from "./routes/webhook-receivers.js";
import { logger } from "./lib/logger";
import {
  applySecurityMiddleware,
  apiLimiter,
  authLimiter,
  formLimiter,
  sanitizeBody,
  securityLogger,
  corsOptions,
  permissionsPolicyHeader,
} from "./middlewares/security.js";

const app: Express = express();

// Trust Replit's reverse proxy so rate-limit reads X-Forwarded-For correctly
app.set("trust proxy", 1);

// 1. Security headers (Helmet + custom header stripping + Permissions-Policy)
applySecurityMiddleware(app);
app.use(permissionsPolicyHeader);

// 2. Suspicious-pattern logger (runs before body parsing)
app.use(securityLogger);

// 3. Hardened CORS — allowlist of Replit domains + localhost
app.use(cors(corsOptions()));

// 4. Request logging
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// 5a. Stripe webhook — must receive raw body for signature verification, registered BEFORE json parser
// Both paths are supported: /api/stripe/webhook (legacy) and /api/webhooks/stripe (task spec)
app.post("/api/stripe/webhook",   express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/api/webhooks/stripe",  express.raw({ type: "application/json" }), stripeWebhookHandler);

// 5b. Body parsing with 100 kb size limit (prevent payload attacks)
// The verify callback stores the raw buffer so inbound webhook receivers can
// compute HMAC-SHA256 signature verification against the original bytes.
app.use(express.json({
  limit: "100kb",
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// 6. XSS input sanitization on all incoming request bodies
app.use(sanitizeBody);

// 7. Rate limiting
app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);

// 8. Per-route form limiter applied in routes/forms.ts (formLimiter exported for use there)
export { formLimiter };

// 9. Socket.io late-binding — io is set into app.locals by index.ts after creation.
//    This middleware runs before every route handler so req.io is always available.
app.use((req: import("express").Request & { io?: import("socket.io").Server }, _res, next) => {
  req.io = (req.app.locals["io"] as import("socket.io").Server | undefined) ?? undefined;
  next();
});

// 10. Routes
app.use("/api/webhooks", webhookReceivers);
app.use("/api", router);

export default app;
