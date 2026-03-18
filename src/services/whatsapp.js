const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://graph.facebook.com/v19.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const api = axios.create({
  baseURL: `${BASE_URL}/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ─── SEND PLAIN TEXT ──────────────────────────────────
async function sendText(to, text) {
  try {
    const res = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    });
    logger.info(`Text sent to ${to}: ${res.data?.messages?.[0]?.id}`);
    return res.data;
  } catch (err) {
    logger.error(`Failed to send text to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

// ─── SEND INTERACTIVE BUTTONS (max 3 buttons) ─────────
async function sendConfirmationButtons(to, bodyText, buttons) {
  try {
    const formattedButtons = buttons.map(btn => ({
      type: 'reply',
      reply: { id: btn.id, title: btn.title.substring(0, 20) }, // WhatsApp max 20 chars
    }));

    const res = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: formattedButtons },
      },
    });
    logger.info(`Buttons sent to ${to}`);
    return res.data;
  } catch (err) {
    // Fallback to plain text if interactive fails
    logger.warn(`Interactive message failed for ${to}, falling back to text`);
    await sendText(to, bodyText + '\n\nReply *Yes* to confirm or *No* to cancel.');
  }
}

// ─── SEND LIST (for menus with many options) ──────────
async function sendList(to, headerText, bodyText, buttonLabel, sections) {
  try {
    const res = await api.post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: headerText },
        body: { text: bodyText },
        action: {
          button: buttonLabel,
          sections,
        },
      },
    });
    return res.data;
  } catch (err) {
    logger.error(`Failed to send list to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

// ─── SEND TEMPLATE (for outbound/notifications) ───────
// You must pre-register templates in Meta Business Manager
async function sendTemplate(to, templateName, languageCode = 'en_GB', components = []) {
  try {
    const res = await api.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });
    return res.data;
  } catch (err) {
    logger.error(`Failed to send template to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

// ─── TYPING INDICATOR ─────────────────────────────────
// Shows the "typing..." bubble while AI processes
async function sendTypingOn(to) {
  try {
    // WhatsApp doesn't have a direct typing indicator via Cloud API
    // Best practice: just respond quickly (< 3 seconds)
    // This is a placeholder for future support
    logger.debug(`Typing indicator for ${to} (not yet supported in Cloud API)`);
  } catch (err) {
    // Non-critical — don't throw
  }
}

// ─── MARK MESSAGE AS READ ─────────────────────────────
async function markAsRead(messageId) {
  try {
    await api.post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (err) {
    // Non-critical
    logger.debug(`Could not mark ${messageId} as read`);
  }
}

module.exports = {
  sendText,
  sendConfirmationButtons,
  sendList,
  sendTemplate,
  sendTypingOn,
  markAsRead,
};
