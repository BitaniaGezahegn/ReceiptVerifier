// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\background.js
import { DEFAULT_API_KEY, DEFAULT_BANKS } from './config.js';
import { initSettings, settingsCache } from './services/settings_service.js';
import { routeMessage } from './controllers/background/message_router.js';
import { handleStartAI, handleScreenshotFlow } from './controllers/background/context_menu_controller.js';
import * as UI from './ui/injectors.js';
import * as TPL from './ui/templates.js';
import './services/auth_service.js'; // Initialize Auth

// 1. INITIALIZE EXTENSION
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['apiKeys', 'banks']);
  if (!data.apiKeys || data.apiKeys.length === 0) {
      await chrome.storage.local.set({ apiKeys: [DEFAULT_API_KEY], activeKeyIndex: 0 });
  }
  if (!data.banks || data.banks.length === 0) {
      await chrome.storage.local.set({ banks: DEFAULT_BANKS });
  }
  await initSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "verifyMain", title: "✅ Verify Transaction", contexts: ["image", "link", "frame", "page"] });
  });
});

// Initialize settings immediately for this session
initSettings();

let isProcessing = false;

// 2. CONSOLIDATED CLICK HANDLER
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "verifyMain") return;
  if (isProcessing) return;
  isProcessing = true;
  setTimeout(() => { isProcessing = false; }, 1000);

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: UI.showAmountPicker
    , args: [TPL.getAmountPickerHtml()]
  }, async (results) => {
    if (!results || !results[0]?.result) {
      isProcessing = false;
      return;
    }
    const amount = results[0].result;
    const aiScanBehavior = settingsCache.aiScanBehavior || 'always_ai';

    switch (aiScanBehavior) {
      case 'always_ai':
        handleStartAI(amount, info.srcUrl, tab.id);
        break;
      case 'ask':
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: UI.modalInjection,
          args: [amount, info.srcUrl, 'ask', TPL.getCustomConfirmHtml("Use AI Scan?", "Select an option to proceed.", "Use AI", "Enter Manually"), TPL.getCustomPromptHtml("Manual Transaction ID", "Please enter the transaction ID below.")]
        });
        break;
      case 'always_manual':
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: UI.modalInjection,
          args: [amount, info.srcUrl, 'manual', null, TPL.getCustomPromptHtml("Manual Transaction ID", "Please enter the transaction ID below.")]
        });
        break;
    }
  });
});

// 3. COMMAND LISTENER
chrome.commands.onCommand.addListener((command) => {
  if (command === "take_screenshot_verify") {
    handleScreenshotFlow();
  }
});

// 4. MESSAGE LISTENER
chrome.runtime.onMessage.addListener(routeMessage);
