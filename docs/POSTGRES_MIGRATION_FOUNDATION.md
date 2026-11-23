# PostgreSQL migration foundation

## Current status

The running AINEW backend still uses synchronous `better-sqlite3`. Do not set `DATABASE_URL` or switch the service to PostgreSQL until the async database adapter, data migration, and smoke tests are complete.

The existing Render database is shared with Mlimani Fleet. Fleet currently uses `public.app_kv`. AINEW must use only the separate `ainew` schema. Never rename, truncate, or modify Fleet's `public` objects.

## Schema

Apply `migrations/postgres/001_init.sql` only after:
1. A verified backup/export of the current Fleet database exists.
2. The AINEW backend has been migrated to a PostgreSQL-compatible async adapter.
3. The Render internal database URL has been configured as a secret environment variable with the user's approval.
4. The migration has been reviewed and tested against a staging copy.

The SQL creates the isolated `ainew` schema and the tables currently initialized by `server.js`. It does not copy SQLite records and it does not run automatically.

## Required backend work before cutover

- Replace synchronous SQLite access with a pooled PostgreSQL client and parameterized queries.
- Convert `?` placeholders to PostgreSQL parameters and adapt SQLite-specific result fields such as `lastInsertRowid` and `changes`.
- Make route handlers and startup initialization await database operations safely.
- Preserve all existing authentication, ownership checks, billing, quotas, sessions, and plugin approval behavior.
- Implement an explicit, repeatable SQLite-to-PostgreSQL export/import with stable IDs and sequence resets.
- Add tests for registration/login, bot CRUD, API keys, payments, usage/quota counters, plugin connections, and chat-session expiry.
- Verify the app uses schema `ainew` via a dedicated connection search_path or fully-qualified table names.

## Cutover / rollback

Do not cut over until row counts and representative records have been reconciled for every table. Keep the old SQLite export and database backup until the new service has passed production smoke tests. Rollback must restore the previous application build and must not overwrite the Fleet `public` schema.

The Render PostgreSQL instance currently has a Free plan and a displayed expiry of 19 December 2026. Upgrade/retention must be handled before expiry; this change does not upgrade any Render resource.
