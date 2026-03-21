/**
 * Country Detection Utility
 * Detects user country from phone number prefix or Telegram ID
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

function detectCountry(phoneOrId) {
  const id = String(phoneOrId);

  // Telegram IDs — default to UK for now
  if (/^\d{5,10}$/.test(id) && !id.startsWith('44') && !id.startsWith('234') && !id.startsWith('1')) {
    return COUNTRY_CONFIGS.UK;
  }

  // Nigerian numbers
  if (id.startsWith('234')) return COUNTRY_CONFIGS.NG;

  // Canadian/US numbers
  if (id.startsWith('1') && id.length === 11) return COUNTRY_CONFIGS.CA;

  // Default UK
  return COUNTRY_CONFIGS.UK;
}

function isTelegram(id) {
  const str = String(id);
  return /^\d{5,10}$/.test(str) && !str.startsWith('44') && !str.startsWith('234') && !str.startsWith('1');
}

function getPlatform(id) {
  return isTelegram(id) ? 'Telegram' : 'WhatsApp';
}

module.exports = { detectCountry, isTelegram, getPlatform, COUNTRY_CONFIGS };
