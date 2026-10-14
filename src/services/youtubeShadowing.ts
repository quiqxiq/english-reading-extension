import { SubtitleCue } from './youtubeCaption';

export interface ShadowingCallbacks {
  onCueChange: (cue: SubtitleCue | null, index: number) => void;
  onCountdownTick: (remainingSeconds: number, totalSeconds: number) => void;
  onCountdownEnd: () => void;
}

export class YouTubeShadowingController {
  private video: HTMLVideoElement | null = null;
  private cues: SubtitleCue[] = [];
  private activeCueIndex = -1;
  private lastPausedCueIndex = -1;

  // Settings
  private isShadowingEnabled = true;
  private pauseDelaySeconds = 2.5;
  private autoScroll = true;

  // Timers & State
  private countdownTimer: number | null = null;
  private countdownInterval: number | null = null;
  private isCurrentlyShadowingPaused = false;
  private callbacks: ShadowingCallbacks;

  constructor(callbacks: ShadowingCallbacks) {
    this.callbacks = callbacks;
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.handleSeeking = this.handleSeeking.bind(this);
  }

  /**
   * Binds to a video element and sets current cues.
   */
  attach(video: HTMLVideoElement, cues: SubtitleCue[]): void {
    this.detach();
    this.video = video;
    this.cues = cues;
    this.activeCueIndex = -1;
    this.lastPausedCueIndex = -1;
    this.isCurrentlyShadowingPaused = false;

    this.video.addEventListener('timeupdate', this.handleTimeUpdate);
    this.video.addEventListener('seeking', this.handleSeeking);

    // Initial check
    this.handleTimeUpdate();
  }

  /**
   * Cleans up event listeners and ongoing timers.
   */
  detach(): void {
    this.cancelCountdown();
    if (this.video) {
      this.video.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.video.removeEventListener('seeking', this.handleSeeking);
      this.video = null;
    }
    this.cues = [];
    this.activeCueIndex = -1;
    this.lastPausedCueIndex = -1;
    this.isCurrentlyShadowingPaused = false;
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.activeCueIndex = -1;
    this.lastPausedCueIndex = -1;
    this.handleTimeUpdate();
  }

  setShadowingEnabled(enabled: boolean): void {
    this.isShadowingEnabled = enabled;
    if (!enabled && this.isCurrentlyShadowingPaused) {
      this.cancelCountdown();
      if (this.video) this.video.play();
    }
  }

  setPauseDelay(seconds: number): void {
    this.pauseDelaySeconds = Math.max(0.5, Math.min(10, seconds));
  }

  setAutoScroll(enabled: boolean): void {
    this.autoScroll = enabled;
  }

  getIsAutoScroll(): boolean {
    return this.autoScroll;
  }

  getIsShadowingEnabled(): boolean {
    return this.isShadowingEnabled;
  }

  getPauseDelay(): number {
    return this.pauseDelaySeconds;
  }

  getActiveCueIndex(): number {
    return this.activeCueIndex;
  }

  /**
   * Main time listener: updates active cue & triggers shadowing pause.
   */
  private handleTimeUpdate(): void {
    if (!this.video || this.cues.length === 0) return;

    const currentTime = this.video.currentTime;

    // Find cue matching current time
    let foundIndex = -1;
    for (let i = 0; i < this.cues.length; i++) {
      const cue = this.cues[i];
      if (currentTime >= cue.start && currentTime < cue.end) {
        foundIndex = i;
        break;
      }
    }

    // Cue transition
    if (foundIndex !== this.activeCueIndex) {
      this.activeCueIndex = foundIndex;
      const cue = foundIndex >= 0 ? this.cues[foundIndex] : null;
      this.callbacks.onCueChange(cue, foundIndex);
    }

    // Shadowing Auto-pause Check:
    // When playback reaches near the end of the active cue, pause for shadowing!
    if (this.isShadowingEnabled && this.activeCueIndex >= 0 && !this.isCurrentlyShadowingPaused) {
      const currentCue = this.cues[this.activeCueIndex];
      // Check if currentTime reached cue.end (with 0.15s tolerance before next sentence begins)
      if (currentTime >= currentCue.end - 0.15 && this.lastPausedCueIndex !== this.activeCueIndex) {
        this.triggerShadowingPause(this.activeCueIndex);
      }
    }
  }

  /**
   * Resets lastPausedCueIndex when user manually seeks.
   */
  private handleSeeking(): void {
    this.cancelCountdown();
    this.lastPausedCueIndex = -1;
    this.isCurrentlyShadowingPaused = false;
  }

  /**
   * Triggers the shadowing pause, begins visual countdown, and auto-resumes when complete.
   */
  private triggerShadowingPause(cueIndex: number): void {
    if (!this.video) return;

    this.lastPausedCueIndex = cueIndex;
    this.isCurrentlyShadowingPaused = true;

    // Pause playback
    this.video.pause();

    const totalSeconds = this.pauseDelaySeconds;
    let remaining = totalSeconds;
    this.callbacks.onCountdownTick(remaining, totalSeconds);

    const stepMs = 100;
    this.countdownInterval = window.setInterval(() => {
      remaining = Math.max(0, remaining - stepMs / 1000);
      this.callbacks.onCountdownTick(Math.round(remaining * 10) / 10, totalSeconds);

      if (remaining <= 0) {
        this.finishCountdown();
      }
    }, stepMs);
  }

  private finishCountdown(): void {
    this.cancelCountdown();
    this.isCurrentlyShadowingPaused = false;
    this.callbacks.onCountdownEnd();

    // Auto-resume video playback
    if (this.video && this.isShadowingEnabled) {
      this.video.play().catch((err) => {
        console.debug('[EIR YouTube] Auto-play was prevented by browser policy:', err);
      });
    }
  }

  private cancelCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.isCurrentlyShadowingPaused = false;
    this.callbacks.onCountdownEnd();
  }

  /**
   * Navigation controls: Seek to specific cue, replay, prev, next.
   */
  seekToCue(index: number, autoPlay = true): void {
    if (!this.video || index < 0 || index >= this.cues.length) return;

    this.cancelCountdown();
    this.lastPausedCueIndex = -1;

    const targetCue = this.cues[index];
    this.video.currentTime = Math.max(0, targetCue.start + 0.05);

    if (autoPlay) {
      this.video.play().catch(() => {});
    }
  }

  replayCurrentCue(): void {
    if (this.activeCueIndex >= 0) {
      this.seekToCue(this.activeCueIndex, true);
    } else if (this.cues.length > 0) {
      this.seekToCue(0, true);
    }
  }

  prevCue(): void {
    const target = this.activeCueIndex > 0 ? this.activeCueIndex - 1 : 0;
    this.seekToCue(target, true);
  }

  nextCue(): void {
    const target = this.activeCueIndex < this.cues.length - 1 ? this.activeCueIndex + 1 : this.cues.length - 1;
    this.seekToCue(target, true);
  }
}
