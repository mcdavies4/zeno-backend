/**
 * PDF Statement Generator
 * Uses PDFKit to generate professional bank statement PDFs
 */

const logger = require('../utils/logger');

async function generateStatementPDF({ transactions, userName, bankName, accountNumber, symbol, countryCode, period }) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const chunks = [];

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const GREEN = '#1a6b4a';
      const DARK = '#1a1a1a';
      const GRAY = '#666666';
      const LIGHT_GRAY = '#f5f5f5';
      const WHITE = '#ffffff';
      const pageWidth = doc.page.width - 100; // margins

      // ── HEADER ──────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 90).fill(GREEN);

      doc.fontSize(28).font('Helvetica-Bold').fillColor(WHITE)
        .text('ZENO', 50, 28);

      doc.fontSize(10).font('Helvetica').fillColor('rgba(255,255,255,0.8)')
        .text('AI Banking Assistant', 50, 58);

      doc.fontSize(11).font('Helvetica').fillColor(WHITE)
        .text('Bank Statement', 0, 35, { align: 'right', width: doc.page.width - 50 });

      doc.fontSize(9).fillColor('rgba(255,255,255,0.7)')
        .text(`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          0, 52, { align: 'right', width: doc.page.width - 50 });

      // ── ACCOUNT INFO ────────────────────────────────
      doc.moveDown(2);
      let y = 110;

      doc.rect(50, y, pageWidth, 70).fill(LIGHT_GRAY);

      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK)
        .text('Account Holder:', 65, y + 12);
      doc.font('Helvetica').fillColor(DARK)
        .text(userName || 'Account Holder', 175, y + 12);

      doc.font('Helvetica-Bold').fillColor(DARK)
        .text('Period:', 65, y + 30);
      doc.font('Helvetica').fillColor(DARK)
        .text(period || 'Recent Transactions', 175, y + 30);

      if (bankName) {
        doc.font('Helvetica-Bold').fillColor(DARK).text('Bank:', 65, y + 48);
        doc.font('Helvetica').fillColor(DARK).text(bankName, 175, y + 48);
      }

      if (accountNumber) {
        doc.font('Helvetica-Bold').fillColor(DARK).text('Account:', 320, y + 12);
        doc.font('Helvetica').fillColor(DARK)
          .text(`****${String(accountNumber).slice(-4)}`, 400, y + 12);
      }

      y += 90;

      // ── SUMMARY STATS ───────────────────────────────
      const debits = transactions.filter(tx => tx.amount < 0 || tx.type === 'debit');
      const credits = transactions.filter(tx => tx.amount > 0 && tx.type !== 'debit');
      const totalSpent = debits.reduce((s, tx) => s + Math.abs(tx.amount), 0);
      const totalIn = credits.reduce((s, tx) => s + Math.abs(tx.amount), 0);

      const colWidth = pageWidth / 3;

      // Summary boxes
      [
        { label: 'Total In', value: `${symbol}${totalIn.toLocaleString('en', { minimumFractionDigits: 2 })}`, color: '#27ae60' },
        { label: 'Total Out', value: `${symbol}${totalSpent.toLocaleString('en', { minimumFractionDigits: 2 })}`, color: '#e74c3c' },
        { label: 'Transactions', value: String(transactions.length), color: GREEN },
      ].forEach((box, i) => {
        const x = 50 + (i * colWidth);
        doc.rect(x, y, colWidth - 5, 55).fill(WHITE)
          .rect(x, y, colWidth - 5, 55).stroke('#dddddd');
        doc.rect(x, y, 4, 55).fill(box.color);
        doc.fontSize(9).font('Helvetica').fillColor(GRAY)
          .text(box.label, x + 12, y + 10);
        doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK)
          .text(box.value, x + 12, y + 25);
      });

      y += 70;

      // ── TABLE HEADER ────────────────────────────────
      doc.rect(50, y, pageWidth, 24).fill(GREEN);

      const cols = { date: 50, desc: 130, type: 360, amount: 420, balance: 490 };

      doc.fontSize(9).font('Helvetica-Bold').fillColor(WHITE);
      doc.text('Date', cols.date, y + 8);
      doc.text('Description', cols.desc, y + 8);
      doc.text('Type', cols.type, y + 8);
      doc.text('Amount', cols.amount, y + 8);
      doc.text('Balance', cols.balance, y + 8);

      y += 24;

      // ── TRANSACTIONS ────────────────────────────────
      transactions.forEach((tx, idx) => {
        // New page if needed
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 50;

          // Repeat header on new page
          doc.rect(50, y, pageWidth, 24).fill(GREEN);
          doc.fontSize(9).font('Helvetica-Bold').fillColor(WHITE);
          doc.text('Date', cols.date, y + 8);
          doc.text('Description', cols.desc, y + 8);
          doc.text('Type', cols.type, y + 8);
          doc.text('Amount', cols.amount, y + 8);
          doc.text('Balance', cols.balance, y + 8);
          y += 24;
        }

        const isDebit = tx.amount < 0 || tx.type === 'debit';
        const rowColor = idx % 2 === 0 ? WHITE : '#f9f9f9';

        doc.rect(50, y, pageWidth, 20).fill(rowColor);

        const date = tx.date
          ? new Date(tx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
          : '';
        const desc = (tx.description || tx.narration || 'Unknown').substring(0, 30);
        const amount = Math.abs(tx.amount || 0);
        let balance = tx.balance ? Math.abs(tx.balance) : 0;
        if (symbol === '₦' && balance > 1000000) balance = balance / 100;

        doc.fontSize(8).font('Helvetica').fillColor(DARK);
        doc.text(date, cols.date, y + 6, { width: 75 });
        doc.text(desc, cols.desc, y + 6, { width: 220 });

        doc.fillColor(isDebit ? '#e74c3c' : '#27ae60')
          .text(isDebit ? 'Debit' : 'Credit', cols.type, y + 6, { width: 55 });

        doc.fillColor(isDebit ? '#e74c3c' : '#27ae60')
          .text(`${isDebit ? '-' : '+'}${symbol}${amount.toFixed(2)}`, cols.amount, y + 6, { width: 65 });

        doc.fillColor(DARK)
          .text(balance > 0 ? `${symbol}${balance.toFixed(2)}` : '-', cols.balance, y + 6, { width: 65 });

        // Row border
        doc.moveTo(50, y + 20).lineTo(50 + pageWidth, y + 20).stroke('#eeeeee');
        y += 20;
      });

      // ── FOOTER ──────────────────────────────────────
      const footerY = doc.page.height - 45;
      doc.rect(0, footerY, doc.page.width, 45).fill(GREEN);

      doc.fontSize(8).font('Helvetica').fillColor(WHITE)
        .text('Generated by Zeno AI Banking Assistant  ·  joinzeno.co.uk  ·  This is not an official bank statement',
          50, footerY + 16, { align: 'center', width: pageWidth });

      doc.end();

    } catch (err) {
      logger.error('PDF generation error:', err.message);
      reject(err);
    }
  });
}

module.exports = { generateStatementPDF };
