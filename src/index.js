require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const webhookRouter = require('./handlers/webhook');
const veriffWebhook = require('./handlers/veriffWebhook');
const adminRouter = require('./handlers/adminDashboard');
const telegramRouter = require('./handlers/telegramWebhook');
const monoRouter = require('./handlers/monoCallback');
const database = require('./services/database');
const { startScheduler } = require('./services/scheduler');
const flutterwaveWebhook = require('./handlers/flutterwaveWebhook');
const stripeCallback = require('./handlers/stripeCallback');
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
app.use('/veriff', veriffWebhook);

// Serve generated statement files
app.use('/statements', (req, res, next) => {
  const filename = req.path.replace('/', '');
  // Security — only allow alphanumeric, dash, dot
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) return res.status(403).send('Forbidden');
  const filepath = path.join('/tmp/zeno-statements', filename);
  if (require('fs').existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).send('File not found or expired');
  }
});
app.use('/admin', adminRouter);
app.use('/telegram', telegramRouter);
app.use('/mono', monoRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zeno WhatsApp Banking AI',
    markets: ['UK 🇬🇧', 'Nigeria 🇳🇬'],
    kyc: 'Veriff', ukBanking: 'Stripe', ngBanking: 'Mono',
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
    logger.info(`KYC: Veriff`);
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
