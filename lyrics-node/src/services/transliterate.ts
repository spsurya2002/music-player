import type { Script } from '../utils/text.js';

/**
 * Romanisation for lyrics nobody in the room can read.
 *
 * Every online transliteration service we tried turns this machine away, so
 * this is done locally: deterministic, instant, and it cannot be blocked. The
 * output is an approximation and is always labelled as one — Urdu is written
 * without short vowels, so "زلفوں" could be zulfon or zalfon and no rule can
 * know which. A dictionary of the words that actually fill songs carries the
 * common cases; letter rules handle the rest.
 */

/** Marks, hamzas and the like, stripped before a word is looked up. */
const URDU_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/** The words songs are mostly made of, spelled the way people write them. */
const URDU_WORDS: Record<string, string> = {
  ہے: 'hai', ہیں: 'hain', ہو: 'ho', ہوں: 'hoon', ہوا: 'hua', ہوئی: 'hui', ہوتا: 'hota',
  ہوتی: 'hoti', تھا: 'tha', تھی: 'thi', تھے: 'the', نے: 'ne', یہ: 'ye', وہ: 'woh', میں: 'mein',
  ميں: 'mein', مجھے: 'mujhe', مجھ: 'mujh', مجھکو: 'mujhko', تجھے: 'tujhe', تجھ: 'tujh',
  تم: 'tum', تو: 'tu', آپ: 'aap', ہم: 'hum', کو: 'ko', کے: 'ke', کا: 'ka', کی: 'ki', سے: 'se',
  پر: 'par', پہ: 'pe', اور: 'aur', نہیں: 'nahin', نہ: 'na', جو: 'jo', جب: 'jab', تب: 'tab',
  کیا: 'kya', کیوں: 'kyun', کہاں: 'kahan', کچھ: 'kuch', سب: 'sab', اب: 'ab', پھر: 'phir',
  بہت: 'bohat', بھی: 'bhi', ہی: 'hi', تک: 'tak', لیے: 'liye', ساتھ: 'saath', بعد: 'baad',
  پہلے: 'pehle', اک: 'ik', ایک: 'ek', دو: 'do', کوئی: 'koi', کسی: 'kisi', کس: 'kis', کون: 'kaun',
  اپنے: 'apne', اپنی: 'apni', اپنا: 'apna', میرا: 'mera', میری: 'meri', میرے: 'mere',
  تیرا: 'tera', تیری: 'teri', تیرے: 'tere', ہمارا: 'hamara', تمہارا: 'tumhara', ان: 'un',
  اس: 'is', یہاں: 'yahan', وہاں: 'wahan', آج: 'aaj', کل: 'kal', ابھی: 'abhi', کبھی: 'kabhi',
  ہمیشہ: 'hamesha', کر: 'kar', کرتا: 'karta', کرتی: 'karti', کرو: 'karo', کرے: 'kare',
  گیا: 'gaya', گئی: 'gayi', گئے: 'gaye', آیا: 'aaya', آئی: 'aayi', جاتا: 'jata', جاتی: 'jati',
  جائے: 'jaye', جائیں: 'jayen', رہا: 'raha', رہی: 'rahi', رہے: 'rahe', دیا: 'diya', دی: 'di',
  لیا: 'liya', ملا: 'mila', کہا: 'kaha', سنا: 'suna', دیکھا: 'dekha', چلا: 'chala',
  رکھا: 'rakha', لگا: 'laga', سجا: 'saja', جلا: 'jala', بنا: 'bana', دل: 'dil', دلوں: 'dilon',
  پیار: 'pyar', محبت: 'mohabbat', عشق: 'ishq', زندگی: 'zindagi', دنیا: 'duniya', رات: 'raat',
  راتوں: 'raaton', دن: 'din', آنکھ: 'aankh', آنکھیں: 'aankhein', آنسو: 'aansu', یاد: 'yaad',
  خدا: 'khuda', رب: 'rab', دعا: 'dua', خواب: 'khwab', چاند: 'chaand', تارے: 'taare',
  پھول: 'phool', زلف: 'zulf', زلفوں: 'zulfon', چہرہ: 'chehra', ہاتھ: 'haath', قدم: 'qadam',
  راستہ: 'raasta', سفر: 'safar', منزل: 'manzil', وقت: 'waqt', عمر: 'umar', سانس: 'saans',
  جان: 'jaan', دوست: 'dost', یار: 'yaar', صنم: 'sanam', محبوب: 'mehboob', حسن: 'husn',
  نظر: 'nazar', نگاہ: 'nigah', آواز: 'aawaz', درد: 'dard', غم: 'gham', خوشی: 'khushi', آگ: 'aag',
  پانی: 'paani', آسمان: 'aasman', زمین: 'zameen', گلی: 'gali', شہر: 'shehar', گھر: 'ghar',
  راز: 'raaz', وعدہ: 'wada', قسم: 'qasam', امید: 'umeed', انتظار: 'intezaar', جدائی: 'judai',
  تنہا: 'tanha', اکیلا: 'akela', خاموش: 'khamosh', دیوانہ: 'deewana', جنون: 'junoon',
  نور: 'noor', روشنی: 'roshni', اندھیرا: 'andhera', اندھیروں: 'andheron', شام: 'shaam',
  صبح: 'subah', دکھ: 'dukh', سکھ: 'sukh', ساری: 'saari', سارا: 'saara', بات: 'baat',
  باتیں: 'baatein', لفظ: 'lafz', نام: 'naam', دیکھ: 'dekh', سن: 'sun', چل: 'chal', آ: 'aa',
  جا: 'ja', رہ: 'reh', لے: 'le', دے: 'de', قسمت: 'kismat', مری: 'meri', مرے: 'mere', لکھ: 'likh',
  جنت: 'jannat', لئے: 'liye', مگر: 'magar', گوارا: 'gawara', کاتب: 'kaatib', تقدیر: 'taqdeer',
  مدینہ: 'madina', حرم: 'haram', تاجدار: 'tajdar', کرم: 'karam', غریب: 'gareeb',
  غریبوں: 'gareebon', چین: 'chain', سفینہ: 'safeena', ڈوبے: 'doobe', جینا: 'jeena', ہر: 'har',
  بن: 'ban', من: 'man', تن: 'tan', جگ: 'jag', رنگ: 'rang', سنگ: 'sang', پل: 'pal', حال: 'haal',
  سال: 'saal', خیال: 'khayal', ملال: 'malaal', وصال: 'visaal', فراق: 'firaaq', ہجر: 'hijr',
  شب: 'shab', دم: 'dam', قدر: 'qadar', نصیب: 'naseeb', نصیبوں: 'naseebon', والا: 'wala',
  والی: 'wali', جیت: 'jeet', ہار: 'haar'
};

