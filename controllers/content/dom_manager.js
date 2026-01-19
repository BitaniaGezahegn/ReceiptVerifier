// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\controllers\content\dom_manager.js
import { SELECTORS } from '../../utils/constants.js';
import { safeClick } from '../../utils/helpers.js';
import { showNotification } from '../../ui/content/notifications.js';
import { playAlertSound } from '../../services/sound_service.js';

export class DomManager {
    constructor() {
        this.columnIndexes = {};
        this.autoClickDelay = 3;
        this.modalPollMs = 200;
        this.rowPollMs = 500;
        this.pendingAlertSettings = { enabled: false, limit: 5, lastAlert: 0 };
        this.buttonState = { isRunning: false, isAuto: false, count: 0 };
    }

    updateSettings(speedConfig, pendingSettings) {
        if (speedConfig) {
            this.modalPollMs = speedConfig.modalPoll;
            this.rowPollMs = speedConfig.rowPoll;
            this.autoClickDelay = speedConfig.autoClickTimer;
        }
        if (pendingSettings) {
            this.pendingAlertSettings = pendingSettings;
        }
    }

    getColumnIndexes() {
        const header = document.querySelector(SELECTORS.headerRow) || 
                       document.querySelector('.table-vertical table tr.table-head') ||
                       document.querySelector('thead tr');

        if (!header) return;

        const headers = Array.from(header.querySelectorAll('th'));
        for (const key in SELECTORS.columnHeaders) {
            const headerText = SELECTORS.columnHeaders[key];
            const index = headers.findIndex(th => th.textContent.trim().includes(headerText));
            if (index !== -1) {
                this.columnIndexes[key] = index + 1;
            }
        }
    }

    scanAndInject(verificationState, callbacks) {
        this.checkPendingRequests();
        this.injectBatchControls(callbacks.onBatchToggle);

        const rows = document.querySelectorAll(SELECTORS.row);
        rows.forEach((row) => {
            if (row.classList.contains('table-head') || row.dataset.ebirrInjected) return;
            
            const imgLink = row.querySelector(SELECTORS.imageLink);
            if (!imgLink || !imgLink.href || !imgLink.href.startsWith('http')) return;

            row.dataset.ebirrInjected = "true";
            const activeState = verificationState.get(imgLink.href);
            this.injectController(row, imgLink.href, activeState, callbacks);
        });
    }

    checkPendingRequests() {
        if (!this.pendingAlertSettings.enabled) return;
        const countEl = document.querySelector('a[href*="pendingrequestrefill"] strong.error-txt');
        if (!countEl) return;

        const count = parseInt(countEl.innerText.trim());
        if (isNaN(count)) return;

        if (count > this.pendingAlertSettings.limit) {
            const now = Date.now();
            if (now - this.pendingAlertSettings.lastAlert > 30000) {
                playAlertSound();
                this.pendingAlertSettings.lastAlert = now;
                showNotification(`⚠️ High Pending Requests: ${count}`, "timeout");
            }
        }
    }

