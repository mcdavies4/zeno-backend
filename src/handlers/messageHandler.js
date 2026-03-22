const whatsappService = require('../services/whatsapp');
const flutterwave = require('../services/flutterwave');
const { detectCountry } = require('../utils/countryDetect');
const { findBankCode } = require('../utils/nigerianBanks');
const messenger = require('../services/messenger');
const claudeService = require('../services/claude');
const sessionStore = require('../services/sessionStore');
const transferService = require('../services/transfer');
const { checkAndHandleOnboarding } = require('../services/onboarding');
const { verifyPin } = require('../utils/pinUtils');
const banking = require('../services/banking');
const logger = require('../utils/logger');

/**
 * Main entry point for every incoming WhatsApp message.
 * Handles text, voice (audio), images, and interactive replies.
 */
async function handle({ from, contactName, message, phoneNumberId }) {
  const session = await sessionStore.get(from);

  try {
    // ── Route by message type ──────────────────────────
    if (message.type === 'text') {
      await handleText({ from, contactName, message, session });

    } else if (message.type === 'audio') {
      // Voice notes — transcribe then treat as text
      await handleAudio({ from, contactName, message, session });

    } else if (message.type === 'interactive') {
      // Button/list replies
      await handleInteractive({ from, contactName, message, session });

    } else if (message.type === 'image') {
      await whatsappService.sendText(from,
        "I can see your image! For security, I can't process image-based payments yet. Please type your request instead. 😊"
      );
    } else {
      await whatsappService.sendText(from,
        "I received your message but I'm not sure how to handle that format yet. Please send a text message! 💬"
      );
    }
  } catch (err) {
    logger.error(`Error handling message from ${from}:`, err);
    await whatsappService.sendText(from,
      "⚠️ Something went wrong on my end. Please try again in a moment."
    );
  }
}

// ─── TEXT MESSAGES ────────────────────────────────────
async function handleText({ from, contactName, message, session }) {
  const text = message.text.body.trim();

  // Check onboarding first — new users must register before anything else
  const onboardingHandled = await checkAndHandleOnboarding(from, session, text);
  if (onboardingHandled) return;

  // Show typing indicator while processing
  await whatsappService.sendTypingOn(from);

  // Check if we're waiting for a PIN confirmation
  if (session.awaitingPin) {
    await handlePinConfirmation({ from, pin: text, session });
    return;
  }

  // Check if we're waiting for a transfer confirmation (yes/no)
  if (session.pendingTransfer) {
    const lower = text.toLowerCase();
    if (['yes', 'y', 'confirm', 'send it', 'proceed', 'ok', 'go ahead'].some(w => lower.includes(w))) {
      await initiateTransfer({ from, session });
    } else if (['no', 'n', 'cancel', 'stop', 'abort'].some(w => lower.includes(w))) {
      await sessionStore.clearPendingTransfer(from);
      await whatsappService.sendText(from, "Transfer cancelled. No money has been moved. Is there anything else I can help you with?");
    } else {
      await whatsappService.sendText(from,
        `Just to confirm — do you want to send *£${session.pendingTransfer.amount}* to *${session.pendingTransfer.recipientName}*?\n\nReply *Yes* to confirm or *No* to cancel.`
      );
    }
    return;
  }

  // Let Claude interpret the message
  const aiResponse = await claudeService.processMessage({
    userMessage: text,
    contactName,
    session,
    from,
  });

  await handleAIResponse({ from, aiResponse, session, text });
}

// ─── AUDIO / VOICE NOTES ──────────────────────────────
async function handleAudio({ from, contactName, message, session }) {
  await whatsappService.sendText(from,
    "🎤 I heard your voice note! Voice processing is coming soon. For now, please type your request and I'll handle it instantly. 💬"
  );
  // TODO: integrate Whisper API here for transcription
  // const transcript = await transcribeAudio(message.audio.id);
  // then pass transcript to handleText
}

