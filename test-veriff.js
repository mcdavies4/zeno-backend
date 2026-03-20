/**
 * Veriff Webhook Test Script
 * 
 * Run this to simulate a Veriff verification result
 * and confirm the WhatsApp notification works.
 * 
 * Usage: node test-veriff.js <phone_number> <status>
 * Example: node test-veriff.js 447459233682 approved
 */

const https = require('https');

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://zeno-backend-production-6a30.up.railway.app';

const phoneNumber = process.argv[2] || '447459233682';
const status = process.argv[3] || 'approved';

const payload = JSON.stringify({
  action: 'verification.completed',
  verification: {
    id: 'test-' + Date.now(),
    status: status,
    code: status === 'approved' ? 9001 : 9102,
    vendorData: phoneNumber,
    person: {
      firstName: 'Test',
      lastName: 'User',
    },
  },
});

console.log(`\n🧪 Testing Veriff webhook...`);
console.log(`📱 Phone: ${phoneNumber}`);
console.log(`✅ Status: ${status}`);
console.log(`🌐 URL: ${RAILWAY_URL}/veriff/webhook\n`);

const url = new URL(`${RAILWAY_URL}/veriff/webhook`);

const options = {
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'x-hmac-signature': 'test-bypass',
  },
};

const req = https.request(options, (res) => {
  console.log(`📡 Response status: ${res.statusCode}`);
  if (res.statusCode === 200) {
    console.log(`✅ Webhook received successfully!`);
    console.log(`📲 Check WhatsApp on ${phoneNumber} for the verification message!\n`);
  } else {
    console.log(`❌ Unexpected status code: ${res.statusCode}\n`);
  }
});

req.on('error', (err) => {
  console.error(`❌ Error: ${err.message}\n`);
});

req.write(payload);
req.end();
