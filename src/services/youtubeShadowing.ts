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
  private trackingInterval: number | null = null;
  private countdownInterval: number | null = null;
  private isCurrentlyShadowingPaused = false;
  private callbacks: ShadowingCallbacks;

  constructor(callbacks: ShadowingCallbacks) {
    this.callbacks = callbacks;
    this.handleCheck = this.handleCheck.bind(this);
    this.handlePlay = this.handlePlay.bind(this);
    this.handlePause = this.handlePause.bind(this);
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

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('pause', this.handlePause);
    this.video.addEventListener('timeupdate', this.handleCheck);
    this.video.addEventListener('seeking', this.handleSeeking);

    if (!this.video.paused) {
      this.startPlaybackTracking();
    }

    // Initial position evaluation
    this.handleCheck();
  }

  /**
   * Cleans up event listeners and ongoing timers.
   */
  detach(): void {
    this.stopPlaybackTracking();
    this.cancelCountdown();

    if (this.video) {
      this.video.removeEventListener('play', this.handlePlay);
      this.video.removeEventListener('pause', this.handlePause);
      this.video.removeEventListener('timeupdate', this.handleCheck);
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
    this.handleCheck();
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

  private handlePlay(): void {
    if (this.isCurrentlyShadowingPaused) {
      // User manually hit play or space during countdown; cancel countdown and proceed
      this.cancelCountdown();
    }
    this.startPlaybackTracking();
  }

  private handlePause(): void {
    if (!this.isCurrentlyShadowingPaused) {
      this.stopPlaybackTracking();
    }
  }

  private startPlaybackTracking(): void {
    this.stopPlaybackTracking();
    // High-frequency 35ms polling ensures we never miss sentence ends due to coarse 250ms timeupdate ticks
    this.trackingInterval = window.setInterval(() => {
      this.handleCheck();
    }, 35);
  }

  private stopPlaybackTracking(): void {
    if (this.trackingInterval !== null) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  /**
   * Main checking engine: identifies sentence end boundaries with high accuracy and triggers auto-pause.
   */
  private handleCheck(): void {
    if (!this.video || this.cues.length === 0) return;

    const currentTime = this.video.currentTime;

    // 1. Boundary check: If currently inside an active sentence, did it reach/pass the end of this sentence?
    if (this.isShadowingEnabled && !this.isCurrentlyShadowingPaused && this.activeCueIndex >= 0) {
      const activeCue = this.cues[this.activeCueIndex];
      const nextCue = this.cues[this.activeCueIndex + 1];
      const maxBoundary = nextCue ? Math.min(nextCue.start + 0.1, activeCue.end + 0.35) : activeCue.end + 0.35;

      // Trigger pause when currentTime reaches activeCue.end (within 0.08s of end or up to boundary)
      if (
        currentTime >= activeCue.end - 0.08 &&
        currentTime <= maxBoundary &&
        this.lastPausedCueIndex !== this.activeCueIndex
      ) {
        this.triggerShadowingPause(this.activeCueIndex);
        return;
      }
    }

    // 2. Find matching cue for currentTime
    let foundIndex = -1;
    for (let i = 0; i < this.cues.length; i++) {
      const cue = this.cues[i];
      if (currentTime >= cue.start && currentTime < cue.end) {
        foundIndex = i;
        break;
      }
    }

    // If currentTime is in a silence gap between sentences, keep previous cue active temporarily
    if (foundIndex === -1 && this.activeCueIndex >= 0) {
      const prevCue = this.cues[this.activeCueIndex];
      const nextCue = this.cues[this.activeCueIndex + 1];
      if (currentTime >= prevCue.end && (!nextCue || currentTime < nextCue.start)) {
        // Did we miss pausing at the end of prevCue before entering the gap?
        if (
          this.isShadowingEnabled &&
          !this.isCurrentlyShadowingPaused &&
          this.lastPausedCueIndex !== this.activeCueIndex &&
          currentTime <= prevCue.end + 0.35
        ) {
          this.triggerShadowingPause(this.activeCueIndex);
          return;
        }
        foundIndex = this.activeCueIndex;
      }
    }

    // 3. Sentence transition: Did playback advance into the next sentence?
    if (foundIndex !== -1 && foundIndex !== this.activeCueIndex) {
      // If playback skipped past activeCue into activeCue+1 without pausing:
      if (
        this.isShadowingEnabled &&
        !this.isCurrentlyShadowingPaused &&
        this.activeCueIndex >= 0 &&
        foundIndex === this.activeCueIndex + 1 &&
        this.lastPausedCueIndex !== this.activeCueIndex
      ) {
        this.triggerShadowingPause(this.activeCueIndex);
        return;
      }

      this.activeCueIndex = foundIndex;
      const cue = foundIndex >= 0 ? this.cues[foundIndex] : null;
      this.callbacks.onCueChange(cue, foundIndex);
    } else if (foundIndex === -1 && this.activeCueIndex !== -1) {
      this.activeCueIndex = -1;
      this.callbacks.onCueChange(null, -1);
    }
  }

  /**
   * Resets pause tracking when user manually seeks.
   */
  private handleSeeking(): void {
    if (this.isCurrentlyShadowingPaused) {
      this.cancelCountdown();
    }
    this.isCurrentlyShadowingPaused = false;
    this.lastPausedCueIndex = -1;
    this.activeCueIndex = -1;
  }

  /**
   * Triggers the shadowing pause, halts playback, runs visual countdown, and auto-resumes when complete.
   */
  private triggerShadowingPause(cueIndex: number): void {
    if (!this.video) return;

    this.lastPausedCueIndex = cueIndex;
    this.isCurrentlyShadowingPaused = true;
    this.stopPlaybackTracking();

    // Pause video playback immediately
    this.video.pause();

    // Snap video time to the end of the sentence so audio does not bleed into next cue
    const cue = this.cues[cueIndex];
    if (cue && this.video.currentTime > cue.end) {
      this.video.currentTime = cue.end;
    }

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
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.isCurrentlyShadowingPaused = false;
    this.callbacks.onCountdownEnd();

    // Auto-resume video playback
    if (this.video && this.isShadowingEnabled) {
      this.video.play().then(() => {
        this.startPlaybackTracking();
      }).catch((err) => {
        console.debug('[EIR YouTube] Auto-play was prevented by browser policy:', err);
      });
    }
  }

  private cancelCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
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
    this.activeCueIndex = index;
    this.lastPausedCueIndex = -1; // Reset so this cue WILL pause when it finishes!

    const targetCue = this.cues[index];
    this.video.currentTime = Math.max(0, targetCue.start + 0.02);

    this.callbacks.onCueChange(targetCue, index);

    if (autoPlay) {
      this.video.play().then(() => {
        this.startPlaybackTracking();
      }).catch(() => {});
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
