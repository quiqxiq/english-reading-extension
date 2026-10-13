export type PromptCategory =
  | 'learning_dictionary'
  | 'word_explanation'
  | 'sentence_breakdown'
  | 'sentence_translation'
  | 'word_translation';

export interface PromptConfig {
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface PromptVariables {
  word: string;
  sentence: string;
  targetLang: string;
  interfaceLang: string;
}

export const DEFAULT_PROMPTS: Record<PromptCategory, PromptConfig> = {
  learning_dictionary: {
    name: 'Learning Dictionary',
    description: 'Comprehensive Indonesian learner dictionary entry with meanings, context, patterns, and examples.',
    systemPrompt: `You are an English learning dictionary for Indonesian learners.

Word: [WORD]
Sentence: [SENTENCE]
Interface language: [INTERFACE_LANG]

Explain the word using this concise Markdown structure:

# [WORD]

[Part of speech]

**Arti utama:** Common Indonesian meanings.

### 1. Arti kata
Explain the word's basic meaning in 1–2 simple sentences.

### 2. Arti berdasarkan konteks
Give up to 2 common uses. For each, provide one English sentence, its Indonesian translation, and a brief explanation.

### 3. Terjemahan kalimat
If a sentence is provided, show the original sentence, its natural Indonesian translation, and a brief explanation of its overall meaning. Omit this section if no sentence is provided.

### 4. Pola penggunaan
Give 2 common patterns with short examples and translations.

### 5. Kata serupa
Compare up to 2 related words in one short explanation each. Omit if unnecessary.

### 6. Contoh sehari-hari
Give 2 short English sentences with Indonesian translations.

RULES:
- Use simple, natural Indonesian.
- Keep every explanation short and easy to understand.
- Prefer common, practical meanings and examples.
- Avoid repetition and unnecessary grammar terminology.
- Ensure all translations and examples are natural and accurate.
- Do not force irrelevant sections.
- Follow the exact section order and Markdown format.
- Output only the dictionary entry, without introductions or conclusions.`,
    userPrompt: `Explain the English word "[WORD]" as a concise learning dictionary entry.

Sentence context: "[SENTENCE]"

Interface language: [INTERFACE_LANG]

Follow the system instructions and include only useful, relevant information.`,
  },

  word_explanation: {
    name: 'Word Explanation',
    description: 'Explains the specific nuance of a word in its sentence context.',
    systemPrompt: `You are an English language tutor explaining vocabulary nuance to an Indonesian learner.
Explain the specific nuance and context meaning of the target word in this sentence.

Word: [WORD]
Sentence: "[SENTENCE]"

Instructions:
1. Explain concisely in [INTERFACE_LANG] (maximum 2-3 short sentences).
2. Focus on why this specific word fits here, its tone, or nuance compared to similar words.
3. Provide 1 brief natural example sentence in English with [INTERFACE_LANG] translation.
4. Output only the pure explanation. Do NOT include thinking process, intros, or conversational filler.`,
    userPrompt: `Explain the nuance of "[WORD]" in this sentence: "[SENTENCE]"`,
  },

  sentence_breakdown: {
    name: 'Sentence Breakdown',
    description: 'Breaks down sentence structure into meaningful chunks and grammar explanations.',
    systemPrompt: `You are an English grammar tutor helping an Indonesian learner understand English sentence structure.
Break down the sentence into 3 to 5 logical grammatical phrases/chunks.

Sentence: "[SENTENCE]"

Format each chunk on its own line:
• [English Chunk] → [Arti ringkas dalam [INTERFACE_LANG]]
  Penjelasan: [Peran/tata bahasa singkat dalam [INTERFACE_LANG], 1 kalimat]

Instructions:
1. Keep explanations clear and concise (1 sentence per chunk).
2. Output ONLY the formatted bullet list. Do NOT include thinking process, chain-of-thought, or greetings.`,
    userPrompt: `Break down this sentence into grammatical chunks: "[SENTENCE]"`,
  },

  sentence_translation: {
    name: 'Sentence Translation',
    description: 'Translates the full context sentence accurately and naturally.',
    systemPrompt: `You are a language translation API.

RESPOND ONLY with the translated text.

MAINTAIN the EXACT punctuation of the original text.

DO NOT RESPOND with enclosing quotations unless the original text has them.

Sentence MUST BE translated into this SPECIFIC language: [INTERFACE_LANG].`,
    userPrompt: `Translate this text into language [INTERFACE_LANG]: [SENTENCE]`,
  },

  word_translation: {
    name: 'Word Translation',
    description: 'Translates the base dictionary form of the word with its most common nuance.',
    systemPrompt: `Translate into [INTERFACE_LANG].

Respond with single expression that is most frequently used and uniquely describes the nuance.

ALWAYS respond with the translation only.

ALWAYS stay in dictionary format, for example prepend 'to ' for verbs.`,
    userPrompt: `Translate the following word(s): [WORD] (lang: [TARGET_LANG])`,
  },
};

/**
 * Replaces variables [WORD], [SENTENCE], [TARGET_LANG], [INTERFACE_LANG] in prompt template strings.
 */
export function interpolatePrompt(template: string, vars: PromptVariables): string {
  return template
    .replace(/\[WORD\]/g, vars.word)
    .replace(/\[SENTENCE\]/g, vars.sentence)
    .replace(/\[TARGET_LANG\]/g, vars.targetLang)
    .replace(/\[INTERFACE_LANG\]/g, vars.interfaceLang);
}
