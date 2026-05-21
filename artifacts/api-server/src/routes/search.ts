import { Router } from "express";
import { db, contactsTable, dealsTable, templatesTable, artistsTable, parseLabelStatus } from "@workspace/db";
import { ilike, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const q = (req.query["q"] as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.json({ contacts: [], deals: [], artists: [], templates: [] });
    return;
  }
  const pattern = `%${q}%`;

  const [contacts, deals, artists, templates] = await Promise.all([
    db
      .select({ id: contactsTable.id, name: contactsTable.name, email: contactsTable.email, company: contactsTable.company })
      .from(contactsTable)
      .where(or(ilike(contactsTable.name, pattern), ilike(contactsTable.email ?? "", pattern), ilike(contactsTable.company ?? "", pattern)))
      .limit(5),

    db
      .select({ id: dealsTable.id, title: dealsTable.title, stage: dealsTable.stage, value: dealsTable.value })
      .from(dealsTable)
      .where(ilike(dealsTable.title, pattern))
      .limit(5),

    db
      .select({ id: artistsTable.id, name: artistsTable.name, genre: artistsTable.genre, labelStatus: artistsTable.labelStatus })
      .from(artistsTable)
      .where(or(ilike(artistsTable.name, pattern), ilike(artistsTable.genre ?? "", pattern)))
      .limit(5),

    db
      .select({ id: templatesTable.id, title: templatesTable.title, type: templatesTable.type })
      .from(templatesTable)
      .where(ilike(templatesTable.title, pattern))
      .limit(5),
  ]);

  res.json({ contacts, deals, artists: artists.map(a => ({ ...a, labelStatus: parseLabelStatus(a.labelStatus) })), templates });
});

export default router;
