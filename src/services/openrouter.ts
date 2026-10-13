export interface OpenRouterRequestOptions {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OpenRouterResponse {
  text: string;
  modelUsed?: string;
  success: boolean;
  error?: string;
}

export const DEFAULT_AI_MODEL = 'google/gemma-4-26b-a4b-it:free';

/**
 * Strips internal thinking tags, reasoning scratchpads, and monologue preambles from model output.
 */
export function cleanThinkingTokens(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove XML/HTML style thinking tags: <think>...</think>, <thought>...</thought>, etc.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  cleaned = cleaned.replace(/:::thought[\s\S]*?:::/gi, '');

  // 2. Remove unclosed opening tags in case of cut-off output
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<thought>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<reasoning>[\s\S]*$/gi, '');

  // 3. Remove thinking process preambles if distinct from answer
  const preambleRegexes = [
    /^Thinking Process:[\s\S]*?(?=(?:•|Here is|Breakdown|Explanation|\n\n))/i,
    /^(?:We need to|So we need to|Let's break down|Let's analyze).*?\n\n/i,
  ];
  for (const regex of preambleRegexes) {
    cleaned = cleaned.replace(regex, '');
  }

  return cleaned.trim();
}

/**
 * Executes a single request to OpenRouter with a specific model.
 */
async function callOpenRouterSingle(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.2,
  maxTokens = 1200,
  timeoutMs = 12000
): Promise<{ text: string; modelUsed: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/english-immersion-reader',
        'X-Title': 'English Immersion Reader',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(errMsg);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }

    const choice = json.choices?.[0];
    if (choice?.error) {
      throw new Error(choice.error.message || 'Choice error from provider');
    }

    let rawContent = '';
    if (choice) {
      if (typeof choice.message?.content === 'string') {
        rawContent = choice.message.content;
      } else if (Array.isArray(choice.message?.content)) {
        rawContent = choice.message.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
          .join('\n');
      } else if (typeof choice.text === 'string') {
        rawContent = choice.text;
      }

      // If content was empty, check reasoning fields as fallback
      if (!rawContent.trim()) {
        if (typeof choice.message?.reasoning === 'string') {
          rawContent = choice.message.reasoning;
        } else if (typeof choice.message?.reasoning_content === 'string') {
          rawContent = choice.message.reasoning_content;
        }
      }
    }

    const content = cleanThinkingTokens(rawContent);

    if (!content || !content.trim()) {
      throw new Error('Empty response received from AI model');
    }

    const modelUsed = json.model || model;
    return { text: content.trim(), modelUsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main AI Engine: Calls a dedicated, fast, smart model directly.
 * If the primary model encounters a rate limit (HTTP 429) or failure, it does a single clean fallback to 'openrouter/free'.
 */
export async function callOpenRouter(options: OpenRouterRequestOptions): Promise<OpenRouterResponse> {
  const { apiKey, model = DEFAULT_AI_MODEL, systemPrompt, userPrompt, temperature = 0.2, maxTokens = 1200 } = options;

  if (!apiKey || apiKey.trim() === '') {
    return {
      text: '',
      success: false,
      error: 'OpenRouter API Key is not configured. Please enter your API Key in Settings.',
    };
  }

  // Combine system instructions with user prompt for universal model compatibility.
  const combinedUserPrompt =
    systemPrompt && systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\n---\n\n${userPrompt.trim()}`
      : userPrompt.trim();

  const messages = [{ role: 'user', content: combinedUserPrompt }];
  const primaryModel = model || DEFAULT_AI_MODEL;
  const fallbackModel = primaryModel === 'openrouter/free' ? DEFAULT_AI_MODEL : 'openrouter/free';

  // 1. Primary Request to the selected smart model
  try {
    console.log(`[AI Engine] Requesting model: ${primaryModel}...`);
    const result = await callOpenRouterSingle(
      apiKey,
      primaryModel,
      messages,
      temperature,
      maxTokens,
      12000
    );
    return {
      text: result.text,
      modelUsed: result.modelUsed,
      success: true,
    };
  } catch (primaryErr) {
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(`[AI Engine] Primary model ${primaryModel} failed (${errMsg}), switching to fallback: ${fallbackModel}...`);
  }

  // 2. Single Fallback Request
  try {
    console.log(`[AI Engine] Requesting fallback model: ${fallbackModel}...`);
    const result = await callOpenRouterSingle(
      apiKey,
      fallbackModel,
      messages,
      temperature,
      maxTokens,
      12000
    );
    return {
      text: result.text,
      modelUsed: result.modelUsed,
      success: true,
    };
  } catch (fallbackErr) {
    const errMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.warn(`[AI Engine] Fallback model ${fallbackModel} failed: ${errMsg}`);
    return {
      text: '',
      success: false,
      error: `AI request failed: ${errMsg}. Please try again in a moment.`,
    };
  }
}

/**
 * Tests an OpenRouter API Key connectivity with a specific model.
 */
export async function testOpenRouterKey(
  apiKey: string,
  model = DEFAULT_AI_MODEL
): Promise<{ success: boolean; modelUsed?: string; error?: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'Please enter an API Key first.' };
  }

  try {
    const testResult = await callOpenRouter({
      apiKey,
      model,
      systemPrompt: 'You are a test assistant.',
      userPrompt: 'Respond with only the single word: OK',
      maxTokens: 50,
    });

    if (testResult.success) {
      return {
        success: true,
        modelUsed: testResult.modelUsed,
      };
    } else {
      return {
        success: false,
        error: testResult.error,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
