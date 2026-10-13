export interface GeminiRequestOptions {
  apiKey: string;
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
}

export interface GeminiResponse {
  text: string;
  success: boolean;
  error?: string;
}

export async function callGemini(options: GeminiRequestOptions): Promise<GeminiResponse> {
  const { apiKey, systemPrompt, userPrompt, model = 'gemini-2.5-flash' } = options;

  if (!apiKey || apiKey.trim() === '') {
    return {
      text: '',
      success: false,
      error: 'Google Gemini API Key is not set. Please enter an API Key in Extension Settings.',
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800,
    },
  };

  if (systemPrompt && systemPrompt.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const message = errData?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return {
        text: '',
        success: false,
        error: `Gemini API call failed: ${message}`,
      };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      return {
        text: '',
        success: false,
        error: 'AI response was empty or blocked by safety filters.',
      };
    }

    return {
      text: textPart.trim(),
      success: true,
    };
  } catch (err) {
    return {
      text: '',
      success: false,
      error: `Failed to connect to Gemini API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
