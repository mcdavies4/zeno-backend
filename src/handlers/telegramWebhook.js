/**
 * Telegram Webhook Handler
 */

const express = require('express');
const router = express.Router();
const telegramService = require('../services/telegram');
const claudeService = require('../services/claude');
const sessionStore = require('../services/sessionStore');
const transferService = require('../services/transfer');
const { checkAndHandleOnboarding } = require('../services/onboarding');
const { verifyPin } = require('../utils/pinUtils');
const banking = require('../services/banking');
const insights = require('../services/insights');
const bills = require('../services/bills');
const feesService = require('../services/fees');
const security = require('../services/security');
const virtualAccount = require('../services/virtualAccount');
const receipts = require('../services/receipts');
const searchService = require('../services/search');
const statementsService = require('../services/statements');
const emailService = require('../services/email');
const logger = require('../utils/logger');

router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

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
    logger.error('Telegram webhook error:', err.message, err.stack);
  }
});

async function handleTextMessage({ chatId, text, contactName }) {
  try {
    const session = await sessionStore.get(chatId);
    logger.info(`Telegram session for ${chatId}: onboarded=${session.isOnboarded}, kyc=${session.kycVerified}`);

    await telegramService.sendTyping(chatId);

    // Check onboarding
    const onboardingHandled = await checkAndHandleOnboarding(chatId, session, text);
    logger.info(`Telegram onboarding handled: ${onboardingHandled}`);
    if (onboardingHandled) return;

    // Awaiting PIN
    if (session.awaitingPin) {
      // Check if locked
      const lockStatus = security.checkPinLock(session);
      if (lockStatus.locked) {
        await telegramService.sendText(chatId,
          `🔒 *Account Temporarily Locked*

Too many incorrect PIN attempts. Unlocks in *${lockStatus.hoursLeft} hour(s)*.

Contact support: https://wa.me/2349037745486`
        );
        return;
      }
      await handlePinConfirmation({ chatId, pin: text, session });
      return;
    }

    // Awaiting transfer confirmation
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

    const lowerText = text.toLowerCase();

    // ── Switch country command ────────────────────────
    if (['switch country', 'change country', 'switch bank', 'change bank country',
         'switch to nigeria', 'switch to uk', 'nigerian account', 'uk account',
         'nigeria account', 'change location', 'my nigerian bank', 'my uk bank',
         'change my country', 'switch my bank'].some(k => lowerText.includes(k))) {
      await handleTelegramSwitchCountry({ chatId, session, text: lowerText });
      return;
    }

    // ── Awaiting country switch response ──────────────
    if (session.awaitingField === 'country_switch') {
      if (lowerText === '1' || lowerText.includes('uk') || lowerText.includes('united kingdom') || lowerText.includes('britain') || lowerText.includes('england')) {
        await telegramSwitchToCountry(chatId, session, 'UK');
      } else if (lowerText === '2' || lowerText.includes('nigeria') || lowerText.includes('naija')) {
        await telegramSwitchToCountry(chatId, session, 'NG');
      } else {
        await telegramService.sendText(chatId, `Please reply with *1* for 🇬🇧 UK or *2* for 🇳🇬 Nigeria.`);
      }
      return;
    }


    // ── Email CSV ────────────────────────────────────
    if (lowerText.includes('email my csv') || lowerText.includes('email csv') || lowerText.includes('send csv') || lowerText.includes('send my csv')) {
      await handleTelegramEmailCSV({ chatId, session });
      return;
    }

    // ── Statements / Reports / CSV ───────────────────
    if (['statement', 'bank statement', 'download statement', 'spending report', 'monthly report', 'export csv', 'export transactions', 'csv', 'transaction history', 'account statement'].some(k => lowerText.includes(k))) {
      await handleStatement({ id: chatId, session, text: lowerText, sendFn: telegramService.sendText.bind(telegramService), platform: 'telegram' });
      return;
    }

    // ── Receipts ─────────────────────────────────────
    if (['receipt', 'last receipt', 'my receipts', 'show receipt'].some(k => lowerText.includes(k))) {
      const last = receipts.getLastReceipt(session);
      await telegramService.sendText(chatId, last ? last.text : `No receipts yet. Receipts are generated after every transfer.`);
      return;
    }

    // ── Support ──────────────────────────────────────
    if (['support', 'help', 'contact', 'agent', 'human', 'complaint', 'problem', 'issue', 'speak to', 'talk to', 'call us', 'phone number', 'contact us', 'customer service', 'customer care'].some(k => lowerText.includes(k))) {
      await handleSupport({ id: chatId, session, sendFn: telegramService.sendText.bind(telegramService) });
      return;
    }

    // ── Transaction search ────────────────────────────
  if (['find', 'search', 'show all', 'show transactions', 'all payments'].some(k => lowerText.includes(k)) && !lowerText.includes('balance') && !lowerText.includes('connect')) {
      await handleTelegramSearch({ chatId, session, text: lowerText });
    return;
    }

    // ── Exchange rate ─────────────────────────────────
  if (['exchange rate', 'exchange', 'convert', 'how much is', 'naira to', 'pounds to', 'dollar to', 'rate today'].some(k => lowerText.includes(k))) {
      await handleTelegramExchange({ chatId, session, text: lowerText });
    return;
    }
    // ── Airtime & Bills (Nigeria only) ───────────────
    if (session.bankingCountry === 'NG' && ['airtime', 'recharge', 'top up', 'topup', 'buy data', 'data bundle', 'electricity', 'nepa', 'disco', 'dstv', 'gotv', 'cable tv', 'pay bill'].some(k => lowerText.includes(k))) {
      await handleTelegramBillPayment({ chatId, session, text: lowerText });
      return;
    }

    // ── Spending analysis ────────────────────────────
    if (['spending', 'analyse', 'analysis', 'breakdown', 'categories', 'where is my money', 'how much did i spend', 'spending report'].some(k => lowerText.includes(k))) {
      await handleTelegramSpendingAnalysis({ chatId, session });
      return;
    }

    // ── Alerts ────────────────────────────────────────
    if (['set alert', 'alert me', 'notify me', 'warn me', 'low balance alert', 'transaction alert', 'my alerts', 'show alerts', 'list alerts'].some(k => lowerText.includes(k))) {
      await handleTelegramAlerts({ chatId, session, text: lowerText });
      return;
    }

    // ── Beneficiaries ─────────────────────────────────
    if (['save contact', 'save beneficiary', 'remember', 'saved contacts', 'my contacts', 'list contacts', 'show contacts', 'saved recipients'].some(k => lowerText.includes(k))) {
      await handleTelegramBeneficiaries({ chatId, session, text: lowerText });
      return;
    }

    // ── KYC keywords ──────────────────────────────────
    // ── Statements, CSV Export ───────────────────────
    if (['statement', 'bank statement', 'download statement', 'export', 'csv', 'spending report', 'my statement', 'transaction history', 'download transactions'].some(k => lowerText.includes(k))) {
      await handleStatement({ id: chatId, session, text: lowerText, sendFn: telegramService.sendText.bind(telegramService), platform: 'telegram' });
      return;
    }

    // ── Wallet / Virtual Account ─────────────────────
    if (session.bankingCountry === 'NG' && ['my account', 'my wallet', 'wallet balance', 'fund wallet', 'top up', 'topup', 'account number', 'zeno account', 'add money'].some(k => lowerText.includes(k))) {
      if (!session.virtualAccount) {
        await telegramService.sendText(chatId, `⏳ Setting up your Zeno wallet...`);
        try {
          const vaData = await virtualAccount.createVirtualAccount({ phoneNumber: chatId, name: session.name, email: session.email });
          await sessionStore.update(chatId, { virtualAccount: vaData, walletBalance: 0 });
          session.virtualAccount = vaData;
        } catch(e) {
          await telegramService.sendText(chatId, `Sorry, couldn't set up your wallet right now. Please try again.`);
          return;
        }
      }
      await telegramService.sendText(chatId, virtualAccount.formatWalletMessage(session));
      return;
    }

    if (['kyc', 'verify', 'verify my identity', 'verification', 'verify identity', 'complete kyc'].some(k => lowerText.includes(k))) {
      if (session.kycVerified) {
        await telegramService.sendText(chatId, `✅ *You're already verified!*

Your identity has been confirmed. You have full access to all Zeno features.`);
      } else {
        try {
          const kycService = require('../services/veriff');
          const nameParts = (session.userName || 'User').split(' ');
          const kycSession = await veriffService.createSession({
            phoneNumber: chatId,
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' ') || '',
          });
          await sessionStore.update(chatId, { kycSessionId: kycSession.sessionId });
          await telegramService.sendText(chatId,
            `🔐 *Verify Your Identity*

` +
            `Tap the link below:

${kycSession.sessionUrl}

` +
            `Takes less than 2 minutes. Fully encrypted and secure.`
          );
        } catch (err) {
          logger.error('KYC session error:', err.message);
          await telegramService.sendText(chatId, `⚠️ Couldn't generate verification link. Please try again.`);
        }
      }
      return;
    }

    // Process with Claude AI
    logger.info(`Sending to Claude AI for ${chatId}`);
    const aiResponse = await claudeService.processMessage({
      userMessage: text,
      contactName,
      session,
      from: chatId,
    });
    logger.info(`Claude response intent: ${aiResponse.intent}`);

    await handleAIResponse({ chatId, aiResponse, session });

  } catch (err) {
    logger.error(`Telegram handleTextMessage error for ${chatId}:`, err.message);
    await telegramService.sendText(chatId, "Sorry, something went wrong! Please try again. 😅").catch(() => {});
  }
}

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

