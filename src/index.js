require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const webhookRouter = require('./handlers/webhook');
const truelayerRouter = require('./handlers/truelayerCallback');
const veriffRouter = require('./handlers/veriffWebhook');
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

// ─── API ROUTES ───────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/truelayer', truelayerRouter);
app.use('/veriff', veriffRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Zeno WhatsApp Banking AI',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  logger.info(`Zeno backend running on port ${PORT}`);
  logger.info(`Webhook URL: POST /webhook`);
  logger.info(`Verify URL:  GET  /webhook`);
});

module.exports = app;