    injectBatchControls(onToggle) {
        const targetContainer = document.querySelector('.buttons-wrap');
        if (!targetContainer || document.getElementById('ebirr-batch-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'ebirr-batch-btn';
        btn.className = "btn btn-success"; 
        btn.style.cssText = "margin-left: 5px; background-color: #3b82f6; border-color: #3b82f6; color: white; min-width: 130px;";
        
        btn.onclick = (e) => {
            e.preventDefault();
            onToggle(btn);
        };

        targetContainer.appendChild(btn);
        this.updateBatchButtonVisuals(this.buttonState.isRunning, this.buttonState.isAuto, this.buttonState.count);
    }

    updateBatchButtonVisuals(isBatchRunning, fullAutoMode, pendingCount = 0) {
        this.buttonState = { isRunning: isBatchRunning, isAuto: fullAutoMode, count: pendingCount };
        const btn = document.getElementById('ebirr-batch-btn');
        if (!btn) return;

        if (isBatchRunning) {
            btn.style.backgroundColor = "#ef4444";
            btn.style.borderColor = "#ef4444";
            const modeLabel = fullAutoMode ? "Auto" : "Batch";
            const countText = pendingCount > 0 ? ` (${pendingCount})` : '';
            btn.innerHTML = `<i class="fa fa-stop"></i> Stop ${modeLabel}${countText}`;
        } else {
            if (fullAutoMode) {
                btn.style.backgroundColor = "#8b5cf6";
                btn.style.borderColor = "#8b5cf6";
                btn.innerHTML = `<i class="fa fa-robot"></i> Start Auto`;
            } else {
                btn.style.backgroundColor = "#3b82f6";
                btn.style.borderColor = "#3b82f6";
                btn.innerHTML = `<i class="fa fa-play"></i> Verify All`;
            }
        }
    }

    injectController(row, imgUrl, activeState, callbacks) {
        const confirmTd = row.querySelector('td:nth-child(2)');
        if (!confirmTd) return;

        let container = confirmTd.querySelector('.ebirr-controller');
        if (!container) {
            container = document.createElement('div');
            container.className = 'ebirr-controller';
            container.style.cssText = "display:inline-block; margin-left:5px; vertical-align:middle;";
            confirmTd.appendChild(container);
        }
        container.innerHTML = '';

        if (activeState && activeState.status === 'processing') {
            const btn = document.createElement('button');
            btn.innerText = "Cancel";
            btn.className = 'btn btn-danger btn-xs'; 
            btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #ef4444; border: none; color: white; border-radius: 3px; cursor: pointer;";
            btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); callbacks.onCancel(imgUrl); };
            container.appendChild(btn);
        } else {
            const btn = document.createElement('button');
            btn.innerText = "Verify";
            btn.className = 'btn btn-success btn-xs';
            btn.style.cssText = "padding: 2px 8px; font-size: 11px; background-color: #3b82f6; border: none; color: white; border-radius: 3px; cursor: pointer;";
            btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); callbacks.onVerify(row, imgUrl); };
            container.appendChild(btn);
        }
    }

    findRowByImgUrl(url) {
        if (!url) return null;
        const rows = document.querySelectorAll(SELECTORS.row);
        return Array.from(rows).find(r => {
            const link = r.querySelector(SELECTORS.imageLink);
            return link && link.href === url;
        });
    }

    waitForModalAndFill(result, mode, imgUrl, transId, isBatch) {
        const interval = setInterval(() => {
            const modal = document.querySelector(SELECTORS.modal);
            
            // Check for SweetAlert (Already Processed)
            const swal = document.querySelector('.swal2-popup, .swal-modal');
            if (swal && (swal.offsetParent !== null || window.getComputedStyle(swal).display !== 'none')) {
                 const text = (swal.innerText || "").toLowerCase();
                 if (text.includes("already been processed") || text.includes("already processed") || text.includes("payment not found")) {
                     clearInterval(interval);
                     showNotification("⚠️ Processed/Not Found (Skipping)", "error");
                     const okBtn = swal.querySelector('.swal2-confirm, .swal-button--confirm, button.swal2-styled');
                     if (okBtn) safeClick(okBtn);
                     const row = this.findRowByImgUrl(imgUrl);
                     if (row) row.remove();
                     return;
                 }
            }

            if (modal && modal.offsetParent !== null) {
                clearInterval(interval);
                // Handle "Already Processed" inside modal
                const text = (modal.innerText || "").toLowerCase();
                if (text.includes("already been processed") || text.includes("already processed") || text.includes("payment not found")) {
                    showNotification("⚠️ Processed/Not Found (Skipping)", "error");
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
                    const row = this.findRowByImgUrl(imgUrl);
                    if (row) row.remove();
                    return;
                }
                this.fillModalData(modal, result, mode, imgUrl, transId, isBatch);
            }
        }, this.modalPollMs);

        setTimeout(() => clearInterval(interval), 5000);
    }

    fillModalData(modal, result, mode, imgUrl, transId, isBatch) {
        const inputAmount = modal.querySelector(SELECTORS.modalInputAmount);
        const inputComment = modal.querySelector(SELECTORS.modalInputComment);
        const contentBlock = modal.querySelector('.wrap-filter');

        if (mode === 'confirm') {
            if (result.status.startsWith("AA")) {
                if (inputAmount) { inputAmount.value = result.foundAmt; inputAmount.dispatchEvent(new Event('input')); }
                if (inputComment) { inputComment.value = result.status; inputComment.dispatchEvent(new Event('input')); }
            } else {
                if (inputComment) { inputComment.value = ""; inputComment.dispatchEvent(new Event('input')); }
            }
        } else if (mode === 'reject') {
            if (inputComment) { inputComment.value = result.status; inputComment.dispatchEvent(new Event('input')); }
        }

        // Auto-Submit
        const submitBtn = modal.querySelector(SELECTORS.modalBtnConfirm);
        const cancelBtn = modal.querySelector(SELECTORS.modalBtnCancel);
        
        if (submitBtn && isBatch) {
            let countdown = this.autoClickDelay;
            const originalText = submitBtn.innerText;
            const abortController = new AbortController();
            
            const stopAutomation = () => {
                if (window.ebirrAutoClickTimer) { clearInterval(window.ebirrAutoClickTimer); window.ebirrAutoClickTimer = null; }
                submitBtn.innerText = originalText;
                abortController.abort();
            };

            submitBtn.addEventListener('click', stopAutomation, { signal: abortController.signal });
            if (cancelBtn) cancelBtn.addEventListener('click', stopAutomation, { signal: abortController.signal });

            if (countdown === 0) {
                abortController.abort();
                safeClick(submitBtn);
                this.monitorSubmission(modal, imgUrl);
            } else {
                submitBtn.innerText = `${originalText} (${countdown}s)`;
                if (window.ebirrAutoClickTimer) clearInterval(window.ebirrAutoClickTimer);
                window.ebirrAutoClickTimer = setInterval(() => {
                    countdown--;
                    if (countdown > 0) {
                        submitBtn.innerText = `${originalText} (${countdown}s)`;
                    } else {
                        clearInterval(window.ebirrAutoClickTimer);
                        window.ebirrAutoClickTimer = null;
                        submitBtn.innerText = originalText;
                        abortController.abort(); 
                        safeClick(submitBtn);
                        this.monitorSubmission(modal, imgUrl);
                    }
                }, 1000);
            }
        }

        // Inject Summary
        const oldSummary = modal.querySelector('.ebirr-summary');
        if (oldSummary) oldSummary.remove();

        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'ebirr-summary';
        summaryDiv.style.cssText = `margin: 10px 0; padding: 10px; border-radius: 4px; background: ${result.color}20; border: 1px solid ${result.color}; font-size: 12px; color: #333; position: relative;`;

        let originalStatusHtml = '';
        if (result.status === 'Repeat' && result.originalStatus) {
            let osColor = '#64748b';
            const s = result.originalStatus;
            if (s === 'Verified') osColor = '#4CAF50';
            else if (s === 'Old Receipt') osColor = '#ff9800';
            else if (s.startsWith('AA')) osColor = '#3b82f6';
            else if (s === 'Wrong Recipient' || s === 'Invalid ID' || s === 'Under 50') osColor = '#f44336';

            originalStatusHtml = `<div style="position:absolute; top:8px; right:8px; font-size:10px; padding:2px 6px; border-radius:4px; background:${osColor}; color:white; font-weight:bold; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">${s}</div>`;
        }

        const countHtml = (result.repeatCount > 0) ? `<span style="margin-left:auto; font-size:10px; background:#f1f5f9; padding:2px 5px; border-radius:4px;">Count: <b>${result.repeatCount + 1}</b></span>` : '';

        summaryDiv.innerHTML = `
            ${originalStatusHtml}
            <div style="font-weight:bold; color:${result.color}; margin-bottom:5px; padding-right: ${originalStatusHtml ? '80px' : '0'};">${result.statusText}</div>
            <div style="display:flex; align-items:center; gap:5px; margin-bottom:5px; font-size:11px; color:#64748b;">
                <span>ID: <b>${transId || 'N/A'}</b></span>
                <span id="ebirr-copy-id" style="cursor:pointer; font-size:12px;" title="Copy ID">📋</span>
                ${countHtml}
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                <div>Amount: <b>${result.foundAmt}</b></div>
                <div>${result.isReason ? 'Reason' : 'Name'}: <b>${result.foundName}</b></div>
                <div>Age: <b>${result.timeStr}</b></div>
                <div>Sender: <b>${result.senderName || '-'}</b></div>
            </div>
        `;

        const copyBtn = summaryDiv.querySelector('#ebirr-copy-id');
        if (copyBtn && transId && transId !== 'N/A') {
            copyBtn.onclick = (e) => {
                e.preventDefault();
                navigator.clipboard.writeText(transId);
                copyBtn.innerText = '✅';
                setTimeout(() => copyBtn.innerText = '📋', 1000);
            };
        }

        if (imgUrl) {
            const openBtn = document.createElement('a');
            openBtn.href = imgUrl;
            openBtn.target = "_blank";
            openBtn.innerText = "Open Image ↗";
            openBtn.style.cssText = "display:block; text-align:center; margin-top:8px; font-size:11px; color:#3b82f6; text-decoration:none; font-weight:600;";
            summaryDiv.appendChild(openBtn);
        }

        if (contentBlock) {
            const btnBlock = contentBlock.querySelector('.btn-block');
            if (btnBlock) contentBlock.insertBefore(summaryDiv, btnBlock);
            else contentBlock.appendChild(summaryDiv);
        }
    }

    monitorSubmission(modal, imgUrl) {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (!document.body.contains(modal) || modal.style.display === 'none' || modal.offsetParent === null) {
                clearInterval(checkInterval);
                return;
            }

            const text = (modal.innerText || "").toLowerCase();
            if (text.includes("already been processed") || text.includes("already processed") || text.includes("payment not found")) {
                clearInterval(checkInterval);
                showNotification("⚠️ Processed/Not Found (Closing)", "error");
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
                const row = this.findRowByImgUrl(imgUrl);
                if (row) row.remove();
                return;
            }
            
            const swal = document.querySelector('.swal2-popup, .swal-modal');
            if (swal && (swal.offsetParent !== null || window.getComputedStyle(swal).display !== 'none')) {
                 const swalText = (swal.innerText || "").toLowerCase();
                 if (swalText.includes("already been processed") || swalText.includes("already processed") || swalText.includes("payment not found")) {
                     clearInterval(checkInterval);
                     showNotification("⚠️ Processed/Not Found (Closing)", "error");
                     const okBtn = swal.querySelector('.swal2-confirm, .swal-button--confirm, button.swal2-styled');
                     if (okBtn) safeClick(okBtn);
                     const cancelBtn = modal.querySelector(SELECTORS.modalBtnCancel) || modal.querySelector('.btn-default');
                     if (cancelBtn) setTimeout(() => safeClick(cancelBtn), 500);
                     const row = this.findRowByImgUrl(imgUrl);
                     if (row) row.remove();
                 }
            }

            if (Date.now() - startTime > 10000) clearInterval(checkInterval);
        }, 500);
    }

    waitForRowRemoval(imgUrl, callback) {
        const maxRetries = Math.ceil(15000 / this.rowPollMs); 
        let retries = 0;
        const interval = setInterval(() => {
            const row = this.findRowByImgUrl(imgUrl);
            if (!row) {
                clearInterval(interval);
                if (callback) callback();
            } else if (retries++ >= maxRetries) {
                clearInterval(interval);
                if (callback) callback();
            }
        }, this.rowPollMs);
    }
}
