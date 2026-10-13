import { DictionaryProvider, TranslationProvider } from '../content/storage';
import { callOpenRouter, cleanThinkingTokens } from './openrouter';

export interface AudioItem {
  label: 'UK' | 'US' | 'Audio';
  url: string;
}

export interface DefinitionItem {
  definition: string;
  examples: string[];
  cefr?: string;
}

export interface PosGroup {
  partOfSpeech: string;
  definitions: DefinitionItem[];
}

export interface DictionaryEntry {
  word: string;
  phonetics: {
    uk?: string;
    us?: string;
    default?: string;
  };
  audios: AudioItem[];
  providerName: string;
  providerUrl: string;
  groups: PosGroup[];
}

export interface TranslationResult {
  wordTranslation: string;
  sentenceTranslation?: string;
  providerName: string;
  providerUrl: string;
}

// In-memory cache for instant responses (0ms) on repeated lookups
const dictCache = new Map<string, DictionaryEntry>();
const transCache = new Map<string, TranslationResult>();
const singleTransCache = new Map<string, string>();

/**
 * Helper to fetch external URLs via background script with timeout safety.
 */
async function fetchViaBackground(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const fetchPromise = browser.runtime.sendMessage({
      action: 'FETCH_EXTERNAL_URL',
      url,
    });
    const timeoutPromise = new Promise<{ success: false }>((resolve) =>
      setTimeout(() => resolve({ success: false }), timeoutMs)
    );

    const res = (await Promise.race([fetchPromise, timeoutPromise])) as any;
    if (res && res.success && typeof res.text === 'string') {
      return res.text;
    }
    return null;
  } catch (err) {
    console.warn('fetchViaBackground error:', err);
    return null;
  }
}

/**
 * 1. Cambridge English Dictionary (Comprehensive)
 * https://dictionary.cambridge.org/dictionary/english/<word>
 */
export async function fetchCambridgeEnglish(word: string): Promise<DictionaryEntry | null> {
  const cleanWord = word.trim().toLowerCase();
  const url = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(cleanWord)}`;

  const html = await fetchViaBackground(url, 6000);
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const headword = doc.querySelector('.headword, .dhw')?.textContent?.trim() || cleanWord;

    // Phonetics UK & US
    const ukPhon = doc.querySelector('.uk .ipa, .uk .dipa')?.textContent?.trim();
    const usPhon = doc.querySelector('.us .ipa, .us .dipa')?.textContent?.trim();
    const defaultPhon = doc.querySelector('.ipa, .dipa')?.textContent?.trim();

    // Audios UK & US
    const audios: AudioItem[] = [];
    const ukSource = doc.querySelector('.uk.dpron-i source[type="audio/mpeg"], .uk source[type="audio/mpeg"]');
    if (ukSource?.getAttribute('src')) {
      const src = ukSource.getAttribute('src')!;
      audios.push({
        label: 'UK',
        url: src.startsWith('http') ? src : `https://dictionary.cambridge.org${src}`,
      });
    }

    const usSource = doc.querySelector('.us.dpron-i source[type="audio/mpeg"], .us source[type="audio/mpeg"]');
    if (usSource?.getAttribute('src')) {
      const src = usSource.getAttribute('src')!;
      audios.push({
        label: 'US',
        url: src.startsWith('http') ? src : `https://dictionary.cambridge.org${src}`,
      });
    }

    // Definitions grouped by Part of Speech
    const groupsMap = new Map<string, DefinitionItem[]>();
    const entryBlocks = doc.querySelectorAll('.pr.entry-body__el, .entry-body__el, .di-body');

    const processDefBlock = (pos: string, defBlock: Element) => {
      const defEl = defBlock.querySelector('.def.ddef_d, .def');
      if (!defEl) return;
      const defText = defEl.textContent?.replace(/:$/, '').trim();
      if (!defText) return;

      const cefr = defBlock.querySelector('.epp-xref, .cefr')?.textContent?.trim();
      const examples: string[] = [];
      defBlock.querySelectorAll('.examp.dexamp, .eg.deg').forEach((ex) => {
        const t = ex.textContent?.trim();
        if (t && examples.length < 3) examples.push(t);
      });

      if (!groupsMap.has(pos)) groupsMap.set(pos, []);
      groupsMap.get(pos)!.push({
        definition: defText,
        examples,
        cefr,
      });
    };

    if (entryBlocks.length > 0) {
      entryBlocks.forEach((entry) => {
        const pos = entry.querySelector('.pos.dpos, .pos')?.textContent?.trim() || 'General';
        const defBlocks = entry.querySelectorAll('.def-block, .ddef_block');
        if (defBlocks.length > 0) {
          defBlocks.forEach((db) => processDefBlock(pos, db));
        } else {
          entry.querySelectorAll('.def.ddef_d').forEach((d) => {
            const parent = d.closest('.def-block') || entry;
            processDefBlock(pos, parent);
          });
        }
      });
    } else {
      // Fallback selector
      doc.querySelectorAll('.def-block, .ddef_block').forEach((db) => {
        const pos = db.closest('[data-pos]')?.getAttribute('data-pos') || 'General';
        processDefBlock(pos, db);
      });
    }

    const groups: PosGroup[] = Array.from(groupsMap.entries()).map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions,
    }));

    if (groups.length === 0) return null;

    return {
      word: headword,
      phonetics: {
        uk: ukPhon ? `/${ukPhon}/` : undefined,
        us: usPhon ? `/${usPhon}/` : undefined,
        default: defaultPhon ? `/${defaultPhon}/` : undefined,
      },
      audios,
      providerName: 'Cambridge Dictionary',
      providerUrl: url,
      groups,
    };
  } catch (err) {
    console.error('Error parsing Cambridge:', err);
    return null;
  }
}

