import { StorageService } from '../content/storage';
import { AnkiService } from '../services/anki';

document.addEventListener('DOMContentLoaded', async () => {
  const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
  const ankiDot = document.getElementById('anki-dot') as HTMLSpanElement;
  const ankiText = document.getElementById('anki-text') as HTMLSpanElement;
  const ankiDeckInfo = document.getElementById('anki-deck-info') as HTMLDivElement;
  const statKnown = document.getElementById('stat-known') as HTMLDivElement;
  const statLearning = document.getElementById('stat-learning') as HTMLDivElement;
  const optionsBtn = document.getElementById('options-btn') as HTMLButtonElement;

  // 1. Check saved settings
  const settings = await StorageService.getSettings();
  if (ankiDeckInfo) ankiDeckInfo.textContent = `Deck: ${settings.ankiDeck}`;

  // 2. Check vocabulary statistics
  const vocabMap = await StorageService.getVocabMap();
  let knownCount = 0;
  let learningCount = 0;
  for (const status of Object.values(vocabMap)) {
    if (status === 'known') knownCount++;
    if (status === 'learning') learningCount++;
  }
  if (statKnown) statKnown.textContent = String(knownCount);
  if (statLearning) statLearning.textContent = String(learningCount);

  // 3. Check AnkiConnect connection
  const isAnkiConnected = await AnkiService.isConnected();
  if (isAnkiConnected) {
    ankiDot.className = 'dot green';
    ankiText.className = 'status-text green';
    ankiText.textContent = 'Connected';
  } else {
    ankiDot.className = 'dot red';
    ankiText.className = 'status-text red';
    ankiText.textContent = 'Disconnected';
  }

  // 4. Check reading mode status in active tab
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (activeTab?.id) {
    try {
      const response = await browser.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' });
      if (response && response.active) {
        setToggleActive(true);
      }
    } catch {
      // Content script may not be loaded in this tab
    }
  }

  function setToggleActive(active: boolean): void {
    if (active) {
      toggleBtn.textContent = 'Disable';
      toggleBtn.classList.add('active');
    } else {
      toggleBtn.textContent = 'Enable';
      toggleBtn.classList.remove('active');
    }
  }

  // 5. Handle Toggle Click
  toggleBtn.addEventListener('click', async () => {
    if (!activeTab?.id) return;
    try {
      const res = await browser.tabs.sendMessage(activeTab.id, { action: 'TOGGLE_READING_MODE' });
      if (res) {
        setToggleActive(res.active);
      }
    } catch {
      alert('Cannot activate Reading Mode on this system page. Please open a regular web article.');
    }
  });

  // 6. Handle Options Button
  optionsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });
});
