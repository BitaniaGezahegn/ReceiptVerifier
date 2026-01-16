// CONFIGURATION
const SELECTORS = {
    headerRow: 'tr[name="table-header"]', // More robust selector for the header
    row: '.table-vertical table tr:not(.table-head):not(.total-row)', // More specific
    amount: 'td.text-right span',
    // Use a robust selector for the image link based on its href attribute
    imageLink: 'a[href*="WebUserDocuments"]',
    
    // Column Headers for dynamic index finding. The text must match the header exactly.
    columnHeaders: {
        confirm: 'Confirm',
        reject: 'Reject',
    },
    
    // Modal Selectors
    modal: '.modal.modal_min',
    modalContent: '.modal_content',
    modalInputAmount: 'input[placeholder="Amount"]',
    modalInputComment: 'input[placeholder="Comment"]',
    modalBtnConfirm: '.modal_content button.btn-success', // The final submit button
    modalBtnCancel: '.modal_content button.btn-default',
    modalBtnReject: '.modal_content button.btn-danger' // Assuming reject button class based on context, usually btn-danger or similar if present in modal for reject flow
};

const TIMEOUT_MS = 30000; // Increased to 30s for AI latency

// BATCH CONFIGURATION
const MAX_CONCURRENCY = 1;   // Process 1 at a time to be extra safe

// Speed Profiles
const SPEED_CONFIG = {
    very_slow: { batchDelay: 5000, modalPoll: 500, rowPoll: 1000, autoClickTimer: 5 },
    slow:      { batchDelay: 3500, modalPoll: 300, rowPoll: 800,  autoClickTimer: 4 },
    normal:    { batchDelay: 3000, modalPoll: 200, rowPoll: 500,  autoClickTimer: 3 },
    fast:      { batchDelay: 1500, modalPoll: 100, rowPoll: 300,  autoClickTimer: 1 },
    very_fast: { batchDelay: 500,  modalPoll: 50,  rowPoll: 100,  autoClickTimer: 0 }
};

// STATE MANAGEMENT: Map<ImageURL, { status, rowId, timestamp, timeoutId, result }>
const verificationState = new Map();

const columnIndexes = {};
// BATCH STATE
let isBatchRunning = false;
let activeBatchCount = 0;

// Alert Settings
let pendingAlertSettings = {
    enabled: false,
    limit: 5,
    lastAlert: 0
};

let transactionSoundEnabled = false;
let skipPdfEnabled = false;
let skipRandomEnabled = false;
let skipRepeatEnabled = true;
let repeatLimit = 3;
let retryWrongRecipient = false;
let retryVerified = false;
let fullAutoMode = false;
let autoRefreshInterval = 30;

// Dynamic Speed Variables (Default to Normal)
let batchDelayMs = 2500;
let modalPollMs = 200;
let rowPollMs = 500;
let autoClickDelay = 3;

// Batch Settings
let batchSettings = {
    reverseOrder: false
};

function handleExtensionInvalidated() {
    showNotification("Extension updated. Refreshing page...", "error");
    if (isBatchRunning) stopBatch();
    setTimeout(() => window.location.reload(), 1500);
}

function init() {
    console.log("Ebirr Verifier: Integration loaded.");
    
    // Load settings
    chrome.storage.local.get(['pendingAlertEnabled', 'pendingLimit', 'batchReverse', 'transactionSoundEnabled', 'skipPdfEnabled', 'skipRandomEnabled', 'skipRepeatEnabled', 'repeatLimit', 'retryWrongRecipient', 'retryVerified', 'fullAutoMode', 'autoRefreshInterval', 'processingSpeed'], (result) => {
        pendingAlertSettings.enabled = result.pendingAlertEnabled || false;
        pendingAlertSettings.limit = parseInt(result.pendingLimit) || 5;
        batchSettings.reverseOrder = result.batchReverse || false;
        transactionSoundEnabled = result.transactionSoundEnabled || false;
        skipPdfEnabled = result.skipPdfEnabled || false;
        skipRandomEnabled = result.skipRandomEnabled || false;
        skipRepeatEnabled = result.skipRepeatEnabled !== false;
        repeatLimit = parseInt(result.repeatLimit) || 3;
        retryWrongRecipient = result.retryWrongRecipient || false;
        retryVerified = result.retryVerified || false;
        fullAutoMode = result.fullAutoMode || false;
        autoRefreshInterval = parseInt(result.autoRefreshInterval) || 30;
        updateSpeedSettings(result.processingSpeed || 'normal');
        updateBatchButtonVisuals();
    });

    getColumnIndexes();
    scanAndInject();
    injectBatchControls();

    // Watch for dynamic content (SPA)
    const observer = new MutationObserver((mutations) => {
        getColumnIndexes();
        scanAndInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for results from background
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);
    
    // Listen for settings changes
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.pendingAlertEnabled) pendingAlertSettings.enabled = changes.pendingAlertEnabled.newValue;
        if (changes.pendingLimit) pendingAlertSettings.limit = parseInt(changes.pendingLimit.newValue);
        if (changes.batchReverse) batchSettings.reverseOrder = changes.batchReverse.newValue;
        if (changes.transactionSoundEnabled) transactionSoundEnabled = changes.transactionSoundEnabled.newValue;
        if (changes.skipPdfEnabled) skipPdfEnabled = changes.skipPdfEnabled.newValue;
        if (changes.skipRandomEnabled) skipRandomEnabled = changes.skipRandomEnabled.newValue;
        if (changes.skipRepeatEnabled) skipRepeatEnabled = changes.skipRepeatEnabled.newValue;
        if (changes.repeatLimit) repeatLimit = parseInt(changes.repeatLimit.newValue);
        if (changes.retryWrongRecipient) retryWrongRecipient = changes.retryWrongRecipient.newValue;
        if (changes.retryVerified) retryVerified = changes.retryVerified.newValue;
        if (changes.fullAutoMode) fullAutoMode = changes.fullAutoMode.newValue;
        if (changes.autoRefreshInterval) autoRefreshInterval = parseInt(changes.autoRefreshInterval.newValue) || 30;
        if (changes.processingSpeed) updateSpeedSettings(changes.processingSpeed.newValue);
        if (changes.fullAutoMode) updateBatchButtonVisuals();
    });
}