/** Aspirates and other two-letter sounds, matched before single letters. */
const URDU_DIGRAPHS: Record<string, string> = {
  بھ: 'bh', پھ: 'ph', تھ: 'th', ٹھ: 'th', جھ: 'jh', چھ: 'chh', دھ: 'dh', ڈھ: 'dh',
  کھ: 'kh', گھ: 'gh', ڑھ: 'rh', لھ: 'lh', مھ: 'mh', نھ: 'nh', رھ: 'rh',
};

const URDU_LETTERS: Record<string, string> = {
  ا: 'a', آ: 'aa', ب: 'b', پ: 'p', ت: 't', ٹ: 't', ث: 's', ج: 'j', چ: 'ch', ح: 'h', خ: 'kh',
  د: 'd', ڈ: 'd', ذ: 'z', ر: 'r', ڑ: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's', ض: 'z',
  ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ک: 'k', گ: 'g', ل: 'l', م: 'm', ن: 'n',
  ں: 'n', و: 'o', ہ: 'h', ۂ: 'a', ھ: 'h', ء: '', ی: 'i', ي: 'i', ے: 'e', ؤ: 'o', ئ: 'e', أ: 'a',
};

/** Letters that carry a vowel sound, so no filler vowel is needed after them. */
const URDU_VOWELS = new Set(['ا', 'آ', 'و', 'ی', 'ي', 'ے', 'ؤ', 'ئ', 'أ', 'ہ', 'ۂ']);

