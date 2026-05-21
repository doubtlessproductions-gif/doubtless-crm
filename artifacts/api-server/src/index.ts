import http from "http";
import { Server as SocketServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { requireSocketAuth } from "./middlewares/auth.js";
import { ALLOWED_ORIGINS } from "./middlewares/security.js";
import { startRolloutCron } from "./lib/rollout-cron.js";
import { startSocialCron } from "./lib/social-cron.js";
import { startWebhookQueueWorker } from "./lib/webhook-queue-worker.js";
import { startOutlookHealthCron } from "./lib/outlook-health-cron.js";
import { startDuplicateCron } from "./lib/duplicate-cron.js";
import { startSweeperCron } from "./lib/sweeper-cron.js";
import { startRescorerCron } from "./lib/rescorer-cron.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const httpServer = http.createServer(app);

// Socket.IO: restrict CORS to the same allowlist as the REST API
const io = new SocketServer(httpServer, {
  path: "/api/socket.io",
  cors: {
    origin: (origin, callback) => {
      if (!origin || process.env["NODE_ENV"] === "development") return callback(null, true);
      if (ALLOWED_ORIGINS.some((o) => origin.startsWith(o))) return callback(null, true);
      logger.warn({ origin }, "Socket.IO: blocked origin");
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Expose io via app.locals — the middleware in app.ts reads it into req.io
// before every route handler so real-time emits work correctly.
app.locals["io"] = io;

io.use(requireSocketAuth);

io.on("connection", (socket) => {
  const userId = socket.data.user?.userId;
  logger.info({ userId }, "Socket connected");
  // Join personal room so the server can push per-user notifications
  if (userId) socket.join(`user:${userId}`);
  socket.on("join_thread", (threadId: number) => socket.join(`thread:${threadId}`));
  socket.on("leave_thread", (threadId: number) => socket.leave(`thread:${threadId}`));
  socket.on("disconnect", () => logger.info({ userId }, "Socket disconnected"));
});

httpServer.listen(port, (err?: Error) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");
});

startRolloutCron();
startSocialCron();
startWebhookQueueWorker();
startOutlookHealthCron(io);
startDuplicateCron();
startSweeperCron();
startRescorerCron();
