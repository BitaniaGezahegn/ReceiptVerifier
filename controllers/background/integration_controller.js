import { DEFAULT_BANKS } from '../../config.js';
import { settingsCache } from '../../services/settings_service.js';
import { callAIVisionWithRetry } from '../../services/ai_service.js';
import { logTransactionResult } from '../../services/storage_service.js';
import { verifyViaSms } from '../../services/sms_verification_service.js';
import { getMimeTypeFromDataUrl } from '../../utils/helpers.js';
import { auth } from '../../services/firebase_config.js';

export async function handleIntegrationVerify(request, tabId) {
  const { src, amount, rowId, dataUrl, portalId, customerPhone } = request;
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
        await logTransactionResult(pdfKey, verificationResult, null, "PDF", portalId);

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

        if (!extractedId || extractedId === "ERROR" || extractedId.trim() === "" || !/^[A-Z0-9]+$/i.test(extractedId)) {
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random",
          foundAmt: amount,
      };
      await logTransactionResult(randomKey, verificationResult, null, "ERROR", portalId);
      
      chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId,
        success: true,
        data: {
          status: "Random",
          color: "#ef4444",
          statusText: "❌ RANDOM",
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

    updateStatus("Checking SMS Vault...");
    const banks = settingsCache.banks || DEFAULT_BANKS;
    const matchedBank = banks.find(b => extractedId.length === parseInt(b.length) && b.prefixes.some(prefix => extractedId.startsWith(prefix)));
    const isKaffiId = matchedBank && matchedBank.name === "Kaafi";

    if (!matchedBank) {
      updateStatus("Invalid ID Format...");
      const randomKey = `RANDOM_${Date.now()}`;
      const verificationResult = {
          status: "Random",
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
          statusText: "❌ RANDOM",
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

    const { found, result, originalId } = await verifyViaSms(extractedId, amount, customerPhone, portalId, isKaffiId);

    chrome.tabs.sendMessage(tabId, {
        action: "integrationResult",
        rowId: rowId,
        success: true,
        data: result,
        extractedId: originalId,
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
    const { images, amount, rowId, primaryUrl, portalId, customerPhone } = request;
    const updateStatus = (msg) => chrome.tabs.sendMessage(tabId, { action: "updateStatus", message: msg, rowId }).catch(() => {});

    if (images.length > 1) updateStatus(`Processing ${images.length} Image(s)...`);
    
    let validTransactions = [];
    let processedIds = new Set();
    let totalFoundAmount = 0;
    let errors = [];
    let lastBankName = "Other";

    let lastSenderName = "-";
    let lastSenderPhone = "-";
    let lastRecipientName = "N/A";
    let lastTimeStr = "N/A";
    let maxRepeatCount = 0;
    let duplicateTransaction = null;
    let failedTransaction = null;

    const banks = settingsCache.banks || DEFAULT_BANKS;

    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        let mimeType = 'image/jpeg';
        
        try {
            let finalId = null;

            updateStatus(`Scanning  (Enhanced)...`);
            let enhancedBase64 = null;
                
            if (img.enhancedDataUrl) {
                enhancedBase64 = img.enhancedDataUrl.split(',')[1] || img.enhancedDataUrl;
            } else if (img.dataUrl) {
                enhancedBase64 = await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'processImage', dataUrl: img.dataUrl }, response => {
                        resolve(response?.base64);
                    });
                });
            }

            if (enhancedBase64) finalId = await callAIVisionWithRetry(enhancedBase64, 'image/jpeg');

            if (!finalId || finalId === "ERROR") {
                updateStatus(`Retry  (Clean)...`);
                let cleanBase64 = null;
                
                if (img.cleanDataUrl) {
                    cleanBase64 = img.cleanDataUrl.split(',')[1] || img.cleanDataUrl;
                } else if (img.dataUrl) {
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
                if (processedIds.has(finalId)) continue;
                processedIds.add(finalId);

                const matchedBank = banks.find(b => finalId.length === parseInt(b.length) && b.prefixes.some(prefix => finalId.startsWith(prefix)));
                const isKaffiId = matchedBank && matchedBank.name === "Kaafi";

                if (!matchedBank) {
                    errors.push(`ID ${finalId}: No Matching Bank`);
                    continue;
                }

                const { found, result } = await verifyViaSms(finalId, amount, customerPhone, portalId, isKaffiId);

                if (found) {
                    validTransactions.push({ 
                        id: result.id, 
                        amount: result.foundAmt, 
                        data: result, 
                        timeStr: result.timeStr,
                    });
                    totalFoundAmount += result.foundAmt;
                    
                    lastSenderName = result.senderName;
                    lastSenderPhone = result.senderPhone;
                    lastRecipientName = result.foundName;
                    lastTimeStr = result.timeStr;
                    lastBankName = result.bankName;

                    if (result.status === "Repeat") {
                        if (!duplicateTransaction) duplicateTransaction = result;
                    }

                    if (totalFoundAmount >= amount) break;
                } else {
                     errors.push(`ID ${finalId}: Not Found in SMS`);
                     if (!failedTransaction) {
                         failedTransaction = result;
                     }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    if (validTransactions.length === 0) {
        const isRateLimit = errors.some(e => e.includes("Rate Limit"));
        const isLoadError = errors.some(e => e.includes("Failed to load"));
        const isServiceError = errors.some(e => e.includes("Service Error"));
        
        let finalStatus = "Random";
        let finalColor = "#ef4444";
        let statusText = errors.length > 0 ? (isRateLimit ? "⚠️ " + errors[0] : "❌ " + errors[0]) : "❌ NO VALID ID FOUND";
        
        let foundAmt = "0";
        let timeStr = "N/A";
        let foundName = "N/A";
        let senderName = "-";
        let senderPhone = "-";
        let bankName = "Other";
        let extractedId = "ERROR";

        if (isRateLimit) {
            finalStatus = "API Limit";
            finalColor = "#f59e0b";
        } else if (isServiceError) {
            finalStatus = "AI Error";
            finalColor = "#ef4444";
            statusText = "❌ AI SERVICE ERROR";
        } else if (failedTransaction) {
            finalStatus = failedTransaction.status;
            statusText = failedTransaction.statusText;
            finalColor = failedTransaction.color;
            foundAmt = failedTransaction.foundAmt;
            timeStr = failedTransaction.timeStr;
            foundName = failedTransaction.foundName;
            senderName = failedTransaction.senderName;
            senderPhone = failedTransaction.senderPhone;
            bankName = failedTransaction.bankName || "Other";
            extractedId = failedTransaction.id;
        } else if (isLoadError) {
            finalStatus = "Image Load Failed"; 
            finalColor = "#ef4444";
            statusText = "❌ IMAGE LOAD FAILED";
        } else if (errors.length > 0) {
            finalStatus = "Random"; 
            finalColor = "#ef4444";
            statusText = "❌ RANDOM";

            const idMatch = errors[0].match(/^ID ([A-Z0-9]+): (.*)$/i);
            if (idMatch) {
                extractedId = idMatch[1];
                const errType = idMatch[2];
                if (errType.includes("Not Found")) {
                    finalStatus = "Wrong Recipient";
                    finalColor = "#ef4444";
                    statusText = "❌ WRONG RECIPIENT";
                }
            }
        } else {
            const randomKey = `RANDOM_${Date.now()}`;
            const originalId = processedIds.size > 0 ? Array.from(processedIds).join(', ') : "ERROR";
            const randomResult = { status: "Random", foundAmt: amount };
            await logTransactionResult(randomKey, randomResult, null, originalId, portalId);
            finalStatus = "Random";
        }

        chrome.tabs.sendMessage(tabId, {
            action: "integrationResult",
            rowId,
            success: true,
            data: {
                status: finalStatus,
                color: finalColor,
                statusText: statusText,
                foundAmt: foundAmt,
                timeStr: timeStr,
                foundName: foundName,
                senderName: senderName,
                senderPhone: senderPhone,
                repeatCount: maxRepeatCount,
                id: extractedId,
                processedBy: auth.currentUser ? auth.currentUser.email : "System",
                bankName: bankName
            },
            extractedId: extractedId,
            imgUrl: primaryUrl
        }).catch(() => {});
        return;
    }

    let finalStatus = "Verified";
    let color = "#10b981";
    let statusText = images.length > 1 ? "✅ VERIFIED (MULTI)" : "✅ VERIFIED";
    let finalRepeatCount = 0;

    const allRepeat = validTransactions.length > 0 && validTransactions.every(tx => tx.data.status === "Repeat");
    if (allRepeat) {
        finalStatus = "Repeat";
        color = "#f59e0b";
        statusText = "🔁 DUPLICATE / REPEAT";
        finalRepeatCount = Math.max(...validTransactions.map(tx => tx.data.repeatCount || 0));
    } else if (Math.abs(totalFoundAmount - parseFloat(amount)) > 0.01) {
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
            repeatCount: finalRepeatCount,
            id: validTransactions.map(t => t.id).join(', '),
            processedBy: auth.currentUser ? auth.currentUser.email : "System",
            bankName: lastBankName
        },
        extractedId: validTransactions.map(t => t.id).join(', '),
        imgUrl: primaryUrl
    }).catch(() => {});
}
