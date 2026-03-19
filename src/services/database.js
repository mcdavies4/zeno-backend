/**
 * Database Service
 * 
 * Uses SQLite for simple, persistent storage.
 * No separate database server needed — just a file.
 * Easy to migrate to PostgreSQL later for scale.
 */

const path = require('path');
const logger = require('../utils/logger');

let db;

// ─── INITIALISE DATABASE ──────────────────────────────
async function init() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/zeno.db');
    
    // Ensure data directory exists
    const fs = require('fs');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Better performance
    db.pragma('foreign_keys = ON');

    createTables();
    logger.info(`Database initialised at ${dbPath}`);
  } catch (err) {
    logger.error('Database init failed:', err.message);
    logger.warn('Running without persistent database — data will be lost on restart');
  }
}

// ─── CREATE TABLES ────────────────────────────────────
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      pin_hash TEXT,
      is_onboarded INTEGER DEFAULT 0,
      bank_connected INTEGER DEFAULT 0,
      truelayer_access_token TEXT,
      truelayer_refresh_token TEXT,
      truelayer_expires_at INTEGER,
      balance REAL DEFAULT 0,
      account_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'GBP',
      recipient_name TEXT,
      recipient_account TEXT,
      recipient_sort_code TEXT,
      reference TEXT,
      status TEXT DEFAULT 'pending',
      transaction_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (phone_number) REFERENCES users(phone_number)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      phone_number TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (phone_number) REFERENCES users(phone_number)
    );
  `);
}

// ─── USER OPERATIONS ──────────────────────────────────
function getUser(phoneNumber) {
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phoneNumber);
  } catch (err) {
    logger.error('getUser error:', err.message);
    return null;
  }
}

function createUser(phoneNumber) {
  if (!db) return null;
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO users (phone_number) VALUES (?)
    `);
    stmt.run(phoneNumber);
    return getUser(phoneNumber);
  } catch (err) {
    logger.error('createUser error:', err.message);
    return null;
  }
}

function updateUser(phoneNumber, updates) {
  if (!db) return null;
  try {
    const fields = Object.keys(updates)
      .map(k => `${toSnakeCase(k)} = ?`)
      .join(', ');
    const values = Object.values(updates);
    
    db.prepare(`
      UPDATE users SET ${fields}, updated_at = strftime('%s', 'now')
      WHERE phone_number = ?
    `).run(...values, phoneNumber);
    
    return getUser(phoneNumber);
  } catch (err) {
    logger.error('updateUser error:', err.message);
    return null;
  }
}

// ─── TRANSACTION OPERATIONS ───────────────────────────
function saveTransaction(phoneNumber, txData) {
  if (!db) return null;
  try {
    const stmt = db.prepare(`
      INSERT INTO transactions (
        phone_number, type, amount, currency,
        recipient_name, recipient_account, recipient_sort_code,
        reference, status, transaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      phoneNumber,
      txData.type || 'debit',
      txData.amount,
      txData.currency || 'GBP',
      txData.recipientName || null,
      txData.accountNumber || null,
      txData.sortCode || null,
      txData.reference || null,
      txData.status || 'completed',
      txData.transactionId || null,
    );
    return result.lastInsertRowid;
  } catch (err) {
    logger.error('saveTransaction error:', err.message);
    return null;
  }
}

function getTransactions(phoneNumber, limit = 10) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM transactions 
      WHERE phone_number = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(phoneNumber, limit);
  } catch (err) {
    logger.error('getTransactions error:', err.message);
    return [];
  }
}

// ─── HELPER ───────────────────────────────────────────
function toSnakeCase(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function isReady() {
  return !!db;
}

module.exports = {
  init,
  getUser,
  createUser,
  updateUser,
  saveTransaction,
  getTransactions,
  isReady,
};
