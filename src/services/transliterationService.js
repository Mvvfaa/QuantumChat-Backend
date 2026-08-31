/**
 * Transliteration Service
 * 
 * Generates phonetic transliterations for user display names into non-Latin scripts:
 * - Urdu (ur, Arabic/Nastaliq script)
 * - Arabic (ar, Arabic script)
 * - Persian (fa, Perso-Arabic script)
 * - Hindi (hi, Devanagari script)
 * - Chinese (zh, Simplified Hanzi script)
 * - Russian (ru, Cyrillic script)
 * 
 * Integrates Microsoft Cognitive Services Translator Transliterate API with resilient
 * phonetic rule-based fallback when the API key is not configured or network requests fail.
 */

export const SUPPORTED_NON_LATIN_LANGS = ['ur', 'ar', 'fa', 'hi', 'zh', 'ru'];

const MS_SCRIPT_MAP = {
  ur: { language: 'ur', fromScript: 'Latn', toScript: 'Arab' },
  ar: { language: 'ar', fromScript: 'Latn', toScript: 'Arab' },
  fa: { language: 'fa', fromScript: 'Latn', toScript: 'Arab' },
  hi: { language: 'hi', fromScript: 'Latn', toScript: 'Deva' },
  zh: { language: 'zh-Hans', fromScript: 'Latn', toScript: 'Hans' },
  ru: { language: 'ru', fromScript: 'Latn', toScript: 'Cyrl' },
};

// Known common name dictionary for high accuracy phonetic matching
const COMMON_NAME_DICTIONARY = {
  zahra: { ur: 'زہرا', ar: 'زهراء', fa: 'زهرا', hi: 'ज़हरा', zh: '扎赫拉', ru: 'Захра' },
  zara: { ur: 'زارا', ar: 'زارا', fa: 'زارا', hi: 'ज़ारा', zh: '扎拉', ru: 'Зара' },
  ali: { ur: 'علی', ar: 'علي', fa: 'علی', hi: 'अली', zh: '阿里', ru: 'Али' },
  sara: { ur: 'سارہ', ar: 'سارة', fa: 'سارا', hi: 'सारा', zh: '萨拉', ru: 'Сара' },
  sarah: { ur: 'سارہ', ar: 'سارة', fa: 'سارا', hi: 'सारा', zh: '萨拉', ru: 'Сара' },
  fatima: { ur: 'فاطمہ', ar: 'فاطمة', fa: 'فاطمه', hi: 'फ़ातिमा', zh: '法蒂玛', ru: 'Фатима' },
  ahmed: { ur: 'احمد', ar: 'أحمد', fa: 'احمد', hi: 'अहमद', zh: '艾哈迈德', ru: 'Ахмед' },
  ahmad: { ur: 'احمد', ar: 'أحمد', fa: 'احمد', hi: 'अहमद', zh: '艾哈迈德', ru: 'Ахмад' },
  mohammed: { ur: 'محمد', ar: 'محمد', fa: 'محمد', hi: 'मोहम्मद', zh: '穆罕默德', ru: 'Мохаммед' },
  muhammad: { ur: 'محمد', ar: 'محمد', fa: 'محمد', hi: 'मोहम्मद', zh: '穆罕默德', ru: 'Мухаммад' },
  omar: { ur: 'عمر', ar: 'عمر', fa: 'عمر', hi: 'उमर', zh: '奥马尔', ru: 'Омар' },
  usman: { ur: 'عثمان', ar: 'عثمان', fa: 'عثمان', hi: 'उस्मान', zh: '奥斯曼', ru: 'Усман' },
  othman: { ur: 'عثمان', ar: 'عثمان', fa: 'عثمان', hi: 'عثمان', zh: '奥斯曼', ru: 'Осман' },
  hassan: { ur: 'حسن', ar: 'حسن', fa: 'حسن', hi: 'हसन', zh: '哈桑', ru: 'Хасан' },
  hussain: { ur: 'حسین', ar: 'حسين', fa: 'حسین', hi: 'हुसैन', zh: '侯赛因', ru: 'Хусейн' },
  john: { ur: 'جان', ar: 'جون', fa: 'جان', hi: 'जॉन', zh: '约翰', ru: 'Джон' },
  david: { ur: 'ڈیوڈ', ar: 'ديفيد', fa: 'دیوید', hi: 'डेविड', zh: '大卫', ru: 'Давид' },
  michael: { ur: 'مائیکل', ar: 'مايكل', fa: 'مایکل', hi: 'माइकल', zh: '迈克尔', ru: 'Майкл' },
  alex: { ur: 'ایلکس', ar: 'أليكس', fa: 'الکس', hi: 'एलेक्स', zh: '亚历克斯', ru: 'Алекс' },
  mary: { ur: 'میری', ar: 'ماري', fa: 'مری', hi: 'मेरी', zh: '玛丽', ru: 'Мэри' },
  emma: { ur: 'ایما', ar: 'إيما', fa: 'اما', hi: 'एम्मा', zh: '艾玛', ru: 'Эмма' },
  anna: { ur: 'اینا', ar: 'آنا', fa: 'آنا', hi: 'एना', zh: '安娜', ru: 'Анна' },
  adam: { ur: 'آدم', ar: 'آدم', fa: 'آدم', hi: 'एडम', zh: '亚当', ru: 'Адам' },
  khan: { ur: 'خان', ar: 'خان', fa: 'خان', hi: 'खान', zh: '汗', ru: 'Хан' },
  malik: { ur: 'ملک', ar: 'مالك', fa: 'مالک', hi: 'मलिक', zh: '马利克', ru: 'Малик' },
  eiman: { ur: 'ایمان', ar: 'إيمان', fa: 'ایمان', hi: 'ईमान', zh: '艾曼', ru: 'Эйман' },
  iman: { ur: 'ایمان', ar: 'إيمان', fa: 'ایمان', hi: 'ईमान', zh: '伊曼', ru: 'Иман' },
};

