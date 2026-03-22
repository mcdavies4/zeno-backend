/**
 * Scheduler Service
 * Daily balance summaries and reminders
 */

const logger = require('../utils/logger');

let schedulerRunning = false;

async function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  logger.info('Scheduler started');

  // Check every minute
  setInterval(async () => {
    try {
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();

      // 7:00 AM UTC = 7AM UK / 8AM Nigeria
      if (hour === 7 && minute === 0) {
        await sendDailyBalanceSummaries();
      }
    } catch (err) {
      logger.error('Scheduler error:', err.message);
    }
  }, 60000); // every minute
}

async function sendDailyBalanceSummaries() {
  logger.info('Running daily balance summaries...');

  try {
    const db = require('./database');
    if (!db.isReady()) return;

    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    // Get all onboarded users with bank connected and daily summary enabled
    const result = await pool.query(`
      SELECT phone_number, name, banking_country, bank_connected
      FROM users
      WHERE is_onboarded = true
      AND bank_connected = true
      AND kyc_verified = true
    `);

    await pool.end();

    logger.info(`Sending daily summaries to ${result.rows.length} users`);

    for (const user of result.rows) {
      try {
        await sendBalanceSummary(user);
        // Small delay to avoid rate limits
        await sleep(500);
      } catch (err) {
        logger.error(`Daily summary failed for ${user.phone_number}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('Daily summary batch error:', err.message);
  }
}

async function sendBalanceSummary(user) {
  const sessionStore = require('./sessionStore');
  const banking = require('./banking');
  const messenger = require('./messenger');
  const { detectCountry } = require('../utils/countryDetect');

  const session = await sessionStore.get(user.phone_number);
  const country = detectCountry(user.phone_number, session);
  const symbol = country.symbol;

  const firstName = (user.name || 'there').split(' ')[0];
  const greeting = getGreeting();

  try {
    const result = await banking.getBalance(user.phone_number, session);

    if (result.success && result.balances?.length) {
      const balance = result.balances[0].available;
      const msg =
        `${greeting} *${firstName}!* 👋\n\n` +
        `💰 Your balance: *${symbol}${balance.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n\n` +
        `_What would you like to do today?_`;

      await messenger.sendText(user.phone_number, msg);
      logger.info(`Daily summary sent to ${user.phone_number}`);
    }
  } catch (err) {
    logger.error(`Balance fetch for summary failed ${user.phone_number}:`, err.message);
  }
}

function getGreeting() {
  const hour = new Date().getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { startScheduler, sendBalanceSummary };