function getColumnIndexes() {
    // Try multiple selectors for robustness
    const header = document.querySelector(SELECTORS.headerRow) || 
                   document.querySelector('.table-vertical table tr.table-head') ||
                   document.querySelector('thead tr');

    if (!header) {
        // Only warn if a table exists but we can't find the header
        if (document.querySelector(SELECTORS.row)) {
            console.warn("Ebirr Verifier: Could not find table header row to determine column order.");
        }
        return;
    }

    const headers = Array.from(header.querySelectorAll('th'));
    for (const key in SELECTORS.columnHeaders) {
        const headerText = SELECTORS.columnHeaders[key];
        // Use .includes() for flexibility, in case of extra spaces or sort icons
        const index = headers.findIndex(th => th.textContent.trim().includes(headerText));
        if (index !== -1) {
            columnIndexes[key] = index + 1; // nth-child is 1-based
        }
    }
}

function updateSpeedSettings(level) {
    const config = SPEED_CONFIG[level] || SPEED_CONFIG.normal;
    batchDelayMs = config.batchDelay;
    modalPollMs = config.modalPoll;
    rowPollMs = config.rowPoll;
    autoClickDelay = config.autoClickTimer;
}

function injectBatchControls() {
    const targetContainer = document.querySelector('.buttons-wrap');
    if (!targetContainer) return;

    if (document.getElementById('ebirr-batch-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ebirr-batch-btn';
    btn.className = "btn btn-success"; 
    btn.style.cssText = "margin-left: 5px; background-color: #3b82f6; border-color: #3b82f6; color: white; min-width: 130px;";
    
    updateBatchButtonVisuals(btn);
    
    btn.onclick = (e) => {
        e.preventDefault();
        if (isBatchRunning) {
            stopBatch();
            updateBatchButtonVisuals(btn);
        } else {
            startBatch();
            updateBatchButtonVisuals(btn);
        }
    };

    targetContainer.appendChild(btn);
}

function updateBatchButtonVisuals(btn) {
    if (!btn) btn = document.getElementById('ebirr-batch-btn');
    if (!btn) return;

    if (isBatchRunning) {
        btn.style.backgroundColor = "#ef4444";
        btn.style.borderColor = "#ef4444";
        const modeLabel = fullAutoMode ? "Auto" : "Batch";
        btn.innerHTML = `<i class="fa fa-stop"></i> Stop ${modeLabel}`;
    } else {
        if (fullAutoMode) {
            btn.style.backgroundColor = "#8b5cf6"; // Purple
            btn.style.borderColor = "#8b5cf6";
            btn.innerHTML = `<i class="fa fa-robot"></i> Start Auto`;
        } else {
            btn.style.backgroundColor = "#3b82f6"; // Blue
            btn.style.borderColor = "#3b82f6";
            btn.innerHTML = `<i class="fa fa-play"></i> Verify All`;
        }
    }
}

function startBatch() {
    isBatchRunning = true;
    activeBatchCount = 0;
    processBatchQueue();
}

function stopBatch() {
    isBatchRunning = false;
    if (window.ebirrRefreshTimer) {
        clearInterval(window.ebirrRefreshTimer);
        window.ebirrRefreshTimer = null;
        const island = document.getElementById('ebirr-dynamic-island');
        if (island) island.style.top = '-80px';
    }
}

function processBatchQueue(fromReloadCheck = false) {
    if (!isBatchRunning) return;

    if (activeBatchCount < MAX_CONCURRENCY) {
        // DYNAMIC SCAN: Find the first eligible row in the DOM (Top-down)
        let rows = Array.from(document.querySelectorAll(SELECTORS.row));
        
        if (batchSettings.reverseOrder) {
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
            const isProcessing = verificationState.has(imgUrl);
            const isSkipped = row.dataset.ebirrSkipped === "true";
            
            if (!isVerified && !isProcessing && !isSkipped) {
                const urlPath = imgUrl.split('?')[0].toLowerCase();
                if (skipPdfEnabled && urlPath.endsWith('.pdf')) {
                    row.dataset.ebirrSkipped = "true";
                    const container = row.querySelector('.ebirr-controller');
                    if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF</span>';
                    playTransactionSound('pdf');
                    continue;
                }

                if (!targetRow) {
                    targetRow = row;
                    targetUrl = imgUrl;
                }
                pendingCount++;
            } else if (isProcessing) {
                pendingCount++; // Count currently processing items as pending
            }
        }

        if (targetRow && targetUrl) {
            activeBatchCount++;
            startVerification(targetRow, targetUrl);
            
            // Update button text with progress
            const btn = document.getElementById('ebirr-batch-btn');
            if (btn) {
                 const modeLabel = fullAutoMode ? "Auto" : "Batch";
                 btn.innerHTML = `<i class="fa fa-stop"></i> Stop ${modeLabel} (${pendingCount})`;
            }
        }
    }
    
    // Check if we are done (No active tasks and no target found in previous block)
    if (activeBatchCount === 0) {
        if (fullAutoMode && isBatchRunning) {
             // If we just reloaded and found nothing, start the long timer
             if (fromReloadCheck) {
                 startCooldownTimer(autoRefreshInterval, processBatchQueue);
                 return;
             }

             const applyBtn = document.querySelector('#filter_form button[type="submit"]');
             if (applyBtn) {
                 applyBtn.click();
                 
                 // Wait for reload (10% of interval, min 1s, max 6s)
                 const gapMs = Math.min(6000, Math.max(1000, autoRefreshInterval * 100));
                 
                 setTimeout(() => {
                     processBatchQueue(true);
                 }, gapMs);
                 
                 return;
             }
        }

        stopBatch();
        updateBatchButtonVisuals();
        showNotification("Batch Complete", "success");
    }
}

function scanAndInject() {
    checkPendingRequests();
    injectBatchControls();

    const rows = document.querySelectorAll(SELECTORS.row);
    rows.forEach((row, index) => {
        // Skip header or already injected rows
        if (row.classList.contains('table-head') || row.dataset.ebirrInjected) return;
        
        // Ensure it has an image link
        const imgLink = row.querySelector(SELECTORS.imageLink);
        if (!imgLink) return;

        if (!imgLink.href || !imgLink.href.startsWith('http')) return;
        const imgUrl = imgLink.href;
        
        // Mark as injected to prevent duplicate buttons
        row.dataset.ebirrInjected = "true";
        
        // Check if we have an active state for this image (SPA Persistence)
        const activeState = verificationState.get(imgUrl);

        // Inject Controller
        injectController(row, imgUrl, activeState);
    });
}

function checkPendingRequests() {
    if (!pendingAlertSettings.enabled) return;

    // Selector based on sample-management-page.html
    const countEl = document.querySelector('a[href*="pendingrequestrefill"] strong.error-txt');
    if (!countEl) return;

    const count = parseInt(countEl.innerText.trim());
    if (isNaN(count)) return;

    if (count > pendingAlertSettings.limit) {
        const now = Date.now();
        // Alert every 30 seconds if condition persists
        if (now - pendingAlertSettings.lastAlert > 30000) {
            playAlertSound();
            pendingAlertSettings.lastAlert = now;
            showNotification(`⚠️ High Pending Requests: ${count}`, "timeout");
        }
    }
}

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 880; // A5
        gain.gain.value = 0.1;
        osc.start();
        setTimeout(() => { osc.stop(); }, 200); // Short beep
    } catch (e) {
        console.error("Audio play failed", e);
    }
}

