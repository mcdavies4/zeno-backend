/**
 * Telegram Bot Service
 * Handles sending messages, buttons and notifications
 */

const axios = require('axios');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

// ─── SEND TEXT ────────────────────────────────────────
async function sendText(chatId, text) {
  try {
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    });
    logger.info(`Telegram message sent to ${chatId}`);
    return response.data;
  } catch (err) {
    logger.error(`Telegram send failed to ${chatId}:`, err.response?.data || err.message);
    throw err;
  }
}

// ─── SEND CONFIRMATION BUTTONS ────────────────────────
async function sendConfirmationButtons(chatId, text, buttons) {
  try {
    const inline_keyboard = [buttons.map(btn => ({
      text: btn.title,
      callback_data: btn.id,
    }))];

    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard },
    });
    return response.data;
  } catch (err) {
    logger.error(`Telegram buttons failed to ${chatId}:`, err.response?.data || err.message);
    // Fallback to plain text
    await sendText(chatId, text + '\n\nReply *Yes* to confirm or *No* to cancel.');
  }
}

// ─── SET WEBHOOK ──────────────────────────────────────
async function setWebhook(webhookUrl) {
  try {
    const response = await axios.post(`${BASE_URL}/setWebhook`, {
      url: `${webhookUrl}/telegram/webhook`,
      allowed_updates: ['message', 'callback_query'],
    });
    logger.info('Telegram webhook set:', response.data);
    return response.data;
  } catch (err) {
    logger.error('Telegram webhook setup failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── ANSWER CALLBACK QUERY ────────────────────────────
async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await axios.post(`${BASE_URL}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (err) {
    // Non-critical
  }
}

// ─── SEND TYPING ACTION ───────────────────────────────
async function sendTyping(chatId) {
  try {
    await axios.post(`${BASE_URL}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing',
    });
  } catch (err) {
    // Non-critical
  }
}

module.exports = {
  sendText,
  sendConfirmationButtons,
  setWebhook,
  answerCallbackQuery,
  sendTyping,
};
