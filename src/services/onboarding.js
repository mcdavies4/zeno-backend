/**
 * Onboarding Service — with Veriff KYC
 */

const messenger = require('./messenger');
const sessionStore = require('./sessionStore');
const { hashPin } = require('../utils/pinUtils');
const logger = require('../utils/logger');

const STEPS = {
  WELCOME: 'welcome',
  NAME: 'awaiting_name',
  EMAIL: 'awaiting_email',
  PIN: 'awaiting_pin',
  PIN_CONFIRM: 'awaiting_pin_confirm',
  COMPLETE: 'complete',
};

async function checkAndHandleOnboarding(from, session, incomingText) {
  if (session.isOnboarded) return false;
  if (!session.onboardingStep) {
    await startOnboarding(from);
    return true;
  }
  await handleStep(from, session, incomingText);
  return true;
}

async function startOnboarding(from) {
  await sessionStore.update(from, { onboardingStep: STEPS.NAME });
  await messenger.sendText(from,
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

async function handleStep(from, session, input) {
  const step = session.onboardingStep;

  switch (step) {
    case STEPS.NAME: {
      const name = input.trim();
      if (name.length < 2) {
        await messenger.sendText(from, "Please enter your full name (at least 2 characters):");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.EMAIL,
        onboardingData: { ...session.onboardingData, name },
      });
      await messenger.sendText(from,
        `Nice to meet you, *${name.split(' ')[0]}*! 😊\n\nWhat's your *email address*?`
      );
      break;
    }

    case STEPS.EMAIL: {
      const email = input.trim().toLowerCase();
      if (!isValidEmail(email)) {
        await messenger.sendText(from, "That doesn't look like a valid email. Please try again:");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN,
        onboardingData: { ...session.onboardingData, email },
      });
      await messenger.sendText(from,
        `✅ Got it!\n\nNow create a *4-digit PIN* to secure your account.\n\n🔐 You'll use this to authorise every payment.\n\n_Never share your PIN with anyone._`
      );
      break;
    }

    case STEPS.PIN: {
      const pin = input.trim();
      if (!/^\d{4}$/.test(pin)) {
        await messenger.sendText(from, "Your PIN must be exactly *4 digits*. Please try again:");
        return;
      }
      if (isWeakPin(pin)) {
        await messenger.sendText(from, "That PIN is too easy to guess. Please choose a stronger PIN:");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN_CONFIRM,
        onboardingData: { ...session.onboardingData, tempPin: pin },
      });
      await messenger.sendText(from, "Please *confirm your PIN* by entering it again:");
      break;
    }

    case STEPS.PIN_CONFIRM: {
      const pin = input.trim();
      const tempPin = session.onboardingData?.tempPin;

      if (pin !== tempPin) {
        await sessionStore.update(from, { onboardingStep: STEPS.PIN });
        await messenger.sendText(from, "❌ PINs don't match. Please enter your *4-digit PIN* again:");
        return;
      }

      const hashedPin = await hashPin(pin);
      const { name, email } = session.onboardingData;

      await sessionStore.update(from, {
        isOnboarded: true,
        onboardingStep: STEPS.COMPLETE,
        onboardingData: null,
        userPin: hashedPin,
        userName: name,
        userEmail: email,
        balance: 0,
        recentTransactions: [],
      });

      logger.info(`New user onboarded: ${name} (${from})`);

      await messenger.sendText(from,
        `🎉 *Welcome to Zeno, ${name.split(' ')[0]}!*\n\n` +
        `Your account is created!\n\n` +
        `*One last step* — verify your identity to comply with UK regulations.\n\n` +
        `You'll need:\n📄 A valid UK ID (passport or driving licence)\n🤳 A selfie\n\n` +
        `Getting your verification link...`
      );

      // Trigger KYC
      try {
        const veriffService = require('./veriff');
        const nameParts = name.split(' ');
        const kycSession = await veriffService.createSession({
          phoneNumber: from,
          firstName: nameParts[0] || name,
          lastName: nameParts.slice(1).join(' ') || '',
        });
        await sessionStore.update(from, { kycSessionId: kycSession.sessionId });
        await messenger.sendText(from,
          `🔐 *Verify Your Identity*\n\n` +
          `Tap the link below:\n\n` +
          `${kycSession.sessionUrl}\n\n` +
          `_This link expires in 7 days. Fully encrypted and secure._`
        );
      } catch(e) {
        logger.error('KYC session creation failed:', e.message);
        await messenger.sendText(from,
          `You can start using Zeno now!\n\n` +
          `💸 *Send money* — "Send £50 to John"\n` +
          `💰 *Check balance* — "What's my balance?"\n\n` +
          `Type *'verify my identity'* to complete verification later.`
        );
      }
      break;
    }

    default:
      await startOnboarding(from);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isWeakPin(pin) {
  const weakPins = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876'];
  return weakPins.includes(pin);
}

module.exports = { checkAndHandleOnboarding, STEPS };
