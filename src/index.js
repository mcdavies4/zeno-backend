require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const webhookRouter = require('./handlers/webhook');
const truelayerRouter = require('./handlers/truelayerCallback');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SECURITY MIDDLEWARE ───────────────────────────────
app.use(helmet());
app.set('trust proxy', 1);

// Raw body needed for WhatsApp signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Request logging
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Rate limiting
app.use('/webhook', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
}));

// ─── ROUTES ───────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/truelayer', truelayerRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zeno WhatsApp Banking AI',
    database: database.isReady() ? 'connected' : 'in-memory',
    timestamp: new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────
async function start() {
  // Init database first
  async function start() {
  app.listen(PORT, () => {
    logger.info(`Zeno backend running on port ${PORT}`);
    logger.info(`Webhook URL: POST /webhook`);
    logger.info(`Verify URL:  GET  /webhook`);
  });
}

  app.listen(PORT, () => {
    logger.info(`Zeno backend running on port ${PORT}`);
    logger.info(`Database: ${database.isReady() ? 'SQLite connected' : 'in-memory fallback'}`);
    logger.info(`Webhook URL: POST /webhook`);
    logger.info(`Verify URL:  GET  /webhook`);
  });
}

start();
module.exports = app;
