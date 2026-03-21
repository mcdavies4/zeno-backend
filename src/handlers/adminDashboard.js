/**
 * Admin Dashboard
 * 
 * Protected by ADMIN_SECRET environment variable.
 * Access at: /admin?key=your_admin_secret
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// ─── AUTH MIDDLEWARE ──────────────────────────────────
function adminAuth(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  next();
}

// ─── DASHBOARD ────────────────────────────────────────
router.get('/', adminAuth, async (req, res) => {
  try {
    const db = require('../services/database');
    
    let stats = {
      totalUsers: 0,
      onboardedUsers: 0,
      kycVerified: 0,
      bankConnected: 0,
      newToday: 0,
      recentUsers: [],
      recentTransactions: [],
    };

    if (db.isReady()) {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });

      const [
        totalRes,
        onboardedRes,
        kycRes,
        bankRes,
        todayRes,
        usersRes,
        txRes,
      ] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM users'),
        pool.query('SELECT COUNT(*) FROM users WHERE is_onboarded = true'),
        pool.query('SELECT COUNT(*) FROM users WHERE kyc_verified = true'),
        pool.query('SELECT COUNT(*) FROM users WHERE bank_connected = true'),
        pool.query("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours'"),
        pool.query('SELECT phone_number, name, email, is_onboarded, kyc_verified, bank_connected, kyc_status, created_at FROM users ORDER BY created_at DESC LIMIT 20'),
        pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20'),
      ]);

      stats.totalUsers = parseInt(totalRes.rows[0].count);
      stats.onboardedUsers = parseInt(onboardedRes.rows[0].count);
      stats.kycVerified = parseInt(kycRes.rows[0].count);
      stats.bankConnected = parseInt(bankRes.rows[0].count);
      stats.newToday = parseInt(todayRes.rows[0].count);
      stats.recentUsers = usersRes.rows;
      stats.recentTransactions = txRes.rows;

      await pool.end();
    }

    res.send(renderDashboard(stats));
  } catch (err) {
    logger.error('Admin dashboard error:', err.message);
    res.status(500).send('Error loading dashboard: ' + err.message);
  }
});

// ─── RENDER HTML DASHBOARD ────────────────────────────
function renderDashboard(stats) {
  const formatDate = (d) => d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'N/A';
  const mask = (phone) => phone ? phone.slice(0, 6) + '****' + phone.slice(-2) : 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="60">
<title>Zeno Admin Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.header{background:#1e293b;border-bottom:1px solid #334155;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
.logo{font-size:1.4rem;font-weight:700;color:#10b981}
.live{display:flex;align-items:center;gap:6px;font-size:.8rem;color:#94a3b8}
.dot{width:6px;height:6px;background:#10b981;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.main{padding:32px;max-width:1200px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:32px}
.stat{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px}
.stat-n{font-size:2rem;font-weight:700;color:#10b981;margin-bottom:4px}
.stat-l{font-size:.78rem;color:#94a3b8}
.section{background:#1e293b;border:1px solid #334155;border-radius:12px;margin-bottom:24px;overflow:hidden}
.section-h{padding:16px 20px;border-bottom:1px solid #334155;font-size:.88rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse}
th{padding:10px 16px;text-align:left;font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #334155}
td{padding:12px 16px;font-size:.83rem;border-bottom:1px solid #1e293b}
tr:last-child td{border-bottom:none}
tr:hover td{background:#263548}
.badge{display:inline-block;padding:2px 10px;border-radius:50px;font-size:.7rem;font-weight:600}
.badge.yes{background:rgba(16,185,129,.15);color:#10b981}
.badge.no{background:rgba(100,116,139,.1);color:#64748b}
.badge.pending{background:rgba(251,191,36,.1);color:#fbbf24}
.badge.approved{background:rgba(16,185,129,.15);color:#10b981}
.badge.declined{background:rgba(239,68,68,.1);color:#ef4444}
.empty{padding:24px;text-align:center;color:#64748b;font-size:.85rem}
@media(max-width:768px){.stats{grid-template-columns:1fr 1fr}.header{padding:14px 16px}.main{padding:16px}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">⚡ Zeno Admin</div>
  <div class="live"><span class="dot"></span>Live · Auto-refreshes every 60s</div>
</div>
<div class="main">
  <div class="stats">
    <div class="stat"><div class="stat-n">${stats.totalUsers}</div><div class="stat-l">Total Users</div></div>
    <div class="stat"><div class="stat-n">${stats.newToday}</div><div class="stat-l">New Today</div></div>
    <div class="stat"><div class="stat-n">${stats.onboardedUsers}</div><div class="stat-l">Onboarded</div></div>
    <div class="stat"><div class="stat-n">${stats.kycVerified}</div><div class="stat-l">KYC Verified</div></div>
    <div class="stat"><div class="stat-n">${stats.bankConnected}</div><div class="stat-l">Bank Connected</div></div>
  </div>

  <div class="section">
    <div class="section-h">Recent Users (last 20)</div>
    ${stats.recentUsers.length === 0 ? '<div class="empty">No users yet</div>' : `
    <table>
      <thead><tr>
        <th>Phone</th><th>Name</th><th>Onboarded</th><th>KYC</th><th>Bank</th><th>Joined</th>
      </tr></thead>
      <tbody>
        ${stats.recentUsers.map(u => `
        <tr>
          <td>${mask(u.phone_number)}</td>
          <td>${u.name || '—'}</td>
          <td><span class="badge ${u.is_onboarded ? 'yes' : 'no'}">${u.is_onboarded ? 'Yes' : 'No'}</span></td>
          <td><span class="badge ${u.kyc_status || 'pending'}">${u.kyc_status || 'pending'}</span></td>
          <td><span class="badge ${u.bank_connected ? 'yes' : 'no'}">${u.bank_connected ? 'Yes' : 'No'}</span></td>
          <td>${formatDate(u.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>

  <div class="section">
    <div class="section-h">Recent Transactions (last 20)</div>
    ${stats.recentTransactions.length === 0 ? '<div class="empty">No transactions yet</div>' : `
    <table>
      <thead><tr>
        <th>Phone</th><th>Type</th><th>Amount</th><th>Recipient</th><th>Status</th><th>Date</th>
      </tr></thead>
      <tbody>
        ${stats.recentTransactions.map(t => `
        <tr>
          <td>${mask(t.phone_number)}</td>
          <td>${t.type}</td>
          <td>£${parseFloat(t.amount).toFixed(2)}</td>
          <td>${t.recipient_name || '—'}</td>
          <td><span class="badge ${t.status === 'completed' ? 'approved' : 'pending'}">${t.status}</span></td>
          <td>${formatDate(t.created_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>
</div>
</body>
</html>`;
}

module.exports = router;
