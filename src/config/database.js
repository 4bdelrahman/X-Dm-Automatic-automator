/**
 * Database Module — using sql.js (pure JS SQLite, no native deps)
 * Persists to disk via manual save after writes.
 */

import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'followups.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SQL = await initSqlJs();

let db;
if (fs.existsSync(DB_PATH)) {
  const buffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(buffer);
} else {
  db = new SQL.Database();
}

db.run('PRAGMA foreign_keys = ON');

// ─── Save helper ──────────────────────────────────
function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-save every 10 seconds
setInterval(save, 10000);

// ─── Schema ───────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    x_handle TEXT NOT NULL UNIQUE,
    display_name TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'new',
    sequence_id TEXT,
    current_step INTEGER DEFAULT 0,
    next_followup_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    category TEXT DEFAULT 'general',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    steps TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    template_id TEXT,
    sequence_id TEXT,
    step_number INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    dms_sent INTEGER DEFAULT 0,
    dms_failed INTEGER DEFAULT 0,
    replies_received INTEGER DEFAULT 0,
    new_leads INTEGER DEFAULT 0
  )
`);

// ─── Seed default data ────────────────────────────
const existingSeq = db.exec("SELECT id FROM sequences WHERE name = 'Default Follow-up'");
if (existingSeq.length === 0 || existingSeq[0].values.length === 0) {
  const seqId = uuidv4();
  db.run(
    `INSERT INTO sequences (id, name, description, steps) VALUES (?, ?, ?, ?)`,
    [seqId, 'Default Follow-up', 'Standard follow-up sequence: Initial → Day 3 → Day 7 → Day 11',
      JSON.stringify([
        { step: 0, delay_days: 0, template_name: 'Initial Outreach', description: 'First contact message' },
        { step: 1, delay_days: 3, template_name: 'Follow-up #1', description: 'First follow-up after 3 days' },
        { step: 2, delay_days: 4, template_name: 'Follow-up #2', description: 'Second follow-up after 4 more days' },
        { step: 3, delay_days: 4, template_name: 'Follow-up #3', description: 'Final follow-up after 4 more days' }
      ])
    ]
  );

  const templates = [
    { name: 'Initial Outreach', content: "Hey {firstName}! 👋\n\nI came across your profile and really liked what you're doing with {topic}. I think we could have a great conversation about it.\n\n{customNote}\n\nWould love to connect!", category: 'outreach' },
    { name: 'Follow-up #1', content: "Hey {firstName}, just wanted to follow up on my last message! I know things get busy.\n\nI genuinely think {topic} is something worth exploring together. Let me know if you'd be open to a quick chat! 🙌", category: 'followup' },
    { name: 'Follow-up #2', content: "Hi {firstName}! Not trying to be pushy at all — just circling back one more time.\n\nIf now isn't the right time, totally understand. But if you're interested in connecting about {topic}, I'm here! 😊", category: 'followup' },
    { name: 'Follow-up #3', content: "Last one from me, {firstName}! 😅\n\nJust wanted to leave the door open — if you ever want to chat about {topic} or anything else, feel free to reach out anytime.\n\nAll the best! 🚀", category: 'followup' }
  ];

  for (const t of templates) {
    db.run(`INSERT INTO templates (id, name, content, variables, category) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), t.name, t.content, JSON.stringify(['{firstName}', '{topic}', '{customNote}']), t.category]);
  }

  save();
  console.log('✅ Default sequence and templates created');
}

// ─── Wrapper: sql.js ↔ better-sqlite3 compatible API ──
// So the rest of the code can use db.prepare(...).all() / .get() / .run() syntax

class PreparedStatement {
  constructor(sqlDb, sql) {
    this.db = sqlDb;
    this.sql = sql;
  }

  all(...params) {
    try {
      const result = this.db.exec(this.sql, params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
      if (result.length === 0) return [];
      const cols = result[0].columns;
      return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
      });
    } catch (e) { console.error('SQL all error:', this.sql, e.message); return []; }
  }

  get(...params) {
    const rows = this.all(...params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  run(...params) {
    try {
      this.db.run(this.sql, params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
      save();
      return { changes: this.db.getRowsModified() };
    } catch (e) { console.error('SQL run error:', this.sql, e.message); return { changes: 0 }; }
  }
}

// Create a wrapper that mimics better-sqlite3 API
const dbWrapper = {
  prepare(sql) {
    return new PreparedStatement(db, sql);
  },
  exec(sql) {
    db.run(sql);
    save();
  },
  close() {
    save();
    db.close();
  },
  transaction(fn) {
    return () => {
      db.run('BEGIN TRANSACTION');
      try { fn(); db.run('COMMIT'); save(); }
      catch (e) { db.run('ROLLBACK'); throw e; }
    };
  }
};

export default dbWrapper;