function playTransactionSound(type) {
    if (!transactionSoundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        
        const now = ctx.currentTime;
        if (type === 'success') {
            // Cha-Ching! (Coin sound)
            const osc1 = ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1200, now);
            osc1.frequency.exponentialRampToValueAtTime(2000, now + 0.1);
            osc1.connect(gain);
            osc1.start(now);
            osc1.stop(now + 0.4);

            const osc2 = ctx.createOscillator();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(2000, now + 0.05);
            osc2.frequency.exponentialRampToValueAtTime(3000, now + 0.2);
            osc2.connect(gain);
            osc2.start(now + 0.05);
            osc2.stop(now + 0.4);

            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        } else if (type === 'error') {
            // Stronger Error (Sawtooth Buzz)
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(50, now + 0.3);
            osc.connect(gain);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'pdf' || type === 'random') {
            // PDF/Random Skip - Soft "Whoosh" (Sine Drop)
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
            osc.connect(gain);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch (e) {
        console.error("Sound error", e);
    }
}

function injectController(row, imgUrl, activeState) {
    const confirmTd = row.querySelector('td:nth-child(2)');
    if (!confirmTd) return;

    // Container for our UI
    let container = confirmTd.querySelector('.ebirr-controller');
    if (!container) {
        container = document.createElement('div');
        container.className = 'ebirr-controller';
        container.style.cssText = "display:inline-block; margin-left:5px; vertical-align:middle;";
        confirmTd.appendChild(container);
    }

    // Clear previous content
    container.innerHTML = '';

    if (activeState && activeState.status === 'processing') {
        // RENDER: Processing State
        const btn = document.createElement('button');
        btn.innerText = "Cancel";
        btn.className = 'btn btn-danger btn-xs'; 
        btn.style.cssText = `
            padding: 2px 8px; font-size: 11px; 
            background-color: #ef4444; border: none; color: white; 
            border-radius: 3px; cursor: pointer;
        `;
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelVerification(imgUrl);
        };
        container.appendChild(btn);
    } else {
        // RENDER: Idle State
        const btn = document.createElement('button');
        btn.innerText = "Verify";
        btn.className = 'btn btn-success btn-xs';
        btn.style.cssText = `
            padding: 2px 8px; font-size: 11px; 
            background-color: #3b82f6; border: none; color: white; 
            border-radius: 3px; cursor: pointer;
        `;
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            startVerification(row, imgUrl);
        };
        container.appendChild(btn);
    }
}

