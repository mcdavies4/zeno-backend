require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const webhookRouter = require('./handlers/webhook');
const truelayerRouter = require('./handlers/truelayerCallback');
const veriffRouter = require('./handlers/veriffWebhook');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
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

// ─── ROUTES ───────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/truelayer', truelayerRouter);
app.use('/veriff', veriffRouter);

app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../zeno-landing.html'));
});
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
