import { DEFAULT_API_KEY, TARGET_NAME, DEFAULT_BANKS } from './config.js';
import { verifyTransactionData } from './services/verification.js';
import { callAIVision } from './services/ai_service.js';
import { getTransaction, logTransactionResult } from './services/storage_service.js';
import * as UI from './ui/injectors.js';
import * as TPL from './ui/templates.js';
import './services/auth_service.js'; // Initialize Auth

// CACHE FOR SNAPPY PERFORMANCE
let settingsCache = {
    apiKeys: [DEFAULT_API_KEY],
    activeKeyIndex: 0,
    banks: DEFAULT_BANKS,
    maxReceiptAge: 0.5,
    headlessMode: true,
    aiScanBehavior: 'always_ai',
    targetName: TARGET_NAME,
};

const initCache = async () => {
    const data = await chrome.storage.local.get(Object.keys(settingsCache));
    Object.assign(settingsCache, data);
    // Ensure defaults
    if (!settingsCache.apiKeys || settingsCache.apiKeys.length === 0) settingsCache.apiKeys = [DEFAULT_API_KEY];
    if (!settingsCache.banks || settingsCache.banks.length === 0) settingsCache.banks = DEFAULT_BANKS;
    if (!settingsCache.targetName) settingsCache.targetName = TARGET_NAME;
};
initCache();

function getRawBase64(data) {
    if (!data) return null;
    const commaIndex = data.indexOf(',');
    return commaIndex > -1 ? data.substring(commaIndex + 1) : data;
}

function getMimeTypeFromDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,/);
    return match ? match[1] : 'image/jpeg';
}

function isValidIdFormat(id) {
    if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
        return false;
    }
    const banks = settingsCache.banks || DEFAULT_BANKS;
    const matchedBank = banks.find(b => 
      id.length === parseInt(b.length) && 
      b.prefixes.some(prefix => id.startsWith(prefix))
    );
    return !!matchedBank;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (key in settingsCache) settingsCache[key] = newValue;
        }
    }
});

// 1. INITIALIZE EXTENSION
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['apiKeys', 'banks']);
  if (!data.apiKeys || data.apiKeys.length === 0) {
      await chrome.storage.local.set({ apiKeys: [DEFAULT_API_KEY], activeKeyIndex: 0 });
  }
  if (!data.banks || data.banks.length === 0) {
      await chrome.storage.local.set({ banks: DEFAULT_BANKS });
  }
  await initCache();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "verifyMain", title: "✅ Verify Transaction", contexts: ["image", "link", "frame", "page"] });
  });
});

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

// 3. LOGIC HANDLER
async function handleProcessedId(id, amount, originalTabId) {
    const old = await getTransaction(id);
    if (old) {
        // If the existing record is incomplete (e.g., from a failed/random import),
        // re-fetch from the bank to enrich it with sender/bank details.
        const isIncomplete = !old.senderName || !old.bankDate;
        if (isIncomplete) {
            openAndVerifyFullData(id, originalTabId, amount, old);
            return;
        }

        let effectiveStatus = "Repeat";
        if (old.status === "Wrong Recipient") effectiveStatus = "Wrong Recipient"; // Keep original error if it was wrong
        const ageStr = getTimeAgo(old.timestamp, old.dateVerified);

        // Log this repeat attempt. The verification result is synthetic for a "Repeat" status.
        const repeatResult = {
            status: effectiveStatus,
            foundAmt: old.amount, // Use the amount from the last valid verification
            // Other fields are not relevant for a simple repeat log, they will be preserved from `old`.
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

// 4. MESSAGE LISTENER
chrome.commands.onCommand.addListener((command) => {
  if (command === "take_screenshot_verify") {
    handleScreenshotFlow();
  }
});

async function handleScreenshotFlow() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["cropper.js"] });
}

// RATE LIMITING QUEUE
let aiQueue = Promise.resolve();
let lastAiRequestTime = 0;
const MIN_AI_INTERVAL = 4000; // 4 seconds = 15 requests per minute (Safe for Free Tier)