function romanizeUrduWord(word: string): string {
  const bare = word.replace(URDU_DIACRITICS, '');
  const known = URDU_WORDS[bare];
  if (known) return known;

  const hasVowelLetter = [...bare].some((char) => URDU_VOWELS.has(char));

  let out = '';
  // Consonants since the last vowel, and whether this run already got one.
  let run = 0;
  let filled = 0;

  for (let i = 0; i < bare.length; i += 1) {
    const char = bare[i] as string;
    const digraph = URDU_DIGRAPHS[bare.slice(i, i + 2)];
    const mapped = digraph ?? URDU_LETTERS[char];

    if (mapped === undefined) {
      out += char;
      continue;
    }

    if (!digraph && URDU_VOWELS.has(char)) {
      const next = bare[i + 1];
      const prev = bare[i - 1];
      const nextIsVowel = next !== undefined && URDU_VOWELS.has(next);
      const prevIsVowel = prev !== undefined && URDU_VOWELS.has(prev);

      // At the start of a word these letters are consonants: "والا" is wala,
      // not oala, and "یار" is yaar. Alif is the vowel itself.
      const atEnd = i === bare.length - 1;
      if (char === 'ہ' && atEnd && !prevIsVowel) out += 'a';
      else if ((i === 0 || prevIsVowel) && char === 'و' && nextIsVowel) out += 'w';
      else if (i === 0 && (char === 'ی' || char === 'ي') && nextIsVowel) out += 'y';
      else if ((char === 'ی' || char === 'ي') && !atEnd && !prevIsVowel && !nextIsVowel) out += 'ee';
      else out += mapped;

      run = 0;
      filled = 0;
      continue;
    }

    // Urdu writes no short vowels, so they have to be put back. A word's first
    // consonant always takes one; after that a single cluster is allowed to
    // stand ("zind-"), which is what makes "zndgi" come out as "zandagi" and
    // "nsybwn" as "nasibon".
    const lastLetter = i === bare.length - 1;
    const needsVowel = filled === 0 ? run >= 1 : run >= 2 || (lastLetter && !hasVowelLetter && run >= 1);
    if (needsVowel && (!lastLetter || !hasVowelLetter)) {
      out += 'a';
      run = 0;
      filled += 1;
    }

    out += mapped;
    run += 1;
    if (digraph) i += 1;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Devanagari — an alphasyllabary, so this one is exact rather than a guess.
 * ------------------------------------------------------------------ */

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h', ळ: 'l',
  // Precomposed nukta letters, as they arrive in real lyrics.
  '\u0958': 'q', '\u0959': 'kh', '\u095A': 'gh', '\u095B': 'z', '\u095C': 'r',
  '\u095D': 'rh', '\u095E': 'f', '\u095F': 'y',
};

/** The same letters written as base + nukta, which also occurs. */
const DEVANAGARI_NUKTA_PAIRS: Record<string, string> = {
  क: 'q', ख: 'kh', ग: 'gh', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f', य: 'y',
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  '\u093E': 'a', '\u093F': 'i', '\u0940': 'ee', '\u0941': 'u', '\u0942': 'oo', '\u0943': 'ri',
  '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au', '\u0945': 'e', '\u0949': 'o',
};

const VIRAMA = '\u094D';
const NUKTA = '\u093C';
const ANUSVARA = /[\u0901\u0902]/;

function isConsonant(char: string | undefined): boolean {
  return char !== undefined && DEVANAGARI_CONSONANTS[char] !== undefined;
}

/**
 * Hindi does not pronounce every inherent "a" that Devanagari writes: मुझको is
 * mujhko, not mujhako. The schwa goes when the syllable is not the word's
 * first and the consonant after it carries a vowel sign of its own.
 */
function dropsInherentVowel(word: string, index: number, vowelsSoFar: number): boolean {
  if (vowelsSoFar < 1) return false;
  const next = word[index + 1];
  if (!isConsonant(next)) return false;
  const after = word[index + 2];
  return after !== undefined && DEVANAGARI_MATRAS[after] !== undefined;
}

function romanizeDevanagariWord(input: string): string {
  const word = input.normalize('NFC');
  let out = '';
  let vowels = 0;

  for (let i = 0; i < word.length; i += 1) {
    let char = word[i] as string;
    let consonant = DEVANAGARI_CONSONANTS[char];

    if (word[i + 1] === NUKTA && DEVANAGARI_NUKTA_PAIRS[char]) {
      consonant = DEVANAGARI_NUKTA_PAIRS[char];
      i += 1;
    }

    if (consonant) {
      out += consonant;
      const next = word[i + 1] as string | undefined;
      const matra = next ? DEVANAGARI_MATRAS[next] : undefined;

      if (matra) {
        // A final long "ee" is written "i" by everyone: teri, meri, kabhi.
        const atEnd = i + 2 >= word.length;
        out += matra === 'ee' && atEnd ? 'i' : matra;
        vowels += 1;
        i += 1;
      } else if (next === VIRAMA) {
        i += 1; // Half consonant: no vowel at all.
      } else if (i < word.length - 1 && !dropsInherentVowel(word, i, vowels)) {
        out += 'a';
        vowels += 1;
      }
      continue;
    }

    const vowel = DEVANAGARI_VOWELS[char];
    if (vowel) {
      out += vowel === 'ee' && i === word.length - 1 ? 'i' : vowel;
      vowels += 1;
      continue;
    }
    if (ANUSVARA.test(char)) {
      // "में" is mein and "नहीं" is nahin — the nasal lengthens the vowel.
      out += out.endsWith('e') ? 'in' : 'n';
      continue;
    }
    if (char === '\u0903') {
      out += 'h';
      continue;
    }
    if (DEVANAGARI_MATRAS[char]) {
      out += DEVANAGARI_MATRAS[char];
      vowels += 1;
      continue;
    }
    if (char !== NUKTA && char !== VIRAMA && char !== '\u0964' && char !== '\u0965') out += char;
  }

  return out;
}

const WORD_SPLIT = /([^\p{L}\p{M}]+)/u;

/** Romanise one line, leaving punctuation and any Latin words untouched. */
function romanizeLine(line: string, romanizeWord: (word: string) => string): string {
  return line
    .split(WORD_SPLIT)
    .map((part) => (WORD_SPLIT.test(part) || !part ? part : romanizeWord(part)))
    .join('');
}

/**
 * Turn lyrics in a script the reader cannot read into Roman letters. Returns
 * null when there is nothing to convert, so callers can skip it silently.
 */
export function romanize(text: string, script: Script): string | null {
  const romanizeWord =
    script === 'arabic' ? romanizeUrduWord : script === 'devanagari' ? romanizeDevanagariWord : null;
  if (!romanizeWord) return null;

  const out = text
    .split('\n')
    .map((line) => romanizeLine(line, romanizeWord))
    .join('\n');

  // Tidy the seams the rules leave behind.
  const cleaned = out
    .replace(/aaa+/g, 'aa')
    .replace(/([^\S\n])\1+/g, '$1')
    .replace(/[ \t]+$/gm, '');

  return cleaned.trim() === text.trim() ? null : cleaned;
}