/**
 * Phonetic transliterator fallback for Urdu / Arabic / Persian
 */
function transliterateToPersoArabic(word, lang) {
  const w = word.toLowerCase();
  let res = '';
  let i = 0;

  const digraphs = {
    th: lang === 'ur' ? 'تھ' : 'ث',
    sh: 'ش',
    ch: lang === 'ar' ? 'تش' : 'چ',
    kh: 'خ',
    dh: 'ذ',
    gh: 'غ',
    ph: 'ف',
    zh: 'ژ',
    ck: 'ک',
  };

  const consonants = {
    b: 'ب',
    p: lang === 'ar' ? 'ب' : 'پ',
    t: 'ت',
    j: 'ج',
    d: 'د',
    r: 'ر',
    z: 'ز',
    s: 'س',
    f: 'ف',
    q: 'ق',
    k: lang === 'ar' ? 'ك' : 'ک',
    g: lang === 'ar' ? 'ج' : 'گ',
    l: 'ل',
    m: 'م',
    n: 'ن',
    v: 'و',
    w: 'و',
    h: lang === 'ur' ? 'ہ' : lang === 'fa' ? 'ه' : 'ه',
    y: 'ی',
    x: 'کس',
    c: 'ک',
  };

  while (i < w.length) {
    const two = w.slice(i, i + 2);
    if (digraphs[two]) {
      res += digraphs[two];
      i += 2;
      continue;
    }

    const c = w[i];
    if (i === 0) {
      if (c === 'a') {
        res += 'آ';
        i++;
        continue;
      }
      if (c === 'e' || c === 'i') {
        res += 'ای';
        i++;
        continue;
      }
      if (c === 'o' || c === 'u') {
        res += 'او';
        i++;
        continue;
      }
    }

    if (c === 'a') {
      res += (i === w.length - 1 ? (lang === 'ur' ? 'ا' : 'ة') : 'ا');
    } else if (c === 'e' || c === 'i') {
      res += (i === w.length - 1 ? 'ی' : (res.length > 0 && !res.endsWith('ا') ? 'ی' : ''));
    } else if (c === 'o' || c === 'u') {
      res += 'و';
    } else if (consonants[c]) {
      res += consonants[c];
    } else {
      res += c;
    }
    i++;
  }

  return res;
}

