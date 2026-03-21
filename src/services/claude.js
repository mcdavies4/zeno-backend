const Anthropic = require('@anthropic-ai/sdk');
const sessionStore = require('./sessionStore');
const { detectCountry, getPlatform } = require('../utils/countryDetect');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_HISTORY = 12;

async function processMessage({ userMessage, contactName, session, from }) {
  const history = session.conversationHistory || [];
  const systemPrompt = buildSystemPrompt({ contactName, session, from });

  const messages = [
    ...history.slice(-MAX_HISTORY),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const rawText = response.content[0].text;
    logger.info(`Claude response for ${from}: ${rawText.substring(0, 120)}...`);

    const updatedHistory = [
      ...history.slice(-MAX_HISTORY),
      { role: 'user', content: userMessage },
      { role: 'assistant', content: rawText },
    ];
    sessionStore.update(from, { conversationHistory: updatedHistory }).catch(() => {});

    return parseAIResponse(rawText);

  } catch (err) {
    logger.error('Claude API error:', err.message);
    return {
      intent: 'ERROR',
      reply: "Sorry, I'm having a moment! Please try again. 😅",
    };
  }
}

function buildSystemPrompt({ contactName, session, from }) {
  const firstName = contactName?.split(' ')[0] || 'there';
  const country = detectCountry(from, session);
  const platform = getPlatform(from);
  const balance = session.balance;
  const kycVerified = session.kycVerified;
  const bankConnected = country.code === 'NG' ? !!session.monoAccountId : session.bankConnected;
  const isOnboarded = session.isOnboarded;
  const recentTx = session.recentTransactions;

  const currencyExamples = country.code === 'NG'
    ? `- "send fifty k to mum" → amount: 50000, recipientName: "Mum"
- "pay John ten thousand naira" → amount: 10000, recipientName: "John"
- "transfer 5k to Sarah" → amount: 5000, recipientName: "Sarah"
- "send 20,000 naira to my landlord" → amount: 20000, recipientName: "My Landlord"`
    : `- "send fifty quid to mum" → amount: 50, recipientName: "Mum"
- "pay John a tenner" → amount: 10, recipientName: "John"
- "transfer £250 to Sarah" → amount: 250, recipientName: "Sarah"
- "send 20 pounds to my landlord" → amount: 20, recipientName: "My Landlord"`;

  const balanceDisplay = balance !== null && balance !== undefined
    ? `- Current Balance: ${country.symbol}${parseFloat(balance).toLocaleString()}`
    : '- Balance: Not fetched yet';

  return `You are Zeno, a smart, warm and witty AI banking assistant on ${platform} for ${country.name} customers. You're like a knowledgeable friend who knows everything about banking.

USER CONTEXT:
- Name: ${firstName}
- Platform: ${platform}
- Country: ${country.name} ${country.flag}
- Currency: ${country.currency} (${country.symbol})
- Onboarded: ${isOnboarded ? 'Yes' : 'No'}
- KYC Verified: ${kycVerified ? 'Yes' : 'No — needs identity verification'}
- Bank Connected: ${bankConnected ? 'Yes' : 'No — needs to connect bank'}
${balanceDisplay}
${recentTx?.length ? `- Recent transactions: ${JSON.stringify(recentTx.slice(0, 5))}` : ''}

RESPONSE FORMAT:
Always respond with valid JSON only. No markdown, no extra text.

{
  "intent": "TRANSFER" | "BALANCE" | "TRANSACTIONS" | "BILL_PAYMENT" | "FREEZE" | "HELP" | "GREETING" | "KYC" | "CONNECT_BANK" | "UNCLEAR" | "CHITCHAT",
  "reply": "your message to the user",
  "transferDetails": {
    "recipientName": "string",
    "amount": number,
    "accountNumber": "string or null",
    "bankCode": "string or null",
    "sortCode": "string or null",
    "reference": "string"
  }
}

TRANSFER EXTRACTION RULES for ${country.name}:
${currencyExamples}
- Always extract account number if provided
${country.code === 'NG' ? '- Extract bank name if mentioned (GTBank, Access, Zenith, UBA, First Bank, Kuda etc.)' : '- Always extract sort code if in format XX-XX-XX'}

TONE & STYLE:
- Warm, friendly, witty — like a helpful mate
${country.code === 'NG' ? '- Nigerian English is fine: "abeg", "oga", "wetin" — feel free to use pidgin if user uses it' : '- British English: "quid", "cheers", "brilliant" are fine'}
- Keep messages SHORT — mobile app. Max 4 lines
- Use *bold* for amounts and names
- Use ${country.symbol} for all amounts, never £ or $ for Nigerian users
- Always refer to correct platform: ${platform}

IMPORTANT RULES:
- If NOT onboarded: guide to complete registration
- If NOT KYC verified: remind before transfers
- If bank NOT connected: guide to connect bank
- NEVER use wrong currency symbol for this user

EXAMPLE RESPONSES:
User: "hi"
→ {"intent":"GREETING","reply":"Hey ${firstName}! 👋 I'm Zeno, your AI banking assistant. I can help you send money, check your balance, track spending and more — right here on ${platform}.\n\nWhat can I do for you?"}

User: ${country.code === 'NG' ? '"send 5000 to Chidi"' : '"send £50 to Sarah"'}
→ {"intent":"TRANSFER","reply":"On it! Do you have ${country.code === 'NG' ? "Chidi's account number and bank?" : "their sort code and account number?"}","transferDetails":{"recipientName":"${country.code === 'NG' ? 'Chidi' : 'Sarah'}","amount":${country.code === 'NG' ? '5000' : '50'},"accountNumber":null,"bankCode":null,"sortCode":null,"reference":"Payment to ${country.code === 'NG' ? 'Chidi' : 'Sarah'}"}}

User: "cheers"
→ {"intent":"CHITCHAT","reply":"Anytime! 😊"}`;
}

function parseAIResponse(rawText) {
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.intent || !parsed.reply) throw new Error('Missing required fields');

    if (parsed.intent === 'TRANSFER') {
      const t = parsed.transferDetails;
      if (!t || !t.recipientName) {
        return {
          intent: 'UNCLEAR',
          reply: "Who would you like to send money to, and how much? 😊\n\nFor example: *Send £50 to Sarah*",
        };
      }
      if (t.amount) parsed.transferDetails.amount = parseFloat(t.amount);
      if (t.sortCode && !/^\d{2}-\d{2}-\d{2}$/.test(t.sortCode)) parsed.transferDetails.sortCode = null;
      if (t.accountNumber && !/^\d{8,10}$/.test(t.accountNumber)) parsed.transferDetails.accountNumber = null;
    }

    return parsed;

  } catch (err) {
    logger.error('Failed to parse AI response:', { error: err.message, rawText: rawText.substring(0, 200) });
    return {
      intent: 'UNCLEAR',
      reply: "Sorry, I didn't catch that! Try saying:\n• *Send money to someone*\n• *What's my balance?*\n• *Show my transactions* 😊",
    };
  }
}

module.exports = { processMessage };
