/**
 * Stripe Service
 * - Financial Connections (read UK bank balance & transactions)
 * - Payment Intents (send money from UK bank accounts)
 */

const logger = require('../utils/logger');

function getStripe() {
  const Stripe = require('stripe');
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

// ─── FINANCIAL CONNECTIONS ────────────────────────────
// Creates a session so user can link their UK bank account
async function createFinancialConnectionSession({ phoneNumber, email, name }) {
  const stripe = getStripe();
  try {
    // Create or retrieve customer
    const customers = await stripe.customers.list({ email: email || `${phoneNumber}@zeno.app`, limit: 1 });
    let customer;

    if (customers.data.length > 0) {
      customer = customers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: email || `${phoneNumber}@zeno.app`,
        name: name || 'Zeno User',
        metadata: { phoneNumber },
      });
    }

    // Create Financial Connections session
    const session = await stripe.financialConnections.sessions.create({
      account_holder: {
        type: 'customer',
        customer: customer.id,
      },
      permissions: ['balances', 'transactions', 'ownership'],
      filters: { countries: ['GB'] },
      return_url: `https://api.joinzeno.co.uk/stripe/callback?phone=${encodeURIComponent(phoneNumber)}`,
    });

    logger.info(`Stripe FC session created for ${phoneNumber}: ${session.id}`);

    return {
      sessionId: session.id,
      clientSecret: session.client_secret,
      url: session.url,
      customerId: customer.id,
    };
  } catch (err) {
    logger.error('Stripe FC session error:', err.message);
    throw err;
  }
}

// ─── GET ACCOUNTS ─────────────────────────────────────
async function getConnectedAccounts(customerId) {
  const stripe = getStripe();
  try {
    const accounts = await stripe.financialConnections.accounts.list({
      account_holder: { customer: customerId },
    });
    return accounts.data;
  } catch (err) {
    logger.error('Stripe get accounts error:', err.message);
    throw err;
  }
}

// ─── GET BALANCE ──────────────────────────────────────
async function getBalance(accountId) {
  const stripe = getStripe();
  try {
    const balance = await stripe.financialConnections.accounts.retrieve(accountId);
    await stripe.financialConnections.accounts.refreshBalance(accountId);
    const refreshed = await stripe.financialConnections.accounts.retrieve(accountId);

    return {
      available: (refreshed.balance?.cash?.available?.gbp || 0) / 100,
      current: (refreshed.balance?.cash?.current?.gbp || 0) / 100,
      currency: 'GBP',
      accountName: refreshed.display_name || 'UK Account',
      institutionName: refreshed.institution_name || 'Bank',
      last4: refreshed.last4 || '****',
    };
  } catch (err) {
    logger.error('Stripe balance error:', err.message);
    throw err;
  }
}

// ─── GET TRANSACTIONS ─────────────────────────────────
async function getTransactions(accountId) {
  const stripe = getStripe();
  try {
    // Refresh transactions first
    await stripe.financialConnections.accounts.refreshTransactions(accountId);

    const txs = await stripe.financialConnections.transactions.list({
      account: accountId,
      limit: 50,
    });

    return txs.data.map(tx => ({
      id: tx.id,
      date: new Date(tx.transacted_at * 1000).toISOString(),
      description: tx.description || 'Transaction',
      amount: tx.amount / 100, // negative = debit
      currency: tx.currency?.toUpperCase() || 'GBP',
      type: tx.amount < 0 ? 'debit' : 'credit',
      status: tx.status,
    }));
  } catch (err) {
    logger.error('Stripe transactions error:', err.message);
    throw err;
  }
}

// ─── FORMAT BALANCE MESSAGE ───────────────────────────
function formatBalanceMessage(balance) {
  return (
    `💰 *Your Balance*\n\n` +
    `🏦 ${balance.institutionName} (****${balance.last4})\n` +
    `Available: *£${balance.available.toLocaleString('en', { minimumFractionDigits: 2 })}*\n` +
    `Current: £${balance.current.toLocaleString('en', { minimumFractionDigits: 2 })}`
  );
}

// ─── FORMAT TRANSACTIONS ──────────────────────────────
function formatTransactionsMessage(transactions) {
  if (!transactions?.length) return `No recent transactions found.`;

  let msg = `📋 *Recent Transactions*\n\n`;
  transactions.slice(0, 10).forEach(tx => {
    const sign = tx.amount < 0 ? '↓' : '↑';
    const amount = Math.abs(tx.amount).toFixed(2);
    const date = new Date(tx.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const desc = (tx.description || 'Unknown').substring(0, 35);
    msg += `${sign} £${amount} — ${desc}\n${date}\n\n`;
  });

  return msg.trim();
}

// ─── PAYMENT INTENT (Send Money) ──────────────────────
async function createPayment({ fromCustomerId, fromAccountId, amount, recipientName, recipientSortCode, recipientAccountNumber, reference }) {
  const stripe = getStripe();
  try {
    // Use Stripe's Pay by Bank (Payment Intents with bank_transfer)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // pence
      currency: 'gbp',
      customer: fromCustomerId,
      payment_method_types: ['bacs_debit'],
      payment_method_data: {
        type: 'bacs_debit',
        bacs_debit: {
          sort_code: recipientSortCode?.replace(/-/g, ''),
          account_number: recipientAccountNumber,
        },
      },
      confirm: false,
      description: reference || 'Zeno Transfer',
      metadata: {
        recipientName,
        reference,
        fromAccount: fromAccountId,
      },
    });

    logger.info(`Stripe payment intent created: ${paymentIntent.id}`);
    return {
      paymentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
    };
  } catch (err) {
    logger.error('Stripe payment error:', err.message);
    throw err;
  }
}

module.exports = {
  createFinancialConnectionSession,
  getConnectedAccounts,
  getBalance,
  getTransactions,
  formatBalanceMessage,
  formatTransactionsMessage,
  createPayment,
};
