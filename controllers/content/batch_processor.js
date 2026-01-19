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
        
        // Default Settings
        this.settings = {
            batchReverse: false,
            transactionSoundEnabled: false,
            skipPdfEnabled: false,
            skipRandomEnabled: false,
            skipRepeatEnabled: true,
            repeatLimit: 3,
            retryWrongRecipient: false,
            retryVerified: false,
            fullAutoMode: false,
            autoRefreshInterval: 30,
            processingSpeed: 'normal'
        };

        this.speedConfig = SPEED_CONFIG.normal;
    }

    updateSettings(newSettings) {
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
        if (this.isBatchRunning) {
            this.stopBatch();
        } else {
            this.startBatch();
        }
        this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode);
    }

    startBatch() {
        this.isBatchRunning = true;
        this.activeBatchCount = 0;
        hideNotification();
        this.processBatchQueue();
    }

    stopBatch() {
        this.isBatchRunning = false;
        if (window.ebirrRefreshTimer) {
            clearInterval(window.ebirrRefreshTimer);
            window.ebirrRefreshTimer = null;
        }
    }

    processBatchQueue(fromReloadCheck = false) {
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
                this.activeBatchCount++;
                this.startVerification(targetRow, targetUrl);
                this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode, pendingCount);
            }
        }
        
        // Check if done
        if (this.activeBatchCount === 0) {
            if (this.settings.fullAutoMode && this.isBatchRunning) {
                 if (fromReloadCheck) {
                     startCooldownTimer(this.settings.autoRefreshInterval, () => this.processBatchQueue(), "Waiting for transactions");
                     return;
                 }

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
                     showNotification("Auto-Stop: Apply Button Missing", "error");
                 }
            }

            this.stopBatch();
            this.domManager.updateBatchButtonVisuals(this.isBatchRunning, this.settings.fullAutoMode);
            showNotification("Batch Complete", "success");
        }
    }

    startVerification(row, imgUrl) {
        const amountSpan = row.querySelector(SELECTORS.amount);
        if (!amountSpan) { alert("Error: Could not find amount."); return; }

        const rawAmount = amountSpan.innerText.replace(/,/g, '').replace(/\s/g, '');
        const amount = parseFloat(rawAmount);
        const rowId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const timeoutId = setTimeout(() => {
            this.handleTimeout(imgUrl, rowId);
        }, TIMEOUT_MS);

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

        // Fetch Images
        const imageLinks = Array.from(row.querySelectorAll(SELECTORS.imageLink))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));

        const hasPdf = imageLinks.some(url => url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?'));
        if (hasPdf && this.isBatchRunning && this.settings.skipPdfEnabled) {
             clearTimeout(timeoutId);
             this.verificationState.delete(imgUrl);
             
             row.dataset.ebirrSkipped = "true";
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
        else showNotification("Processing Image...", "process");
        
        Promise.all(imageLinks.map(url => 
            new Promise((resolve, reject) => {
                 const isPdf = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?');
                 if (isPdf && this.settings.skipPdfEnabled) {
                     resolve(null);
                     return;
                 }

                const action = isPdf ? "capturePdf" : "fetchImageBase64";
                
                try {
                    if (!chrome.runtime || !chrome.runtime.sendMessage) throw new Error("Extension context invalidated");
                    
                    chrome.runtime.sendMessage({ action: action, url: url }, (response) => {
                        if (chrome.runtime.lastError) {
                            const msg = chrome.runtime.lastError.message;
                            if (msg.includes("Extension context invalidated")) { reject(new Error("Extension context invalidated")); return; }
                            reject(new Error(msg));
                        } else if (response && (response.data || response.dataUrl || response.dataUrls)) {
                            let rawImages = response.dataUrls || [response.dataUrl || ("data:image/jpeg;base64," + response.data)];

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
                            }).catch(() => resolve([{ url, cleanDataUrl: rawImages[0] }]));
                        } else {
                            reject(new Error(response?.error || "Failed to fetch image data"));
                        }
                    });
                } catch (e) { reject(e); }
            })
        ))

        .then(nestedImages => {
            const images = nestedImages.flat();
            try {
                if (!chrome.runtime || !chrome.runtime.sendMessage) throw new Error("Extension context invalidated");
                chrome.runtime.sendMessage({
                    action: "verifyMultiIntegration",
                    images: images,
                    amount: amount,
                    rowId: rowId,
                    primaryUrl: imgUrl
                }, (response) => {
                    if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes("Extension context invalidated")) {
                        this.handleExtensionInvalidated();
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
        this.handleImageFailure(imgUrl);
        showNotification("Request Timed Out", "error");
        if (this.isBatchRunning) {
            this.activeBatchCount--;
            
            const applyBtn = document.querySelector('#filter_form button[type="submit"]');
            if (applyBtn) {
                showNotification("Timeout - Refreshing...", "process");
                safeClick(applyBtn);
                setTimeout(() => this.processBatchQueue(true), 3000);
            } else {
                setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
            }
        }
    }

    handleExtensionInvalidated() {
        showNotification("Extension updated. Refreshing page...", "error");
        if (this.isBatchRunning) this.stopBatch();
        setTimeout(() => window.location.reload(), 1500);
    }

    handleResult(request) {
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
            showNotification("Failed", "error");
            alert("Verification Failed: " + request.error);
            return;
        }

        const result = request.data;

        // API LIMIT
        if (result.status === "API Limit") {
            showNotification("⚠️ API Limit Reached", "error");
            if (this.settings.transactionSoundEnabled) playTransactionSound('error');

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
             showNotification("Image Load Failed - Retrying...", "error");
             if (this.isBatchRunning) {
                 const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                 if (applyBtn) {
                     showNotification("Image Error - Refreshing...", "process");
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
                    this.attachTooltip(btn, result);
                    container.appendChild(btn);
                 }
            }

            if (this.isBatchRunning) {
                const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                if (applyBtn) {
                    showNotification("Bank 404 - Refreshing...", "process");
                    safeClick(applyBtn);
                    setTimeout(() => this.processBatchQueue(true), 3000);
                } else {
                    setTimeout(() => this.processBatchQueue(), 500);
                }
            }
            return;
        }

        const isVerified = result.status === "Verified";
        const isAA = result.status.startsWith("AA");
        const isPdfSkip = result.status === "PDF" && this.isBatchRunning && this.settings.skipPdfEnabled;
        const isRandomSkip = result.status === "Random" && this.isBatchRunning && this.settings.skipRandomEnabled;
        const isRepeatSkip = this.isBatchRunning && result.repeatCount >= this.settings.repeatLimit;
        const isSkipping = isPdfSkip || isRandomSkip || isRepeatSkip;

        if (this.settings.transactionSoundEnabled) {
            if (isVerified || isAA) playTransactionSound('success');
            else if (!isSkipping) playTransactionSound('error');
        }

        showNotification("Verification Complete", "success");
        this.saveRowState(row, result);
        this.restoreRowState(row); // Update UI with label and tooltip
        
        // Handle Skips (PDF/Random)
        if (result.status === "Random" || result.status === "PDF") {
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
                 showNotification("Skipping Random...", "error");
                 if (row) {
                     row.dataset.ebirrSkipped = "true";
                     const container = row.querySelector('.ebirr-controller');
                     if (container) {
                        container.innerHTML = '';
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-danger btn-xs';
                        btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #ef4444; border: none; color: white; border-radius: 3px; cursor: pointer;";
                        btn.innerText = "Reject Random";
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                            if (rejectLink) {
                                safeClick(rejectLink);
                                this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true);
                            }
                        };
                        this.saveRowState(row, result, "Reject Random");
                        this.attachTooltip(btn, result);
                        container.appendChild(btn);
                     }
                 }
                 if (this.settings.transactionSoundEnabled) playTransactionSound('random');
                 setTimeout(() => this.processBatchQueue(), 500);
                 return;
            }

            showNotification(result.statusText || "Review Required", "error");
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
                        btn.innerText = `Reject Repeat (${result.repeatCount})`;
                        btn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                            if (rejectLink) {
                                safeClick(rejectLink);
                                this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true);
                            }
                        };
                        this.saveRowState(row, result, `Reject Repeat (${result.repeatCount})`);
                        this.attachTooltip(btn, result);
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
                if (confirmLink) {
                    safeClick(confirmLink);
                    this.domManager.waitForModalAndFill(result, 'confirm', request.imgUrl, request.extractedId, this.isBatchRunning);
                }
            } else {
                const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                if (rejectLink) {
                    safeClick(rejectLink);
                    this.domManager.waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, this.isBatchRunning);
                }
            }

            if (this.isBatchRunning) {
                this.domManager.waitForRowRemoval(request.imgUrl, () => {
                    setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
                });
            }
        };

        const existingModal = document.querySelector(SELECTORS.modal);
        if (existingModal && existingModal.offsetParent !== null) {
            showNotification("Paused: Waiting for Modal...", "timeout");
            const waitInterval = setInterval(() => {
                const m = document.querySelector(SELECTORS.modal);
                if (!m || m.offsetParent === null) {
                    clearInterval(waitInterval);
                    runAutomation();
                }
            }, 1000);
        } else {
            runAutomation();
        }
    }

    saveRowState(row, data, buttonLabel = null) {
        try {
            const firstCell = row.querySelector('td:first-child');
            if (!firstCell) return;
            const pageTxId = firstCell.innerText.trim();
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
    }

    restoreRowState(row) {
        if (row.dataset.ebirrSkipped === "true") return;

        const firstCell = row.querySelector('td:first-child');
        if (!firstCell) return;
        const pageTxId = firstCell.innerText.trim();
        if (!pageTxId) return;

        const cached = localStorage.getItem(`ebirr_cache_${pageTxId}`);
        if (cached) {
            try {
                const data = JSON.parse(cached);

                // Check Expiration (Lazy Check)
                if (Date.now() - (data.timestamp || 0) > 30 * 60 * 1000) {
                    localStorage.removeItem(`ebirr_cache_${pageTxId}`);
                    return;
                }

                // RECONSTRUCT BUTTON LABEL IF MISSING (Fix for text-only issue)
                if (!data.buttonLabel) {
                    if (data.status === "Bank 404") data.buttonLabel = "Retry Bank Check";
                    else if (data.status === "Random") data.buttonLabel = "Reject Random";
                    else if (data.status === "Repeat") data.buttonLabel = `Reject Repeat (${data.repeatCount || 0})`;
                    else if (data.status === "Under 50") data.buttonLabel = "Reject Under 50";
                }

                const container = row.querySelector('.ebirr-controller');
                if (container) {
                    row.dataset.ebirrSkipped = "true";
                    
                    // Safety: Remove any open tooltip to prevent orphans when replacing the element
                    const existingTooltip = document.getElementById('ebirr-tooltip-popup');
                    if (existingTooltip) existingTooltip.remove();
                    
                    if (data.buttonLabel) {
                         container.innerHTML = '';
                         const btn = document.createElement('button');
                         const isWarning = data.status === "Bank 404" || data.status === "Repeat";
                         btn.className = isWarning ? 'btn btn-warning btn-xs' : 'btn btn-danger btn-xs';
                         const bgColor = isWarning ? '#f59e0b' : '#ef4444';
                         btn.style.cssText = `padding: 2px 8px; font-size: 11px; background-color: ${bgColor}; border: none; color: white; border-radius: 3px; cursor: pointer;`;
                         btn.innerText = data.buttonLabel;

                         if (data.status === "Bank 404") {
                             btn.onclick = (e) => {
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
                                e.stopPropagation();
                                const rejectLink = this.domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${this.domManager.columnIndexes.reject}) a`) : null;
                                if (rejectLink) {
                                    safeClick(rejectLink);
                                    this.domManager.waitForModalAndFill(data, 'reject', null, data.id, true);
                                }
                             };
                         }
                         
                         this.attachTooltip(btn, data);
                         container.appendChild(btn);
                         return;
                    }

                    const color = data.color || '#64748b';
                    const text = data.statusText || data.status;
                    
                    container.innerHTML = '';
                    const span = document.createElement('span');
                    span.style.cssText = `color:${color}; font-weight:bold; font-size:11px; cursor:help;`;
                    span.innerText = text;
                    this.attachTooltip(span, data);
                    container.appendChild(span);
                }
            } catch (e) {
                console.error("Error restoring row state", e);
            }
        }
    }

    attachTooltip(element, data) {
        let activeTooltip = null;

        element.addEventListener('mouseenter', () => {
            const existing = document.getElementById('ebirr-tooltip-popup');
            if (existing) existing.remove();

            const tooltip = document.createElement('div');
            tooltip.id = 'ebirr-tooltip-popup';
            tooltip.style.cssText = `
                position: absolute;
                background: rgba(15, 23, 42, 0.95);
                color: #e2e8f0;
                padding: 8px 12px;
                border-radius: 8px;
                font-size: 11px;
                font-family: 'Segoe UI', sans-serif;
                z-index: 2147483647;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                border: 1px solid #334155;
                pointer-events: none;
                white-space: nowrap;
                line-height: 1.5;
                backdrop-filter: blur(4px);
            `;
            
            let content = `<div style="font-weight:700; color:${data.color || '#fff'}; margin-bottom:6px; border-bottom: 1px solid #334155; padding-bottom: 6px; font-size:12px;">${data.statusText || data.status}</div>`;
            
            const fields = [
                { label: 'Transaction ID', val: data.id },
                { label: 'Original', val: data.originalStatus },
                { label: 'Amount', val: data.foundAmt },
                { label: 'Sender', val: data.senderName },
                { label: 'Recipient', val: data.foundName },
                { label: 'Time', val: data.timeStr },
                { label: 'Repeats', val: data.repeatCount },
                { label: 'Bank Result', val: data.bankCheckResult },
                { label: 'Processed By', val: data.processedBy }
            ];

            content += '<table style="border-collapse: collapse; width: 100%;">';
            fields.forEach(f => {
                if (f.val !== undefined && f.val !== null && f.val !== '-' && f.val !== 'N/A' && f.val !== 0) {
                    content += `<tr><td style="color:#94a3b8; padding-right:12px; padding-bottom:2px;">${f.label}:</td><td style="color:#f1f5f9; padding-bottom:2px;">${f.val}</td></tr>`;
                }
            });
            content += '</table>';
            
            tooltip.innerHTML = content;
            document.body.appendChild(tooltip);
            activeTooltip = tooltip;
            
            const rect = element.getBoundingClientRect();
            tooltip.style.top = `${rect.bottom + window.scrollY + 6}px`;
            tooltip.style.left = `${rect.left + window.scrollX + (rect.width / 2)}px`;
            tooltip.style.transform = 'translateX(-50%)';
        });

        element.addEventListener('mouseleave', () => {
            if (activeTooltip) {
                activeTooltip.remove();
                activeTooltip = null;
            }
        });

        element.addEventListener('mousedown', () => {
            if (activeTooltip) {
                activeTooltip.remove();
                activeTooltip = null;
            }
        });
    }
}
