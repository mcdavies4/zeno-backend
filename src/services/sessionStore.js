/**
 * Session Store — Upstash Redis backed with in-memory fallback
 * Works perfectly on both Railway and serverless environments
 */

const logger = require('../utils/logger');

const SESSION_TTL = 1800; // 30 minutes
const memoryStore = new Map();

// Try to connect to Upstash Redis
let redis = null;

async function connectUpstash() {
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    // Test connection
    await redis.set('zeno:ping', 'pong');
    logger.info('Upstash Redis connected successfully');
    return true;
  } catch (err) {
    logger.warn('Upstash Redis not available, using in-memory:', err.message);
    redis = null;
    return false;
  }
}

// Connect on startup
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
  };
}

async function get(phoneNumber) {
  try {
    if (redis) {
      const data = await redis.get(`session:${phoneNumber}`);
      if (data) {
        const session = typeof data === 'string' ? JSON.parse(data) : data;
        session.lastActivityAt = Date.now();
        return session;
      }
      const session = defaultSession(phoneNumber);
      await redis.setex(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    logger.error('Upstash get error:', err.message);
  }

  // Fallback to memory
  let session = memoryStore.get(phoneNumber);
  if (!session) {
    session = defaultSession(phoneNumber);
    memoryStore.set(phoneNumber, session);
  }
  session.lastActivityAt = Date.now();
  return session;
}

async function update(phoneNumber, updates) {
  const session = await get(phoneNumber);
  Object.assign(session, updates, { lastActivityAt: Date.now() });

  try {
    if (redis) {
      await redis.setex(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    logger.error('Upstash update error:', err.message);
  }

  memoryStore.set(phoneNumber, session);
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
    logger.error('Upstash delete error:', err.message);
  }
  memoryStore.delete(phoneNumber);
}

module.exports = { get, update, clearPendingTransfer, destroy };