async function handlePinConfirmation({ chatId, pin, session }) {
  const storedHash = session.userPin;
  const isValid = await verifyPin(pin, storedHash);

  if (!isValid) {
    const { update: pinUpdate, attempts, locked } = security.recordFailedPin(session);
    await sessionStore.update(chatId, pinUpdate);
    if (locked) {
      await sessionStore.update(chatId, { awaitingPin: false, pendingTransfer: null, pendingBill: null });
      await telegramService.sendText(chatId,
        `🔒 *Account Locked*\n\nToo many incorrect PIN attempts. Your account is locked for *24 hours*.\n\nContact support: https://wa.me/2349037745486`
      );
      return;
    }
    await telegramService.sendText(chatId, `❌ Incorrect PIN. ${3 - attempts} attempt(s) remaining:`);
    return;
  }

  await sessionStore.update(chatId, { awaitingPin: false, pinAttempts: 0, ...security.clearFailedPin() });
  await executeTransfer({ chatId, session });
}

async function initiateTransfer({ chatId, session }) {
  const transfer = session.pendingTransfer;
  if (!transfer) {
    await telegramService.sendText(chatId, "No pending transfer. Please start again.");
    return;
  }
  await sessionStore.update(chatId, { awaitingPin: true });
  await telegramService.sendText(chatId,
    (() => {
      const { detectCountry } = require('../utils/countryDetect');
      const country = detectCountry(chatId, session);
      const fee = transfer.fee || feesService.calculateFee(transfer.amount, country.code);
      const s = fee.symbol;
      const total = (Number(transfer.amount) + fee.totalFee).toLocaleString('en', { minimumFractionDigits: 2 });
      return `🔐 *Security Check*\n\nEnter your PIN to authorise:\n• *${s}${Number(transfer.amount).toLocaleString('en', { minimumFractionDigits: 2 })}* to *${transfer.recipientName}*\n• Fee: *${s}${fee.totalFee.toFixed(2)}*\n• Total: *${s}${total}*\n\nNever share your PIN with anyone.`;
    })()
  );
}

