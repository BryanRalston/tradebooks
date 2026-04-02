const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const multer = require('multer');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { db, run, get, all, nextInvoiceNumber } = require('./db');
const pdf = require('./pdf');
const { SQLiteStore, isPasswordSet, setPassword, checkPassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3143;

// ---------------------------------------------------------------------------
// Security — Helmet
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------
const sessionSecret = (() => {
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (stored) return stored.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('session_secret', secret);
  return secret;
})();

app.use(express.json());

app.use(session({
  store: new SQLiteStore(db),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'tradebooks.sid',
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
}));

// Intercept root path BEFORE static middleware to enforce setup/login
app.get('/', (req, res, next) => {
  if (!isPasswordSet(db)) return res.redirect('/setup.html');
  if (!req.session?.authenticated) return res.redirect('/login.html');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/receipts', express.static(path.join(__dirname, 'uploads', 'receipts')));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' }
});

// ---------------------------------------------------------------------------
// Auth routes (no auth required)
// ---------------------------------------------------------------------------
app.post('/api/auth/setup', authLimiter, async (req, res) => {
  if (isPasswordSet(db)) return res.status(403).json({ error: 'Password already configured' });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  await setPassword(db, password);
  req.session.authenticated = true;
  res.json({ success: true });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const valid = await checkPassword(db, password);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });
  req.session.authenticated = true;
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('tradebooks.sid');
    res.json({ success: true });
  });
});

app.get('/api/status', (req, res) => res.json({ status: 'ok' }));

app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: !!req.session?.authenticated,
    passwordSet: isPasswordSet(db)
  });
});

// ---------------------------------------------------------------------------
// Auth middleware — protect everything below
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  // Skip static files and auth endpoints
  if (req.path.startsWith('/api/auth')) return next();
  if (req.path === '/login.html' || req.path === '/setup.html') return next();
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|webmanifest|json)$/)) return next();
  if (req.path === '/sw.js' || req.path === '/manifest.json') return next();

  // Check if password is set
  if (!isPasswordSet(db)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Setup required' });
    return res.redirect('/setup.html');
  }

  // Check if authenticated
  if (!req.session?.authenticated) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login.html');
  }

  next();
});

