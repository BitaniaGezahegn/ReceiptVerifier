// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\integration_controller.js
import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { getTransaction, logTransactionResult } from '../../services/storage_service.js';
import { verifyTransactionData } from '../../services/verification.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import { getMimeTypeFromDataUrl, getTimeAgo } from '../../utils/helpers.js';
import { auth } from '../../services/firebase_config.js';
import { reportActivity, reportOutcome } from '../../services/watchdog_service.js';

function parseBankDateStr(dateStr) {
    if (!dateStr) return null;
    try {
        const p = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\s(\+\d{4})/);
        if (p) {
            return new Date(`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}${p[7].slice(0,3)}:${p[7].slice(3)}`).getTime();
        }
        const ts = new Date(dateStr).getTime();
        return isNaN(ts) ? null : ts;
    } catch (e) { return null; }
}

export async function handleIntegrationVerify(request, tabId) {
  const { src, amount, rowId, dataUrl } = request;
  const updateStatus = (msg) => chrome.tabs.sendMessage(tabId, { action: "updateStatus", message: msg, rowId }).catch(() => {});
  
  reportActivity(); // Notify watchdog we are alive
  
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
            reportOutcome(false); // PDF is considered a "failure" for automation flow if manual check needed
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
        reportOutcome(false);
        return;
    }

    if (extractedId === "SERVICE_ERROR") {
        chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId,
            success: true,
            data: {
                status: "AI Error",
                color: "#ef4444",
                statusText: "❌ AI SERVICE ERROR",
                foundAmt: "0",
                timeStr: "N/A",
                foundName: "Retry Later",
                senderName: "-",
                senderPhone: "-"
            },
            extractedId: "SERVICE_ERROR",
            imgUrl: src
        }).catch(() => {});
        reportOutcome(false);
        return;
    }

    if (!extractedId || extractedId === "ERROR" || extractedId.trim() === "" || !/^\d+$/.test(extractedId)) {
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
      reportOutcome(false);
      return;
    }

    updateStatus("Validating ID...");
    const banks = settingsCache.banks || DEFAULT_BANKS;
    
    const matchedBank = banks.find(b => extractedId.length === parseInt(b.length) && b.prefixes.some(prefix => extractedId.startsWith(prefix)));
    
    if (!matchedBank) {
      updateStatus("Invalid ID..."); // Only show if it actually fails
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random", // Treat as Random if bank format is wrong
          foundAmt: amount,
          bankCheckResult: "No Matching Bank"
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
      reportOutcome(false);
      
      return;
    }

    updateStatus("Checking Database...");
    let old;
    try {
        old = await getTransaction(extractedId);
    } catch (e) {
        if (e.message === "OFFLINE") {
            chrome.tabs.sendMessage(tabId, {
                action: "integrationResult",
                rowId,
                success: true,
                data: {
                    status: "Offline",
                    color: "#64748b",
                    statusText: "⚠️ OFFLINE",
                    foundAmt: "0",
                    timeStr: "N/A",
                    foundName: "Check Connection",
                    senderName: "-",
                    senderPhone: "-"
                },
                extractedId: extractedId,
                imgUrl: src
            }).catch(() => {});
            return;
        }
        throw e;
    }

    if (old) {
        const isIncomplete = !old.senderName || !old.bankDate;
        if (!isIncomplete) {
            // It's a complete repeat, do the repeat logic and return.
            old.repeatCount = (old.repeatCount || 0) + 1;
            old.lastRepeat = Date.now();
            
            let effectiveStatus = "Repeat";
            let statusText = "🔁 DUPLICATE / REPEAT";
            let color = "#f59e0b";

            // Check for Skipped Name override on Repeat (Wrong Recipient + < 24h + In Skip List)
            const skippedNames = settingsCache.skippedNames || [];
            const recipientLower = (old.recipientName || "").toLowerCase();
            if ((old.status === "Wrong Recipient" || old.status === "Skipped Name") && skippedNames.some(name => recipientLower.includes(name.toLowerCase()))) {
                 effectiveStatus = "Skipped Name";
                 statusText = "🚫 SKIPPED (NAME)";
                 color = "#9ca3af";
            }

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
                    color: color,
                    statusText: statusText,
                    foundAmt: old.amount || "0",
                    timeStr: getTimeAgo(old.timestamp, old.dateVerified) || "N/A",
                    foundName: old.recipientName || "Previously Processed",
                    senderName: old.senderName || "-",
                    senderPhone: old.senderPhone || "-",
                    repeatCount: old.repeatCount,
                    id: extractedId || old.id || "N/A",
                    processedBy: old.processedBy || (auth.currentUser ? auth.currentUser.email : "System")
                },
                extractedId,
                imgUrl: src
            }).catch(() => {});
            reportOutcome(true); // Repeat is a successful system operation
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
        reportOutcome(false);
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
        reportOutcome(false);
        return;
    }

      // CHECK FOR 404 / INVALID ID (Bank returned page but no data or "Not Found Page")
      if (!data.recipient) {
          const result = { // This is the verificationResult
              status: "Bank 404",
              color: "#f59e0b",
              statusText: "⚠️ BANK 404 (NOT FOUND)",
              foundAmt: "0",
              timeStr: "N/A",
              foundName: "Retry Required",
              senderName: "-",
              senderPhone: "-",
              repeatCount: 0,
              id: extractedId,
              processedBy: auth.currentUser ? auth.currentUser.email : "System"
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
          reportOutcome(false);
          return;
      }

      // CHECK FOR SKIPPED NAMES (Recipient)
      const skippedNames = settingsCache.skippedNames || [];
      const recipientLower = data.recipient.toLowerCase();
      if (skippedNames.some(name => recipientLower.includes(name.toLowerCase()))) {
          const result = {
              status: "Skipped Name",
              color: "#9ca3af", // Grey
              statusText: "🚫 SKIPPED (NAME)",
              foundAmt: amount,
              timeStr: "N/A",
              foundName: data.recipient,
              senderName: data.senderName,
              senderPhone: data.senderPhone,
              repeatCount: 0,
              id: extractedId,
              processedBy: auth.currentUser ? auth.currentUser.email : "System"
          };
          await logTransactionResult(extractedId, result, old);

          chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId: rowId,
            success: true,
            data: result,
            extractedId: extractedId,
            imgUrl: src
          }).catch(() => {});
          reportOutcome(true); // Treated as a handled outcome (not a system error)
          return;
      }

      const maxHours = settingsCache.maxReceiptAge || 0.5;
      const result = verifyTransactionData(data, amount, settingsCache.targetName, maxHours);
      
      if (parseFloat(String(result.foundAmt).replace(/,/g, '')) < 50) {
          result.status = "Under 50";
          result.color = "#ef4444";
          result.statusText = "❌ UNDER 50 ETB";
      }

      if (result.status.startsWith("AA")) result.color = "#3b82f6";

      await logTransactionResult(extractedId, result, old);

      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId: rowId,
        success: true,
        data: { ...result, repeatCount: 0, id: extractedId, processedBy: auth.currentUser ? auth.currentUser.email : "System" },
        extractedId: extractedId,
        imgUrl: src
      }).catch(() => {});
      reportOutcome(true); // Success

  } catch (err) {
    chrome.tabs.sendMessage(tabId, { 
      action: "integrationResult", 
      rowId, 
      success: false, 
      error: err.message,
      imgUrl: src
    }).catch(() => {});
    reportOutcome(false);
  }
}