async function callAIVisionWithRetry(base64, mimeType = 'image/jpeg') {
    const keys = settingsCache.apiKeys;
    const banks = settingsCache.banks;
    
    // Enforce sequential execution with rate limiting
    return new Promise((resolve) => {
        aiQueue = aiQueue.then(async () => {
            const now = Date.now();
            const timeSinceLast = now - lastAiRequestTime;
            const wait = Math.max(0, MIN_AI_INTERVAL - timeSinceLast);
            
            if (wait > 0) {
                await new Promise(r => setTimeout(r, wait));
            }
            
            lastAiRequestTime = Date.now();

            try {
                const result = await callAIVision(base64, keys, settingsCache.activeKeyIndex, banks, mimeType);
                console.log("AI Result:", result); // Debugging Log
                resolve(result);
            } catch (e) {
                if (e.message && (e.message.includes("Rate Limited") || e.message.includes("exhausted") || e.message.includes("restricted"))) {
                    console.warn("AI Service Rate Limit:", e.message);
                    resolve("RATE_LIMIT");
                } else {
                    resolve("ERROR");
                }
            }
        });
    });
}

async function handleStartAI(amount, imgSrc, tabId) {
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
        // The catch block is now the single point of failure for AI scans
        chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.getElementById('ebirr-status-host')?.remove() }).catch(() => {});
        chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.showAiFailureModal, args: [TPL.getAiFailureHtml(), amount] }).catch(() => {});
      }
    } else {
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: UI.updateStatus, args: ["❌ Could not read image pixels."] }).catch(() => {});
    }
  });
}

function handleManualId(id, amount, tabId) {
  handleProcessedId(id, amount, tabId);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "captureCropped":
      const tabIdForCapture = sender.tab.id;
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
          // The catch block is now the single point of failure for AI scans
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

    case "openRandomReview":
      const mgmtTabId = sender.tab.id;
      // Validate URL to prevent CSP errors (e.g. javascript:void(0))
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
});

