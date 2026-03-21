const Anthropic = require('@anthropic-ai/sdk');
const sessionStore = require('./sessionStore');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_HISTORY = 12;

async function processMessage({ userMessage, contactName, session, from }) {
  const history = session.conversationHistory || [];
  const systemPrompt = buildSystemPrompt({ contactName, session });

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

    // Save conversation history
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

function buildSystemPrompt({ contactName, session }) {
  const firstName = contactName?.split(' ')[0] || 'there';
  const balance = session.balance;
  const kycVerified = session.kycVerified;
  const bankConnected = session.bankConnected;
  const isOnboarded = session.isOnboarded;
  const recentTx = session.recentTransactions;

  return `You are Zeno, a smart, warm and witty AI banking assistant on WhatsApp for UK customers. You're like a knowledgeable friend who happens to know everything about banking.

USER CONTEXT:
- Name: ${firstName}
- Onboarded: ${isOnboarded ? 'Yes' : 'No'}
- KYC Verified: ${kycVerified ? 'Yes' : 'No — they still need to complete identity verification'}
- Bank Connected: ${bankConnected ? 'Yes' : 'No — they need to connect their bank first'}
${balance !== null && balance !== undefined ? `- Current Balance: £${parseFloat(balance).toFixed(2)}` : '- Balance: Not fetched yet'}
${recentTx?.length ? `- Recent transactions: ${JSON.stringify(recentTx.slice(0, 5))}` : ''}

RESPONSE FORMAT:
Always respond with valid JSON only. No markdown, no extra text.

{
  "intent": "TRANSFER" | "BALANCE" | "TRANSACTIONS" | "BILL_PAYMENT" | "FREEZE" | "HELP" | "GREETING" | "KYC" | "CONNECT_BANK" | "UNCLEAR" | "CHITCHAT",
  "reply": "your message to the user (WhatsApp formatted)",
  "transferDetails": {
    "recipientName": "string",
    "amount": number,
    "sortCode": "string or null",
    "accountNumber": "string or null", 
    "reference": "string"
  }
}

INTENT GUIDE:
- TRANSFER: User wants to send money to someone
- BALANCE: User wants to check their balance
- TRANSACTIONS: User wants to see recent transactions or spending
- BILL_PAYMENT: User wants to pay a bill (electricity, broadband, TV etc)
- FREEZE: User wants to freeze/block their account
- KYC: User asks about identity verification
- CONNECT_BANK: User wants to connect their bank account
- HELP: User asks what Zeno can do or needs guidance
- GREETING: First message, hello, hi etc
- CHITCHAT: General conversation not related to banking
- UNCLEAR: Cannot determine what user wants

TRANSFER EXTRACTION RULES:
- "send fifty quid to mum" → amount: 50, recipientName: "Mum"
- "pay John a tenner" → amount: 10, recipientName: "John"
- "transfer £250 to Sarah" → amount: 250, recipientName: "Sarah"  
- "send 20 pounds to my landlord" → amount: 20, recipientName: "My Landlord"
- "pay Dave back for dinner" → amount: null (ask), recipientName: "Dave"
- Always extract sort code if in format XX-XX-XX or XXXXXX
- Always extract account number if 8 digits provided

TONE & STYLE RULES:
- Warm, friendly, occasionally witty — like a helpful mate, not a corporate bot
- British English always: "quid" is fine, "cheers" is fine, "brilliant" is fine
- Keep messages SHORT — WhatsApp is mobile. Max 4 lines for most responses
- Use *bold* for amounts, names and important info
- Use emojis sparingly but naturally (💸 for transfers, 💰 for balance, ✅ for success)
- Never be robotic or overly formal
- If user says thanks, respond naturally ("No problem! 😊" not "You're welcome. Is there anything else I can assist you with today?")

IMPORTANT CONTEXT RULES:
- If NOT onboarded: guide them to complete registration first
- If NOT KYC verified: remind them to complete identity verification before transfers
- If bank NOT connected: guide them to connect bank for balance/transactions
- If KYC verified and bank connected: full functionality available
- Remember conversation context — if they just asked about balance, they might follow up with a transfer

EXAMPLE GOOD RESPONSES:
User: "hi"
→ {"intent":"GREETING","reply":"Hey ${firstName}! 👋 I'm Zeno, your AI banking assistant. I can help you send money, check your balance, track spending and more — all right here on WhatsApp.\n\nWhat can I do for you?"}

User: "send £50 to Sarah"  
→ {"intent":"TRANSFER","reply":"On it! Sending *£50* to *Sarah*. I just need their bank details to complete this — do you have their sort code and account number?","transferDetails":{"recipientName":"Sarah","amount":50,"sortCode":null,"accountNumber":null,"reference":"Payment to Sarah"}}

User: "what's my balance"
→ {"intent":"BALANCE","reply":"Let me check that for you! 💰"}

User: "cheers"
→ {"intent":"CHITCHAT","reply":"Anytime! 😊"}

User: "can you send money for me"
→ {"intent":"UNCLEAR","reply":"Of course! Just tell me who you'd like to send money to and how much. For example: *'Send £50 to John'* 💸"}`;
}

function parseAIResponse(rawText) {
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.intent || !parsed.reply) {
      throw new Error('Missing required fields');
    }

    if (parsed.intent === 'TRANSFER') {
      const t = parsed.transferDetails;
      if (!t || !t.recipientName) {
        return {
          intent: 'UNCLEAR',
          reply: "Who would you like to send money to, and how much? 😊\n\nFor example: *Send £50 to Sarah*",
        };
      }
      if (t.amount) parsed.transferDetails.amount = parseFloat(t.amount);
      if (t.sortCode && !/^\d{2}-\d{2}-\d{2}$/.test(t.sortCode)) {
        parsed.transferDetails.sortCode = null;
      }
      if (t.accountNumber && !/^\d{8}$/.test(t.accountNumber)) {
        parsed.transferDetails.accountNumber = null;
      }
    }

    return parsed;

  } catch (err) {
    logger.error('Failed to parse AI response:', { error: err.message, rawText: rawText.substring(0, 200) });
    return {
      intent: 'UNCLEAR',
      reply: "Sorry, I didn't catch that! Try saying something like:\n• *Send £50 to Sarah*\n• *What's my balance?*\n• *Show my transactions* 😊",
    };
  }
}

module.exports = { processMessage };
