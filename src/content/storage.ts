import { DEFAULT_PROMPTS, PromptCategory, PromptConfig } from '../services/promptEngine';

export type WordStatus = 'known' | 'learning' | 'ignored' | 'unknown';

export type DictionaryProvider = 'cambridge' | 'oxford' | 'ai_dict' | 'free_dict' | 'cambridge_learner' | 'oxford_learner';
export type TranslationProvider = 'google' | 'cambridge_id';

export interface UserSettings {
  targetLang: string;
  interfaceLang: string;
  openRouterApiKey: string;
  openRouterModel?: string;
  geminiApiKey?: string;
  ankiDeck: string;
  allowDuplicateCards: boolean;
  dictionaryProvider: DictionaryProvider;
  translationProvider: TranslationProvider;
  prompts: Record<PromptCategory, PromptConfig>;
}

const DEFAULT_SETTINGS: UserSettings = {
  targetLang: 'English',
  interfaceLang: 'Indonesian',
  openRouterApiKey: '',
  openRouterModel: 'google/gemma-4-26b-a4b-it:free',
  geminiApiKey: '',
  ankiDeck: 'English Immersion',
  allowDuplicateCards: true,
  dictionaryProvider: 'cambridge',
  translationProvider: 'google',
  prompts: DEFAULT_PROMPTS,
};

export class StorageService {
  private static VOCAB_KEY = 'eir_vocab_map';
  private static SETTINGS_KEY = 'eir_settings';

  static async getVocabMap(): Promise<Record<string, 'known' | 'learning' | 'ignored'>> {
    try {
      const data = await browser.storage.local.get(this.VOCAB_KEY);
      return data[this.VOCAB_KEY] || {};
    } catch {
      return {};
    }
  }

  static async getWordStatus(word: string): Promise<WordStatus> {
    const clean = word.toLowerCase().trim();
    const map = await this.getVocabMap();
    return map[clean] || 'unknown';
  }

  static async setWordStatus(word: string, status: WordStatus): Promise<void> {
    const clean = word.toLowerCase().trim();
    const map = await this.getVocabMap();
    if (status === 'unknown') {
      delete map[clean];
    } else {
      map[clean] = status;
    }
    await browser.storage.local.set({ [this.VOCAB_KEY]: map });
  }

  static async getSettings(): Promise<UserSettings> {
    try {
      const data = await browser.storage.local.get(this.SETTINGS_KEY);
      const saved = data[this.SETTINGS_KEY] as Partial<UserSettings> | undefined;
      if (!saved) return DEFAULT_SETTINGS;

      const openRouterApiKey = saved.openRouterApiKey || saved.geminiApiKey || '';

      const isLegacyPrompt = (p?: string) =>
        !p ||
        p.includes('romaji/pinyin/furigana') ||
        p.includes('ALWAYS count like so: #1 ... #2 ... #3') ||
        p.includes('DO NOT OUTPUT other text, ONLY OUTPUT numbered lists');

      const prompts = {
        ...DEFAULT_PROMPTS,
        ...(saved.prompts || {}),
      };

      if (isLegacyPrompt(prompts.sentence_breakdown?.systemPrompt)) {
        prompts.sentence_breakdown = DEFAULT_PROMPTS.sentence_breakdown;
      }
      if (isLegacyPrompt(prompts.word_explanation?.systemPrompt)) {
        prompts.word_explanation = DEFAULT_PROMPTS.word_explanation;
      }

      const openRouterModel = saved.openRouterModel || 'google/gemma-4-26b-a4b-it:free';

      let dictionaryProvider: DictionaryProvider = (saved.dictionaryProvider as DictionaryProvider) || 'cambridge';
      if ((dictionaryProvider as string) === 'cambridge_learner') dictionaryProvider = 'cambridge';
      if ((dictionaryProvider as string) === 'oxford_learner') dictionaryProvider = 'oxford';

      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        openRouterApiKey,
        openRouterModel,
        dictionaryProvider,
        prompts,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  static async saveSettings(settings: Partial<UserSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await browser.storage.local.set({ [this.SETTINGS_KEY]: updated });
  }

  static async resetPrompts(): Promise<void> {
    const current = await this.getSettings();
    current.prompts = DEFAULT_PROMPTS;
    await browser.storage.local.set({ [this.SETTINGS_KEY]: current });
  }
}