async function handleIntegrationVerify(request, tabId) {
  const { src, amount, rowId, dataUrl } = request;
  const updateStatus = (msg) => chrome.tabs.sendMessage(tabId, { action: "updateStatus", message: msg, rowId }).catch(() => {});
  
  let extractedId = null;

  try {
    if (!dataUrl) throw new Error("Failed to load image");

    // Check if it's a PDF by MIME type OR file extension
    const isPdf = dataUrl.startsWith("data:application/pdf") || (src && src.toLowerCase().split('?')[0].endsWith('.pdf'));

    if (isPdf) {
        const pdfKey = `PDF_${Date.now()}`;
        const verificationResult = {
            status: "PDF",
            foundAmt: amount,
        };
        await logTransactionResult(pdfKey, verificationResult, null, "PDF");

             // Fallback to manual review if no ID found in PDF
             chrome.tabs.sendMessage(tabId, {
                action: "integrationResult",
                rowId,
                success: true,
                data: {
                    status: "PDF",
                    color: "#3b82f6",
                    statusText: "📄 PDF (SKIPPED)",
                    foundAmt: amount,
                    timeStr: "N/A",
                    foundName: "Manual Check Req.",
                    senderName: "-",
                    senderPhone: "-",
                    repeatCount: 0
                },
                extractedId: "PDF",
                imgUrl: src
            }).catch(() => {});
            return;
    } else {
        // IMAGE FLOW
        updateStatus("AI Scanning (Enhanced)...");
        await setupOffscreenDocument();
        
        // 1. Try Enhanced Image First
        let enhancedBase64 = null;
        enhancedBase64 = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'processImage', dataUrl }, (response) => {
                    resolve(response?.base64);
                });
            });

        if (enhancedBase64) {
        extractedId = await callAIVisionWithRetry(enhancedBase64, 'image/jpeg');
        }

        // 2. Fallback to Raw Image
        if (!extractedId || extractedId === "ERROR") {
            updateStatus("Retry (Raw Image)...");
            let rawBase64 = dataUrl.split(',')[1];
        let mimeType = getMimeTypeFromDataUrl(dataUrl);
        extractedId = await callAIVisionWithRetry(rawBase64, mimeType);
        }
    }

    if (extractedId === "RATE_LIMIT") {
        chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId,
            success: true,
            data: {
                status: "API Limit",
                color: "#f59e0b",
                statusText: "⚠️ API LIMIT REACHED",
                foundAmt: "0",
                timeStr: "N/A",
                foundName: "Check API Keys",
                senderName: "-",
                senderPhone: "-"
            },
            extractedId: "RATE_LIMIT",
            imgUrl: src
        }).catch(() => {});
        return;
    }

    if (!extractedId || extractedId === "ERROR" || extractedId.trim() === "") {
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random",
          foundAmt: amount, // Log the expected amount as there's no found amount
      };
      await logTransactionResult(randomKey, verificationResult, null, "ERROR");
      
      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId,
        success: true,
        data: {
          status: "Random",
          color: "#ef4444",
          statusText: "❓ RANDOM / UNKNOWN",
          foundAmt: "0",
          timeStr: "N/A",
          foundName: "N/A",
          senderName: "-",
          senderPhone: "-"
        },
        extractedId: "ERROR",
        imgUrl: src
      }).catch(() => {});
      return;
    }

    updateStatus("Validating ID...");
    const banks = settingsCache.banks || DEFAULT_BANKS;
    
    const matchedBank = banks.find(b => 
      extractedId.length === parseInt(b.length) && 
      b.prefixes.some(prefix => extractedId.startsWith(prefix))
    );
    
    if (!matchedBank) {
      updateStatus("Invalid ID..."); // Only show if it actually fails
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random", // Treat as Random if bank format is wrong
          foundAmt: amount,
      };
      await logTransactionResult(randomKey, verificationResult, null, extractedId);
      
      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId,
        success: true,
        data: {
          status: "Random",
          color: "#ef4444",
          statusText: "❌ RANDOM / UNKNOWN",
          foundAmt: "0",
          timeStr: "N/A",
          foundName: "N/A",
          senderName: "-",
          senderPhone: "-"
        },
        extractedId,
        imgUrl: src
      }).catch(() => {});
      
      return;
    }

    updateStatus("Checking Database...");
    const old = await getTransaction(extractedId);
    if (old) {
        const isIncomplete = !old.senderName || !old.bankDate;
        if (!isIncomplete) {
            // It's a complete repeat, do the repeat logic and return.
            old.repeatCount = (old.repeatCount || 0) + 1;
            old.lastRepeat = Date.now();
            
            let effectiveStatus = "Repeat";
            let statusText = "🔁 DUPLICATE / REPEAT";

            const repeatResult = {
                status: effectiveStatus,
                foundAmt: old.amount,
            };
            await logTransactionResult(extractedId, repeatResult, old);

            chrome.tabs.sendMessage(tabId, {
                action: "integrationResult",
                rowId,
                success: true,
                data: {
                    status: effectiveStatus,
                    originalStatus: old.status,
                    color: "#ef4444",
                    statusText: statusText,
                    foundAmt: old.amount,
                    timeStr: getTimeAgo(old.timestamp, old.dateVerified),
                    foundName: old.recipientName || "Previously Processed",
                    senderName: old.senderName || "-",
                    senderPhone: old.senderPhone || "-",
                    repeatCount: old.repeatCount
                },
                extractedId,
                imgUrl: src
            }).catch(() => {});
            return;
        }
        // If incomplete, fall through to re-fetch.
    }

    updateStatus("Checking Bank...");
    // Offscreen document is already setup at start of function
    
    let data;
    try {
        data = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error("Bank Check Timeout")), 20000);
            chrome.runtime.sendMessage({ action: 'parseReceipt', url: matchedBank.url + extractedId }, (response) => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                    reject(new Error("Connection Error: " + chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    } catch (err) {
        chrome.tabs.sendMessage(tabId, { 
          action: "integrationResult", 
          rowId, 
          success: false, 
          error: err.message,
          imgUrl: src
        }).catch(() => {});
        return;
    }

    if (!data || data.error) {
        chrome.tabs.sendMessage(tabId, { 
          action: "integrationResult", 
          rowId, 
          success: false, 
          error: data?.error || "Bank Fetch Failed",
          imgUrl: src
        }).catch(() => {});
        return;
    }

      // CHECK FOR 404 / INVALID ID (Bank returned page but no data or "Not Found Page")
      if (!data.recipient) {
          const result = { // This is the verificationResult
              status: "Invalid ID",
              color: "#ef4444",
              statusText: "🚫 INVALID ID (BANK 404)",
              foundAmt: "0",
              timeStr: "N/A",
              foundName: "N/A",
              senderName: "-",
              senderPhone: "-",
              repeatCount: 0
          };
          await logTransactionResult(extractedId, { ...result, foundAmt: 0 }, old);

          chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId: rowId,
            success: true,
            data: result,
            extractedId: extractedId,
            imgUrl: src
          }).catch(() => {});
          return;
      }

      const maxHours = settingsCache.maxReceiptAge || 0.5;
      const result = verifyTransactionData(data, amount, settingsCache.targetName, maxHours);
      if (result.status.startsWith("AA")) result.color = "#3b82f6";

      await logTransactionResult(extractedId, result, old);

      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId: rowId,
        success: true,
        data: { ...result, repeatCount: 0 },
        extractedId: extractedId,
        imgUrl: src
      }).catch(() => {});

  } catch (err) {
    chrome.tabs.sendMessage(tabId, { 
      action: "integrationResult", 
      rowId, 
      success: false, 
      error: err.message,
      imgUrl: src
    }).catch(() => {});
  }
}

