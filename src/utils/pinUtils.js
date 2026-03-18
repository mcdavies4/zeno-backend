/**
 * PIN Security Utilities
 *
 * Uses bcrypt to hash and verify PINs.
 * Never store PINs in plaintext.
 */

const crypto = require('crypto');

// bcrypt is the gold standard for hashing passwords/PINs
// We use a pure JS implementation to avoid native dependencies
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  // fallback handled below
}

const SALT_ROUNDS = 12;

/**
 * Hash a PIN securely using bcrypt.
 * @param {string} pin - 4-digit PIN
 * @returns {Promise<string>} hashed PIN
 */
async function hashPin(pin) {
  if (bcrypt) {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    return bcrypt.hash(pin, salt);
  }
  // Fallback: SHA-256 with a random salt (less secure than bcrypt but works without deps)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(pin).digest('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a PIN against its stored hash.
 * @param {string} pin - PIN entered by user
 * @param {string} storedHash - hash from database/session
 * @returns {Promise<boolean>}
 */
async function verifyPin(pin, storedHash) {
  if (!storedHash) return false;

  if (bcrypt && storedHash.startsWith('$2')) {
    return bcrypt.compare(pin, storedHash);
  }

  // Fallback verification
  if (storedHash.includes(':')) {
    const [salt, hash] = storedHash.split(':');
    const attempt = crypto.createHmac('sha256', salt).update(pin).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(attempt));
  }

  return false;
}

module.exports = { hashPin, verifyPin };