export async function handleMultiIntegrationVerify(request, tabId) {
    const { images, amount, rowId, primaryUrl } = request;
    reportActivity(); // Notify watchdog

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
            updateStatus(`Scanning  (Enhanced)...`);
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
                updateStatus(`Retry  (Clean)...`);
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
                break;
            }
            
            if (finalId === "SERVICE_ERROR") {
                errors.push(`Image ${i + 1}: AI Service Error`);
                break;
            }
            
            if (finalId && finalId !== "ERROR" && finalId.trim() !== "") {
                // Deduplicate
                if (processedIds.has(finalId)) continue;
                processedIds.add(finalId);

                // Match Bank
                const matchedBank = banks.find(b => finalId.length === parseInt(b.length) && b.prefixes.some(prefix => finalId.startsWith(prefix)));
                if (!matchedBank) {
                    errors.push(`ID ${finalId}: No Matching Bank`);
                    // Treat invalid format as skip, without logging
                    continue;
                }

                // Check DB for duplicates
                let old = null;
                try {
                    old = await getTransaction(finalId);
                } catch (e) {
                    if (e.message === "OFFLINE") {
                        chrome.tabs.sendMessage(tabId, {
                            action: "integrationResult",
                            rowId,
                            success: true,
                            data: {
                                status: "Offline",
                                color: "#64748b",
                                statusText: "⚠️ OFFLINE",
                                foundAmt: "0",
                                timeStr: "N/A",
                                foundName: "Check Connection",
                                senderName: "-",
                                senderPhone: "-"
                            },
                            extractedId: finalId,
                            imgUrl: primaryUrl
                        }).catch(() => {});
                        return;
                    }
                    console.error(e);
                }

                if (old) {
                    const isIncomplete = !old.senderName || !old.bankDate;
                    if (!isIncomplete) {
                        // It's a complete repeat. Log and continue.
                        old.repeatCount = (old.repeatCount || 0) + 1;
                        old.lastRepeat = Date.now();

                        // Check for Skipped Name override on Repeat
                        const skippedNames = settingsCache.skippedNames || [];
                        const recipientLower = (old.recipientName || "").toLowerCase();
                        if ((old.status === "Wrong Recipient" || old.status === "Skipped Name") && skippedNames.some(name => recipientLower.includes(name.toLowerCase()))) {
                             errors.push(`ID ${finalId}: Skipped (Name)`);
                             if (!failedTransaction) {
                                 failedTransaction = {
                                     amount: old.amount,
                                     timeStr: "N/A",
                                     recipientName: old.recipientName,
                                     senderName: old.senderName,
                                     senderPhone: old.senderPhone,
                                     status: "Skipped Name",
                                     statusText: "🚫 SKIPPED (NAME)",
                                     id: finalId,
                                     existingTx: old,
                                     bankDate: old.bankDate
                                 };
                             }
                             continue;
                        }

                        await logTransactionResult(finalId, { status: "Repeat", foundAmt: old.amount }, old);
                        errors.push(`ID : Duplicate / Repeat`);
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
                    errors.push(`ID ${finalId}: Bank 404`);
                    continue;
                }

                // Check Skipped Names (Recipient)
                const skippedNames = settingsCache.skippedNames || [];
                const recipientLower = data.recipient.toLowerCase();
                if (skippedNames.some(name => recipientLower.includes(name.toLowerCase()))) {
                     errors.push(`ID ${finalId}: Skipped (Name)`);
                     if (!failedTransaction) {
                         failedTransaction = {
                             amount: 0,
                             timeStr: "N/A",
                             recipientName: data.recipient,
                             senderName: data.senderName,
                             senderPhone: data.senderPhone,
                             status: "Skipped Name",
                             statusText: "🚫 SKIPPED (NAME)",
                             id: finalId,
                             existingTx: old,
                             bankDate: data.date
                         };
                     }
                     continue;
                }

                // Verify Data (Pass 0 as amount to just check validity of Name/Date)
                const check = verifyTransactionData(data, 0, settingsCache.targetName, settingsCache.maxReceiptAge);
                
                const numericAmt = parseFloat(String(check.foundAmt).replace(/,/g, ''));

                if (numericAmt < 50) {
                     errors.push(`ID ${finalId}: Under 50`);
                     if (!failedTransaction) {
                         failedTransaction = {
                             amount: numericAmt,
                             timeStr: check.timeStr,
                             recipientName: check.foundName,
                             senderName: check.senderName,
                             senderPhone: check.senderPhone,
                             status: "Under 50",
                             statusText: "❌ UNDER 50 ETB",
                             id: finalId,
                             existingTx: old,
                             bankDate: check.bankDate
                         };
                     }
                     continue;
                }
                
                if (!check.nameOk || !check.timeOk) {
                     errors.push(`ID : ${check.status}`);
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
                     validTransactions.push({ id: finalId, amount: numericAmt, data: data, timeStr: check.timeStr, existingTx: old });
                     totalFoundAmount += numericAmt;
                     
                     lastSenderName = data.senderName;
                     lastSenderPhone = data.senderPhone;
                     lastRecipientName = data.recipient;
                     lastTimeStr = check.timeStr;

                     // Optimization: Stop processing if we have found the full amount
                     if (totalFoundAmount >= amount) break;
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
        const isServiceError = errors.some(e => e.includes("Service Error"));
        
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
        } else if (isServiceError) {
            finalStatus = "AI Error";
            finalColor = "#ef4444";
            statusText = "❌ AI SERVICE ERROR";
        } else if (duplicateTransaction) {
            // Already logged in the loop. Just setting UI variables.
            finalStatus = "Repeat";
            finalColor = "#f59e0b";
            statusText = "🔁 DUPLICATE / REPEAT";
            
            foundAmt = duplicateTransaction.amount || "0";
            timeStr = getTimeAgo(duplicateTransaction.timestamp, duplicateTransaction.dateVerified) || "N/A";
            foundName = duplicateTransaction.recipientName || "Previously Processed";
            senderName = duplicateTransaction.senderName || "-";
            senderPhone = duplicateTransaction.senderPhone || "-";
            originalStatus = duplicateTransaction.status;
            extractedId = duplicateTransaction.id || "N/A";
        } else if (failedTransaction) {
            // This is a specific failure (e.g. Old Receipt) that needs to be logged.
            const failureResult = {
                status: failedTransaction.status,
                foundAmt: failedTransaction.amount,
                senderName: failedTransaction.senderName,
                bankCheckResult: failedTransaction.bankCheckResult,
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
            else if (finalStatus === "Skipped Name") finalColor = "#9ca3af";
            else finalColor = "#f44336";
            
            foundAmt = failedTransaction.amount;
            timeStr = failedTransaction.timeStr;
            foundName = failedTransaction.recipientName;
            senderName = failedTransaction.senderName;
            senderPhone = failedTransaction.senderPhone;
            extractedId = failedTransaction.id;
        } else if (isLoadError) {
            finalStatus = "Image Load Failed"; // Treat load error as retryable
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
                } else if (errType.includes("Bank 404")) {
                    finalStatus = "Bank 404";
                    finalColor = "#f59e0b";
                    statusText = "⚠️ BANK 404 (NOT FOUND)";
                } else if (errType.includes("Skipped (Name)")) {
                    finalStatus = "Skipped Name";
                    finalColor = "#9ca3af";
                    statusText = "🚫 SKIPPED (NAME)";
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
                repeatCount: maxRepeatCount,
                id: extractedId,
                processedBy: auth.currentUser ? auth.currentUser.email : "System"
            },
            extractedId: extractedId,
            imgUrl: primaryUrl
        }).catch(() => {});
        reportOutcome(false); // No valid transactions found in batch
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

    if (Math.abs(totalFoundAmount - parseFloat(amount)) > 0.01) {
        finalStatus = `AA is ${totalFoundAmount}`;
        color = "#3b82f6";
        statusText = `⚠️ TOTAL: ${totalFoundAmount}/${amount}`;
    }

    chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId,
        success: true,
        data: { 
            status: finalStatus, 
            color: color, 
            statusText: statusText, 
            foundAmt: totalFoundAmount, 
            timeStr: lastTimeStr, 
            foundName: lastRecipientName, 
            senderName: lastSenderName, 
            senderPhone: lastSenderPhone, 
            repeatCount: 0,
            id: validTransactions.map(t => t.id).join(', '),
            processedBy: auth.currentUser ? auth.currentUser.email : "System"
        },
        extractedId: validTransactions.map(t => t.id).join(', '),
        imgUrl: primaryUrl
    }).catch(() => {});
    reportOutcome(true); // Success
}