// Backward compatibility alias
export const fetchCambridgeLearner = fetchCambridgeEnglish;

/**
 * 2. Oxford Learner's Dictionaries (Comprehensive)
 * https://www.oxfordlearnersdictionaries.com/definition/english/<word>
 */
export async function fetchOxfordLearner(word: string): Promise<DictionaryEntry | null> {
  const cleanWord = word.trim().toLowerCase();
  const url = `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(cleanWord)}`;

  const html = await fetchViaBackground(url);
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const headword = doc.querySelector('.headword')?.textContent?.trim() || cleanWord;

    // Phonetics
    const ukPhon = doc.querySelector('.phons_br .phon')?.textContent?.trim();
    const usPhon = doc.querySelector('.phons_n_am .phon')?.textContent?.trim();
    const defaultPhon = doc.querySelector('.phon')?.textContent?.trim();

    // Audios
    const audios: AudioItem[] = [];
    const ukSound = doc.querySelector('.pron-uk[data-src-mp3], .phons_br [data-src-mp3]');
    if (ukSound?.getAttribute('data-src-mp3')) {
      audios.push({ label: 'UK', url: ukSound.getAttribute('data-src-mp3')! });
    }

    const usSound = doc.querySelector('.pron-us[data-src-mp3], .phons_n_am [data-src-mp3]');
    if (usSound?.getAttribute('data-src-mp3')) {
      audios.push({ label: 'US', url: usSound.getAttribute('data-src-mp3')! });
    }

    // Definitions grouped by part of speech
    const groups: PosGroup[] = [];
    const pos = doc.querySelector('.pos')?.textContent?.trim() || 'noun';

    const definitions: DefinitionItem[] = [];
    doc.querySelectorAll('.sense').forEach((senseEl) => {
      const defEl = senseEl.querySelector('.def');
      const defText = defEl?.textContent?.replace(/:$/, '').trim();
      if (!defText) return;

      const examples: string[] = [];
      senseEl.querySelectorAll('.examples .x').forEach((exEl) => {
        const t = exEl.textContent?.trim();
        if (t && examples.length < 3) examples.push(t);
      });

      definitions.push({
        definition: defText,
        examples,
      });
    });

    if (definitions.length > 0) {
      groups.push({
        partOfSpeech: pos,
        definitions,
      });
    }

    if (groups.length === 0) return null;

    return {
      word: headword,
      phonetics: {
        uk: ukPhon,
        us: usPhon,
        default: defaultPhon,
      },
      audios,
      providerName: "Oxford Learner's Dictionaries",
      providerUrl: url,
      groups,
    };
  } catch (err) {
    console.error('Error parsing Oxford:', err);
    return null;
  }
}

