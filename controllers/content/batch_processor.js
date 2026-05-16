// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\content\batch_processor.js
import { SELECTORS, TIMEOUT_MS, MAX_CONCURRENCY, SPEED_CONFIG } from '../../utils/constants.js';
import { safeClick } from '../../utils/helpers.js';
import { showNotification, startCooldownTimer, hideNotification } from '../../ui/content/notifications.js';
import { playTransactionSound } from '../../services/sound_service.js';
import { processImageLocally } from '../../utils/image_processor.js';

export class BatchProcessor {
    constructor(domManager) {
        this.domManager = domManager;
        this.verificationState = new Map();
        this.isBatchRunning = false;
        this.activeBatchCount = 0;
        this.lastCleanup = 0;
        this.lastTelegramAlert = 0;
        
        // Default Settings
        this.settings = {
            batchReverse: false,
            transactionSoundEnabled: false,
            skipPdfEnabled: false,
            skipRandomEnabled: false,
            skipWrongRecipientEnabled: false,
            skipRepeatEnabled: true,
            repeatLimit: 3,
            retryWrongRecipient: false,
            retryVerified: false,
            fullAutoMode: false,
            autoRefreshInterval: 30,
            processingSpeed: 'normal',
            telegramPendingAlert: false,
            pendingLimit: 5
        };

        this.speedConfig = SPEED_CONFIG.normal;

        // Listen for settings updates from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === "updateSettings" && request.settings) {
                this.updateSettings(request.settings);
                sendResponse({ success: true });
            }
        });
    }

    updateSettings(newSettings) {
        if (newSettings.clearCache) {
            this.clearAllCache();
            return;
        }

        Object.assign(this.settings, newSettings);
        if (newSettings.processingSpeed) {
            this.speedConfig = SPEED_CONFIG[newSettings.processingSpeed] || SPEED_CONFIG.normal;
            // Propagate speed settings to DOM Manager
            this.domManager.updateSettings(this.speedConfig);
        }
        // Update button visual if mode changed
        this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode);
    }

    toggleBatch(btnElement) {
        console.log("[BatchProcessor] Toggling batch processing.");
        if (this.isBatchRunning) {
            this.stopBatch();
        } else {
            this.startBatch();
        }
        this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode);
    }

    showRejectOptions() {
        console.log("[BatchProcessor] Showing reject options modal.");
        this.domManager.showRejectModal((types) => this.startBulkReject(types));
    }

    startBulkReject(types) {
        console.log("[BatchProcessor] Starting bulk reject for types:", types);
        if (this.isBatchRunning) {
            showNotification("Please stop the current batch first.", "error"); //
            return;
        }
        
        const rows = Array.from(document.querySelectorAll(SELECTORS.row));
        const targets = [];

        rows.forEach(row => {
            if (row.classList.contains('table-head')) return;
            
            const pageTxId = this.domManager.getTxId(row);
            const cached = localStorage.getItem(`ebirr_cache_${pageTxId}`);
            
            if (cached) {
                try {
                    const data = JSON.parse(cached);
                    // Check if the status matches any selected type, or if it's an "AA" status and "AA" is selected
                    if (types.includes(data.status) || (types.includes("AA") && data.status.startsWith("AA"))) {
                        targets.push({ row, data });
                    }
                } catch(e) {}
            } else if (types.includes("Unprocessed")) {
                // Add unprocessed rows as targets if selected
                targets.push({ 
                    row, 
                    data: { 
                        status: 'Unprocessed', 
                        statusText: 'Unprocessed Reject',
                        color: '#64748b',
                        id: pageTxId
                    } 
                });
            }
        });

        if (targets.length === 0) {
            console.warn("[BatchProcessor] No matching transactions found for bulk reject.");
            showNotification("No matching transactions found.", "error");
            return;
        }

        if (!confirm(`Found ${targets.length} transactions to reject. Proceed?`)) return;

        console.log(`[BatchProcessor] Initiating reject for ${targets.length} transactions.`);
        this.isBatchRunning = true;
        showNotification(`Rejecting ${targets.length} transactions...`, "process");
        this.processRejectQueue(targets);
    }

    processRejectQueue(targets) {
        if (!this.isBatchRunning || targets.length === 0) {
            console.log("[BatchProcessor] Bulk Reject Complete.");
            this.isBatchRunning = false;
            showNotification("Bulk Reject Complete", "success");
            return;
        }

        console.log(`[BatchProcessor] Processing reject for next item. Remaining: ${targets.length}`);
        const { row, data } = targets.shift();
        if (!document.body.contains(row)) {
            this.processRejectQueue(targets);
            return;
        }

        this.domManager.scrollToRow(row);
        const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
        const imgLink = row.querySelector(SELECTORS.imageLink);
        const imgUrl = imgLink ? imgLink.href : null;

        if (rejectLink) {
            console.log(`[BatchProcessor] Clicking reject link for ID: ${data.id}`);
            safeClick(rejectLink);
            this.domManager.waitForModalAndFill(data, 'reject', imgUrl, data.id, true);
            
            // Wait for row removal or timeout before next
            this.domManager.waitForRowRemoval(imgUrl, () => {
                 setTimeout(() => {
                     this.processRejectQueue(targets);
                 }, this.speedConfig.batchDelay); 
            });
        } else {
            console.warn(`[BatchProcessor] Reject link not found for row with ID: ${data.id}. Skipping.`);
            this.processRejectQueue(targets);
        }
    }

    startBatch() {
        console.log("[BatchProcessor] Starting batch processing.");
        this.isBatchRunning = true;
        this.activeBatchCount = 0;
        hideNotification();
        this.processBatchQueue();
    }

    stopBatch() {
        console.log("[BatchProcessor] Stopping batch processing.");
        this.isBatchRunning = false;
        if (window.ebirrRefreshTimer) {
            clearInterval(window.ebirrRefreshTimer);
            window.ebirrRefreshTimer = null;
        }
    }

    checkPendingAlert() {
        console.log("[BatchProcessor] Checking for pending alerts.");
        if (!this.settings.telegramPendingAlert) return;

        const rows = document.querySelectorAll(SELECTORS.row);
        let pendingCount = 0;

        rows.forEach(row => {
            if (row.classList.contains('table-head')) return;
            const isVerified = row.querySelector('.ebirr-summary');
            const isSkipped = row.dataset.ebirrSkipped === "true";
            if (!isVerified && !isSkipped) pendingCount++;
        });

        const now = Date.now();
        if (pendingCount >= this.settings.pendingLimit && (now - this.lastTelegramAlert > 60000)) { // 1 minute cooldown
            console.log(`[BatchProcessor] Pending requests (${pendingCount}) exceed limit (${this.settings.pendingLimit}). Sending Telegram alert.`);
            this.lastTelegramAlert = now;
            chrome.runtime.sendMessage({ action: "sendPendingAlert", count: pendingCount });
        }
    }

    processBatchQueue(fromReloadCheck = false) {
        console.log(`[BatchProcessor] Processing batch queue. Active count: ${this.activeBatchCount}, From reload check: ${fromReloadCheck}`);
        if (!this.isBatchRunning) return;

        if (this.activeBatchCount < MAX_CONCURRENCY) {
            let rows = Array.from(document.querySelectorAll(SELECTORS.row));
            
            if (this.settings.batchReverse) {
                rows.reverse();
            }

            let targetRow = null;
            let targetUrl = null;
            let pendingCount = 0;

            for (let row of rows) {
                if (row.classList.contains('table-head')) continue;
                const imgLink = row.querySelector(SELECTORS.imageLink);
                if (!imgLink) continue;
                
                const imgUrl = imgLink.href;
                if (!imgUrl || !imgUrl.startsWith('http')) continue;

                const isVerified = row.querySelector('.ebirr-summary');
                const isProcessing = this.verificationState.has(imgUrl);
                const isSkipped = row.dataset.ebirrSkipped === "true";
                
                if (!isVerified && !isProcessing && !isSkipped) {
                    const urlPath = imgUrl.split('?')[0].toLowerCase();
                    if (this.settings.skipPdfEnabled && urlPath.endsWith('.pdf')) {
                        row.dataset.ebirrSkipped = "true";
                    console.log(`[BatchProcessor] Skipping PDF for row: ${imgUrl}`);
                        const container = row.querySelector('.ebirr-controller');
                        if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF</span>';
                        if (this.settings.transactionSoundEnabled) playTransactionSound('pdf');
                        continue;
                    }

                    if (!targetRow) {
                        targetRow = row;
                        targetUrl = imgUrl;
                    }
                    pendingCount++;
                } else if (isProcessing) {
                    pendingCount++;
                }
            }

            if (targetRow && targetUrl) {
                console.log(`[BatchProcessor] Found target row for verification: ${targetUrl}`);
                this.activeBatchCount++;
                this.startVerification(targetRow, targetUrl);
                this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode, pendingCount);
            }
            else console.log("[BatchProcessor] No new rows found to process in this iteration.");
        }
        
        // Check if done
        if (this.activeBatchCount === 0) {
            if (this.settings.fullAutoMode && this.isBatchRunning) {
                 if (fromReloadCheck) {
                     startCooldownTimer(this.settings.autoRefreshInterval, () => this.processBatchQueue(), "Waiting for transactions");
                     return;
                 }

                 console.log("[BatchProcessor] Full auto mode active. Attempting to click 'Apply' button to refresh.");
                 const applyBtn = document.querySelector('#filter_form button[type="submit"]') || 
                                  document.querySelector('button[type="submit"].btn-primary') ||
                                  Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'apply');

                 if (applyBtn) {
                     safeClick(applyBtn);
                     const gapMs = Math.min(6000, Math.max(1000, this.settings.autoRefreshInterval * 100));
                     setTimeout(() => {
                         this.processBatchQueue(true);
                     }, gapMs);
                     return;
                 } else {
                     console.warn("[BatchProcessor] 'Apply' button not found for auto-refresh.");
                     showNotification("Auto-Stop: Apply Button Missing", "error");
                 }
            }

            this.stopBatch();
            this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode);
            showNotification("Batch Complete", "success");
        }
    }

    startVerification(row, imgUrl) {
        console.log(`[BatchProcessor] Starting verification for imgUrl: ${imgUrl}`);
        // Auto-scroll to ensure visibility
        this.domManager.scrollToRow(row);

        const portalId = this.domManager.getTxId(row);
        const amountSpan = row.querySelector(SELECTORS.amount);
        if (!amountSpan) { alert("Error: Could not find amount."); return; }

        const rawAmount = amountSpan.innerText.replace(/,/g, '').replace(/\s/g, '');
        const amount = parseFloat(rawAmount);
        const rowId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Extract customer phone from the row
        let customerPhone = null;
        const cells = row.querySelectorAll('td');
        console.log(`[BatchProcessor] Scanning cells for phone number in rowId: ${rowId}`);
        for (const cell of cells) {
            const cellText = cell.innerText;
            console.log(`[BatchProcessor] Cell text: "${cellText}"`);
            const phoneMatch = cellText.match(/(?:\+251|0)?(?:9|7)\d{8}\b/);
            if (phoneMatch) {
                // Validate the length of the matched phone number
                const normalizedPhone = phoneMatch[0].replace(/\D/g, "");
                if (normalizedPhone.length !== 10 && normalizedPhone.length !== 12) {
                    continue; // Keep searching other cells
                }
                

                customerPhone = phoneMatch[0];
                break;
            }
        }

        const displayPhone = customerPhone ? customerPhone.replace(/\D/g, "").slice(-9) : "N/A";
        console.log(`[BatchProcessor] Row Verification: Phone=${displayPhone} (Raw: ${customerPhone}), Amount=${amount}`);

        // Extended timeout (90s) to prevent premature cancellation on slow networks
        const timeoutId = setTimeout(() => {
            this.handleTimeout(imgUrl, rowId);
            console.warn(`[BatchProcessor] Verification for ${imgUrl} timed out after 90s.`);
        }, 90000);

        const state = {
            status: 'processing',
            rowId: rowId,
            timestamp: Date.now(),
            timeoutId: timeoutId,
            amount: amount
        };
        this.verificationState.set(imgUrl, state);

        // Update UI
        this.domManager.injectController(row, imgUrl, state, { onCancel: (url) => this.cancelVerification(url) });
        showNotification("Initializing...", "process");

        console.log(`[BatchProcessor] Fetching image links for ${imgUrl}.`);
        // Fetch Images
        const imageLinks = Array.from(row.querySelectorAll(SELECTORS.imageLink))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
        console.log(`[BatchProcessor] Found ${imageLinks.length} image links.`);

        const hasPdf = imageLinks.some(url => url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?'));
        if (hasPdf && this.isBatchRunning && this.settings.skipPdfEnabled) {
             clearTimeout(timeoutId);
             this.verificationState.delete(imgUrl);
             
             row.dataset.ebirrSkipped = "true";
             console.log(`[BatchProcessor] Skipping multi-image PDF for row: ${imgUrl}`);
             const container = row.querySelector('.ebirr-controller');
             if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF (Multi)</span>';
             if (this.settings.transactionSoundEnabled) playTransactionSound('pdf');
             
             if (this.isBatchRunning) {
                this.activeBatchCount--;
                setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
             }
             return;
        }

        if (imageLinks.length > 1) showNotification(`Scanning ${imageLinks.length} image(s)...`, "process");
        else showNotification("Processing Image...", "process"); //
        
        console.log(`[BatchProcessor] Sending ${imageLinks.length} images for processing.`);
        Promise.all(imageLinks.map(url => 
            new Promise((resolve, reject) => {
                 console.log(`[BatchProcessor] Processing individual image URL: ${url}`);
                 const isPdf = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?');
                 if (isPdf && this.settings.skipPdfEnabled) {
                     resolve(null);
                     return;
                 }

                const action = isPdf ? "capturePdf" : "fetchImageBase64";
                
                try {
                    console.log(`[BatchProcessor] Sending message to background for action: ${action}, URL: ${url}`);
                    if (!chrome.runtime || !chrome.runtime.sendMessage) throw new Error("Extension context invalidated");
                    
                    chrome.runtime.sendMessage({ action: action, url: url }, (response) => {
                        if (chrome.runtime.lastError) {
                            const msg = chrome.runtime.lastError.message;
                            if (msg.includes("Extension context invalidated")) { reject(new Error("Extension context invalidated")); return; }
                            reject(new Error(msg));
                        } else if (response && (response.data || response.dataUrl || response.dataUrls)) {
                            let rawImages = response.dataUrls || [response.dataUrl || ("data:image/jpeg;base64," + response.data)];

                            console.log(`[BatchProcessor] Received image data for ${url}. Processing locally.`);
                            Promise.all(rawImages.map(imgData => Promise.all([
                                processImageLocally(imgData, false),
                                processImageLocally(imgData, true)
                            ]))).then(results => {
                                const sliceObjects = [];
                                results.forEach(([cleanSlices, enhancedSlices]) => {
                                    cleanSlices.forEach((clean, i) => {
                                        sliceObjects.push({ url: url, cleanDataUrl: clean, enhancedDataUrl: enhancedSlices[i] || null });
                                    });
                                });
                                resolve(sliceObjects);
                            }).catch(e => { console.error(`[BatchProcessor] Local image processing failed for ${url}:`, e); resolve([{ url, cleanDataUrl: rawImages[0] }]); });
                        } else {
                            console.error(`[BatchProcessor] No response data for ${url}.`);
                            reject(new Error(response?.error || "Failed to fetch image data"));
                        }
                    });
                } catch (e) { reject(e); }
                console.log(`[BatchProcessor] Image processing promise for ${url} resolved/rejected.`);
            })
        ))

        .then(nestedImages => {
            const images = nestedImages.flat();
            try {
                console.log(`[BatchProcessor] Sending multi-integration verification request to background for rowId: ${rowId}`);
                if (!chrome.runtime || !chrome.runtime.sendMessage) throw new Error("Extension context invalidated");
                chrome.runtime.sendMessage({
                    action: "verifyMultiIntegration",
                    images: images,
                    amount: amount,
                    rowId: rowId,
                    primaryUrl: imgUrl,
                    portalId: portalId,
                    customerPhone: customerPhone
                }, (response) => {
                    if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes("Extension context invalidated")) {
                        this.handleExtensionInvalidated();
                    }
                    else if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message;
                        if (!msg.includes("message port closed")) {
                            console.error("[BatchProcessor] Send Error:", msg);
                        }
                    }
                });
            } catch (e) {
                console.error("Extension context invalidated (MultiVerify):", e);
                this.handleExtensionInvalidated();
            }

        })
        .catch(err => {
            const errMsg = (err && err.message) ? err.message : String(err);
            
            if (errMsg.includes("Extension context invalidated")) {
                this.handleExtensionInvalidated(); // Handle extention context
                return;
            }
            console.error(`[BatchProcessor] Image fetch or multi-integration setup failed for ${imgUrl}:`, err);
            
            const isFrameError = errMsg.includes("Frame with ID 0") || errMsg.includes("showing error page");
            if (isFrameError) console.warn("Frame Error (Skipping):", errMsg);
            else console.error("Image fetch failed:", err);

            showNotification(isFrameError ? "Frame Error - Skipping" : "Image Load Failed", "error"); // Image Error
            this.handleImageFailure(imgUrl, true, isFrameError);
            
            if (this.isBatchRunning) {
                this.activeBatchCount--;
                setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
            }
        });
    }

    cancelVerification(imgUrl) {
        console.log(`[BatchProcessor] Cancelling verification for imgUrl: ${imgUrl}`);
        const state = this.verificationState.get(imgUrl);
        if (state) {
            clearTimeout(state.timeoutId);
            this.verificationState.delete(imgUrl);
        }

        const row = this.domManager.findRowByImgUrl(imgUrl);
        if (row) this.domManager.injectController(row, imgUrl, null, { onVerify: (r, u) => this.startVerification(r, u) });

        showNotification("Operation Cancelled", "error");
    }

    handleImageFailure(imgUrl, suppressNotification = false, shouldSkip = false) {
        console.log(`[BatchProcessor] Handling image failure for imgUrl: ${imgUrl}. Suppress Notification: ${suppressNotification}, Should Skip: ${shouldSkip}`);
        const state = this.verificationState.get(imgUrl);
        if (!state) return;
        
        clearTimeout(state.timeoutId);
        this.verificationState.delete(imgUrl);
        
        const row = this.domManager.findRowByImgUrl(imgUrl);
        if (row) {
            if (shouldSkip) row.dataset.ebirrSkipped = "true";
            this.domManager.injectController(row, imgUrl, null, { 
                onVerify: (r, u) => {
                    delete row.dataset.ebirrSkipped;
                    this.startVerification(r, u);
                }
            });
        }
        if (!suppressNotification) showNotification("Image Request Failed", "error");
    }

    handleTimeout(imgUrl, rowId) {
        console.warn(`[BatchProcessor] Handling timeout for imgUrl: ${imgUrl}, rowId: ${rowId}`);
        // Mark as skipped (true) to prevent immediate retry loop
        this.handleImageFailure(imgUrl, false, true);
        showNotification("Request Timed Out", "error");

        const row = this.domManager.findRowByImgUrl(imgUrl);
        if (row) {
            const container = row.querySelector('.ebirr-controller');
            if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Timed Out</span>';
            
            // Persist "Timed Out" state so it is skipped even after page refresh
            this.saveRowState(row, { status: "Timed Out", statusText: "Timed Out", color: "#f59e0b" });
        }

        if (this.isBatchRunning) {
            this.activeBatchCount--;
            
            const applyBtn = document.querySelector('#filter_form button[type="submit"]');
            if (applyBtn) {
                console.log("[BatchProcessor] Timeout in batch mode. Refreshing page.");
                showNotification("Timeout - Refreshing...", "process");
                safeClick(applyBtn);
                setTimeout(() => this.processBatchQueue(true), 3000);
            } else {
                setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
            }
        }
    }

    handleExtensionInvalidated() {
        console.error("[BatchProcessor] Extension context invalidated. Reloading page.");
        showNotification("Extension updated. Refreshing page...", "error");
        if (this.isBatchRunning) this.stopBatch();
        setTimeout(() => window.location.reload(), 1500);
    }

    handleResult(request) {
        console.log(`[BatchProcessor] Handling verification result for rowId: ${request.rowId}, imgUrl: ${request.imgUrl}. Success: ${request.success}`);
        const imgUrl = request.imgUrl;
        const state = this.verificationState.get(imgUrl);

        if (!state) return;
        if (request.rowId && state.rowId !== request.rowId) return;

        clearTimeout(state.timeoutId);
        this.verificationState.delete(imgUrl);

        const row = this.domManager.findRowByImgUrl(imgUrl);
        if (!row) return;
        
        // Reset to "Verify" button state (will be overwritten by summary or modal logic)
        this.domManager.injectController(row, imgUrl, null, { onVerify: (r, u) => this.startVerification(r, u) });

        if (this.isBatchRunning) this.activeBatchCount--;

        if (!request.success) {
            console.error(`[BatchProcessor] Verification failed for rowId: ${request.rowId}. Error: ${request.error}`);
            showNotification("Failed", "error");
            alert("Verification Failed: " + request.error);
            return;
        }

        console.log(`[BatchProcessor] Verification result for rowId: ${request.rowId}. Status: ${request.data.status}`);
        const result = request.data;

        // API LIMIT
        if (result.status === "API Limit") {
            showNotification("⚠️ API Limit Reached", "error");
            if (this.settings.transactionSoundEnabled) playTransactionSound('error');

            console.warn("[BatchProcessor] API Limit reached. Initiating cooldown.");
            if (this.settings.fullAutoMode || this.isBatchRunning) {
                // 1 Minute Cooldown in Dynamic Island
                startCooldownTimer(60, () => {
                    if ((this.settings.fullAutoMode || this.isBatchRunning) && document.body.contains(row)) {
                        this.activeBatchCount++;
                        this.startVerification(row, imgUrl);
                    }
                }, "API Cooldown");
            }
            return;
        }

        // AI ERROR - Stop batch and do not open modal
        if (result.status === "AI Error") {
            console.error("[BatchProcessor] AI Service Error detected. Stopping batch.");
            showNotification(result.statusText || "AI Service Error", "error");
            if (this.settings.transactionSoundEnabled) playTransactionSound('error');

            if (row) {
                 row.dataset.ebirrSkipped = "true";
                 const container = row.querySelector('.ebirr-controller');
                 if (container) container.innerHTML = '<span style="color:#ef4444; font-weight:bold; font-size:11px;">AI Error</span>';
            }

            if (this.isBatchRunning) {
                const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                if (applyBtn) {
                    console.log("[BatchProcessor] AI Error in batch mode. Refreshing page.");
                    showNotification("AI Error - Refreshing...", "process");
                    safeClick(applyBtn);
                    setTimeout(() => this.processBatchQueue(true), 3000);
                } else {
                    setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
                }
            }
            return;
        }

        // IMAGE LOAD FAILED - Retry
        if (result.status === "Image Load Failed") {
             console.warn("[BatchProcessor] Image Load Failed. Retrying.");
             showNotification("Image Load Failed - Retrying...", "error");
             if (this.isBatchRunning) {
                 const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                 if (applyBtn) {
                     showNotification("Image Error - Refreshing...", "process");
                     console.log("[BatchProcessor] Image Load Failed in batch mode. Refreshing page.");
                     safeClick(applyBtn);
                     setTimeout(() => this.processBatchQueue(true), 3000);
                 } else {
                     setTimeout(() => this.processBatchQueue(), 2000);
                 }
             }
             return;
        }

        // BANK 404 - Retry Button
        if (result.status === "Bank 404") {
            console.warn("[BatchProcessor] Bank 404 detected. Displaying retry button.");
            this.saveRowState(row, result, "Retry Bank Check");
            showNotification("Bank 404 - Retry Required", "error");
            if (this.settings.transactionSoundEnabled) playTransactionSound('error');

            if (row) {
                 row.dataset.ebirrSkipped = "true";
                 const container = row.querySelector('.ebirr-controller');
                 if (container) {
                    container.innerHTML = '';
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-warning btn-xs';
                    btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #f59e0b; border: none; color: white; border-radius: 3px; cursor: pointer;";
                    btn.innerText = "Retry Bank Check";
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        delete row.dataset.ebirrSkipped;
                        this.startVerification(row, request.imgUrl);
                    };
                    container.appendChild(btn);
                 }
            }

            if (this.isBatchRunning) {
                const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                if (applyBtn) {
                    console.log("[BatchProcessor] Bank 404 in batch mode. Refreshing page.");
                    showNotification("Bank 404 - Refreshing...", "process");
                    safeClick(applyBtn);
                    setTimeout(() => this.processBatchQueue(true), 3000);
                } else {
                    setTimeout(() => this.processBatchQueue(), 500);
                }
            }
            return;
        }

        // SKIPPED NAME - Skip without opening modal
        if (result.status === "Skipped Name") {
            console.log("[BatchProcessor] Skipping due to 'Skipped Name'.");
            showNotification("Skipping (Name Match)...", "error");
            if (this.settings.transactionSoundEnabled) playTransactionSound('random');

            if (row) {
                 row.dataset.ebirrSkipped = "true";
                 const container = row.querySelector('.ebirr-controller');
                 if (container) {
                    container.innerHTML = '';
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-danger btn-xs';
                    btn.style.cssText = `padding: 2px 8px; font-size: 11px; background-color: ${result.color || '#9ca3af'}; border: none; color: white; border-radius: 3px; cursor: pointer;`;
                 btn.innerText = "Reject Skipped"; // Hold Ctrl for auto-repeat
                 this.addCtrlBehavior(btn);
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                     const autoRepeat = e.ctrlKey;
                        const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                        if (rejectLink) {
                            safeClick(rejectLink);
                         this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true, autoRepeat);
                        }
                    };
                    container.appendChild(btn);
                 }
            }
            
            this.saveRowState(row, result, "Reject Skipped");

            if (this.isBatchRunning) {
                setTimeout(() => this.processBatchQueue(), 500);
            }
            return;
        }

        const isVerified = result.status === "Verified";
        const isAA = result.status.startsWith("AA");
        const isPdfSkip = result.status === "PDF" && this.isBatchRunning && this.settings.skipPdfEnabled;
        const isRandomSkip = result.status === "Random" && this.isBatchRunning && this.settings.skipRandomEnabled;
        const isWrongRecipientSkip = result.status === "Wrong Recipient" && this.isBatchRunning && this.settings.skipWrongRecipientEnabled;
        const isRepeatSkip = this.isBatchRunning && result.repeatCount >= this.settings.repeatLimit;
        const isSkipping = isPdfSkip || isRandomSkip || isWrongRecipientSkip || isRepeatSkip;

        if (this.settings.transactionSoundEnabled) {
            console.log(`[BatchProcessor] Playing sound for status: ${result.status}`);
            if (isVerified || isAA) playTransactionSound('success');
            else if (!isSkipping) playTransactionSound('error');
        }

        showNotification("Verification Complete", "success");
        this.saveRowState(row, result);
        this.restoreRowState(row); // Update UI with label and tooltip
        
        // Handle Skips (PDF/Random/Wrong Recipient)
        if (result.status === "Random" || result.status === "PDF" || result.status === "Wrong Recipient") {
            console.log(`[BatchProcessor] Handling skip for status: ${result.status}`);
            if (isPdfSkip) {
                 showNotification("Skipping PDF...", "error");
                 if (row) {
                     row.dataset.ebirrSkipped = "true";
                     const container = row.querySelector('.ebirr-controller');
                     if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF</span>';
                 }
                 if (this.settings.transactionSoundEnabled) playTransactionSound('pdf');
                 setTimeout(() => this.processBatchQueue(), 500);
                 return;
            }
            
            if (isRandomSkip) {
                 console.log("[BatchProcessor] Skipping due to 'Random' status.");
                 showNotification("Skipping Random...", "error");
                 if (row) {
                     row.dataset.ebirrSkipped = "true";
                     const container = row.querySelector('.ebirr-controller');
                     if (container) {
                        container.innerHTML = '';
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-danger btn-xs';
                        btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #ef4444; border: none; color: white; border-radius: 3px; cursor: pointer;";
                     btn.innerText = "Reject Random"; // Hold Ctrl for auto-repeat
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                         const autoRepeat = e.ctrlKey;
                            const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                            if (rejectLink) {
                                safeClick(rejectLink);
                             this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true, autoRepeat);
                            }
                        };
                        this.saveRowState(row, result, "Reject Random");
                        container.appendChild(btn);
                     }
                 }
                 if (this.settings.transactionSoundEnabled) playTransactionSound('random');
                 setTimeout(() => this.processBatchQueue(), 500);
                 return;
            }

            if (isWrongRecipientSkip) {
                 console.log("[BatchProcessor] Skipping due to 'Wrong Recipient' status.");
                 showNotification("Skipping Wrong Recipient...", "error");
                 if (row) {
                     row.dataset.ebirrSkipped = "true";
                     const container = row.querySelector('.ebirr-controller');
                     if (container) {
                        container.innerHTML = '';
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-danger btn-xs';
                        btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #ef4444; border: none; color: white; border-radius: 3px; cursor: pointer;";
                        btn.innerText = "Reject Wrong Recipient"; // Hold Ctrl for auto-repeat
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const autoRepeat = e.ctrlKey;
                            const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                            if (rejectLink) {
                                safeClick(rejectLink);
                                this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true, autoRepeat);
                            }
                        };
                        this.saveRowState(row, result, "Reject Wrong Recipient");
                        container.appendChild(btn);
                     }
                 }
                 if (this.settings.transactionSoundEnabled) playTransactionSound('random');
                 setTimeout(() => this.processBatchQueue(), 500);
                 return;
            }

            showNotification(result.statusText || "Review Required", "error");
            console.warn(`[BatchProcessor] Review required for rowId: ${request.rowId}. Status: ${result.status}`);
            const imgLink = row.querySelector(SELECTORS.imageLink);
            if (imgLink) {
                chrome.runtime.sendMessage({ 
                    action: "openRandomReview", 
                    url: imgLink.href, 
                    rowId: request.rowId, 
                    extractedId: request.extractedId, 
                    isPdf: result.status === "PDF" 
                });
            }
            if (this.isBatchRunning) {
                this.stopBatch();
                const btn = document.getElementById('ebirr-batch-btn');
                console.log("[BatchProcessor] Batch paused for review.");
                if (btn) { 
                    btn.innerHTML = `<i class="fa fa-play"></i> Resume ${this.settings.fullAutoMode ? "Auto" : "Batch"}`; 
                    btn.style.backgroundColor = "#f59e0b"; 
                    btn.style.borderColor = "#f59e0b";
                }
                showNotification("Batch Paused (Review Required)", "timeout");
            }
            return;
        }

        // Handle Repeat Skips
        if (this.isBatchRunning && this.settings.skipRepeatEnabled && result.repeatCount >= this.settings.repeatLimit) {
             const isWrongRecip = result.originalStatus === 'Wrong Recipient';
             console.log(`[BatchProcessor] Handling repeat skip for rowId: ${request.rowId}. Repeat Count: ${result.repeatCount}, Limit: ${this.settings.repeatLimit}`);
             const isVerifiedStatus = result.originalStatus === 'Verified';
             
             if (!((isWrongRecip && this.settings.retryWrongRecipient) || (isVerifiedStatus && this.settings.retryVerified))) {
                 showNotification(`Skipping High Repeat (${result.repeatCount})...`, "error");
                 if (row) {
                     row.dataset.ebirrSkipped = "true";
                     const container = row.querySelector('.ebirr-controller');
                     if (container) {
                        container.innerHTML = '';
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-warning btn-xs';
                        btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #f59e0b; border: none; color: white; border-radius: 3px; cursor: pointer;";
                        btn.innerText = `Reject Repeat (${result.repeatCount})`; // Hold Ctrl for auto-repeat
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const autoRepeat = e.ctrlKey;
                            const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                            if (rejectLink) {
                                safeClick(rejectLink);
                                this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true, autoRepeat);
                            }
                        };
                        this.saveRowState(row, result, `Reject Repeat (${result.repeatCount})`);
                        container.appendChild(btn);
                     }
                 }
                 if (this.settings.transactionSoundEnabled) playTransactionSound('random');
                 setTimeout(() => this.processBatchQueue(), 500);
                 return;
             }
        }

        // AUTOMATION
        const runAutomation = () => {
            // Monitor for "Already Processed" message
            console.log("[BatchProcessor] Starting automation for result.");
            const checkAlreadyProcessed = setInterval(() => {
                const modal = document.querySelector(SELECTORS.modal);
                if (modal && (modal.innerText.includes("The stated payment has already been processed") || modal.innerText.includes("The stated payment not found"))) {
                    clearInterval(checkAlreadyProcessed);
                    
                    // Try to close the modal
                    const cancelBtn = modal.querySelector(SELECTORS.modalBtnCancel) || modal.querySelector('.btn-default, .close, button[data-dismiss="modal"]');
                    if (cancelBtn) {
                        safeClick(cancelBtn);
                    } else {
                        const closeBtns = modal.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"], .btn');
                        for (let btn of closeBtns) {
                            const text = (btn.innerText || btn.value || "").toLowerCase();
                            if (text.includes("cancel") || text.includes("close") || text.includes("ok") || btn.getAttribute('data-dismiss') === 'modal' || btn.getAttribute('data-bs-dismiss') === 'modal') {
                                btn.click();
                                break;
                            }
                        }
                    }

                    showNotification("Processed/Not Found - Skipped", "error");
                    console.warn("[BatchProcessor] Modal indicated 'Already Processed/Not Found'. Skipping row.");
                    
                    if (row) {
                        row.dataset.ebirrSkipped = "true";
                        const container = row.querySelector('.ebirr-controller');
                        if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Processed/Not Found</span>';
                        this.saveRowState(row, { status: "Processed/Not Found", statusText: "Processed/Not Found", color: "#f59e0b" });
                    }

                    // Force continue batch since row won't be removed
                    if (this.isBatchRunning) {
                        const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                        if (applyBtn) {
                            console.log("[BatchProcessor] Refreshing table after 'Already Processed' skip.");
                            showNotification("Refreshing Table...", "process");
                            applyBtn.click();
                            setTimeout(() => this.processBatchQueue(true), 2500);
                        } else {
                            setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
                        }
                    }
                }
                if (!this.isBatchRunning || !document.body.contains(row)) clearInterval(checkAlreadyProcessed);
            }, 500);

            if (isVerified || isAA) {
                const confirmLink = this.domManager.columnIndexes.confirm ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.confirm}) a`) : null;
                console.log(`[BatchProcessor] Transaction is Verified/AA. Clicking confirm link for rowId: ${request.rowId}`);
                if (confirmLink) {
                    safeClick(confirmLink);
                    this.domManager.waitForModalAndFill(result, 'confirm', request.imgUrl, request.extractedId, this.isBatchRunning);
                }
            } else {
                console.log(`[BatchProcessor] Transaction is not Verified/AA. Clicking reject link for rowId: ${request.rowId}`);
                const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                if (rejectLink) {
                    safeClick(rejectLink);
                    this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, this.isBatchRunning);
                }
            }

            if (this.isBatchRunning) {
                console.log(`[BatchProcessor] Waiting for row removal for rowId: ${request.rowId} before processing next in batch.`);
                this.domManager.waitForRowRemoval(request.imgUrl, () => {
                    setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
                });
            }
        };

        console.log("[BatchProcessor] Checking for existing modal before running automation.");
        const existingModal = document.querySelector(SELECTORS.modal);
        if (existingModal && existingModal.offsetParent !== null) {
            showNotification("Paused: Waiting for Modal...", "timeout");
            const waitInterval = setInterval(() => {
                const m = document.querySelector(SELECTORS.modal);
                if (!m || m.offsetParent === null) {
                    clearInterval(waitInterval);
                    runAutomation();
                    console.log("[BatchProcessor] Modal closed, resuming automation.");
                }
            }, 1000);
        } else {
            runAutomation();
        }
    }

    saveRowState(row, data, buttonLabel = null) {
        console.log(`[BatchProcessor] Saving row state for ID: ${this.domManager.getTxId(row)}. Status: ${data.status}, Button Label: ${buttonLabel}`);
        try {
            const pageTxId = this.domManager.getTxId(row);
            if (!pageTxId) return;

            const cacheData = {
                status: data.status,
                statusText: data.statusText,
                color: data.color,
                buttonLabel: buttonLabel,
                timestamp: Date.now(),
                // Extended Data for Tooltips
                originalStatus: data.originalStatus,
                foundAmt: data.foundAmt,
                senderName: data.senderName,
                foundName: data.foundName,
                timeStr: data.timeStr,
                repeatCount: data.repeatCount,
                id: data.id,
                processedBy: data.processedBy,
                bankCheckResult: data.bankCheckResult
            };
            localStorage.setItem(`ebirr_cache_${pageTxId}`, JSON.stringify(cacheData));
        } catch (e) {
            console.error("Failed to save row state", e);
        }
    }

    restoreAllRows() {
        console.log("[BatchProcessor] Restoring states for all rows.");
        // Run cleanup every 5 minutes to keep storage clean
        if (Date.now() - this.lastCleanup > 300000) {
            this.cleanupCache();
            this.lastCleanup = Date.now();
        }

        const rows = document.querySelectorAll(SELECTORS.row);
        rows.forEach(row => {
            if (row.classList.contains('table-head')) return;
            this.restoreRowState(row);
        });
    }

    cleanupCache() {
        console.log("[BatchProcessor] Running cache cleanup (disabled by default).");
        /* Disabled automatic cleanup
        const now = Date.now();
        const EXPIRATION_MS = 300 * 60 * 1000; // 300 minutes
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('ebirr_cache_')) {
                try {
                    const item = localStorage.getItem(key);
                    if (item) {
                        const data = JSON.parse(item);
                        if (now - (data.timestamp || 0) > EXPIRATION_MS) {
                            keysToRemove.push(key);
                        }
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }
        
        keysToRemove.forEach(k => localStorage.removeItem(k));
        */
    }

    clearAllCache() {
        console.log("[BatchProcessor] Clearing all local storage cache entries.");
        let count = 0;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('ebirr_cache_')) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(k => {
            localStorage.removeItem(k);
            count++;
        });

        showNotification(`Cache Cleared (${count} items)`, "success");
        console.log(`[BatchProcessor] Cleared ${count} cache items.`);

        // Reset UI
        const rows = document.querySelectorAll(SELECTORS.row);
        rows.forEach(row => {
            if (row.classList.contains('table-head')) return;
            const imgLink = row.querySelector(SELECTORS.imageLink);
            if (imgLink && !this.verificationState.has(imgLink.href)) {
                delete row.dataset.ebirrSkipped;
                this.domManager.injectController(row, imgLink.href, null, { onVerify: (r, u) => this.startVerification(r, u) });
            }
        });
    }

    restoreRowState(row) {
        console.log(`[BatchProcessor] Restoring row state for row: ${this.domManager.getTxId(row)}`);
        if (row.dataset.ebirrSkipped === "true") return;

        const pageTxId = this.domManager.getTxId(row);
        if (!pageTxId) return;

        const cached = localStorage.getItem(`ebirr_cache_${pageTxId}`);
        if (cached) {
            try {
                const data = JSON.parse(cached);

                console.log(`[BatchProcessor] Cached data found for ${pageTxId}:`, data);
                // Check Expiration (Lazy Check)
                /* Disabled automatic cleanup
                if (Date.now() - (data.timestamp || 0) > 30 * 60 * 1000) {
                    localStorage.removeItem(`ebirr_cache_${pageTxId}`);
                    return;
                }
                */

                // RECONSTRUCT BUTTON LABEL IF MISSING (Fix for text-only issue)
                if (!data.buttonLabel) {
                    if (data.status === "Bank 404") data.buttonLabel = "Retry Bank Check";
                    else if (data.status === "Random") data.buttonLabel = "Reject Random";
                    else if (data.status === "Repeat") data.buttonLabel = `Reject Repeat (${data.repeatCount || 0})`;
                    else if (data.status === "Under 50") data.buttonLabel = "Reject Under 50";
                    else if (data.status === "Skipped Name") data.buttonLabel = "Reject Skipped";
                    else if (data.status === "Wrong Recipient") data.buttonLabel = "Reject Wrong Recipient";
                }

                if (data.status === "Skipped Name") {
                    console.log(`[BatchProcessor] Row ${pageTxId} was skipped by name.`);
                    row.dataset.ebirrSkipped = "true";
                }

                // UI CUSTOMIZATION: Identify SMS Verification
                const isSmsVerified = data.statusText && data.statusText.includes("(SMS)");

                const container = row.querySelector('.ebirr-controller');
                if (container) {
                    row.dataset.ebirrSkipped = "true";
                    
                    if (data.buttonLabel) {
                         container.innerHTML = '';
                         console.log(`[BatchProcessor] Displaying button for ${pageTxId}: ${data.buttonLabel}`);
                         const btn = document.createElement('button');
                         const isWarning = data.status === "Bank 404" || data.status === "Repeat" || isSmsVerified;
                         const isSkipped = data.status === "Skipped Name";
                         
                         btn.className = isWarning ? 'btn btn-warning btn-xs' : (isSkipped ? 'btn btn-secondary btn-xs' : 'btn btn-danger btn-xs');
                         
                         let bgColor = '#ef4444';
                         if (isWarning) bgColor = '#f59e0b';
                         else if (isSkipped) bgColor = '#9ca3af';

                         btn.style.cssText = `padding: 2px 8px; font-size: 11px; background-color: ${bgColor}; border: none; color: white; border-radius: 3px; cursor: pointer;`;
                         btn.innerText = data.buttonLabel;

                         if (data.status === "Bank 404") {
                             btn.onclick = (e) => {
                            console.log(`[BatchProcessor] Retrying Bank Check for ${pageTxId}.`);
                            e.preventDefault();
                            e.stopPropagation();
                            delete row.dataset.ebirrSkipped;
                            localStorage.removeItem(`ebirr_cache_${pageTxId}`);
                            const imgLink = row.querySelector(SELECTORS.imageLink);
                            if (imgLink) this.startVerification(row, imgLink.href);
                         };
                         } else {
                             // Reject Logic for Repeat/Random
                             btn.onclick = (e) => {
                                e.preventDefault();
                                console.log(`[BatchProcessor] Rejecting ${pageTxId} with status ${data.status}. CtrlKey: ${e.ctrlKey}`);
                                e.stopPropagation();
                                const autoRepeat = e.ctrlKey;
                                const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                                if (rejectLink) {
                                    safeClick(rejectLink);
                                    this.domManager.waitForModalAndFill(data, 'reject', null, data.id, true, autoRepeat);
                                }
                             };
                         }
                         
                         this.addCtrlBehavior(btn);
                         container.appendChild(btn);
                         return;
                    }

                    const color = isSmsVerified ? '#6366f1' : (data.color || '#64748b');
                    let text = data.statusText || data.status;
                    if (isSmsVerified) text = "📱 " + text;
                    console.log(`[BatchProcessor] Displaying status text for ${pageTxId}: ${text}`);
                    
                    container.innerHTML = '';
                    const span = document.createElement('span');
                    span.style.cssText = `color:${color}; font-weight:bold; font-size:11px; cursor:help;`;
                    span.innerText = text;
                    container.appendChild(span);
                }
            } catch (e) {
                console.error("Error restoring row state", e);
                localStorage.removeItem(`ebirr_cache_${pageTxId}`); // Clear corrupted cache
            }
        }
    }

    clearCacheForTx(txId) {
        localStorage.removeItem(`ebirr_cache_${txId}`);
        showNotification(`Cache cleared for ${txId}`, "success");

        console.log(`[BatchProcessor] Cache cleared for transaction ID: ${txId}. Re-injecting controller.`);
        const rows = document.querySelectorAll(SELECTORS.row);
        for (let row of rows) {
            if (this.domManager.getTxId(row) === txId) {
                delete row.dataset.ebirrSkipped;
                const imgLink = row.querySelector(SELECTORS.imageLink);
                if (imgLink) {
                    this.domManager.injectController(row, imgLink.href, null, { 
                        onVerify: (r, u) => this.startVerification(r, u)
                    });
                }
            }
        }
    }

    hookNativeReject(link, row) {
        console.log(`[BatchProcessor] Hooking native reject button for row: ${this.domManager.getTxId(row)}`);
        const txId = this.domManager.getTxId(row);
        const cached = localStorage.getItem(`ebirr_cache_${txId}`);
        
        // Use cached data if available, otherwise use a default "Repeat" payload
        let data = cached ? JSON.parse(cached) : { 
            status: "Repeat", 
            id: txId, 
            color: "#f59e0b", 
            statusText: "🔁 REPEAT / DUPLICATE",
            repeatCount: 0 
        };

        this.addCtrlBehavior(link);

        console.log(`[BatchProcessor] Adding click listener to native reject for ${txId}.`);
        link.addEventListener('click', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                // Trigger the portal's modal first
                safeClick(link);
                // Instruct the manager to auto-fill and click "Repeat"
                this.domManager.waitForModalAndFill(data, 'reject', null, txId, true, true);
            }
        });
    }

    addCtrlBehavior(element) {
        console.log("[BatchProcessor] Adding Ctrl key behavior to element.");
        const updateBtn = (e) => {
            if (element.matches(':hover')) {
                element.style.color = e.ctrlKey ? "#f59e0b" : "";
            }
        };
        window.addEventListener('keydown', updateBtn);
        window.addEventListener('keyup', updateBtn);
        element.addEventListener('mouseleave', () => {
            element.style.color = "";
        });
    }
}
