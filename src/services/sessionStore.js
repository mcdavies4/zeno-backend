/**
 * Session Store — Redis backed with in-memory fallback
 */

const logger = require('../utils/logger');

const SESSION_TTL = 1800; // 30 minutes in seconds
const memoryStore = new Map();

// Try to connect to Redis
let redisClient = null;

async function connectRedis() {
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => logger.error('Redis error:', err.message));
    redisClient.on('connect', () => logger.info('Redis connected successfully'));
    await redisClient.connect();
    return true;
  } catch (err) {
    logger.warn('Redis not available, using in-memory sessions:', err.message);
    redisClient = null;
    return false;
  }
}

// Connect on startup
connectRedis();

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
  try {
    if (redisClient?.isReady) {
      const data = await redisClient.get(`session:${phoneNumber}`);
      if (data) {
        const session = JSON.parse(data);
        session.lastActivityAt = Date.now();
        return session;
      }
      // New session
      const session = defaultSession(phoneNumber);
      await redisClient.setEx(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    logger.error('Redis get error:', err.message);
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
    if (redisClient?.isReady) {
      await redisClient.setEx(`session:${phoneNumber}`, SESSION_TTL, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    logger.error('Redis update error:', err.message);
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
    if (redisClient?.isReady) {
      await redisClient.del(`session:${phoneNumber}`);
    }
  } catch (err) {
    logger.error('Redis delete error:', err.message);
  }
  memoryStore.delete(phoneNumber);
}

module.exports = { get, update, clearPendingTransfer, destroy };
