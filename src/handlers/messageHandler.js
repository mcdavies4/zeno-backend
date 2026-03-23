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
const insights = require('../services/insights');
const bills = require('../services/bills');
const feesService = require('../services/fees');
const security = require('../services/security');
const virtualAccount = require('../services/virtualAccount');
const receipts = require('../services/receipts');
const searchService = require('../services/search');
const statementsService = require('../services/statements');
const emailService = require('../services/email');
const pdfGenerator = require('../services/pdfGenerator');
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

  const lowerText = text.toLowerCase();
  const country = detectCountry(from, session);

  // ── KYC keywords ──────────────────────────────────────
  if (['kyc', 'verify my identity', 'verify identity', 'identity verification', 'complete kyc', 'complete verification'].some(k => lowerText.includes(k)) || lowerText === 'verify') {
    await handleAIResponse({ from, aiResponse: { intent: 'KYC' }, session, text });
    return;
  }


  // ── Wallet / Virtual Account ─────────────────────
  if (country.code === 'NG' && !lowerText.includes('connect') && ['my account', 'my wallet', 'wallet balance', 'fund wallet', 'account number', 'zeno account', 'add money'].some(k => lowerText.includes(k))) {
    if (!session.virtualAccount) {
      await whatsappService.sendText(from, `⏳ Setting up your Zeno wallet...`);
      try {
        const vaData = await virtualAccount.createVirtualAccount({ phoneNumber: from, name: session.name, email: session.email });
        await sessionStore.update(from, { virtualAccount: vaData, walletBalance: 0 });
        session.virtualAccount = vaData;
      } catch(e) {
        await whatsappService.sendText(from, `Sorry, couldn't set up your wallet right now. Please try again.`);
        return;
      }
    }
    await whatsappService.sendText(from, virtualAccount.formatWalletMessage(session));
    return;
  }

  // ── Email PDF Statement ──────────────────────────
  if (lowerText.includes('email my statement') || lowerText.includes('email statement') || lowerText.includes('email pdf') || lowerText.includes('send my statement') || lowerText.includes('send statement')) {
    await handleEmailPDF({ from, session });
    return;
  }

  // ── Email CSV ────────────────────────────────────
  if (lowerText.includes('email my csv') || lowerText.includes('email csv') || lowerText.includes('send csv') || lowerText.includes('send my csv')) {
    await handleEmailCSV({ from, session });
    return;
  }

  // ── Statements / Reports / CSV ───────────────────
  if (['bank statement', 'download statement', 'spending report', 'monthly report', 'export csv', 'export transactions', 'transaction history', 'account statement', 'my statement'].some(k => lowerText.includes(k)) && !lowerText.includes('email') && !lowerText.includes('send')) {
    await handleStatement({ id: from, session, text: lowerText, sendFn: whatsappService.sendText.bind(whatsappService), platform: 'whatsapp' });
    return;
  }

  // ── Receipts ─────────────────────────────────────
  if (['receipt', 'last receipt', 'my receipts', 'show receipt', 'transfer receipt'].some(k => lowerText.includes(k))) {
    const num = lowerText.match(/receipt\s+(\d+)/)?.[1];
    if (num) {
      const r = (session.receipts || [])[parseInt(num) - 1];
      await whatsappService.sendText(from, r ? r.text : `No receipt #${num} found.`);
    } else {
      const last = receipts.getLastReceipt(session);
      if (last) {
        await whatsappService.sendText(from, last.text);
      } else {
        await whatsappService.sendText(from, `No receipts yet. Receipts are generated after every transfer.`);
      }
    }
    return;
  }

  // ── Support ──────────────────────────────────────
  if (['support', 'help', 'contact', 'agent', 'human', 'complaint', 'problem', 'issue', 'speak to', 'talk to', 'call us', 'phone number', 'contact us', 'customer service', 'customer care'].some(k => lowerText.includes(k))) {
    await handleSupport({ id: from, session, sendFn: whatsappService.sendText.bind(whatsappService) });
    return;
  }

  // ── Transaction search ────────────────────────────
  if (['find', 'search', 'show all', 'show transactions', 'all payments'].some(k => lowerText.includes(k)) && !lowerText.includes('balance') && !lowerText.includes('connect')) {
    await handleSearch({ from, session, text: lowerText });
    return;
  }

  // ── Exchange rate ─────────────────────────────────
  if (['exchange rate', 'exchange', 'convert', 'how much is', 'naira to', 'pounds to', 'dollar to', 'rate today'].some(k => lowerText.includes(k))) {
    await handleExchange({ from, session, text: lowerText });
    return;
  }
  // ── Airtime & Bills (Nigeria only) ───────────────
  if (country.code === 'NG' && ['airtime', 'recharge', 'top up', 'topup', 'buy data', 'data bundle', 'electricity', 'nepa', 'disco', 'dstv', 'gotv', 'cable tv', 'pay bill'].some(k => lowerText.includes(k))) {
    await handleBillPayment({ from, session, text: lowerText, country });
    return;
  }

  // ── Spending analysis keywords ───────────────────
  if (['spending', 'analyse', 'analysis', 'breakdown', 'categories', 'where is my money', 'how much did i spend', 'spending report'].some(k => lowerText.includes(k))) {
    await handleSpendingAnalysis({ from, session });
    return;
  }

  // ── Alert keywords ────────────────────────────────
  if (['set alert', 'alert me', 'notify me', 'warn me', 'low balance alert', 'transaction alert', 'my alerts', 'show alerts', 'list alerts'].some(k => lowerText.includes(k))) {
    await handleAlerts({ from, session, text: lowerText });
    return;
  }

  // ── Beneficiary keywords ──────────────────────────
  if (['save contact', 'save beneficiary', 'remember', 'saved contacts', 'my contacts', 'list contacts', 'show contacts', 'saved recipients'].some(k => lowerText.includes(k))) {
    await handleBeneficiaries({ from, session, text: lowerText });
    return;
  }

  // ── Switch country command ────────────────────────────
  if (['switch country', 'change country', 'switch bank', 'change bank country',
       'switch to nigeria', 'switch to uk', 'nigerian account', 'uk account',
       'nigeria account', 'change location', 'my nigerian bank', 'my uk bank',
       'change my country', 'switch my bank'].some(k => lowerText.includes(k))) {
    await handleSwitchCountry({ from, session, text: lowerText });
    return;
  }

  // ── Awaiting country switch response ──────────────────
  if (session.awaitingField === 'country_switch') {
    if (lowerText === '1' || lowerText.includes('uk') || lowerText.includes('united kingdom') || lowerText.includes('britain') || lowerText.includes('england')) {
      await switchToCountry(from, session, 'UK');
    } else if (lowerText === '2' || lowerText.includes('nigeria') || lowerText.includes('naija')) {
      await switchToCountry(from, session, 'NG');
    } else {
      await whatsappService.sendText(from, `Please reply with *1* for 🇬🇧 UK or *2* for 🇳🇬 Nigeria.`);
    }
    return;
  }

  // ── Let Claude interpret the message ──────────────────
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
  await sessionStore.update(from, { awaitingPin: false, pinAttempts: 0, ...security.clearFailedPin() });
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
  const fee = transfer.fee || feesService.calculateFee(transfer.amount, country.code);
  const totalWithFee = (Number(transfer.amount) + fee.totalFee).toLocaleString('en', { minimumFractionDigits: 2 });
  await whatsappService.sendText(from,
    `🔐 *Security Check*\n\nEnter your 4-digit Zeno PIN to authorise:\n• *${symbol}${Number(transfer.amount).toLocaleString('en', { minimumFractionDigits: 2 })}* to *${transfer.recipientName}*\n• Fee: *${symbol}${fee.totalFee.toFixed(2)}*\n• Total: *${symbol}${totalWithFee}*\n\nNever share your PIN with anyone, including Zeno support.`
  );
}

