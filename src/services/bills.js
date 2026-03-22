/**
 * Bills & Airtime Service — Nigeria
 * Powered by Flutterwave Bills API
 */

const axios = require('axios');
const logger = require('../utils/logger');

const SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const BASE_URL = 'https://api.flutterwave.com/v3';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ─── AIRTIME TOP-UP ───────────────────────────────────
async function buyAirtime({ phone, amount, network }) {
  try {
    // Map network name to Flutterwave biller code
    const billerMap = {
      'mtn': 'BIL099',
      'airtel': 'BIL102',
      'glo': 'BIL103',
      '9mobile': 'BIL104',
      'etisalat': 'BIL104',
    };

    const networkKey = (network || 'mtn').toLowerCase();
    const billerCode = billerMap[networkKey] || 'BIL099';

    const response = await api.post('/bills', {
      country: 'NG',
      customer: phone,
      amount,
      recurrence: 'ONCE',
      type: 'AIRTIME',
      biller_code: billerCode,
      reference: `ZENO-AIR-${Date.now()}`,
    });

    logger.info(`Airtime purchased: ${amount} for ${phone}`);
    return { success: true, data: response.data };
  } catch (err) {
    logger.error('Airtime purchase failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── DATA BUNDLE ──────────────────────────────────────
async function buyData({ phone, amount, network }) {
  try {
    const billerMap = {
      'mtn': 'BIL106',
      'airtel': 'BIL110',
      'glo': 'BIL111',
      '9mobile': 'BIL112',
    };

    const networkKey = (network || 'mtn').toLowerCase();
    const billerCode = billerMap[networkKey] || 'BIL106';

    const response = await api.post('/bills', {
      country: 'NG',
      customer: phone,
      amount,
      recurrence: 'ONCE',
      type: 'DATA_BUNDLE',
      biller_code: billerCode,
      reference: `ZENO-DATA-${Date.now()}`,
    });

    return { success: true, data: response.data };
  } catch (err) {
    logger.error('Data bundle failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── ELECTRICITY ──────────────────────────────────────
async function payElectricity({ meterNumber, amount, disco }) {
  try {
    const discoMap = {
      'ikeja': 'BIL119',
      'eko': 'BIL120',
      'abuja': 'BIL121',
      'phed': 'BIL122',
      'eedc': 'BIL127',
      'ibedc': 'BIL123',
      'kedco': 'BIL124',
      'kaedco': 'BIL124',
    };

    const discoKey = (disco || 'ikeja').toLowerCase();
    const billerCode = discoMap[discoKey] || 'BIL119';

    const response = await api.post('/bills', {
      country: 'NG',
      customer: meterNumber,
      amount,
      recurrence: 'ONCE',
      type: 'UTILITY_BILLS',
      biller_code: billerCode,
      reference: `ZENO-ELEC-${Date.now()}`,
    });

    return { success: true, data: response.data };
  } catch (err) {
    logger.error('Electricity payment failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── DSTV/GOTV ────────────────────────────────────────
async function payTV({ smartCardNumber, amount, provider }) {
  try {
    const providerMap = {
      'dstv': 'BIL136',
      'gotv': 'BIL137',
      'startimes': 'BIL138',
    };

    const providerKey = (provider || 'dstv').toLowerCase();
    const billerCode = providerMap[providerKey] || 'BIL136';

    const response = await api.post('/bills', {
      country: 'NG',
      customer: smartCardNumber,
      amount,
      recurrence: 'ONCE',
      type: 'CABLE',
      biller_code: billerCode,
      reference: `ZENO-TV-${Date.now()}`,
    });

    return { success: true, data: response.data };
  } catch (err) {
    logger.error('TV payment failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── PARSE BILL COMMAND ───────────────────────────────
function parseBillCommand(text) {
  const lower = text.toLowerCase();

  // Airtime: "buy 500 airtime for 08012345678" or "recharge 08012345678 with 1000"
  const airtimeMatch = lower.match(/(?:buy|recharge|top.?up|airtime).*?(\d+(?:,\d+)?(?:k)?)\s*(?:naira|₦)?.*?(?:for|to)?\s*(0[789]\d{9}|234\d{10})/);
  if (airtimeMatch || lower.includes('airtime') || lower.includes('recharge')) {
    const amountMatch = lower.match(/(?:₦|naira)?\s*(\d+(?:,\d+)?(?:k)?)/);
    const phoneMatch = lower.match(/(0[789]\d{9}|234\d{10}|\+234\d{10})/);
    const networkMatch = lower.match(/\b(mtn|airtel|glo|9mobile|etisalat)\b/);

    if (amountMatch && phoneMatch) {
      let amount = parseFloat(amountMatch[1].replace(',', ''));
      if (amountMatch[1].endsWith('k')) amount *= 1000;

      return {
        type: 'airtime',
        amount,
        phone: phoneMatch[1].replace('+', ''),
        network: networkMatch?.[1] || 'mtn',
      };
    }
  }

  // Electricity: "pay ikeja electric 5000 meter 12345678"
  if (lower.includes('electric') || lower.includes('disco') || lower.includes('nepa') || lower.includes('power')) {
    const amountMatch = lower.match(/(\d+(?:,\d+)?)/);
    const meterMatch = lower.match(/meter\s*(?:number)?\s*(\d{8,13})/);
    const discoMatch = lower.match(/\b(ikeja|eko|abuja|phed|eedc|ibedc|kedco)\b/);

    if (amountMatch && meterMatch) {
      return {
        type: 'electricity',
        amount: parseFloat(amountMatch[1].replace(',', '')),
        meterNumber: meterMatch[1],
        disco: discoMatch?.[1] || 'ikeja',
      };
    }
  }

  // DSTV/GOTV: "pay dstv 6500 smartcard 1234567890"
  if (lower.includes('dstv') || lower.includes('gotv') || lower.includes('startimes') || lower.includes('cable')) {
    const amountMatch = lower.match(/(\d+(?:,\d+)?)/);
    const cardMatch = lower.match(/(?:smartcard|card|iuc)\s*(?:number)?\s*(\d{7,12})/);
    const providerMatch = lower.match(/\b(dstv|gotv|startimes)\b/);

    if (amountMatch) {
      return {
        type: 'tv',
        amount: parseFloat(amountMatch[1].replace(',', '')),
        smartCardNumber: cardMatch?.[1] || '',
        provider: providerMatch?.[1] || 'dstv',
      };
    }
  }

  return null;
}

module.exports = {
  buyAirtime,
  buyData,
  payElectricity,
  payTV,
  parseBillCommand,
};