async function executeTransfer({ chatId, session }) {
  const transfer = session.pendingTransfer;
  const { detectCountry } = require('../utils/countryDetect');
  const country = detectCountry(chatId, session);
  const fee = transfer.fee || feesService.calculateFee(transfer.amount, country.code);
  const s = fee.symbol;

  // Wallet balance check for Nigerian transfers
  if (country.code === 'NG') {
    const affordCheck = virtualAccount.canAffordTransfer(session, transfer.amount, fee);
    if (!affordCheck.canAfford) {
      await sessionStore.clearPendingTransfer(chatId);
      await telegramService.sendText(chatId, affordCheck.message);
      return;
    }
  }

  // Duplicate detection
  if (security.isDuplicate(session, transfer)) {
    await sessionStore.clearPendingTransfer(chatId);
    await telegramService.sendText(chatId,
      `⚠️ *Duplicate Transfer Detected*

This looks identical to a recent transfer. Cancelled for your protection. Try again in 1 minute.`
    );
    return;
  }

  // Daily limit check
  const limitCheck = security.checkTransferLimit(transfer.amount, session, country.code);
  if (!limitCheck.allowed) {
    await sessionStore.clearPendingTransfer(chatId);
    await telegramService.sendText(chatId, `⚠️ *Transfer Limit Exceeded*

${limitCheck.reason}`);
    return;
  }

  await telegramService.sendText(chatId, "⏳ Processing your transfer...");

  try {
    let result;

    if (country.code === 'NG') {
      const { findBankCode } = require('../utils/nigerianBanks');
      const bankInfo = transfer.bankCode ? { code: transfer.bankCode } : findBankCode(transfer.bankName);
      if (!bankInfo) {
        await sessionStore.clearPendingTransfer(chatId);
        await telegramService.sendText(chatId, `❌ Couldn't identify the bank. Please specify clearly e.g. "GTBank", "Access Bank".`);
        return;
      }
      const flutterwaveService = require('../services/flutterwave');
      result = await flutterwaveService.sendPayment({
        recipientName: transfer.recipientName,
        recipientAccountNumber: transfer.accountNumber,
        recipientBankCode: bankInfo.code,
        amount: transfer.amount,
        reference: transfer.reference,
        narration: transfer.reference || 'Zeno Transfer',
      });
    } else {
      result = await transferService.sendPayment({
        fromUser: chatId,
        recipientName: transfer.recipientName,
        recipientSortCode: transfer.sortCode,
        recipientAccountNumber: transfer.accountNumber,
        amount: transfer.amount,
        reference: transfer.reference,
        currency: 'GBP',
      });
    }

    await sessionStore.clearPendingTransfer(chatId);

    // Debit wallet for Nigerian transfers
    if (country.code === 'NG') {
      const walletUpdate = virtualAccount.debitWallet(session, transfer.amount, fee);
      await sessionStore.update(chatId, walletUpdate);
    }

    // Generate and store receipt
    const updatedSession = await sessionStore.get(chatId);
    const receiptData = receipts.generateReceipt({
      transfer, result, fee,
      countryCode: country.code,
      userName: updatedSession.name,
    });
    const receiptUpdate = receipts.storeReceipt(updatedSession, receiptData);
    const dailyUpdate = security.recordLastTransfer(transfer);
    const spentUpdate = security.recordTransfer(updatedSession, transfer.amount, country.code);
    await sessionStore.update(chatId, { ...receiptUpdate, ...dailyUpdate, ...spentUpdate });

    await telegramService.sendText(chatId, receiptData.text);

    // Auto-save beneficiary
    const existing = insights.getBeneficiary(updatedSession, transfer.recipientName);
    if (!existing && (transfer.accountNumber || transfer.sortCode || transfer.bankCode)) {
      const beneficiaries = insights.saveBeneficiary(updatedSession, transfer.recipientName, {
        accountNumber: transfer.accountNumber,
        sortCode: transfer.sortCode,
        bankCode: transfer.bankCode,
        bankName: transfer.bankName,
      });
      await sessionStore.update(chatId, { beneficiaries });
      await telegramService.sendText(chatId,
        `💾 *${transfer.recipientName}* saved to contacts! Next time just say "Send to ${transfer.recipientName}".`
      );
    }

  } catch (err) {
    logger.error('Telegram transfer error:', err.message);
    await sessionStore.clearPendingTransfer(chatId);
    await telegramService.sendText(chatId, `❌ Transfer failed. ${err.userMessage || 'Please try again.'}`);
  }
}

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
        `• Reference: ${t.reference || 'Zeno Transfer'}\n\n*Shall I go ahead?*`;
      await telegramService.sendConfirmationButtons(chatId, msg, [
        { id: 'confirm_transfer', title: '✅ Confirm' },
        { id: 'cancel_transfer', title: '❌ Cancel' },
      ]);
      break;
    }
    case 'BALANCE': {
      if (banking.isBankConnected(session, chatId)) {
        const result = await banking.getBalance(chatId, session);
        if (result.success) {
          await telegramService.sendText(chatId, banking.formatBalanceMessage(result.balances, chatId, session));
        } else {
          await telegramService.sendText(chatId, `⚠️ Couldn't fetch your balance right now. Please try again in a moment.`);
        }
        break;
      }
      try {
        const authLink = await banking.generateAuthLink(chatId, session);
        await telegramService.sendText(chatId,
          `💰 *Connect Your Bank*\n\nTap the link below to see your real balance:\n\n${authLink}\n\nRead-only. No card details needed.`
        );
      } catch(err) {
        await telegramService.sendText(chatId, `⚠️ Bank connection not available right now. Please try again later.`);
      }
      break;
    }
    case 'TRANSACTIONS': {
      if (banking.isBankConnected(session, chatId)) {
        const result = await banking.getTransactions(chatId, session);
        if (result.success) {
          await telegramService.sendText(chatId, banking.formatTransactionsMessage(result.transactions, chatId, session));
        } else {
          await telegramService.sendText(chatId, `⚠️ Couldn't fetch transactions right now. Please try again in a moment.`);
        }
        break;
      }
      try {
        const authLink = await banking.generateAuthLink(chatId, session);
        await telegramService.sendText(chatId, `📋 *Connect Your Bank*\n\nTap the link below to see your transactions:\n\n${authLink}\n\nRead-only. No card details needed.`);
      } catch(err) {
        await telegramService.sendText(chatId, `⚠️ Bank connection not available right now. Please try again later.`);
      }
      break;
    }
    case 'KYC': {
      if (session.kycVerified) {
        await telegramService.sendText(chatId,
          `✅ *You're already verified!*\n\nYour identity has been confirmed.`
        );
        break;
      }
      try {
        const veriffService = require('../services/veriff');
        const nameParts = (session.name || session.userName || 'Zeno User').split(' ');
        const kycSession = await veriffService.createSession({
          phoneNumber: chatId,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || '',
        });
        await sessionStore.update(chatId, { kycSessionId: kycSession.sessionId });
        await telegramService.sendText(chatId,
          `🔐 *Verify Your Identity*\n\n` +
          `🔐 *Verify Your Identity*\n\nTap the link below:\n\n${kycSession.sessionUrl}\n\n` +
          `Takes less than 2 minutes. Fully encrypted and secure.`
        );
      } catch (err) {
        await telegramService.sendText(chatId,
          `⚠️ Couldn't generate verification link. Please try again.`
        );
      }
      break;
    }

    case 'CONNECT_BANK': {
      try {
        const authLink = await banking.generateAuthLink(chatId, session);
        await telegramService.sendText(chatId,
          `🏦 *Connect Your Bank*\n\nTap the link below to connect your bank:\n\n${authLink}\n\nRead-only access. No card details needed.`
        );
      } catch(err) {
        await telegramService.sendText(chatId, `⚠️ Bank connection not available right now. Please try again later.`);
      }
      break;
    }

    default:
      await telegramService.sendText(chatId, aiResponse.reply);
  }
}