/**
 * Phonetic transliterator fallback for Hindi (Devanagari)
 */
function transliterateToHindi(word) {
  const w = word.toLowerCase();
  let res = '';
  let i = 0;

  const digraphs = {
    sh: 'श',
    ch: 'च',
    kh: 'ख',
    th: 'थ',
    dh: 'ध',
    gh: 'घ',
    ph: 'फ',
    bh: 'भ',
    jh: 'झ',
  };

  const consonants = {
    k: 'क', g: 'ग', c: 'क', j: 'ज', t: 'त', d: 'द', n: 'न',
    p: 'प', b: 'ब', m: 'म', y: 'य', r: 'र', l: 'ल', v: 'व',
    w: 'व', s: 'स', h: 'ह', z: 'ज़', f: 'फ़', x: 'क्स',
  };

  while (i < w.length) {
    const two = w.slice(i, i + 2);
    if (digraphs[two]) {
      res += digraphs[two];
      i += 2;
      continue;
    }

    const c = w[i];
    if (i === 0) {
      if (c === 'a') { res += 'आ'; i++; continue; }
      if (c === 'i') { res += 'इ'; i++; continue; }
      if (c === 'u') { res += 'उ'; i++; continue; }
      if (c === 'e') { res += 'ए'; i++; continue; }
      if (c === 'o') { res += 'ओ'; i++; continue; }
    }

    if (c === 'a') {
      res += 'ा';
    } else if (c === 'i' || c === 'e') {
      res += 'ी';
    } else if (c === 'u' || c === 'o') {
      res += 'ू';
    } else if (consonants[c]) {
      res += consonants[c];
    } else {
      res += c;
    }
    i++;
  }

  return res;
}

/**
 * Phonetic transliterator fallback for Russian (Cyrillic)
 */
function transliterateToRussian(word) {
  const map = {
    sh: 'ш', ch: 'ч', zh: 'ж', kh: 'х', th: 'т', ph: 'ф', ts: 'ц', ya: 'я', yu: 'ю', yo: 'ё',
    a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', y: 'и', k: 'к',
    l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф',
    h: 'х', c: 'к', w: 'в', j: 'дж', x: 'кс',
  };

  const isCapital = word[0] && word[0] === word[0].toUpperCase();
  const lower = word.toLowerCase();
  let res = '';
  let i = 0;

  while (i < lower.length) {
    const two = lower.slice(i, i + 2);
    if (map[two]) {
      res += map[two];
      i += 2;
    } else if (map[lower[i]]) {
      res += map[lower[i]];
      i++;
    } else {
      res += lower[i];
      i++;
    }
  }

  if (isCapital && res.length > 0) {
    res = res[0].toUpperCase() + res.slice(1);
  }
  return res;
}

/**
 * Phonetic transliterator fallback for Chinese (Simplified Hanzi)
 */
