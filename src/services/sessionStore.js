/**
 * Session Store — Database backed with in-memory cache
 * 
 * Persists user sessions to SQLite so data survives restarts.
 * Falls back to in-memory if database isn't available.
 */

const logger = require('../utils/logger');

const memoryStore = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function defaultSession(phoneNumber) {
  return {
    phoneNumber,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    conversationHistory: [],
    pendingTransfer: null,
    awaitingPin: false,
    awaitingField: null,
    pinAttempts: 0,
    userPin: null,
    userName: null,
    userEmail: null,
    balance: null,
    recentTransactions: [],
    isOnboarded: false,
    bankConnected: false,
    truelayerAccessToken: null,
    truelayerRefreshToken: null,
    truelayerExpiresAt: null,
    onboardingStep: null,
    onboardingData: null,
  };
}

async function get(phoneNumber) {
  let db;
  try { db = require('./database'); } catch(e) {}

  // Try loading from database first
  if (db?.isReady()) {
    let user = db.getUser(phoneNumber);
    if (!user) user = db.createUser(phoneNumber);

    // Merge DB user data with in-memory session
    const memSession = memoryStore.get(phoneNumber) || defaultSession(phoneNumber);
    
    if (user) {
      memSession.isOnboarded = !!user.is_onboarded;
      memSession.userName = user.name || memSession.userName;
      memSession.userEmail = user.email || memSession.userEmail;
      memSession.userPin = user.pin_hash || memSession.userPin;
      memSession.bankConnected = !!user.bank_connected;
      memSession.truelayerAccessToken = user.truelayer_access_token || memSession.truelayerAccessToken;
      memSession.truelayerRefreshToken = user.truelayer_refresh_token || memSession.truelayerRefreshToken;
      memSession.truelayerExpiresAt = user.truelayer_expires_at || memSession.truelayerExpiresAt;
      memSession.balance = user.balance || memSession.balance;
    }

    // Check TTL
    if (Date.now() - memSession.lastActivityAt > SESSION_TTL_MS) {
      const fresh = defaultSession(phoneNumber);
      // Keep persistent data from DB
      fresh.isOnboarded = memSession.isOnboarded;
      fresh.userName = memSession.userName;
      fresh.userPin = memSession.userPin;
      fresh.bankConnected = memSession.bankConnected;
      fresh.truelayerAccessToken = memSession.truelayerAccessToken;
      fresh.truelayerRefreshToken = memSession.truelayerRefreshToken;
      fresh.truelayerExpiresAt = memSession.truelayerExpiresAt;
      memoryStore.set(phoneNumber, fresh);
      return fresh;
    }

    memSession.lastActivityAt = Date.now();
    memoryStore.set(phoneNumber, memSession);
    return memSession;
  }

  // Fallback: pure in-memory
  let session = memoryStore.get(phoneNumber);
  if (!session) {
    session = defaultSession(phoneNumber);
    memoryStore.set(phoneNumber, session);
  }
  if (Date.now() - session.lastActivityAt > SESSION_TTL_MS) {
    session = defaultSession(phoneNumber);
    memoryStore.set(phoneNumber, session);
  }
  session.lastActivityAt = Date.now();
  return session;
}

async function update(phoneNumber, updates) {
  const session = await get(phoneNumber);
  Object.assign(session, updates, { lastActivityAt: Date.now() });
  memoryStore.set(phoneNumber, session);

  // Persist important fields to database
  let db;
  try { db = require('./database'); } catch(e) {}
  
  if (db?.isReady()) {
    const dbUpdates = {};
    if ('userName' in updates) dbUpdates.name = updates.userName;
    if ('userEmail' in updates) dbUpdates.email = updates.userEmail;
    if ('userPin' in updates) dbUpdates.pinHash = updates.userPin;
    if ('isOnboarded' in updates) dbUpdates.isOnboarded = updates.isOnboarded ? 1 : 0;
    if ('bankConnected' in updates) dbUpdates.bankConnected = updates.bankConnected ? 1 : 0;
    if ('truelayerAccessToken' in updates) dbUpdates.truelayerAccessToken = updates.truelayerAccessToken;
    if ('truelayerRefreshToken' in updates) dbUpdates.truelayerRefreshToken = updates.truelayerRefreshToken;
    if ('truelayerExpiresAt' in updates) dbUpdates.truelayerExpiresAt = updates.truelayerExpiresAt;
    if ('balance' in updates) dbUpdates.balance = updates.balance;

    if (Object.keys(dbUpdates).length > 0) {
      db.updateUser(phoneNumber, dbUpdates);
    }
  }

  return session;
}

async function clearPendingTransfer(phoneNumber) {
  return update(phoneNumber, {
    pendingTransfer: null,
    awaitingPin: false,
    pinAttempts: 0,
  });
}

async function destroy(phoneNumber) {
  memoryStore.delete(phoneNumber);
}

module.exports = { get, update, clearPendingTransfer, destroy };
