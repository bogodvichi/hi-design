'use strict';

/**
 * Dump CREATE TABLE / index / sequence DDL for every table in the hidesign DB.
 * Uses the pg module already installed in hidesign-web/node_modules.
 *
 * Migration-safe output order:
 *   1. DROP TABLE IF EXISTS ... CASCADE
 *   2. CREATE SEQUENCE          (before tables — columns may DEFAULT nextval(...))
 *   3. CREATE TABLE             (primary key inline)
 *   4. ALTER TABLE ADD CONSTRAINT (FK / unique / check — after all tables exist)
 *   5. CREATE INDEX             (excludes indexes backing a constraint)
 *   6. COMMENT
 *
 * Usage: node scripts/dump_schema.js > hidesign_schema.sql
 */

const { Pool } = require('../node_modules/pg');

// Connection params from config/config.default.js (config.db)
const db = {
  host: '10.17.68.13',
  port: 5432,
  user: 'yapovichi',
  password: 'e6a22c32a1fb66309c8b9497952b4639',
  database: 'hidesign',
};

const pool = new Pool({
  host: db.host,
  port: Number(db.port),
  user: db.user,
  password: db.password,
  database: db.database,
  connectionTimeoutMillis: 10000,
});

async function main() {
  const client = await pool.connect();
  try {
    const schemas = await client.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND schema_name NOT LIKE 'pg_temp_%'
      ORDER BY schema_name;
    `);

    const tableMeta = [];

    for (const s of schemas.rows) {
      const schema = s.schema_name;
      const tables = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `, [schema]);

      for (const t of tables.rows) {
        const table = t.table_name;

        const cols = await client.query(`
          SELECT
            a.attname AS column_name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr,
            a.atthasdef AS has_default
          FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE n.nspname = $1
            AND c.relname = $2
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum;
        `, [schema, table]);

        const constraints = await client.query(`
          SELECT
            con.conname AS constraint_name,
            pg_get_constraintdef(con.oid) AS definition,
            con.contype AS type
          FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relname = $2
          ORDER BY con.contype, con.conname;
        `, [schema, table]);

        const tblComment = await client.query(`
          SELECT obj_description(c.oid) AS comment
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2;
        `, [schema, table]);

        const colComments = await client.query(`
          SELECT a.attname AS column_name, col_description(a.attrelid, a.attnum) AS comment
          FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped;
        `, [schema, table]);

        // Indexes — exclude primary-key indexes AND indexes backing any constraint
        // (unique/unique-constraint indexes are created implicitly by ADD CONSTRAINT)
        const indexes = await client.query(`
          SELECT
            i.relname AS index_name,
            pg_get_indexdef(ix.indexrelid) AS definition
          FROM pg_catalog.pg_index ix
          JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
          JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
            AND NOT ix.indisprimary
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_constraint con
              WHERE con.conindid = ix.indexrelid
            )
          ORDER BY i.relname;
        `, [schema, table]);

        tableMeta.push({
          schema, table,
          cols: cols.rows,
          constraints: constraints.rows,
          tblComment: tblComment.rows[0]?.comment || null,
          colComments: colComments.rows,
          indexes: indexes.rows,
        });
      }
    }

    const seqs = await client.query(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS seq_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'S'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n.nspname, c.relname;
    `);

    // ---- Emit ----
    const out = [];
    out.push(`-- Schema dump for database: ${db.database}`);
    out.push(`-- Host: ${db.host}:${db.port}`);
    out.push(`-- Generated: ${new Date().toISOString()}`);
    out.push(`-- Migration-safe: DROP then CREATE, sequences before tables, constraints after all tables`);
    out.push('');
    out.push('SET client_encoding = \'UTF8\';');
    out.push('');

    // 1. DROP TABLE IF EXISTS ... CASCADE (reverse order for safety)
    out.push('-- ============================================================');
    out.push('-- Drop existing tables');
    out.push('-- ============================================================');
    for (const m of [...tableMeta].reverse()) {
      out.push(`DROP TABLE IF EXISTS ${m.schema}.${m.table} CASCADE;`);
    }
    out.push('');

    // 2. CREATE SEQUENCE (before tables — columns may DEFAULT nextval(...))
    if (seqs.rows.length > 0) {
      out.push('-- ============================================================');
      out.push('-- Sequences');
      out.push('-- ============================================================');
      for (const sq of seqs.rows) {
        out.push(`CREATE SEQUENCE IF NOT EXISTS ${sq.schema_name}.${sq.seq_name};`);
      }
      out.push('');
    }

    // 3. CREATE TABLE (primary key inline)
    out.push('-- ============================================================');
    out.push('-- Create tables');
    out.push('-- ============================================================');
    for (const m of tableMeta) {
      out.push(`-- Table: ${m.schema}.${m.table}`);
      const lines = [];
      for (const col of m.cols) {
        let line = `    ${col.column_name} ${col.data_type}`;
        if (col.not_null) line += ' NOT NULL';
        if (col.has_default && col.default_expr) line += ` DEFAULT ${col.default_expr}`;
        lines.push(line);
      }
      for (const con of m.constraints) {
        if (con.type === 'p') {
          lines.push(`    CONSTRAINT ${con.constraint_name} ${con.definition}`);
        }
      }
      out.push(`CREATE TABLE ${m.schema}.${m.table} (`);
      out.push(lines.join(',\n'));
      out.push(');');
      out.push('');
    }

    // 4. ALTER TABLE ADD CONSTRAINT (FK / unique / check — after all tables exist)
    out.push('-- ============================================================');
    out.push('-- Foreign keys, unique & check constraints');
    out.push('-- ============================================================');
    for (const m of tableMeta) {
      for (const con of m.constraints) {
        if (con.type !== 'p') {
          out.push(`ALTER TABLE ${m.schema}.${m.table} ADD CONSTRAINT ${con.constraint_name} ${con.definition};`);
        }
      }
    }
    out.push('');

    // 5. CREATE INDEX (excludes constraint-backed indexes)
    out.push('-- ============================================================');
    out.push('-- Indexes');
    out.push('-- ============================================================');
    for (const m of tableMeta) {
      for (const ix of m.indexes) {
        out.push(`${ix.definition};`);
      }
    }
    out.push('');

    // 6. Comments
    out.push('-- ============================================================');
    out.push('-- Comments');
    out.push('-- ============================================================');
    for (const m of tableMeta) {
      if (m.tblComment) {
        out.push(`COMMENT ON TABLE ${m.schema}.${m.table} IS '${m.tblComment.replace(/'/g, "''")}';`);
      }
      for (const cc of m.colComments) {
        if (cc.comment) {
          out.push(`COMMENT ON COLUMN ${m.schema}.${m.table}.${cc.column_name} IS '${cc.comment.replace(/'/g, "''")}';`);
        }
      }
    }
    out.push('');

    console.log(out.join('\n'));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