// ─── INTERACTIVE REPLIES (buttons/lists) ──────────────
async function handleInteractive({ from, contactName, message, session }) {
  const reply = message.interactive;
  const buttonId = reply?.button_reply?.id || reply?.list_reply?.id;
  const buttonTitle = reply?.button_reply?.title || reply?.list_reply?.title;

  logger.info(`Interactive reply from ${from}: id=${buttonId}, title=${buttonTitle}`);

  // Map button IDs to actions
  switch (buttonId) {
    case 'confirm_transfer':
      await initiateTransfer({ from, session });
      break;

    case 'cancel_transfer':
      await sessionStore.clearPendingTransfer(from);
      await whatsappService.sendText(from, "Transfer cancelled ✅. Your money is safe. Anything else?");
      break;

    case 'check_balance':
      await handleText({ from, contactName, message: { text: { body: 'What is my balance?' } }, session });
      break;

    default:
      // Treat button title as a text message
      if (buttonTitle) {
        await handleText({ from, contactName, message: { text: { body: buttonTitle } }, session });
      }
  }
}

// ─── PIN CONFIRMATION FLOW ────────────────────────────
async function handlePinConfirmation({ from, pin, session }) {
  const storedHash = session.userPin;

  const isValid = await verifyPin(pin, storedHash);

  if (!isValid) {
    const attempts = (session.pinAttempts || 0) + 1;
    await sessionStore.update(from, { pinAttempts: attempts });

    if (attempts >= 3) {
      await sessionStore.update(from, { awaitingPin: false, pinAttempts: 0, pendingTransfer: null });
      await whatsappService.sendText(from,
        "❌ Too many incorrect PIN attempts. Transfer has been cancelled for your security. Please try again later or contact support."
      );
      return;
    }

    await whatsappService.sendText(from, `❌ Incorrect PIN. ${3 - attempts} attempt(s) remaining. Please try again:`);
    return;
  }

  // PIN correct — proceed with transfer
  await sessionStore.update(from, { awaitingPin: false, pinAttempts: 0 });
  await executeTransfer({ from, session });
}

// ─── TRANSFER FLOW ────────────────────────────────────
async function initiateTransfer({ from, session }) {
  const transfer = session.pendingTransfer;
  if (!transfer) {
    await whatsappService.sendText(from, "I don't have a pending transfer. Please start again.");
    return;
  }

  const country = detectCountry(from, session);
  const symbol = country.symbol;

  await sessionStore.update(from, { awaitingPin: true });
  await whatsappService.sendText(from,
    `🔐 *Security Check*\n\nPlease enter your 4-digit Zeno PIN to authorise this transfer of *${symbol}${transfer.amount.toLocaleString()}* to *${transfer.recipientName}*.\n\n_Never share your PIN with anyone, including Zeno support._`
  );
}

async function executeTransfer({ from, session }) {
  const transfer = session.pendingTransfer;
  const country = detectCountry(from, session);
  const symbol = country.symbol;

  await whatsappService.sendText(from, "⏳ Processing your transfer...");

  try {
    let result;

    if (country.code === 'NG') {
      // Nigerian transfer via Flutterwave
      const bankInfo = transfer.bankCode ? { code: transfer.bankCode } : findBankCode(transfer.bankName);
      if (!bankInfo) {
        await sessionStore.clearPendingTransfer(from);
        await whatsappService.sendText(from,
          `❌ I couldn't identify the bank. Please specify the bank name clearly, e.g. "GTBank", "Access Bank", "Zenith".`
        );
        return;
      }
      result = await flutterwave.sendPayment({
        recipientName: transfer.recipientName,
        recipientAccountNumber: transfer.accountNumber,
        recipientBankCode: bankInfo.code,
        amount: transfer.amount,
        reference: transfer.reference,
        narration: transfer.reference || 'Zeno Transfer',
      });
    } else {
      // UK transfer via Modulr
      result = await transferService.sendPayment({
        fromUser: from,
        recipientName: transfer.recipientName,
        recipientSortCode: transfer.sortCode,
        recipientAccountNumber: transfer.accountNumber,
        amount: transfer.amount,
        reference: transfer.reference,
        currency: 'GBP',
      });
    }

    await sessionStore.clearPendingTransfer(from);

    await whatsappService.sendText(from,
      `✅ *Transfer Successful!*\n\n` +
      `• Amount: *${symbol}${transfer.amount.toLocaleString()}*\n` +
      `• To: *${transfer.recipientName}*\n` +
      `• Reference: ${transfer.reference}\n` +
      `• Transaction ID: ${result.transactionId}\n\n` +
      `_Need anything else? Just ask!_`
    );

  } catch (err) {
    logger.error('Transfer failed:', err);
    await sessionStore.clearPendingTransfer(from);
    await whatsappService.sendText(from,
      `❌ *Transfer Failed*\n\n${err.userMessage || 'The transfer could not be completed. No money has left your account.'}\n\nPlease try again or contact support.`
    );
  }
}

