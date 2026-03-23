/**
 * Email Service
 * Sends CSV exports and statements to user's registered email
 * Uses Gmail SMTP via nodemailer
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendCSV({ toEmail, toName, csvData, filename, transactionCount, symbol, period }) {
  try {
    const transporter = createTransporter();
    const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    await transporter.sendMail({
      from: `Zeno Banking <${process.env.SMTP_USER}>`,
      to: `${toName} <${toEmail}>`,
      subject: `Your Zeno Transaction Export — ${now}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:#1a6b4a;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px">
            <h1 style="color:white;margin:0;font-size:28px">Zeno</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0">AI Banking Assistant</p>
          </div>
          <h2 style="color:#1a1a1a">Your Transaction Export is Ready</h2>
          <p style="color:#666">Hi ${toName.split(' ')[0]},</p>
          <p style="color:#666">Your transaction export is attached to this email.</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:20px 0">
            <p style="margin:4px 0;color:#1a1a1a"><strong>Transactions:</strong> ${transactionCount}</p>
            <p style="margin:4px 0;color:#1a1a1a"><strong>Period:</strong> ${period || 'Recent'}</p>
            <p style="margin:4px 0;color:#1a1a1a"><strong>Format:</strong> CSV (opens in Excel, Google Sheets)</p>
            <p style="margin:4px 0;color:#1a1a1a"><strong>Generated:</strong> ${now}</p>
          </div>
          <p style="color:#666">Open the attached file in Excel or Google Sheets to view and analyse your transactions.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px;text-align:center">
            Powered by Zeno · <a href="https://www.joinzeno.co.uk" style="color:#1a6b4a">joinzeno.co.uk</a>
          </p>
        </div>
      `,
      attachments: [
        {
          filename,
          content: Buffer.from(csvData, 'utf8'),
          contentType: 'text/csv',
        },
      ],
    });

    logger.info(`CSV email sent to ${toEmail}`);
    return true;
  } catch (err) {
    logger.error('Email send failed:', err.message);
    throw err;
  }
}

async function sendStatement({ toEmail, toName, pdfUrl, period }) {
  try {
    const transporter = createTransporter();
    const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    await transporter.sendMail({
      from: `Zeno Banking <${process.env.SMTP_USER}>`,
      to: `${toName} <${toEmail}>`,
      subject: `Your Zeno Bank Statement — ${period}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:#1a6b4a;padding:24px;border-radius:8px;text-align:center;margin-bottom:24px">
            <h1 style="color:white;margin:0;font-size:28px">Zeno</h1>
          </div>
          <h2 style="color:#1a1a1a">Your Bank Statement is Ready</h2>
          <p>Hi ${toName.split(' ')[0]},</p>
          <p>Your bank statement for <strong>${period}</strong> is ready.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${pdfUrl}" style="background:#1a6b4a;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
              Download Statement PDF
            </a>
          </div>
          <p style="color:#999;font-size:12px">This link expires in 7 days.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px;text-align:center">Powered by Zeno · joinzeno.co.uk</p>
        </div>
      `,
    });

    logger.info(`Statement email sent to ${toEmail}`);
    return true;
  } catch (err) {
    logger.error('Statement email failed:', err.message);
    throw err;
  }
}

module.exports = { sendCSV, sendStatement };
