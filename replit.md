# Bungoma CPMS — County Performance Management System

A digital Staff Performance Appraisal System (SPAS) for the County Government of Bungoma. Digitises the entire SPAS lifecycle — target setting, mid-year review, evaluation, rewards, sanctions and appeals — for over 7,000 county employees.

## Stack

- **Framework**: TanStack Start (React 19 + TypeScript, SSR)
- **Routing**: TanStack Router (file-based)
- **Styling**: Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **Backend**: Supabase (auth + database)
- **Build tool**: Vite 7 via `@lovable.dev/vite-tanstack-config`
- **Package manager**: Bun

## How to run

```bash
bun run dev
```

The dev server starts on **port 5000**. The workflow "Start application" is already configured.

## Environment variables

Supabase credentials are stored in `.env`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable key
- `SUPABASE_PROJECT_ID` — project ID (used by Supabase CLI)

## Database migrations

Migrations live in `supabase/migrations/`. Apply them via the Supabase dashboard or CLI against project `wonoybbglfuhfyfzmgev`.

## Key directories

- `src/routes/` — file-based page routes (TanStack Router)
- `src/components/` — shared UI components
- `src/integrations/supabase/` — Supabase client + auth middleware
- `src/hooks/` — React hooks
- `supabase/migrations/` — database schema migrations

## User preferences

<!-- Add user preferences here as they are stated -->