function startVerification(row, imgUrl) {
    const amountSpan = row.querySelector(SELECTORS.amount);
    
    if (!amountSpan) {
        alert("Error: Could not find amount.");
        return;
    }

    // 1. Parse Amount (Remove spaces, e.g. "1 200" -> 1200)
    const rawAmount = amountSpan.innerText.replace(/\s/g, '');
    const amount = parseFloat(rawAmount);

    // 2. Generate Request ID
    const rowId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 3. Set State
    const timeoutId = setTimeout(() => {
        handleTimeout(imgUrl, rowId);
    }, TIMEOUT_MS);

    verificationState.set(imgUrl, {
        status: 'processing',
        rowId: rowId,
        timestamp: Date.now(),
        timeoutId: timeoutId,
        amount: amount
    });

    // 4. Update UI immediately
    injectController(row, imgUrl, verificationState.get(imgUrl));

    showNotification("Initializing...", "process");

    // 5. Fetch All Images in Row (Handle Multiple Images)
    const imageLinks = Array.from(row.querySelectorAll(SELECTORS.imageLink))
        .map(a => a.href)
        .filter(href => href && href.startsWith('http'));

    // Check for PDF in any link (Skip row if PDF exists)
    const hasPdf = imageLinks.some(url => url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?'));
    if (hasPdf && isBatchRunning && skipPdfEnabled) {
         clearTimeout(timeoutId);
         verificationState.delete(imgUrl);
         
         row.dataset.ebirrSkipped = "true";
         const container = row.querySelector('.ebirr-controller');
         if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF (Multi)</span>';
         playTransactionSound('pdf');
         
         if (isBatchRunning) {
            activeBatchCount--;
            setTimeout(processBatchQueue, batchDelayMs);
         }
         return;
    }

    if (imageLinks.length > 1) {
        showNotification(`Scanning ${imageLinks.length} image(s)...`, "process");
    } else {
        showNotification("Processing Image...", "process");
    }
    
    Promise.all(imageLinks.map(url => 
        new Promise((resolve, reject) => {
            const isPdf = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('.pdf?');
            const action = isPdf ? "capturePdf" : "fetchImageBase64";
            
            try {
                if (!chrome.runtime || !chrome.runtime.sendMessage) {
                    throw new Error("Extension context invalidated");
                }
                chrome.runtime.sendMessage({ action: action, url: url }, (response) => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message;
                        if (msg.includes("Extension context invalidated")) {
                            reject(new Error("Extension context invalidated"));
                            return; 
                        }
                        reject(new Error(msg));
                    } else if (response && (response.data || response.dataUrl || response.dataUrls)) {
                        // Handle Single or Multi-Page (PDF) responses
                        let rawImages = [];
                        if (response.dataUrls) {
                            rawImages = response.dataUrls;
                        } else {
                            rawImages = [response.dataUrl || ("data:image/jpeg;base64," + response.data)];
                        }

                        // Generate two versions: Clean (No filters) and Enhanced (Filters)
                        Promise.all(rawImages.map(imgData => Promise.all([
                            processImageLocally(imgData, false), // Returns Array of slices
                            processImageLocally(imgData, true)   // Returns Array of slices
                        ]))).then(results => {
                            // Map slices to image objects (cleanSlices and enhancedSlices are aligned)
                            const sliceObjects = [];
                            results.forEach(([cleanSlices, enhancedSlices]) => {
                                cleanSlices.forEach((clean, i) => {
                                    sliceObjects.push({
                                        url: url,
                                        cleanDataUrl: clean,
                                        enhancedDataUrl: enhancedSlices[i] || null
                                    });
                                });
                            });
                            resolve(sliceObjects);
                        }).catch(() => resolve([{ url, cleanDataUrl: rawImages[0] }]));
                    } else {
                        reject(new Error(response?.error || "Failed to fetch image data"));
                    }
                });
            } catch (e) {
                reject(e);
            }
        })
    ))
    .then(nestedImages => {
        const images = nestedImages.flat(); // Flatten array of arrays (slices)
        try {
            if (!chrome.runtime || !chrome.runtime.sendMessage) {
                throw new Error("Extension context invalidated");
            }
            chrome.runtime.sendMessage({
                action: "verifyMultiIntegration",
                images: images, // Array of {url, dataUrl}
                amount: amount,
                rowId: rowId,
                primaryUrl: imgUrl // Keep track of the key
            }, (response) => {
                if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes("Extension context invalidated")) {
                    handleExtensionInvalidated();
                }
            });
        } catch (e) {
            console.error("Extension context invalidated:", e);
            handleExtensionInvalidated();
        }
    })
        .catch(err => {
            console.error("Image fetch failed:", err);
            
            if (err.message.includes("Extension context invalidated")) {
                handleExtensionInvalidated();
                return;
            }

            showNotification("Image Load Failed", "error");
            handleImageFailure(imgUrl);
            
            // Ensure batch continues if running (since handleImageFailure doesn't do this)
            if (isBatchRunning) {
                activeBatchCount--;
                setTimeout(processBatchQueue, batchDelayMs);
            }
        });
}

function cancelVerification(imgUrl) {
    const state = verificationState.get(imgUrl);
    if (state) {
        clearTimeout(state.timeoutId);
        verificationState.delete(imgUrl);
    }

    const row = findRowByImgUrl(imgUrl);
    if (row) injectController(row, imgUrl, null);

    showNotification("Operation Cancelled", "error");
}

function handleImageFailure(imgUrl) {
    const state = verificationState.get(imgUrl);
    if (!state) return;
    
    clearTimeout(state.timeoutId);
    verificationState.delete(imgUrl);
    
    const row = findRowByImgUrl(imgUrl);
    if (row) {
        // Mark as skipped to prevent re-processing in batch mode
        row.dataset.ebirrSkipped = "true";
        const container = row.querySelector('.ebirr-controller');
        if (container) {
            // Directly update UI to show a permanent failure state for this row
            container.innerHTML = '<span style="color:#ef4444; font-weight:bold; font-size:11px;">Load Failed</span>';
        }
    }
    showNotification("Image Request Failed", "error");
}

function handleTimeout(imgUrl, rowId) {
    // Treat timeout as failure, which triggers next image
    handleImageFailure(imgUrl);

    showNotification("Request Timed Out", "timeout");
    
    // Batch Logic: Decrement and continue
    if (isBatchRunning) {
        activeBatchCount--;
        setTimeout(processBatchQueue, batchDelayMs);
    }
}

// Helper to find row even if DOM refreshed
function findRowByImgUrl(url) {
    if (!url) return null;
    const rows = document.querySelectorAll(SELECTORS.row);
    return Array.from(rows).find(r => {
        const link = r.querySelector(SELECTORS.imageLink);
        return link && link.href === url;
    });
}

