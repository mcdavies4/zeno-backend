const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta, (key, val) => {
  if (val instanceof Object && val.constructor === Object) {
    try { return JSON.parse(JSON.stringify(val)); } catch(e) { return '[Complex Object]'; }
  }
  return val;
}) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
    // Uncomment to write to files in production:
    // new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

module.exports = logger;
