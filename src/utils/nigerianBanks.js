/**
 * Nigerian Bank Codes
 * Maps bank names to Flutterwave bank codes
 */

const NIGERIAN_BANKS = [
  { name: 'Access Bank', aliases: ['access', 'access bank', 'diamond'], code: '044' },
  { name: 'Citibank', aliases: ['citi', 'citibank'], code: '023' },
  { name: 'Ecobank', aliases: ['ecobank', 'eco'], code: '050' },
  { name: 'Fidelity Bank', aliases: ['fidelity', 'fidelity bank'], code: '070' },
  { name: 'First Bank', aliases: ['first bank', 'firstbank', 'fbn'], code: '011' },
  { name: 'First City Monument Bank', aliases: ['fcmb', 'first city'], code: '214' },
  { name: 'Globus Bank', aliases: ['globus'], code: '103' },
  { name: 'GTBank', aliases: ['gtbank', 'gtb', 'guaranty trust', 'guaranty', 'gt bank'], code: '058' },
  { name: 'Heritage Bank', aliases: ['heritage'], code: '030' },
  { name: 'Keystone Bank', aliases: ['keystone'], code: '082' },
  { name: 'Kuda Bank', aliases: ['kuda', 'kuda bank'], code: '090267' },
  { name: 'Opay', aliases: ['opay', 'o-pay'], code: '100004' },
  { name: 'Palmpay', aliases: ['palmpay', 'palm pay'], code: '100033' },
  { name: 'Polaris Bank', aliases: ['polaris', 'skye'], code: '076' },
  { name: 'Providus Bank', aliases: ['providus'], code: '101' },
  { name: 'Stanbic IBTC', aliases: ['stanbic', 'stanbic ibtc', 'ibtc'], code: '221' },
  { name: 'Standard Chartered', aliases: ['standard chartered', 'standard'], code: '068' },
  { name: 'Sterling Bank', aliases: ['sterling'], code: '232' },
  { name: 'SunTrust Bank', aliases: ['suntrust'], code: '100' },
  { name: 'UBA', aliases: ['uba', 'united bank', 'united bank for africa'], code: '033' },
  { name: 'Union Bank', aliases: ['union bank', 'union'], code: '032' },
  { name: 'Unity Bank', aliases: ['unity', 'unity bank'], code: '215' },
  { name: 'VFD Microfinance', aliases: ['vfd', 'v-bank'], code: '566' },
  { name: 'Wema Bank', aliases: ['wema', 'alat'], code: '035' },
  { name: 'Zenith Bank', aliases: ['zenith', 'zenith bank'], code: '057' },
];

/**
 * Find bank code from bank name mention
 */
function findBankCode(bankName) {
  if (!bankName) return null;
  const lower = bankName.toLowerCase().trim();
  
  for (const bank of NIGERIAN_BANKS) {
    if (bank.aliases.some(alias => lower.includes(alias))) {
      return { code: bank.code, name: bank.name };
    }
  }
  return null;
}

/**
 * Get all bank names for display
 */
function getBankList() {
  return NIGERIAN_BANKS.map(b => b.name).join(', ');
}

module.exports = { NIGERIAN_BANKS, findBankCode, getBankList };
