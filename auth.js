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
// Auth Middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  // Skip auth endpoints
  if (req.path.startsWith('/api/auth')) return next();

  // Skip login/setup pages
  if (req.path === '/login.html' || req.path === '/setup.html') return next();

  // Skip static assets
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|webmanifest|json)$/)) return next();
  if (req.path === '/sw.js' || req.path === '/manifest.json') return next();

  // Check if authenticated
  if (!req.session || !req.session.authenticated) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }

  next();
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
  requireAuth
};
