/**
 * Telegram Bot Service
 */

const axios = require('axios');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

// Convert WhatsApp markdown (*bold*) to Telegram HTML (<b>bold</b>)
function convertMarkdown(text) {
  if (!text) return '';

  // Step 1: Extract and protect links first
  const links = [];
  let protected_text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const placeholder = `__LINK${links.length}__`;
    links.push(`<a href="${url}">${linkText}</a>`);
    return placeholder;
  });

  // Step 2: Escape HTML special chars (except in our placeholders)
  protected_text = protected_text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Step 3: Apply bold/italic/code formatting
  protected_text = protected_text
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/`(.*?)`/g, '<code>$1</code>');

  // Step 4: Restore links
  links.forEach((link, i) => {
    protected_text = protected_text.replace(`__LINK${i}__`, link);
  });

  return protected_text;
}

async function sendText(chatId, text) {
  try {
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: convertMarkdown(text),
      parse_mode: 'HTML',
    });
    logger.info(`Telegram message sent to ${chatId}`);
    return response.data;
  } catch (err) {
    logger.error(`Telegram send failed to ${chatId}:`, err.response?.data || err.message);
    // Try without parse mode as fallback
    try {
      const response = await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: chatId,
        text: text.replace(/\*/g, '').replace(/_/g, ''),
      });
      return response.data;
    } catch (e) {
      logger.error(`Telegram fallback also failed:`, e.message);
    }
  }
}

async function sendConfirmationButtons(chatId, text, buttons) {
  try {
    const inline_keyboard = [buttons.map(btn => ({
      text: btn.title,
      callback_data: btn.id,
    }))];

    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: convertMarkdown(text),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard },
    });
    return response.data;
  } catch (err) {
    logger.error(`Telegram buttons failed to ${chatId}:`, err.response?.data || err.message);
    await sendText(chatId, text + '\n\nReply Yes to confirm or No to cancel.');
  }
}

async function setWebhook(webhookUrl) {
  try {
    const response = await axios.post(`${BASE_URL}/setWebhook`, {
      url: `${webhookUrl}/telegram/webhook`,
      allowed_updates: ['message', 'callback_query'],
    });
    logger.info('Telegram webhook set:', JSON.stringify(response.data));
    return response.data;
  } catch (err) {
    logger.error('Telegram webhook setup failed:', err.response?.data || err.message);
    throw err;
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await axios.post(`${BASE_URL}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (err) {}
}

async function sendTyping(chatId) {
  try {
    await axios.post(`${BASE_URL}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing',
    });
  } catch (err) {}
}

module.exports = { sendText, sendConfirmationButtons, setWebhook, answerCallbackQuery, sendTyping };
