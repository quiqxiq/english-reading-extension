import { StorageService, UserSettings } from '../content/storage';
import { PromptCategory, DEFAULT_PROMPTS } from '../services/promptEngine';
import { testOpenRouterKey } from '../services/openrouter';

document.addEventListener('DOMContentLoaded', async () => {
  const openRouterKeyInput = document.getElementById('openrouter-key') as HTMLInputElement;
  const openRouterModelSelect = document.getElementById('openrouter-model') as HTMLSelectElement;
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility') as HTMLButtonElement;
  const testKeyBtn = document.getElementById('test-key-btn') as HTMLButtonElement;
  const keyTestStatus = document.getElementById('key-test-status') as HTMLDivElement;

  const ankiDeckInput = document.getElementById('anki-deck') as HTMLInputElement;
  const ankiAllowDuplicatesCheckbox = document.getElementById('anki-allow-duplicates') as HTMLInputElement;
  const dictProviderSelect = document.getElementById('dict-provider') as HTMLSelectElement;
  const transProviderSelect = document.getElementById('trans-provider') as HTMLSelectElement;
  const interfaceLangInput = document.getElementById('interface-lang') as HTMLInputElement;
  const targetLangInput = document.getElementById('target-lang') as HTMLInputElement;
  const ytShadowingDelayInput = document.getElementById('yt-shadowing-delay') as HTMLInputElement;
  const ytShadowingEnabledCheckbox = document.getElementById('yt-shadowing-enabled') as HTMLInputElement;

  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const resetPromptsBtn = document.getElementById('reset-prompts-btn') as HTMLButtonElement;
  const toast = document.getElementById('toast') as HTMLDivElement;
  const tabBtns = document.querySelectorAll('.prompt-tab-btn');
  const editorsContainer = document.getElementById('prompt-editors-container') as HTMLDivElement;

  let currentSettings: UserSettings = await StorageService.getSettings();
  let activeCategory: PromptCategory = 'learning_dictionary';

  // 1. Fill general settings form
  openRouterKeyInput.value = currentSettings.openRouterApiKey || currentSettings.geminiApiKey || '';
  openRouterModelSelect.value = currentSettings.openRouterModel || 'google/gemma-4-26b-a4b-it:free';
  ankiDeckInput.value = currentSettings.ankiDeck || 'English Immersion';
  ankiAllowDuplicatesCheckbox.checked = currentSettings.allowDuplicateCards !== false;
  const currentDict = currentSettings.dictionaryProvider || 'cambridge';
  dictProviderSelect.value = currentDict === 'cambridge_learner' ? 'cambridge' : currentDict === 'oxford_learner' ? 'oxford' : currentDict;
  transProviderSelect.value = currentSettings.translationProvider || 'google';
  interfaceLangInput.value = currentSettings.interfaceLang || 'Indonesian';
  targetLangInput.value = currentSettings.targetLang || 'English';
  if (ytShadowingDelayInput) ytShadowingDelayInput.value = (currentSettings.youtubeShadowingDelay ?? 2.5).toString();
  if (ytShadowingEnabledCheckbox) ytShadowingEnabledCheckbox.checked = currentSettings.youtubeShadowingEnabled !== false;

  // Toggle API Key Visibility
  toggleKeyVisibilityBtn?.addEventListener('click', () => {
    if (openRouterKeyInput.type === 'password') {
      openRouterKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = '🙈';
    } else {
      openRouterKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = '👁️';
    }
  });

  // Test OpenRouter API Key Connection with selected Model
  testKeyBtn?.addEventListener('click', async () => {
    const key = openRouterKeyInput.value.trim();
    const model = openRouterModelSelect.value;
    if (!key) {
      keyTestStatus.style.display = 'block';
      keyTestStatus.className = 'key-status-msg error';
      keyTestStatus.textContent = 'Please enter an OpenRouter API Key first before testing.';
      return;
    }

    testKeyBtn.disabled = true;
    testKeyBtn.textContent = '⏳ Testing...';
    keyTestStatus.style.display = 'block';
    keyTestStatus.className = 'key-status-msg';
    keyTestStatus.textContent = `Connecting to model "${model}"...`;

    const res = await testOpenRouterKey(key, model);

    testKeyBtn.disabled = false;
    testKeyBtn.textContent = '🧪 Test API Connection';

    if (res.success) {
      keyTestStatus.className = 'key-status-msg success';
      keyTestStatus.textContent = `✓ Connection Successful! Model "${res.modelUsed}" responded successfully.`;
    } else {
      keyTestStatus.className = 'key-status-msg error';
      keyTestStatus.textContent = `❌ Connection Test Failed: ${res.error}`;
    }
  });

  // 2. Render prompt editor for active category
  function renderPromptEditor(): void {
    const config = currentSettings.prompts[activeCategory] || DEFAULT_PROMPTS[activeCategory];
    editorsContainer.innerHTML = `
      <div class="prompt-editor-pane">
        <div>
          <h3 style="font-size: 15px; font-weight: 600; color: #0f172a;">${config.name}</h3>
          <p class="prompt-desc">${config.description}</p>
        </div>

        <div class="form-group">
          <label>SYSTEM PROMPT</label>
          <textarea id="editor-system-prompt" rows="8">${config.systemPrompt}</textarea>
        </div>

        <div class="form-group">
          <label>USER PROMPT</label>
          <textarea id="editor-user-prompt" rows="3">${config.userPrompt}</textarea>
        </div>
      </div>
    `;

    // Attach input listeners to keep changes in memory
    const sysEl = document.getElementById('editor-system-prompt') as HTMLTextAreaElement;
    const usrEl = document.getElementById('editor-user-prompt') as HTMLTextAreaElement;

    sysEl?.addEventListener('input', () => {
      currentSettings.prompts[activeCategory].systemPrompt = sysEl.value;
    });

    usrEl?.addEventListener('input', () => {
      currentSettings.prompts[activeCategory].userPrompt = usrEl.value;
    });
  }

  renderPromptEditor();

  // 3. Tab switching
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      const target = e.currentTarget as HTMLElement;
      target.classList.add('active');
      activeCategory = target.dataset.cat as PromptCategory;
      renderPromptEditor();
    });
  });

  // 4. Save Button
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    currentSettings.openRouterApiKey = openRouterKeyInput.value.trim();
    currentSettings.openRouterModel = openRouterModelSelect.value;
    currentSettings.geminiApiKey = openRouterKeyInput.value.trim(); // backward-compatibility
    currentSettings.ankiDeck = ankiDeckInput.value.trim() || 'English Immersion';
    currentSettings.allowDuplicateCards = ankiAllowDuplicatesCheckbox.checked;
    currentSettings.dictionaryProvider = dictProviderSelect.value as any;
    currentSettings.translationProvider = transProviderSelect.value as any;
    currentSettings.interfaceLang = interfaceLangInput.value.trim() || 'Indonesian';
    currentSettings.targetLang = targetLangInput.value.trim() || 'English';
    if (ytShadowingDelayInput) {
      currentSettings.youtubeShadowingDelay = parseFloat(ytShadowingDelayInput.value) || 2.5;
    }
    if (ytShadowingEnabledCheckbox) {
      currentSettings.youtubeShadowingEnabled = ytShadowingEnabledCheckbox.checked;
    }

    await StorageService.saveSettings(currentSettings);

    showToast('✓ Settings and Custom AI Prompts saved successfully!');
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Changes';
  });

  // 5. Reset Prompts to Default Button
  resetPromptsBtn.addEventListener('click', async () => {
    const confirmReset = confirm(
      'Are you sure you want to reset all System Prompts and User Prompts back to default settings?'
    );
    if (!confirmReset) return;

    await StorageService.resetPrompts();
    currentSettings = await StorageService.getSettings();
    renderPromptEditor();
    showToast('✓ All prompts have been reset to default.');
  });

  function showToast(message: string): void {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }
});
