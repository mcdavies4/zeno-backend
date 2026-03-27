/**
 * Onboarding Service — Nigeria focused
 */

const messenger = require('./messenger');
const sessionStore = require('./sessionStore');
const { hashPin } = require('../utils/pinUtils');
const logger = require('../utils/logger');
const virtualAccount = require('./virtualAccount');

const STEPS = {
  WELCOME: 'welcome',
  TERMS: 'awaiting_terms',
  NAME: 'awaiting_name',
  EMAIL: 'awaiting_email',
  PIN: 'awaiting_pin',
  PIN_CONFIRM: 'awaiting_pin_confirm',
  COMPLETE: 'complete',
};

const COUNTRY_OPTIONS = {
  '1': { code: 'UK', name: 'United Kingdom', symbol: '£', flag: '🇬🇧' },
  '2': { code: 'NG', name: 'Nigeria', symbol: '₦', flag: '🇳🇬' },
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
  await sessionStore.update(from, { onboardingStep: STEPS.TERMS });
  await messenger.sendText(from,
    `👋 *Welcome to Zeno!*\n\n` +
    `I'm your AI banking assistant by The 36th Company. I can help you:\n` +
    `💸 Send money instantly\n` +
    `💰 Check your balance\n` +
    `📊 Track your spending\n` +
    `📱 Pay bills & airtime\n\n` +
    `Before we start, please read and accept our terms:\n` +
    `📋 Terms: https://www.joinzeno.co.uk/terms\n` +
    `🔒 Privacy: https://www.joinzeno.co.uk/privacy\n\n` +
    `Reply *"I agree"* to continue ✅`
  );
}

async function handleStep(from, session, input) {
  const step = session.onboardingStep;
  const text = input.trim();

  switch (step) {

    case STEPS.TERMS: {
      const accepted = input.toLowerCase().includes('agree') ||
                       input.toLowerCase().includes('accept') ||
                       input.toLowerCase().includes('yes') ||
                       input === '1';
      if (!accepted) {
        await messenger.sendText(from,
          `Please reply *"I agree"* to accept our Terms & Privacy Policy and continue.\n\n` +
          `📋 https://www.joinzeno.co.uk/terms`
        );
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.NAME,
        termsAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
      });
      await messenger.sendText(from, `✅ Great! Let's get you set up.\n\nWhat's your *full name*?`);
      return;
    }

    case STEPS.NAME: {
      if (text.length < 2) {
        await messenger.sendText(from, "Please enter your full name (at least 2 characters):");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.EMAIL,
        onboardingData: { ...session.onboardingData, name: text },
      });
      await messenger.sendText(from,
        `Nice to meet you, *${text.split(' ')[0]}*! 😊\n\nWhat's your *email address*?`
      );
      break;
    }

    case STEPS.EMAIL: {
      const email = text.toLowerCase();
      if (!isValidEmail(email)) {
        await messenger.sendText(from, "That doesn't look like a valid email. Please try again:");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN,
        onboardingData: { ...session.onboardingData, email },
      });
      await messenger.sendText(from,
        `✅ Got it!\n\nNow create a *4-digit PIN* to secure your account.\n\n🔐 You'll use this to authorise every payment.\n\nNever share your PIN with anyone.`
      );
      break;
    }

    case STEPS.PIN: {
      if (!/^\d{4}$/.test(text)) {
        await messenger.sendText(from, "Your PIN must be exactly *4 digits*. Please try again:");
        return;
      }
      if (isWeakPin(text)) {
        await messenger.sendText(from, "That PIN is too easy to guess. Please choose a stronger one:");
        return;
      }
      await sessionStore.update(from, {
        onboardingStep: STEPS.PIN_CONFIRM,
        onboardingData: { ...session.onboardingData, tempPin: text },
      });
      await messenger.sendText(from, "Please *confirm your PIN* by entering it again:");
      break;
    }

    case STEPS.PIN_CONFIRM: {
      const tempPin = session.onboardingData?.tempPin;
      if (text !== tempPin) {
        await sessionStore.update(from, { onboardingStep: STEPS.PIN });
        await messenger.sendText(from, "❌ PINs don't match. Please enter your *4-digit PIN* again:");
        return;
      }

      const hashedPin = await hashPin(text);
      const { name, email } = session.onboardingData;

      await sessionStore.update(from, {
        onboardingStep: STEPS.COMPLETE,
        onboardingData: { ...session.onboardingData, hashedPin },
        userPin: hashedPin,
        userName: name,
        userEmail: email,
      });

      // Auto-set Nigeria — no country selection needed
      const countryChoice = { code: 'NG', name: 'Nigeria', symbol: '₦', flag: '🇳🇬' };

      await sessionStore.update(from, {
        isOnboarded: true,
        onboardingStep: STEPS.COMPLETE,
        onboardingData: null,
        name,
        email,
        bankingCountry: countryChoice.code,
        balance: 0,
        recentTransactions: [],
      });

      logger.info(`New user onboarded: ${name} (${from}) — banking in ${countryChoice.name}`);

      const isNigeria = countryChoice.code === 'NG';
      const firstName = name.split(' ')[0];

      // Create virtual account for Nigerian users
      let vaData = null;
      if (isNigeria) {
        try {
          vaData = await virtualAccount.createVirtualAccount({
            phoneNumber: from,
            name,
            email,
          });
          await sessionStore.update(from, { virtualAccount: vaData, walletBalance: 0 });
          logger.info(`Virtual account created for ${from}: ${vaData.accountNumber}`);
        } catch(e) {
          logger.error('Virtual account creation failed during onboarding:', e.message);
        }
      }

      // Welcome message
      let welcomeMsg =
        `🎉 *Welcome to Zeno, ${firstName}!*\n\n` +
        `Your account is set up for ${countryChoice.flag} *${countryChoice.name}*!\n\n`;

      if (isNigeria && vaData) {
        welcomeMsg +=
          `💳 *Your Zeno Wallet Account:*\n` +
          `🏦 Bank: *${vaData.bankName}*\n` +
          `🔢 Account No: *${vaData.accountNumber}*\n\n` +
          `Fund your wallet from any Nigerian bank to start sending money!\n\n`;
      }

      welcomeMsg +=
        `*One last step* — verify your identity to stay secure.\n\n` +
        `You'll need:\n` +
        `📄 A valid ID (NIN, passport or driving licence)\n` +
        `🤳 A selfie\n\n` +
        `Getting your verification link...`;

      await messenger.sendText(from, welcomeMsg);

      // Trigger KYC
      try {
        const stripeService = require('./stripe');
        const nameParts = name.split(' ');
        const kycSession = await stripeService.createIdentitySession({
          phoneNumber: from,
          firstName: nameParts[0] || name,
          lastName: nameParts.slice(1).join(' ') || '',
        });
        await sessionStore.update(from, { kycSessionId: kycSession.sessionId });
        await messenger.sendText(from,
          `🔐 *Verify Your Identity*\n\n` +
          `Tap the link below:\n\n` +
          `${kycSession.url}\n\n` +
          `This link expires in 7 days. Fully encrypted and secure.`
        );
      } catch(e) {
        logger.error('KYC session creation failed:', e.message);
        await messenger.sendText(from,
          `You can start using Zeno now!\n\n` +
          `💸 *Send money* — "Send ₦5000 to John"\n💰 *Check balance* — "What\'s my balance?"\n\n` +
          `Type *"verify my identity"* to complete verification later.`
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
  const weak = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876'];
  return weak.includes(pin);
}

module.exports = { checkAndHandleOnboarding, STEPS };
