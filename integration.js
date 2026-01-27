import { DomManager } from './controllers/content/dom_manager.js';
import { BatchProcessor } from './controllers/content/batch_processor.js';
import { showNotification } from './ui/content/notifications.js';
import { safeClick } from './utils/helpers.js';

const domManager = new DomManager();
const batchProcessor = new BatchProcessor(domManager);

async function init() {
    console.log("Ebirr Verifier: Integration loaded.");
    
    // 1. Load Settings
    const result = await chrome.storage.local.get([
        'pendingAlertEnabled', 'pendingLimit', 'batchReverse', 'transactionSoundEnabled', 
        'skipPdfEnabled', 'skipRandomEnabled', 'skipRepeatEnabled', 'repeatLimit', 
        'retryWrongRecipient', 'retryVerified', 'fullAutoMode', 'autoRefreshInterval', 'processingSpeed'
    ]);

    const settings = {
        batchReverse: result.batchReverse || false,
        transactionSoundEnabled: result.transactionSoundEnabled || false,
        skipPdfEnabled: result.skipPdfEnabled || false,
        skipRandomEnabled: result.skipRandomEnabled || false,
        skipRepeatEnabled: result.skipRepeatEnabled !== false,
        repeatLimit: parseInt(result.repeatLimit) || 3,
        retryWrongRecipient: result.retryWrongRecipient || false,
        retryVerified: result.retryVerified || false,
        fullAutoMode: result.fullAutoMode || false,
        autoRefreshInterval: parseInt(result.autoRefreshInterval) || 30,
        processingSpeed: result.processingSpeed || 'normal'
    };
    
    batchProcessor.updateSettings(settings);
    domManager.updateSettings(null, { 
        enabled: result.pendingAlertEnabled || false, 
        limit: parseInt(result.pendingLimit) || 5, 
        lastAlert: 0 
    });

    // 2. Initial Scan
    domManager.getColumnIndexes();
    domManager.scanAndInject(batchProcessor.verificationState, {
        onVerify: (row, url) => batchProcessor.startVerification(row, url),
        onCancel: (url) => batchProcessor.cancelVerification(url),
        onBatchToggle: (btn) => batchProcessor.toggleBatch(btn)
    });
    batchProcessor.restoreAllRows();

    // 3. Watch for dynamic content (SPA)
    const observer = new MutationObserver((mutations) => {
        domManager.getColumnIndexes();
        domManager.scanAndInject(batchProcessor.verificationState, {
            onVerify: (row, url) => batchProcessor.startVerification(row, url),
            onCancel: (url) => batchProcessor.cancelVerification(url),
            onBatchToggle: (btn) => batchProcessor.toggleBatch(btn)
        });
        batchProcessor.restoreAllRows();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 4. Listeners
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);
    chrome.storage.onChanged.addListener((changes) => {
        const newSettings = {};
        if (changes.batchReverse) newSettings.batchReverse = changes.batchReverse.newValue;
        if (changes.transactionSoundEnabled) newSettings.transactionSoundEnabled = changes.transactionSoundEnabled.newValue;
        if (changes.skipPdfEnabled) newSettings.skipPdfEnabled = changes.skipPdfEnabled.newValue;
        if (changes.skipRandomEnabled) newSettings.skipRandomEnabled = changes.skipRandomEnabled.newValue;
        if (changes.skipRepeatEnabled) newSettings.skipRepeatEnabled = changes.skipRepeatEnabled.newValue;
        if (changes.repeatLimit) newSettings.repeatLimit = parseInt(changes.repeatLimit.newValue);
        if (changes.retryWrongRecipient) newSettings.retryWrongRecipient = changes.retryWrongRecipient.newValue;
        if (changes.retryVerified) newSettings.retryVerified = changes.retryVerified.newValue;
        if (changes.fullAutoMode) newSettings.fullAutoMode = changes.fullAutoMode.newValue;
        if (changes.autoRefreshInterval) newSettings.autoRefreshInterval = parseInt(changes.autoRefreshInterval.newValue) || 30;
        if (changes.processingSpeed) newSettings.processingSpeed = changes.processingSpeed.newValue;
        
        batchProcessor.updateSettings(newSettings);

        if (changes.pendingAlertEnabled || changes.pendingLimit) {
            domManager.updateSettings(null, {
                enabled: changes.pendingAlertEnabled ? changes.pendingAlertEnabled.newValue : domManager.pendingAlertSettings.enabled,
                limit: changes.pendingLimit ? parseInt(changes.pendingLimit.newValue) : domManager.pendingAlertSettings.limit
            });
        }
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
        const row = domManager.findRowByImgUrl(request.imgUrl);
        if (!row) return;

        const rejectLink = domManager.columnIndexes.reject ? row.querySelector(`td:nth-child(${domManager.columnIndexes.reject}) a`) : null;
        if (rejectLink) {
            safeClick(rejectLink);
            domManager.waitForModalAndFill(request.data, 'reject', request.imgUrl, request.extractedId, false);
        }
        return;
    }

    if (request.action !== "integrationResult") return;
    
    batchProcessor.handleResult(request);
}

// Start Execution
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}