// ---------------------------------------------------------------------------
// Input validation helper
// ---------------------------------------------------------------------------
function validate(body, rules) {
  const errors = [];
  for (const [field, checks] of Object.entries(rules)) {
    const val = body[field];
    if (checks.required && (val === undefined || val === null || val === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    if (val !== undefined && val !== null && val !== '') {
      if (checks.type === 'number' && (typeof val !== 'number' || isNaN(val))) errors.push(`${field} must be a number`);
      if (checks.type === 'number' && checks.min !== undefined && val < checks.min) errors.push(`${field} must be at least ${checks.min}`);
      if (checks.type === 'string' && typeof val !== 'string') errors.push(`${field} must be a string`);
      if (checks.maxLength && typeof val === 'string' && val.length > checks.maxLength) errors.push(`${field} exceeds max length of ${checks.maxLength}`);
      if (checks.oneOf && !checks.oneOf.includes(val)) errors.push(`${field} must be one of: ${checks.oneOf.join(', ')}`);
      if (checks.date && !/^\d{4}-\d{2}-\d{2}$/.test(val)) errors.push(`${field} must be a valid date (YYYY-MM-DD)`);
    }
  }
  return errors.length ? errors : null;
}

// ---------------------------------------------------------------------------
// Multer config for receipt uploads
// ---------------------------------------------------------------------------
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'receipts');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}_${Date.now()}${ext}`);
  }
});

const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, png, gif, webp) are allowed'));
    }
  }
});

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------
function toCSV(headers, rows) {
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n');
}

function sendCSV(res, filename, headers, rows) {
  const csv = toCSV(headers, rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// ---------------------------------------------------------------------------
// Date range helper
// ---------------------------------------------------------------------------
function dateRange(query) {
  const year = new Date().getFullYear();
  const from = query.from || `${year}-01-01`;
  const to = query.to || `${year}-12-31`;
  return { from, to };
}

// ===========================================================================
// SETTINGS
// ===========================================================================
app.get('/api/settings', async (req, res) => {
  try {
    const hiddenKeys = ['password_hash', 'session_secret'];
    const rows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      if (hiddenKeys.includes(row.key)) continue;
      // Never expose smtp_pass — return masked indicator if set
      if (row.key === 'smtp_pass') {
        settings[row.key] = row.value ? '••••' : '';
        continue;
      }
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const protectedKeys = ['password_hash', 'session_secret'];
    const pairs = req.body;
    for (const [key, value] of Object.entries(pairs)) {
      if (protectedKeys.includes(key)) continue; // Don't allow overwriting security keys
      // If smtp_pass is the masked sentinel, don't overwrite the stored value
      if (key === 'smtp_pass' && value === '••••') continue;
      await run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
        [key, value, value]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// CATEGORIES
// ===========================================================================
app.get('/api/categories', async (req, res) => {
  try {
    let sql = 'SELECT * FROM categories WHERE 1=1';
    const params = [];
    if (req.query.type) {
      sql += ' AND type = ?';
      params.push(req.query.type);
    }
    if (req.query.active !== undefined) {
      sql += ' AND active = ?';
      params.push(Number(req.query.active));
    }
    sql += ' ORDER BY name';
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name, type, schedule_c_line } = req.body;
    const vErrors = validate(req.body, {
      name: { required: true, type: 'string', maxLength: 200 },
      type: { required: true, type: 'string', oneOf: ['expense', 'income'] },
      schedule_c_line: { type: 'string', maxLength: 50 }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });
    const result = await run(
      'INSERT INTO categories (name, type, schedule_c_line, active) VALUES (?, ?, ?, 1)',
      [name, type, schedule_c_line || null]
    );
    const category = await get('SELECT * FROM categories WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(category);
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const { name, type, schedule_c_line, active } = req.body;
    const existing = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    await run(
      'UPDATE categories SET name = ?, type = ?, schedule_c_line = ?, active = ? WHERE id = ?',
      [
        name !== undefined ? name : existing.name,
        type !== undefined ? type : existing.type,
        schedule_c_line !== undefined ? schedule_c_line : existing.schedule_c_line,
        active !== undefined ? active : existing.active,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/categories/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    await run('UPDATE categories SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/categories/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// CLIENTS
// ===========================================================================
app.get('/api/clients', async (req, res) => {
  try {
    let sql = 'SELECT * FROM clients WHERE 1=1';
    const params = [];
    if (req.query.q) {
      sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const q = `%${req.query.q}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY name';
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/clients error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const jobCount = await get('SELECT COUNT(*) as count FROM jobs WHERE client_id = ?', [req.params.id]);
    const totalEarned = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE client_id = ?',
      [req.params.id]
    );
    const outstanding = await get(
      `SELECT COALESCE(SUM(total), 0) as total FROM invoices
       WHERE client_id = ? AND status IN ('draft', 'sent', 'overdue')`,
      [req.params.id]
    );

    res.json({
      ...client,
      total_jobs: jobCount.count,
      total_earned: totalEarned.total,
      total_outstanding: outstanding.total
    });
  } catch (err) {
    console.error('GET /api/clients/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { name, email, phone, address, notes } = req.body;
    const vErrors = validate(req.body, {
      name: { required: true, type: 'string', maxLength: 200 },
      email: { type: 'string', maxLength: 200 },
      phone: { type: 'string', maxLength: 50 },
      address: { type: 'string', maxLength: 500 },
      notes: { type: 'string', maxLength: 5000 }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const result = await run(
      'INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)',
      [name, email || null, phone || null, address || null, notes || null]
    );
    const client = await get('SELECT * FROM clients WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(client);
  } catch (err) {
    console.error('POST /api/clients error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const { name, email, phone, address, notes } = req.body;
    await run(
      'UPDATE clients SET name = ?, email = ?, phone = ?, address = ?, notes = ? WHERE id = ?',
      [
        name !== undefined ? name : existing.name,
        email !== undefined ? email : existing.email,
        phone !== undefined ? phone : existing.phone,
        address !== undefined ? address : existing.address,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/clients/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const linkedJobs = await get('SELECT COUNT(*) as count FROM jobs WHERE client_id = ?', [req.params.id]);
    const linkedIncome = await get('SELECT COUNT(*) as count FROM income WHERE client_id = ?', [req.params.id]);

    if (linkedJobs.count > 0 || linkedIncome.count > 0) {
      return res.status(409).json({ error: 'Cannot delete client with linked jobs or income records' });
    }

    await run('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/clients/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// JOBS
// ===========================================================================
app.get('/api/jobs', async (req, res) => {
  try {
    let sql = `SELECT j.*, c.name as client_name,
               COALESCE((SELECT SUM(amount) FROM income WHERE job_id = j.id), 0) as total_income,
               COALESCE((SELECT SUM(amount) FROM expenses WHERE job_id = j.id), 0) as total_expenses
               FROM jobs j
               LEFT JOIN clients c ON j.client_id = c.id
               WHERE 1=1`;
    const params = [];

    if (req.query.status) {
      sql += ' AND j.status = ?';
      params.push(req.query.status);
    }
    if (req.query.client_id) {
      sql += ' AND j.client_id = ?';
      params.push(req.query.client_id);
    }
    if (req.query.q) {
      sql += ' AND (j.name LIKE ? OR j.address LIKE ?)';
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }
    sql += ' ORDER BY j.created_at DESC';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await get(
      `SELECT j.*, c.name as client_name, c.email as client_email, c.phone as client_phone
       FROM jobs j
       LEFT JOIN clients c ON j.client_id = c.id
       WHERE j.id = ?`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const totalIncome = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE job_id = ?',
      [req.params.id]
    );
    const totalExpenses = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE job_id = ?',
      [req.params.id]
    );

    const profit = totalIncome.total - totalExpenses.total;
    const budgetRemaining = job.budget ? job.budget - totalExpenses.total : null;

    res.json({
      ...job,
      total_income: totalIncome.total,
      total_expenses: totalExpenses.total,
      profit,
      budget_remaining: budgetRemaining
    });
  } catch (err) {
    console.error('GET /api/jobs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { name, client_id, address, description, status, budget, start_date, end_date } = req.body;
    const vErrors = validate(req.body, {
      name: { required: true, type: 'string', maxLength: 200 },
      address: { type: 'string', maxLength: 500 },
      description: { type: 'string', maxLength: 5000 },
      status: { type: 'string', oneOf: ['active', 'completed', 'on_hold', 'cancelled'] },
      budget: { type: 'number', min: 0 },
      start_date: { date: true },
      end_date: { date: true }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const result = await run(
      `INSERT INTO jobs (name, client_id, address, description, status, budget, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        client_id || null,
        address || null,
        description || null,
        status || 'active',
        budget || null,
        start_date || null,
        end_date || null
      ]
    );
    const job = await get('SELECT * FROM jobs WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(job);
  } catch (err) {
    console.error('POST /api/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    const { name, client_id, address, description, status, budget, start_date, end_date } = req.body;
    await run(
      `UPDATE jobs SET name = ?, client_id = ?, address = ?, description = ?, status = ?,
       budget = ?, start_date = ?, end_date = ? WHERE id = ?`,
      [
        name !== undefined ? name : existing.name,
        client_id !== undefined ? client_id : existing.client_id,
        address !== undefined ? address : existing.address,
        description !== undefined ? description : existing.description,
        status !== undefined ? status : existing.status,
        budget !== undefined ? budget : existing.budget,
        start_date !== undefined ? start_date : existing.start_date,
        end_date !== undefined ? end_date : existing.end_date,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/jobs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/jobs/:id/status', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    const { status } = req.body;
    const vErrors = validate(req.body, {
      status: { required: true, type: 'string', oneOf: ['active', 'completed', 'on_hold', 'cancelled'] }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    await run('UPDATE jobs SET status = ? WHERE id = ?', [status, req.params.id]);
    const updated = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/jobs/:id/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    const linkedExpenses = await get('SELECT COUNT(*) as count FROM expenses WHERE job_id = ?', [req.params.id]);
    const linkedIncome = await get('SELECT COUNT(*) as count FROM income WHERE job_id = ?', [req.params.id]);

    if (linkedExpenses.count > 0 || linkedIncome.count > 0) {
      return res.status(409).json({ error: 'Cannot delete job with linked transactions' });
    }

    await run('DELETE FROM jobs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/jobs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// EXPENSES
// ===========================================================================
app.get('/api/expenses', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let sql = `SELECT e.*, c.name as category_name, j.name as job_name
               FROM expenses e
               LEFT JOIN categories c ON e.category_id = c.id
               LEFT JOIN jobs j ON e.job_id = j.id
               WHERE e.date >= ? AND e.date <= ?`;
    const params = [from, to];

    if (req.query.category_id) {
      sql += ' AND e.category_id = ?';
      params.push(req.query.category_id);
    }
    if (req.query.job_id) {
      sql += ' AND e.job_id = ?';
      params.push(req.query.job_id);
    }
    if (req.query.q) {
      sql += ' AND (e.vendor LIKE ? OR e.notes LIKE ?)';
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }

    sql += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/expenses/:id', async (req, res) => {
  try {
    const expense = await get(
      `SELECT e.*, c.name as category_name, j.name as job_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       LEFT JOIN jobs j ON e.job_id = j.id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    console.error('GET /api/expenses/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { date, amount, vendor, category_id, job_id, notes } = req.body;
    const is_subcontractor = req.body.is_subcontractor ? 1 : 0;
    const payment_method = (req.body.payment_method || '').toLowerCase();
    const vErrors = validate({ ...req.body, payment_method }, {
      date: { required: true, date: true },
      amount: { required: true, type: 'number', min: 0.01 },
      vendor: { type: 'string', maxLength: 200 },
      notes: { type: 'string', maxLength: 5000 },
      payment_method: { type: 'string', oneOf: ['cash', 'check', 'card', 'transfer'] }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const result = await run(
      `INSERT INTO expenses (date, amount, vendor, category_id, job_id, payment_method, notes, is_subcontractor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, amount, vendor || null, category_id || null, job_id || null, payment_method || null, notes || null, is_subcontractor]
    );
    const expense = await get('SELECT * FROM expenses WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(expense);
  } catch (err) {
    console.error('POST /api/expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    const { date, amount, vendor, category_id, job_id, notes } = req.body;
    const payment_method = req.body.payment_method !== undefined ? req.body.payment_method.toLowerCase() : undefined;
    const is_subcontractor = req.body.is_subcontractor !== undefined ? (req.body.is_subcontractor ? 1 : 0) : existing.is_subcontractor;
    await run(
      `UPDATE expenses SET date = ?, amount = ?, vendor = ?, category_id = ?, job_id = ?,
       payment_method = ?, notes = ?, is_subcontractor = ? WHERE id = ?`,
      [
        date !== undefined ? date : existing.date,
        amount !== undefined ? amount : existing.amount,
        vendor !== undefined ? vendor : existing.vendor,
        category_id !== undefined ? category_id : existing.category_id,
        job_id !== undefined ? job_id : existing.job_id,
        payment_method !== undefined ? payment_method : existing.payment_method,
        notes !== undefined ? notes : existing.notes,
        is_subcontractor,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/expenses/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    // Delete receipt file if it exists
    if (existing.receipt_path) {
      try {
        const filePath = path.join(__dirname, 'uploads', 'receipts', existing.receipt_path);
        fs.unlinkSync(filePath);
      } catch (e) {
        // File may already be gone, that's fine
      }
    }

    await run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/expenses/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Receipt upload
app.post('/api/expenses/:id/receipt', receiptUpload.single('receipt'), async (req, res) => {
  try {
    const existing = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Delete old receipt if replacing
    if (existing.receipt_path) {
      try {
        fs.unlinkSync(path.join(__dirname, 'uploads', 'receipts', existing.receipt_path));
      } catch (e) { /* ignore */ }
    }

    await run('UPDATE expenses SET receipt_path = ? WHERE id = ?', [req.file.filename, req.params.id]);
    const updated = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('POST /api/expenses/:id/receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve receipt image
app.get('/api/expenses/:id/receipt', async (req, res) => {
  try {
    const expense = await get('SELECT receipt_path FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!expense.receipt_path) return res.status(404).json({ error: 'No receipt attached' });

    res.redirect(`/receipts/${expense.receipt_path}`);
  } catch (err) {
    console.error('GET /api/expenses/:id/receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete receipt
app.delete('/api/expenses/:id/receipt', async (req, res) => {
  try {
    const expense = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!expense.receipt_path) return res.status(404).json({ error: 'No receipt attached' });

    try {
      fs.unlinkSync(path.join(__dirname, 'uploads', 'receipts', expense.receipt_path));
    } catch (e) { /* ignore */ }

    await run('UPDATE expenses SET receipt_path = NULL WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/expenses/:id/receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// INCOME
// ===========================================================================
app.get('/api/income', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let sql = `SELECT i.*, c.name as client_name, j.name as job_name, cat.name as category_name
               FROM income i
               LEFT JOIN clients c ON i.client_id = c.id
               LEFT JOIN jobs j ON i.job_id = j.id
               LEFT JOIN categories cat ON i.category_id = cat.id
               WHERE i.date >= ? AND i.date <= ?`;
    const params = [from, to];

    if (req.query.client_id) {
      sql += ' AND i.client_id = ?';
      params.push(req.query.client_id);
    }
    if (req.query.job_id) {
      sql += ' AND i.job_id = ?';
      params.push(req.query.job_id);
    }
    if (req.query.q) {
      sql += ' AND (i.description LIKE ? OR c.name LIKE ?)';
      const q = `%${req.query.q}%`;
      params.push(q, q);
    }

    sql += ' ORDER BY i.date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/income error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/income/:id', async (req, res) => {
  try {
    const income = await get(
      `SELECT i.*, c.name as client_name, j.name as job_name, cat.name as category_name
       FROM income i
       LEFT JOIN clients c ON i.client_id = c.id
       LEFT JOIN jobs j ON i.job_id = j.id
       LEFT JOIN categories cat ON i.category_id = cat.id
       WHERE i.id = ?`,
      [req.params.id]
    );
    if (!income) return res.status(404).json({ error: 'Income record not found' });
    res.json(income);
  } catch (err) {
    console.error('GET /api/income/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/income', async (req, res) => {
  try {
    const { date, amount, description, client_id, job_id, category_id, invoice_id } = req.body;
    const payment_method = (req.body.payment_method || '').toLowerCase();
    const vErrors = validate({ ...req.body, payment_method }, {
      date: { required: true, date: true },
      amount: { required: true, type: 'number', min: 0.01 },
      description: { type: 'string', maxLength: 500 },
      payment_method: { type: 'string', oneOf: ['cash', 'check', 'card', 'transfer'] }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const result = await run(
      `INSERT INTO income (date, amount, description, client_id, job_id, category_id, payment_method, invoice_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date, amount, description || null, client_id || null,
        job_id || null, category_id || null, payment_method || null, invoice_id || null
      ]
    );
    const income = await get('SELECT * FROM income WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(income);
  } catch (err) {
    console.error('POST /api/income error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/income/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM income WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Income record not found' });

    const { date, amount, description, client_id, job_id, category_id, invoice_id } = req.body;
    const payment_method = req.body.payment_method !== undefined ? req.body.payment_method.toLowerCase() : undefined;
    await run(
      `UPDATE income SET date = ?, amount = ?, description = ?, client_id = ?, job_id = ?,
       category_id = ?, payment_method = ?, invoice_id = ? WHERE id = ?`,
      [
        date !== undefined ? date : existing.date,
        amount !== undefined ? amount : existing.amount,
        description !== undefined ? description : existing.description,
        client_id !== undefined ? client_id : existing.client_id,
        job_id !== undefined ? job_id : existing.job_id,
        category_id !== undefined ? category_id : existing.category_id,
        payment_method !== undefined ? payment_method : existing.payment_method,
        invoice_id !== undefined ? invoice_id : existing.invoice_id,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM income WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/income/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/income/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM income WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Income record not found' });

    await run('DELETE FROM income WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/income/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// INVOICES
// ===========================================================================
app.get('/api/invoices', async (req, res) => {
  try {
    let sql = `SELECT inv.*, c.name as client_name, j.name as job_name
               FROM invoices inv
               LEFT JOIN clients c ON inv.client_id = c.id
               LEFT JOIN jobs j ON inv.job_id = j.id
               WHERE 1=1`;
    const params = [];

    if (req.query.status) {
      sql += ' AND inv.status = ?';
      params.push(req.query.status);
    }
    if (req.query.client_id) {
      sql += ' AND inv.client_id = ?';
      params.push(req.query.client_id);
    }
    if (req.query.job_id) {
      sql += ' AND inv.job_id = ?';
      params.push(req.query.job_id);
    }

    sql += ' ORDER BY inv.created_at DESC';
    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await get(
      `SELECT inv.*, c.name as client_name, c.email as client_email,
              c.phone as client_phone, c.address as client_address,
              j.name as job_name
       FROM invoices inv
       LEFT JOIN clients c ON inv.client_id = c.id
       LEFT JOIN jobs j ON inv.job_id = j.id
       WHERE inv.id = ?`,
      [req.params.id]
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const items = await all(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id',
      [req.params.id]
    );

    res.json({ ...invoice, items });
  } catch (err) {
    console.error('GET /api/invoices/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const { client_id, job_id, issue_date, date, due_date, tax_rate, notes, items } = req.body;
    const vErrors = validate(req.body, {
      client_id: { required: true, type: 'number' },
      issue_date: { date: true },
      due_date: { date: true },
      tax_rate: { type: 'number', min: 0 },
      notes: { type: 'string', maxLength: 5000 }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });
    if (!items || !items.length) {
      return res.status(400).json({ error: 'items are required' });
    }

    const invoice_number = await nextInvoiceNumber();
    const rate = tax_rate || 0;

    // Calculate totals from items
    let subtotal = 0;
    for (const item of items) {
      subtotal += (item.quantity || 1) * (item.unit_price || 0);
    }
    const tax_amount = Math.round(subtotal * rate) / 100;
    const total = subtotal + tax_amount;

    const result = await run(
      `INSERT INTO invoices (invoice_number, client_id, job_id, issue_date, due_date, subtotal, tax_rate, tax_amount, total, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        invoice_number,
        client_id,
        job_id || null,
        issue_date || date || new Date().toISOString().split('T')[0],
        due_date || null,
        subtotal,
        rate,
        tax_amount,
        total,
        notes || null
      ]
    );

    const invoiceId = result.lastInsertRowid;

    // Insert line items
    for (const item of items) {
      await run(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?)`,
        [
          invoiceId,
          item.description || '',
          item.quantity || 1,
          item.unit_price || 0,
          (item.quantity || 1) * (item.unit_price || 0)
        ]
      );
    }

    const invoice = await get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    const createdItems = await all('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    res.status(201).json({ ...invoice, items: createdItems });
  } catch (err) {
    console.error('POST /api/invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const { client_id, job_id, date, due_date, tax_rate, notes, items } = req.body;
    const rate = tax_rate !== undefined ? tax_rate : existing.tax_rate;

    // Recalculate totals if items provided
    let subtotal = existing.subtotal;
    let tax_amount = existing.tax_amount;
    let total = existing.total;

    if (items && items.length) {
      subtotal = 0;
      for (const item of items) {
        subtotal += (item.quantity || 1) * (item.unit_price || 0);
      }
      tax_amount = Math.round(subtotal * rate) / 100;
      total = subtotal + tax_amount;
    }

    await run(
      `UPDATE invoices SET client_id = ?, job_id = ?, date = ?, due_date = ?,
       subtotal = ?, tax_rate = ?, tax_amount = ?, total = ?, notes = ? WHERE id = ?`,
      [
        client_id !== undefined ? client_id : existing.client_id,
        job_id !== undefined ? job_id : existing.job_id,
        date !== undefined ? date : existing.date,
        due_date !== undefined ? due_date : existing.due_date,
        subtotal,
        rate,
        tax_amount,
        total,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      ]
    );

    // Replace all line items if provided
    if (items && items.length) {
      await run('DELETE FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
      for (const item of items) {
        await run(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
           VALUES (?, ?, ?, ?, ?)`,
          [
            req.params.id,
            item.description || '',
            item.quantity || 1,
            item.unit_price || 0,
            (item.quantity || 1) * (item.unit_price || 0)
          ]
        );
      }
    }

    const updated = await get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    const updatedItems = await all('SELECT * FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
    res.json({ ...updated, items: updatedItems });
  } catch (err) {
    console.error('PUT /api/invoices/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/invoices/:id/status', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const { status, paid_date } = req.body;
    const vErrors = validate(req.body, {
      status: { required: true, type: 'string', oneOf: ['draft', 'sent', 'paid', 'overdue', 'cancelled'] },
      paid_date: { date: true }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    if (status === 'paid') {
      // Mark paid with date
      const payDate = paid_date || new Date().toISOString().split('T')[0];
      await run('UPDATE invoices SET status = ?, paid_date = ? WHERE id = ?', [
        status, payDate, req.params.id
      ]);
      // Auto-create income entry (only if one doesn't already exist for this invoice)
      const existingIncome = await get('SELECT id FROM income WHERE invoice_id = ?', [existing.id]);
      if (!existingIncome) {
        await run(
          `INSERT INTO income (date, amount, description, client_id, job_id, invoice_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            payDate,
            existing.total,
            `Invoice ${existing.invoice_number} payment`,
            existing.client_id,
            existing.job_id,
            existing.id
          ]
        );
      }
    } else {
      // Reverting from paid — clear paid_date and remove auto-created income
      await run('UPDATE invoices SET status = ?, paid_date = NULL WHERE id = ?', [
        status, req.params.id
      ]);
      if (existing.status === 'paid') {
        await run('DELETE FROM income WHERE invoice_id = ?', [existing.id]);
      }
    }

    const updated = await get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/invoices/:id/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    // Cascade delete items
    await run('DELETE FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
    await run('DELETE FROM invoices WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/invoices/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Invoice PDF
app.get('/api/invoices/:id/pdf', async (req, res) => {
  try {
    const invoice = await get(
      `SELECT inv.*, c.name as client_name, c.email as client_email,
              c.phone as client_phone, c.address as client_address
       FROM invoices inv
       LEFT JOIN clients c ON inv.client_id = c.id
       WHERE inv.id = ?`,
      [req.params.id]
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const items = await all('SELECT * FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
    const settingsRows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const client = {
      name: invoice.client_name,
      email: invoice.client_email,
      phone: invoice.client_phone,
      address: invoice.client_address
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.invoice_number}.pdf"`);
    const doc = pdf.generateInvoice(invoice, items, settings, client);
    doc.pipe(res);
  } catch (err) {
    console.error('GET /api/invoices/:id/pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create invoice from job
app.post('/api/invoices/from-job/:jobId', async (req, res) => {
  try {
    const job = await get(
      `SELECT j.*, c.name as client_name FROM jobs j
       LEFT JOIN clients c ON j.client_id = c.id
       WHERE j.id = ?`,
      [req.params.jobId]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.client_id) return res.status(400).json({ error: 'Job has no client assigned' });

    // Group expenses by category
    const expenseGroups = await all(
      `SELECT c.name as category_name, COUNT(*) as count, SUM(e.amount) as total
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.job_id = ?
       GROUP BY e.category_id`,
      [req.params.jobId]
    );

    if (!expenseGroups.length) {
      return res.status(400).json({ error: 'Job has no expenses to invoice' });
    }

    const invoice_number = await nextInvoiceNumber();
    const today = new Date().toISOString().split('T')[0];

    // Build line items from expense groups
    const items = expenseGroups.map(g => ({
      description: `${g.category_name || 'Uncategorized'}: ${g.count} items`,
      quantity: 1,
      unit_price: g.total,
      amount: g.total
    }));

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

    const result = await run(
      `INSERT INTO invoices (invoice_number, client_id, job_id, issue_date, subtotal, tax_rate, tax_amount, total, status)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'draft')`,
      [invoice_number, job.client_id, job.id, today, subtotal, subtotal]
    );

    const invoiceId = result.lastInsertRowid;

    for (const item of items) {
      await run(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, item.description, item.quantity, item.unit_price, item.amount]
      );
    }

    const invoice = await get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    const createdItems = await all('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    res.status(201).json({ ...invoice, items: createdItems });
  } catch (err) {
    console.error('POST /api/invoices/from-job/:jobId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// REPORTS
// ===========================================================================

// --- Profit & Loss ---
app.get('/api/reports/pnl', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const incomeRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ?
       GROUP BY i.category_id
       ORDER BY total DESC`,
      [from, to]
    );

    const expenseRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(e.amount) as total
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ?
       GROUP BY e.category_id
       ORDER BY total DESC`,
      [from, to]
    );

    const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0);
    const totalExpenses = expenseRows.reduce((s, r) => s + r.total, 0);

    res.json({
      income: incomeRows,
      expenses: expenseRows,
      totalIncome,
      totalExpenses,
      netProfit: totalIncome - totalExpenses,
      period: { from, to }
    });
  } catch (err) {
    console.error('GET /api/reports/pnl error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/pnl/csv', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const incomeRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ? GROUP BY i.category_id ORDER BY total DESC`,
      [from, to]
    );
    const expenseRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(e.amount) as total
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY e.category_id ORDER BY total DESC`,
      [from, to]
    );

    const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0);
    const totalExpenses = expenseRows.reduce((s, r) => s + r.total, 0);

    const headers = ['Type', 'Category', 'Amount'];
    const rows = [];
    for (const r of incomeRows) rows.push(['Income', r.category, r.total]);
    rows.push(['', 'Total Income', totalIncome]);
    rows.push(['', '', '']);
    for (const r of expenseRows) rows.push(['Expense', r.category, r.total]);
    rows.push(['', 'Total Expenses', totalExpenses]);
    rows.push(['', '', '']);
    rows.push(['', 'Net Profit', totalIncome - totalExpenses]);

    sendCSV(res, `pnl-${from}-to-${to}.csv`, headers, rows);
  } catch (err) {
    console.error('GET /api/reports/pnl/csv error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/pnl/pdf', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const incomeRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ? GROUP BY i.category_id ORDER BY total DESC`,
      [from, to]
    );
    const expenseRows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(e.amount) as total
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY e.category_id ORDER BY total DESC`,
      [from, to]
    );

    const totalIncome = incomeRows.reduce((s, r) => s + r.total, 0);
    const totalExpenses = expenseRows.reduce((s, r) => s + r.total, 0);

    const settingsRows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const data = {
      income: incomeRows.map(r => ({ category: r.category, amount: r.total })),
      expenses: expenseRows.map(r => ({ category: r.category, amount: r.total })),
      totalIncome,
      totalExpenses,
      netProfit: totalIncome - totalExpenses,
      period: { from, to }
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="pnl-${from}-to-${to}.pdf"`);
    const doc = pdf.generatePnL(data, settings);
    doc.pipe(res);
  } catch (err) {
    console.error('GET /api/reports/pnl/pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Expenses by Category ---
app.get('/api/reports/expenses-by-category', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const rows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category,
              c.schedule_c_line,
              SUM(e.amount) as total,
              COUNT(*) as count
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ?
       GROUP BY e.category_id
       ORDER BY total DESC`,
      [from, to]
    );

    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    const result = rows.map(r => ({
      category: r.category,
      schedule_c_line: r.schedule_c_line,
      total: r.total,
      count: r.count,
      percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 10000) / 100 : 0
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/reports/expenses-by-category error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/expenses-by-category/csv', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const rows = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, c.schedule_c_line,
              SUM(e.amount) as total, COUNT(*) as count
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY e.category_id ORDER BY total DESC`,
      [from, to]
    );

    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    const headers = ['Category', 'Schedule C Line', 'Total', 'Count', 'Percentage'];
    const csvRows = rows.map(r => [
      r.category,
      r.schedule_c_line || '',
      r.total,
      r.count,
      grandTotal > 0 ? (Math.round((r.total / grandTotal) * 10000) / 100) + '%' : '0%'
    ]);

    sendCSV(res, `expenses-by-category-${from}-to-${to}.csv`, headers, csvRows);
  } catch (err) {
    console.error('GET /api/reports/expenses-by-category/csv error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Job Profitability ---
app.get('/api/reports/job-profitability', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const rows = await all(
      `SELECT j.id, j.name as job, c.name as client,
              COALESCE((SELECT SUM(amount) FROM income WHERE job_id = j.id AND date >= ? AND date <= ?), 0) as income,
              COALESCE((SELECT SUM(amount) FROM expenses WHERE job_id = j.id AND date >= ? AND date <= ?), 0) as expenses
       FROM jobs j
       LEFT JOIN clients c ON j.client_id = c.id
       ORDER BY j.name`,
      [from, to, from, to]
    );

    const result = rows.map(r => ({
      job: r.job,
      client: r.client,
      income: r.income,
      expenses: r.expenses,
      profit: r.income - r.expenses,
      margin: r.income > 0 ? Math.round(((r.income - r.expenses) / r.income) * 10000) / 100 : 0
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/reports/job-profitability error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/job-profitability/csv', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);

    const rows = await all(
      `SELECT j.id, j.name as job, c.name as client,
              COALESCE((SELECT SUM(amount) FROM income WHERE job_id = j.id AND date >= ? AND date <= ?), 0) as income,
              COALESCE((SELECT SUM(amount) FROM expenses WHERE job_id = j.id AND date >= ? AND date <= ?), 0) as expenses
       FROM jobs j LEFT JOIN clients c ON j.client_id = c.id ORDER BY j.name`,
      [from, to, from, to]
    );

    const headers = ['Job', 'Client', 'Income', 'Expenses', 'Profit', 'Margin'];
    const csvRows = rows.map(r => [
      r.job,
      r.client || '',
      r.income,
      r.expenses,
      r.income - r.expenses,
      r.income > 0 ? (Math.round(((r.income - r.expenses) / r.income) * 10000) / 100) + '%' : '0%'
    ]);

    sendCSV(res, `job-profitability-${from}-to-${to}.csv`, headers, csvRows);
  } catch (err) {
    console.error('GET /api/reports/job-profitability/csv error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Tax Summary ---
app.get('/api/reports/tax-summary', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    // Income by category
    const incomeByCategory = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ? GROUP BY i.category_id ORDER BY total DESC`,
      [from, to]
    );
    const totalIncome = incomeByCategory.reduce((s, r) => s + r.total, 0);

    // Expenses by Schedule C line
    const expensesByLine = await all(
      `SELECT c.schedule_c_line as line, COALESCE(c.name, 'Uncategorized') as description,
              SUM(e.amount) as amount
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY c.schedule_c_line ORDER BY c.schedule_c_line`,
      [from, to]
    );
    const totalExpenses = expensesByLine.reduce((s, r) => s + r.amount, 0);

    // Build Schedule C lines list
    const scheduleCLines = expensesByLine.filter(r => r.line).map(r => ({
      line: r.line,
      description: r.description,
      amount: r.amount
    }));

    res.json({
      year: Number(year),
      income: { total: totalIncome, byCategory: incomeByCategory },
      expenses: { total: totalExpenses, byLine: expensesByLine },
      netProfit: totalIncome - totalExpenses,
      scheduleCLines
    });
  } catch (err) {
    console.error('GET /api/reports/tax-summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/tax-summary/pdf', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const incomeByCategory = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ? GROUP BY i.category_id ORDER BY total DESC`,
      [from, to]
    );
    const totalIncome = incomeByCategory.reduce((s, r) => s + r.total, 0);

    const expensesByLine = await all(
      `SELECT c.schedule_c_line as line, COALESCE(c.name, 'Uncategorized') as description,
              SUM(e.amount) as amount
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY c.schedule_c_line ORDER BY c.schedule_c_line`,
      [from, to]
    );
    const totalExpenses = expensesByLine.reduce((s, r) => s + r.amount, 0);

    const scheduleCLines = expensesByLine.filter(r => r.line).map(r => ({
      line: r.line, description: r.description, amount: r.amount
    }));

    const settingsRows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const data = {
      year: Number(year),
      totalIncome,
      totalExpenses,
      expenses: expensesByLine.map(r => ({ schedule_c_line: r.line, category: r.description, amount: r.amount })),
      netProfit: totalIncome - totalExpenses,
      scheduleCLines
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="tax-summary-${year}.pdf"`);
    const doc = pdf.generateTaxSummary(data, settings);
    doc.pipe(res);
  } catch (err) {
    console.error('GET /api/reports/tax-summary/pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/tax-summary/csv', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const incomeByCategory = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(i.amount) as total
       FROM income i LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.date >= ? AND i.date <= ? GROUP BY i.category_id ORDER BY total DESC`,
      [from, to]
    );
    const totalIncome = incomeByCategory.reduce((s, r) => s + r.total, 0);

    const expensesByLine = await all(
      `SELECT c.schedule_c_line as line, COALESCE(c.name, 'Uncategorized') as description,
              SUM(e.amount) as amount
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ? GROUP BY c.schedule_c_line ORDER BY c.schedule_c_line`,
      [from, to]
    );
    const totalExpenses = expensesByLine.reduce((s, r) => s + r.amount, 0);

    const headers = ['Section', 'Line/Category', 'Description', 'Amount'];
    const rows = [];
    rows.push(['INCOME', '', '', '']);
    for (const r of incomeByCategory) rows.push(['', '', r.category, r.total]);
    rows.push(['', '', 'Total Income', totalIncome]);
    rows.push(['', '', '', '']);
    rows.push(['EXPENSES', '', '', '']);
    for (const r of expensesByLine) rows.push(['', r.line || '', r.description, r.amount]);
    rows.push(['', '', 'Total Expenses', totalExpenses]);
    rows.push(['', '', '', '']);
    rows.push(['NET PROFIT', '', '', totalIncome - totalExpenses]);

    sendCSV(res, `tax-summary-${year}.csv`, headers, rows);
  } catch (err) {
    console.error('GET /api/reports/tax-summary/csv error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Transactions ---
app.get('/api/reports/transactions', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);
    const type = req.query.type || 'all';

    let rows = [];

    if (type === 'all' || type === 'expense') {
      const expenses = await all(
        `SELECT e.date, 'expense' as type, e.amount, COALESCE(e.vendor, '') as description,
                COALESCE(c.name, '') as category, COALESCE(j.name, '') as job,
                COALESCE(cl.name, '') as client, COALESCE(e.payment_method, '') as payment_method
         FROM expenses e
         LEFT JOIN categories c ON e.category_id = c.id
         LEFT JOIN jobs j ON e.job_id = j.id
         LEFT JOIN clients cl ON j.client_id = cl.id
         WHERE e.date >= ? AND e.date <= ?`,
        [from, to]
      );
      rows = rows.concat(expenses);
    }

    if (type === 'all' || type === 'income') {
      const income = await all(
        `SELECT i.date, 'income' as type, i.amount, COALESCE(i.description, '') as description,
                COALESCE(cat.name, '') as category, COALESCE(j.name, '') as job,
                COALESCE(c.name, '') as client, COALESCE(i.payment_method, '') as payment_method
         FROM income i
         LEFT JOIN clients c ON i.client_id = c.id
         LEFT JOIN jobs j ON i.job_id = j.id
         LEFT JOIN categories cat ON i.category_id = cat.id
         WHERE i.date >= ? AND i.date <= ?`,
        [from, to]
      );
      rows = rows.concat(income);
    }

    // Sort chronologically (most recent first)
    rows.sort((a, b) => b.date.localeCompare(a.date));

    res.json(rows);
  } catch (err) {
    console.error('GET /api/reports/transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/transactions/csv', async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);
    const type = req.query.type || 'all';

    let rows = [];

    if (type === 'all' || type === 'expense') {
      const expenses = await all(
        `SELECT e.date, 'expense' as type, e.amount, COALESCE(e.vendor, '') as description,
                COALESCE(c.name, '') as category, COALESCE(j.name, '') as job,
                COALESCE(cl.name, '') as client, COALESCE(e.payment_method, '') as payment_method
         FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
         LEFT JOIN jobs j ON e.job_id = j.id LEFT JOIN clients cl ON j.client_id = cl.id
         WHERE e.date >= ? AND e.date <= ?`,
        [from, to]
      );
      rows = rows.concat(expenses);
    }

    if (type === 'all' || type === 'income') {
      const income = await all(
        `SELECT i.date, 'income' as type, i.amount, COALESCE(i.description, '') as description,
                COALESCE(cat.name, '') as category, COALESCE(j.name, '') as job,
                COALESCE(c.name, '') as client, COALESCE(i.payment_method, '') as payment_method
         FROM income i LEFT JOIN clients c ON i.client_id = c.id
         LEFT JOIN jobs j ON i.job_id = j.id LEFT JOIN categories cat ON i.category_id = cat.id
         WHERE i.date >= ? AND i.date <= ?`,
        [from, to]
      );
      rows = rows.concat(income);
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));

    const headers = ['Date', 'Type', 'Amount', 'Description', 'Category', 'Job', 'Client', 'Payment Method'];
    const csvRows = rows.map(r => [r.date, r.type, r.amount, r.description, r.category, r.job, r.client, r.payment_method]);

    sendCSV(res, `transactions-${from}-to-${to}.csv`, headers, csvRows);
  } catch (err) {
    console.error('GET /api/reports/transactions/csv error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// DASHBOARD
// ===========================================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthStart = `${year}-${month}-01`;
    const monthEnd = `${year}-${month}-31`;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const monthIncome = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE date >= ? AND date <= ?',
      [monthStart, monthEnd]
    );
    const monthExpenses = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?',
      [monthStart, monthEnd]
    );
    const ytdIncome = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE date >= ? AND date <= ?',
      [yearStart, yearEnd]
    );
    const ytdExpenses = await get(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?',
      [yearStart, yearEnd]
    );
    const activeJobs = await get(
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'active'"
    );
    const outstanding = await get(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
       FROM invoices WHERE status IN ('draft', 'sent', 'overdue')`
    );
    const overdueInvoices = db.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total),0) as total
       FROM invoices WHERE status IN ('sent') AND due_date < date('now')`
    ).get();

    // Recent transactions: last 10 mixed income + expenses
    const recentExpenses = await all(
      `SELECT e.date, 'expense' as type, e.amount, COALESCE(e.vendor, 'Expense') as description,
              COALESCE(c.name, '') as category
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       ORDER BY e.date DESC LIMIT 10`
    );
    const recentIncome = await all(
      `SELECT i.date, 'income' as type, i.amount, COALESCE(i.description, 'Income') as description,
              COALESCE(cat.name, '') as category
       FROM income i LEFT JOIN categories cat ON i.category_id = cat.id
       ORDER BY i.date DESC LIMIT 10`
    );
    const recentTransactions = [...recentExpenses, ...recentIncome]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    // Expenses by category for current month
    const expensesByCategory = await all(
      `SELECT COALESCE(c.name, 'Uncategorized') as category, SUM(e.amount) as total
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.date >= ? AND e.date <= ?
       GROUP BY e.category_id ORDER BY total DESC`,
      [monthStart, monthEnd]
    );

    res.json({
      monthIncome: monthIncome.total,
      monthExpenses: monthExpenses.total,
      monthProfit: monthIncome.total - monthExpenses.total,
      ytdIncome: ytdIncome.total,
      ytdExpenses: ytdExpenses.total,
      ytdProfit: ytdIncome.total - ytdExpenses.total,
      activeJobs: activeJobs.count,
      outstandingInvoices: { count: outstanding.count, total: outstanding.total },
      overdueInvoices: { count: overdueInvoices.count, total: overdueInvoices.total },
      recentTransactions,
      expensesByCategory
    });
  } catch (err) {
    console.error('GET /api/dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/monthly-trends', (req, res) => {
  try {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const from = `${year}-${month}-01`;
      const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
      const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });

      const income = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM income WHERE date >= ? AND date <= ?`).get(from, to);
      const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date >= ? AND date <= ?`).get(from, to);

      months.push({
        label,
        income: income.total || 0,
        expenses: expenses.total || 0,
        profit: (income.total || 0) - (expenses.total || 0)
      });
    }
    res.json(months);
  } catch (err) {
    console.error('GET /api/dashboard/monthly-trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// ONBOARDING
// ===========================================================================
app.get('/api/onboarding/status', async (req, res) => {
  try {
    const row = await get("SELECT value FROM settings WHERE key = 'onboarding_complete'");
    res.json({ complete: row?.value === 'true' });
  } catch (err) {
    console.error('GET /api/onboarding/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/onboarding/complete', async (req, res) => {
  try {
    await run(
      "INSERT INTO settings (key, value) VALUES ('onboarding_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/onboarding/complete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// MILEAGE LOG
// ===========================================================================

// GET /api/mileage — list trips, optional ?from=&to=&job_id=
app.get('/api/mileage', async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const from = req.query.from || `${year}-01-01`;
    const to   = req.query.to   || `${year}-12-31`;

    let sql = `SELECT m.*, j.name as job_name
               FROM mileage_trips m
               LEFT JOIN jobs j ON m.job_id = j.id
               WHERE m.date >= ? AND m.date <= ?`;
    const params = [from, to];

    if (req.query.job_id) {
      sql += ' AND m.job_id = ?';
      params.push(req.query.job_id);
    }
    sql += ' ORDER BY m.date DESC';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/mileage error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mileage/summary — totals for ?year=YYYY
app.get('/api/mileage/summary', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    const trips = await all(
      'SELECT * FROM mileage_trips WHERE date >= ? AND date <= ? ORDER BY date DESC',
      [from, to]
    );

    const irsRow = await get("SELECT value FROM settings WHERE key = 'irs_mileage_rate'");
    const irsRate = parseFloat(irsRow?.value || '0.70');

    let totalMiles = 0;
    for (const t of trips) {
      totalMiles += t.round_trip ? t.miles * 2 : t.miles;
    }
    const deductionAmount = Math.round(totalMiles * irsRate * 100) / 100;

    res.json({
      year: Number(year),
      totalMiles: Math.round(totalMiles * 100) / 100,
      deductionAmount,
      irsRate,
      trips
    });
  } catch (err) {
    console.error('GET /api/mileage/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mileage — create trip
app.post('/api/mileage', async (req, res) => {
  try {
    const { date, destination, purpose, miles, job_id, round_trip } = req.body;
    const vErrors = validate(req.body, {
      date:        { required: true, date: true },
      destination: { required: true, type: 'string', maxLength: 500 },
      purpose:     { required: true, type: 'string', maxLength: 500 },
      miles:       { required: true, type: 'number', min: 0.1 }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const result = await run(
      `INSERT INTO mileage_trips (date, destination, purpose, miles, job_id, round_trip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [date, destination, purpose, miles, job_id || null, round_trip ? 1 : 0]
    );
    const trip = await get('SELECT * FROM mileage_trips WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(trip);
  } catch (err) {
    console.error('POST /api/mileage error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mileage/:id — update trip
app.put('/api/mileage/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM mileage_trips WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Trip not found' });

    const { date, destination, purpose, miles, job_id, round_trip } = req.body;
    await run(
      `UPDATE mileage_trips SET date = ?, destination = ?, purpose = ?, miles = ?,
       job_id = ?, round_trip = ? WHERE id = ?`,
      [
        date        !== undefined ? date        : existing.date,
        destination !== undefined ? destination : existing.destination,
        purpose     !== undefined ? purpose     : existing.purpose,
        miles       !== undefined ? miles       : existing.miles,
        job_id      !== undefined ? (job_id || null) : existing.job_id,
        round_trip  !== undefined ? (round_trip ? 1 : 0) : existing.round_trip,
        req.params.id
      ]
    );
    const updated = await get('SELECT * FROM mileage_trips WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/mileage/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mileage/:id — delete trip
app.delete('/api/mileage/:id', async (req, res) => {
  try {
    const existing = await get('SELECT * FROM mileage_trips WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Trip not found' });

    await run('DELETE FROM mileage_trips WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/mileage/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// QUARTERLY TAX ESTIMATOR
// ===========================================================================

app.get('/api/tax/quarterly-estimate', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    // YTD net profit
    const incomeRow  = await get('SELECT COALESCE(SUM(amount), 0) as total FROM income  WHERE date >= ? AND date <= ?', [from, to]);
    const expenseRow = await get('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date >= ? AND date <= ?', [from, to]);
    const netProfit  = incomeRow.total - expenseRow.total;

    // Mileage deduction
    const irsRow  = await get("SELECT value FROM settings WHERE key = 'irs_mileage_rate'");
    const irsRate = parseFloat(irsRow?.value || '0.70');
    const trips   = await all('SELECT miles, round_trip FROM mileage_trips WHERE date >= ? AND date <= ?', [from, to]);
    let totalMiles = 0;
    for (const t of trips) totalMiles += t.round_trip ? t.miles * 2 : t.miles;
    const mileageDeduction = Math.round(totalMiles * irsRate * 100) / 100;

    const adjustedProfit = netProfit - mileageDeduction;

    // Self-employment tax
    const selfEmploymentTax = Math.max(0, Math.round(adjustedProfit * 0.9235 * 0.153 * 100) / 100);
    const seDeduction       = Math.round((selfEmploymentTax / 2) * 100) / 100;
    const taxableIncome     = Math.max(0, adjustedProfit - seDeduction);

    // Estimated income tax (simple brackets, 2024/2025)
    function calcIncomeTax(income) {
      if (income <= 0) return 0;
      let tax = 0;
      if (income > 201000) { tax += (income - 201000) * 0.32; income = 201000; }
      if (income > 95000)  { tax += (income - 95000)  * 0.24; income = 95000;  }
      if (income > 44000)  { tax += (income - 44000)  * 0.22; income = 44000;  }
      if (income > 11000)  { tax += (income - 11000)  * 0.12; income = 11000;  }
      tax += income * 0.10;
      return Math.round(tax * 100) / 100;
    }

    const estimatedIncomeTax = calcIncomeTax(taxableIncome);
    const totalEstimatedTax  = Math.round((selfEmploymentTax + estimatedIncomeTax) * 100) / 100;
    const perQuarter         = Math.round((totalEstimatedTax / 4) * 100) / 100;

    const yr = Number(year);
    res.json({
      year: yr,
      netProfit:            Math.round(netProfit * 100) / 100,
      mileageDeduction,
      adjustedProfit:       Math.round(adjustedProfit * 100) / 100,
      selfEmploymentTax,
      estimatedIncomeTax,
      totalEstimatedTax,
      perQuarter,
      quarters: [
        { quarter: 1, dueDate: `${yr}-04-15`,     amount: perQuarter, label: 'Q1 (Jan-Mar)' },
        { quarter: 2, dueDate: `${yr}-06-16`,     amount: perQuarter, label: 'Q2 (Apr-May)' },
        { quarter: 3, dueDate: `${yr}-09-15`,     amount: perQuarter, label: 'Q3 (Jun-Aug)' },
        { quarter: 4, dueDate: `${yr + 1}-01-15`, amount: perQuarter, label: 'Q4 (Sep-Dec)' }
      ],
      irsRate,
      disclaimer: 'Estimates only. Consult a tax professional.'
    });
  } catch (err) {
    console.error('GET /api/tax/quarterly-estimate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// 1099 TRACKER
// ===========================================================================

// GET /api/compliance/1099?year=YYYY — vendors grouped with threshold flag
app.get('/api/compliance/1099', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    const vendors = await all(
      `SELECT COALESCE(vendor, 'Unknown') as vendor, SUM(amount) as totalPaid
       FROM expenses
       WHERE is_subcontractor = 1 AND date >= ? AND date <= ?
       GROUP BY vendor
       ORDER BY totalPaid DESC`,
      [from, to]
    );

    const details = await all('SELECT * FROM subcontractor_details');
    const detailMap = {};
    for (const d of details) detailMap[d.vendor_name] = d;

    const result = vendors.map(v => {
      const detail = detailMap[v.vendor] || null;
      let filed = false;
      if (detail && detail.filed_years) {
        try {
          const filedYears = JSON.parse(detail.filed_years);
          filed = filedYears.includes(Number(year));
        } catch (e) { /* ignore parse error */ }
      }
      return {
        vendor:     v.vendor,
        totalPaid:  Math.round(v.totalPaid * 100) / 100,
        needs1099:  v.totalPaid >= 600,
        threshold:  600,
        filed,
        details:    detail ? {
          ein:     detail.ein,
          address: detail.address,
          city:    detail.city,
          state:   detail.state,
          zip:     detail.zip
        } : null
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /api/compliance/1099 error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compliance/1099/details — create or update subcontractor details
app.post('/api/compliance/1099/details', async (req, res) => {
  try {
    const { vendor_name, ein, address, city, state, zip } = req.body;
    const vErrors = validate(req.body, {
      vendor_name: { required: true, type: 'string', maxLength: 200 },
      ein:         { type: 'string', maxLength: 20 },
      address:     { type: 'string', maxLength: 500 },
      city:        { type: 'string', maxLength: 100 },
      state:       { type: 'string', maxLength: 50 },
      zip:         { type: 'string', maxLength: 20 }
    });
    if (vErrors) return res.status(400).json({ error: vErrors.join('; ') });

    const existing = await get('SELECT * FROM subcontractor_details WHERE vendor_name = ?', [vendor_name]);
    if (existing) {
      await run(
        `UPDATE subcontractor_details SET ein = ?, address = ?, city = ?, state = ?, zip = ?
         WHERE vendor_name = ?`,
        [
          ein     !== undefined ? ein     : existing.ein,
          address !== undefined ? address : existing.address,
          city    !== undefined ? city    : existing.city,
          state   !== undefined ? state   : existing.state,
          zip     !== undefined ? zip     : existing.zip,
          vendor_name
        ]
      );
      const updated = await get('SELECT * FROM subcontractor_details WHERE vendor_name = ?', [vendor_name]);
      res.json(updated);
    } else {
      const result = await run(
        `INSERT INTO subcontractor_details (vendor_name, ein, address, city, state, zip)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [vendor_name, ein || null, address || null, city || null, state || null, zip || null]
      );
      const created = await get('SELECT * FROM subcontractor_details WHERE id = ?', [result.lastInsertRowid]);
      res.status(201).json(created);
    }
  } catch (err) {
    console.error('POST /api/compliance/1099/details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/1099/details — list all subcontractor details
app.get('/api/compliance/1099/details', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM subcontractor_details ORDER BY vendor_name');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/compliance/1099/details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/compliance/1099/:vendor/filed — mark year as filed
app.patch('/api/compliance/1099/:vendor/filed', async (req, res) => {
  try {
    const vendorName = decodeURIComponent(req.params.vendor);
    const { year } = req.body;
    if (!year) return res.status(400).json({ error: 'year is required' });

    const existing = await get('SELECT * FROM subcontractor_details WHERE vendor_name = ?', [vendorName]);
    if (!existing) return res.status(404).json({ error: 'Subcontractor not found' });

    let filedYears = [];
    try { filedYears = JSON.parse(existing.filed_years || '[]'); } catch (e) { /* ignore */ }

    if (!filedYears.includes(Number(year))) {
      filedYears.push(Number(year));
    }

    await run(
      'UPDATE subcontractor_details SET filed_years = ? WHERE vendor_name = ?',
      [JSON.stringify(filedYears), vendorName]
    );
    const updated = await get('SELECT * FROM subcontractor_details WHERE vendor_name = ?', [vendorName]);
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/compliance/1099/:vendor/filed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/1099/export?year=YYYY — CSV export
app.get('/api/compliance/1099/export', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;

    const vendors = await all(
      `SELECT COALESCE(vendor, 'Unknown') as vendor, SUM(amount) as totalPaid
       FROM expenses
       WHERE is_subcontractor = 1 AND date >= ? AND date <= ?
       GROUP BY vendor
       ORDER BY vendor`,
      [from, to]
    );

    const details = await all('SELECT * FROM subcontractor_details');
    const detailMap = {};
    for (const d of details) detailMap[d.vendor_name] = d;

    const headers = ['Vendor', 'EIN', 'Address', 'City', 'State', 'ZIP', 'Amount Paid'];
    const rows = vendors.map(v => {
      const d = detailMap[v.vendor] || {};
      return [
        v.vendor,
        d.ein     || '',
        d.address || '',
        d.city    || '',
        d.state   || '',
        d.zip     || '',
        Math.round(v.totalPaid * 100) / 100
      ];
    });

    sendCSV(res, `1099-${year}.csv`, headers, rows);
  } catch (err) {
    console.error('GET /api/compliance/1099/export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// EMAIL INVOICES
// ===========================================================================

app.post('/api/invoices/:id/email', async (req, res) => {
  try {
    // Load invoice with client email
    const invoice = await get(
      `SELECT inv.*, c.name as client_name, c.email as client_email,
              c.phone as client_phone, c.address as client_address
       FROM invoices inv
       LEFT JOIN clients c ON inv.client_id = c.id
       WHERE inv.id = ?`,
      [req.params.id]
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.client_email) {
      return res.status(400).json({ error: 'Client has no email address on file' });
    }

    // Load SMTP settings
    const settingsRows = await all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    if (settings.smtp_enabled !== '1') {
      return res.status(400).json({ error: 'Email not configured. Set up SMTP in Settings.' });
    }

    // Generate PDF as buffer
    const items = await all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [req.params.id]);
    const client = {
      name:    invoice.client_name,
      email:   invoice.client_email,
      phone:   invoice.client_phone,
      address: invoice.client_address
    };

    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = pdf.generateInvoice(invoice, items, settings, client);
      const chunks = [];
      doc.on('data',  chunk => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });

    // Build transporter
    const transporter = nodemailer.createTransport({
      host:   settings.smtp_host,
      port:   parseInt(settings.smtp_port) || 587,
      secure: parseInt(settings.smtp_port) === 465,
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass
      }
    });

    const businessName = settings.business_name || 'Your Business';
    const fromAddress  = settings.smtp_from || settings.smtp_user;

    await transporter.sendMail({
      from:    `"${businessName}" <${fromAddress}>`,
      to:      invoice.client_email,
      subject: `Invoice ${invoice.invoice_number} from ${businessName}`,
      text:    `Please find attached invoice ${invoice.invoice_number} for $${invoice.total?.toFixed(2) || '0.00'}.\n\nThank you for your business.\n\n${businessName}`,
      attachments: [
        {
          filename:    `invoice-${invoice.invoice_number}.pdf`,
          content:     pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    res.json({ success: true, sentTo: invoice.client_email });
  } catch (err) {
    console.error('POST /api/invoices/:id/email error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// START SERVER
// ===========================================================================
const HOST = process.env.TRADEBOOKS_HOST || '127.0.0.1';

// HTTPS support
const CERT_DIR = path.join(__dirname, 'certs');
const certPath = path.join(CERT_DIR, 'cert.pem');
const keyPath = path.join(CERT_DIR, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  https.createServer(httpsOptions, app).listen(PORT + 1, HOST, () => {
    console.log(`TradeBooks HTTPS running at https://${HOST}:${PORT + 1}`);
  });
  app.set('trust proxy', 1);
}

app.listen(PORT, HOST, () => {
  console.log(`TradeBooks running at http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') {
    console.log('  (localhost only — set TRADEBOOKS_HOST=0.0.0.0 for network access)');
  }
});
