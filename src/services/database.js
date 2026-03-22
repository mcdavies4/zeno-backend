/**
 * PostgreSQL Database Service
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool = null;

async function init() {
  if (!process.env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set — running without PostgreSQL');
    return;
  }
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected successfully');
    await createTables();
  } catch (err) {
    logger.error('PostgreSQL connection failed:', err.message);
    pool = null;
  }
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100),
      email VARCHAR(100),
      pin_hash VARCHAR(200),
      is_onboarded BOOLEAN DEFAULT FALSE,
      kyc_status VARCHAR(20) DEFAULT 'pending',
      kyc_verified BOOLEAN DEFAULT FALSE,
      kyc_session_id VARCHAR(100),
      bank_connected BOOLEAN DEFAULT FALSE,
      truelayer_access_token TEXT,
      truelayer_refresh_token TEXT,
      truelayer_expires_at BIGINT,
      balance DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) NOT NULL,
      type VARCHAR(10) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'GBP',
      recipient_name VARCHAR(100),
      recipient_account VARCHAR(20),
      recipient_sort_code VARCHAR(10),
      reference VARCHAR(100),
      status VARCHAR(20) DEFAULT 'completed',
      transaction_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
    CREATE INDEX IF NOT EXISTS idx_tx_phone ON transactions(phone_number);
  `);
  // Add new support columns (safe to run multiple times)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(30);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_attempts_total INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_connected_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_balance_check TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_attempt_count INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banking_country VARCHAR(5) DEFAULT 'UK';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS alerts JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS beneficiaries JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_pin_attempts INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS receipts JSONB DEFAULT '[]';
  `);
  logger.info('PostgreSQL tables ready');
}

async function getUser(phoneNumber) {
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phoneNumber]);
    return result.rows[0] || null;
  } catch (err) {
    logger.error('getUser error:', err.message);
    return null;
  }
}

async function upsertUser(phoneNumber, data = {}) {
  if (!pool) return null;
  try {
    const fields = Object.keys(data);
    if (fields.length === 0) {
      await pool.query(
        'INSERT INTO users (phone_number) VALUES ($1) ON CONFLICT (phone_number) DO NOTHING',
        [phoneNumber]
      );
      return getUser(phoneNumber);
    }
    const setClauses = fields.map((f, i) => `${toSnake(f)} = $${i + 2}`).join(', ');
    const values = fields.map(f => data[f]);
    await pool.query(
      `INSERT INTO users (phone_number, ${fields.map(toSnake).join(', ')})
       VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (phone_number) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
      [phoneNumber, ...values]
    );
    return getUser(phoneNumber);
  } catch (err) {
    logger.error('upsertUser error:', err.message);
    return null;
  }
}

async function saveTransaction(phoneNumber, txData) {
  if (!pool) return null;
  try {
    const result = await pool.query(
      `INSERT INTO transactions
        (phone_number, type, amount, currency, recipient_name,
         recipient_account, recipient_sort_code, reference, status, transaction_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
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
      ]
    );
    return result.rows[0].id;
  } catch (err) {
    logger.error('saveTransaction error:', err.message);
    return null;
  }
}

async function getTransactions(phoneNumber, limit = 10) {
  if (!pool) return [];
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE phone_number = $1 ORDER BY created_at DESC LIMIT $2',
      [phoneNumber, limit]
    );
    return result.rows;
  } catch (err) {
    logger.error('getTransactions error:', err.message);
    return [];
  }
}

function toSnake(str) {
  return str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
}

function isReady() { return !!pool; }

module.exports = { init, getUser, upsertUser, saveTransaction, getTransactions, isReady };