// ─── SUPPORT HANDLER ─────────────────────────────────
async function handleSupport({ id, session, sendFn }) {
  const { detectCountry } = require('../utils/countryDetect');
  const country = detectCountry(id, session);

  if (country.code === 'NG') {
    await sendFn(id,
      `🙋 *Need Help?*

` +
      `Our Nigeria support team is ready to assist you.

` +
      `📱 *WhatsApp:* https://wa.me/2349037745486
` +
      `📞 *Call/Text:* +234 903 774 5486

` +
      `Tap the link above to start a chat — we typically reply within a few minutes.`
    );
  } else {
    await sendFn(id,
      `🙋 *Need Help?*

` +
      `Our UK support team is ready to assist you.

` +
      `📱 *WhatsApp:* https://wa.me/447883305130
` +
      `📞 *Call/Text:* +44 7883 305130

` +
      `Tap the link above to start a chat — we typically reply within a few minutes.`
    );
  }
}


// ─── STATEMENT / REPORT / CSV ─────────────────────────
async function handleStatement({ id, session, text, sendFn, platform }) {
  const statementsService = require('../services/statements');
const emailService = require('../services/email');
  const country = detectCountry(id, session);
  const symbol = country.symbol;

  if (!banking.isBankConnected(session, id)) {
    await sendFn(id, `Connect your bank first to download statements!

Say *"connect my bank"* to get started.`);
    return;
  }

  const req = statementsService.parseStatementRequest(text);

  // CSV export — works from cached transactions
  if (req.type === 'csv') {
    await sendFn(id, `⏳ Generating your CSV export...`);
    try {
      const result = await banking.getTransactions(id, session);
      if (!result.success || !result.transactions?.length) {
        await sendFn(id, `No transactions found to export.`);
        return;
      }
      const csv = statementsService.generateCSV(result.transactions, symbol);
      const lineCount = result.transactions.length;
      await sendFn(id,
        `📋 *CSV Export Ready*

` +
        `${lineCount} transactions exported.

` +
        `Your CSV data:
\`\`\`
${csv.split('\n').slice(0, 6).join('\n')}
...\`\`\`

` +
        `Reply *"email my CSV"* and we'll send the full file to your registered email.`
      );
    } catch(err) {
      logger.error('CSV export error:', err.message);
      await sendFn(id, `Sorry, couldn't generate CSV right now. Please try again.`);
    }
    return;
  }

  // Spending Report — works from cached transactions
  if (req.type === 'report') {
    await sendFn(id, `⏳ Generating your spending report...`);
    try {
      const result = await banking.getTransactions(id, session);
      if (!result.success || !result.transactions?.length) {
        await sendFn(id, `No transactions found to generate report.`);
        return;
      }
      const report = statementsService.generateSpendingReport(result.transactions, session);
      await sendFn(id, report);
    } catch(err) {
      logger.error('Report error:', err.message);
      await sendFn(id, `Sorry, couldn't generate report right now. Please try again.`);
    }
    return;
  }

  // PDF Statement — Nigeria via Mono, UK via transaction data
  if (req.type === 'pdf') {
    await sendFn(id, `⏳ Requesting your bank statement (${req.periodLabel})...`);
    try {
      if (country.code === 'NG' && session.monoAccountId) {
        // Request PDF from Mono
        const stmtReq = await statementsService.requestMonoStatement(session.monoAccountId, req.period);

        if (stmtReq.pdfUrl) {
          await sendFn(id,
            `📄 *Bank Statement Ready*

` +
            `Your ${req.periodLabel} bank statement:

` +
            `${stmtReq.pdfUrl}

` +
            `This link expires in 7 days.`
          );
        } else if (stmtReq.jobId) {
          // Poll for up to 30 seconds
          await sendFn(id, `Statement is being generated, please wait...`);
          let pdfUrl = null;
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const poll = await statementsService.pollMonoStatement(session.monoAccountId, stmtReq.jobId);
            if (poll.pdfUrl) { pdfUrl = poll.pdfUrl; break; }
          }
          if (pdfUrl) {
            await sendFn(id,
              `📄 *Bank Statement Ready*

` +
              `Your ${req.periodLabel} bank statement:

` +
              `${pdfUrl}

` +
              `This link expires in 7 days.`
            );
          } else {
            await sendFn(id, `⏳ Your statement is still being generated. Try again in a minute.`);
          }
        }
      } else {
        // UK or no Mono — generate from transaction data
        const result = await banking.getTransactions(id, session);
        if (!result.success || !result.transactions?.length) {
          await sendFn(id, `No transactions found for your statement.`);
          return;
        }
        const report = statementsService.generateSpendingReport(result.transactions, session, req.periodLabel);
        await sendFn(id, report);
        await sendFn(id,
          `Full PDF statements are coming soon for UK accounts!

` +
          `In the meantime, say *"spending report"* for a detailed breakdown or *"export CSV"* to download your transactions.`
        );
      }
    } catch(err) {
      logger.error('Statement error:', err.message);
      await sendFn(id, `Sorry, couldn't generate your statement right now. Please try again.`);
    }
  }
}

