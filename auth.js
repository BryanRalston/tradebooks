/**
 * TradeBooks — Authentication Module
 * SQLite session store, password management, auth middleware.
 */

const session = require('express-session');
const bcrypt = require('bcryptjs');

// ---------------------------------------------------------------------------
// SQLite Session Store for express-session
// ---------------------------------------------------------------------------
class SQLiteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;

    // Clean expired sessions every 15 minutes
    this._cleanInterval = setInterval(() => this._cleanup(), 15 * 60 * 1000);
    this._cleanup();
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
      if (!row) return cb(null, null);
      try {
        const sess = JSON.parse(row.sess);
        return cb(null, sess);
      } catch (e) {
        return cb(null, null);
      }
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 7 * 24 * 60 * 60 * 1000;
      const expired = Date.now() + maxAge;
      const sessStr = JSON.stringify(sess);
      this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, sessStr, expired);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  _cleanup() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (e) {
      // Silent — cleanup is best-effort
    }
  }

  close() {
    if (this._cleanInterval) {
      clearInterval(this._cleanInterval);
      this._cleanInterval = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Password Management
// ---------------------------------------------------------------------------
const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function isPasswordSet(db) {
  try {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
    if (row.cnt > 0) return true;
  } catch(e) {}
  const row = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
  return !!(row && row.value);
}

async function setPassword(db, password) {
  const hash = await hashPassword(password);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hash', ?)").run(hash);
}

async function checkPassword(db, password) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
  if (!row || !row.value) return false;
  return verifyPassword(password, row.value);
}

// ---------------------------------------------------------------------------
// User-Based Auth Functions
// ---------------------------------------------------------------------------
async function createUser(db, { name, email, password, role }) {
  const hash = await hashPassword(password);
  return db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
  ).run(name, email.toLowerCase().trim(), hash, role || 'employee');
}

async function authenticateUser(db, email, password) {
  const user = db.prepare(
    "SELECT * FROM users WHERE email = ? AND active = 1"
  ).get(email.toLowerCase().trim());
  if (!user) return null;
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function getUserById(db, id) {
  return db.prepare(
    "SELECT id, name, email, role, active, created_at FROM users WHERE id = ?"
  ).get(id);
}

function hasUsers(db) {
  try {
    return db.prepare("SELECT COUNT(*) as cnt FROM users").get().cnt > 0;
  } catch(e) { return false; }
}

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  // Skip auth endpoints
  if (req.path.startsWith('/api/auth')) return next();

  // Skip login/setup pages
  if (req.path === '/login.html' || req.path === '/setup.html') return next();

  // Skip public invoice view
  if (req.path.startsWith('/invoice/view/')) return next();

  // Skip static assets
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|webmanifest|json)$/)) return next();
  if (req.path === '/sw.js' || req.path === '/manifest.json') return next();

  // Check if authenticated (supports both old and new session types)
  const isAuthenticated = !!(req.session?.userId || req.session?.authenticated);
  if (!isAuthenticated) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }

  next();
}

// ---------------------------------------------------------------------------
// Role Helper
// ---------------------------------------------------------------------------
function getSessionRole(req) {
  // New user-based sessions have explicit role
  if (req.session?.role) return req.session.role;
  // Legacy sessions (before multi-user) treated as owner
  if (req.session?.authenticated) return 'owner';
  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  SQLiteStore,
  hashPassword,
  verifyPassword,
  isPasswordSet,
  setPassword,
  checkPassword,
  createUser,
  authenticateUser,
  getUserById,
  hasUsers,
  requireAuth,
  getSessionRole
};
