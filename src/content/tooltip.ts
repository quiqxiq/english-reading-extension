import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom';
import { StorageService, WordStatus } from './storage';
import { DOMTokenizer } from './tokenizer';
import { AnkiService } from '../services/anki';
import { callOpenRouter, cleanThinkingTokens, OpenRouterResponse } from '../services/openrouter';
import { interpolatePrompt } from '../services/promptEngine';
import { marked } from 'marked';
import {
  fetchDictionaryByProvider,
  fetchFullTranslation,
  fetchAiDictionary,
  fetchCambridgeEnglish,
  getExternalDictionaryUrls,
  DictionaryEntry,
  TranslationResult,
} from '../services/dictionary';
import { Icons } from '../components/icons';

export class TooltipManager {
  private static hostElement: HTMLElement | null = null;
  private static shadowRoot: ShadowRoot | null = null;
  private static tooltipContainer: HTMLElement | null = null;
  private static cleanupAutoUpdate: (() => void) | null = null;

  private static currentWord = '';
  private static currentSentence = '';
  private static currentTargetElement: HTMLElement | null = null;
  private static currentRequestId = 0;
  private static currentTab = 'dict';
  private static isLoadingInitialData = false;
  private static initialDataPromise: Promise<void> | null = null;

  // Cached data for current word session
  private static cachedDict: DictionaryEntry | null = null;
  private static cachedTransResult: TranslationResult | null = null;
  private static cachedNuance = '';
  private static cachedAiTabs: {
    learning_dict?: { text: string; modelUsed?: string };
    nuance?: { text: string; modelUsed?: string };
    breakdown?: { text: string; modelUsed?: string };
  } = {};
  private static inFlightAiPromises: {
    learning_dict?: Promise<any>;
    nuance?: Promise<any>;
    breakdown?: Promise<any>;
  } = {};
  private static isCurrentWordInAnki: boolean | null = null;

  static init(): void {
    if (this.hostElement) return;

    this.hostElement = document.createElement('div');
    this.hostElement.id = 'eir-shadow-host';
    this.hostElement.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
    document.documentElement.appendChild(this.hostElement);

    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    // Inject isolated styles into Shadow DOM
    const style = document.createElement('style');
    style.textContent = this.getShadowStyles();
    this.shadowRoot.appendChild(style);

    this.tooltipContainer = document.createElement('div');
    this.tooltipContainer.className = 'eir-tooltip-box';
    this.tooltipContainer.style.display = 'none';
    this.shadowRoot.appendChild(this.tooltipContainer);

    // Close on click outside
    document.addEventListener('mousedown', (e) => {
      if (!this.tooltipContainer || this.tooltipContainer.style.display === 'none') return;
      const path = e.composedPath();
      if (this.hostElement && path.includes(this.hostElement)) return;
      if (this.currentTargetElement && path.includes(this.currentTargetElement)) return;
      this.hide();
    });
  }