/**
 * 3. Free Dictionary API (Lightweight fallback)
 */
export async function fetchFreeDictionary(word: string): Promise<DictionaryEntry | null> {
  const cleanWord = word.trim().toLowerCase();
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`;

  const jsonStr = await fetchViaBackground(url);
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    const audios: AudioItem[] = [];
    let defaultPhon = entry.phonetic;

    if (Array.isArray(entry.phonetics)) {
      for (const p of entry.phonetics) {
        if (!defaultPhon && p.text) defaultPhon = p.text;
        if (p.audio && p.audio.trim() !== '') {
          const audioUrl = p.audio.startsWith('//') ? `https:${p.audio}` : p.audio;
          audios.push({ label: 'Audio', url: audioUrl });
        }
      }
    }

    const groups: PosGroup[] = (entry.meanings || []).map((m: any) => ({
      partOfSpeech: m.partOfSpeech || 'General',
      definitions: (m.definitions || []).map((d: any) => ({
        definition: d.definition || '',
        examples: d.example ? [d.example] : [],
      })),
    }));

    return {
      word: entry.word || cleanWord,
      phonetics: { default: defaultPhon },
      audios,
      providerName: 'Free Dictionary API',
      providerUrl: url,
      groups,
    };
  } catch {
    return null;
  }
}

/**
 * 4. Cambridge English-Indonesian Translation
 * https://dictionary.cambridge.org/dictionary/english-indonesian/<word>
 */
export async function fetchCambridgeIndonesian(word: string): Promise<string | null> {
  const cleanWord = word.trim().toLowerCase();
  const cacheKey = `camb_id:${cleanWord}`;
  if (singleTransCache.has(cacheKey)) {
    return singleTransCache.get(cacheKey)!;
  }

  const url = `https://dictionary.cambridge.org/dictionary/english-indonesian/${encodeURIComponent(cleanWord)}`;

  const html = await fetchViaBackground(url);
  if (!html) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const transEls = doc.querySelectorAll('.trans.dtrans[lang="id"]');
    const transList: string[] = [];
    transEls.forEach((el) => {
      const t = el.textContent?.trim();
      if (t && !transList.includes(t)) transList.push(t);
    });

    if (transList.length > 0) {
      const res = transList.slice(0, 4).join(', ');
      singleTransCache.set(cacheKey, res);
      return res;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 5. Google Translate Quick Endpoint
 */
export async function fetchGoogleTranslation(text: string, targetLangCode = 'id'): Promise<string | null> {
  if (!text || !text.trim()) return null;
  const cleanText = text.trim();
  const cacheKey = `gtrans:${targetLangCode}:${cleanText}`;
  if (singleTransCache.has(cacheKey)) {
    return singleTransCache.get(cacheKey)!;
  }

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLangCode}&dt=t&q=${encodeURIComponent(cleanText)}`;

  const jsonStr = await fetchViaBackground(url);
  if (!jsonStr) return null;

  try {
    const json = JSON.parse(jsonStr);
    if (Array.isArray(json) && Array.isArray(json[0])) {
      const translated = json[0].map((item: any) => item[0]).join('');
      if (translated) {
        singleTransCache.set(cacheKey, translated);
      }
      return translated;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses structured AI response into a standard DictionaryEntry object.
 */
export function parseAiDictionaryResponse(text: string, word: string): DictionaryEntry {
  const clean = cleanThinkingTokens(text);
  const phonMatch = clean.match(/(?:Phonetic:\s*|\/)([a-zA-Zˈˌːæɑɒɔəɛɜɪiːʊuːeɪaɪɔɪaʊəʊɪəeəʊəθðʃʒtʃdʒŋ]+)\/?/i);
  const defaultPhon = phonMatch ? `/${phonMatch[1]}/` : undefined;

  const groups: PosGroup[] = [];
  const lines = clean.split('\n');
  let currentPos = 'General';
  let currentDefs: DefinitionItem[] = [];
  let currentDef: DefinitionItem | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Check for POS tag like [VERB], [NOUN], etc.
    const posMatch = line.match(/^\[?(VERB|NOUN|ADJECTIVE|ADVERB|PREPOSITION|CONJUNCTION|INTERJECTION|PHRASAL VERB|IDIOM)\]?:?$/i);
    if (posMatch) {
      if (currentDef) {
        currentDefs.push(currentDef);
        currentDef = null;
      }
      if (currentDefs.length > 0) {
        groups.push({ partOfSpeech: currentPos, definitions: currentDefs });
        currentDefs = [];
      }
      currentPos = posMatch[1].toUpperCase();
      continue;
    }

    // Check for numbered definition: 1. [B2] to join together...
    const defMatch = line.match(/^(?:\d+\.|\•|\-)\s*(?:\[([A-C][1-2])\])?\s*(.+)$/i);
    if (defMatch) {
      if (currentDef) {
        currentDefs.push(currentDef);
      }
      const cefr = defMatch[1];
      const defText = defMatch[2].trim();
      currentDef = {
        definition: defText,
        examples: [],
        cefr,
      };
      continue;
    }

    // Check for Indonesian meaning: Arti: ...
    if (currentDef && line.toLowerCase().startsWith('arti:')) {
      const artiText = line.replace(/^arti:\s*/i, '').trim();
      currentDef.definition += ` (${artiText})`;
      continue;
    }

    // Check for Example: 💬 Example: "..."
    if (currentDef && (line.includes('Example:') || line.includes('💬') || line.startsWith('"'))) {
      const exText = line.replace(/^(?:💬\s*)?(?:Example:\s*)?/i, '').replace(/^"|"$/g, '').trim();
      if (exText) {
        currentDef.examples.push(exText);
      }
      continue;
    }
  }

  if (currentDef) {
    currentDefs.push(currentDef);
  }
  if (currentDefs.length > 0) {
    groups.push({ partOfSpeech: currentPos, definitions: currentDefs });
  }

  if (groups.length === 0) {
    groups.push({
      partOfSpeech: 'General',
      definitions: [{ definition: clean, examples: [] }],
    });
  }

  return {
    word,
    phonetics: { default: defaultPhon },
    audios: [],
    providerName: 'AI Smart Dictionary',
    providerUrl: `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)}`,
    groups,
  };
}

/**
 * Generates a complete Cambridge/Oxford-style structured dictionary entry using AI.
 */
export async function fetchAiDictionary(
  word: string,
  contextSentence = '',
  apiKey?: string,
  model?: string
): Promise<DictionaryEntry | null> {
  const cleanWord = word.trim().toLowerCase();
  const cacheKey = `ai_dict:${cleanWord}`;

  if (dictCache.has(cacheKey)) {
    return dictCache.get(cacheKey)!;
  }

  if (!apiKey) return null;

  try {
    const systemPrompt = `You are an expert lexicographer creating a comprehensive dictionary entry for the English word "${word}".
