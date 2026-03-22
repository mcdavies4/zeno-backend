/**
 * Receipt Service
 * Generate text receipts after transfers
 */

const logger = require('../utils/logger');

function generateReceipt({ transfer, result, fee, countryCode, userName }) {
  const symbol = countryCode === 'NG' ? '₦' : '£';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const receiptId = `ZNO-${Date.now().toString(36).toUpperCase()}`;

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━`,
    `🧾 *ZENO TRANSFER RECEIPT*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `📅 Date: ${dateStr}`,
    `🆔 Receipt: ${receiptId}`,
    ``,
    `*FROM*`,
    `👤 ${userName || 'Zeno User'}`,
    ``,
    `*TO*`,
    `👤 ${transfer.recipientName}`,
    transfer.accountNumber ? `🏦 Account: ****${String(transfer.accountNumber).slice(-4)}` : '',
    transfer.bankName ? `🏛 Bank: ${transfer.bankName}` : '',
    transfer.sortCode ? `🔢 Sort Code: ${transfer.sortCode}` : '',
    ``,
    `*AMOUNT*`,
    `💸 Sent: *${symbol}${Number(transfer.amount).toLocaleString('en', { minimumFractionDigits: 2 })}*`,
    fee ? `📋 Fee: ${symbol}${fee.totalFee.toFixed(2)}` : '',
    fee ? `💳 Total: *${symbol}${(Number(transfer.amount) + fee.totalFee).toLocaleString('en', { minimumFractionDigits: 2 })}*` : '',
    ``,
    `📝 Ref: ${transfer.reference || 'Zeno Transfer'}`,
    result?.transactionId ? `🔖 Tx ID: ${result.transactionId}` : '',
    ``,
    `✅ *Status: SUCCESSFUL*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Powered by Zeno · joinzeno.co.uk_`,
  ].filter(l => l !== '').join('\n');

  return { receiptId, text: lines };
}

function storeReceipt(session, receipt) {
  const receipts = session.receipts || [];
  receipts.unshift({ // newest first
    id: receipt.receiptId,
    text: receipt.text,
    date: new Date().toISOString(),
  });
  // Keep last 10 receipts
  return { receipts: receipts.slice(0, 10) };
}

function getLastReceipt(session) {
  const receipts = session.receipts || [];
  return receipts[0] || null;
}

function formatReceiptList(session) {
  const receipts = session.receipts || [];
  if (!receipts.length) return null;

  let msg = `🧾 *Your Recent Receipts*\n\n`;
  receipts.slice(0, 5).forEach((r, i) => {
    const date = new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    msg += `${i + 1}. ${r.id} — ${date}\n`;
  });
  msg += `\nSay *"show receipt 1"* to see details.`;
  return msg;
}

module.exports = { generateReceipt, storeReceipt, getLastReceipt, formatReceiptList };
