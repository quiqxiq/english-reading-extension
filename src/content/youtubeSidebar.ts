import { YouTubeCaptionService, CaptionTrack, SubtitleCue } from '../services/youtubeCaption';
import { YouTubeShadowingController } from '../services/youtubeShadowing';
import { fetchGoogleTranslation } from '../services/dictionary';
import { StorageService } from './storage';
import { TooltipManager } from './tooltip';
import { Icons } from '../components/icons';

export class YouTubeSidebarManager {
  private static container: HTMLElement | null = null;
  private static controller: YouTubeShadowingController | null = null;
  private static currentVideoId: string | null = null;
  private static availableTracks: CaptionTrack[] = [];
  private static selectedTrack: CaptionTrack | null = null;
  private static currentCues: SubtitleCue[] = [];
  private static isCollapsed = false;
  private static isInitialized = false;

  // Translation & Language State
  private static showTranslation = true;
  private static isTrackIndonesian = false;
  private static translationCache = new Map<number, string>();
  private static adCheckInterval: number | null = null;

  static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Listen to YouTube's SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      this.handleNavigation();
    });

    // Fallback popstate & interval watcher to catch URL changes
    window.addEventListener('popstate', () => {
      this.handleNavigation();
    });

    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.handleNavigation();
      }
    }, 1000);

    // Global keyboard shortcuts for Shadowing (S / R for replay, A for prev, D for next)
    window.addEventListener('keydown', (e) => {
      if (!this.controller || !this.container || this.currentCues.length === 0) return;
      const activeTag = (document.activeElement?.tagName || '').toUpperCase();
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === 's' || e.key === 'S' || e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.controller.replayCurrentCue();
        }
      } else if (e.key === 'a' || e.key === 'A') {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.controller.prevCue();
        }
      } else if (e.key === 'd' || e.key === 'D') {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.controller.nextCue();
        }
      }
    });

    // Initial load
    this.handleNavigation();
  }

  private static async handleNavigation(): Promise<void> {
    const videoId = YouTubeCaptionService.extractVideoId(window.location.href);

    if (!videoId) {
      this.removeSidebar();
      this.currentVideoId = null;
      return;
    }

    if (videoId === this.currentVideoId && this.container) {
      return; // Already active for this video
    }

    this.currentVideoId = videoId;
    await this.mountSidebarForVideo(videoId);
  }

  private static removeSidebar(): void {
    if (this.adCheckInterval !== null) {
      clearInterval(this.adCheckInterval);
      this.adCheckInterval = null;
    }
    if (this.controller) {
      this.controller.detach();
      this.controller = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.translationCache.clear();
  }

  private static async mountSidebarForVideo(videoId: string): Promise<void> {
    const mountTarget = await this.waitForMountTarget();
    if (!mountTarget) {
      console.warn('[EIR YouTube] Secondary container not found after waiting.');
      return;
    }

    // Load user settings
    const settings = await StorageService.getSettings();
    this.isCollapsed = settings.youtubeSidebarCollapsed ?? false;
    this.showTranslation = settings.youtubeShowTranslation ?? true;
    this.translationCache.clear();

    // Render skeleton container
    this.createSidebarDOM(
      mountTarget,
      settings.youtubeShadowingDelay,
      settings.youtubeShadowingEnabled,
      this.showTranslation,
      settings.youtubeAutoScroll
    );

    // Check if an advertisement is currently playing
    if (YouTubeCaptionService.isAdPlaying()) {
      this.renderLoading('Menunggu iklan YouTube selesai...');
      this.waitForAdToEndAndLoad(videoId);
      return;
    }

    await this.loadCaptionsForVideo(videoId);
  }

  /**
   * Watches the player until the pre-roll ad finishes, then loads the real video's transcript.
   */
  private static waitForAdToEndAndLoad(videoId: string): void {
    if (this.adCheckInterval !== null) {
      clearInterval(this.adCheckInterval);
    }

    this.adCheckInterval = window.setInterval(() => {
      if (!YouTubeCaptionService.isAdPlaying()) {
        if (this.adCheckInterval !== null) {
          clearInterval(this.adCheckInterval);
          this.adCheckInterval = null;
        }
        setTimeout(() => {
          this.loadCaptionsForVideo(videoId);
        }, 600);
      }
    }, 500);
  }

  private static async loadCaptionsForVideo(videoId: string): Promise<void> {
    this.renderLoading('Mencari transkrip (English / Indonesia)...');

    const settings = await StorageService.getSettings();
    this.availableTracks = await YouTubeCaptionService.getAvailableTracks(videoId);

    if (this.availableTracks.length === 0) {
      // Fallback: Try native DOM transcript extraction directly
      const nativeCues = await YouTubeCaptionService.extractCuesFromNativeDOMWithRetry();
      if (nativeCues.length > 0) {
        this.currentCues = nativeCues;
        this.isTrackIndonesian = false; // default assume English unless detected
        await this.renderCuesList(this.currentCues);
        this.bindVideoElement();
        return;
      }

      this.renderEmpty('Tidak ada transkrip subtitle bahasa Inggris atau Indonesia untuk video ini.');
      return;
    }

    // Select best track matching preference (English or Indonesian only)
    this.selectedTrack = YouTubeCaptionService.selectBestTrack(this.availableTracks, settings.youtubePreferredLang);

    if (!this.selectedTrack) {
      this.renderEmpty('Tidak ditemukan transkrip bahasa Inggris atau Indonesia untuk video ini.');
      return;
    }

    // Determine if track is Indonesian
    const code = this.selectedTrack.languageCode.toLowerCase();
    this.isTrackIndonesian = code.startsWith('id') || code.startsWith('in');

    // Update UI translation toggle state
    this.updateTranslationToggleUI();

    await this.loadTrackSubtitles(this.selectedTrack);
  }

  private static async loadTrackSubtitles(track: CaptionTrack): Promise<void> {
    this.renderLoading(`Memuat subtitle (${track.name})...`);
    this.currentCues = await YouTubeCaptionService.fetchSubtitles(track);

    if (this.currentCues.length === 0) {
      // Fallback: try native DOM extraction
      const nativeCues = await YouTubeCaptionService.extractCuesFromNativeDOMWithRetry();
      if (nativeCues.length > 0) {
        this.currentCues = nativeCues;
        await this.renderCuesList(this.currentCues);
        this.bindVideoElement();
        return;
      }

      this.renderEmpty('Gagal memuat baris transkrip dari track ini. Putar video sejenak lalu coba lagi.');
      return;
    }

    // Render cues list
    await this.renderCuesList(this.currentCues);
    this.bindVideoElement();
  }

  private static bindVideoElement(): void {
    const video = (document.querySelector('video.html5-main-video') || document.querySelector('video')) as HTMLVideoElement | null;
    if (video) {
      this.attachController(video);
    } else {
      const checkVid = setInterval(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        if (v) {
          clearInterval(checkVid);
          this.attachController(v);
        }
      }, 500);
      setTimeout(() => clearInterval(checkVid), 10000);
    }
  }

  private static attachController(video: HTMLVideoElement): void {
    if (this.controller) this.controller.detach();

    this.controller = new YouTubeShadowingController({
      onCueChange: (_cue, index) => {
        this.highlightCue(index);
      },
    });

    StorageService.getSettings().then((s) => {
      if (!this.controller) return;
      this.controller.setPauseDelay(s.youtubeShadowingDelay);
      this.controller.setShadowingEnabled(s.youtubeShadowingEnabled);
      this.controller.setAutoScroll(s.youtubeAutoScroll);
      this.controller.attach(video, this.currentCues);
    });

    // If ad starts while video is playing, handle it gracefully
    video.addEventListener('timeupdate', () => {
      if (YouTubeCaptionService.isAdPlaying()) {
        this.renderLoading('Sedang memutar iklan...');
      }
    });
  }

  /**
   * Highlights active cue, blurs others, auto-scrolls, and loads sentence translation on-demand.
   */
  private static highlightCue(index: number): void {
    if (!this.container) return;

    const allCues = this.container.querySelectorAll('.eir-yt-cue');
    allCues.forEach((el, idx) => {
      if (idx === index) {
        el.classList.add('active');
        if (this.controller?.getIsAutoScroll()) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        el.classList.remove('active');
      }
    });

    // Translate active sentence if enabled (or if track is Indonesian)
    if (index >= 0 && index < this.currentCues.length) {
      const activeCue = this.currentCues[index];
      this.ensureCueTranslation(activeCue);

      // Pre-fetch next sentence translation for 0ms delay
      if (index + 1 < this.currentCues.length) {
        this.ensureCueTranslation(this.currentCues[index + 1]);
      }
    }
  }

  /**
   * Translates a sentence and updates its subtitle node.
   */
  private static async ensureCueTranslation(cue: SubtitleCue): Promise<void> {
    if (!this.showTranslation && !this.isTrackIndonesian) return;

    const transEl = this.container?.querySelector(`#eir-yt-trans-${cue.id}`) as HTMLElement | null;
    if (!transEl) return;

    // Check cache
    if (this.translationCache.has(cue.id)) {
      transEl.textContent = this.translationCache.get(cue.id)!;
      transEl.style.display = 'block';
      return;
    }

    // Target language: if Indonesian transcript, translate to English ('en'); otherwise to Indonesian ('id')
    const targetLang = this.isTrackIndonesian ? 'en' : 'id';
    try {
      const translated = await fetchGoogleTranslation(cue.text, targetLang);
      if (translated) {
        this.translationCache.set(cue.id, translated);
        transEl.textContent = translated;
        transEl.style.display = (this.showTranslation || this.isTrackIndonesian) ? 'block' : 'none';
      }
    } catch (err) {
      console.debug('[EIR YouTube] Translation failed for cue:', err);
    }
  }

  /**
   * Builds the main sidebar DOM frame and injects it into YouTube's secondary panel.
   */
  private static createSidebarDOM(
    mountTarget: HTMLElement,
    pauseDelay: number,
    shadowingEnabled: boolean,
    showTranslation: boolean,
    autoScroll: boolean
  ): void {
    if (this.container) this.container.remove();

    this.container = document.createElement('div');
    this.container.id = 'eir-youtube-sidebar';
    this.container.className = `eir-yt-container ${this.isCollapsed ? 'collapsed' : ''}`;

    this.container.innerHTML = `
      <div class="eir-yt-header">
        <div class="eir-yt-title-row">
          <div class="eir-yt-title-badge">
            ${Icons.headphones({ size: 16 })}
            <span>Transkrip & Shadowing</span>
          </div>
          <div class="eir-yt-header-actions">
            <button id="eir-yt-collapse-btn" class="eir-yt-icon-btn" title="${this.isCollapsed ? 'Buka Transkrip' : 'Tutup Transkrip'}">
              ${this.isCollapsed ? Icons.chevronDown({ size: 16 }) : Icons.chevronUp({ size: 16 })}
            </button>
          </div>
        </div>

        <!-- Controls Toolbar -->
        <div class="eir-yt-toolbar">
          <div class="eir-yt-toggle-group" title="Auto-pause di tiap akhir kalimat untuk menirukan ucapan">
            <label class="eir-yt-switch">
              <input type="checkbox" id="eir-yt-shadowing-toggle" ${shadowingEnabled ? 'checked' : ''} />
              <span class="eir-yt-slider"></span>
            </label>
            <span class="eir-yt-toggle-label">Shadowing</span>
          </div>

          <!-- Pause delay adjuster -->
          <div class="eir-yt-delay-control" title="Durasi jeda setelah kalimat selesai">
            <button id="eir-yt-delay-minus" class="eir-yt-step-btn" title="Kurangi jeda 0.5 detik">-</button>
            <span id="eir-yt-delay-display" class="eir-yt-delay-val">${pauseDelay.toFixed(1)}s</span>
            <button id="eir-yt-delay-plus" class="eir-yt-step-btn" title="Tambah jeda 0.5 detik">+</button>
          </div>

          <!-- Translation Toggle Switch -->
          <div class="eir-yt-toggle-group" id="eir-yt-trans-toggle-wrap" title="Tampilkan terjemahan di bawah kalimat aktif">
            <label class="eir-yt-switch">
              <input type="checkbox" id="eir-yt-trans-toggle" ${showTranslation ? 'checked' : ''} />
              <span class="eir-yt-slider"></span>
            </label>
            <span class="eir-yt-toggle-label" id="eir-yt-trans-toggle-label">Translate</span>
          </div>

          <!-- Auto scroll toggle -->
          <button id="eir-yt-autoscroll-btn" class="eir-yt-btn-pill ${autoScroll ? 'active' : ''}" title="Otomatis scroll mengikuti video">
            📜 Auto-scroll
          </button>
        </div>

        <!-- Quick navigation buttons row -->
        <div class="eir-yt-nav-row">
          <button id="eir-yt-prev-btn" class="eir-yt-nav-btn" title="Kalimat Sebelumnya (Shortcut: A)">
            ${Icons.skipBack({ size: 14 })} Prev
          </button>
          <button id="eir-yt-replay-btn" class="eir-yt-nav-btn eir-yt-replay-primary" title="Ulang Kalimat Ini (Shortcut: S)">
            ${Icons.rotateCcw({ size: 14 })} Replay
          </button>
          <button id="eir-yt-next-btn" class="eir-yt-nav-btn" title="Kalimat Berikutnya (Shortcut: D)">
            Next ${Icons.skipForward({ size: 14 })}
          </button>
        </div>
      </div>

      <!-- Scrollable transcript cue list (Focus & Blur mode) -->
      <div id="eir-yt-body" class="eir-yt-body"></div>
    `;

    mountTarget.insertBefore(this.container, mountTarget.firstChild);
    this.bindHeaderEvents();
  }

  private static bindHeaderEvents(): void {
    if (!this.container) return;

    // Collapse toggle
    const collapseBtn = this.container.querySelector('#eir-yt-collapse-btn');
    collapseBtn?.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      this.container?.classList.toggle('collapsed', this.isCollapsed);
      if (collapseBtn) {
        collapseBtn.innerHTML = this.isCollapsed ? Icons.chevronDown({ size: 16 }) : Icons.chevronUp({ size: 16 });
      }
      StorageService.saveSettings({ youtubeSidebarCollapsed: this.isCollapsed });
    });

    // Shadowing toggle
    const shadowingToggle = this.container.querySelector('#eir-yt-shadowing-toggle') as HTMLInputElement | null;
    shadowingToggle?.addEventListener('change', () => {
      const enabled = shadowingToggle.checked;
      this.controller?.setShadowingEnabled(enabled);
      StorageService.saveSettings({ youtubeShadowingEnabled: enabled });
    });

    // Translation toggle
    const transToggle = this.container.querySelector('#eir-yt-trans-toggle') as HTMLInputElement | null;
    transToggle?.addEventListener('change', () => {
      if (this.isTrackIndonesian) return; // Indonesian transcript is locked to ON
      this.showTranslation = transToggle.checked;
      StorageService.saveSettings({ youtubeShowTranslation: this.showTranslation });

      // Toggle display of all translation elements
      const transEls = this.container?.querySelectorAll('.eir-yt-translation');
      transEls?.forEach((el) => {
        (el as HTMLElement).style.display = this.showTranslation ? 'block' : 'none';
      });

      // If enabled, translate current active cue immediately
      const activeIdx = this.controller?.getActiveCueIndex() ?? -1;
      if (this.showTranslation && activeIdx >= 0 && activeIdx < this.currentCues.length) {
        this.ensureCueTranslation(this.currentCues[activeIdx]);
      }
    });

    // Delay +/- buttons
    const minusBtn = this.container.querySelector('#eir-yt-delay-minus');
    const plusBtn = this.container.querySelector('#eir-yt-delay-plus');
    const delayDisplay = this.container.querySelector('#eir-yt-delay-display');

    minusBtn?.addEventListener('click', () => {
      if (!this.controller) return;
      const current = this.controller.getPauseDelay();
      const next = Math.max(1.0, Math.round((current - 0.5) * 10) / 10);
      this.controller.setPauseDelay(next);
      if (delayDisplay) delayDisplay.textContent = `${next.toFixed(1)}s`;
      StorageService.saveSettings({ youtubeShadowingDelay: next });
    });

    plusBtn?.addEventListener('click', () => {
      if (!this.controller) return;
      const current = this.controller.getPauseDelay();
      const next = Math.min(6.0, Math.round((current + 0.5) * 10) / 10);
      this.controller.setPauseDelay(next);
      if (delayDisplay) delayDisplay.textContent = `${next.toFixed(1)}s`;
      StorageService.saveSettings({ youtubeShadowingDelay: next });
    });

    // Auto-scroll toggle
    const autoScrollBtn = this.container.querySelector('#eir-yt-autoscroll-btn');
    autoScrollBtn?.addEventListener('click', () => {
      if (!this.controller) return;
      const current = this.controller.getIsAutoScroll();
      const next = !current;
      this.controller.setAutoScroll(next);
      autoScrollBtn.classList.toggle('active', next);
      StorageService.saveSettings({ youtubeAutoScroll: next });
    });

    // Nav buttons
    this.container.querySelector('#eir-yt-prev-btn')?.addEventListener('click', () => {
      this.controller?.prevCue();
    });
    this.container.querySelector('#eir-yt-replay-btn')?.addEventListener('click', () => {
      this.controller?.replayCurrentCue();
    });
    this.container.querySelector('#eir-yt-next-btn')?.addEventListener('click', () => {
      this.controller?.nextCue();
    });
  }

  private static updateTranslationToggleUI(): void {
    const transToggle = this.container?.querySelector('#eir-yt-trans-toggle') as HTMLInputElement | null;
    const transLabel = this.container?.querySelector('#eir-yt-trans-toggle-label') as HTMLElement | null;
    const wrap = this.container?.querySelector('#eir-yt-trans-toggle-wrap') as HTMLElement | null;

    if (!transToggle || !transLabel || !wrap) return;

    if (this.isTrackIndonesian) {
      // Indonesian transcript: always translate to English without option (locked ON)
      transToggle.checked = true;
      transToggle.disabled = true;
      transLabel.textContent = 'Trans (EN)';
      wrap.title = 'Terjemahan ke bahasa Inggris selalu aktif untuk transkrip bahasa Indonesia.';
      wrap.style.opacity = '0.9';
    } else {
      // English transcript: option to translate to Indonesian
      transToggle.disabled = false;
      transToggle.checked = this.showTranslation;
      transLabel.textContent = 'Trans (ID)';
      wrap.title = 'Tampilkan terjemahan bahasa Indonesia di bawah kalimat aktif.';
      wrap.style.opacity = '1';
    }
  }

  private static renderLoading(msg: string): void {
    const body = this.container?.querySelector('#eir-yt-body');
    if (body) {
      body.innerHTML = `
        <div class="eir-yt-status-box">
          <div class="eir-yt-spinner"></div>
          <div>${msg}</div>
        </div>
      `;
    }
  }

  private static renderEmpty(msg: string): void {
    const body = this.container?.querySelector('#eir-yt-body');
    if (body) {
      body.innerHTML = `
        <div class="eir-yt-status-box empty">
          <span style="font-size: 24px;">ℹ️</span>
          <div>${msg}</div>
        </div>
      `;
    }
  }

  /**
   * Renders each subtitle cue into tokenized interactive words (without timestamp, larger font, focus mode).
   * Word popups are strictly triggered on CLICK, not hover.
   */
  private static async renderCuesList(cues: SubtitleCue[]): Promise<void> {
    const body = this.container?.querySelector('#eir-yt-body');
    if (!body) return;

    const vocabMap = await StorageService.getVocabMap();
    const wordRegex = /\b([a-zA-Z]+(?:'[a-zA-Z]+)?)\b/g;

    const fragment = document.createDocumentFragment();

    cues.forEach((cue, index) => {
      const cueItem = document.createElement('div');
      cueItem.className = 'eir-yt-cue';
      cueItem.dataset.cueIndex = index.toString();

      // Main content wrapper
      const contentWrap = document.createElement('div');
      contentWrap.className = 'eir-yt-content-wrap';

      // Tokenized Sentence Text
      const textDiv = document.createElement('div');
      textDiv.className = 'eir-yt-text';

      let lastIdx = 0;
      let match: RegExpExecArray | null;
      wordRegex.lastIndex = 0;

      while ((match = wordRegex.exec(cue.text)) !== null) {
        const rawWord = match[1];
        const matchStart = match.index;
        const matchEnd = matchStart + rawWord.length;

        // Plain text before word
        if (matchStart > lastIdx) {
          textDiv.appendChild(document.createTextNode(cue.text.slice(lastIdx, matchStart)));
        }

        const lemma = rawWord.toLowerCase();
        const status = vocabMap[lemma] || 'unknown';

        const wordSpan = document.createElement('span');
        wordSpan.className = `eir-word eir-status-${status}`;
        wordSpan.textContent = rawWord;
        wordSpan.dataset.eirWord = lemma;
        wordSpan.dataset.eirOriginal = rawWord;
        wordSpan.dataset.eirSentence = cue.text;

        // Open Tooltip STRICTLY ON CLICK (no hover popup)
        wordSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          TooltipManager.show(wordSpan);
        });

        textDiv.appendChild(wordSpan);
        lastIdx = matchEnd;
      }

      if (lastIdx < cue.text.length) {
        textDiv.appendChild(document.createTextNode(cue.text.slice(lastIdx)));
      }

      // Translation element beneath sentence
      const transDiv = document.createElement('div');
      transDiv.className = 'eir-yt-translation';
      transDiv.id = `eir-yt-trans-${cue.id}`;
      transDiv.style.display = (this.showTranslation || this.isTrackIndonesian) ? 'block' : 'none';

      // Replay button for individual cue
      const replayBtn = document.createElement('button');
      replayBtn.className = 'eir-yt-cue-replay';
      replayBtn.title = 'Ulangi kalimat ini';
      replayBtn.innerHTML = Icons.rotateCcw({ size: 13 });
      replayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controller?.seekToCue(index, true);
      });

      contentWrap.appendChild(textDiv);
      contentWrap.appendChild(transDiv);

      cueItem.appendChild(contentWrap);
      cueItem.appendChild(replayBtn);

      // Clicking on cue background seeks video to this sentence
      cueItem.addEventListener('click', () => {
        this.controller?.seekToCue(index, true);
      });

      fragment.appendChild(cueItem);
    });

    body.innerHTML = '';
    body.appendChild(fragment);
  }

  private static async waitForMountTarget(): Promise<HTMLElement | null> {
    const selector = '#secondary-inner, #secondary';
    let target = document.querySelector(selector) as HTMLElement | null;
    if (target) return target;

    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        target = document.querySelector(selector) as HTMLElement | null;
        if (target) {
          clearInterval(interval);
          resolve(target);
        } else if (attempts > 30) {
          clearInterval(interval);
          resolve(null);
        }
      }, 300);
    });
  }
}
