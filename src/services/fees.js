/**
 * Fee Calculation Service
 * 
 * Nigeria: Matches CBN/NIP transfer fees (same as all Nigerian banks)
 * UK: Flat fee per transfer
 * 
 * Fee structure:
 * NG: ₦10 (≤₦5k) | ₦25 (₦5k–₦50k) | ₦50 (>₦50k)  ← standard bank fee
 *     + ₦10 Zeno service charge on top = your revenue
 * UK: £0.30 flat (same as bank transfer fee)
 *     + £0.20 Zeno service charge = your revenue
 */

function calculateFee(amount, countryCode) {
  if (countryCode === 'NG') {
    return calculateNigeriaFee(amount);
  }
  return calculateUKFee(amount);
}

function calculateNigeriaFee(amount) {
  // CBN/NIP standard bank fee
  let bankFee;
  if (amount <= 5000) {
    bankFee = 10;
  } else if (amount <= 50000) {
    bankFee = 25;
  } else {
    bankFee = 50;
  }

  // Zeno service charge (your revenue)
  const zenoFee = 10;
  const totalFee = bankFee + zenoFee;

  return {
    bankFee,
    zenoFee,
    totalFee,
    symbol: '₦',
    breakdown: `₦${bankFee} bank fee + ₦${zenoFee} service charge`,
  };
}

function calculateUKFee(amount) {
  // Standard UK bank transfer fee
  const bankFee = 0.30;

  // Zeno service charge
  const zenoFee = 0.20;
  const totalFee = +(bankFee + zenoFee).toFixed(2);

  return {
    bankFee,
    zenoFee,
    totalFee,
    symbol: '£',
    breakdown: `£${bankFee.toFixed(2)} bank fee + £${zenoFee.toFixed(2)} service charge`,
  };
}

function formatFeeMessage(amount, fee) {
  const s = fee.symbol;
  return (
    `💳 *Transfer Summary*\n\n` +
    `• Amount: *${s}${amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n` +
    `• Fee: *${s}${fee.totalFee.toFixed(2)}* _(${fee.breakdown})_\n` +
    `• Total deducted: *${s}${(amount + fee.totalFee).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n\n` +
    `🔐 Enter your PIN to confirm:`
  );
}

module.exports = { calculateFee, calculateNigeriaFee, calculateUKFee, formatFeeMessage };
