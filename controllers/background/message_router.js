// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\message_router.js
import { handleStartAI, handleManualId, handleProcessedId, handleScreenshotFlow, openAndVerifyFullData } from './context_menu_controller.js';
import { handleIntegrationVerify, handleMultiIntegrationVerify } from './integration_controller.js';
import { handlePdfCapture } from '../../services/pdf_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { isValidIdFormat } from '../../services/settings_service.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import * as UI from '../../ui/injectors.js';
import * as TPL from '../../ui/templates.js';
import { sendTelegramNotification } from '../../services/notification_service.js';

export function routeMessage(request, sender, sendResponse) {
  switch (request.action) {
    case "captureCropped":
      const tabIdForCapture = sender.tab.id;
      if (!request.rect || request.rect.width <= 0 || request.rect.height <= 0) {
        console.warn("Capture aborted: Invalid crop dimensions", request.rect);
        return;
      }
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 100 }, async (dataUrl) => {
        if (!dataUrl) return;
        await setupOffscreenDocument();
        chrome.runtime.sendMessage({ action: 'cropImage', dataUrl: dataUrl, rect: request.rect, tabId: tabIdForCapture });
      });
      break;
    
    case 'croppingComplete':
      const { base64, tabId: completedTabId } = request;
      chrome.scripting.executeScript({
        target: { tabId: completedTabId },
        func: UI.showAmountPicker,
        args: [TPL.getAmountPickerHtml()]
      }, async (results) => {
        if (!results || !results[0]?.result) return;
        const amount = results[0].result;
        chrome.scripting.executeScript({ target: { tabId: completedTabId }, func: UI.runShowStatus, args: [TPL.getStatusHtml(), amount] }).catch(() => {});
        try {
          const extractedId = await callAIVisionWithRetry(base64);

          if (!isValidIdFormat(extractedId)) {
              throw new Error("No valid ID found by AI");
          }

          chrome.scripting.executeScript({ target: { tabId: completedTabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
          handleProcessedId(extractedId, amount, completedTabId);
        } catch (err) {
          chrome.scripting.executeScript({ target: { tabId: completedTabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
          chrome.scripting.executeScript({ target: { tabId: completedTabId }, func: UI.showAiFailureModal, args: [TPL.getAiFailureHtml(), amount] }).catch(() => {});
        }
      });
      break;

    case 'initiateScreenshot':
      handleScreenshotFlow();
      break;

    case "startAI":
      handleStartAI(request.amount, request.src, sender.tab.id);
      break;

    case "manualIdEntry":
      handleManualId(request.id, request.amount, sender.tab.id);
      break;

    case "triggerManualPrompt":
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        func: UI.showCustomPrompt,
        args: [TPL.getCustomPromptHtml("Manual Transaction ID", "Please enter the transaction ID below.")]
      }, (results) => {
        const manId = results?.[0]?.result;
        if (manId) handleManualId(manId.replace(/\D/g, ''), request.amount, sender.tab.id);
      });
      break;

    case "continueDuplicate":
      openAndVerifyFullData(request.id, sender.tab.id, request.amount);
      break;

    case "closeTab":
      chrome.tabs.remove(sender.tab.id);
      break;
    
    case "fetchImageBase64":
      fetch(request.url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            return response.blob();
        })
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => sendResponse({ 
              data: reader.result ? reader.result.split(',')[1] : "",
              mimeType: blob.type 
          });
          reader.onerror = () => sendResponse({ error: "Failed to read image blob" });
          reader.readAsDataURL(blob);
        })
        .catch(err => sendResponse({ error: err.message }));
      return true;

    case "verifyIntegration":
      handleIntegrationVerify(request, sender.tab.id);
      break;
      
    case "verifyMultiIntegration":
      handleMultiIntegrationVerify(request, sender.tab.id);
      break;

    case "testTelegram":
      console.log("🔔 Test Telegram Triggered");
      sendTelegramNotification("🔔 *Test Notification*\n\nSystem is connected successfully!")
        .then(() => sendResponse({ success: true }))
        .catch(err => {
            console.error("Telegram Error:", err);
            sendResponse({ success: false, error: err.message });
        });
      return true;

    case "openRandomReview":
      const mgmtTabId = sender.tab.id;
      if (!request.url || !request.url.startsWith('http')) return;
      chrome.tabs.create({ url: request.url }, (newTab) => {
        chrome.scripting.executeScript({
          target: { tabId: newTab.id },
          func: UI.showRandomReviewModal,
          args: [TPL.getRandomReviewHtml(request.isPdf), mgmtTabId, request.rowId, request.extractedId || null, request.url]
        });
      });
      break;

    case "capturePdf":
      handlePdfCapture(request.url).then(dataUrls => sendResponse({ dataUrls })).catch(err => sendResponse({ error: err.message }));
      return true;

    case "confirmRandomReject":
      chrome.tabs.remove(sender.tab.id);
      chrome.tabs.sendMessage(request.mgmtTabId, {
        action: "executeReject",
        rowId: request.rowId,
        extractedId: request.extractedId,
        imgUrl: request.imgUrl,
        data: {
            status: "Random",
            color: "#ef4444",
            statusText: "❌ RANDOM / UNKNOWN",
            foundAmt: "0",
            timeStr: "N/A",
            foundName: "N/A"
        }
      }).catch(() => {});
      break;
  }
}