Context sentence from user's reading: "${contextSentence || '-'}".

Format the dictionary entry cleanly and professionally, exactly like Cambridge or Oxford English Dictionary:

Phonetic: /.../

[PART OF SPEECH 1] (e.g. VERB, NOUN, ADJECTIVE, ADVERB)
1. [CEFR Level e.g. B1, B2, C1] Clear English definition.
   Arti: Ringkasan definisi dalam Bahasa Indonesia.
   💬 Example: "Natural English example sentence showing usage."
2. ...

[PART OF SPEECH 2] (if applicable)
1. ...

Guidelines:
- Provide 1 to 3 primary definitions per part of speech, especially highlighting the nuance matching the context sentence.
- Always include realistic CEFR level tags ([A2], [B1], [B2], [C1], or [C2]).
- Include accurate IPA pronunciation.
- Output ONLY the formatted dictionary entry text. No greetings, thinking, or meta conversation.`;

    const userPrompt = `Create a dictionary entry for: "${word}"`;

    const res = await callOpenRouter({
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens: 1200,
    });

    if (!res.success || !res.text) {
      return null;
    }

    const entry = parseAiDictionaryResponse(res.text, word);
    dictCache.set(cacheKey, entry);
    return entry;
  } catch (err) {
    console.warn('fetchAiDictionary error:', err);
    return null;
  }
}

/**
 * Fetches full dictionary entry based on user's chosen provider
 */
export async function fetchDictionaryByProvider(
  word: string,
  provider: DictionaryProvider = 'cambridge',
  contextSentence = '',
  apiKey?: string,
  model?: string
): Promise<DictionaryEntry | null> {
  const cleanWord = word.trim().toLowerCase();
  const cacheKey = `${provider}:${cleanWord}`;

  if (dictCache.has(cacheKey)) {
    return dictCache.get(cacheKey)!;
  }

  let entry: DictionaryEntry | null = null;

  if (provider === 'ai_dict') {
    entry = await fetchAiDictionary(cleanWord, contextSentence, apiKey, model);
    if (!entry) entry = await fetchCambridgeEnglish(cleanWord);
  } else if (provider === 'cambridge' || provider === ('cambridge_learner' as any)) {
    entry = await fetchCambridgeEnglish(cleanWord);
  } else if (provider === 'oxford' || provider === ('oxford_learner' as any)) {
    entry = await fetchOxfordLearner(cleanWord);
  } else {
    entry = await fetchFreeDictionary(cleanWord);
    if (!entry) entry = await fetchCambridgeEnglish(cleanWord);
  }

  if (entry) {
    dictCache.set(cacheKey, entry);
  }

  return entry;
}

/**
 * Fetches full translation (word & context sentence) based on chosen provider
 */
export async function fetchFullTranslation(
  word: string,
  sentence: string,
  provider: TranslationProvider = 'google'
): Promise<TranslationResult> {
  const cleanWord = word.trim().toLowerCase();
  const cleanSentence = sentence.trim();
  const cacheKey = `${provider}:${cleanWord}:::${cleanSentence}`;

  if (transCache.has(cacheKey)) {
    return transCache.get(cacheKey)!;
  }

  let wordTranslation = '';
  let sentenceTranslation: string | undefined;
  let providerName = 'Google Translate';
  let providerUrl = `https://translate.google.com/?sl=en&tl=id&text=${encodeURIComponent(cleanWord)}`;

  if (provider === 'cambridge_id') {
    providerName = 'Cambridge English-Indonesian';
    providerUrl = `https://dictionary.cambridge.org/dictionary/english-indonesian/${encodeURIComponent(word)}`;

    // Try to get official word entry from Cambridge bilingual dictionary
    const cambridgeWordTrans = await fetchCambridgeIndonesian(word);
    if (cambridgeWordTrans) {
      wordTranslation = cambridgeWordTrans;
    } else {
      // Fallback word to Google Translate if not found in bilingual dictionary
      wordTranslation = (await fetchGoogleTranslation(word)) || '-';
    }

    // For complete article sentence, translate with Google Translate
    if (sentence && sentence.trim()) {
      sentenceTranslation = (await fetchGoogleTranslation(sentence)) || undefined;
    }
  } else {
    // Default Google Translate
    const [wTrans, sTrans] = await Promise.all([
      fetchGoogleTranslation(word),
      sentence ? fetchGoogleTranslation(sentence) : Promise.resolve(null),
    ]);
    wordTranslation = wTrans || '-';
    sentenceTranslation = sTrans || undefined;
  }

  const result: TranslationResult = {
    wordTranslation,
    sentenceTranslation,
    providerName,
    providerUrl,
  };

  transCache.set(cacheKey, result);
  return result;
}

/**
 * Official dictionary and translation external URLs for quick reference buttons
 */
export function getExternalDictionaryUrls(word: string) {
  const enc = encodeURIComponent(word.trim().toLowerCase());
  return {
    cambridgeEnglish: `https://dictionary.cambridge.org/dictionary/english/${enc}`,
    cambridgeLearner: `https://dictionary.cambridge.org/dictionary/english/${enc}`,
    cambridgeTranslate: `https://dictionary.cambridge.org/translate/`,
    cambridgeIndo: `https://dictionary.cambridge.org/dictionary/english-indonesian/${enc}`,
    oxfordLearner: `https://www.oxfordlearnersdictionaries.com/definition/english/${enc}`,
    googleTranslate: `https://translate.google.com/?sl=en&tl=id&text=${enc}`,
  };
}
