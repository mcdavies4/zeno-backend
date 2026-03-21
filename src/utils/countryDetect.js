/**
 * Country Detection Utility
 * 
 * Priority order:
 * 1. User's saved bankingCountry preference (set during onboarding)
 * 2. Phone number prefix fallback
 * 3. Default to UK
 */

const COUNTRY_CONFIGS = {
  UK: {
    code: 'UK',
    prefix: '44',
    currency: 'GBP',
    symbol: '£',
    flag: '🇬🇧',
    name: 'United Kingdom',
  },
  NG: {
    code: 'NG',
    prefix: '234',
    currency: 'NGN',
    symbol: '₦',
    flag: '🇳🇬',
    name: 'Nigeria',
  },
  CA: {
    code: 'CA',
    prefix: '1',
    currency: 'CAD',
    symbol: 'C$',
    flag: '🇨🇦',
    name: 'Canada',
  },
};

/**
 * Detect country from session preference first, then phone prefix
 * Always pass session when available for accurate detection
 */
function detectCountry(phoneOrId, session = null) {
  // 1. Use saved banking country preference (most accurate)
  if (session?.bankingCountry && COUNTRY_CONFIGS[session.bankingCountry]) {
    return COUNTRY_CONFIGS[session.bankingCountry];
  }

  const id = String(phoneOrId);

  // 2. Telegram IDs — default to UK (will be set properly during onboarding)
  if (/^\d{5,10}$/.test(id) && !id.startsWith('44') && !id.startsWith('234') && !id.startsWith('1')) {
    return COUNTRY_CONFIGS.UK;
  }

  // 3. Phone number prefix detection
  if (id.startsWith('234')) return COUNTRY_CONFIGS.NG;
  if (id.startsWith('1') && id.length === 11) return COUNTRY_CONFIGS.CA;

  // 4. Default UK
  return COUNTRY_CONFIGS.UK;
}

function isTelegram(id) {
  const str = String(id);
  return /^\d{5,10}$/.test(str) &&
    !str.startsWith('44') &&
    !str.startsWith('234') &&
    !str.startsWith('1');
}

function getPlatform(id) {
  return isTelegram(id) ? 'Telegram' : 'WhatsApp';
}

module.exports = { detectCountry, isTelegram, getPlatform, COUNTRY_CONFIGS };
