/**
 * TradeBooks — Database Layer
 * SQLite via better-sqlite3, WAL mode, full schema + seed categories.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'tradebooks.db');
const db = new Database(DB_PATH);

// ── Pragmas ──────────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    schedule_c_line TEXT,
    type            TEXT NOT NULL DEFAULT 'expense',
    sort_order      INTEGER DEFAULT 0,
    active          INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    address    TEXT,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    client_id   INTEGER REFERENCES clients(id),
    status      TEXT DEFAULT 'active',
    address     TEXT,
    description TEXT,
    budget      REAL,
    start_date  TEXT,
    end_date    TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    client_id      INTEGER REFERENCES clients(id) NOT NULL,
    job_id         INTEGER REFERENCES jobs(id),
    status         TEXT DEFAULT 'draft',
    issue_date     TEXT NOT NULL,
    due_date       TEXT,
    subtotal       REAL,
    tax_rate       REAL DEFAULT 0,
    tax_amount     REAL DEFAULT 0,
    total          REAL,
    notes          TEXT,
    paid_date      TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    amount         REAL NOT NULL,
    vendor         TEXT,
    category_id    INTEGER REFERENCES categories(id),
    job_id         INTEGER REFERENCES jobs(id),
    date           TEXT NOT NULL,
    notes          TEXT,
    receipt_path   TEXT,
    payment_method TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    amount         REAL NOT NULL,
    client_id      INTEGER REFERENCES clients(id),
    job_id         INTEGER REFERENCES jobs(id),
    category_id    INTEGER REFERENCES categories(id),
    date           TEXT NOT NULL,
    description    TEXT,
    payment_method TEXT,
    reference      TEXT,
    invoice_id     INTEGER REFERENCES invoices(id),
    created_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity    REAL DEFAULT 1,
    unit_price  REAL NOT NULL,
    amount      REAL NOT NULL,
    sort_order  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS mileage_trips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    destination TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    miles       REAL NOT NULL,
    job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    round_trip  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subcontractor_details (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name  TEXT NOT NULL UNIQUE,
    ein          TEXT,
    address      TEXT,
    city         TEXT,
    state        TEXT,
    zip          TEXT,
    needs_1099   INTEGER DEFAULT 1,
    filed_years  TEXT DEFAULT '[]',
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

// ── Indexes ──────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_expenses_date      ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_expenses_job        ON expenses(job_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_category   ON expenses(category_id);
  CREATE INDEX IF NOT EXISTS idx_income_date         ON income(date);
  CREATE INDEX IF NOT EXISTS idx_income_job          ON income(job_id);
  CREATE INDEX IF NOT EXISTS idx_income_client       ON income(client_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status         ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_client         ON jobs(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_client     ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage_trips(date);
  CREATE INDEX IF NOT EXISTS idx_mileage_job  ON mileage_trips(job_id);
`);

// ── Helpers ──────────────────────────────────────────────────────────
function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}

function get(sql, params = {}) {
  return db.prepare(sql).get(params);
}

function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

// ── Seed Categories ──────────────────────────────────────────────────
function seedCategories() {
  const existing = get('SELECT COUNT(*) AS cnt FROM categories');
  if (existing.cnt > 0) return;

  const insert = db.prepare(`
    INSERT INTO categories (name, schedule_c_line, type, sort_order)
    VALUES (@name, @line, @type, @sort)
  `);

  const seedTx = db.transaction(() => {
    // Expense categories (Schedule C lines)
    const expenses = [
      { name: 'Materials & Supplies',    line: 'Line 22',   sort: 1  },
      { name: 'Subcontractor Labor',     line: 'Line 11',   sort: 2  },
      { name: 'Vehicle & Fuel',          line: 'Line 9',    sort: 3  },
      { name: 'Tools & Equipment',       line: 'Line 22',   sort: 4  },
      { name: 'Insurance',               line: 'Line 15',   sort: 5  },
      { name: 'Office Expenses',         line: 'Line 18',   sort: 6  },
      { name: 'Advertising',             line: 'Line 8',    sort: 7  },
      { name: 'Licenses & Permits',      line: 'Line 23',   sort: 8  },
      { name: 'Rent / Lease',            line: 'Line 20a/b', sort: 9  },
      { name: 'Utilities',               line: 'Line 25',   sort: 10 },
      { name: 'Repairs & Maintenance',   line: 'Line 21',   sort: 11 },
      { name: 'Travel',                  line: 'Line 24a',  sort: 12 },
      { name: 'Meals',                   line: 'Line 24b',  sort: 13 },
      { name: 'Professional Services',   line: 'Line 17',   sort: 14 },
      { name: 'Other',                   line: 'Line 27a',  sort: 15 },
    ];

    for (const e of expenses) {
      insert.run({ name: e.name, line: e.line, type: 'expense', sort: e.sort });
    }

    // Income categories (no Schedule C line)
    const incomes = [
      { name: 'Contract Work',  sort: 1 },
      { name: 'Service Call',   sort: 2 },
      { name: 'Change Order',   sort: 3 },
      { name: 'Other Income',   sort: 4 },
    ];

    for (const i of incomes) {
      insert.run({ name: i.name, line: null, type: 'income', sort: i.sort });
    }
  });

  seedTx();
}

// Run seed on first load
seedCategories();

// ── Migrations (ALTER TABLE — safe to re-run, fails silently if column exists) ──
try {
  db.exec(`ALTER TABLE expenses ADD COLUMN is_subcontractor INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists — that's fine
}

// ── Seed Settings ────────────────────────────────────────────────────
db.exec(`
  INSERT OR IGNORE INTO settings (key, value) VALUES ('irs_mileage_rate', '0.70');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_host', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_port', '587');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_user', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_pass', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_from', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_enabled', '0');
`);

// ── Invoice Number Generator ─────────────────────────────────────────
function nextInvoiceNumber() {
  const row = get(`
    SELECT invoice_number FROM invoices
    ORDER BY CAST(SUBSTR(invoice_number, 5) AS INTEGER) DESC
    LIMIT 1
  `);

  if (!row) return 'INV-0001';

  const current = parseInt(row.invoice_number.replace('INV-', ''), 10);
  const next = current + 1;
  return `INV-${String(next).padStart(4, '0')}`;
}

// ── Exports ──────────────────────────────────────────────────────────
module.exports = { db, run, get, all, seedCategories, nextInvoiceNumber };
