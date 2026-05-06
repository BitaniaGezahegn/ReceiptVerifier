// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\background\integration_controller.js
import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { getTransaction, logTransactionResult, getSmsEntryByFingerprint, getSmsEntryById, updateSmsEntry, getSmsEntryByClaimedId } from '../../services/storage_service.js';
import { verifyTransactionData } from '../../services/verification.js';
import { setupOffscreenDocument } from '../../services/offscreen_service.js';
import { getMimeTypeFromDataUrl, getTimeAgo } from '../../utils/helpers.js';
import { auth } from '../../services/firebase_config.js';

export async function handleIntegrationVerify(request, tabId) {
  const { src, amount, rowId, dataUrl, portalId, customerPhone } = request;
  console.log(`[Integration] handleIntegrationVerify called for rowId: ${rowId}, amount: ${amount}, customerPhone: ${customerPhone}, portalId: ${portalId}`);
  const updateStatus = (msg) => chrome.tabs.sendMessage(tabId, { action: "updateStatus", message: msg, rowId }).catch(() => {});
  
  let extractedId = null;

  try {
    if (!dataUrl) throw new Error("Failed to load image");

    console.log(`[Integration] Processing image from src: ${src}`);
    // Check if it's a PDF by MIME type OR file extension
    const isPdf = dataUrl.startsWith("data:application/pdf") || (src && src.toLowerCase().split('?')[0].endsWith('.pdf'));

    if (isPdf) {
        const pdfKey = `PDF_${Date.now()}`;
        const verificationResult = {
            status: "PDF",
            foundAmt: amount,
        };
        await logTransactionResult(pdfKey, verificationResult, null, "PDF", portalId);

        console.log(`[Integration] PDF detected for rowId: ${rowId}. Skipping AI scan.`);
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
                console.log(`[Integration] Sending image to offscreen document for enhancement (rowId: ${rowId}).`);
                chrome.runtime.sendMessage({ action: 'processImage', dataUrl }, (response) => {
                    resolve(response?.base64);
                });
            });

        if (enhancedBase64) {
        extractedId = await callAIVisionWithRetry(enhancedBase64, 'image/jpeg');
        console.log(`[Integration] AI Vision (Enhanced) result for rowId ${rowId}: ${extractedId}`);
        }

        // 2. Fallback to Raw Image
        if (!extractedId || extractedId === "ERROR") {
            console.log(`[Integration] AI Vision (Enhanced) failed or returned ERROR for rowId ${rowId}. Falling back to Raw Image.`);
            updateStatus("Retry (Raw Image)...");
            let rawBase64 = dataUrl.split(',')[1];
        let mimeType = getMimeTypeFromDataUrl(dataUrl);
        extractedId = await callAIVisionWithRetry(rawBase64, mimeType);
        }
    }

    if (extractedId === "RATE_LIMIT") {
        console.warn(`[Integration] AI Rate Limit reached for rowId: ${rowId}`);
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
        console.error(`[Integration] AI Service Error for rowId: ${rowId}`);
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

    if (!extractedId || extractedId === "ERROR" || extractedId.trim() === "" || !/^[A-Z0-9]+$/i.test(extractedId)) {
      console.warn(`[Integration] Invalid or no ID extracted by AI for rowId: ${rowId}. Extracted: "${extractedId}"`);
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random",
          foundAmt: amount, // Log the expected amount as there's no found amount
      };
      await logTransactionResult(randomKey, verificationResult, null, "ERROR", portalId);
      
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
    
    const matchedBank = banks.find(b => extractedId.length === parseInt(b.length) && b.prefixes.some(prefix => extractedId.startsWith(prefix)));
    
    if (!matchedBank) {
      console.warn(`[Integration] Extracted ID "${extractedId}" for rowId ${rowId} did not match any configured bank formats.`);
      updateStatus("Invalid ID..."); // Only show if it actually fails
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random", // Treat as Random if bank format is wrong
          foundAmt: amount,
          bankCheckResult: "No Matching Bank"
      };
      await logTransactionResult(randomKey, verificationResult, null, extractedId, portalId);
      
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

    // --- NEW SMS VAULT CHECK ---
    let smsEntry = null;
    let isDirectMatch = false;
    if (settingsCache.smsCheckEnabled) {
        console.log(`[Integration] Starting SMS Vault check for ${extractedId}`);
        updateStatus("Checking SMS Vault...");

        // 1. Try Direct ID Match (Best for Kaffi-to-Kaffi)
        smsEntry = await getSmsEntryById(extractedId);
        if (smsEntry) isDirectMatch = true;

        // 2. Fallback to Claimed ID (Check if this ID already processed an SMS)
        if (!smsEntry) {
            smsEntry = await getSmsEntryByClaimedId(extractedId);
        }

        // 3. Fallback to Fingerprint Match (New match for Coop/Wegagen)
        if (!smsEntry && customerPhone && amount) {
            smsEntry = await getSmsEntryByFingerprint(customerPhone, amount);
        }

        if (smsEntry) {
            // SMS match found!
            let status = "Verified";
            let color = "#10b981";
            let statusText = "✅ VERIFIED (SMS)";
            let repeatCount = smsEntry.verificationCount || 0;

            if (repeatCount > 0) {
                status = "Repeat";
                color = "#f59e0b";
                statusText = "🔁 DUPLICATE / REPEAT (SMS)";
            }

            console.log(`[Integration] SMS Match found for ${smsEntry.id}. Status: ${status}. Updating SMS entry.`);
            // Update the SMS entry in Firestore
            await updateSmsEntry(smsEntry.id, {
                verificationCount: (smsEntry.verificationCount || 0) + 1,
                claimedByScreenshotId: extractedId,
                status: status === "Verified" ? "verified" : "duplicate",
                dateVerified: new Date().toLocaleString(),
                processedBy: auth.currentUser.email,
                processedByUid: auth.currentUser.uid,
            });

            // Log the transaction result using SMS data
            const verificationResult = {
                status: status,
                foundAmt: smsEntry.amount,
                senderName: smsEntry.senderName,
                senderPhone: smsEntry.senderPhone,
                foundName: smsEntry.recipientBank || "KAAFI", // Use bank as fallback for name
                bankDate: smsEntry.transactionTimestamp ? new Date(smsEntry.transactionTimestamp.toDate()).toLocaleString() : "N/A", // Keep original format
                timeStr: getTimeAgo(smsEntry.transactionTimestamp ? smsEntry.transactionTimestamp.toDate().getTime() : Date.now()),
                repeatCount: repeatCount,
                telegramMessageId: smsEntry.telegramMessageId,
                bankName: isDirectMatch ? "Kaffi" : "Other"
            };
            console.log(`[Integration] Logging transaction result for SMS entry ${smsEntry.id}:`, verificationResult);
            await logTransactionResult(smsEntry.id, verificationResult, null, extractedId, portalId);

            chrome.tabs.sendMessage(tabId, {
                action: "integrationResult",
                rowId: rowId,
                success: true,
                data: { ...verificationResult, color, statusText, id: smsEntry.id, processedBy: auth.currentUser.email },
                extractedId: extractedId,
                imgUrl: src
            }).catch(() => {});
            console.log(`[Integration] SMS verification complete for rowId: ${rowId}.`);
            return; // SMS match handled, skip bank check
        }
    }

    if (!settingsCache.bankCheckEnabled) {
        console.log(`[Integration] No SMS match and Bank check disabled. Skipping ${extractedId}`);
        chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId: rowId,
            success: true,
            data: { status: "No Match", color: "#64748b", statusText: "⚠️ SMS MATCH REQUIRED", foundAmt: amount, timeStr: "N/A", foundName: "N/A", senderName: "-", senderPhone: "-", repeatCount: 0 },
            extractedId, imgUrl: src
        }).catch(() => {});
        return;
    }
    // --- END NEW SMS VAULT CHECK ---
    
    updateStatus("Checking Database...");
    let old;
    try {
        old = await getTransaction(extractedId);
    } catch (e) { /* Error handling... */ }

    if (old) {
        const isIncomplete = !old.senderName || !old.bankDate;
        console.log(`[Integration] Existing transaction found for ${extractedId}. Incomplete: ${isIncomplete}`);
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
            console.log(`[Integration] Logging repeat transaction for ${extractedId}:`, repeatResult);
            await logTransactionResult(extractedId, repeatResult, old, null, portalId);

            chrome.tabs.sendMessage(tabId, {
                action: "integrationResult",
                rowId,
                success: true,
                data: {
                    status: effectiveStatus,
                    originalStatus: old.status,
                    color: "#f59e0b",
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
            return;
        }
        // If incomplete, fall through to re-fetch.
    }

    updateStatus("Checking Bank...");
    // Offscreen document is already setup at start of function
    
    console.log(`[Integration] Sending request to bank for extractedId: ${extractedId} via URL: ${matchedBank.url + extractedId}`);
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
          error: `Bank Check Failed: ${err.message}`,
          rowId, 
          success: false, 
          error: err.message,
          imgUrl: src
        }).catch(() => {});
        return;
    }

    if (!data || data.error) {
        console.error(`[Integration] Bank data fetch failed for ${extractedId}. Error: ${data?.error || "Unknown"}`);
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
          console.warn(`[Integration] Bank returned 404 for ${extractedId}.`);
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
          await logTransactionResult(extractedId, { ...result, foundAmt: 0 }, old, null, portalId);

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
      console.log(`[Integration] Verifying transaction data for ${extractedId}. Expected Amount: ${amount}, Target Name: ${settingsCache.targetName}, Max Age: ${maxHours} hours.`);
      const result = verifyTransactionData(data, amount, settingsCache.targetName, maxHours);
      
      if (parseFloat(String(result.foundAmt).replace(/,/g, '')) < 50) {
          result.status = "Under 50";
          console.warn(`[Integration] Transaction ${extractedId} is under 50 ETB.`);
          result.color = "#ef4444";
          result.statusText = "❌ UNDER 50 ETB";
      }

      if (result.status.startsWith("AA")) result.color = "#3b82f6";

      await logTransactionResult(extractedId, result, old, null, portalId);
      console.log(`[Integration] Bank verification complete for rowId: ${rowId}. Result:`, result);

      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId: rowId,
        success: true,
        data: { ...result, repeatCount: 0, id: extractedId, processedBy: auth.currentUser ? auth.currentUser.email : "System" },
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
    console.log(`[Integration] handleMultiIntegrationVerify called for rowId: ${request.rowId}, amount: ${request.amount}, customerPhone: ${request.customerPhone}`);
    const { images, amount, rowId, primaryUrl, portalId, customerPhone } = request;
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
    let lastBankName = "Other";
    let lastTelegramMessageId = null;
    let maxRepeatCount = 0;
    let duplicateTransaction = null;
    let failedTransaction = null;

    await setupOffscreenDocument();
    const banks = settingsCache.banks || DEFAULT_BANKS;

    // 1. Extract & Verify IDs
    for (let i = 0; i < images.length; i++) {
        console.log(`[Integration] Processing image ${i + 1}/${images.length} for multi-integration.`);
        const img = images[i];
        const statusPrefix = images.length > 1 ? `Image ${i + 1}/${images.length}` : `Image`;
        let mimeType = 'image/jpeg';
        
        try {
            let finalId = null;

            // 1. Try Enhanced Image First
            updateStatus(`Scanning  (Enhanced)...`);
            console.log(`[Integration] Image ${i+1}: Sending to offscreen for enhancement.`);
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
            console.log(`[Integration] Image ${i+1}: AI Vision (Enhanced) result: ${finalId}`);

            // 2. Fallback to Clean/Raw Image
            if (!finalId || finalId === "ERROR") {
                console.log(`[Integration] Image ${i+1}: AI Vision (Enhanced) failed or returned ERROR. Falling back to Clean/Raw.`);
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

                // --- NEW SMS VAULT CHECK FOR MULTI-INTEGRATION ---
                let smsEntry = null;
                let isDirectMatch = false;
                if (settingsCache.smsCheckEnabled) {
                    console.log(`[Multi-Integration] Image ${i+1}: Checking SMS Vault for ${finalId}`);
                    smsEntry = await getSmsEntryById(finalId);
                    if (smsEntry) isDirectMatch = true;

                    if (!smsEntry) {
                        smsEntry = await getSmsEntryByClaimedId(finalId);
                    }

                    if (!smsEntry && customerPhone && amount) {
                        smsEntry = await getSmsEntryByFingerprint(customerPhone, amount);
                    }

                    if (smsEntry) {
                        console.log(`[Multi-Integration] Image ${i+1}: SMS Match Found (${smsEntry.id})`);
                        let smsMatchHandled = true;
                        const isRepeat = smsEntry.status !== "pending";

                        let status = isRepeat ? "Repeat" : "Verified";
                        let statusText = isRepeat ? "🔁 DUPLICATE / REPEAT (SMS)" : "✅ VERIFIED (SMS)";
                        let repeatCount = smsEntry.verificationCount || 0;

                        await updateSmsEntry(smsEntry.id, {
                            verificationCount: repeatCount + 1,
                            claimedByScreenshotId: finalId,
                            status: status === "Verified" ? "verified" : "duplicate",
                            dateVerified: new Date().toLocaleString(),
                            processedBy: auth.currentUser.email,
                            processedByUid: auth.currentUser.uid,
                        });

                        const verificationResult = {
                            status: status,
                            foundAmt: smsEntry.amount,
                            senderName: smsEntry.senderName,
                            senderPhone: smsEntry.senderPhone,
                            foundName: smsEntry.recipientBank || "KAAFI", // Use bank as fallback for name
                            bankDate: smsEntry.transactionTimestamp ? new Date(smsEntry.transactionTimestamp.toDate()).toLocaleString() : "N/A",
                            timeStr: smsEntry.transactionTimestamp ? 
                                getTimeAgo(smsEntry.transactionTimestamp.toDate().getTime()) : "Just now",
                            repeatCount: repeatCount,
                            color: status === "Verified" ? "#10b981" : "#f59e0b",
                            statusText: statusText,
                            bankName: isDirectMatch ? "Kaffi" : "Other",
                            telegramMessageId: smsEntry.telegramMessageId
                        };

                        if (isRepeat) {
                            console.log(`[Multi-Integration] Image ${i+1}: SMS is a repeat. Logging and skipping tally.`);
                            await logTransactionResult(smsEntry.id, verificationResult, null, finalId, portalId);
                            maxRepeatCount = Math.max(maxRepeatCount, repeatCount + 1);
                            if (!duplicateTransaction) {
                                duplicateTransaction = {
                                    id: smsEntry.id,
                                    amount: smsEntry.amount,
                                    timestamp: smsEntry.transactionTimestamp ? smsEntry.transactionTimestamp.toDate().getTime() : Date.now(),
                                    dateVerified: smsEntry.dateVerified,
                                    recipientName: smsEntry.recipientBank || "KAAFI",
                                    senderName: smsEntry.senderName,
                                    senderPhone: smsEntry.senderPhone,
                                    status: "Verified",
                                    bankName: isDirectMatch ? "Kaffi" : "Other",
                                    telegramMessageId: smsEntry.telegramMessageId
                                };
                            }
                            errors.push(`ID ${finalId}: Duplicate / Repeat (SMS)`);
                        } else {
                            validTransactions.push({ id: smsEntry.id, amount: smsEntry.amount, data: verificationResult, timeStr: verificationResult.timeStr, existingTx: null, isSms: true });
                            totalFoundAmount += smsEntry.amount;
                            
                            lastSenderName = smsEntry.senderName;
                            lastSenderPhone = smsEntry.senderPhone;
                            lastRecipientName = smsEntry.recipientBank || "KAAFI";
                            lastTimeStr = verificationResult.timeStr;
                            lastBankName = isDirectMatch ? "Kaffi" : "Other";
                            lastTelegramMessageId = smsEntry.telegramMessageId;
                        }

                        if (smsMatchHandled) continue; 
                    }
                }

                if (!settingsCache.bankCheckEnabled) {
                    console.log(`[Multi-Integration] Image ${i+1}: No SMS match and Bank check disabled. Skipping.`);
                    errors.push(`ID ${finalId}: SMS Match Required`);
                    continue;
                }
                // --- END NEW SMS VAULT CHECK FOR MULTI-INTEGRATION ---

                // Check DB for duplicates
                let old = null;
                try {
                    console.log(`[Multi-Integration] Image ${i+1}: Checking legacy database for ${finalId}`);
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
                    console.log(`[Multi-Integration] Image ${i+1}: Existing transaction found for ${finalId}. Incomplete: ${isIncomplete}`);
                    if (!isIncomplete) {
                        // It's a complete repeat. Log and continue.
                        old.repeatCount = (old.repeatCount || 0) + 1;
                        old.lastRepeat = Date.now();
                        await logTransactionResult(finalId, { status: "Repeat", foundAmt: old.amount }, old, null, portalId);
                        console.log(`[Multi-Integration] Image ${i+1}: Duplicate/Repeat transaction for ${finalId}.`);
                        errors.push(`ID : Duplicate / Repeat`);
                        maxRepeatCount = Math.max(maxRepeatCount, old.repeatCount);
                        if (!duplicateTransaction) duplicateTransaction = old;
                        continue;
                    }
                    // If incomplete, fall through to bank fetch logic.
                }

                // Fetch Bank Data
                const data = await new Promise((resolve) => {
                    console.log(`[Multi-Integration] Image ${i+1}: Sending request to bank for ${finalId} via URL: ${matchedBank.url + finalId}`);
                    const timeoutId = setTimeout(() => resolve(null), 20000);
                    chrome.runtime.sendMessage({ action: 'parseReceipt', url: matchedBank.url + finalId }, (response) => {
                        clearTimeout(timeoutId);
                        resolve(response && !response.error ? response : null);
                    });
                });

                if (!data || !data.recipient) {
                    console.warn(`[Multi-Integration] Image ${i+1}: Bank returned 404 or no recipient for ${finalId}.`);
                    errors.push(`ID ${finalId}: Bank 404`);
                    continue;
                }

                console.log(`[Multi-Integration] Image ${i+1}: Verifying transaction data for ${finalId}.`);
                // Verify Data (Pass 0 as amount to just check validity of Name/Date)
                const check = verifyTransactionData(data, 0, settingsCache.targetName, settingsCache.maxReceiptAge);
                
                const numericAmt = parseFloat(String(check.foundAmt).replace(/,/g, ''));

                if (numericAmt < 50) {
                     errors.push(`ID ${finalId}: Under 50`);
                     console.warn(`[Multi-Integration] Image ${i+1}: Transaction ${finalId} is under 50 ETB.`);
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
                     console.warn(`[Multi-Integration] Image ${i+1}: Transaction ${finalId} failed name/time check. Status: ${check.status}`);
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
                     console.log(`[Multi-Integration] Image ${i+1}: Valid transaction found for ${finalId}. Amount: ${numericAmt}`);
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
        console.log(`[Multi-Integration] No valid transactions found for rowId: ${rowId}. Handling errors.`);
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
            console.log(`[Multi-Integration] Duplicate transaction detected for rowId: ${rowId}.`);
            // Already logged in the loop. Just setting UI variables.
            finalStatus = "Repeat";
            finalColor = "#f59e0b";
            statusText = "🔁 DUPLICATE / REPEAT";
            
            foundAmt = duplicateTransaction.amount || "0";
            timeStr = getTimeAgo(duplicateTransaction.timestamp, duplicateTransaction.dateVerified) || "N/A";
            foundName = duplicateTransaction.recipientName || "Previously Processed";
            senderName = duplicateTransaction.senderName || "-";
            senderPhone = duplicateTransaction.senderPhone || "-";
            var telegramMessageId = duplicateTransaction.telegramMessageId;
            var bankName = duplicateTransaction.bankName || "Other";
            originalStatus = duplicateTransaction.status;
            extractedId = duplicateTransaction.id || "N/A";
        } else if (failedTransaction) {
            console.log(`[Multi-Integration] Failed transaction detected for rowId: ${rowId}. Status: ${failedTransaction.status}`);
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
            console.log(`[Multi-Integration] Logging failed transaction for ${failedTransaction.id}:`, failureResult);
            await logTransactionResult(failedTransaction.id, failureResult, failedTransaction.existingTx, null, portalId);

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
            console.warn(`[Multi-Integration] Image load failed for rowId: ${rowId}.`);
            finalStatus = "Image Load Failed"; // Treat load error as retryable
            finalColor = "#ef4444";
            statusText = "❌ IMAGE LOAD FAILED";
            // Do NOT log to DB for technical load errors
        } else if (errors.length > 0) {
            finalStatus = "Random"; // Treat other errors as Random to prevent auto-reject
            finalColor = "#ef4444";
            console.warn(`[Multi-Integration] Other errors for rowId: ${rowId}. First error: ${errors[0]}`);
            statusText = `❌ ${errors[0]}`;

            // FALLBACK FIX: Extract ID from error string if failedTransaction was missed
            const idMatch = errors[0].match(/^ID ([A-Z0-9]+): (.*)$/i);
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
                }
            }
        } else {
            // This is a "Random" case where no valid ID was found or matched.
            console.warn(`[Multi-Integration] No valid ID found or matched for rowId: ${rowId}. Marking as Random.`);
            const randomKey = `RANDOM_${Date.now()}`;
            const originalId = processedIds.size > 0 ? Array.from(processedIds).join(', ') : "ERROR";
            const randomResult = {
                status: "Random",
                foundAmt: amount,
            };
            await logTransactionResult(randomKey, randomResult, null, originalId, portalId);
            console.log(`[Multi-Integration] Logging random transaction for ${randomKey}.`);
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
                telegramMessageId: telegramMessageId,
                bankName: bankName,
                id: extractedId,
                processedBy: auth.currentUser ? auth.currentUser.email : "System"
            },
            extractedId: extractedId,
            imgUrl: primaryUrl
        }).catch(() => {});
        return;
    }

    // 3. Save Valid Transactions & Determine Status
    console.log(`[Multi-Integration] Saving ${validTransactions.length} valid transactions for rowId: ${rowId}.`);
    for (const tx of validTransactions) {
        let verificationResult;
        if (tx.isSms) {
            // Keep the pre-built SMS result
            verificationResult = tx.data;
        } else {
            // Build standard bank result
            verificationResult = { 
                status: "Verified", foundAmt: tx.amount, senderName: tx.data.senderName, 
                senderPhone: tx.data.senderPhone, foundName: tx.data.recipient, 
                timeStr: tx.timeStr, bankDate: tx.data.date 
            };
        }
        await logTransactionResult(tx.id, verificationResult, tx.existingTx, null, portalId);
    }

    let finalStatus = "Verified";
    let color = "#10b981";
    let statusText = images.length > 1 ? "✅ VERIFIED (MULTI)" : "✅ VERIFIED";

    if (Math.abs(totalFoundAmount - parseFloat(amount)) > 0.01) {
        finalStatus = `AA is ${totalFoundAmount}`;
        console.warn(`[Multi-Integration] Amount mismatch for rowId: ${rowId}. Total found: ${totalFoundAmount}, Expected: ${amount}`);
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
            bankName: lastBankName,
            telegramMessageId: lastTelegramMessageId,
            repeatCount: 0,
            id: validTransactions.map(t => t.id).join(', '),
            processedBy: auth.currentUser ? auth.currentUser.email : "System"
        },
        extractedId: validTransactions.map(t => t.id).join(', '),
        imgUrl: primaryUrl
    }).catch(() => {});
    console.log(`[Multi-Integration] Multi-integration verification complete for rowId: ${rowId}. Final Status: ${finalStatus}`);
}
