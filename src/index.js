require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const webhookRouter = require('./handlers/webhook');
const truelayerRouter = require('./handlers/truelayerCallback');
const veriffRouter = require('./handlers/veriffWebhook');
const adminRouter = require('./handlers/adminDashboard');
const telegramRouter = require('./handlers/telegramWebhook');
const database = require('./services/database');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

app.use('/webhook', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
}));

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
app.use('/veriff', veriffRouter);
app.use('/admin', adminRouter);
app.use('/telegram', telegramRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zeno WhatsApp Banking AI',
    database: database.isReady() ? 'postgresql' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────
async function start() {
  await database.init();

  app.listen(PORT, async () => {
    logger.info(`Zeno backend running on port ${PORT}`);
    logger.info(`Database: ${database.isReady() ? 'PostgreSQL connected' : 'unavailable'}`);
    logger.info(`Webhook URL: POST /webhook`);
    logger.info(`Telegram:   POST /telegram/webhook`);

    // Auto-register Telegram webhook
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.RAILWAY_PUBLIC_DOMAIN) {
      try {
        const telegramService = require('./services/telegram');
        const domain = process.env.RAILWAY_PUBLIC_DOMAIN.startsWith('http')
          ? process.env.RAILWAY_PUBLIC_DOMAIN
          : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
        await telegramService.setWebhook(domain);
        logger.info('Telegram webhook registered successfully');
      } catch (err) {
        logger.warn('Telegram webhook registration failed:', err.message);
      }
    }
  });
}

start();
module.exports = app;
