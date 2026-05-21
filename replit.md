# Mini-HubSpot CRM

A full-stack back-office application with CRM functionalities, project management tools, and administrative controls.

## Run & Operate

- `pnpm run typecheck` — Perform a full typecheck across all packages.
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks and Zod schemas.
- `pnpm --filter @workspace/db run push` — Push database schema changes (development only).

**Environment Variables:**
- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET` — Secret for signing JWT tokens.
- `SESSION_SECRET` — Session secret.
- `STRIPE_SECRET_KEY` — Stripe API secret key.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (OpenAPI spec → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Real-time**: Socket.io (server + client)
- **Charts**: Recharts
- **Drag and drop**: @dnd-kit
- **Security**: helmet, express-rate-limit

## Where things live

- `artifacts/api-server/` — Express backend for all API services.
- `artifacts/web-app/` — React frontend application.
- `lib/api-spec/` — OpenAPI specification and Orval configuration.
- `lib/api-client-react/` — Generated React Query hooks for API interaction.
- `lib/api-zod/` — Generated Zod schemas for API validation.
- `lib/db/` — Drizzle ORM schema and database connection.
- `lib/db/src/schema/messaging.ts` — Source of truth for messaging-related DB schema.
- `artifacts/api-server/src/lib/stripe.ts` — Stripe integration logic.
- `artifacts/api-server/src/lib/google-calendar.ts` — Google Calendar integration logic.

## Architecture decisions

- **Monorepo Structure**: Uses pnpm workspaces to manage `api-server`, `web-app`, and shared `lib` packages, promoting code reuse and consistent tooling.
- **API Code Generation**: Orval is used to generate React Query hooks and Zod schemas from an OpenAPI spec, ensuring type safety and consistency between frontend and backend.
- **Real-time Communication**: Socket.io is implemented for real-time messaging, supporting thread-based chat with secure JWT authentication for connections.
- **Flexible Form/Page Builders**: Employs JSONB fields in the database (`custom_forms.fields`, `project_pages.blocks`) to store dynamic, block-based configurations for forms and project pages, allowing for schema-less extensibility.
- **Role-Based Access Control**: JWT authentication combined with a role system (`admin`, `manager`, `user`) secures routes and features, with middleware enforcing access policies.

## Product

- **CRM**: Customer pipeline (Kanban), contact management, deal tracking, notes, and analytics.
- **Communication**: Real-time thread-based chat with file sharing.
- **Marketing**: Template editor for emails, proposals, SMS, and Stripe payment link builder.
- **Scheduling**: Google Calendar integration for meeting scheduling.
- **Project Management**: Block-based project page builder.
- **Artist Management**: A&R roster with detailed artist profiles.
- **Time Tracking**: Log hours on deals, profitability metrics, and time analytics.
- **Custom Forms**: Drag-and-drop form builder with public links, submissions viewer, and CRM automation.
- **Release Rollout**: 5-phase marketing automation (Tease/Announce/Engage/Drop/Post) tied to music release dates; node-cron runs every minute to execute scheduled actions; manual trigger per-action; auto-promotes release to "live" on release day.
- **Integrations**: Per-user connection management for Outlook, OneDrive, and Dropbox; SMTP email status summary; Outlook/OneDrive pages gate on user connection before showing data; admin panel shows per-user provider badges.
- **Admin Controls**: User role management, theme customization, and system-wide settings.
- **Global Search**: Unified search across contacts, deals, artists, and templates.

## User preferences

- _Populate as you build_

## Gotchas

- **Codegen Patching**: After Orval generation, `lib/api-zod/src/index.ts` is rewritten, and `zod.instanceof(File)` is patched to `zod.any()` due to browser-specific types not being available in the library context.
- **Integration Connections**: `user_connections` table stores per-user provider connections (outlook/onedrive/dropbox). Outlook/OneDrive use the shared workspace Replit Connector; connecting verifies the connector works and stores a display name. Dropbox takes a user-provided access token (verified via Dropbox API). The `credentials` JSONB field is only used for Dropbox (`{access_token}`); never returned to clients.
- **Database Schema Pushes**: Remember to run `pnpm --filter @workspace/db run push` after any Drizzle schema changes, but only in development environments.
- **API Rate Limiting**: Be aware of global rate limits (300 req/min) and stricter auth-specific limits (20 req/15 min) to avoid unexpected errors.
- **File Uploads**: Files are served from `/api/files/:filename`, ensure proper permissions and access.
- **Public Form Security**: Public forms (`/f/:slug`) include honeypot spam protection and rate limiting; avoid direct brute-force testing.

## Pointers

- **OpenAPI Specification**: Refer to `lib/api-spec/openapi.yaml` for API contract details.
- **Drizzle ORM Docs**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **React Query Docs**: [https://tanstack.com/query/latest/docs/react/overview](https://tanstack.com/query/latest/docs/react/overview)
- **Tailwind CSS Docs**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Socket.io Docs**: [https://socket.io/docs/v4/](https://socket.io/docs/v4/)
- **Stripe API Docs**: [https://stripe.com/docs/api](https://stripe.com/docs/api)
- **Google Calendar API Docs**: [https://developers.google.com/calendar/api/guides/overview](https://developers.google.com/calendar/api/guides/overview)