async function executeTransfer({ from, session }) {
  const transfer = session.pendingTransfer;
  const country = detectCountry(from, session);
  const symbol = country.symbol;

  // Check wallet balance for Nigerian transfers
  if (country.code === 'NG') {
    const fee = transfer.fee || feesService.calculateFee(transfer.amount, country.code);
    const affordCheck = virtualAccount.canAffordTransfer(session, transfer.amount, fee);
    if (!affordCheck.canAfford) {
      await sessionStore.clearPendingTransfer(from);
      await whatsappService.sendText(from, affordCheck.message);
      return;
    }
  }

  // Duplicate detection
  if (security.isDuplicate(session, transfer)) {
    await sessionStore.clearPendingTransfer(from);
    await whatsappService.sendText(from,
      `⚠️ *Duplicate Transfer Detected*

This looks identical to a transfer you just made. It has been cancelled to protect you.

If this was intentional, please try again in 1 minute.`
    );
    return;
  }

  // Daily limit check
  const limitCheck = security.checkTransferLimit(transfer.amount, session, country.code);
  if (!limitCheck.allowed) {
    await sessionStore.clearPendingTransfer(from);
    await whatsappService.sendText(from, `⚠️ *Transfer Limit Exceeded*

${limitCheck.reason}`);
    return;
  }

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

    const fee = transfer.fee || feesService.calculateFee(transfer.amount, country.code);

    // Debit wallet for Nigerian transfers
    if (country.code === 'NG') {
      const walletUpdate = virtualAccount.debitWallet(session, transfer.amount, fee);
      await sessionStore.update(from, walletUpdate);
    }

    // Generate receipt
    const updatedSession = await sessionStore.get(from);
    const receipt = receipts.generateReceipt({
      transfer, result, fee,
      countryCode: country.code,
      userName: updatedSession.name,
    });
    const receiptUpdate = receipts.storeReceipt(updatedSession, receipt);
    const dailyUpdate = security.recordLastTransfer(transfer);
    const spentUpdate = security.recordTransfer(updatedSession, transfer.amount, country.code);
    await sessionStore.update(from, { ...receiptUpdate, ...dailyUpdate, ...spentUpdate });

    await whatsappService.sendText(from, receipt.text);

    // Offer to save beneficiary if not already saved
    const existing = insights.getBeneficiary(session, transfer.recipientName);
    if (!existing && (transfer.accountNumber || transfer.sortCode || transfer.bankCode)) {
      const beneficiaries = insights.saveBeneficiary(session, transfer.recipientName, {
        accountNumber: transfer.accountNumber,
        sortCode: transfer.sortCode,
        bankCode: transfer.bankCode,
        bankName: transfer.bankName,
      });
      await sessionStore.update(from, { beneficiaries });
      await whatsappService.sendText(from,
        `💾 *${transfer.recipientName}* has been saved to your contacts! Next time just say *"Send money to ${transfer.recipientName}"*.`
      );
    }

  } catch (err) {
    logger.error('Transfer failed:', err);
    await sessionStore.clearPendingTransfer(from);
    await whatsappService.sendText(from,
      `❌ *Transfer Failed*\n\n${err.userMessage || 'The transfer could not be completed. No money has left your account.'}\n\nPlease try again or contact support.`
    );
  }
}