// ─── EMAIL CSV (TELEGRAM) ────────────────────────────
async function handleTelegramEmailCSV({ chatId, session }) {
  const email = session.email;
  if (!email) {
    await telegramService.sendText(chatId, `No email address on file. Please contact support.`);
    return;
  }
  if (!banking.isBankConnected(session, chatId)) {
    await telegramService.sendText(chatId, `Connect your bank first before exporting transactions.`);
    return;
  }
  await telegramService.sendText(chatId, `⏳ Generating your CSV and sending to *${email}*...`);
  try {
    const { detectCountry } = require('../utils/countryDetect');
    const country = detectCountry(chatId, session);
    const result = await banking.getTransactions(chatId, session);
    if (!result.success || !result.transactions?.length) {
      await telegramService.sendText(chatId, `No transactions found to export.`);
      return;
    }
    const csv = statementsService.generateCSV(result.transactions, country.symbol);
    const now = new Date();
    const filename = `Zeno-Transactions-${(session.name || 'User').replace(/\s+/g, '-')}-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}.csv`;
    await emailService.sendCSV({
      toEmail: email,
      toName: session.name || 'Zeno User',
      csvData: csv,
      filename,
      transactionCount: result.transactions.length,
      symbol: country.symbol,
      period: 'Recent transactions',
    });
    await telegramService.sendText(chatId,
      `✅ *CSV Sent!*

` +
      `Emailed to *${email}*
• ${result.transactions.length} transactions

Check your inbox!`
    );
  } catch(err) {
    logger.error('Telegram email CSV error:', err.message);
    await telegramService.sendText(chatId, `Sorry, couldn't send the email right now. Please try again.`);
  }
}

