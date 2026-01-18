// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\context_menu_controller.js
import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache, isValidIdFormat } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { getTransaction, logTransactionResult } from '../../services/storage_service.js';
import { verifyTransactionData } from '../../services/verification.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import { getRawBase64, getTimeAgo } from '../../utils/helpers.js';
import * as UI from '../../ui/injectors.js';
import { BANK_XPATHS } from '../../utils/constants.js';
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
            throw new Error("No valid ID found by AI");
        }

        chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
        handleProcessedId(extractedId, amount, tabId);
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
  handleProcessedId(id, amount, tabId);
}

export async function handleProcessedId(id, amount, originalTabId) {
    const old = await getTransaction(id);
    if (old) {
        const isIncomplete = !old.senderName || !old.bankDate;
        if (isIncomplete) {
            openAndVerifyFullData(id, originalTabId, amount, old);
            return;
        }

        let effectiveStatus = "Repeat";
        if (old.status === "Wrong Recipient") effectiveStatus = "Wrong Recipient";
        const ageStr = getTimeAgo(old.timestamp, old.dateVerified);

        const repeatResult = {
            status: effectiveStatus,
            foundAmt: old.amount,
        };
        await logTransactionResult(id, repeatResult, old);

        chrome.scripting.executeScript({
            target: { tabId: originalTabId },
            func: UI.showDuplicateModal,
            args: [TPL.getDuplicateHtml(id, ageStr, effectiveStatus), id, amount, effectiveStatus]
        }).catch(() => {});
        return;
    }
    openAndVerifyFullData(id, originalTabId, amount);
}

export async function openAndVerifyFullData(id, originalTabId, expectedAmount, existingTx = null) {
  const banks = settingsCache.banks || DEFAULT_BANKS;
  
  const historyItem = existingTx || await getTransaction(id);
  const repeatCount = historyItem ? (historyItem.repeatCount || 0) : 0;
  
  const matchedBank = banks.find(b => 
    id.length === parseInt(b.length) && 
    b.prefixes.some(prefix => id.startsWith(prefix))
  );

  if (!matchedBank) {
    chrome.scripting.executeScript({
      target: { tabId: originalTabId },
      func: (id) => alert(`The provided ID "${id}" does not match any known bank format. Please try again.`),
      args: [id]
    }).catch(() => {});
    return;
  }

  const baseUrl = matchedBank.url;
  const maxHours = settingsCache.maxReceiptAge || 0.5;
  const useHeadless = settingsCache.headlessMode !== false;

  if (useHeadless) {
    await setupOffscreenDocument();
    chrome.scripting.executeScript({
        target: { tabId: originalTabId },
        func: () => {
            const div = document.createElement('div');
            div.id = 'ebirr-loading-overlay';
            div.style = "position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#334155; color:white; padding:10px 20px; border-radius:20px; z-index:999999; font-family:sans-serif; font-size:14px; box-shadow:0 4px 15px rgba(0,0,0,0.3); display:flex; align-items:center; gap:10px;";
            div.innerHTML = '<span>Verifying with Bank...</span>';
            document.body.appendChild(div);
        }
    }).catch(() => {});

    chrome.runtime.sendMessage({ action: 'parseReceipt', url: baseUrl + id }, async (data) => {
      chrome.scripting.executeScript({ target: { tabId: originalTabId }, func: () => document.getElementById('ebirr-loading-overlay')?.remove() }).catch(() => {});

      if (chrome.runtime.lastError || !data || data.error) {
        chrome.scripting.executeScript({
            target: { tabId: originalTabId },
            func: (e) => alert("Headless Fetch Failed: " + e),
            args: [data?.error || "Connection Error"]
        }).catch(() => {});
        return;
      }

      if (!data.recipient) {
        const result = {
            status: "Invalid ID",
            color: "#ef4444",
            statusText: "❌ INVALID ID (BANK 404)",
            foundAmt: "0",
            timeStr: "N/A",
            foundName: "N/A",
            senderName: "-",
            senderPhone: "-",
            nameOk: false, amtOk: false, timeOk: false,
            repeatCount: repeatCount
        };
        await logTransactionResult(id, { ...result, foundAmt: expectedAmount }, historyItem);

        chrome.scripting.executeScript({
          target: { tabId: originalTabId },
          func: UI.showResultOverlay,
          args: [TPL.getResultOverlayHtml(result, repeatCount), id, result.status, result.foundAmt, result.senderName, result.senderPhone, result.timeStr, result.foundName]
        }).catch(() => {});
        return;
      }
      
      const result = verifyTransactionData(data, expectedAmount, settingsCache.targetName, maxHours);
      if (result.status.startsWith("AA")) result.color = "#3b82f6";
      
      await logTransactionResult(id, result, historyItem);

      chrome.scripting.executeScript({
        target: { tabId: originalTabId },
        func: UI.showResultOverlay,
        args: [TPL.getResultOverlayHtml(result, repeatCount), id, result.status, result.foundAmt, result.senderName, result.senderPhone, result.timeStr, result.foundName]
      }).catch(() => {});
    });
  } else {
    // Legacy Mode: Open in new tab
    chrome.tabs.create({ url: baseUrl + id }, (tab) => {
        const listener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: UI.scrapeBankData,
                    args: [BANK_XPATHS]
                }, async (results) => {
                    const data = results?.[0]?.result;
                    
                    if (!data || data.error || !data.recipient) {
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: (msg) => alert(msg),
                            args: ["Verification Failed: " + (data?.error || "Data missing on page")]
                        });
                        return;
                    }

                    const result = verifyTransactionData(data, expectedAmount, settingsCache.targetName, maxHours);
                    if (result.status.startsWith("AA")) result.color = "#3b82f6";

                    await logTransactionResult(id, result, historyItem);

                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: UI.showResultOverlay,
                        args: [TPL.getResultOverlayHtml(result, repeatCount), id, result.status, result.foundAmt, result.senderName, result.senderPhone, result.timeStr, result.foundName]
                    });
                });
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
  }
}

export async function handleScreenshotFlow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["cropper.js"] });
}