// ─── EXECUTE BILL PAYMENT ────────────────────────────
async function executeBillPayment({ from, session }) {
  const bill = session.pendingBill;
  if (!bill) return;

  await whatsappService.sendText(from, `⏳ Processing payment...`);

  try {
    let result;

    if (bill.type === 'airtime') {
      result = await bills.buyAirtime({ phone: bill.phone, amount: bill.amount, network: bill.network });
      await sessionStore.update(from, { pendingBill: null });
      await whatsappService.sendText(from,
        `✅ *Airtime Purchased!*

` +
        `• Amount: *₦${bill.amount.toLocaleString()}*
` +
        `• Number: *${bill.phone}*
` +
        `• Network: ${bill.network.toUpperCase()}

` +
        `_Airtime delivered instantly.`
      );
    } else if (bill.type === 'electricity') {
      result = await bills.payElectricity({ meterNumber: bill.meterNumber, amount: bill.amount, disco: bill.disco });
      await sessionStore.update(from, { pendingBill: null });
      await whatsappService.sendText(from,
        `✅ *Electricity Paid!*

` +
        `• Amount: *₦${bill.amount.toLocaleString()}*
` +
        `• Meter: *${bill.meterNumber}*
` +
        `• Provider: ${bill.disco.toUpperCase()}

` +
        `_Token will be sent to your registered number.`
      );
    } else if (bill.type === 'tv') {
      result = await bills.payTV({ smartCardNumber: bill.smartCardNumber, amount: bill.amount, provider: bill.provider });
      await sessionStore.update(from, { pendingBill: null });
      await whatsappService.sendText(from,
        `✅ *${bill.provider.toUpperCase()} Subscription Paid!*

` +
        `• Amount: *₦${bill.amount.toLocaleString()}*
` +
        `• Smart Card: *${bill.smartCardNumber}*

` +
        `_Subscription renewed successfully.`
      );
    }
  } catch (err) {
    logger.error('Bill payment failed:', err.message);
    await sessionStore.update(from, { pendingBill: null });
    await whatsappService.sendText(from,
      `❌ *Payment Failed*

${err.userMessage || 'Could not complete payment. Please try again.'}`
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
        } else {
          await whatsappService.sendText(from, `⚠️ Couldn't fetch your balance right now. Please try again in a moment.`);
        }
        break;
      }
      try {
        const authLink = await banking.generateAuthLink(from, session);
        await whatsappService.sendText(from,
          `💰 Connect your bank to see your real balance!\n\n` +
          `Tap the link below — secure and takes 30 seconds:\n\n` +
          `${authLink}\n\nRead-only access. No card details needed.`
        );
      } catch(e) {
        await whatsappService.sendText(from, `⚠️ Bank connection not available right now. Please try again.`);
      }
      break;
    }

    case 'TRANSACTIONS': {
      const bankConnected = banking.isBankConnected(session, from);
      if (bankConnected) {
        const result = await banking.getTransactions(from, session);
        if (result.success) {
          await whatsappService.sendText(from, banking.formatTransactionsMessage(result.transactions, from, session));
        } else {
          await whatsappService.sendText(from, `⚠️ Couldn't fetch transactions right now. Please try again in a moment.`);
        }
        break;
      }
      try {
        const authLink = await banking.generateAuthLink(from, session);
        await whatsappService.sendText(from,
          `📋 Connect your bank to see your transactions!\n\n${authLink}\n\nRead-only access. No card details needed.`
        );
      } catch(e) {
        await whatsappService.sendText(from, `⚠️ Bank connection not available right now. Please try again.`);
      }
      break;
    }

    case 'HELP':
      await whatsappService.sendText(from, aiResponse.reply);
      break;

    case 'GREETING':
      await whatsappService.sendText(from, aiResponse.reply);
      break;

    case 'KYC': {
      // Send Veriff verification link
      if (session.kycVerified) {
        await whatsappService.sendText(from,
          `✅ *You're already verified!*\n\nYour identity has been confirmed. You have full access to all Zeno features.`
        );
        break;
      }
      try {
        const veriffService = require('../services/veriff');
        const nameParts = (session.name || session.userName || 'Zeno User').split(' ');
        const kycSession = await veriffService.createSession({
          phoneNumber: from,
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || '',
        });
        await sessionStore.update(from, { kycSessionId: kycSession.sessionId });
        await whatsappService.sendText(from,
          `🔐 *Verify Your Identity*\n\n` +
          `Tap the link below to complete verification:\n\n` +
          `${kycSession.sessionUrl}\n\n` +
          `Takes less than 2 minutes. Fully encrypted and secure.`
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
      const authLink = await banking.generateAuthLink(from, session);
      await whatsappService.sendText(from,
        `🏦 *Connect Your Bank*\n\n` +
        `Tap the link below to securely connect your bank account:\n\n` +
        `${authLink}\n\n` +
        `_Read-only access. No card details needed. Takes 30 seconds.`
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
      `_Tap the link above to start a chat — we typically reply within a few minutes.`
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
      `_Tap the link above to start a chat — we typically reply within a few minutes.`
    );
  }
}


// ─── STATEMENT / REPORT / CSV ─────────────────────────
async function handleStatement({ id, session, text, sendFn, platform }) {
  const statementsService = require('../services/statements');
const emailService = require('../services/email');
const pdfGenerator = require('../services/pdfGenerator');
  const country = detectCountry(id, session);
  const symbol = country.symbol;

  if (!banking.isBankConnected(session, id)) {
    await sendFn(id, `Connect your bank first to download statements!

Say *"connect my bank"* to get started.`);
    return;
  }

  const req = statementsService.parseStatementRequest(text);

  // CSV export — email directly
  if (req.type === 'csv') {
    const email = session.email;
    if (!email) {
      await sendFn(id, `No email address on file. Please contact support.`);
      return;
    }
    await sendFn(id, `⏳ Generating your CSV and sending to *${email}*...`);
    try {
      const result = await banking.getTransactions(id, session);
      if (!result.success || !result.transactions?.length) {
        await sendFn(id, `No transactions found to export.`);
        return;
      }
      const csv = statementsService.generateCSV(result.transactions, symbol);
      const now = new Date();
      const filename = `Zeno-Transactions-${(session.name || 'User').replace(/\s+/g, '-')}-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}.csv`;
      await emailService.sendCSV({
        toEmail: email,
        toName: session.name || 'Zeno User',
        csvData: csv,
        filename,
        transactionCount: result.transactions.length,
        symbol,
        period: req.periodLabel || 'Recent transactions',
      });
      await sendFn(id,
        `✅ *CSV Sent!*\n\nYour transactions emailed to *${email}*\n• ${result.transactions.length} transactions\n\nCheck your inbox!`
      );
    } catch(err) {
      logger.error('CSV export error:', err.message);
      await sendFn(id, `Sorry, couldn't send the CSV right now. Please try again.`);
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


// ─── EMAIL PDF STATEMENT ─────────────────────────────
async function handleEmailPDF({ from, session }) {
  const email = session.email;
  if (!email) {
    await whatsappService.sendText(from, `No email on file. Please contact support.`);
    return;
  }
  if (!banking.isBankConnected(session, from)) {
    await whatsappService.sendText(from, `Connect your bank first before generating a statement.`);
    return;
  }

  await whatsappService.sendText(from, `⏳ Generating your PDF statement and sending to *${email}*...`);

  try {
    const country = detectCountry(from, session);
    const result = await banking.getTransactions(from, session);
    if (!result.success || !result.transactions?.length) {
      await whatsappService.sendText(from, `No transactions found to generate statement.`);
      return;
    }

    const pdfBuffer = await pdfGenerator.generateStatementPDF({
      transactions: result.transactions,
      userName: session.name || 'Account Holder',
      symbol: country.symbol,
      countryCode: country.code,
      period: 'Recent Transactions',
    });

    const now = new Date();
    const filename = `Zeno-Statement-${(session.name || 'User').replace(/\s+/g, '-')}-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}.pdf`;

    await emailService.sendPDF({
      toEmail: email,
      toName: session.name || 'Zeno User',
      pdfBuffer,
      filename,
      transactionCount: result.transactions.length,
      period: 'Recent Transactions',
    });

    await whatsappService.sendText(from,
      `✅ *Statement Sent!*\n\n` +
      `Your PDF statement has been emailed to *${email}*\n\n` +
      `• ${result.transactions.length} transactions\n` +
      `• Professional PDF format\n\n` +
      `Check your inbox — it may take a few minutes to arrive.`
    );
  } catch(err) {
    logger.error('Email PDF error:', err.message);
    await whatsappService.sendText(from, `Sorry, couldn't generate the PDF right now. Please try again.`);
  }
}

// ─── EMAIL CSV ───────────────────────────────────────
async function handleEmailCSV({ from, session }) {
  const email = session.email;
  if (!email) {
    await whatsappService.sendText(from, `No email address on file. Please contact support.`);
    return;
  }

  if (!banking.isBankConnected(session, from)) {
    await whatsappService.sendText(from, `Connect your bank first before exporting transactions.`);
    return;
  }

  await whatsappService.sendText(from, `⏳ Generating your CSV and sending to *${email}*...`);

  try {
    const country = detectCountry(from, session);
    const result = await banking.getTransactions(from, session);
    if (!result.success || !result.transactions?.length) {
      await whatsappService.sendText(from, `No transactions found to export.`);
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

    await whatsappService.sendText(from,
      `✅ *CSV Sent!*

` +
      `Your transactions have been emailed to *${email}*

` +
      `• ${result.transactions.length} transactions
` +
      `• File: ${filename}

` +
      `Check your inbox — it may take a few minutes to arrive.`
    );
  } catch(err) {
    logger.error('Email CSV error:', err.message);
    if (err.message.includes('auth') || err.message.includes('SMTP')) {
      await whatsappService.sendText(from, `Email service not configured yet. Please contact support.`);
    } else {
      await whatsappService.sendText(from, `Sorry, couldn't send the email right now. Please try again.`);
    }
  }
}

// ─── TRANSACTION SEARCH ──────────────────────────────
async function handleSearch({ from, session, text }) {
  const country = detectCountry(from, session);

  if (!banking.isBankConnected(session, from)) {
    await whatsappService.sendText(from, `Connect your bank first to search transactions!`);
    return;
  }

  await whatsappService.sendText(from, `🔍 Searching transactions...`);

  try {
    const result = await banking.getTransactions(from, session);
    if (!result.success || !result.transactions?.length) {
      await whatsappService.sendText(from, `No transactions found.`);
      return;
    }

    const results = searchService.searchTransactions(result.transactions, text);
    const msg = searchService.formatSearchResults(results, country.symbol, text);
    await whatsappService.sendText(from, msg);
  } catch(err) {
    logger.error('Search error:', err.message);
    await whatsappService.sendText(from, `Couldn't search transactions right now.`);
  }
}

// ─── EXCHANGE RATE ────────────────────────────────────
async function handleExchange({ from, session, text }) {
  const parsed = searchService.parseExchangeQuery(text);
  if (!parsed) {
    await whatsappService.sendText(from,
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

    await whatsappService.sendText(from,
      `💱 *Exchange Rate*

` +
      `${symbols[f] || f}1 = *${symbols[t] || t}${rate.toLocaleString('en', { maximumFractionDigits: 2 })}*

` +
      (parsed.amount > 1 ? `${symbols[f] || f}${parsed.amount.toLocaleString()} = *${symbols[t] || t}${converted}*

` : '') +
      `Live rate · ${new Date().toLocaleDateString('en-GB')}`
    );
  } catch(err) {
    await whatsappService.sendText(from, `Couldn't fetch exchange rate right now. Try again shortly.`);
  }
}




// ─── BILL PAYMENTS & AIRTIME ─────────────────────────
async function handleBillPayment({ from, session, text, country }) {
  const parsed = bills.parseBillCommand(text);

  if (!parsed) {
    await whatsappService.sendText(from,
      `📱 *Bills & Airtime*

` +
      `I can help you with:
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

  // Store pending bill and ask for PIN
  await sessionStore.update(from, {
    pendingBill: parsed,
    awaitingPin: true,
  });

  let summary = '';
  if (parsed.type === 'airtime') {
    summary = `₦${parsed.amount.toLocaleString()} airtime for *${parsed.phone}* (${parsed.network.toUpperCase()})`;
  } else if (parsed.type === 'electricity') {
    summary = `₦${parsed.amount.toLocaleString()} electricity (${parsed.disco.toUpperCase()}) meter *${parsed.meterNumber}*`;
  } else if (parsed.type === 'tv') {
    summary = `₦${parsed.amount.toLocaleString()} ${parsed.provider.toUpperCase()} card *${parsed.smartCardNumber}*`;
  }

  await whatsappService.sendText(from,
    `📋 *Bill Payment Summary*

` +
    `${summary}

` +
    `🔐 Enter your PIN to confirm:`
  );
}

// ─── SPENDING ANALYSIS ───────────────────────────────
async function handleSpendingAnalysis({ from, session }) {
  const country = detectCountry(from, session);
  const symbol = country.symbol;

  if (!banking.isBankConnected(session, from)) {
    try {
      const authLink = await banking.generateAuthLink(from, session);
      await whatsappService.sendText(from,
        `📊 Connect your bank first to see spending analysis!

${authLink}`
      );
    } catch(e) {
      await whatsappService.sendText(from, `Connect your bank first to see spending analysis!`);
    }
    return;
  }

  await whatsappService.sendText(from, `📊 Analysing your spending...`);

  try {
    const result = await banking.getTransactions(from, session);
    if (!result.success || !result.transactions?.length) {
      await whatsappService.sendText(from, `No recent transactions found to analyse.`);
      return;
    }

    const analysis = insights.analyseSpending(result.transactions, symbol);
    const msg = insights.formatAnalysis(analysis, symbol, 'recently');
    await whatsappService.sendText(from, msg);
  } catch(err) {
    logger.error('Spending analysis error:', err.message);
    await whatsappService.sendText(from, `Couldn't fetch spending data right now. Please try again.`);
  }
}

// ─── ALERTS ───────────────────────────────────────────
async function handleAlerts({ from, session, text }) {
  const country = detectCountry(from, session);
  const symbol = country.symbol;

  // Show existing alerts
  if (text.includes('my alerts') || text.includes('show alerts') || text.includes('list alerts')) {
    const alerts = session.alerts || {};
    if (!Object.keys(alerts).length) {
      await whatsappService.sendText(from,
        `🔔 *No alerts set*

You can set:
• *"Alert me when balance below ${symbol}500"*
• *"Alert me for transactions over ${symbol}200"*`
      );
      return;
    }
    let msg = `🔔 *Your Alerts*

`;
    if (alerts.lowBalance) msg += `• Low balance: below *${symbol}${alerts.lowBalance}*
`;
    if (alerts.largeTransaction) msg += `• Large transaction: over *${symbol}${alerts.largeTransaction}*
`;
    await whatsappService.sendText(from, msg.trim());
    return;
  }

  // Parse and set new alert
  const alert = insights.parseAlertCommand(text);
  if (!alert) {
    await whatsappService.sendText(from,
      `🔔 *Set an Alert*

Try:
• *"Alert me when balance below ${symbol}500"*
• *"Alert me for transactions over ${symbol}200"*`
    );
    return;
  }

  const currentAlerts = session.alerts || {};
  currentAlerts[alert.type] = alert.amount;
  await sessionStore.update(from, { alerts: currentAlerts });

  const alertDesc = alert.type === 'lowBalance'
    ? `balance drops below *${symbol}${alert.amount}*`
    : `any transaction over *${symbol}${alert.amount}*`;

  await whatsappService.sendText(from,
    `✅ *Alert Set!*

I'll notify you when ${alertDesc}.

To see all alerts: *"Show my alerts"*
To remove: *"Remove alerts"*`
  );
}

// ─── BENEFICIARIES ────────────────────────────────────
async function handleBeneficiaries({ from, session, text }) {
  // List beneficiaries
  if (text.includes('list') || text.includes('show') || text.includes('my contacts') || text.includes('saved')) {
    const list = insights.listBeneficiaries(session);
    if (!list) {
      await whatsappService.sendText(from,
        `👥 *No saved contacts yet*

After sending money to someone, reply *"Save [name]'s details"* to save them for next time.`
      );
      return;
    }
    await whatsappService.sendText(from, list);
    return;
  }

  await whatsappService.sendText(from,
    `👥 *Saved Contacts*

After a transfer, say *"Save John's details"* to remember them.

Next time just say *"Send £50 to John"* without re-entering bank details!`
  );
}

// ─── SWITCH COUNTRY ──────────────────────────────────
async function handleSwitchCountry({ from, session, text }) {
  const current = session.bankingCountry || 'UK';

  // If they specified a country directly
  let newCountry = null;
  if (text.includes('nigeria') || text.includes('naija') || text.includes('nigerian')) {
    newCountry = 'NG';
  } else if (text.includes('uk') || text.includes('britain') || text.includes('england') || text.includes('united kingdom')) {
    newCountry = 'UK';
  }

  // If already on that country
  if (newCountry && newCountry === current) {
    const flag = newCountry === 'NG' ? '🇳🇬' : '🇬🇧';
    await whatsappService.sendText(from,
      `${flag} You're already set to ${newCountry === 'NG' ? 'Nigeria' : 'United Kingdom'}!

Your balance and transfers are already using ${newCountry === 'NG' ? '₦ NGN' : '£ GBP'}.`
    );
    return;
  }

  // If they specified a country, switch directly
  if (newCountry) {
    await switchToCountry(from, session, newCountry);
    return;
  }

  // Otherwise show options
  const currentFlag = current === 'NG' ? '🇳🇬' : '🇬🇧';
  const currentName = current === 'NG' ? 'Nigeria' : 'United Kingdom';
  await sessionStore.update(from, { awaitingField: 'country_switch' });
  await whatsappService.sendText(from,
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

async function switchToCountry(from, session, countryCode) {
  const isNG = countryCode === 'NG';
  const flag = isNG ? '🇳🇬' : '🇬🇧';
  const name = isNG ? 'Nigeria' : 'United Kingdom';
  const currency = isNG ? '₦ NGN' : '£ GBP';

  await sessionStore.update(from, {
    bankingCountry: countryCode,
    awaitingField: null,
    // Clear bank connection so they reconnect for new country
    bankConnected: isNG ? session.bankConnected : session.bankConnected,
  });

  await whatsappService.sendText(from,
    `✅ *Switched to ${flag} ${name}!*

` +
    `Your account is now set to *${currency}*.

` +
    `${isNG ? 'Connect your Nigerian bank:\n• *"Connect my bank"*\n• *"What\'s my balance?"*' : 'Connect your UK bank:\n• *"Connect my bank"*\n• *"What\'s my balance?"*'}`
  );
}


module.exports = { handle };
