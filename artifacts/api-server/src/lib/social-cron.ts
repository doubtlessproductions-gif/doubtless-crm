// Social post auto-publisher — runs every minute, picks up scheduled posts whose
// scheduledAt has passed and publishes them through the connected platform.
import cron from "node-cron";
import { db, contentPostsTable, userConnectionsTable, workspaceConnectionsTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "./logger.js";
import { publishPost } from "./social-publisher.js";

export function startSocialCron() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();

    // Pick up posts that are in "scheduled" state and whose time has arrived
    const due = await db
      .select()
      .from(contentPostsTable)
      .where(and(eq(contentPostsTable.status, "scheduled"), lte(contentPostsTable.scheduledAt, now)));

    if (due.length === 0) return;
    logger.info({ count: due.length }, "Social cron: processing due posts");

    for (const post of due) {
      // Optimistic lock — flip to "posting" so concurrent cron runs skip it
      const [locked] = await db
        .update(contentPostsTable)
        .set({ status: "posting" as "scheduled", updatedAt: new Date() })
        .where(and(eq(contentPostsTable.id, post.id), eq(contentPostsTable.status, "scheduled")))
        .returning({ id: contentPostsTable.id });

      if (!locked) continue; // Another cron beat us to it

      try {
        // Try the post author's personal connection first, then fall back to workspace
        const [personal] = await db
          .select({ credentials: userConnectionsTable.credentials })
          .from(userConnectionsTable)
          .where(and(
            eq(userConnectionsTable.userId, post.createdBy),
            eq(userConnectionsTable.provider, post.platform),
          ));

        let credentials: Record<string, string> | null = null;
        let isWorkspace = false;

        if (personal?.credentials) {
          credentials = personal.credentials as Record<string, string>;
        } else {
          const [workspace] = await db
            .select({ credentials: workspaceConnectionsTable.credentials })
            .from(workspaceConnectionsTable)
            .where(eq(workspaceConnectionsTable.provider, post.platform));

          if (workspace?.credentials) {
            credentials = workspace.credentials as Record<string, string>;
            isWorkspace = true;
          }
        }

        if (!credentials) {
          await db.update(contentPostsTable)
            .set({
              status: "failed" as "scheduled",
              publishError: `No ${post.platform} account connected. Go to Settings → Integrations to connect it, or ask an admin to set up a company account.`,
              updatedAt: new Date(),
            })
            .where(eq(contentPostsTable.id, post.id));
          logger.warn({ postId: post.id, platform: post.platform }, "Social cron: no credentials, marking failed");
          continue;
        }

        const result = await publishPost(
          post.platform,
          credentials,
          post.copy,
          (post.mediaUrls as string[]) ?? [],
        );

        if (result.ok) {
          await db.update(contentPostsTable)
            .set({ status: "posted", postedAt: new Date(), publishError: null, updatedAt: new Date() })
            .where(eq(contentPostsTable.id, post.id));
          logger.info({ postId: post.id, platform: post.platform, isWorkspace }, "Social cron: published successfully");
        } else {
          await db.update(contentPostsTable)
            .set({ status: "failed" as "scheduled", publishError: result.error, updatedAt: new Date() })
            .where(eq(contentPostsTable.id, post.id));
          logger.warn({ postId: post.id, platform: post.platform, error: result.error }, "Social cron: publish failed");
        }
      } catch (err) {
        await db.update(contentPostsTable)
          .set({ status: "failed" as "scheduled", publishError: String(err), updatedAt: new Date() })
          .where(eq(contentPostsTable.id, post.id));
        logger.error({ err, postId: post.id }, "Social cron: unexpected error");
      }
    }
  });

  logger.info("Social post cron started (every minute)");
}