function handleBackgroundMessage(request) {
    // 1. Handle Status Updates (No state change, just notification)
    if (request.action === "updateStatus") {
        showNotification(request.message, "process");
        return;
    }

    // Handle remote rejection command from the image tab
    if (request.action === "executeReject") {
        const row = findRowByImgUrl(request.imgUrl);
        if (!row) return;

        const rejectLink = columnIndexes.reject ? row.querySelector(`td:nth-child(${columnIndexes.reject}) a`) : null;
        if (rejectLink) {
            safeClick(rejectLink);
            waitForModalAndFill(request.data, 'reject', request.imgUrl, request.extractedId, false);
        }
        return;
    }

    if (request.action !== "integrationResult") return;

    const imgUrl = request.imgUrl;
    const state = verificationState.get(imgUrl);

    // If state is missing, user likely cancelled or it timed out already
    if (!state) return;

    // Strict check to prevent race conditions
    if (request.rowId && state.rowId !== request.rowId) return;

    // Cleanup State
    clearTimeout(state.timeoutId);
    verificationState.delete(imgUrl);

    // Update UI
    const row = findRowByImgUrl(imgUrl);
    if (!row) return;
    
    injectController(row, imgUrl, null); // Reset to "Verify" button

    // Batch Logic: Decrement active count
    if (isBatchRunning) activeBatchCount--;

    // We will decide whether to continue the batch based on the result below
    // to prevent skipping ahead if manual intervention is needed.

    if (!request.success) {
        showNotification("Failed", "error");
        alert("Verification Failed: " + request.error);
        return;
    }

    const result = request.data;

    // API LIMIT HANDLING
    if (result.status === "API Limit") {
        showNotification("⚠️ API Limit Reached", "error");
        playTransactionSound('error');

        if (fullAutoMode) {
            showNotification("Auto-Retry in 3 minutes...", "timeout");
            let timerId = null;

            if (row) {
                const container = row.querySelector('.ebirr-controller');
                if (container) {
                    let remaining = 180;
                    container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Cooldown (3m 0s)</span>';
                    
                    timerId = setInterval(() => {
                        if (!document.body.contains(row)) {
                            clearInterval(timerId);
                            return;
                        }
                        remaining--;
                        if (remaining <= 0) {
                            clearInterval(timerId);
                            container.innerHTML = '<span style="color:#3b82f6; font-weight:bold; font-size:11px;">Retrying...</span>';
                        } else {
                            const m = Math.floor(remaining / 60);
                            const s = remaining % 60;
                            container.innerHTML = `<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Cooldown (${m}m ${s}s)</span>`;
                        }
                    }, 1000);
                }
            }
            setTimeout(() => {
                if (timerId) clearInterval(timerId);
                if (fullAutoMode && document.body.contains(row)) {
                    activeBatchCount++;
                    startVerification(row, imgUrl);
                } else if (document.body.contains(row)) {
                    injectController(row, imgUrl, null);
                }
            }, 180000);
        }
        return;
    }

    const isVerified = result.status === "Verified";
    const isAA = result.status.startsWith("AA"); // Amount Mismatch

    // Determine if we are about to skip (to prevent double sounds)
    const isPdfSkip = result.status === "PDF" && isBatchRunning && skipPdfEnabled;
    const isRandomSkip = result.status === "Random" && isBatchRunning && skipRandomEnabled;
    const isRepeatSkip = isBatchRunning && result.repeatCount >= 3;
    const isSkipping = isPdfSkip || isRandomSkip || isRepeatSkip;

    if (isVerified || isAA) {
        playTransactionSound('success');
    } else if (!isSkipping) {
        playTransactionSound('error');
    }

    showNotification("Verification Complete", "success");
    
    if (result.status === "Random" || result.status === "PDF") {
        if (result.status === "PDF" && isBatchRunning && skipPdfEnabled) {
             showNotification("Skipping PDF...", "timeout");
             if (row) {
                 row.dataset.ebirrSkipped = "true";
                 const container = row.querySelector('.ebirr-controller');
                 if (container) container.innerHTML = '<span style="color:#f59e0b; font-weight:bold; font-size:11px;">Skipped PDF</span>';
             }
             playTransactionSound('pdf');
             setTimeout(processBatchQueue, 500);
             return;
        }
        
        if (result.status === "Random" && isBatchRunning && skipRandomEnabled) {
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
                        const rejectLink = columnIndexes.reject ? row.querySelector(`td:nth-child(${columnIndexes.reject}) a`) : null;
                        if (rejectLink) {
                            safeClick(rejectLink);
                            waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true);
                        }
                    };
                    container.appendChild(btn);
                 }
             }
             playTransactionSound('random');
             setTimeout(processBatchQueue, 500);
             return;
        }

        showNotification(result.statusText || "Review Required", "error");
        const imgLink = row.querySelector(SELECTORS.imageLink);
        if (imgLink) {
            // Ask background to open the image and inject the control modal there
            chrome.runtime.sendMessage({ 
                action: "openRandomReview", 
                url: imgLink.href, 
                rowId: request.rowId,
                extractedId: request.extractedId,
                isPdf: result.status === "PDF"
            });
        }
        // STOP BATCH on Random/PDF to allow manual review
        if (isBatchRunning) {
            stopBatch();
            const btn = document.getElementById('ebirr-batch-btn');
            if (btn) { 
                btn.innerHTML = `<i class="fa fa-play"></i> Resume ${fullAutoMode ? "Auto" : "Batch"}`; 
                btn.style.backgroundColor = "#f59e0b"; 
                btn.style.borderColor = "#f59e0b";
            }
            showNotification("Batch Paused (Review Required)", "timeout");
        }
        return;
    }

    // Skip excessive repeats in Batch/Auto mode
    if (isBatchRunning && skipRepeatEnabled && result.repeatCount >= repeatLimit) {
         const isWrongRecip = result.originalStatus === 'Wrong Recipient';
         const isVerifiedStatus = result.originalStatus === 'Verified';
         
         if ((isWrongRecip && retryWrongRecipient) || (isVerifiedStatus && retryVerified)) {
             // Do not skip - proceed to automation logic below
         } else {
             // Skip
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
                    const rejectLink = columnIndexes.reject ? row.querySelector(`td:nth-child(${columnIndexes.reject}) a`) : null;
                    if (rejectLink) {
                        safeClick(rejectLink);
                        waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, true);
                    }
                };
                container.appendChild(btn);
             }
         }
         playTransactionSound('random');
         setTimeout(processBatchQueue, 500);
         return;
         }
    }

    // AUTOMATION LOGIC
    const runAutomation = () => {
        if (isVerified || isAA) {
            // 1. Click Confirm Link
            const confirmLink = columnIndexes.confirm ? row.querySelector(`td:nth-child(${columnIndexes.confirm}) a`) : null;
            if (confirmLink) {
                safeClick(confirmLink);
                waitForModalAndFill(result, 'confirm', request.imgUrl, request.extractedId, isBatchRunning);
            }
        } else {
            // 2. Click Reject Link (Wrong Recipient, Old Receipt, etc)
            const rejectLink = columnIndexes.reject ? row.querySelector(`td:nth-child(${columnIndexes.reject}) a`) : null;
            if (rejectLink) {
                safeClick(rejectLink);
                waitForModalAndFill(result, 'reject', request.imgUrl, request.extractedId, isBatchRunning);
            }
        }

        // Continue Batch if successful/handled
        if (isBatchRunning) {
            waitForRowRemoval(request.imgUrl);
        }
    };

    // Check if a modal is already open (User might be doing manual work)
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

