/**
 * Security Service
 * Rate limiting, fraud protection, transfer limits
 */

const logger = require('../utils/logger');

// ─── TRANSFER LIMITS ──────────────────────────────────
const LIMITS = {
  NG: {
    singleTransfer: 1000000,   // ₦1,000,000 per transfer
    dailyTotal: 3000000,        // ₦3,000,000 per day
    symbol: '₦',
  },
  UK: {
    singleTransfer: 10000,      // £10,000 per transfer
    dailyTotal: 20000,          // £20,000 per day
    symbol: '£',
  },
};

const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_HOURS = 24;

// ─── PIN ATTEMPTS ─────────────────────────────────────
function checkPinLock(session) {
  if (!session.pinLockedUntil) return { locked: false };
  const lockedUntil = new Date(session.pinLockedUntil);
  if (new Date() < lockedUntil) {
    const hoursLeft = Math.ceil((lockedUntil - new Date()) / (1000 * 60 * 60));
    return { locked: true, hoursLeft };
  }
  return { locked: false };
}

function recordFailedPin(session) {
  const attempts = (session.failedPinAttempts || 0) + 1;
  const update = { failedPinAttempts: attempts };

  if (attempts >= MAX_PIN_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + PIN_LOCK_HOURS * 60 * 60 * 1000);
    update.pinLockedUntil = lockUntil.toISOString();
    update.failedPinAttempts = 0;
    logger.warn(`Account PIN locked: ${attempts} failed attempts`);
  }

  return { update, attempts, locked: attempts >= MAX_PIN_ATTEMPTS };
}

function clearFailedPin() {
  return { failedPinAttempts: 0, pinLockedUntil: null };
}

// ─── TRANSFER LIMITS ──────────────────────────────────
function checkTransferLimit(amount, session, countryCode) {
  const limits = LIMITS[countryCode] || LIMITS.UK;
  const symbol = limits.symbol;

  // Single transfer limit
  if (amount > limits.singleTransfer) {
    return {
      allowed: false,
      reason: `Single transfer limit is ${symbol}${limits.singleTransfer.toLocaleString()}. Please contact support for larger transfers.`,
    };
  }

  // Daily limit
  const todaySpent = getDailySpent(session, countryCode);
  if (todaySpent + amount > limits.dailyTotal) {
    const remaining = limits.dailyTotal - todaySpent;
    return {
      allowed: false,
      reason: `Daily transfer limit reached. You have ${symbol}${remaining.toLocaleString()} remaining today. Limit resets at midnight.`,
    };
  }

  return { allowed: true };
}

function getDailySpent(session, countryCode) {
  const key = `dailySpent_${countryCode}_${new Date().toDateString()}`;
  return session[key] || 0;
}

function recordTransfer(session, amount, countryCode) {
  const key = `dailySpent_${countryCode}_${new Date().toDateString()}`;
  const current = session[key] || 0;
  return { [key]: current + amount };
}

// ─── DUPLICATE DETECTION ──────────────────────────────
function isDuplicate(session, transfer) {
  const last = session.lastTransfer;
  if (!last) return false;

  const sameRecipient = last.accountNumber === transfer.accountNumber;
  const sameAmount = last.amount === transfer.amount;
  const recent = (Date.now() - last.timestamp) < 60000; // within 1 minute

  return sameRecipient && sameAmount && recent;
}

function recordLastTransfer(transfer) {
  return {
    lastTransfer: {
      accountNumber: transfer.accountNumber,
      amount: transfer.amount,
      timestamp: Date.now(),
    },
  };
}

module.exports = {
  checkPinLock,
  recordFailedPin,
  clearFailedPin,
  checkTransferLimit,
  recordTransfer,
  isDuplicate,
  recordLastTransfer,
  LIMITS,
  MAX_PIN_ATTEMPTS,
};
