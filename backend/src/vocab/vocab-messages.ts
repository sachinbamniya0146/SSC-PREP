// Vocabulary v2 (Sep 29 2026) — prices, timing rules and the bilingual
// (English + Hindi) messages shown around the daily revision, the pay-to-skip
// flow and the pay-to-unlock flows.
//
// Every message is returned to the client as { en, hi } so the UI can show
// BOTH languages together ("Esa poore English or Hindi dono me message aaye").
// Amounts are computed server-side only — the browser never decides a price.

export interface BiMsg {
  en: string;
  hi: string;
}

/** Rs 2 to force-unlock ONE locked word (Sachin: "2rs per word"). */
export const VOCAB_WORD_UNLOCK_PRICE_INR = 2;
/** Rs 100 to unlock EVERY word at once. */
export const VOCAB_UNLOCK_ALL_PRICE_INR = 100;

/** Questions asked per word in the daily revision (50 words -> 100 questions). */
export const REVISION_QUESTIONS_PER_WORD = 2;
/** Safety cap so a student with 800 unlocked words is not handed a 1600-question test. */
export const REVISION_MAX_WORDS = Math.max(5, parseInt(process.env.VOCAB_REVISION_MAX_WORDS || '100', 10) || 100);
/** Timer: seconds allowed per question (revision AND the per-word practice quiz). */
export const VOCAB_SECONDS_PER_QUESTION = Math.max(10, parseInt(process.env.VOCAB_SECONDS_PER_QUESTION || '30', 10) || 30);
/** Extra seconds tolerated for network delay when a revision is submitted. */
export const REVISION_SUBMIT_GRACE_SEC = 20;

/**
 * Escalating skip fee ladder (Rs). Skip #1 costs 1, skip #2 costs 5, ... and
 * the last value repeats. Reset to the first value once a revision test is
 * completed. Override with VOCAB_SKIP_FEES="1,5,10,20,50,100".
 */
export const SKIP_FEE_LADDER_INR: number[] = (() => {
  const raw = (process.env.VOCAB_SKIP_FEES || '1,5,10,20,50,100')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return raw.length ? raw : [1, 5, 10, 20, 50, 100];
})();

export function skipFeeForStreak(streak: number): number {
  const i = Math.min(Math.max(0, Math.floor(streak || 0)), SKIP_FEE_LADDER_INR.length - 1);
  return SKIP_FEE_LADDER_INR[i];
}

export function quizTimeLimitSec(questionCount: number): number {
  return Math.min(5400, Math.max(60, Math.round(questionCount * VOCAB_SECONDS_PER_QUESTION)));
}

export const VOCAB_MSG = {
  revisionPending(words: number, questions: number, minutes: number, skipFee: number): BiMsg {
    return {
      en: `Today's revision is pending: ${words} word(s), ${questions} questions, ${minutes} min. Complete it to continue with new words — or skip it for ₹${skipFee} (the test comes back tomorrow).`,
      hi: `आज की रिवीजन बाकी है: ${words} शब्द, ${questions} प्रश्न, ${minutes} मिनट। नए शब्दों पर जाने के लिए इसे पूरा करें — या ₹${skipFee} देकर छोड़ें (टेस्ट कल फिर आएगा)।`,
    };
  },
  skipWarning(fee: number, nextFee: number): BiMsg {
    return {
      en: `You are skipping today's revision for ₹${fee}. Tomorrow the test will be due again, and the next skip will cost ₹${nextFee}. Revising is free — study properly, don't waste your money.`,
      hi: `आप आज की रिवीजन ₹${fee} देकर छोड़ रहे हैं। कल फिर से टेस्ट देना होगा, और अगली बार छोड़ने पर ₹${nextFee} लगेंगे। रिवीजन मुफ़्त है — पढ़ाई अच्छे से करें, पैसे बर्बाद न करें।`,
    };
  },
  skipDone(nextFee: number): BiMsg {
    return {
      en: `Skipped for today. Tomorrow the revision test is due again. Next skip will cost ₹${nextFee}.`,
      hi: `आज के लिए छोड़ दिया गया। कल फिर से रिवीजन टेस्ट होगा। अगली बार छोड़ने पर ₹${nextFee} लगेंगे।`,
    };
  },
  remasterRequired(words: string[]): BiMsg {
    const list = words.slice(0, 8).join(', ') + (words.length > 8 ? '…' : '');
    return {
      en: `You got questions wrong in: ${list}. Score 95%+ again on each of these words before you can move to new words.`,
      hi: `इन शब्दों में गलतियाँ हुईं: ${list}। नए शब्दों पर जाने से पहले हर शब्द में फिर से 95%+ स्कोर करना ज़रूरी है।`,
    };
  },
  revisionAllClear: {
    en: 'Perfect revision! Every word is fresh in your memory. See you tomorrow.',
    hi: 'शानदार रिवीजन! सभी शब्द याद हैं। कल फिर मिलते हैं।',
  } as BiMsg,
  revisionExpired: {
    en: 'Time is up — this revision was not submitted in time. Start again, or skip today for a fee.',
    hi: 'समय समाप्त — यह रिवीजन समय पर जमा नहीं हुआ। फिर से शुरू करें, या शुल्क देकर आज छोड़ें।',
  } as BiMsg,
  revisionAlreadyDone: {
    en: "Today's revision is already done. Come back tomorrow.",
    hi: 'आज की रिवीजन हो चुकी है। कल फिर आइए।',
  } as BiMsg,
  nothingToRevise: {
    en: 'No words to revise yet. Master your first word (95%+) and revision starts from tomorrow.',
    hi: 'अभी रिवीजन के लिए कोई शब्द नहीं है। पहला शब्द (95%+) पूरा करें — रिवीजन कल से शुरू होगा।',
  } as BiMsg,
  wordLocked(prevWord: string): BiMsg {
    return {
      en: `This word is locked. Score 95%+ on "${prevWord}" to unlock it normally. If you still want to jump ahead, you can unlock just this word for ₹${VOCAB_WORD_UNLOCK_PRICE_INR}.`,
      hi: `यह शब्द लॉक है। इसे सामान्य तरीके से खोलने के लिए "${prevWord}" में 95%+ स्कोर करें। फिर भी आगे जाना चाहते हैं तो सिर्फ़ यह शब्द ₹${VOCAB_WORD_UNLOCK_PRICE_INR} में खोल सकते हैं।`,
    };
  },
  unlockWordWarning: {
    en: `Unlock this word by scoring 95%+ on the previous word — it's free. Pay ₹${VOCAB_WORD_UNLOCK_PRICE_INR} only if you really want to skip ahead.`,
    hi: `पिछले शब्द में 95%+ स्कोर करके यह शब्द मुफ़्त में खुल जाता है। सच में आगे बढ़ना हो तभी ₹${VOCAB_WORD_UNLOCK_PRICE_INR} दें।`,
  } as BiMsg,
  unlockAllWarning: {
    en: `Read first, bro! Finishing words every day and paying money makes no sense — study properly, don't waste your money. If you still want every word unlocked together, it costs ₹${VOCAB_UNLOCK_ALL_PRICE_INR}.`,
    hi: `पहले पढ़ ले भाई! रोज़ शब्द पूरे करने के बजाय पैसे देने का क्या मतलब — पढ़ाई अच्छे से कर, पैसे बर्बाद ना कर। फिर भी सारे शब्द एक साथ खोलने हैं तो ₹${VOCAB_UNLOCK_ALL_PRICE_INR} लगेंगे।`,
  } as BiMsg,
};