// ─── TRANSACTION SEARCH (TELEGRAM) ───────────────────
async function handleTelegramSearch({ chatId, session, text }) {
  const { detectCountry } = require('../utils/countryDetect');
  const country = detectCountry(chatId, session);

  if (!banking.isBankConnected(session, chatId)) {
    await telegramService.sendText(chatId, `Connect your bank first to search transactions!`);
    return;
  }

  await telegramService.sendText(chatId, `🔍 Searching transactions...`);

  try {
    const result = await banking.getTransactions(chatId, session);
    if (!result.success || !result.transactions?.length) {
      await telegramService.sendText(chatId, `No transactions found.`);
      return;
    }

    const results = searchService.searchTransactions(result.transactions, text);
    const msg = searchService.formatSearchResults(results, country.symbol, text);
    await telegramService.sendText(chatId, msg);
  } catch(err) {
    logger.error('Telegram search error:', err.message);
    await telegramService.sendText(chatId, `Couldn't search transactions right now.`);
  }
}

// ─── EXCHANGE RATE (TELEGRAM) ─────────────────────────
async function handleTelegramExchange({ chatId, session, text }) {
  const parsed = searchService.parseExchangeQuery(text);
  if (!parsed) {
    await telegramService.sendText(chatId,
      `💱 Try:
• "What's £1 in naira?"
• "Convert $500 to pounds"
• "Exchange rate today"`
    );
    return;
  }

  try {
    const { rate, from: f, to: t } = await searchService.getExchangeRate(parsed.from, parsed.to);
    const converted = (parsed.amount * rate).toLocaleString('en', { maximumFractionDigits: 2 });
    const symbols = { GBP: '£', NGN: '₦', USD: '$', EUR: '€' };

    await telegramService.sendText(chatId,
      `💱 *Exchange Rate*

` +
      `${symbols[f] || f}1 = *${symbols[t] || t}${rate.toLocaleString('en', { maximumFractionDigits: 2 })}*

` +
      (parsed.amount > 1 ? `${symbols[f] || f}${parsed.amount.toLocaleString()} = *${symbols[t] || t}${converted}*

` : '') +
      `Live rate · ${new Date().toLocaleDateString('en-GB')}_`
    );
  } catch(err) {
    await telegramService.sendText(chatId, `Couldn't fetch exchange rate right now.`);
  }
}


