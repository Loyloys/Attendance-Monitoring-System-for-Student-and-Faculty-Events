import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { env } from '../src/config/env.js';

const require = createRequire(import.meta.url);

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function backupSqlite(sourcePath = env.sqliteSource) {
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`);
  fs.mkdirSync(env.migrationBackupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const backupPath = path.join(env.migrationBackupDir, `db.pre-mongodb.${stamp}.sqlite3`);
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

export async function openSqlite(sourcePath = env.sqliteSource) {
  const bytes = fs.readFileSync(sourcePath);
  const SQL = await initSqlJs({ locateFile: () => path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm') });
  return new SQL.Database(bytes);
}

export function selectRows(database, table, orderBy = '') {
  const result = database.exec(`SELECT * FROM "${table}"${orderBy ? ` ORDER BY ${orderBy}` : ''}`);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

export function sqliteDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  return new Date(`${normalized}Z`);
}

export function sourceSummary(database) {
  const tables = [
    'auth_user', 'events_userprofile', 'events_event', 'events_event_supervisors',
    'events_eventregistration', 'events_eventattendance', 'events_eventfeedback',
    'events_eventcertificate', 'events_attendancecode',
  ];
  return Object.fromEntries(tables.map((table) => [table, selectRows(database, table).length]));
}