async function handlePdfCapture(url) {
    return new Promise((resolve, reject) => {
        // Safety timeout to prevent hanging indefinitely (45s)
        const timeoutId = setTimeout(() => {
            reject(new Error("PDF Capture Timeout"));
        }, 45000);

        chrome.windows.create({ url: url, type: 'popup', state: 'maximized', focused: true }, async (win) => {
            if (chrome.runtime.lastError) { clearTimeout(timeoutId); return reject(chrome.runtime.lastError); }
            const tabId = win.tabs[0].id;
            
            const checkListener = (tId, changeInfo, tab) => {
                if (tId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(checkListener);
                    setTimeout(async () => {
                        try {
                            // Ensure focus for rendering
                            await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => window.focus() }).catch(() => {});

                            // 1. Get Dimensions
                            const dims = await chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: () => ({
                                    height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                                    viewHeight: window.innerHeight
                                })
                            });
                            
                            const { height, viewHeight } = dims[0].result;
                            const captures = [];
                            let currentY = 0;

                            // 2. Loop: Scroll & Capture
                            while (currentY < height || captures.length === 0) {
                                if (currentY > 0) {
                                    await chrome.scripting.executeScript({ target: { tabId: tabId }, func: (y) => window.scrollTo(0, y), args: [currentY] });
                                    await new Promise(r => setTimeout(r, 800)); // Wait for render
                                }

                                const dataUrl = await new Promise(res => chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 80 }, res));
                                if (dataUrl) captures.push(dataUrl);
                                
                                currentY += viewHeight;
                                if (captures.length >= 5) break; // Limit to 5 pages
                            }

                            chrome.windows.remove(win.id);
                            resolve(captures);
                        } catch (e) {
                            chrome.windows.remove(win.id);
                            reject(e);
                        } finally {
                            clearTimeout(timeoutId);
                        }
                    }, 3500); // Increased wait to ensure PDF renders properly
                }
            };
            chrome.tabs.onUpdated.addListener(checkListener);
        });
    });
}