// ─── BILL PAYMENT (TELEGRAM) ─────────────────────────
async function handleTelegramBillPayment({ chatId, session, text }) {
  const parsed = bills.parseBillCommand(text);

  if (!parsed) {
    await telegramService.sendText(chatId,
      `📱 *Bills & Airtime*

` +
      `I can help with:
` +
      `• *Airtime:* "Buy ₦500 airtime for 08012345678"
` +
      `• *Electricity:* "Pay Ikeja Electric ₦5000 meter 12345678"
` +
      `• *DSTV:* "Pay DSTV ₦6500 smartcard 1234567890"
` +
      `• *Data:* "Buy MTN data 1000 for 08012345678"`
    );
    return;
  }

  await sessionStore.update(chatId, { pendingBill: parsed, awaitingPin: true });

  let summary = '';
  if (parsed.type === 'airtime') {
    summary = `₦${parsed.amount.toLocaleString()} airtime for *${parsed.phone}* (${parsed.network.toUpperCase()})`;
  } else if (parsed.type === 'electricity') {
    summary = `₦${parsed.amount.toLocaleString()} electricity (${parsed.disco.toUpperCase()}) meter *${parsed.meterNumber}*`;
  } else if (parsed.type === 'tv') {
    summary = `₦${parsed.amount.toLocaleString()} ${parsed.provider.toUpperCase()} card *${parsed.smartCardNumber}*`;
  }

  await telegramService.sendText(chatId,
    `📋 *Bill Payment Summary*

${summary}

🔐 Enter your PIN to confirm:`
  );
}

async function executeTelegramBill({ chatId, session }) {
  const bill = session.pendingBill;
  if (!bill) return;

  await telegramService.sendText(chatId, `⏳ Processing payment...`);

  try {
    if (bill.type === 'airtime') {
      await bills.buyAirtime({ phone: bill.phone, amount: bill.amount, network: bill.network });
      await sessionStore.update(chatId, { pendingBill: null });
      await telegramService.sendText(chatId,
        `✅ *Airtime Purchased!*

• Amount: *₦${bill.amount.toLocaleString()}*
• Number: *${bill.phone}*
• Network: ${bill.network.toUpperCase()}`
      );
    } else if (bill.type === 'electricity') {
      await bills.payElectricity({ meterNumber: bill.meterNumber, amount: bill.amount, disco: bill.disco });
      await sessionStore.update(chatId, { pendingBill: null });
      await telegramService.sendText(chatId,
        `✅ *Electricity Paid!*

• Amount: *₦${bill.amount.toLocaleString()}*
• Meter: *${bill.meterNumber}*
• Provider: ${bill.disco.toUpperCase()}

_Token sent to your registered number._`
      );
    } else if (bill.type === 'tv') {
      await bills.payTV({ smartCardNumber: bill.smartCardNumber, amount: bill.amount, provider: bill.provider });
      await sessionStore.update(chatId, { pendingBill: null });
      await telegramService.sendText(chatId,
        `✅ *${bill.provider.toUpperCase()} Paid!*

• Amount: *₦${bill.amount.toLocaleString()}*
• Smart Card: *${bill.smartCardNumber}*`
      );
    }
  } catch (err) {
    logger.error('Telegram bill payment failed:', err.message);
    await sessionStore.update(chatId, { pendingBill: null });
    await telegramService.sendText(chatId, `❌ *Payment Failed*

Could not complete payment. Please try again.`);
  }
}

// ─── SPENDING ANALYSIS (TELEGRAM) ───────────────────
async function handleTelegramSpendingAnalysis({ chatId, session }) {
  const { detectCountry } = require('../utils/countryDetect');
  const country = detectCountry(chatId, session);
  const symbol = country.symbol;

  if (!banking.isBankConnected(session, chatId)) {
    try {
      const authLink = await banking.generateAuthLink(chatId, session);
      await telegramService.sendText(chatId, `📊 Connect your bank first to see spending analysis!

${authLink}`);
    } catch(e) {
      await telegramService.sendText(chatId, `Connect your bank first!`);
    }
    return;
  }

  await telegramService.sendText(chatId, `📊 Analysing your spending...`);

  try {
    const result = await banking.getTransactions(chatId, session);
    if (!result.success || !result.transactions?.length) {
      await telegramService.sendText(chatId, `No recent transactions found to analyse.`);
      return;
    }
    const analysis = insights.analyseSpending(result.transactions, symbol);
    const msg = insights.formatAnalysis(analysis, symbol, 'recently');
    await telegramService.sendText(chatId, msg);
  } catch(err) {
    logger.error('Telegram spending analysis error:', err.message);
    await telegramService.sendText(chatId, `Couldn't fetch spending data right now.`);
  }
}

