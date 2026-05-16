import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache, isValidIdFormat } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { verifyViaSms } from '../../services/sms_verification_service.js';
import { getRawBase64, getMimeTypeFromDataUrl } from '../../utils/helpers.js';
import * as UI from '../../ui/injectors.js';
import * as TPL from '../../ui/templates.js';

export async function handleStartAI(amount, imgSrc, tabId) {
  chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.runShowStatus, args: [TPL.getStatusHtml(), amount] }).catch(() => {});
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: UI.grabImageData,
    args: [imgSrc]
  }, async (results) => {
    const result = results?.[0]?.result;
    let processedBase64 = null, rawBase64 = null, rawMimeType = 'image/jpeg';

    if (result && typeof result === 'object' && result.processed) {
        processedBase64 = getRawBase64(result.processed);
        rawBase64 = getRawBase64(result.raw);
        if (result.mimeType) rawMimeType = result.mimeType;
    } else if (typeof result === 'string') {
        processedBase64 = getRawBase64(result);
    }

    if (processedBase64) {
      try {
        chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.updateStatus, args: ["AI Analyzing (Enhanced)..."] }).catch(() => {});
        // Processed image is always JPEG from canvas
        let extractedId = await callAIVisionWithRetry(processedBase64, 'image/jpeg');

        if (!isValidIdFormat(extractedId) && rawBase64) {
            chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.updateStatus, args: ["Retry (Raw)..."] }).catch(() => {});
            extractedId = await callAIVisionWithRetry(rawBase64, rawMimeType);
        }

        if (!isValidIdFormat(extractedId)) {
            const result = {
                status: "Random",
                color: "#ef4444",
                statusText: "❌ RANDOM",
                foundAmt: "0",
                timeStr: "N/A",
                foundName: "N/A",
                senderName: "-",
                senderPhone: "-",
                repeatCount: 0,
                id: "ERROR"
            };
            chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: UI.showResultOverlay,
                args: [TPL.getResultOverlayHtml(result, 0), "ERROR", result.status, result.foundAmt, result.senderName, result.senderPhone, result.timeStr, result.foundName]
            }).catch(() => {});
            return;
        }

        chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
        handleProcessedId(extractedId, amount, tabId, null); // Initial call with null customerPhone
      } catch (err) {
        chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
        chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.showAiFailureModal, args: [TPL.getAiFailureHtml(), amount] }).catch(() => {});
      }
    } else {
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.updateStatus, args: ["❌ Could not read image pixels."] }).catch(() => {});
    }
  });
}

export function handleManualId(id, amount, tabId) {
  handleProcessedId(id, amount, tabId, null); // Initial call with null customerPhone
}

export async function handleProcessedId(id, amount, originalTabId, customerPhone = null) {
    const banks = settingsCache.banks || DEFAULT_BANKS;
    const matchedBank = banks.find(b => id.length === parseInt(b.length) && b.prefixes.some(prefix => id.startsWith(prefix)));
    const isKaffiId = matchedBank && matchedBank.name === "Kaafi";

    // If it's not a Kaffi ID and we don't have a customerPhone yet, prompt for it.
    if (!isKaffiId && customerPhone === null) {
        const promptResult = await new Promise(resolve => {
            chrome.scripting.executeScript({
                target: { tabId: originalTabId },
                func: UI.showPhoneNumberPrompt,
                args: [TPL.getPhoneNumberPromptHtml()]
            }, (results) => {
                resolve(results?.[0]?.result);
            });
        });

        if (promptResult === undefined) { // User closed the prompt
            return;
        }
        customerPhone = promptResult; // Will be null if skipped
    }

    // Perform SMS-Only verification
    const { found, result } = await verifyViaSms(id, amount, customerPhone, null, isKaffiId);

    if (found && result.status === "Repeat") {
        chrome.scripting.executeScript({
            target: { tabId: originalTabId },
            func: UI.showDuplicateModal,
            args: [TPL.getDuplicateHtml(id, result.timeStr, result.statusText), id, amount, result.statusText]
        }).catch(() => {});
    } else {
        chrome.scripting.executeScript({
            target: { tabId: originalTabId },
            func: UI.showResultOverlay,
            args: [TPL.getResultOverlayHtml(result, result.repeatCount), id, result.status, result.foundAmt, result.senderName, result.senderPhone, result.timeStr, result.foundName]
        }).catch(() => {});
    }
}

export async function handleScreenshotFlow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["cropper.js"] });
}

