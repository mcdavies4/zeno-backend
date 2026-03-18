/**
 * Session Store
 *
 * Manages per-user conversation state including:
 * - Conversation history (for Claude context)
 * - Pending transfers awaiting confirmation
 * - PIN attempt counters
 * - Cached balance and transactions
 *
 * Uses in-memory storage by default.
 * Set REDIS_URL in .env to upgrade to Redis for multi-instance deployments.
 */

const logger = require('../utils/logger');

// ─── IN-MEMORY STORE (for single-instance / development) ──
const memoryStore = new Map();

// Session TTL: 30 minutes of inactivity clears session
const SESSION_TTL_MS = 30 * 60 * 1000;

// ─── DEFAULT SESSION SHAPE ────────────────────────────
function defaultSession(phoneNumber) {
  return {
    phoneNumber,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    conversationHistory: [],
    pendingTransfer: null,
    awaitingPin: false,
    pinAttempts: 0,
    userPin: null,       // set during onboarding — hash this in production!
    balance: null,       // fetched from banking API and cached
    recentTransactions: [],
    isOnboarded: false,  // set to true once user has registered
    accountId: null,     // Modulr/banking account ID
  };
}

// ─── GET OR CREATE SESSION ────────────────────────────
async function get(phoneNumber) {
  let session = memoryStore.get(phoneNumber);

  if (!session) {
    session = defaultSession(phoneNumber);
    memoryStore.set(phoneNumber, session);
    logger.info(`New session created for ${phoneNumber}`);
  }

  // Expire old sessions
  if (Date.now() - session.lastActivityAt > SESSION_TTL_MS) {
    session = defaultSession(phoneNumber);
    memoryStore.set(phoneNumber, session);
    logger.info(`Session expired and reset for ${phoneNumber}`);
  }

  session.lastActivityAt = Date.now();
  return session;
}

// ─── UPDATE SESSION ───────────────────────────────────
async function update(phoneNumber, updates) {
  const session = await get(phoneNumber);
  Object.assign(session, updates, { lastActivityAt: Date.now() });
  memoryStore.set(phoneNumber, session);
  return session;
}

// ─── CLEAR PENDING TRANSFER ───────────────────────────
async function clearPendingTransfer(phoneNumber) {
  return update(phoneNumber, {
    pendingTransfer: null,
    awaitingPin: false,
    pinAttempts: 0,
  });
}

// ─── DELETE SESSION ───────────────────────────────────
async function destroy(phoneNumber) {
  memoryStore.delete(phoneNumber);
}

// ─── STATS (for monitoring) ───────────────────────────
function stats() {
  return {
    activeSessions: memoryStore.size,
    sessions: Array.from(memoryStore.keys()).map(phone => ({
      phone: phone.slice(0, 6) + '****',
      lastActivity: new Date(memoryStore.get(phone).lastActivityAt).toISOString(),
    })),
  };
}

// ─── REDIS UPGRADE PATH ───────────────────────────────
// To enable Redis, install ioredis and replace the above with:
//
// const Redis = require('ioredis');
// const redis = new Redis(process.env.REDIS_URL);
//
// async function get(phoneNumber) {
//   const raw = await redis.get(`session:${phoneNumber}`);
//   if (!raw) return defaultSession(phoneNumber);
//   return JSON.parse(raw);
// }
//
// async function update(phoneNumber, updates) {
//   const session = await get(phoneNumber);
//   const updated = { ...session, ...updates, lastActivityAt: Date.now() };
//   await redis.set(`session:${phoneNumber}`, JSON.stringify(updated), 'EX', 1800);
//   return updated;
// }

module.exports = { get, update, clearPendingTransfer, destroy, stats };
