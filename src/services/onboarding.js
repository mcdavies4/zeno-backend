/**
 * Onboarding Service
 *
 * Handles new user registration flow:
 * 1. Welcome message
 * 2. Collect full name
 * 3. Collect email
 * 4. Set 4-digit PIN
 * 5. Confirm PIN
 * 6. Account created
 */

const whatsappService = require('./whatsapp');
const sessionStore = require('./sessionStore');
const { hashPin } = require('../utils/pinUtils');
const logger = require('../utils/logger');

// Onboarding steps in order
const STEPS = {
  WELCOME: 'welcome',
  NAME: 'awaiting_name',
  EMAIL: 'awaiting_email',
  PIN: 'awaiting_pin',
  PIN_CONFIRM: 'awaiting_pin_confirm',
  COMPLETE: 'complete',
};

/**
 * Check if a user needs onboarding and start it if so.
 * Returns true if onboarding is in progress (caller should stop normal flow).
 */
async function checkAndHandleOnboarding(from, session, incomingText) {
  // Already onboarded — let normal flow handle it
  if (session.isOnboarded) return false;

  // Not started yet — kick off onboarding
  if (!session.onboardingStep) {
    await startOnboarding(from);
    return true;
  }

  // In progress — handle current step
  await handleStep(from, session, incomingText);
  return true;
}

// ─── START ONBOARDING ─────────────────────────────────
async function startOnboarding(from) {
  await sessionStore.update(from, { onboardingStep: STEPS.NAME });

  await whatsappService.sendText(from,
    `👋 *Welcome to Zeno!*\n\n` +
    `I'm your personal AI banking assistant. I can help you:\n` +
    `💸 Send money instantly\n` +
    `💰 Check your balance\n` +
    `📊 Track your spending\n` +
    `📄 Pay bills\n\n` +
    `Let's get you set up in 2 minutes.\n\n` +
    `First, what's your *full name*?`
  );
}

// ─── HANDLE EACH STEP ─────────────────────────────────
async function handleStep(from, session, input) {
  const step = session.onboardingStep;

  switch (step) {

    case STEPS.NAME: {
      const name = input.trim();
      if (name.length < 2) {
        await whatsappService.sendText(from, "Please enter your full name (at least 2 characters):");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.EMAIL,
        onboardingData: { ...session.onboardingData, name },
      });
      await whatsappService.sendText(from,
        `Nice to meet you, *${name.split(' ')[0]}*! 😊\n\nWhat's your *email address*? (Used for account recovery only)`
      );
      break;
    }

    case STEPS.EMAIL: {
      const email = input.trim().toLowerCase();
      if (!isValidEmail(email)) {
        await whatsappService.sendText(from, "That doesn't look like a valid email. Please try again:");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN,
        onboardingData: { ...session.onboardingData, email },
      });
      await whatsappService.sendText(from,
        `✅ Got it!\n\n` +
        `Now let's secure your account. Please create a *4-digit PIN*.\n\n` +
        `🔐 You'll use this to authorise every payment.\n\n` +
        `_Never share your PIN with anyone, including Zeno support._`
      );
      break;
    }

    case STEPS.PIN: {
      const pin = input.trim();
      if (!/^\d{4}$/.test(pin)) {
        await whatsappService.sendText(from, "Your PIN must be exactly *4 digits* (numbers only). Please try again:");
        return;
      }
      // Check for weak PINs
      if (isWeakPin(pin)) {
        await whatsappService.sendText(from,
          "That PIN is too easy to guess (e.g. 1234, 0000). Please choose a stronger PIN:"
        );
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN_CONFIRM,
        onboardingData: { ...session.onboardingData, tempPin: pin },
      });
      await whatsappService.sendText(from, "Please *confirm your PIN* by entering it again:");
      break;
    }

    case STEPS.PIN_CONFIRM: {
      const pin = input.trim();
      const tempPin = session.onboardingData?.tempPin;

      if (pin !== tempPin) {
        await sessionStore.update(from, { onboardingStep: STEPS.PIN });
        await whatsappService.sendText(from,
          "❌ PINs don't match. Let's try again — please enter your *4-digit PIN*:"
        );
        return;
      }

      // Hash the PIN securely
      const hashedPin = await hashPin(pin);
      const { name, email } = session.onboardingData;

      // Save completed user profile
      await sessionStore.update(from, {
        isOnboarded: true,
        onboardingStep: STEPS.COMPLETE,
        onboardingData: null,  // clear temp data
        userPin: hashedPin,
        userName: name,
        userEmail: email,
        balance: 0,           // real balance fetched from banking API
        recentTransactions: [],
      });

      logger.info(`New user onboarded: ${name} (${from})`);

      await whatsappService.sendText(from,
        `🎉 *Welcome to Zeno, ${name.split(' ')[0]}!*\n\n` +
        `Your account is ready. Here's what you can do:\n\n` +
        `💸 *Send money* — "Send £50 to John"\n` +
        `💰 *Check balance* — "What's my balance?"\n` +
        `📊 *Spending* — "Show my spending"\n` +
        `📄 *Pay bills* — "Pay my electricity bill"\n\n` +
        `What would you like to do first?`
      );
      break;
    }

    default:
      await startOnboarding(from);
  }
}

// ─── HELPERS ──────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isWeakPin(pin) {
  const weakPins = [
    '0000', '1111', '2222', '3333', '4444',
    '5555', '6666', '7777', '8888', '9999',
    '1234', '4321', '0123', '9876',
  ];
  return weakPins.includes(pin);
}

module.exports = { checkAndHandleOnboarding, STEPS };