async function handleMultiIntegrationVerify(request, tabId) {
    const { images, amount, rowId, primaryUrl } = request;
    const updateStatus = (msg) => chrome.tabs.sendMessage(tabId, { action: "updateStatus", message: msg, rowId }).catch(() => {});

    if (images.length > 1) updateStatus(`Processing ${images.length} Image(s)...`);
    
    let validTransactions = [];
    let processedIds = new Set();
    let totalFoundAmount = 0;
    let errors = [];
    
    // Metadata from the last valid transaction for display
    let lastSenderName = "-";
    let lastSenderPhone = "-";
    let lastRecipientName = "N/A";
    let lastTimeStr = "N/A";
    let maxRepeatCount = 0;
    let duplicateTransaction = null;
    let failedTransaction = null;

    await setupOffscreenDocument();
    const banks = settingsCache.banks || DEFAULT_BANKS;

    // 1. Extract & Verify IDs
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const statusPrefix = images.length > 1 ? `Image ${i + 1}/${images.length}` : `Image`;
        let mimeType = 'image/jpeg';
        
        try {
            let finalId = null;

            // 1. Try Enhanced Image First
            updateStatus(`Scanning ${statusPrefix} (Enhanced)...`);
            let enhancedBase64 = null;
                
            if (img.enhancedDataUrl) {
                enhancedBase64 = img.enhancedDataUrl.split(',')[1] || img.enhancedDataUrl;
            } else if (img.dataUrl) {
                // Fallback processing if enhanced not pre-calculated
                enhancedBase64 = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'processImage', dataUrl: img.dataUrl }, response => {
                        resolve(response?.base64);
                    });
                });
            }

            if (enhancedBase64) finalId = await callAIVisionWithRetry(enhancedBase64, 'image/jpeg');

            // 2. Fallback to Clean/Raw Image
            if (!finalId || finalId === "ERROR") {
                updateStatus(`Retry ${statusPrefix} (Clean)...`);
                let cleanBase64 = null;
                
                if (img.cleanDataUrl) {
                    cleanBase64 = img.cleanDataUrl.split(',')[1] || img.cleanDataUrl;
                } else if (img.dataUrl) {
                    // Fallback for legacy/single image flow
                    cleanBase64 = img.dataUrl.split(',')[1] || img.dataUrl;
                    mimeType = getMimeTypeFromDataUrl(img.dataUrl);
                }

                if (cleanBase64) {
                    finalId = await callAIVisionWithRetry(cleanBase64, mimeType);
                }
            }

            if (!finalId && !enhancedBase64 && !img.cleanDataUrl && !img.dataUrl) {
                 errors.push(`Image ${i + 1}: Failed to load`);
                 continue;
            }

            if (finalId === "RATE_LIMIT") {
                errors.push(`Image ${i + 1}: API Rate Limit`);
                continue;
            }
            
            if (finalId && finalId !== "ERROR" && finalId.trim() !== "") {
                // Deduplicate
                if (processedIds.has(finalId)) continue;
                processedIds.add(finalId);

                // Match Bank
                const matchedBank = banks.find(b => finalId.length === parseInt(b.length) && b.prefixes.some(prefix => finalId.startsWith(prefix)));
                if (!matchedBank) {
                    // Treat invalid format as Random/Unknown (likely AI hallucination)
                    continue;
                }

                // Check DB for duplicates
                const old = await getTransaction(finalId);
                if (old) {
                    const isIncomplete = !old.senderName || !old.bankDate;
                    if (!isIncomplete) {
                        // It's a complete repeat. Log and continue.
                        old.repeatCount = (old.repeatCount || 0) + 1;
                        old.lastRepeat = Date.now();
                        await logTransactionResult(finalId, { status: "Repeat", foundAmt: old.amount }, old);
                        errors.push(`ID ${finalId}: Duplicate / Repeat`);
                        maxRepeatCount = Math.max(maxRepeatCount, old.repeatCount);
                        if (!duplicateTransaction) duplicateTransaction = old;
                        continue;
                    }
                    // If incomplete, fall through to bank fetch logic.
                }

                // Fetch Bank Data
                const data = await new Promise((resolve) => {
                    const timeoutId = setTimeout(() => resolve(null), 20000);
                    chrome.runtime.sendMessage({ action: 'parseReceipt', url: matchedBank.url + finalId }, (response) => {
                        clearTimeout(timeoutId);
                        resolve(response && !response.error ? response : null);
                    });
                });

                if (!data || !data.recipient) {
                    // Treat bank 404 as Random/Unknown (likely invalid ID)
                    continue;
                }

                // Verify Data (Pass 0 as amount to just check validity of Name/Date)
                const check = verifyTransactionData(data, 0, settingsCache.targetName, settingsCache.maxReceiptAge);
                
                if (!check.nameOk || !check.timeOk) {
                     errors.push(`ID ${finalId}: ${check.status}`);
                     if (!failedTransaction) {
                         failedTransaction = {
                             amount: check.foundAmt,
                             timeStr: check.timeStr,
                             recipientName: check.foundName,
                             senderName: check.senderName,
                             senderPhone: check.senderPhone,
                             status: check.status,
                             statusText: check.statusText,
                             id: finalId,
                             existingTx: old,
                             bankDate: check.bankDate
                         };
                     }
                } else {
                     // Valid transaction found
                     validTransactions.push({ id: finalId, amount: check.foundAmt, data: data, timeStr: check.timeStr, existingTx: old });
                     totalFoundAmount += check.foundAmt;
                     
                     lastSenderName = data.senderName;
                     lastSenderPhone = data.senderPhone;
                     lastRecipientName = data.recipient;
                     lastTimeStr = check.timeStr;
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    // 2. Analyze Results
    if (validTransactions.length === 0) {
        const isRateLimit = errors.some(e => e.includes("Rate Limit"));
        const isLoadError = errors.some(e => e.includes("Failed to load"));
        
        // LOGIC FIX: Prioritize specific errors over "Random"
        let finalStatus = "Random";
        let finalColor = "#ef4444";
        let statusText = errors.length > 0 ? (isRateLimit ? "⚠️ " + errors[0] : "❌ " + errors[0]) : "❌ NO VALID ID FOUND";
        
        let foundAmt = "0";
        let timeStr = "N/A";
        let foundName = "N/A";
        let senderName = "-";
        let senderPhone = "-";
        let originalStatus = undefined;
        let extractedId = "ERROR";

        if (isRateLimit) {
            finalStatus = "API Limit";
            finalColor = "#f59e0b";
        } else if (duplicateTransaction) {
            // Already logged in the loop. Just setting UI variables.
            finalStatus = "Repeat";
            finalColor = "#ef4444";
            statusText = "🔁 DUPLICATE / REPEAT";
            
            foundAmt = duplicateTransaction.amount;
            timeStr = getTimeAgo(duplicateTransaction.timestamp, duplicateTransaction.dateVerified);
            foundName = duplicateTransaction.recipientName || "Previously Processed";
            senderName = duplicateTransaction.senderName || "-";
            senderPhone = duplicateTransaction.senderPhone || "-";
            originalStatus = duplicateTransaction.status;
            extractedId = duplicateTransaction.id;
        } else if (failedTransaction) {
            // This is a specific failure (e.g. Old Receipt) that needs to be logged.
            const failureResult = {
                status: failedTransaction.status,
                foundAmt: failedTransaction.amount,
                senderName: failedTransaction.senderName,
                senderPhone: failedTransaction.senderPhone,
                foundName: failedTransaction.recipientName,
                timeStr: failedTransaction.timeStr,
                bankDate: failedTransaction.bankDate
            };
            // Log the failed transaction.
            await logTransactionResult(failedTransaction.id, failureResult, failedTransaction.existingTx);

            finalStatus = failedTransaction.status;
            statusText = failedTransaction.statusText;
            if (finalStatus === "Old Receipt") finalColor = "#ff9800";
            else finalColor = "#f44336";
            
            foundAmt = failedTransaction.amount;
            timeStr = failedTransaction.timeStr;
            foundName = failedTransaction.recipientName;
            senderName = failedTransaction.senderName;
            senderPhone = failedTransaction.senderPhone;
            extractedId = failedTransaction.id;
        } else if (isLoadError) {
            finalStatus = "Random"; // Treat load error as Random to pause batch
            finalColor = "#ef4444";
            statusText = "❌ IMAGE LOAD FAILED";
            // Do NOT log to DB for technical load errors
        } else if (errors.length > 0) {
            finalStatus = "Random"; // Treat other errors as Random to prevent auto-reject
            finalColor = "#ef4444";
            statusText = `❌ ${errors[0]}`;

            // FALLBACK FIX: Extract ID from error string if failedTransaction was missed
            const idMatch = errors[0].match(/^ID (\d+): (.*)$/);
            if (idMatch) {
                extractedId = idMatch[1];
                const errType = idMatch[2];
                
                if (errType.includes("Old Receipt")) {
                    finalStatus = "Old Receipt";
                    finalColor = "#ff9800";
                } else if (errType.includes("Wrong Recipient")) {
                    finalStatus = "Wrong Recipient";
                } else if (errType.includes("Under 50")) {
                    finalStatus = "Under 50";
                } else if (errType.includes("AMT MISMATCH")) {
                    finalStatus = "Amount Mismatch";
                }
            }
        } else {
            // This is a "Random" case where no valid ID was found or matched.
            const randomKey = `RANDOM_${Date.now()}`;
            const originalId = processedIds.size > 0 ? Array.from(processedIds).join(', ') : "ERROR";
            const randomResult = {
                status: "Random",
                foundAmt: amount,
            };
            await logTransactionResult(randomKey, randomResult, null, originalId);
            finalStatus = "Random";
        }

        chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId,
            success: true,
            data: {
                status: finalStatus,
                originalStatus: originalStatus,
                color: finalColor,
                statusText: statusText,
                foundAmt: foundAmt,
                timeStr: timeStr,
                foundName: foundName,
                senderName: senderName,
                senderPhone: senderPhone,
                repeatCount: maxRepeatCount
            },
            extractedId: extractedId,
            imgUrl: primaryUrl
        }).catch(() => {});
        return;
    }

    // 3. Save Valid Transactions & Determine Status
    for (const tx of validTransactions) {
        const verificationResult = { status: "Verified", foundAmt: tx.amount, senderName: tx.data.senderName, senderPhone: tx.data.senderPhone, foundName: tx.data.recipient, timeStr: tx.timeStr, bankDate: tx.data.date };
        await logTransactionResult(tx.id, verificationResult, tx.existingTx);
    }

    let finalStatus = "Verified";
    let color = "#10b981";
    let statusText = images.length > 1 ? "✅ VERIFIED (MULTI)" : "✅ VERIFIED";

    if (totalFoundAmount !== amount) {
        finalStatus = `AA ${totalFoundAmount}`;
        color = "#3b82f6";
        statusText = `⚠️ TOTAL: ${totalFoundAmount}/${amount}`;
    }

    chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId,
        success: true,
        data: { status: finalStatus, color: color, statusText: statusText, foundAmt: totalFoundAmount, timeStr: lastTimeStr, foundName: lastRecipientName, senderName: lastSenderName, senderPhone: lastSenderPhone, repeatCount: 0 },
        extractedId: validTransactions.map(t => t.id).join(', '),
        imgUrl: primaryUrl
    }).catch(() => {});
}

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'To crop and process screenshots',
  });
}