// ─── AI RESPONSE ROUTER ───────────────────────────────
async function handleAIResponse({ from, aiResponse, session, text }) {
  switch (aiResponse.intent) {

    case 'TRANSFER': {
      // Claude extracted transfer details — confirm with user
      const t = aiResponse.transferDetails;
      await sessionStore.update(from, { pendingTransfer: t });

      const msg =
        `💸 *Transfer Summary*\n\n` +
        `• Amount: *£${t.amount}*\n` +
        `• To: *${t.recipientName}*\n` +
        (t.sortCode ? `• Sort Code: ${t.sortCode}\n` : '') +
        (t.accountNumber ? `• Account: ${t.accountNumber}\n` : '') +
        `• Reference: ${t.reference || 'Zeno Transfer'}\n\n` +
        `*Shall I go ahead?* Reply *Yes* to confirm or *No* to cancel.`;

      await whatsappService.sendConfirmationButtons(from, msg, [
        { id: 'confirm_transfer', title: '✅ Confirm' },
        { id: 'cancel_transfer', title: '❌ Cancel' },
      ]);
      break;
    }

    case 'BALANCE': {
      const bankConnected = banking.isBankConnected(session, from);
      if (bankConnected) {
        const result = await banking.getBalance(from, session);
        if (result.success) {
          await whatsappService.sendText(from, banking.formatBalanceMessage(result.balances, from, session));
          break;
        }
      }
      const authLink = banking.generateAuthLink(from, session);
      await whatsappService.sendText(from,
        `💰 To show your real balance, connect your bank first!\n\n` +
        `Tap the link below — it's secure and takes 30 seconds:\n\n` +
        `${authLink}\n\n` +
        `_Read-only access. No card details needed._`
      );
      break;
    }

    case 'TRANSACTIONS': {
      const bankConnected = banking.isBankConnected(session, from);
      if (bankConnected) {
        const result = await banking.getTransactions(from, session);
        if (result.success) {
          await whatsappService.sendText(from, banking.formatTransactionsMessage(result.transactions, from, session));
          break;
        }
      }
      const authLink = banking.generateAuthLink(from, session);
      await whatsappService.sendText(from,
        `📋 Connect your bank to see real transactions!\n\n${authLink}`
      );
      break;
    }

    case 'HELP':
      await whatsappService.sendText(from, aiResponse.reply);
      break;

    case 'GREETING':
      await whatsappService.sendText(from, aiResponse.reply);
      break;

    case 'KYC': {
      // Send iDenfy verification link
      if (session.kycVerified) {
        await whatsappService.sendText(from,
          `✅ *You're already verified!*\n\nYour identity has been confirmed. You have full access to all Zeno features.`
        );
        break;
      }
      try {
        const kycService = require('../services/idenfy');
        const nameParts = (session.userName || 'User').split(' ');
        const kycSession = await kycService.createSession({
          phoneNumber: from,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || '',
        });
        await sessionStore.update(from, { kycSessionId: kycSession.sessionId });
        await whatsappService.sendText(from,
          `🔐 *Verify Your Identity*\n\n` +
          `Tap the link below to complete verification:\n\n` +
          `${kycSession.sessionUrl}\n\n` +
          `_Takes less than 2 minutes. Fully encrypted and secure._`
        );
      } catch (err) {
        logger.error('KYC session error:', err.message);
        await whatsappService.sendText(from,
          `⚠️ Couldn't generate verification link. Please try again in a moment.`
        );
      }
      break;
    }

    case 'CONNECT_BANK': {
      const authLink = banking.generateAuthLink(from, session);
      await whatsappService.sendText(from,
        `🏦 *Connect Your Bank*\n\n` +
        `Tap the link below to securely connect your bank account:\n\n` +
        `${authLink}\n\n` +
        `_Read-only access. No card details needed. Takes 30 seconds._`
      );
      break;
    }

    case 'UNCLEAR':
      await whatsappService.sendText(from, aiResponse.reply);
      break;

    default:
      await whatsappService.sendText(from, aiResponse.reply);
  }
}

module.exports = { handle };
