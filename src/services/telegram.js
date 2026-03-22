/**
 * Telegram Bot Service
 */

const axios = require('axios');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

// Convert WhatsApp markdown to Telegram HTML
// Handles *bold*, _italic_, `code` but NOT URLs (send those separately)
function convertMarkdown(text) {
  if (!text) return '';

  // First extract URLs to protect them
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = [];
  let protected_text = text.replace(urlRegex, (url) => {
    const placeholder = `URLPLACEHOLDER${urls.length}END`;
    urls.push(url);
    return placeholder;
  });

  // Extract markdown links [text](url)
  const mdLinks = [];
  protected_text = protected_text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const placeholder = `LINKPLACEHOLDER${mdLinks.length}END`;
    mdLinks.push(`<a href="${url}">${linkText}</a>`);
    return placeholder;
  });

  // Escape HTML special chars
  protected_text = protected_text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply formatting
  protected_text = protected_text
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Restore URLs (as plain text — Telegram auto-linkifies them)
  urls.forEach((url, i) => {
    protected_text = protected_text.replace(`URLPLACEHOLDER${i}END`, url);
  });

  // Restore markdown links
  mdLinks.forEach((link, i) => {
    protected_text = protected_text.replace(`LINKPLACEHOLDER${i}END`, link);
  });

  return protected_text;
}

async function sendText(chatId, text) {
  try {
    const converted = convertMarkdown(text);
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: converted,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    logger.info(`Telegram message sent to ${chatId}`);
    return response.data;
  } catch (err) {
    logger.error(`Telegram send failed to ${chatId}:`, err.response?.data || err.message);
    // Fallback — send plain text
    try {
      const plain = text
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');
      await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: chatId,
        text: plain,
      });
    } catch (e) {
      logger.error(`Telegram fallback failed:`, e.message);
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
    await sendText(chatId, text + '\n\nReply *Yes* to confirm or *No* to cancel.');
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
