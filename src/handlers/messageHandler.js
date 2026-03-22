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

  // ── KYC keywords — send real iDenfy link ──────────────
  if (['kyc', 'verify my identity', 'verify identity', 'identity verification', 'complete kyc', 'complete verification'].some(k => lowerText.includes(k)) || lowerText === 'verify') {
    await handleAIResponse({ from, aiResponse: { intent: 'KYC' }, session, text });
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
        `_Airtime delivered instantly._`
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
        `_Token will be sent to your registered number._`
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
        `_Subscription renewed successfully._`
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
          break;
        }
      }
      const authLink = await banking.generateAuthLink(from, session);
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
      const authLink = await banking.generateAuthLink(from, session);
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
      const authLink = await banking.generateAuthLink(from, session);
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
  let newCountry = null;

  if (text.includes('nigeria') || text.includes('naija') || text.includes('nigerian')) {
    newCountry = 'NG';
  } else if (text.includes('uk') || text.includes('britain') || text.includes('england') || text.includes('united kingdom')) {
    newCountry = 'UK';
  }

  if (newCountry && newCountry === current) {
    const flag = newCountry === 'NG' ? '🇳🇬' : '🇬🇧';
    const name = newCountry === 'NG' ? 'Nigeria' : 'United Kingdom';
    await whatsappService.sendText(from,
      `${flag} You're already set to *${name}*!

Your balance and transfers are already using ${newCountry === 'NG' ? '₦ NGN' : '£ GBP'}.`
    );
    return;
  }

  if (newCountry) {
    await switchToCountry(from, session, newCountry);
    return;
  }

  // Show options
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
  });

  await whatsappService.sendText(from,
    `✅ *Switched to ${flag} ${name}!*

` +
    `Your account is now set to *${currency}*.

` +
    `${isNG ? 'Connect your Nigerian bank:\n• Say *"Connect my bank"*\n• Then check *"What\'s my balance?"*' : 'Connect your UK bank:\n• Say *"Connect my bank"*\n• Then check *"What\'s my balance?"*'}`
  );
}

module.exports = { handle };