  static async show(targetEl: HTMLElement): Promise<void> {
    this.init();
    if (!this.tooltipContainer) return;

    this.currentTargetElement = targetEl;
    this.currentWord = targetEl.dataset.eirWord || targetEl.textContent || '';
    this.currentSentence = targetEl.dataset.eirSentence || '';
    const reqId = ++this.currentRequestId;
    this.currentTab = 'dict';
    this.isLoadingInitialData = true;

    this.cachedDict = null;
    this.cachedTransResult = null;
    this.cachedNuance = '';
    this.cachedAiTabs = {};
    this.inFlightAiPromises = {};
    this.isCurrentWordInAnki = null;

    const currentStatus = await StorageService.getWordStatus(this.currentWord);

    // Check if another word was triggered while fetching status
    if (this.currentRequestId !== reqId) return;

    this.renderSkeleton(this.currentWord, this.currentSentence, currentStatus);
    this.tooltipContainer.style.display = 'block';

    // Asynchronously detect if word is already in Anki (for Learning Dict tab)
    StorageService.getSettings().then((settings) => {
      AnkiService.findNotesForWord(this.currentWord, settings.ankiDeck).then((notes) => {
        if (this.currentRequestId !== reqId) return;
        this.isCurrentWordInAnki = notes.length > 0;
        const footerBtn = this.shadowRoot?.getElementById('eir-ai-footer-anki-btn');
        if (footerBtn && !footerBtn.classList.contains('saved')) {
          if (this.isCurrentWordInAnki) {
            footerBtn.innerHTML = `${Icons.refresh({ size: 13 })} Update / Append to Anki`;
            footerBtn.classList.add('update');
          } else {
            footerBtn.innerHTML = `${Icons.plus({ size: 13 })} Add to Anki with this Explanation`;
            footerBtn.classList.remove('update');
          }
        }
      });
    });

    if (this.cleanupAutoUpdate) this.cleanupAutoUpdate();
    this.cleanupAutoUpdate = autoUpdate(targetEl, this.tooltipContainer, () => {
      if (!this.tooltipContainer || !this.currentTargetElement) return;
      computePosition(this.currentTargetElement, this.tooltipContainer, {
        placement: 'bottom-start',
        middleware: [offset(8), flip(), shift({ padding: 12 })],
      }).then(({ x, y }) => {
        if (!this.tooltipContainer) return;
        Object.assign(this.tooltipContainer.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });

    // Fetch dictionary & full translation in background
    this.initialDataPromise = this.loadInitialData(this.currentWord, reqId);
  }

  static hide(): void {
    this.currentRequestId++; // Invalidate any running asynchronous tasks
    this.isLoadingInitialData = false;
    this.initialDataPromise = null;
    this.inFlightAiPromises = {};
    if (this.cleanupAutoUpdate) {
      this.cleanupAutoUpdate();
      this.cleanupAutoUpdate = null;
    }
    if (this.tooltipContainer) {
      this.tooltipContainer.style.display = 'none';
    }
    this.currentTargetElement = null;
  }

  private static renderSkeleton(word: string, sentence: string, status: WordStatus): void {
    if (!this.tooltipContainer) return;

    this.tooltipContainer.innerHTML = `
      <div class="eir-header">
        <div class="eir-word-title-row">
          <span class="eir-word-name">${word}</span>
          <div id="eir-phonetics-container" class="eir-phonetics-container"></div>
          <div id="eir-audios-container" class="eir-audios-container"></div>
        </div>
        <button class="eir-close-btn" id="eir-close-btn" title="Close">${Icons.close({ size: 16 })}</button>
      </div>

      <!-- Quick Translation Snippet in Header -->
      <div id="eir-quick-trans-pill" class="eir-quick-trans-pill" style="display: none;"></div>

      <!-- Quick Context Sentence -->
      <div class="eir-context-sentence">
        "${this.highlightTargetWord(sentence, word)}"
      </div>

      <!-- Word Status & Anki Action Bar -->
      <div class="eir-action-bar">
        <div class="eir-status-group">
          <span class="eir-label">Status:</span>
          <button class="eir-status-pill ${status === 'unknown' ? 'active unknown' : ''}" data-status="unknown">Unknown</button>
          <button class="eir-status-pill ${status === 'learning' ? 'active learning' : ''}" data-status="learning">Learn</button>
          <button class="eir-status-pill ${status === 'known' ? 'active known' : ''}" data-status="known">Known</button>
        </div>
        <button class="eir-anki-btn" id="eir-anki-btn">${Icons.plus({ size: 14 })} Add to Anki</button>
      </div>

      <!-- Tabs Navigation (Official Library Icons Only + Standard Hover Tooltip) -->
      <div class="eir-tabs-bar">
        <div class="eir-tabs-icons">
          <button class="eir-tab-btn active" data-tab="dict" title="Cambridge Dictionary" aria-label="Dictionary">
            ${Icons.book({ size: 18 })}
          </button>
          <button class="eir-tab-btn" data-tab="learning_dict" title="Learning Dict (AI)" aria-label="Learning Dict (AI)">
            ${Icons.graduationCap({ size: 18 })}
          </button>
          <button class="eir-tab-btn" data-tab="trans" title="Translation" aria-label="Translation">
            ${Icons.languages({ size: 18 })}
          </button>
          <button class="eir-tab-btn" data-tab="nuance" title="Word Nuance (AI)" aria-label="Word Nuance (AI)">
            ${Icons.lightbulb({ size: 18 })}
          </button>
          <button class="eir-tab-btn" data-tab="breakdown" title="Sentence Breakdown (AI)" aria-label="Sentence Breakdown (AI)">
            ${Icons.puzzle({ size: 18 })}
          </button>
        </div>
        <div class="eir-tab-indicator" id="eir-tab-indicator">Dictionary</div>
      </div>

      <!-- Tab Content Area -->
      <div class="eir-tab-content" id="eir-tab-content">
        <div class="eir-loading">Loading dictionary and translation...</div>
      </div>
    `;

    // Event Listeners
    this.setupListeners();
  }

  private static highlightTargetWord(sentence: string, word: string): string {
    if (!sentence) return '';
    const regex = new RegExp(`\\b(${word})\\b`, 'gi');
    return sentence.replace(regex, '<mark class="eir-mark">$1</mark>');
  }

  private static setupListeners(): void {
    if (!this.shadowRoot) return;

    // Close button
    this.shadowRoot.getElementById('eir-close-btn')?.addEventListener('click', () => this.hide());

    // Status change buttons
    const statusButtons = this.shadowRoot.querySelectorAll('.eir-status-pill');
    statusButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const newStatus = target.dataset.status as WordStatus;
        await StorageService.setWordStatus(this.currentWord, newStatus);
        DOMTokenizer.updateWordStatusOnPage(this.currentWord, newStatus);

        statusButtons.forEach((b) => b.classList.remove('active', 'unknown', 'learning', 'known'));
        target.classList.add('active', newStatus);
      });
    });

    // Anki Add / Update Note Button
    const ankiBtn = this.shadowRoot.getElementById('eir-anki-btn');
    ankiBtn?.addEventListener('click', async () => {
      await this.saveCurrentWordToAnki();
    });

