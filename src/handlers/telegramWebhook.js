/**
 * Telegram Webhook Handler
 * 
 * Receives messages from Telegram and processes them
 * using the same Claude AI and session store as WhatsApp.
 */

const express = require('express');
const router = express.Router();
const telegramService = require('../services/telegram');
const claudeService = require('../services/claude');
const sessionStore = require('../services/sessionStore');
const transferService = require('../services/transfer');
const { checkAndHandleOnboarding } = require('../services/onboarding');
const { verifyPin } = require('../utils/pinUtils');
const truelayer = require('../services/truelayer');
const logger = require('../utils/logger');

// ─── WEBHOOK ENDPOINT ─────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200); // Respond immediately

  try {
    const update = req.body;

    // Handle button callbacks
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    // Handle text messages
    if (update.message?.text) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const text = msg.text.trim();
      const firstName = msg.from?.first_name || 'there';
      const lastName = msg.from?.last_name || '';
      const contactName = `${firstName} ${lastName}`.trim();

      logger.info(`Telegram message from ${chatId} (${contactName}): ${text.substring(0, 50)}`);

      await handleTextMessage({ chatId, text, contactName });
    }

  } catch (err) {
    logger.error('Telegram webhook error:', err.message);
  }
});

// ─── HANDLE TEXT MESSAGES ─────────────────────────────
async function handleTextMessage({ chatId, text, contactName }) {
  const session = await sessionStore.get(chatId);

  // Show typing
  await telegramService.sendTyping(chatId);

  // Check onboarding first
  const onboardingHandled = await checkAndHandleOnboarding(chatId, session, text);
  if (onboardingHandled) return;

  // Check if awaiting PIN
  if (session.awaitingPin) {
    await handlePinConfirmation({ chatId, pin: text, session });
    return;
  }

  // Check if awaiting transfer confirmation
  if (session.pendingTransfer) {
    const lower = text.toLowerCase();
    if (['yes', 'y', 'confirm', 'send it', 'proceed', 'ok', 'go ahead'].some(w => lower.includes(w))) {
      await initiateTransfer({ chatId, session });
    } else if (['no', 'n', 'cancel', 'stop'].some(w => lower.includes(w))) {
      await sessionStore.clearPendingTransfer(chatId);
      await telegramService.sendText(chatId, "Transfer cancelled ✅ No money has been moved.");
    } else {
      await telegramService.sendText(chatId,
        `Just to confirm — send *£${session.pendingTransfer.amount}* to *${session.pendingTransfer.recipientName}*?\n\nReply *Yes* to confirm or *No* to cancel.`
      );
    }
    return;
  }

  // Process with Claude AI
  const aiResponse = await claudeService.processMessage({
    userMessage: text,
    contactName,
    session,
    from: chatId,
  });

  await handleAIResponse({ chatId, aiResponse, session });
}

// ─── HANDLE BUTTON CALLBACKS ──────────────────────────
async function handleCallbackQuery(callbackQuery) {
  const chatId = String(callbackQuery.message.chat.id);
  const data = callbackQuery.data;
  const session = await sessionStore.get(chatId);

  await telegramService.answerCallbackQuery(callbackQuery.id);

  switch (data) {
    case 'confirm_transfer':
      await initiateTransfer({ chatId, session });
      break;
    case 'cancel_transfer':
      await sessionStore.clearPendingTransfer(chatId);
      await telegramService.sendText(chatId, "Transfer cancelled ✅ Your money is safe.");
      break;
    default:
      await handleTextMessage({ chatId, text: data, contactName: '' });
  }
}

// ─── PIN CONFIRMATION ─────────────────────────────────
async function handlePinConfirmation({ chatId, pin, session }) {
  const storedHash = session.userPin;
  const isValid = await verifyPin(pin, storedHash);

  if (!isValid) {
    const attempts = (session.pinAttempts || 0) + 1;
    await sessionStore.update(chatId, { pinAttempts: attempts });

    if (attempts >= 3) {
      await sessionStore.update(chatId, { awaitingPin: false, pinAttempts: 0, pendingTransfer: null });
      await telegramService.sendText(chatId, "❌ Too many incorrect PIN attempts. Transfer cancelled for your security.");
      return;
    }
    await telegramService.sendText(chatId, `❌ Incorrect PIN. ${3 - attempts} attempt(s) remaining. Please try again:`);
    return;
  }

  await sessionStore.update(chatId, { awaitingPin: false, pinAttempts: 0 });
  await executeTransfer({ chatId, session });
}

