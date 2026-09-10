const initialize = () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(console.error);
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(console.error);
  purgeLegacyKeys().catch(() => console.error('Could not migrate local connection settings.'));
};
initialize();
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
registerVideoButton(chrome);
import { registerVideoButton } from './video-button-bridge.js';
import { restoreConfig } from './providers.js';

async function purgeLegacyKeys() {
  const { settings } = await chrome.storage.local.get('settings');
  let safe;
  try { safe = restoreConfig(settings); } catch { safe = restoreConfig(null); }
  await chrome.storage.local.set({ settings: safe });
  await chrome.storage.session.remove('apiKey');
}