function waitForModalAndFill(result, mode, imgUrl, transId, isBatch) {
    // Poll for modal visibility
    const interval = setInterval(() => {
        const modal = document.querySelector(SELECTORS.modal);
        
        // Check for SweetAlert (Common for "Already Processed" errors)
        const swal = document.querySelector('.swal2-popup, .swal-modal');
        if (swal && (swal.offsetParent !== null || window.getComputedStyle(swal).display !== 'none')) {
             const text = (swal.innerText || "").toLowerCase();
             if (text.includes("already been processed") || text.includes("already processed")) {
                 clearInterval(interval);
                 showNotification("⚠️ Already Processed (Skipping)", "timeout");
                 
                 const okBtn = swal.querySelector('.swal2-confirm, .swal-button--confirm, button.swal2-styled');
                 if (okBtn) safeClick(okBtn);
                 
                 const row = findRowByImgUrl(imgUrl);
                 if (row) row.remove();
                 return;
             }
        }

        // Check if modal exists and is visible (site might use display:block or opacity)
        if (modal && modal.offsetParent !== null) {
            clearInterval(interval);

            // Handle "Already Processed" Conflict
            const text = (modal.innerText || "").toLowerCase();
            if (text.includes("already been processed") || text.includes("already processed")) {
                showNotification("⚠️ Already Processed (Skipping)", "timeout");
                
                // Close the modal
                const closeBtn = modal.querySelector(SELECTORS.modalBtnCancel) || 
                                 modal.querySelector('.btn-default, .btn-secondary, .close') || 
                                 Array.from(modal.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('close') || b.innerText.toLowerCase().includes('cancel'));

                if (closeBtn) safeClick(closeBtn);
                
                // Manually remove row so waitForRowRemoval sees it as done and continues batch
                const row = findRowByImgUrl(imgUrl);
                if (row) row.remove();
                
                return;
            }

            fillModalData(modal, result, mode, imgUrl, transId, isBatch);
        }
    }, modalPollMs);

    // Timeout after 5 seconds
    setTimeout(() => clearInterval(interval), 5000);
}

function waitForRowRemoval(imgUrl) {
    // Poll to check if the row has been removed from the DOM
    // Calculate retries based on 15 seconds max wait
    const maxRetries = Math.ceil(15000 / rowPollMs); 
    let retries = 0;

    const interval = setInterval(() => {
        const row = findRowByImgUrl(imgUrl);
        if (!row) {
            // Row is gone! Safe to proceed.
            clearInterval(interval);
            setTimeout(processBatchQueue, batchDelayMs);
        } else if (retries++ >= maxRetries) {
            // Timeout waiting for row to disappear. Proceed anyway to avoid stall.
            clearInterval(interval);
            setTimeout(processBatchQueue, batchDelayMs);
        }
    }, rowPollMs);
}

