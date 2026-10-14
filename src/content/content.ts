import { DOMTokenizer } from './tokenizer';
import { TooltipManager } from './tooltip';

let isReadingModeActive = false;

function showBadge(): void {
  let badge = document.getElementById('eir-floating-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'eir-floating-badge';
    badge.innerHTML = `
      <span class="indicator-dot"></span>
      <span>Reading Mode Active <span style="opacity: 0.7; font-size: 11px;">[Alt+R]</span></span>
    `;
    badge.title = 'Click to disable Reading Mode';
    badge.addEventListener('click', () => {
      toggleReadingMode();
    });
    document.body.appendChild(badge);
  }
}

function removeBadge(): void {
  const badge = document.getElementById('eir-floating-badge');
  if (badge) badge.remove();
}

async function enableReadingMode(): Promise<void> {
  if (isReadingModeActive) return;
  isReadingModeActive = true;

  TooltipManager.init();
  await DOMTokenizer.tokenizeReadableNodes();
  showBadge();

  // Attach click events to words (popup opens on click)
  document.body.addEventListener('click', handleWordClick);
}

function disableReadingMode(): void {
  if (!isReadingModeActive) return;
  isReadingModeActive = false;

  TooltipManager.hide();
  DOMTokenizer.unwrapAllWords();
  removeBadge();

  document.body.removeEventListener('click', handleWordClick);
}

export async function toggleReadingMode(): Promise<boolean> {
  if (isReadingModeActive) {
    disableReadingMode();
  } else {
    await enableReadingMode();
  }
  return isReadingModeActive;
}

function handleWordClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement)?.closest('.eir-word') as HTMLElement | null;
  if (!target) return;

  e.stopPropagation();
  TooltipManager.show(target);
}

// Global hotkey Alt+R listener directly on page
window.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    toggleReadingMode();
  }
});

// Message listener from background script or popup
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'TOGGLE_READING_MODE') {
    toggleReadingMode().then((active) => {
      sendResponse({ active });
    });
    return true; // asynchronous response
  }
  if (message.action === 'GET_STATUS') {
    sendResponse({ active: isReadingModeActive });
    return false;
  }
});

// Automatically initialize YouTube Interactive Transcript & Shadowing on YouTube
import { YouTubeSidebarManager } from './youtubeSidebar';

if (window.location.hostname.includes('youtube.com')) {
  YouTubeSidebarManager.init();
}
