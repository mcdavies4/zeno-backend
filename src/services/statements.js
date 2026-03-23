/**
 * Statements Service
 * PDF statements, spending reports, CSV export
 * Works for both UK (TrueLayer) and Nigeria (Mono)
 */

const axios = require('axios');
const logger = require('../utils/logger');

// ─── MONO STATEMENT PDF (Nigeria) ────────────────────
async function requestMonoStatement(accountId, period = 1) {
  const SECRET_KEY = process.env.MONO_SECRET_KEY;
  try {
    // period = number of months (1, 3, 6, 12)
    const response = await axios.get(
      `https://api.withmono.com/v2/accounts/${accountId}/statement?output=pdf&period=${period}`,
      {
        headers: { 'mono-sec-key': SECRET_KEY, 'accept': 'application/json' },
        timeout: 30000,
      }
    );

    const data = response.data?.data;
    logger.info(`Mono statement requested: jobId=${data?.id}, status=${data?.status}`);

    return {
      jobId: data?.id,
      status: data?.status, // 'processing' or 'ready'
      pdfUrl: data?.pdf_url || null,
    };
  } catch (err) {
    logger.error('Mono statement request failed:', err.response?.data || err.message);
    throw err;
  }
}

async function pollMonoStatement(accountId, jobId) {
  const SECRET_KEY = process.env.MONO_SECRET_KEY;
  try {
    const response = await axios.get(
      `https://api.withmono.com/v2/accounts/${accountId}/statement/jobs/${jobId}`,
      {
        headers: { 'mono-sec-key': SECRET_KEY, 'accept': 'application/json' },
        timeout: 15000,
      }
    );

    const data = response.data?.data;
    return {
      status: data?.status,
      pdfUrl: data?.pdf_url || null,
    };
  } catch (err) {
    logger.error('Mono statement poll failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GENERATE CSV FROM TRANSACTIONS ──────────────────
function generateCSV(transactions, symbol = '£') {
  const header = 'Date,Description,Amount,Type,Balance\n';
  const rows = transactions.map(tx => {
    const date = tx.date ? new Date(tx.date).toLocaleDateString('en-GB') : '';
    const desc = (tx.description || tx.narration || '').replace(/,/g, ' ');
    const amount = Math.abs(tx.amount || 0).toFixed(2);
    const type = tx.amount < 0 || tx.type === 'debit' ? 'Debit' : 'Credit';
    const balance = tx.balance ? Math.abs(tx.balance).toFixed(2) : '';
    return `${date},"${desc}",${symbol}${amount},${type},${symbol}${balance}`;
  }).join('\n');

  return header + rows;
}

// ─── GENERATE SPENDING REPORT TEXT ───────────────────
function generateSpendingReport(transactions, session, period = 'this month') {
  const symbol = session.bankingCountry === 'NG' ? '₦' : '£';
  const name = (session.name || 'User').split(' ')[0];
  const now = new Date();

  // Filter to current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTxs = transactions.filter(tx => {
    const txDate = tx.date ? new Date(tx.date) : null;
    return txDate && txDate >= monthStart;
  });

  const debits = monthTxs.filter(tx => tx.amount < 0 || tx.type === 'debit');
  const credits = monthTxs.filter(tx => tx.amount > 0 && tx.type !== 'debit');

  const totalSpent = debits.reduce((s, tx) => s + Math.abs(tx.amount), 0);
  const totalReceived = credits.reduce((s, tx) => s + Math.abs(tx.amount), 0);

  // Categories
  const { categoriseTransaction } = require('./insights');
  const categories = {};
  debits.forEach(tx => {
    const cat = categoriseTransaction(tx.description || tx.narration || '');
    categories[cat] = (categories[cat] || 0) + Math.abs(tx.amount);
  });

  const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  const topCat = sortedCats[0];
  const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  let report =
    `📊 *${name}'s Spending Report*\n` +
    `${monthName}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💸 *Total Spent:* ${symbol}${totalSpent.toLocaleString('en', { minimumFractionDigits: 2 })}\n` +
    `💰 *Total Received:* ${symbol}${totalReceived.toLocaleString('en', { minimumFractionDigits: 2 })}\n` +
    `📝 *Transactions:* ${monthTxs.length}\n\n`;

  if (sortedCats.length > 0) {
    report += `*Spending Breakdown:*\n`;
    sortedCats.slice(0, 6).forEach(([cat, amount]) => {
      const pct = totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(0) : 0;
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      report += `${bar} ${cat}\n${symbol}${amount.toLocaleString('en', { minimumFractionDigits: 2 })} (${pct}%)\n\n`;
    });
  }

  if (topCat) {
    report += `*Biggest spend:* ${topCat[0]} at ${symbol}${topCat[1].toLocaleString('en', { minimumFractionDigits: 2 })}\n\n`;
  }

  const net = totalReceived - totalSpent;
  report +=
    `*Net:* ${net >= 0 ? '+' : ''}${symbol}${Math.abs(net).toLocaleString('en', { minimumFractionDigits: 2 })} ` +
    `${net >= 0 ? '✅' : '⚠️'}\n\n` +
    `Powered by Zeno · joinzeno.co.uk`;

  return report;
}

// ─── PARSE STATEMENT REQUEST ──────────────────────────
function parseStatementRequest(text) {
  const lower = text.toLowerCase();

  // Period detection
  let period = 1;
  let periodLabel = 'last month';

  if (lower.includes('3 month') || lower.includes('three month') || lower.includes('quarter')) {
    period = 3; periodLabel = 'last 3 months';
  } else if (lower.includes('6 month') || lower.includes('six month')) {
    period = 6; periodLabel = 'last 6 months';
  } else if (lower.includes('12 month') || lower.includes('year') || lower.includes('annual')) {
    period = 12; periodLabel = 'last 12 months';
  }

  // Type detection
  if (lower.includes('csv') || lower.includes('excel') || lower.includes('spreadsheet')) {
    return { type: 'csv', period, periodLabel };
  }
  if (lower.includes('report') || lower.includes('spending report') || lower.includes('summary')) {
    return { type: 'report', period, periodLabel };
  }
  // Default to PDF statement
  return { type: 'pdf', period, periodLabel };
}

module.exports = {
  requestMonoStatement,
  pollMonoStatement,
  generateCSV,
  generateSpendingReport,
  parseStatementRequest,
};