function fillModalData(modal, result, mode, imgUrl, transId, isBatch) {
    const inputAmount = modal.querySelector(SELECTORS.modalInputAmount);
    const inputComment = modal.querySelector(SELECTORS.modalInputComment);
    const contentBlock = modal.querySelector('.wrap-filter'); // Container to append details

    // 1. Handle Inputs
    if (mode === 'confirm') {
        if (result.status.startsWith("AA")) {
            // Amount Mismatch: Update Amount and Comment
            if (inputAmount) {
                inputAmount.value = result.foundAmt;
                inputAmount.dispatchEvent(new Event('input')); // Trigger Vue/React listeners
            }
            if (inputComment) {
                inputComment.value = result.status; // "AA is 500"
                inputComment.dispatchEvent(new Event('input'));
            }
        } else {
            // Verified: Clear comment just in case
            if (inputComment) {
                inputComment.value = "";
                inputComment.dispatchEvent(new Event('input'));
            }
        }
    } else if (mode === 'reject') {
        // Reject: Fill reason
        if (inputComment) {
            inputComment.value = result.status; // "Wrong Recipient", "Old Receipt"
            inputComment.dispatchEvent(new Event('input'));
        }
    }

    // 3. Auto-Submit with Safety Countdown
    const submitBtn = modal.querySelector(SELECTORS.modalBtnConfirm);
    const cancelBtn = modal.querySelector(SELECTORS.modalBtnCancel);
    
    if (submitBtn && isBatch) {
        let countdown = autoClickDelay;
        const originalText = submitBtn.innerText;
        
        // Safety: Stop automation if user clicks manually
        const abortController = new AbortController();
        const stopAutomation = () => {
            if (window.ebirrAutoClickTimer) {
                clearInterval(window.ebirrAutoClickTimer);
                window.ebirrAutoClickTimer = null;
            }
            submitBtn.innerText = originalText;
            abortController.abort();
        };

        submitBtn.addEventListener('click', stopAutomation, { signal: abortController.signal });
        if (cancelBtn) cancelBtn.addEventListener('click', stopAutomation, { signal: abortController.signal });

        if (countdown === 0) {
            // Instant Click
            abortController.abort();
            safeClick(submitBtn);
            monitorSubmission(modal, imgUrl);
        } else {
            // Start Countdown
            submitBtn.innerText = `${originalText} (${countdown}s)`;
            
            // Clear any existing timer for this window context
            if (window.ebirrAutoClickTimer) clearInterval(window.ebirrAutoClickTimer);

            window.ebirrAutoClickTimer = setInterval(() => {
                countdown--;
                if (countdown > 0) {
                    submitBtn.innerText = `${originalText} (${countdown}s)`;
                } else {
                    clearInterval(window.ebirrAutoClickTimer);
                    window.ebirrAutoClickTimer = null;
                    submitBtn.innerText = originalText; // Reset text before click
                    // Remove listeners to avoid triggering stopAutomation on our own click
                    abortController.abort(); 
                    safeClick(submitBtn);
                    monitorSubmission(modal, imgUrl);
                }
            }, 1000);
        }
    }

    // 2. Inject Verification Details (Visual Summary)
    // Remove old summary if exists
    const oldSummary = modal.querySelector('.ebirr-summary');
    if (oldSummary) oldSummary.remove();

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'ebirr-summary';
    summaryDiv.style.cssText = `
        margin: 10px 0; padding: 10px; border-radius: 4px;
        background: ${result.color}20; border: 1px solid ${result.color};
        font-size: 12px; color: #333; position: relative;
    `;

    let originalStatusHtml = '';
    if (result.status === 'Repeat' && result.originalStatus) {
        let osColor = '#64748b';
        const s = result.originalStatus;
        if (s === 'Verified') osColor = '#4CAF50';
        else if (s === 'Old Receipt') osColor = '#ff9800';
        else if (s.startsWith('AA')) osColor = '#3b82f6';
        else if (s === 'Wrong Recipient' || s === 'Invalid ID' || s === 'Under 50') osColor = '#f44336';

        originalStatusHtml = `
            <div style="position:absolute; top:8px; right:8px; font-size:10px; padding:2px 6px; border-radius:4px; background:${osColor}; color:white; font-weight:bold; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                ${s}
            </div>
        `;
    }

    const countHtml = (result.repeatCount > 0) ? 
        `<span style="margin-left:auto; font-size:10px; background:#f1f5f9; padding:2px 5px; border-radius:4px;">Count: <b>${result.repeatCount + 1}</b></span>` : '';

    summaryDiv.innerHTML = `
        ${originalStatusHtml}
        <div style="font-weight:bold; color:${result.color}; margin-bottom:5px; padding-right: ${originalStatusHtml ? '80px' : '0'};">
            ${result.statusText}
        </div>
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

    // Copy ID Logic
    const copyBtn = summaryDiv.querySelector('#ebirr-copy-id');
    if (copyBtn && transId && transId !== 'N/A') {
        copyBtn.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(transId);
            copyBtn.innerText = '✅';
            setTimeout(() => copyBtn.innerText = '📋', 1000);
        };
    }

    // Add Open Image Button
    if (imgUrl) {
        const openBtn = document.createElement('a');
        openBtn.href = imgUrl;
        openBtn.target = "_blank";
        openBtn.innerText = "Open Image ↗";
        openBtn.style.cssText = "display:block; text-align:center; margin-top:8px; font-size:11px; color:#3b82f6; text-decoration:none; font-weight:600;";
        summaryDiv.appendChild(openBtn);
    }

    // Insert before the buttons
    if (contentBlock) {
        const btnBlock = contentBlock.querySelector('.btn-block');
        if (btnBlock) {
            contentBlock.insertBefore(summaryDiv, btnBlock);
        } else {
            contentBlock.appendChild(summaryDiv);
        }
    }
}

function monitorSubmission(modal, imgUrl) {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
        // 1. Check if modal is gone (Success)
        if (!document.body.contains(modal) || modal.style.display === 'none' || modal.offsetParent === null) {
            clearInterval(checkInterval);
            return;
        }

        // 2. Check for Error Message in Modal
        const text = (modal.innerText || "").toLowerCase();
        if (text.includes("already been processed") || text.includes("already processed")) {
            clearInterval(checkInterval);
            showNotification("⚠️ Already Processed (Closing)", "timeout");
            
            // Click Cancel/Close to dismiss
            const closeBtn = modal.querySelector(SELECTORS.modalBtnCancel) || 
                             modal.querySelector('.btn-default, .btn-secondary, .close') || 
                             Array.from(modal.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('close') || b.innerText.toLowerCase().includes('cancel'));

            if (closeBtn) safeClick(closeBtn);
            
            // Remove row to unblock batch
            const row = findRowByImgUrl(imgUrl);
            if (row) row.remove();
            return;
        }
        
        // 3. Check for SweetAlert Error
        const swal = document.querySelector('.swal2-popup, .swal-modal');
        if (swal && (swal.offsetParent !== null || window.getComputedStyle(swal).display !== 'none')) {
             const swalText = (swal.innerText || "").toLowerCase();
             if (swalText.includes("already been processed") || swalText.includes("already processed")) {
                 clearInterval(checkInterval);
                 showNotification("⚠️ Already Processed (Closing)", "timeout");
                 const okBtn = swal.querySelector('.swal2-confirm, .swal-button--confirm, button.swal2-styled');
                 if (okBtn) safeClick(okBtn);
                 
                 // Also close the main modal if it's still there
                 const cancelBtn = modal.querySelector(SELECTORS.modalBtnCancel) || modal.querySelector('.btn-default');
                 if (cancelBtn) setTimeout(() => safeClick(cancelBtn), 500);

                 const row = findRowByImgUrl(imgUrl);
                 if (row) row.remove();
             }
        }

        if (Date.now() - startTime > 10000) clearInterval(checkInterval);
    }, 500);
}

function safeClick(element) {
    if (!element) return;
    const href = element.getAttribute('href');
    const isJs = href && href.trim().toLowerCase().startsWith('javascript:');
    
    if (isJs) element.removeAttribute('href');
    
    const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
    });
    element.dispatchEvent(event);
    
    if (isJs) setTimeout(() => element.setAttribute('href', href), 0);
}

function showNotification(message, type = 'process') {
    let island = document.getElementById('ebirr-dynamic-island');
    if (!island) {
        island = document.createElement('div');
        island.id = 'ebirr-dynamic-island';
        island.style.cssText = `
            position: fixed; top: -80px; left: 50%; transform: translateX(-50%);
            background: #0f172a; color: white; padding: 10px 24px;
            border-radius: 50px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; font-weight: 600;
            z-index: 2147483647; transition: top 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            display: flex; align-items: center; gap: 12px; border: 1px solid #334155;
            min-width: 200px; justify-content: center;
        `;
        
        // Add spinner style
        const style = document.createElement('style');
        style.innerHTML = `
            .ebirr-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #3b82f6; border-radius: 50%; animation: ebirr-spin 1s linear infinite; }
            @keyframes ebirr-spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
        document.body.appendChild(island);
    }

    let icon = '<div class="ebirr-spinner"></div>';
    if (type === 'success') icon = '<span style="color:#4ade80; font-size:16px;">✓</span>';
    if (type === 'error') icon = '<span style="color:#f87171; font-size:16px;">✕</span>';
    if (type === 'timeout') icon = '<span style="color:#fbbf24; font-size:16px;">⚠️</span>';

    island.innerHTML = `${icon}<span>${message}</span>`;
    island.style.top = '20px';

    if (type !== 'process') {
        setTimeout(() => { island.style.top = '-80px'; }, 4000);
    }
}