// ─── TRANSFER FLOW ────────────────────────────────────
async function initiateTransfer({ chatId, session }) {
  const transfer = session.pendingTransfer;
  if (!transfer) {
    await telegramService.sendText(chatId, "I don't have a pending transfer. Please start again.");
    return;
  }
  await sessionStore.update(chatId, { awaitingPin: true });
  await telegramService.sendText(chatId,
    `🔐 *Security Check*\n\nEnter your 4-digit Zeno PIN to authorise *£${transfer.amount}* to *${transfer.recipientName}*.\n\n_Never share your PIN with anyone._`
  );
}

async function executeTransfer({ chatId, session }) {
  const transfer = session.pendingTransfer;
  await telegramService.sendText(chatId, "⏳ Processing your transfer...");

  try {
    const result = await transferService.sendPayment({
      fromUser: chatId,
      recipientName: transfer.recipientName,
      recipientSortCode: transfer.sortCode,
      recipientAccountNumber: transfer.accountNumber,
      amount: transfer.amount,
      reference: transfer.reference,
      currency: 'GBP',
    });

    await sessionStore.clearPendingTransfer(chatId);
    await telegramService.sendText(chatId,
      `✅ *Transfer Successful!*\n\n` +
      `• Amount: *£${transfer.amount}*\n` +
      `• To: *${transfer.recipientName}*\n` +
      `• Reference: ${transfer.reference}\n` +
      `• Transaction ID: ${result.transactionId}\n\n` +
      `New balance: *£${result.newBalance}*`
    );
  } catch (err) {
    await sessionStore.clearPendingTransfer(chatId);
    await telegramService.sendText(chatId,
      `❌ *Transfer Failed*\n\n${err.userMessage || 'Could not complete transfer. No money has left your account.'}`
    );
  }
}

// ─── AI RESPONSE ROUTER ───────────────────────────────
async function handleAIResponse({ chatId, aiResponse, session }) {
  switch (aiResponse.intent) {

    case 'TRANSFER': {
      const t = aiResponse.transferDetails;
      await sessionStore.update(chatId, { pendingTransfer: t });
      const msg =
        `💸 *Transfer Summary*\n\n` +
        `• Amount: *£${t.amount}*\n` +
        `• To: *${t.recipientName}*\n` +
        (t.sortCode ? `• Sort Code: ${t.sortCode}\n` : '') +
        (t.accountNumber ? `• Account: ${t.accountNumber}\n` : '') +
        `• Reference: ${t.reference || 'Zeno Transfer'}\n\n` +
        `*Shall I go ahead?*`;

      await telegramService.sendConfirmationButtons(chatId, msg, [
        { id: 'confirm_transfer', title: '✅ Confirm' },
        { id: 'cancel_transfer', title: '❌ Cancel' },
      ]);
      break;
    }

    case 'BALANCE': {
      if (session.bankConnected) {
        const result = await truelayer.getBalance(chatId, session);
        if (result.success) {
          await telegramService.sendText(chatId, truelayer.formatBalanceMessage(result.balances));
          break;
        }
      }
      const authLink = truelayer.generateAuthLink(chatId);
      await telegramService.sendText(chatId,
        `💰 Connect your bank to see your real balance!\n\n[Tap here to connect](${authLink})\n\n_Read-only access. No card details needed._`
      );
      break;
    }

    case 'TRANSACTIONS': {
      if (session.bankConnected) {
        const result = await truelayer.getTransactions(chatId, session);
        if (result.success) {
          await telegramService.sendText(chatId, truelayer.formatTransactionsMessage(result.transactions));
          break;
        }
      }
      const authLink = truelayer.generateAuthLink(chatId);
      await telegramService.sendText(chatId,
        `📋 Connect your bank to see real transactions!\n\n[Tap here to connect](${authLink})`
      );
      break;
    }

    default:
      await telegramService.sendText(chatId, aiResponse.reply);
  }
}

module.exports = router;
