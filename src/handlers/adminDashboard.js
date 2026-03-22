/**
 * Admin Dashboard — Enhanced with support details
 * Access: /admin?key=YOUR_ADMIN_SECRET
 * Search: /admin?key=YOUR_ADMIN_SECRET&search=4478
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

function adminAuth(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    return res.status(401).send(`
      <html><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center"><div style="font-size:2rem;margin-bottom:12px">🔐</div><div style="color:#ef4444;font-size:1.1rem">Unauthorized</div></div>
      </body></html>
    `);
  }
  next();
}

router.get('/', adminAuth, async (req, res) => {
  const adminKey = req.query.key;
  const search = req.query.search || '';

  try {
    const db = require('../services/database');
    let stats = {
      totalUsers: 0, onboardedUsers: 0, kycVerified: 0,
      bankConnected: 0, newToday: 0, activeToday: 0,
      recentUsers: [], recentTransactions: [], searchResults: [],
    };

    if (db.isReady()) {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });

      const queries = [
        pool.query('SELECT COUNT(*) FROM users'),
        pool.query('SELECT COUNT(*) FROM users WHERE is_onboarded = true'),
        pool.query('SELECT COUNT(*) FROM users WHERE kyc_verified = true'),
        pool.query('SELECT COUNT(*) FROM users WHERE bank_connected = true'),
        pool.query("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours'"),
        pool.query("SELECT COUNT(*) FROM users WHERE updated_at > NOW() - INTERVAL '24 hours'"),
        pool.query(`SELECT phone_number, name, email, is_onboarded, kyc_verified, kyc_status,
          kyc_session_id, bank_connected, balance, onboarding_step, last_error,
          pin_attempts_total as pin_attempts, is_frozen, bank_connected_at, last_balance_check,
          truelayer_expires_at, kyc_attempt_count, created_at, updated_at
          FROM users ORDER BY created_at DESC LIMIT 25`),
        pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20'),
      ];

      if (search) {
        queries.push(pool.query(
          `SELECT phone_number, name, email, is_onboarded, kyc_verified, kyc_status,
           kyc_session_id, bank_connected, balance, created_at, updated_at,
           is_frozen, pin_attempts_total as pin_attempts, last_error
           FROM users WHERE phone_number LIKE $1 OR name ILIKE $2 OR email ILIKE $2
           ORDER BY created_at DESC LIMIT 10`,
          [`%${search}%`, `%${search}%`]
        ));
      }

      const results = await Promise.all(queries);

      stats.totalUsers = parseInt(results[0].rows[0].count);
      stats.onboardedUsers = parseInt(results[1].rows[0].count);
      stats.kycVerified = parseInt(results[2].rows[0].count);
      stats.bankConnected = parseInt(results[3].rows[0].count);
      stats.newToday = parseInt(results[4].rows[0].count);
      stats.activeToday = parseInt(results[5].rows[0].count);
      stats.recentUsers = results[6].rows;
      stats.recentTransactions = results[7].rows;
      if (search && results[8]) stats.searchResults = results[8].rows;

      await pool.end();
    }

    res.send(renderDashboard(stats, adminKey, search));
  } catch (err) {
    logger.error('Admin dashboard error:', err.message);
    res.status(500).send('Error: ' + err.message);
  }
});

function renderDashboard(stats, key, search) {
  const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const mask = (p) => p ? p.slice(0, 5) + '••••' + p.slice(-2) : '—';
  const bal = (b, country) => { if (!b) return '—'; const s = country === 'NG' ? '₦' : '£'; return `${s}${parseFloat(b).toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2})}`; };
  const tokenExpiry = (t) => {
    if (!t) return '—';
    const diff = t - Date.now();
    if (diff < 0) return '<span style="color:#ef4444">Expired</span>';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  };

  const badge = (val, yes = 'yes', no = 'no') => `<span class="badge ${val ? 'green' : 'gray'}">${val ? yes : no}</span>`;
  const kycBadge = (s) => {
    const map = { approved: 'green', declined: 'red', pending: 'yellow', resubmission_requested: 'yellow', expired: 'gray', abandoned: 'gray' };
    return `<span class="badge ${map[s] || 'gray'}">${s || 'pending'}</span>`;
  };

  const userRows = (users) => users.map(u => `
    <tr>
      <td><code>${mask(u.phone_number)}</code></td>
      <td>${u.name || '—'}</td>
      <td style="font-size:.75rem;color:#94a3b8">${u.email || '—'}</td>
      <td>${badge(u.is_onboarded, 'Yes', 'No')}</td>
      <td>${kycBadge(u.kyc_status)}</td>
      <td>${badge(u.bank_connected, 'Yes', 'No')}</td>
      <td>${bal(u.balance, u.banking_country)}</td>
      <td>${u.is_frozen ? '<span class="badge red">Frozen</span>' : '<span class="badge gray">Active</span>'}</td>
      <td>${u.pin_attempts > 0 ? `<span class="badge ${u.pin_attempts >= 3 ? 'red' : 'yellow'}">${u.pin_attempts}</span>` : '0'}</td>
      <td style="font-size:.72rem;color:#64748b">${u.kyc_session_id ? u.kyc_session_id.substring(0, 8) + '...' : '—'}</td>
      <td>${tokenExpiry(u.truelayer_expires_at)}</td>
      <td style="font-size:.72rem">${fmt(u.created_at)}</td>
      <td style="font-size:.72rem">${fmt(u.updated_at)}</td>
      <td style="font-size:.72rem;color:#ef4444;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.last_error || '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="60">
<title>Zeno Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.header{background:#1e293b;border-bottom:1px solid #334155;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.logo{font-size:1.2rem;font-weight:700;color:#10b981;display:flex;align-items:center;gap:8px}
.live{display:flex;align-items:center;gap:6px;font-size:.75rem;color:#64748b}
.dot{width:6px;height:6px;background:#10b981;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.main{padding:24px;max-width:1400px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px}
.stat{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px}
.stat-n{font-size:1.8rem;font-weight:700;color:#10b981}
.stat-l{font-size:.72rem;color:#64748b;margin-top:2px}
.search-bar{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 20px;margin-bottom:24px;display:flex;gap:12px;align-items:center}
.search-bar input{flex:1;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:.88rem;outline:none}
.search-bar input:focus{border-color:#10b981}
.search-bar button{background:#10b981;color:#0f172a;border:none;border-radius:8px;padding:10px 20px;font-weight:600;font-size:.85rem;cursor:pointer}
.search-bar button:hover{background:#0ea573}
.section{background:#1e293b;border:1px solid #334155;border-radius:10px;margin-bottom:24px;overflow:hidden}
.section-h{padding:14px 20px;border-bottom:1px solid #334155;font-size:.8rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;justify-content:space-between}
.section-h span{color:#e2e8f0;font-size:.85rem;text-transform:none;letter-spacing:0;font-weight:400}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:900px}
th{padding:10px 12px;text-align:left;font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.06em;background:#172033;border-bottom:1px solid #334155;white-space:nowrap}
td{padding:10px 12px;font-size:.8rem;border-bottom:1px solid #1a2744;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1a2a3e}
.badge{display:inline-block;padding:2px 8px;border-radius:50px;font-size:.68rem;font-weight:600}
.badge.green{background:rgba(16,185,129,.12);color:#10b981}
.badge.gray{background:rgba(100,116,139,.12);color:#64748b}
.badge.yellow{background:rgba(251,191,36,.12);color:#fbbf24}
.badge.red{background:rgba(239,68,68,.12);color:#ef4444}
code{font-family:monospace;font-size:.8rem;background:#0f172a;padding:2px 6px;border-radius:4px;color:#94a3b8}
.empty{padding:32px;text-align:center;color:#475569;font-size:.85rem}
.search-results-header{background:rgba(16,185,129,.06);border-bottom:1px solid rgba(16,185,129,.15)}
@media(max-width:900px){.stats{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">⚡ Zeno Admin</div>
  <div class="live"><span class="dot"></span>Auto-refresh 60s · ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}</div>
</div>
<div class="main">

  <div class="stats">
    <div class="stat"><div class="stat-n">${stats.totalUsers}</div><div class="stat-l">Total Users</div></div>
    <div class="stat"><div class="stat-n" style="color:#60a5fa">${stats.newToday}</div><div class="stat-l">New Today</div></div>
    <div class="stat"><div class="stat-n" style="color:#a78bfa">${stats.activeToday}</div><div class="stat-l">Active Today</div></div>
    <div class="stat"><div class="stat-n">${stats.onboardedUsers}</div><div class="stat-l">Onboarded</div></div>
    <div class="stat"><div class="stat-n">${stats.kycVerified}</div><div class="stat-l">KYC Verified</div></div>
    <div class="stat"><div class="stat-n">${stats.bankConnected}</div><div class="stat-l">Bank Connected</div></div>
  </div>

  <div class="search-bar">
    <input type="text" id="searchInput" placeholder="Search by phone number, name or email..." value="${search}">
    <button onclick="doSearch()">Search</button>
    ${search ? `<button onclick="window.location='/admin?key=${key}'" style="background:#334155;color:#e2e8f0">Clear</button>` : ''}
  </div>

  ${search && stats.searchResults.length > 0 ? `
  <div class="section">
    <div class="section-h search-results-header" style="color:#10b981">
      Search Results for "${search}" <span>${stats.searchResults.length} found</span>
    </div>
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Phone</th><th>Name</th><th>Email</th><th>Onboarded</th><th>KYC</th>
        <th>Bank</th><th>Balance</th><th>Status</th><th>PIN Fails</th>
        <th>KYC Session</th><th>Token Expiry</th><th>Created</th><th>Last Active</th><th>Last Error</th>
      </tr></thead>
      <tbody>${userRows(stats.searchResults)}</tbody>
    </table>
    </div>
  </div>` : search ? `<div class="section"><div class="empty">No users found for "${search}"</div></div>` : ''}

  <div class="section">
    <div class="section-h">Recent Users <span>Last 25</span></div>
    ${stats.recentUsers.length === 0 ? '<div class="empty">No users yet</div>' : `
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Phone</th><th>Name</th><th>Email</th><th>Onboarded</th><th>KYC</th>
        <th>Bank</th><th>Balance</th><th>Status</th><th>PIN Fails</th>
        <th>KYC Session</th><th>Token Expiry</th><th>Created</th><th>Last Active</th><th>Last Error</th>
      </tr></thead>
      <tbody>${userRows(stats.recentUsers)}</tbody>
    </table>
    </div>`}
  </div>

  <div class="section">
    <div class="section-h">Recent Transactions <span>Last 20</span></div>
    ${stats.recentTransactions.length === 0 ? '<div class="empty">No transactions yet</div>' : `
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Phone</th><th>Type</th><th>Amount</th><th>Recipient</th>
        <th>Sort Code</th><th>Reference</th><th>Status</th><th>Date</th>
      </tr></thead>
      <tbody>
        ${stats.recentTransactions.map(t => `
        <tr>
          <td><code>${mask(t.phone_number)}</code></td>
          <td>${t.type}</td>
          <td>${t.currency === 'NGN' || t.amount_currency === 'NGN' ? '₦' : '£'}${parseFloat(t.amount).toFixed(2)}</td>
          <td>${t.recipient_name || '—'}</td>
          <td>${t.recipient_sort_code || '—'}</td>
          <td>${t.reference || '—'}</td>
          <td><span class="badge ${t.status === 'completed' ? 'green' : 'yellow'}">${t.status}</span></td>
          <td style="font-size:.72rem">${fmt(t.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>`}
  </div>

</div>
<script>
function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (q) window.location = '/admin?key=${key}&search=' + encodeURIComponent(q);
}
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});
</script>
</body>
</html>`;
}



// ─── RESET USER via GET (browser friendly) ───────────
router.get('/reset-user', adminAuth, async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.send('Error: phone query param required. Use ?phone=447876135951');

  try {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.del(`session:${phone}`);

    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('DELETE FROM users WHERE phone_number = $1', [phone]);
    await pool.end();

    logger.info(`Admin reset user: ${phone}`);
    res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#0f1923;color:#e2e8f0">
      <h2 style="color:#00d4aa">✅ User Reset Successfully</h2>
      <p>Phone: <strong>${phone}</strong> has been cleared.</p>
      <p>They can now register fresh on WhatsApp or Telegram.</p>
      <a href="/admin?key=${req.query.key}" style="color:#00d4aa">← Back to Admin</a>
    </body></html>`);
  } catch(err) {
    res.send(`Error: ${err.message}`);
  }
});

// ─── RESET USER via POST ─────────────────────────────
router.post('/reset-user', adminAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ error: 'Phone required' });

  try {
    const sessionStore = require('../services/sessionStore');
    // Clear Redis session
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.del(`session:${phone}`);

    // Clear DB
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('DELETE FROM users WHERE phone_number = $1', [phone]);
    await pool.end();

    logger.info(`Admin reset user: ${phone}`);
    res.json({ success: true, message: `User ${phone} reset successfully` });
  } catch(err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
