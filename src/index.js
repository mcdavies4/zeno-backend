require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const webhookRouter = require('./handlers/webhook');
const truelayerRouter = require('./handlers/truelayerCallback');
const idenfyRouter = require('./handlers/idenfyWebhook');
const adminRouter = require('./handlers/adminDashboard');
const telegramRouter = require('./handlers/telegramWebhook');
const monoRouter = require('./handlers/monoCallback');
const database = require('./services/database');
const { startScheduler } = require('./services/scheduler');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
app.use('/webhook', rateLimit({ windowMs: 60000, max: 100 }));

// ─── STATIC PAGES ─────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../zeno-landing.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../terms.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, '../security.html')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, '../sitemap.xml')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, '../robots.txt')));
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, '../favicon.svg')));

// ─── API ROUTES ───────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/truelayer', truelayerRouter);
app.use('/idenfy', idenfyRouter);      // New iDenfy handler
app.use('/admin', adminRouter);
app.use('/telegram', telegramRouter);
app.use('/mono', monoRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zeno WhatsApp Banking AI',
    markets: ['UK 🇬🇧', 'Nigeria 🇳🇬'],
    kyc: 'iDenfy',
    database: database.isReady() ? 'postgresql' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────
async function start() {
  await database.init();
  app.listen(PORT, async () => {
    logger.info(`Zeno backend running on port ${PORT}`);
    logger.info(`Markets: UK 🇬🇧 Nigeria 🇳🇬`);
    logger.info(`KYC: iDenfy`);
    logger.info(`Database: ${database.isReady() ? 'PostgreSQL' : 'unavailable'}`);

    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const telegramService = require('./services/telegram');
        await telegramService.setWebhook('https://api.joinzeno.co.uk');
        logger.info('Telegram webhook registered');

    // Start daily balance scheduler
    startScheduler();
    logger.info('Daily scheduler started — summaries at 7:00 AM UTC');
      } catch (err) {
        logger.warn('Telegram webhook failed:', err.message);
      }
    }
  });
}

start();
module.exports = app;