// ─── ALERTS (TELEGRAM) ───────────────────────────────
async function handleTelegramAlerts({ chatId, session, text }) {
  const { detectCountry } = require('../utils/countryDetect');
  const country = detectCountry(chatId, session);
  const symbol = country.symbol;

  if (text.includes('my alerts') || text.includes('show alerts') || text.includes('list alerts')) {
    const alerts = session.alerts || {};
    if (!Object.keys(alerts).length) {
      await telegramService.sendText(chatId,
        `🔔 *No alerts set*

You can set:
• "Alert me when balance below ${symbol}500"
• "Alert me for transactions over ${symbol}200"`
      );
      return;
    }
    let msg = `🔔 *Your Alerts*

`;
    if (alerts.lowBalance) msg += `• Low balance: below *${symbol}${alerts.lowBalance}*
`;
    if (alerts.largeTransaction) msg += `• Large transaction: over *${symbol}${alerts.largeTransaction}*
`;
    await telegramService.sendText(chatId, msg.trim());
    return;
  }

  const alert = insights.parseAlertCommand(text);
  if (!alert) {
    await telegramService.sendText(chatId,
      `🔔 *Set an Alert*

Try:
• "Alert me when balance below ${symbol}500"
• "Alert me for transactions over ${symbol}200"`
    );
    return;
  }

  const currentAlerts = session.alerts || {};
  currentAlerts[alert.type] = alert.amount;
  await sessionStore.update(chatId, { alerts: currentAlerts });

  const alertDesc = alert.type === 'lowBalance'
    ? `balance drops below *${symbol}${alert.amount}*`
    : `any transaction over *${symbol}${alert.amount}*`;

  await telegramService.sendText(chatId, `✅ *Alert Set!*

I'll notify you when ${alertDesc}.`);
}

// ─── BENEFICIARIES (TELEGRAM) ────────────────────────
async function handleTelegramBeneficiaries({ chatId, session, text }) {
  if (text.includes('list') || text.includes('show') || text.includes('my contacts') || text.includes('saved')) {
    const list = insights.listBeneficiaries(session);
    if (!list) {
      await telegramService.sendText(chatId,
        `👥 *No saved contacts yet*

After sending money, contacts are saved automatically!`
      );
      return;
    }
    await telegramService.sendText(chatId, list);
    return;
  }
  await telegramService.sendText(chatId,
    `👥 *Saved Contacts*

Contacts are saved automatically after each transfer.

Say "Show my contacts" to see them.`
  );
}

// ─── SWITCH COUNTRY (TELEGRAM) ───────────────────────
async function handleTelegramSwitchCountry({ chatId, session, text }) {
  const current = session.bankingCountry || 'UK';
  let newCountry = null;

  if (text.includes('nigeria') || text.includes('naija') || text.includes('nigerian')) {
    newCountry = 'NG';
  } else if (text.includes('uk') || text.includes('britain') || text.includes('england') || text.includes('united kingdom')) {
    newCountry = 'UK';
  }

  if (newCountry && newCountry === current) {
    const flag = newCountry === 'NG' ? '🇳🇬' : '🇬🇧';
    const name = newCountry === 'NG' ? 'Nigeria' : 'United Kingdom';
    await telegramService.sendText(chatId,
      `${flag} You're already set to *${name}*!

Your balance and transfers are already using ${newCountry === 'NG' ? '₦ NGN' : '£ GBP'}.`
    );
    return;
  }

  if (newCountry) {
    await telegramSwitchToCountry(chatId, session, newCountry);
    return;
  }

  const currentFlag = current === 'NG' ? '🇳🇬' : '🇬🇧';
  const currentName = current === 'NG' ? 'Nigeria' : 'United Kingdom';
  await sessionStore.update(chatId, { awaitingField: 'country_switch' });
  await telegramService.sendText(chatId,
    `🌍 *Switch Banking Country*

` +
    `Currently set to: ${currentFlag} *${currentName}*

` +
    `Switch to:
` +
    `1️⃣ 🇬🇧 United Kingdom (£ GBP)
` +
    `2️⃣ 🇳🇬 Nigeria (₦ NGN)

` +
    `Reply with *1* or *2* to switch.`
  );
}

async function telegramSwitchToCountry(chatId, session, countryCode) {
  const isNG = countryCode === 'NG';
  const flag = isNG ? '🇳🇬' : '🇬🇧';
  const name = isNG ? 'Nigeria' : 'United Kingdom';
  const currency = isNG ? '₦ NGN' : '£ GBP';

  await sessionStore.update(chatId, {
    bankingCountry: countryCode,
    awaitingField: null,
  });

  await telegramService.sendText(chatId,
    `✅ *Switched to ${flag} ${name}!*

` +
    `Your account is now set to *${currency}*.

` +
    `Say *"Connect my bank"* to link your ${isNG ? 'Nigerian' : 'UK'} bank account.`
  );
}

module.exports = router;
