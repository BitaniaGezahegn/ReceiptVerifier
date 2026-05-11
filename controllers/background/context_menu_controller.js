// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\context_menu_controller.js
import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache, isValidIdFormat } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { 
  getTransaction, 
  logTransactionResult, 
  getSmsEntryById, 
  getSmsEntryByClaimedId, 
  updateSmsEntry, 
  getSmsEntryByFingerprint 
} from '../../services/storage_service.js';
import { verifyTransactionData } from '../../services/verification.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import { auth } from '../../services/firebase_config.js'; // Import auth here
import { getRawBase64, getTimeAgo, getMimeTypeFromDataUrl } from '../../utils/helpers.js';
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
    let isDirectMatch = false; // Initialize for context menu

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

    // If customerPhone is provided and it's not a Kaffi ID, attempt fingerprint match first.
    if (customerPhone && !isKaffiId && settingsCache.smsCheckEnabled) {
        const smsEntryByFingerprint = await getSmsEntryByFingerprint(customerPhone, amount);
        if (smsEntryByFingerprint) {
            // If a fingerprint match is found, use that ID for further processing.
            id = smsEntryByFingerprint.id;
        }
    }

    // 1. SMS Vault Implementation
    if (settingsCache.smsCheckEnabled) {
        let smsEntry = await getSmsEntryById(id);
        if (smsEntry) isDirectMatch = true;

        if (!smsEntry) {
            smsEntry = await getSmsEntryByClaimedId(id);
            if (smsEntry && smsEntry.id === id) isDirectMatch = true;
        }

        if (smsEntry) {
            const isRepeat = smsEntry.status !== "pending";
            const status = isRepeat ? "Repeat" : "Verified";
            const color = isRepeat ? "#f59e0b" : "#10b981";
            const statusText = isRepeat ? "🔁 DUPLICATE / REPEAT (SMS)" : "✅ VERIFIED (SMS)";
            const repeatCount = smsEntry.verificationCount || 0;

            await updateSmsEntry(smsEntry.id, {
                verificationCount: repeatCount + 1,
                claimedByScreenshotId: id,
                status: status === "Verified" ? "verified" : "duplicate",
                dateVerified: new Date().toLocaleString(), // Use toLocaleString() for consistent format
                processedBy: auth.currentUser.email,
                processedByUid: auth.currentUser.uid,
            });

            const verificationResult = {
                status: status,
                foundAmt: smsEntry.amount,
                senderName: smsEntry.senderName,
                senderPhone: smsEntry.senderPhone,
                foundName: smsEntry.recipientName || "Kaafi",
                bankDate: smsEntry.transactionTimestamp ? new Date(smsEntry.transactionTimestamp.toDate()).toLocaleString() : "N/A",
                timeStr: smsEntry.transactionTimestamp ? 
                    getTimeAgo(smsEntry.transactionTimestamp.toDate().getTime()) : "Just now",
                repeatCount: repeatCount,
                color,
                statusText,
                bankName: isDirectMatch ? "Kaafi" : "Other"
            };

            const existingTx = await getTransaction(smsEntry.id);
            await logTransactionResult(smsEntry.id, verificationResult, existingTx, id);

            if (isRepeat) {
                chrome.scripting.executeScript({
                    target: { tabId: originalTabId },
                    func: UI.showDuplicateModal,
                    args: [TPL.getDuplicateHtml(id, verificationResult.timeStr, statusText), id, amount, statusText]
                }).catch(() => {});
            } else {
                chrome.scripting.executeScript({
                    target: { tabId: originalTabId },
                    func: UI.showResultOverlay,
                    args: [TPL.getResultOverlayHtml(verificationResult, repeatCount), id, status, verificationResult.foundAmt, verificationResult.senderName, verificationResult.senderPhone, verificationResult.timeStr, verificationResult.foundName]
                }).catch(() => {});
            }
            return;
        }
    }

    if (!settingsCache.bankCheckEnabled) {
        chrome.scripting.executeScript({
            target: { tabId: originalTabId },
            func: (id) => alert(`SMS match not found for ID "${id}" and Bank Check is disabled.`),
            args: [id]
        }).catch(() => {});
        return;
    }

    // 2. Legacy Database Check
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
  ); // Re-evaluate matchedBank as ID might have changed due to fingerprint match

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
        args: [
          TPL.getResultOverlayHtml(result, repeatCount), 
          String(id || ""), 
          String(result.status || ""), 
          Number(result.foundAmt) || 0, 
          String(result.senderName || "-"), 
          String(result.senderPhone || "-"), 
          String(result.timeStr || "N/A"), 
          String(result.foundName || "N/A")
        ]
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
                    console.log("[ContextMenu] Scrape Result:", data);
                    
                    if (!data || data.error || !data.recipient) {
                        console.error("[ContextMenu] Verification aborted: Data missing.");
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