async function openAndVerifyFullData(id, originalTabId, expectedAmount, existingTx = null) {
  const banks = settingsCache.banks || DEFAULT_BANKS;
  
  const historyItem = existingTx || await getTransaction(id);
  const repeatCount = historyItem ? (historyItem.repeatCount || 0) : 0;
  
  const matchedBank = banks.find(b => 
    id.length === parseInt(b.length) && 
    b.prefixes.some(prefix => id.startsWith(prefix))
  );

  if (!matchedBank) {
    // This block is now only for bad manual entry or a bad ID from the DB.
    // Do not log "Random". Show a specific error to the user.
    chrome.scripting.executeScript({
      target: { tabId: originalTabId },
      func: (id) => alert(`The provided ID "${id}" does not match any known bank format. Please try again.`),
      args: [id]
    }).catch(() => {});
    isProcessing = false;
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

      // Handle Invalid ID (Bank 404)
      if (!data.recipient) {
        const result = { // This is the verificationResult
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
                    func: UI.scrapeBankData
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

function getTimeAgo(timestamp, dateStr) {
    let ts = timestamp;
    if (!ts && dateStr) {
        ts = new Date(dateStr).getTime();
    }
    if (!ts) return "N/A";
    
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return "Just now";
    
    const diffMins = Math.floor(diffMs / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    
    if (h >= 24) return Math.floor(h/24) + " days ago";
    return h > 0 ? `${h} hrs, ${m} min ago` : `${m} min ago`;
}
