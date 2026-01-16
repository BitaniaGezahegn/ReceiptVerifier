// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\integration_controller.js
import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { getTransaction, logTransactionResult } from '../../services/storage_service.js';
import { verifyTransactionData } from '../../services/verification.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import { getMimeTypeFromDataUrl, getTimeAgo } from '../../utils/helpers.js';

export async function handleIntegrationVerify(request, tabId) {
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

export async function handleMultiIntegrationVerify(request, tabId) {
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
                continue;
            }
            
            if (finalId === "SERVICE_ERROR") {
                errors.push(`Image ${i + 1}: AI Service Error`);
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
                    // Treat bank 404 as Random/Unknown (likely invalid ID)
                    continue;
                }

                // Verify Data (Pass 0 as amount to just check validity of Name/Date)
                const check = verifyTransactionData(data, 0, settingsCache.targetName, settingsCache.maxReceiptAge);
                
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
        finalStatus = `AA `;
        color = "#3b82f6";
        statusText = `⚠️ TOTAL: /`;
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