function startCooldownTimer(seconds, callback) {
    let island = document.getElementById('ebirr-dynamic-island');
    if (!island) {
        showNotification("Refreshing...", "process");
        island = document.getElementById('ebirr-dynamic-island');
    }
    
    // Battery/Timer Style
    island.style.overflow = 'hidden'; 
    island.innerHTML = `
        <div style="position: relative; z-index: 2; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 16px;">⏳</span>
            <span id="ebirr-timer-text" style="font-variant-numeric: tabular-nums;">Refreshing in ${seconds}s</span>
        </div>
        <div id="ebirr-timer-bar" style="
            position: absolute; top: 0; left: 0; height: 100%; width: 100%;
            background: rgba(59, 130, 246, 0.5); z-index: 1;
            transform-origin: left; transform: scaleX(1);
        "></div>
    `;
    island.style.top = '20px';

    const bar = island.querySelector('#ebirr-timer-bar');
    const text = island.querySelector('#ebirr-timer-text');
    
    // Animate
    setTimeout(() => {
        bar.style.transition = `transform ${seconds}s linear`;
        bar.style.transform = 'scaleX(0)';
    }, 50);

    let remaining = seconds;
    if (window.ebirrRefreshTimer) clearInterval(window.ebirrRefreshTimer);
    
    window.ebirrRefreshTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(window.ebirrRefreshTimer);
            island.style.top = '-80px';
            if (callback) callback();
        } else {
            if (text) text.innerText = `Refreshing in ${remaining}s`;
        }
    }, 1000);
}

function processImageLocally(dataUrl, applyFilters = false) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const slices = [];
            const aspectRatio = img.height / img.width;

            // Tall Image Detection (Height > 2.5x Width) - Fix for "Squished Text"
            if (aspectRatio > 2.5) {
                const sliceHeight = img.width; // Make slices square-ish
                const overlap = sliceHeight * 0.2; // 20% overlap to ensure no text is cut in half
                let y = 0;

                while (y < img.height) {
                    // Calculate slice dimensions
                    let sh = sliceHeight;
                    if (y + sh > img.height) sh = img.height - y;
                    
                    slices.push(processCanvas(img, 0, y, img.width, sh, applyFilters));
                    
                    if (y + sh >= img.height) break; // Done
                    y += (sliceHeight - overlap); // Move down
                }
            } else {
                // Normal Image
                slices.push(processCanvas(img, 0, 0, img.width, img.height, applyFilters));
            }
            resolve(slices);
        };
        img.onerror = () => resolve([]);
        img.src = dataUrl;
    });
}

function processCanvas(img, sx, sy, sw, sh, applyFilters) {
    const canvas = document.createElement('canvas');
    const maxDim = 2048; 
    let width = sw; let height = sh;
    
    // Resize logic (maintain aspect ratio)
    if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } 
    else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
    
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    
    if (applyFilters) ctx.filter = 'grayscale(1) contrast(1.2)';
    
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.95);
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}