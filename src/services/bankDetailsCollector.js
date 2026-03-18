/**
 * UK Bank Details Collector
 *
 * When Claude extracts a transfer intent but the user hasn't provided
 * sort code + account number, this module manages the multi-step
 * conversation to collect them safely.
 */

const whatsappService = require('./whatsapp');
const sessionStore = require('./sessionStore');

/**
 * Ask for missing bank details step by step.
 * Stores collected details in session.pendingTransfer.
 */
async function collectMissingDetails(from, session) {
  const transfer = session.pendingTransfer;

  if (!transfer.sortCode) {
    await sessionStore.update(from, { awaitingField: 'sortCode' });
    await whatsappService.sendText(from,
      `To send *£${transfer.amount}* to *${transfer.recipientName}*, I need their UK bank details.\n\n` +
      `Please enter their *sort code* (e.g. 20-00-00):`
    );
    return;
  }

  if (!transfer.accountNumber) {
    await sessionStore.update(from, { awaitingField: 'accountNumber' });
    await whatsappService.sendText(from,
      `Got the sort code ✅\n\nNow please enter *${transfer.recipientName}'s* 8-digit *account number*:`
    );
    return;
  }

  // All details collected — show summary
  await sessionStore.update(from, { awaitingField: null });
  return 'READY';
}

/**
 * Validate and store a field the user has just provided.
 * Returns true if valid, false if invalid (with error message sent).
 */
async function handleFieldInput(from, input, session) {
  const field = session.awaitingField;

  if (!field) return false;

  if (field === 'sortCode') {
    // Accept formats: 200000, 20-00-00, 20 00 00
    const cleaned = input.replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      await whatsappService.sendText(from,
        "That doesn't look like a valid sort code. Sort codes are 6 digits, e.g. *20-00-00*. Please try again:"
      );
      return true; // still handling input
    }
    const formatted = `${cleaned.slice(0,2)}-${cleaned.slice(2,4)}-${cleaned.slice(4,6)}`;
    await sessionStore.update(from, {
      awaitingField: null,
      pendingTransfer: { ...session.pendingTransfer, sortCode: formatted },
    });
    return true;
  }

  if (field === 'accountNumber') {
    const cleaned = input.replace(/\s/g, '');
    if (!/^\d{8}$/.test(cleaned)) {
      await whatsappService.sendText(from,
        "Account numbers must be exactly 8 digits. Please try again:"
      );
      return true;
    }
    await sessionStore.update(from, {
      awaitingField: null,
      pendingTransfer: { ...session.pendingTransfer, accountNumber: cleaned },
    });
    return true;
  }

  return false;
}

module.exports = { collectMissingDetails, handleFieldInput };
