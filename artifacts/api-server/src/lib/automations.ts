import { db } from "@workspace/db";
import {
  automationsTable,
  automationRunsTable,
  type AutomationCondition,
  type AutomationAction,
  dealsTable,
  contactsTable,
  dealNotesTable,
  activityTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";
import { notify } from "./notify.js";
import { fireWebhook } from "./webhooks.js";
import type { Server } from "socket.io";

export type AutomationTrigger =
  | "deal.created"
  | "deal.stage_changed"
  | "deal.updated"
  | "contact.created"
  | "invoice.paid"
  | "form.submitted"
  | "release.scheduled"
  | "project.status_changed"
  | "project.created";

export interface TriggerPayload {
  trigger: AutomationTrigger;
  entityType?: string;
  entityId?: number;
  data: Record<string, unknown>;
  userId?: number;
  io?: Server | null;
}

function evaluateCondition(cond: AutomationCondition, data: Record<string, unknown>): boolean {
  const val = cond.field.split(".").reduce((obj: unknown, k) => {
    if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[k];
    return undefined;
  }, data as unknown);

  switch (cond.operator) {
    case "equals":        return String(val) === String(cond.value);
    case "not_equals":    return String(val) !== String(cond.value);
    case "contains":      return typeof val === "string" && val.toLowerCase().includes(String(cond.value).toLowerCase());
    case "gt":            return Number(val) > Number(cond.value);
    case "lt":            return Number(val) < Number(cond.value);
    case "gte":           return Number(val) >= Number(cond.value);
    case "lte":           return Number(val) <= Number(cond.value);
    case "is_set":        return val !== null && val !== undefined && val !== "";
    case "is_empty":      return val === null || val === undefined || val === "";
    default:              return true;
  }
}

async function executeAction(action: AutomationAction, payload: TriggerPayload): Promise<void> {
  switch (action.type) {
    case "add_note": {
      if (payload.trigger.startsWith("deal.") && payload.entityId) {
        await db.insert(dealNotesTable).values({
          dealId:   payload.entityId,
          authorId: payload.userId ?? 1,
          content:  String(action.config.content ?? "Automated note"),
        });
      }
      break;
    }
    case "update_stage": {
      if (payload.entityId && action.config.stage) {
        const stage = action.config.stage as "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
        await db.update(dealsTable).set({ stage, updatedAt: new Date() }).where(eq(dealsTable.id, payload.entityId));
      }
      break;
    }
    case "create_activity": {
      if (payload.userId) {
        await db.insert(activityTable).values({
          userId:      payload.userId,
          type:        action.config.activityType as string ?? "automation",
          description: String(action.config.description ?? `Automation ran: ${payload.trigger}`),
        });
      }
      break;
    }
    case "add_tag": {
      if (payload.entityType === "contact" && payload.entityId && action.config.tag) {
        const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, payload.entityId));
        if (contact) {
          const tags = [...(contact.tags ?? [])];
          const tag = String(action.config.tag);
          if (!tags.includes(tag)) {
            await db.update(contactsTable).set({ tags: [...tags, tag], updatedAt: new Date() }).where(eq(contactsTable.id, payload.entityId));
          }
        }
      }
      break;
    }
    case "send_email":
    case "send_notification":
      // These are handled by the notify-email helper called from the routes.
      // Log them here so they appear in automation runs.
      break;
    default:
      break;
  }
}

export async function fireAutomation(payload: TriggerPayload): Promise<void> {
  try {
    const automations = await db
      .select()
      .from(automationsTable)
      .where(and(eq(automationsTable.trigger, payload.trigger), eq(automationsTable.enabled, true)));

    for (const automation of automations) {
      let actionsRun = 0;
      let status: "success" | "partial" | "failed" = "success";
      let error: string | undefined;

      try {
        const conditions = (automation.conditions ?? []) as AutomationCondition[];
        const allPass = conditions.every((c) => evaluateCondition(c, payload.data));
        if (!allPass) continue;

        const actions = (automation.actions ?? []) as AutomationAction[];
        for (const action of actions) {
          try {
            await executeAction(action, payload);
            actionsRun++;
          } catch (err) {
            status = "partial";
            error = err instanceof Error ? err.message : String(err);
            logger.warn({ automation: automation.id, action: action.type, err }, "Automation action failed");
          }
        }

        await db.update(automationsTable).set({
          runCount:  automation.runCount + 1,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(automationsTable.id, automation.id));

      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err.message : String(err);
        logger.warn({ automation: automation.id, err }, "Automation failed");
      }

      await db.insert(automationRunsTable).values({
        automationId: automation.id,
        trigger:      payload.trigger,
        payload:      payload.data,
        actionsRun,
        status,
        error: error ?? null,
      });

      // Notify the triggering user that the automation ran
      if (payload.userId && (status === "success" || status === "partial")) {
        void notify(
          payload.io ?? null,
          payload.userId,
          "automation",
          `Automation ran: ${automation.name}`,
          status === "success"
            ? `"${automation.name}" completed ${actionsRun} action${actionsRun !== 1 ? "s" : ""} successfully`
            : `"${automation.name}" partially completed (${actionsRun} of ${(automation.actions as unknown[]).length} actions succeeded)`,
          "/automations",
        );
        void fireWebhook("automation.triggered", {
          automationId:   automation.id,
          automationName: automation.name,
          trigger:        payload.trigger,
          actionsRun,
          status,
        }, payload.userId);
      }
    }
  } catch (err) {
    logger.warn({ err }, "fireAutomation outer error");
  }
}
