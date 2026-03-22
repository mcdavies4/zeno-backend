/**
 * Telegram Bot Service
 */

const axios = require('axios');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${TOKEN}`;

// Convert WhatsApp markdown to Telegram HTML
function convertMarkdown(text) {
  if (!text) return '';

  // Extract markdown links [text](url) and replace with HTML links
  // Do this BEFORE any other processing
  let result = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, linkText, url) => {
    return `<a href="${url}">${linkText}</a>`;
  });

  // Now escape HTML in the non-link parts only
  // Split by <a href...> tags, escape non-link parts, rejoin
  const parts = result.split(/(<a href="[^"]*">[^<]*<\/a>)/g);
  result = parts.map((part, i) => {
    // Even indexes are non-link text, odd indexes are link tags
    if (i % 2 === 0) {
      return part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    return part; // Keep link tags as-is
  }).join('');

  // Apply bold/italic/code formatting on non-link parts
  result = result
    .replace(/\*([^*]+)\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  return result;
}

// Send plain URL as clickable link in Telegram
// Telegram auto-previews raw URLs if they're on their own line
function formatLinkMessage(text, url, caption) {
  return `${text}\n\n${url}\n\n${caption || ''}`.trim();
}

async function sendText(chatId, text) {
  try {
    const converted = convertMarkdown(text);
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text: converted,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    logger.info(`Telegram message sent to ${chatId}`);
    return response.data;
  } catch (err) {
    logger.error(`Telegram send failed to ${chatId}:`, err.response?.data || err.message);
    // Fallback — send without parse mode, strip markdown
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
