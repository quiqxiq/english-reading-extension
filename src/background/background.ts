// Background Service Script for Firefox WebExtension
browser.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-reading-mode') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (activeTab?.id) {
      browser.tabs.sendMessage(activeTab.id, { action: 'TOGGLE_READING_MODE' }).catch(() => {
        // Tab might not have loaded content script yet (e.g. about:blank or special pages)
      });
    }
  }
});

// Listener to proxy fetch external URLs (Cambridge, Oxford, Translate)
// to bypass web page CORS and CSP restrictions.
browser.runtime.onMessage.addListener((message: any) => {
  if (message.action === 'FETCH_EXTERNAL_URL') {
    return (async () => {
      try {
        const res = await fetch(message.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
          },
        });
        if (!res.ok) {
          return { success: false, status: res.status, error: `HTTP ${res.status}` };
        }
        const text = await res.text();
        return { success: true, text };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    })();
  }
});
