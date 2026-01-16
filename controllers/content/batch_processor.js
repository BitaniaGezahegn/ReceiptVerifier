// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\content\batch_processor.js
import { SELECTORS, TIMEOUT_MS, MAX_CONCURRENCY, SPEED_CONFIG } from '../../utils/constants.js';
import { safeClick } from '../../utils/helpers.js';
import { showNotification, startCooldownTimer } from '../../ui/content/notifications.js';
import { playTransactionSound } from '../../services/sound_service.js';
import { processImageLocally } from '../../utils/image_processor.js';

export class BatchProcessor {
    constructor(domManager) {
        this.domManager = domManager;
        this.verificationState = new Map();
        this.isBatchRunning = false;
        this.activeBatchCount = 0;
        
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
                     startCooldownTimer(this.settings.autoRefreshInterval, () => this.processBatchQueue());
                     return;
                 }

                 const applyBtn = document.querySelector('#filter_form button[type="submit"]');
                 if (applyBtn) {
                     applyBtn.click();
                     const gapMs = Math.min(6000, Math.max(1000, this.settings.autoRefreshInterval * 100));
                     setTimeout(() => {
                         this.processBatchQueue(true);
                     }, gapMs);
                     return;
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

        const rawAmount = amountSpan.innerText.replace(/\s/g, '');
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
                console.error("Extension context invalidated:", e);
                this.handleExtensionInvalidated();
            }
        })
        .catch(err => {
            console.error("Image fetch failed:", err);
            if (err.message.includes("Extension context invalidated")) {
                this.handleExtensionInvalidated();
                return;
            }
            showNotification("Image Load Failed", "error");
            this.handleImageFailure(imgUrl);
            
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

    handleImageFailure(imgUrl) {
        const state = this.verificationState.get(imgUrl);
        if (!state) return;
        
        clearTimeout(state.timeoutId);
        this.verificationState.delete(imgUrl);
        
        const row = this.domManager.findRowByImgUrl(imgUrl);
        if (row) {
            row.dataset.ebirrSkipped = "true";
            const container = row.querySelector('.ebirr-controller');
            if (container) container.innerHTML = '<span style="color:#ef4444; font-weight:bold; font-size:11px;">Load Failed</span>';
        }
        showNotification("Image Request Failed", "error");
    }

    handleTimeout(imgUrl, rowId) {
        this.handleImageFailure(imgUrl);
        showNotification("Request Timed Out", "timeout");
        if (this.isBatchRunning) {
            this.activeBatchCount--;
            setTimeout(() => this.processBatchQueue(), this.speedConfig.batchDelay);
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

            if (this.settings.fullAutoMode) {
                // 1 Minute Cooldown in Dynamic Island
                startCooldownTimer(60, () => {
                    if (this.settings.fullAutoMode && document.body.contains(row)) {
                        this.activeBatchCount++;
                        this.startVerification(row, imgUrl);
                    }
                }, "API Cooldown");
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
        
        // Handle Skips (PDF/Random)
        if (result.status === "Random" || result.status === "PDF") {
            if (isPdfSkip) {
                 showNotification("Skipping PDF...", "timeout");
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
                 showNotification("Skipping Random...", "timeout");
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
                 showNotification(`Skipping High Repeat (${result.repeatCount})...`, "timeout");
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
}
