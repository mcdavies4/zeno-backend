const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep last N messages per user for context
const MAX_HISTORY = 10;

/**
 * Process an incoming user message and return a structured intent + reply.
 */
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
    logger.info(`Claude response for ${from}: ${rawText.substring(0, 100)}...`);

    // Update conversation history
    const updatedHistory = [
      ...history.slice(-MAX_HISTORY),
      { role: 'user', content: userMessage },
      { role: 'assistant', content: rawText },
    ];

    // Save history to session (don't await — non-blocking)
    const { sessionStore } = require('./sessionStoreRef');
    sessionStore?.update(from, { conversationHistory: updatedHistory });

    return parseAIResponse(rawText);

  } catch (err) {
    logger.error('Claude API error:', err);
    return {
      intent: 'ERROR',
      reply: "I'm having trouble understanding right now. Please try again in a moment.",
    };
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────
function buildSystemPrompt({ contactName, session }) {
  const balance = session.balance ?? null;
  const firstName = contactName?.split(' ')[0] || 'there';

  return `You are Zeno, a friendly and efficient AI banking assistant operating on WhatsApp for UK customers.

User's first name: ${firstName}
${balance !== null ? `User's current balance: £${balance}` : ''}
${session.recentTransactions?.length ? `Recent transactions: ${JSON.stringify(session.recentTransactions)}` : ''}

Your job is to understand banking requests and respond in a STRICT JSON format so the system can take action.

ALWAYS respond with valid JSON only — no markdown, no extra text, just the JSON object.

Response format:
{
  "intent": "TRANSFER" | "BALANCE" | "TRANSACTIONS" | "HELP" | "GREETING" | "UNCLEAR",
  "reply": "your friendly message to the user",
  "transferDetails": {              // only when intent is TRANSFER
    "recipientName": "string",
    "amount": number,               // always a positive number, no currency symbol
    "sortCode": "string or null",   // UK sort code, format: 20-00-00
    "accountNumber": "string or null", // 8-digit UK account number
    "reference": "string"           // payment reference
  }
}

Rules:
- Be warm, concise, and use British English. Say "pounds" not "dollars".
- For TRANSFER: extract recipient, amount, sort code and account number if given. If sort code/account not provided, set them to null — the system will ask the user separately.
- For amounts like "fifty quid", "£50", "50 pounds", "50 gbp" — extract the number 50.
- For BALANCE: give a friendly balance response using the balance provided. If no balance is available, say you're fetching it.
- For TRANSACTIONS: list the recent transactions clearly.
- For GREETING: welcome the user warmly and show them what you can do.
- For UNCLEAR: ask a clarifying question to understand what they need.
- Never make up transaction IDs, sort codes, or account numbers.
- Never ask for PINs in chat — the system handles that separately.
- Keep replies short (WhatsApp is a mobile app). Max 3-4 lines unless listing transactions.
- Use WhatsApp formatting: *bold* for amounts and names.`;
}

// ─── PARSE AI JSON RESPONSE ───────────────────────────
function parseAIResponse(rawText) {
  try {
    // Strip any accidental markdown code fences
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.intent || !parsed.reply) {
      throw new Error('Missing required fields in AI response');
    }

    // Validate transfer details if present
    if (parsed.intent === 'TRANSFER') {
      const t = parsed.transferDetails;
      if (!t || !t.recipientName || !t.amount) {
        return {
          intent: 'UNCLEAR',
          reply: "I want to help you send money! Could you tell me who you're sending to and how much? For example: *'Send £50 to John Smith'*",
        };
      }
      // Ensure amount is a number
      parsed.transferDetails.amount = parseFloat(t.amount);

      // Validate UK sort code format if provided
      if (t.sortCode && !/^\d{2}-\d{2}-\d{2}$/.test(t.sortCode)) {
        parsed.transferDetails.sortCode = null;
      }

      // Validate UK account number if provided
      if (t.accountNumber && !/^\d{8}$/.test(t.accountNumber)) {
        parsed.transferDetails.accountNumber = null;
      }
    }

    return parsed;

  } catch (err) {
    logger.error('Failed to parse AI response:', { error: err.message, rawText });
    return {
      intent: 'UNCLEAR',
      reply: "I didn't quite catch that. Could you rephrase? You can say things like:\n• *Send £50 to Sarah*\n• *What's my balance?*\n• *Show my recent transactions*",
    };
  }
}

module.exports = { processMessage };
