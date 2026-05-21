import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import type { Request } from "express";

export interface AuditEntry {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entityType?: string;
  entityId?: number;
  entityLabel?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function auditLog(entry: AuditEntry) {
  try {
    await db.insert(auditLogsTable).values({
      userId:      entry.userId ?? null,
      userName:    entry.userName ?? null,
      action:      entry.action,
      entityType:  entry.entityType ?? null,
      entityId:    entry.entityId ?? null,
      entityLabel: entry.entityLabel ?? null,
      metadata:    entry.metadata ?? {},
      ipAddress:   entry.req
        ? (entry.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
            ?? entry.req.socket.remoteAddress
            ?? null
        : null,
    });
  } catch (err) {
    // Never throw — audit failures must not break business logic
  }
}
