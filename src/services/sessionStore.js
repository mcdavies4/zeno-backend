/**
 * Session Store — Upstash Redis + PostgreSQL
 * 
 * Flow:
 * 1. Check Redis (fast cache)
 * 2. If not in Redis, load from PostgreSQL (persistent)
 * 3. All updates go to both Redis and PostgreSQL
 */

const logger = require('../utils/logger');

const SESSION_TTL = 1800; // 30 minutes
const memoryStore = new Map();
let redis = null;

async function connectUpstash() {
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.set('zeno:ping', 'pong');
    logger.info('Upstash Redis connected successfully');
  } catch (err) {
    logger.warn('Upstash Redis not available:', err.message);
    redis = null;
  }
}

connectUpstash();

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
    kycStatus: null,
    kycVerified: false,
    kycSessionId: null,
    alerts: {},
    beneficiaries: {},
    termsAccepted: false,
    termsAcceptedAt: null,
    pinLockedUntil: null,
    failedPinAttempts: 0,
    receipts: [],
    lastTransfer: null,
  };
}

// Load user data from PostgreSQL into session
async function loadFromDatabase(phoneNumber, session) {
  try {
    const db = require('./database');
    if (!db.isReady()) return session;

    const user = await db.getUser(phoneNumber);
    if (!user) return session;

    // Restore persistent data from DB
    if (user.name) session.userName = user.name;
    if (user.email) session.userEmail = user.email;
    if (user.pin_hash) session.userPin = user.pin_hash;
    if (user.is_onboarded) session.isOnboarded = user.is_onboarded;
    if (user.kyc_status) session.kycStatus = user.kyc_status;
    if (user.kyc_verified) session.kycVerified = user.kyc_verified;
    if (user.kyc_session_id) session.kycSessionId = user.kyc_session_id;
    if (user.bank_connected) session.bankConnected = user.bank_connected;
    if (user.truelayer_access_token) session.truelayerAccessToken = user.truelayer_access_token;
    if (user.truelayer_refresh_token) session.truelayerRefreshToken = user.truelayer_refresh_token;
    if (user.truelayer_expires_at) session.truelayerExpiresAt = user.truelayer_expires_at;
    if (user.balance) session.balance = parseFloat(user.balance);
    if (user.banking_country) session.bankingCountry = user.banking_country;
    if (user.alerts) session.alerts = typeof user.alerts === 'string' ? JSON.parse(user.alerts) : user.alerts;
    if (user.beneficiaries) session.beneficiaries = typeof user.beneficiaries === 'string' ? JSON.parse(user.beneficiaries) : user.beneficiaries;
    if (user.terms_accepted) session.termsAccepted = user.terms_accepted;
    if (user.terms_accepted_at) session.termsAcceptedAt = user.terms_accepted_at;
    if (user.pin_locked_until) session.pinLockedUntil = user.pin_locked_until;
    if (user.failed_pin_attempts) session.failedPinAttempts = user.failed_pin_attempts;
    if (user.receipts) session.receipts = typeof user.receipts === 'string' ? JSON.parse(user.receipts) : user.receipts;

    logger.info(`Session restored from DB for ${phoneNumber}: onboarded=${session.isOnboarded}`);
  } catch (err) {
    logger.error('Error loading from database:', err.message);
  }
  return session;
}

async function get(phoneNumber) {
  // 1. Try Redis first
  try {
    if (redis) {
      const data = await redis.get(`session:${phoneNumber}`);
      if (data) {
        const session = typeof data === 'string' ? JSON.parse(data) : data;
        session.lastActivityAt = Date.now();
        return session;
      }
    }
  } catch (err) {
    logger.error('Redis get error:', err.message);
  }

  // 2. Not in Redis — create new session and load from PostgreSQL
  let session = memoryStore.get(phoneNumber) || defaultSession(phoneNumber);
  session = await loadFromDatabase(phoneNumber, session);
  session.lastActivityAt = Date.now();

  // Save back to Redis
  try {
    if (redis) {
      await redis.setex(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
    }
  } catch (err) {
    logger.error('Redis set error:', err.message);
  }

  memoryStore.set(phoneNumber, session);
  return session;
}

async function update(phoneNumber, updates) {
  const session = await get(phoneNumber);
  Object.assign(session, updates, { lastActivityAt: Date.now() });

  // Save to Redis
  try {
    if (redis) {
      await redis.setex(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
    } else {
      memoryStore.set(phoneNumber, session);
    }
  } catch (err) {
    logger.error('Redis update error:', err.message);
    memoryStore.set(phoneNumber, session);
  }

  // Sync to PostgreSQL
  try {
    const db = require('./database');
    if (db.isReady()) {
      const dbData = {};
      if ('userName' in updates) dbData.name = updates.userName;
      if ('userEmail' in updates) dbData.email = updates.userEmail;
      if ('userPin' in updates) dbData.pinHash = updates.userPin;
      if ('isOnboarded' in updates) dbData.isOnboarded = updates.isOnboarded;
      if ('kycStatus' in updates) dbData.kycStatus = updates.kycStatus;
      if ('kycVerified' in updates) dbData.kycVerified = updates.kycVerified;
      if ('kycSessionId' in updates) dbData.kycSessionId = updates.kycSessionId;
      if ('bankConnected' in updates) dbData.bankConnected = updates.bankConnected;
      if ('truelayerAccessToken' in updates) dbData.truelayerAccessToken = updates.truelayerAccessToken;
      if ('truelayerRefreshToken' in updates) dbData.truelayerRefreshToken = updates.truelayerRefreshToken;
      if ('truelayerExpiresAt' in updates) dbData.truelayerExpiresAt = updates.truelayerExpiresAt;
      if ('balance' in updates) dbData.balance = updates.balance;
      if ('bankingCountry' in updates) dbData.bankingCountry = updates.bankingCountry;
      if ('alerts' in updates) dbData.alerts = JSON.stringify(updates.alerts);
      if ('beneficiaries' in updates) dbData.beneficiaries = JSON.stringify(updates.beneficiaries);
      if ('termsAccepted' in updates) dbData.termsAccepted = updates.termsAccepted;
      if ('termsAcceptedAt' in updates) dbData.termsAcceptedAt = updates.termsAcceptedAt;
      if ('pinLockedUntil' in updates) dbData.pinLockedUntil = updates.pinLockedUntil;
      if ('failedPinAttempts' in updates) dbData.failedPinAttempts = updates.failedPinAttempts;
      if ('receipts' in updates) dbData.receipts = JSON.stringify(updates.receipts);
      if (Object.keys(dbData).length > 0) {
        await db.upsertUser(phoneNumber, dbData);
      }
    }
  } catch (err) {
    logger.error('DB sync error:', err.message);
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
  try {
    if (redis) await redis.del(`session:${phoneNumber}`);
  } catch (err) {
    logger.error('Redis delete error:', err.message);
  }
  memoryStore.delete(phoneNumber);
}

module.exports = { get, update, clearPendingTransfer, destroy };
