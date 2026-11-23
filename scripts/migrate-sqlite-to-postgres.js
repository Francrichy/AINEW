#!/usr/bin/env node
/**
 * One-time, guarded SQLite -> PostgreSQL data copy for Mlimani AI Studio.
 *
 * Usage:
 *   DATABASE_URL="..." SQLITE_PATH="./mlimani.db" PG_SCHEMA="ainew" node scripts/migrate-sqlite-to-postgres.js
 *
 * The target schema must already have been created with migrations/postgres/001_init.sql.
 * The script refuses to run if any target table contains rows. It never reads/writes
 * the Fleet public schema. It does not modify or delete the source SQLite database.
 */
import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'node:path';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const sqlitePath = process.env.SQLITE_PATH || 'mlimani.db';
const schema = process.env.PG_SCHEMA || 'ainew';

if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL haijawekwa. Hakuna data iliyobadilishwa.');
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
  console.error('ERROR: PG_SCHEMA si jina salama la schema.');
  process.exit(1);
}

const tables = [
  { name: 'users', columns: ['id','email','phone','name','pass','plan','expires','credit_used','created'], serial: 'id' },
  { name: 'daily', columns: ['k','d','n'] },
  { name: 'bots', columns: ['id','user_id','name','prompt'], serial: 'id' },
  { name: 'api_keys', columns: ['id','user_id','name','prefix','hash','created','last_used','revoked'], serial: 'id' },
  { name: 'connections', columns: ['user_id','provider','secret','meta','created'] },
  { name: 'plugin_prefs', columns: ['user_id','plugin_id','enabled'] },
  { name: 'payments', columns: ['id','user_id','plan','phone','ref','status','created'], serial: 'id' },
  { name: 'partner_applications', columns: ['id','company','contact','email','website','api_url','description','status','created'], serial: 'id' },
  { name: 'composio_usage', columns: ['user_id','month','calls'] },
  { name: 'studio_chat_sessions', columns: ['session_id','owner_key','duration_tier','started_at','expires_at'] },
];

const quoteIdent = value => '"' + value.replaceAll('"', '""') + '"';
const qname = name => quoteIdent(schema) + '.' + quoteIdent(name);
const sqlite = new Database(path.resolve(sqlitePath), { readonly: true, fileMustExist: true });
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: 'mlimani-ainew-migration' });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schemaCheck = await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema]);
    if (!schemaCheck.rowCount) throw new Error('Schema haipo. Kwanza tumia migrations/postgres/001_init.sql.');
    for (const table of tables) {
      const exists = await client.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
        [schema, table.name]
      );
      if (!exists.rowCount) throw new Error('Jedwali halipo: ' + schema + '.' + table.name);
      const count = await client.query('SELECT count(*)::bigint AS n FROM ' + qname(table.name));
      if (count.rows[0].n !== '0') throw new Error('Jedwali lengwa si tupu: ' + table.name + '. Hakuna kilichoingizwa.');
    }

    const summary = [];
    for (const table of tables) {
      const sourceRows = sqlite.prepare('SELECT ' + table.columns.map(quoteIdent).join(',') + ' FROM ' + quoteIdent(table.name)).all();
      if (!sourceRows.length) { summary.push({ table: table.name, copied: 0 }); continue; }
      const cols = table.columns.map(quoteIdent).join(',');
      const placeholders = table.columns.map((_, i) => '$' + (i + 1)).join(',');
      const insert = 'INSERT INTO ' + qname(table.name) + ' (' + cols + ') VALUES (' + placeholders + ')';
      for (const row of sourceRows) {
        await client.query(insert, table.columns.map(column => row[column] ?? null));
      }
      if (table.serial && sourceRows.length) {
        const seq = await client.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [schema + '.' + table.name, table.serial]);
        if (seq.rows[0]?.sequence) {
          await client.query(
            'SELECT setval($1, COALESCE((SELECT MAX(' + quoteIdent(table.serial) + ') FROM ' + qname(table.name) + '), 1), EXISTS (SELECT 1 FROM ' + qname(table.name) + '))',
            [seq.rows[0].sequence]
          );
        }
      }
      summary.push({ table: table.name, copied: sourceRows.length });
    }

    // Verify copied row counts before committing.
    for (const item of summary) {
      const sourceCount = sqlite.prepare('SELECT count(*) AS n FROM ' + quoteIdent(item.table)).get().n;
      const targetCount = Number((await client.query('SELECT count(*)::bigint AS n FROM ' + qname(item.table))).rows[0].n);
      if (sourceCount !== targetCount) throw new Error('Row count haifanani kwa ' + item.table);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ ok: true, schema, source: path.resolve(sqlitePath), summary }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error('MIGRATION IMESITISHWA:', error.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await pool.end();
}