function transliterateToChinese(word) {
  const syllables = [
    { regex: /^zah?ra/i, han: '扎赫拉' },
    { regex: /^za/i, han: '扎' },
    { regex: /^ali/i, han: '阿里' },
    { regex: /^al/i, han: '阿尔' },
    { regex: /^sara/i, han: '萨拉' },
    { regex: /^sa/i, han: '萨' },
    { regex: /^ra/i, han: '拉' },
    { regex: /^ma/i, han: '玛' },
    { regex: /^ri/i, han: '里' },
    { regex: /^li/i, han: '利' },
    { regex: /^da/i, han: '达' },
    { regex: /^na/i, han: '娜' },
    { regex: /^ka/i, han: '卡' },
    { regex: /^ba/i, han: '巴' },
    { regex: /^pa/i, han: '帕' },
    { regex: /^ta/i, han: '塔' },
    { regex: /^ha/i, han: '哈' },
    { regex: /^an/i, han: '安' },
    { regex: /^en/i, han: '恩' },
    { regex: /^in/i, han: '因' },
    { regex: /^on/i, han: '昂' },
    { regex: /^un/i, han: '温' },
    { regex: /^lu/i, han: '卢' },
    { regex: /^ro/i, han: '罗' },
    { regex: /^me/i, han: '梅' },
    { regex: /^ke/i, han: '克' },
    { regex: /^le/i, han: '莱' },
    { regex: /^de/i, han: '德' },
    { regex: /^te/i, han: '特' },
    { regex: /^ne/i, han: '内' },
    { regex: /^wa/i, han: '瓦' },
    { regex: /^ya/i, han: '亚' },
    { regex: /^ja/i, han: '贾' },
  ];

  let remaining = word.trim();
  let res = '';

  while (remaining.length > 0) {
    let matched = false;
    for (const item of syllables) {
      if (item.regex.test(remaining)) {
        res += item.han;
        remaining = remaining.replace(item.regex, '');
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fallback single character mapping
      const first = remaining[0].toLowerCase();
      const singleMap = {
        a: '阿', b: '布', c: '克', d: '德', e: '艾', f: '弗', g: '格', h: '赫',
        i: '伊', j: '杰', k: '克', l: '尔', m: '姆', n: '恩', o: '欧', p: '普',
        q: '丘', r: '尔', s: '斯', t: '特', u: '乌', v: '维', w: '沃', x: '克斯',
        y: '伊', z: '兹',
      };
      res += singleMap[first] || first;
      remaining = remaining.slice(1);
    }
  }

  return res;
}

/**
 * Phonetic fallback dispatcher
 */
function phoneticFallback(name, targetLang) {
  const words = name.trim().split(/\s+/);
  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (COMMON_NAME_DICTIONARY[lower]?.[targetLang]) {
        return COMMON_NAME_DICTIONARY[lower][targetLang];
      }

      switch (targetLang) {
        case 'ur':
        case 'ar':
        case 'fa':
          return transliterateToPersoArabic(w, targetLang);
        case 'hi':
          return transliterateToHindi(w);
        case 'ru':
          return transliterateToRussian(w);
        case 'zh':
          return transliterateToChinese(w);
        default:
          return w;
      }
    })
    .join(' ');
}

/**
 * Call Microsoft Translator Transliterate API
 *
 * Returns the transliterated text on success, or null on any failure.
 * Logs are emitted for every distinguishable failure mode so operators can
 * immediately tell whether the key itself is the problem, the network, or
 * the API response shape.
 */
let _loggedApiMode = false; // emit once-per-process banner

