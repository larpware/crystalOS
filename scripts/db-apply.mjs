#!/usr/bin/env node
/** Applies every migration to an embedded Postgres and prints a table list.
 *  Run: npm run db:apply   (local only — it never touches the Supabase project) */
import { createDatabase, migrationFiles, query } from "./pglite-harness.mjs";

const files = migrationFiles();
console.log(`applying ${files.length} migration(s): ${files.join(", ")}`);

const started = Date.now();
const db = await createDatabase();
console.log(`ok in ${Date.now() - started}ms`);

const tables = await query(
  db,
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`,
);
console.log(`\npublic tables (${tables.length}):`);
console.log(tables.map((row) => `  ${row.table_name}`).join("\n"));

const functions = await query(
  db,
  `select proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'verification_%'
    order by proname`,
);
console.log(`\nverification functions (${functions.length}):`);
console.log(functions.map((row) => `  ${row.proname}`).join("\n"));
