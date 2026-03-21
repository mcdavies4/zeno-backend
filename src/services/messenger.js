/**
 * Unified Messenger Service
 * 
 * Detects whether a user is on WhatsApp or Telegram
 * and routes messages to the correct platform.
 * 
 * Telegram chat IDs are purely numeric.
 * WhatsApp numbers start with country code e.g. 447...
 */

const whatsappService = require('./whatsapp');
const telegramService = require('./telegram');
const logger = require('../utils/logger');

// Telegram IDs are typically 7-10 digits, no country code prefix
// WhatsApp numbers are 10-15 digits with country code
function isTelegram(chatId) {
  const id = String(chatId);
  // Telegram user IDs are typically shorter and don't start with country codes
  // WhatsApp numbers always start with 44 (UK) or other country codes
  // Simple heuristic: if less than 11 digits, likely Telegram
  return /^\d{5,10}$/.test(id) && !id.startsWith('44') && !id.startsWith('1') && !id.startsWith('234');
}

async function sendText(chatId, text) {
  if (isTelegram(chatId)) {
    return telegramService.sendText(chatId, text);
  }
  return whatsappService.sendText(chatId, text);
}

async function sendConfirmationButtons(chatId, text, buttons) {
  if (isTelegram(chatId)) {
    return telegramService.sendConfirmationButtons(chatId, text, buttons);
  }
  return whatsappService.sendConfirmationButtons(chatId, text, buttons);
}

async function sendTyping(chatId) {
  if (isTelegram(chatId)) {
    return telegramService.sendTyping(chatId);
  }
  return whatsappService.sendTypingOn(chatId);
}

module.exports = { sendText, sendConfirmationButtons, sendTyping, isTelegram };
