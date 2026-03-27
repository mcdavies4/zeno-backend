/**
 * Country Detection Utility
 * Nigeria-focused — defaults to NG for all users
 */

const COUNTRY_CONFIGS = {
  NG: {
    code: 'NG',
    prefix: '234',
    currency: 'NGN',
    symbol: '₦',
    flag: '🇳🇬',
    name: 'Nigeria',
  },
  UK: {
    code: 'UK',
    prefix: '44',
    currency: 'GBP',
    symbol: '£',
    flag: '🇬🇧',
    name: 'United Kingdom',
  },
};

function detectCountry(phoneOrId, session = null) {
  // Use saved banking country if set
  if (session?.bankingCountry && COUNTRY_CONFIGS[session.bankingCountry]) {
    return COUNTRY_CONFIGS[session.bankingCountry];
  }
  // Default to Nigeria for all users
  return COUNTRY_CONFIGS.NG;
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
