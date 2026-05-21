ALTER TABLE "invoices" ADD COLUMN "reminders_sent" integer NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "overdue_alert_sent" boolean NOT NULL DEFAULT false;
ALTER TABLE "theme_settings" ADD COLUMN "invoice_reminders_enabled" boolean NOT NULL DEFAULT true;