    // Tab buttons
    const tabLabels: Record<string, string> = {
      dict: 'Dictionary',
      learning_dict: 'Learning Dict (AI)',
      trans: 'Translation',
      nuance: 'Word Nuance (AI)',
      breakdown: 'Sentence Breakdown (AI)',
    };
    const tabBtns = this.shadowRoot.querySelectorAll('.eir-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        tabBtns.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        const tab = target.dataset.tab;
        if (tab) {
          const indicator = this.shadowRoot?.getElementById('eir-tab-indicator');
          if (indicator && tabLabels[tab]) {
            indicator.textContent = tabLabels[tab];
          }
          this.switchTab(tab);
        }
      });
    });
  }

  private static async loadInitialData(word: string, requestId: number): Promise<void> {
    const settings = await StorageService.getSettings();

    const [dict, transResult] = await Promise.all([
      fetchDictionaryByProvider(
        word,
        settings.dictionaryProvider,
        this.currentSentence,
        settings.openRouterApiKey,
        settings.openRouterModel
      ),
      fetchFullTranslation(word, this.currentSentence, settings.translationProvider),
    ]);

    // Check if request is stale or cancelled
    if (this.currentRequestId !== requestId || this.currentWord !== word) {
      return;
    }

    this.isLoadingInitialData = false;
    this.cachedDict = dict;
    this.cachedTransResult = transResult;

    // Update Header Phonetic & Audio
    this.updateHeaderPhoneticsAndAudios(dict, transResult);

    if (this.currentTab === 'dict') {
      this.renderDictionaryTab();
    } else if (this.currentTab === 'trans') {
      this.renderTranslationTab();
    }
  }

  private static updateHeaderPhoneticsAndAudios(
    dict: DictionaryEntry | null,
    transResult: TranslationResult | null
  ): void {
    if (!this.shadowRoot) return;

    // 1. Phonetics
    const phonContainer = this.shadowRoot.getElementById('eir-phonetics-container');
    if (phonContainer) {
      let phonHtml = '';
      if (dict?.phonetics.uk) {
        phonHtml += `<span class="eir-phon-tag">UK ${dict.phonetics.uk}</span>`;
      }
      if (dict?.phonetics.us) {
        phonHtml += `<span class="eir-phon-tag">US ${dict.phonetics.us}</span>`;
      }
      if (!phonHtml && dict?.phonetics.default) {
        phonHtml += `<span class="eir-phon-tag">${dict.phonetics.default}</span>`;
      }
      phonContainer.innerHTML = phonHtml;
    }

    // 2. Audio Buttons (UK & US)
    const audiosContainer = this.shadowRoot.getElementById('eir-audios-container');
    if (audiosContainer && dict?.audios && dict.audios.length > 0) {
      audiosContainer.innerHTML = dict.audios
        .map(
          (a) =>
            `<button class="eir-audio-pill-btn" data-url="${a.url}" title="Listen (${a.label})">${Icons.volume({ size: 12 })} ${a.label}</button>`
        )
        .join('');

      audiosContainer.querySelectorAll('.eir-audio-pill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const url = (e.currentTarget as HTMLElement).dataset.url;
          if (url) {
            const audio = new Audio(url);
            audio.play();
          }
        });
      });
    }

    // 3. Quick Translation Pill in Header
    const quickTransPill = this.shadowRoot.getElementById('eir-quick-trans-pill');
    if (quickTransPill && transResult?.wordTranslation) {
      quickTransPill.innerHTML = `
        <span class="eir-pill-label">Meaning:</span>
        <span class="eir-pill-val">${transResult.wordTranslation}</span>
        <span class="eir-pill-source">(${transResult.providerName})</span>
      `;
      quickTransPill.style.display = 'flex';
    }
  }

  /**
   * TAB 1: Complete Dictionary
   * Displays full definitions from Cambridge / Oxford / FreeDict / AI Smart Dictionary
   */
  private static renderDictionaryTab(): void {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    if (this.isLoadingInitialData) {
      content.innerHTML = '<div class="eir-loading">Loading dictionary and translation...</div>';
      return;
    }

    const extUrls = getExternalDictionaryUrls(this.currentWord);
    const isAiDict = this.cachedDict?.providerName === 'AI Smart Dictionary';
    const providerName = this.cachedDict?.providerName || 'Cambridge Dictionary';
    const providerUrl = this.cachedDict?.providerUrl || extUrls.cambridgeEnglish;

    let html = `
      <div class="eir-provider-header">
        <span class="eir-provider-tag">${isAiDict ? Icons.sparkles({ size: 12 }) : Icons.book({ size: 12 })} ${providerName}</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${
            isAiDict
              ? `<button id="eir-switch-to-cambridge-btn" class="eir-dict-mode-btn" title="Switch to Official Cambridge Dictionary">📖 Cambridge</button>`
              : `<button id="eir-switch-to-ai-btn" class="eir-dict-mode-btn ai-btn" title="Generate comprehensive dictionary entry using AI">✨ AI Dict</button>`
          }
          <a href="${providerUrl}" target="_blank" rel="noopener" class="eir-open-web-link">Open Web ${Icons.externalLink({ size: 11 })}</a>
        </div>
      </div>
    `;

    if (this.cachedDict && this.cachedDict.groups.length > 0) {
      html += '<div class="eir-dict-groups">';
      for (const group of this.cachedDict.groups) {
        html += `
          <div class="eir-dict-group">
            <div class="eir-group-pos-badge">${group.partOfSpeech.toUpperCase()}</div>
            <ol class="eir-def-list">
              ${group.definitions
                .map(
                  (item) => `
                <li class="eir-def-item">
                  <div class="eir-def-text">
                    ${item.cefr ? `<span class="eir-cefr-badge">${item.cefr}</span>` : ''}
                    ${item.definition}
                  </div>
                  ${
                    item.examples.length > 0
                      ? `
                    <div class="eir-examples-list">
                      ${item.examples.map((ex) => `<div class="eir-example">💬 "${ex}"</div>`).join('')}
                    </div>
                  `
                      : ''
                  }
                </li>
              `
                )
                .join('')}
            </ol>
          </div>
        `;
      }
      html += '</div>';
    } else {
      html += `
        <div class="eir-empty">
          <p style="margin-bottom: 8px;">No dictionary entry found for "<b>${this.currentWord}</b>" in ${providerName}.</p>
          ${
            !isAiDict
              ? `<button id="eir-ai-dict-fallback-btn" class="eir-action-pill-btn">${Icons.sparkles({ size: 13 })} Explain with AI (Dictionary Format)</button>`
              : `<p style="font-size: 11.5px; color: #64748b;">Try opening official web or checking your OpenRouter API key.</p>`
          }
        </div>
      `;
    }

    // Quick External Links Bar
    html += this.renderQuickLinks(extUrls);
    content.innerHTML = html;

    // Attach AI Dictionary / Cambridge Dictionary action buttons
    this.shadowRoot?.getElementById('eir-switch-to-ai-btn')?.addEventListener('click', () => {
      this.generateAiDictionaryEntry();
    });
    this.shadowRoot?.getElementById('eir-ai-dict-fallback-btn')?.addEventListener('click', () => {
      this.generateAiDictionaryEntry();
    });
    this.shadowRoot?.getElementById('eir-switch-to-cambridge-btn')?.addEventListener('click', () => {
      this.loadCambridgeDictionaryEntry();
    });
  }

  /**
   * Generates Cambridge/Oxford-style structured dictionary entry using AI on demand.
   */
  private static async generateAiDictionaryEntry(): Promise<void> {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    const reqId = this.currentRequestId;
    const activeWord = this.currentWord;

    content.innerHTML = `<div class="eir-loading">${Icons.sparkles({ size: 16 })} AI is generating dictionary entry...</div>`;

    const settings = await StorageService.getSettings();
    const apiKey = settings.openRouterApiKey || settings.geminiApiKey;

    if (!apiKey) {
      content.innerHTML = `
        <div class="eir-api-warning">
          <div style="font-weight: 700; margin-bottom: 4px; color: #92400e;">OpenRouter API Key Not Configured</div>
          <div style="font-size: 12px; margin-bottom: 8px; color: #78350f; line-height: 1.4;">
            To use AI Smart Dictionary, please enter your free OpenRouter API key.
          </div>
          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <input type="password" id="eir-quick-dict-key" placeholder="Paste sk-or-v1-..." style="flex: 1; padding: 6px 8px; border: 1px solid #d97706; border-radius: 6px; font-size: 12px; outline: none; background: #ffffff; color: #0f172a;">
            <button id="eir-save-dict-key" style="background: #2563eb; color: #ffffff; border: none; border-radius: 6px; padding: 6px 12px; font-weight: 600; font-size: 12px; cursor: pointer;">Save</button>
          </div>
        </div>
      `;

      this.shadowRoot?.getElementById('eir-save-dict-key')?.addEventListener('click', async () => {
        const inputEl = this.shadowRoot?.getElementById('eir-quick-dict-key') as HTMLInputElement | null;
        const keyVal = inputEl?.value.trim();
        if (keyVal) {
          await StorageService.saveSettings({ openRouterApiKey: keyVal });
          this.generateAiDictionaryEntry();
        }
      });
      return;
    }

    const aiEntry = await fetchAiDictionary(
      activeWord,
      this.currentSentence,
      apiKey,
      settings.openRouterModel
    );

    if (this.currentRequestId !== reqId || this.currentWord !== activeWord || this.currentTab !== 'dict') {
      return;
    }

    if (aiEntry) {
      this.cachedDict = aiEntry;
      this.updateHeaderPhoneticsAndAudios(this.cachedDict, this.cachedTransResult);
      this.renderDictionaryTab();
    } else {
      content.innerHTML = `
        <div class="eir-empty">
          <p style="color: #ef4444; margin-bottom: 8px;">Failed to generate AI dictionary entry. Model may be busy.</p>
          <button id="eir-retry-cambridge-btn" class="eir-action-pill-btn">📖 Back to Cambridge</button>
        </div>
      `;
      this.shadowRoot?.getElementById('eir-retry-cambridge-btn')?.addEventListener('click', () => {
        this.loadCambridgeDictionaryEntry();
      });
    }
  }

  /**
   * Switches back to official Cambridge Dictionary.
   */
  private static async loadCambridgeDictionaryEntry(): Promise<void> {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    const reqId = this.currentRequestId;
    const activeWord = this.currentWord;

    content.innerHTML = '<div class="eir-loading">Fetching Cambridge Dictionary...</div>';

    const cambridgeEntry = await fetchCambridgeEnglish(activeWord);

    if (this.currentRequestId !== reqId || this.currentWord !== activeWord || this.currentTab !== 'dict') {
      return;
    }

    this.cachedDict = cambridgeEntry;
    this.updateHeaderPhoneticsAndAudios(this.cachedDict, this.cachedTransResult);
    this.renderDictionaryTab();
  }

  /**
   * TAB 2: Dedicated Translation
   * Displays clear translation for target word and context sentence
   */
  private static renderTranslationTab(): void {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    if (this.isLoadingInitialData) {
      content.innerHTML = '<div class="eir-loading">Loading translation...</div>';
      return;
    }

    const extUrls = getExternalDictionaryUrls(this.currentWord);
    const trans = this.cachedTransResult;
    const providerName = trans?.providerName || 'Google Translate';
    const providerUrl = trans?.providerUrl || extUrls.googleTranslate;

    let html = `
      <div class="eir-provider-header">
        <span class="eir-provider-tag">${Icons.languages({ size: 12 })} Source: ${providerName}</span>
        <a href="${providerUrl}" target="_blank" rel="noopener" class="eir-open-web-link">Open in Web ${Icons.externalLink({ size: 11 })}</a>
      </div>

      <div class="eir-trans-cards">
        <div class="eir-trans-card">
          <div class="eir-card-label">Word Translation [${this.currentWord}]:</div>
          <div class="eir-card-value-primary">${trans?.wordTranslation || '-'}</div>
        </div>

        ${
          this.currentSentence
            ? `
          <div class="eir-trans-card">
            <div class="eir-card-label">Sentence Translation:</div>
            <div class="eir-card-sentence-orig">"${this.currentSentence}"</div>
            <div class="eir-card-value-sentence">${trans?.sentenceTranslation || 'Loading sentence translation...'}</div>
          </div>
        `
            : ''
        }
      </div>
    `;

    html += this.renderQuickLinks(extUrls);
    content.innerHTML = html;
  }

  private static renderQuickLinks(extUrls: ReturnType<typeof getExternalDictionaryUrls>): string {
    return `
      <div class="eir-quick-links">
        <span class="eir-links-title">Official References:</span>
        <a href="${extUrls.cambridgeEnglish}" target="_blank" rel="noopener" class="eir-link-badge" title="Open Cambridge English Dictionary">
          ${Icons.book({ size: 12 })} Cambridge ${Icons.externalLink({ size: 10 })}
        </a>
        <a href="${extUrls.oxfordLearner}" target="_blank" rel="noopener" class="eir-link-badge" title="Open Oxford Learner's Dictionaries">
          ${Icons.book({ size: 12 })} Oxford ${Icons.externalLink({ size: 10 })}
        </a>
        <a href="${extUrls.cambridgeTranslate}" target="_blank" rel="noopener" class="eir-link-badge" title="Open Cambridge Translate">
          ${Icons.languages({ size: 12 })} Cambridge Trans ${Icons.externalLink({ size: 10 })}
        </a>
        <a href="${extUrls.googleTranslate}" target="_blank" rel="noopener" class="eir-link-badge" title="Open Google Translate">
          ${Icons.languages({ size: 12 })} Google Trans ${Icons.externalLink({ size: 10 })}
        </a>
      </div>
    `;
  }

  private static async switchTab(tab: string): Promise<void> {
    this.currentTab = tab;
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    const tabLabels: Record<string, string> = {
      dict: 'Dictionary',
      learning_dict: 'Learning Dict (AI)',
      trans: 'Translation',
      nuance: 'Word Nuance (AI)',
      breakdown: 'Sentence Breakdown (AI)',
    };
    const indicator = this.shadowRoot?.getElementById('eir-tab-indicator');
    if (indicator && tabLabels[tab]) {
      indicator.textContent = tabLabels[tab];
    }
    const tabBtns = this.shadowRoot?.querySelectorAll('.eir-tab-btn');
    tabBtns?.forEach((b) => {
      if ((b as HTMLElement).dataset.tab === tab) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    if (tab === 'dict') {
      this.renderDictionaryTab();
      return;
    }

    if (tab === 'trans') {
      this.renderTranslationTab();
      return;
    }

    if (tab === 'learning_dict' || tab === 'nuance' || tab === 'breakdown') {
      // 1. Instant session cache: if already loaded for this word, render immediately without reconnecting!
      const cached = this.cachedAiTabs[tab as 'learning_dict' | 'nuance' | 'breakdown'];
      if (cached) {
        this.renderAiTabContent(cached.text, cached.modelUsed, tab as 'learning_dict' | 'nuance' | 'breakdown');
        return;
      }

      // 2. Otherwise load via AI
      await this.loadAiTab(tab as 'learning_dict' | 'nuance' | 'breakdown');
    }
  }

  private static async loadAiTab(tab: 'learning_dict' | 'nuance' | 'breakdown'): Promise<void> {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    const reqId = this.currentRequestId;
    const activeWord = this.currentWord;

    content.innerHTML = `<div class="eir-loading">${Icons.sparkles({ size: 16 })} Contacting AI...</div>`;
    const settings = await StorageService.getSettings();

    const apiKey = settings.openRouterApiKey || settings.geminiApiKey;

    if (!apiKey) {
      if (this.currentRequestId !== reqId || this.currentWord !== activeWord || this.currentTab !== tab) {
        return;
      }
      content.innerHTML = `
        <div class="eir-api-warning">
          <div style="font-weight: 700; margin-bottom: 4px; color: #92400e;">OpenRouter API Key Not Configured</div>
          <div style="font-size: 12px; margin-bottom: 8px; color: #78350f; line-height: 1.4;">
            Get a free API key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Free models with automatic fallback will be used automatically.
          </div>
          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <input type="password" id="eir-quick-api-key" placeholder="Paste sk-or-v1-..." style="flex: 1; padding: 6px 8px; border: 1px solid #d97706; border-radius: 6px; font-size: 12px; outline: none; background: #ffffff; color: #0f172a;">
            <button id="eir-save-quick-key" style="background: #2563eb; color: #ffffff; border: none; border-radius: 6px; padding: 6px 12px; font-weight: 600; font-size: 12px; cursor: pointer;">Save</button>
          </div>
          <div style="font-size: 11px;">Or <a href="#" id="eir-open-settings" style="color: #2563eb; text-decoration: underline;">open full settings</a>.</div>
        </div>
      `;

      this.shadowRoot?.getElementById('eir-save-quick-key')?.addEventListener('click', async () => {
        const inputEl = this.shadowRoot?.getElementById('eir-quick-api-key') as HTMLInputElement | null;
        const keyVal = inputEl?.value.trim();
        if (keyVal) {
          await StorageService.saveSettings({ openRouterApiKey: keyVal });
          this.switchTab(tab);
        } else {
          alert('Please enter an API Key first.');
        }
      });

      this.shadowRoot?.getElementById('eir-open-settings')?.addEventListener('click', (e) => {
        e.preventDefault();
        browser.runtime.openOptionsPage();
      });
      return;
    }

    const vars = {
      word: this.currentWord,
      sentence: this.currentSentence,
      targetLang: settings.targetLang,
      interfaceLang: settings.interfaceLang,
    };

    let promptKey: keyof typeof settings.prompts;
    if (tab === 'learning_dict') {
      promptKey = 'learning_dictionary';
    } else if (tab === 'nuance') {
      promptKey = 'word_explanation';
    } else {
      promptKey = 'sentence_breakdown';
    }

    const promptConfig = settings.prompts[promptKey];
    const systemPrompt = interpolatePrompt(promptConfig.systemPrompt, vars);
    const userPrompt = interpolatePrompt(promptConfig.userPrompt, vars);

    // Reuse in-flight promise if user clicked away and clicked back
    let requestPromise = this.inFlightAiPromises[tab];
    if (!requestPromise) {
      requestPromise = callOpenRouter({
        apiKey,
        model: settings.openRouterModel,
        systemPrompt,
        userPrompt,
        maxTokens: 1200,
      });
      this.inFlightAiPromises[tab] = requestPromise;
    }

    let res: OpenRouterResponse;
    try {
      res = await requestPromise;
    } finally {
      delete this.inFlightAiPromises[tab];
    }

    // Save to session cache if successful
    if (res.success) {
      this.cachedAiTabs[tab] = { text: res.text, modelUsed: res.modelUsed };
      if (tab === 'nuance') {
        this.cachedNuance = res.text;
      }
    }

    // Check if user is still on this tab and word
    if (this.currentRequestId !== reqId || this.currentWord !== activeWord || this.currentTab !== tab) {
      return;
    }

    if (res.success) {
      this.renderAiTabContent(res.text, res.modelUsed, tab);
    } else {
      content.innerHTML = `<div class="eir-error">${res.error}</div>`;
    }
  }

  private static renderAiTabContent(
    text: string,
    modelUsed?: string,
    tab: 'learning_dict' | 'nuance' | 'breakdown' = 'learning_dict'
  ): void {
    const content = this.shadowRoot?.getElementById('eir-tab-content');
    if (!content) return;

    const modelLabel = modelUsed ? modelUsed.replace(':free', '') : 'AI';
    const clean = cleanThinkingTokens(text);
    const parsedHtml = marked.parse(clean, { gfm: true, breaks: true }) as string;

    if (tab === 'learning_dict') {
      const html = `
        <div class="eir-learn-dict-container">
          <div class="eir-ai-badge learning-dict">${Icons.graduationCap({ size: 12 })} ${modelLabel} • Indonesian Learning Dictionary</div>
          <div class="eir-markdown-body">
            ${parsedHtml}
          </div>
          <div class="eir-ai-footer-bar">
            <button id="eir-ai-footer-anki-btn" class="eir-ai-footer-btn ${this.isCurrentWordInAnki ? 'update' : ''}">
              ${this.isCurrentWordInAnki ? Icons.refresh({ size: 13 }) : Icons.plus({ size: 13 })}
              ${this.isCurrentWordInAnki ? 'Update / Append to Anki' : 'Add to Anki with this Explanation'}
            </button>
          </div>
        </div>
      `;

      content.innerHTML = html;

      this.shadowRoot?.getElementById('eir-ai-footer-anki-btn')?.addEventListener('click', async () => {
        await this.saveCurrentWordToAnki(clean);
      });
      return;
    }

    // For nuance and breakdown tabs: no Anki update button
    const tabTitle = tab === 'nuance' ? 'Word Context Nuance' : 'Grammar Breakdown';
    const html = `
      <div class="eir-ai-result">
        <div class="eir-ai-badge">${Icons.sparkles({ size: 12 })} AI: ${modelLabel} • ${tabTitle}</div>
        <div class="eir-markdown-body eir-ai-text">
          ${parsedHtml}
        </div>
      </div>
    `;

    content.innerHTML = html;
  }

  /**
   * Unified method to add or append word and explanation to Anki.
   */
  private static async saveCurrentWordToAnki(customExplanation?: string): Promise<void> {
    const ankiBtn = this.shadowRoot?.getElementById('eir-anki-btn');
    const footerBtn = this.shadowRoot?.getElementById('eir-ai-footer-anki-btn');

    if (ankiBtn) {
      ankiBtn.textContent = '⏳ Saving...';
      (ankiBtn as HTMLButtonElement).disabled = true;
    }
    if (footerBtn) {
      footerBtn.textContent = '⏳ Saving...';
      (footerBtn as HTMLButtonElement).disabled = true;
    }

    const settings = await StorageService.getSettings();

    // Ensure dictionary & translation data is loaded before saving
    if (this.isLoadingInitialData && this.initialDataPromise) {
      await this.initialDataPromise;
    }

    // Determine explanation: prefer customExplanation or learning_dict, then cachedDict, then translation
    let defText = customExplanation || this.cachedAiTabs['learning_dict']?.text;

    if (!defText) {
      if (this.cachedDict && this.cachedDict.groups.length > 0) {
        defText = this.cachedDict.groups
          .map((g) => `[${g.partOfSpeech.toUpperCase()}]\n` + g.definitions.map((d, i) => `${i + 1}. ${d.definition}`).join('\n'))
          .join('\n\n');
      } else if (this.cachedTransResult?.wordTranslation) {
        defText = this.cachedTransResult.wordTranslation;
      } else {
        defText = '-';
      }
    }

    const wordTranslation = this.cachedTransResult?.wordTranslation || '-';

    const result = await AnkiService.addOrAppendVocabulary({
      word: this.currentWord,
      sentence: this.currentSentence,
      translation: wordTranslation,
      definition: defText,
      nuance: this.cachedNuance || this.cachedAiTabs['nuance']?.text,
      audioUrl: this.cachedDict?.audios[0]?.url,
      deckName: settings.ankiDeck,
      allowDuplicate: settings.allowDuplicateCards !== false,
    });

    if (result.success) {
      this.isCurrentWordInAnki = true;
      const successLabel = result.action === 'appended' ? 'Appended to Anki' : 'Saved to Anki';

      if (ankiBtn) {
        ankiBtn.innerHTML = `${Icons.check({ size: 14 })} ${successLabel}`;
        ankiBtn.classList.add('saved');
      }
      if (footerBtn) {
        footerBtn.innerHTML = `${Icons.check({ size: 13 })} ${successLabel}`;
        footerBtn.classList.add('saved');
      }

      await StorageService.setWordStatus(this.currentWord, 'learning');
      DOMTokenizer.updateWordStatusOnPage(this.currentWord, 'learning');
      const learningBtn = this.shadowRoot?.querySelector('.eir-status-pill[data-status="learning"]');
      if (learningBtn) {
        this.shadowRoot?.querySelectorAll('.eir-status-pill').forEach((b) => b.classList.remove('active', 'unknown', 'learning', 'known'));
        learningBtn.classList.add('active', 'learning');
      }
    } else {
      const errLabel = 'Failed to Save';
      if (ankiBtn) {
        ankiBtn.innerHTML = `${Icons.close({ size: 14 })} ${errLabel}`;
        setTimeout(() => {
          if (ankiBtn) {
            ankiBtn.innerHTML = `${this.isCurrentWordInAnki ? Icons.refresh({ size: 14 }) : Icons.plus({ size: 14 })} ${this.isCurrentWordInAnki ? 'Update in Anki' : 'Add to Anki'}`;
            (ankiBtn as HTMLButtonElement).disabled = false;
          }
        }, 3000);
      }
      if (footerBtn) {
        footerBtn.innerHTML = `${Icons.close({ size: 13 })} ${errLabel}`;
        setTimeout(() => {
          if (footerBtn) {
            footerBtn.innerHTML = `${this.isCurrentWordInAnki ? Icons.refresh({ size: 13 }) : Icons.plus({ size: 13 })} ${this.isCurrentWordInAnki ? 'Update in Anki' : 'Add to Anki'}`;
            (footerBtn as HTMLButtonElement).disabled = false;
          }
        }, 3000);
      }
      alert(`Failed to save to Anki: ${result.error}\n\nPlease make sure Anki Desktop is running with AnkiConnect enabled.`);
    }
  }


  private static getShadowStyles(): string {
    return `
      @keyframes eirPopupIn {
        from {
          opacity: 0;
          transform: translateY(4px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .eir-tooltip-box {
        pointer-events: auto;
        position: absolute;
        width: 520px;
        max-width: 94vw;
        background: #ffffff;
        color: #0f172a;
        border-radius: 16px;
        box-shadow: 0 16px 36px -6px rgba(15, 23, 42, 0.18), 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.08);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", system-ui, sans-serif;
        font-size: 13.5px;
        line-height: 1.5;
        padding: 18px 20px;
        z-index: 2147483647;
        animation: eirPopupIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
        box-sizing: border-box;
      }

      .eir-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 6px;
        gap: 8px;
      }
      .eir-word-title-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .eir-word-name {
        font-size: 24px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: -0.025em;
        line-height: 1.2;
      }
      .eir-phonetics-container {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .eir-phon-tag {
        background: #f8fafc;
        color: #475569;
        font-size: 11.5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 2px 7px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        font-weight: 500;
      }
      .eir-audios-container {
        display: inline-flex;
        gap: 4px;
      }
      .eir-audio-pill-btn {
        background: #eff6ff;
        border: 1px solid #dbeafe;
        color: #2563eb;
        border-radius: 6px;
        cursor: pointer;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .eir-audio-pill-btn:hover {
        background: #dbeafe;
        transform: translateY(-1px);
      }
      .eir-close-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: transparent;
        border: none;
        font-size: 20px;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        line-height: 1;
      }
      .eir-close-btn:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
      
      /* Quick Translation Header Pill */
      .eir-quick-trans-pill {
        background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
        border: 1px solid #bbf7d0;
        color: #166534;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 12.5px;
        margin: 6px 0 10px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .eir-pill-label {
        font-weight: 600;
        color: #15803d;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .eir-pill-val {
        font-weight: 700;
        font-size: 13.5px;
        color: #14532d;
      }
      .eir-pill-source {
        font-size: 11px;
        color: #166534;
        margin-left: auto;
        background: #dcfce7;
        padding: 1px 7px;
        border-radius: 4px;
        font-weight: 500;
      }

      /* Context Sentence */
      .eir-context-sentence {
        background: #f8fafc;
        border-left: 3.5px solid #3b82f6;
        border-radius: 0 8px 8px 0;
        padding: 8px 12px;
        font-size: 13px;
        color: #334155;
        font-style: italic;
        line-height: 1.5;
        margin-bottom: 12px;
      }
      .eir-mark {
        background: #fef08a;
        color: #854d0e;
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 600;
        font-style: normal;
      }

      /* Word Status & Anki Action Bar */
      .eir-action-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #f1f5f9;
      }
      .eir-status-group {
        background: #f1f5f9;
        padding: 3px;
        border-radius: 10px;
        display: inline-flex;
        gap: 2px;
        align-items: center;
      }
      .eir-label {
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
        padding-left: 6px;
        padding-right: 2px;
      }
      .eir-status-pill {
        border: none;
        border-radius: 7px;
        padding: 4px 10px;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        color: #64748b;
        background: transparent;
        transition: all 0.15s ease;
      }
      .eir-status-pill:hover {
        color: #0f172a;
      }
      .eir-status-pill.active.unknown {
        background: #ffffff;
        color: #0f172a;
        font-weight: 700;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .eir-status-pill.active.learning {
        background: #fef08a;
        color: #854d0e;
        font-weight: 700;
        box-shadow: 0 1px 3px rgba(133,77,14,0.15);
      }
      .eir-status-pill.active.known {
        background: #22c55e;
        color: #ffffff;
        font-weight: 700;
        box-shadow: 0 1px 3px rgba(34,197,94,0.25);
      }
      
      .eir-anki-btn {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 5px rgba(37,99,235,0.22);
        transition: all 0.15s ease;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .eir-anki-btn:hover {
        box-shadow: 0 4px 10px rgba(37,99,235,0.32);
        transform: translateY(-1px);
      }
      .eir-anki-btn.saved {
        background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
        box-shadow: 0 2px 5px rgba(22,163,74,0.22);
      }
      
      /* Tabs Navigation Bar (Icons Only + Standard Hover Tooltip) */
      .eir-tabs-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding: 4px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
      }
      .eir-tabs-icons {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .eir-tab-btn {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        cursor: pointer;
        color: #64748b;
        transition: all 0.15s ease;
        position: relative;
      }
      .eir-tab-btn:hover {
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        transform: scale(1.05);
      }
      .eir-tab-btn.active {
        background: #ffffff;
        color: #2563eb;
        border-color: #dbeafe;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        font-weight: 700;
        transform: scale(1.03);
      }
      .eir-icon {
        display: inline-block;
        vertical-align: middle;
        flex-shrink: 0;
      }
      .eir-tab-btn .eir-icon {
        stroke: #64748b;
        transition: stroke 0.15s ease, transform 0.15s ease;
      }
      .eir-tab-btn:hover .eir-icon {
        stroke: #0f172a;
        transform: scale(1.08);
      }
      .eir-tab-btn.active .eir-icon {
        stroke: #2563eb;
      }
      .eir-tab-indicator {
        font-size: 11.5px;
        font-weight: 600;
        color: #2563eb;
        padding: 3px 10px;
        background: #eff6ff;
        border: 1px solid #dbeafe;
        border-radius: 7px;
        margin-right: 4px;
      }

      /* Content Area */
      .eir-tab-content {
        max-height: 380px;
        overflow-y: auto;
        font-size: 13px;
        padding-right: 4px;
        scrollbar-width: thin;
        scrollbar-color: #cbd5e1 transparent;
      }
      .eir-tab-content::-webkit-scrollbar {
        width: 5px;
      }
      .eir-tab-content::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 10px;
      }

      .eir-provider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid #f1f5f9;
      }
      .eir-provider-tag {
        background: #eff6ff;
        color: #1e40af;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid #bfdbfe;
      }
      .eir-open-web-link {
        font-size: 11.5px;
        color: #2563eb;
        text-decoration: none;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .eir-open-web-link:hover {
        text-decoration: underline;
        color: #1d4ed8;
      }
      .eir-dict-mode-btn {
        background: #f1f5f9;
        color: #334155;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.15s ease;
      }
      .eir-dict-mode-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      .eir-dict-mode-btn.ai-btn {
        background: #fdf4ff;
        color: #9333ea;
        border-color: #f0abfc;
      }
      .eir-dict-mode-btn.ai-btn:hover {
        background: #fae8ff;
        color: #7e22ce;
      }
      .eir-action-pill-btn {
        background: #2563eb;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        transition: all 0.15s ease;
      }
      .eir-action-pill-btn:hover {
        background: #1d4ed8;
      }
      
      /* Dictionary Styles */
      .eir-dict-groups {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .eir-dict-group {
        border-bottom: 1px dashed #e2e8f0;
        padding-bottom: 10px;
      }
      .eir-group-pos-badge {
        display: inline-block;
        background: #e0e7ff;
        color: #3730a3;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 5px;
        margin-bottom: 6px;
        letter-spacing: 0.03em;
      }
      .eir-def-list {
        margin: 0 0 0 18px;
        padding: 0;
        color: #1e293b;
      }
      .eir-def-item {
        margin-bottom: 8px;
      }
      .eir-def-text {
        font-size: 13.5px;
        color: #0f172a;
        line-height: 1.55;
      }
      .eir-cefr-badge {
        display: inline-block;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fde68a;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 4px;
        margin-right: 4px;
        vertical-align: middle;
      }
      .eir-examples-list {
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .eir-example {
        background: #f8fafc;
        border-left: 2.5px solid #cbd5e1;
        border-radius: 0 4px 4px 0;
        padding: 4px 8px;
        color: #475569;
        font-size: 12.5px;
        font-style: italic;
        line-height: 1.4;
      }

      /* Translation Tab Styles */
      .eir-trans-cards {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .eir-trans-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 12px;
      }
      .eir-card-label {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 4px;
        letter-spacing: 0.04em;
      }
      .eir-card-value-primary {
        font-size: 18px;
        font-weight: 800;
        color: #16a34a;
        margin-top: 2px;
      }
      .eir-card-sentence-orig {
        font-size: 12px;
        color: #64748b;
        font-style: italic;
        margin-bottom: 6px;
      }
      .eir-card-value-sentence {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.5;
      }

      /* AI Tab Styles */
      .eir-ai-result {
        background: #faf5ff;
        border: 1px solid #e9d5ff;
        border-radius: 10px;
        padding: 14px;
      }
      .eir-ai-badge {
        font-size: 11px;
        font-weight: 700;
        color: #7e22ce;
        text-transform: uppercase;
        margin-bottom: 6px;
        letter-spacing: 0.03em;
      }
      .eir-ai-text {
        color: #3b0764;
        line-height: 1.6;
        font-size: 13px;
      }

      /* Learning Dict Container & Markdown Body */
      .eir-learn-dict-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #ffffff;
      }
      .eir-ai-badge.learning-dict {
        background: #f0fdf4;
        color: #166534;
        border: 1px solid #bbf7d0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        width: fit-content;
        margin-bottom: 4px;
      }
      .eir-markdown-body {
        color: #1e293b;
        font-size: 13.5px;
        line-height: 1.65;
        word-break: break-word;
      }
      .eir-markdown-body h1 {
        font-size: 21px;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 6px 0;
        padding-bottom: 6px;
        border-bottom: 2px solid #e2e8f0;
        letter-spacing: -0.02em;
      }
      .eir-markdown-body h2 {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
        margin: 14px 0 6px 0;
      }
      .eir-markdown-body h3 {
        font-size: 13.5px;
        font-weight: 700;
        color: #1d4ed8;
        margin: 14px 0 6px 0;
        padding: 4px 10px;
        background: #eff6ff;
        border-left: 3.5px solid #2563eb;
        border-radius: 0 6px 6px 0;
        display: block;
      }
      .eir-markdown-body h4 {
        font-size: 13px;
        font-weight: 600;
        color: #334155;
        margin: 10px 0 4px 0;
      }
      .eir-markdown-body p {
        margin: 6px 0;
        color: #334155;
      }
      .eir-markdown-body strong, .eir-markdown-body b {
        color: #0f172a;
        font-weight: 700;
      }
      .eir-markdown-body em, .eir-markdown-body i {
        color: #475569;
        font-style: italic;
      }
      .eir-markdown-body ul, .eir-markdown-body ol {
        margin: 6px 0 10px 20px;
        padding: 0;
      }
      .eir-markdown-body li {
        margin: 4px 0;
        color: #334155;
        line-height: 1.55;
      }
      .eir-markdown-body blockquote {
        margin: 8px 0;
        padding: 6px 12px;
        background: #f8fafc;
        border-left: 3px solid #94a3b8;
        border-radius: 0 6px 6px 0;
        color: #475569;
        font-style: italic;
      }
      .eir-markdown-body hr {
        border: none;
        border-top: 1px solid #e2e8f0;
        margin: 14px 0;
      }
      .eir-markdown-body code {
        background: #f1f5f9;
        color: #0f172a;
        padding: 2px 5px;
        border-radius: 4px;
        font-size: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .eir-ai-footer-bar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px dashed #cbd5e1;
      }
      .eir-ai-footer-btn {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #ffffff;
        border: none;
        border-radius: 7px;
        padding: 6px 15px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        box-shadow: 0 1px 3px rgba(37,99,235,0.2);
      }
      .eir-ai-footer-btn:hover {
        background: #1d4ed8;
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(37,99,235,0.3);
      }
      .eir-ai-footer-btn.update {
        background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
        box-shadow: 0 1px 3px rgba(2,132,199,0.25);
      }
      .eir-ai-footer-btn.update:hover {
        background: #0369a1;
      }
      .eir-ai-footer-btn.saved {
        background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
        box-shadow: 0 1px 3px rgba(22,163,74,0.2);
      }

      .eir-loading {
        text-align: center;
        color: #64748b;
        padding: 24px;
        font-weight: 500;
      }
      .eir-empty {
        text-align: center;
        color: #94a3b8;
        padding: 20px;
        font-size: 13px;
        line-height: 1.5;
      }
      .eir-error {
        color: #ef4444;
        background: #fef2f2;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #fee2e2;
      }
      
      .eir-quick-links {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px dashed #e2e8f0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 11px;
      }
      .eir-links-title {
        color: #64748b;
        font-weight: 600;
        font-size: 11px;
        margin-right: 2px;
      }
      .eir-link-badge {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 3px 8px;
        color: #334155;
        text-decoration: none;
        font-weight: 500;
        font-size: 11px;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .eir-link-badge:hover {
        background: #eff6ff;
        border-color: #3b82f6;
        color: #2563eb;
        transform: translateY(-1px);
      }
      .eir-api-warning {
        background: #fffbeb;
        border: 1px solid #fef3c7;
        color: #92400e;
        padding: 12px;
        border-radius: 8px;
        line-height: 1.5;
      }
    `;
  }
}