async function callMicrosoftTransliterate(text, targetLang) {
  const apiKey = process.env.MS_TRANSLATOR_KEY;
  if (!apiKey) {
    // No key configured — this is the expected state before provisioning.
    // Logged once at startup level, not per-call, to avoid log spam.
    if (!_loggedApiMode) {
      console.log('[transliterationService] MS_TRANSLATOR_KEY is not set — all transliterations will use the built-in fallback engine. Set the key in .env to enable the Microsoft Translator API.');
      _loggedApiMode = true;
    }
    return null;
  }

  if (!_loggedApiMode) {
    console.log('[transliterationService] MS_TRANSLATOR_KEY is configured — using Microsoft Translator Transliterate API (with fallback on failure).');
    _loggedApiMode = true;
  }

  const config = MS_SCRIPT_MAP[targetLang];
  if (!config) {
    console.warn('[transliterationService] No MS_SCRIPT_MAP entry for language "%s" — skipping API call.', targetLang);
    return null;
  }

  const region = process.env.MS_TRANSLATOR_REGION || 'global';
  const endpoint =
    process.env.MS_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';
  const url = `${endpoint.replace(/\/+$/, '')}/transliterate?api-version=3.0&language=${config.language}&fromScript=${config.fromScript}&toScript=${config.toScript}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: text }]),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        console.error('[transliterationService] API AUTH ERROR (HTTP %d) for language "%s" — the MS_TRANSLATOR_KEY is likely invalid or expired. Response: %s', response.status, targetLang, errText);
      } else if (response.status === 429) {
        console.error('[transliterationService] API RATE LIMITED (HTTP 429) for language "%s" — falling back to built-in engine. Response: %s', targetLang, errText);
      } else {
        console.error('[transliterationService] API HTTP ERROR %d for language "%s": %s', response.status, targetLang, errText);
      }
      return null;
    }

    const data = await response.json();
    if (Array.isArray(data) && data[0]?.text) {
      return data[0].text;
    }

    console.warn('[transliterationService] API returned unexpected response shape for language "%s": %s', targetLang, JSON.stringify(data).slice(0, 200));
    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[transliterationService] API TIMEOUT (3 s) for language "%s" — falling back to built-in engine.', targetLang);
    } else {
      console.error('[transliterationService] API NETWORK ERROR for language "%s": %s', targetLang, err.message);
    }
    return null;
  }
}

/**
 * Generate transliteration for a single language.
 *
 * Priority logic:
 *   1. If MS_TRANSLATOR_KEY is configured → attempt the real API first.
 *      On success → use API result.
 *      On failure → fall through to dictionary, then phonetic engine.
 *   2. If MS_TRANSLATOR_KEY is NOT configured → dictionary then phonetic engine.
 *
 * The dictionary is intentionally checked AFTER the API when a key is present,
 * because the API produces higher-quality, context-aware transliterations.
 * When no key is present, the dictionary provides better results than the
 * generic phonetic rules, so it is checked first in that path.
 */
export async function transliterateText(text, targetLang) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  const hasApiKey = !!process.env.MS_TRANSLATOR_KEY;

  if (hasApiKey) {
    // --- API-first path ---
    const apiResult = await callMicrosoftTransliterate(trimmed, targetLang);
    if (apiResult) {
      return apiResult;
    }
    // API failed — fall through to dictionary then phonetic
    console.log('[transliterationService] API unavailable for "%s" → "%s", using fallback engine.', trimmed, targetLang);
  }

  // Dictionary lookup (high-accuracy curated names)
  const lower = trimmed.toLowerCase();
  if (COMMON_NAME_DICTIONARY[lower]?.[targetLang]) {
    return COMMON_NAME_DICTIONARY[lower][targetLang];
  }

  // Phonetic rule-based engine (last resort)
  return phoneticFallback(trimmed, targetLang);
}

/**
 * Generate transliterated names object for all supported non-Latin languages.
 * Returns: { ur: "...", ar: "...", fa: "...", hi: "...", zh: "...", ru: "..." }
 *
 * This is the SINGLE entry point used by:
 *   - authController.js (signup)
 *   - userController.js (display-name update)
 *   - scripts/backfill-transliterations.js (database migration)
 * All three share this function, so adding a valid MS_TRANSLATOR_KEY to .env
 * automatically activates real API transliteration everywhere — no other code
 * changes are needed.
 */
export async function generateTransliteratedNames(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return {};
  }

  const result = {};
  await Promise.all(
    SUPPORTED_NON_LATIN_LANGS.map(async (lang) => {
      try {
        const trans = await transliterateText(name, lang);
        if (trans) {
          result[lang] = trans;
        }
      } catch (err) {
        console.error('[transliterationService] Failed to generate transliteration for "%s" into "%s": %s', name, lang, err.message);
      }
    })
  );

  return result;
}

