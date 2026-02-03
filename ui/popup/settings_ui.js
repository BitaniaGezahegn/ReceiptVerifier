// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\settings_ui.js
export class SettingsUI {
    constructor() {
        this.ageInput = document.getElementById('age-input');
        this.ageMinus = document.getElementById('age-minus');
        this.agePlus = document.getElementById('age-plus');
        this.aiBehaviorSelect = document.getElementById('ai-behavior-select');
        this.targetNameInput = document.getElementById('target-name-input');
        this.skippedNamesInput = document.getElementById('skipped-names-input');
        this.headlessCheckbox = document.getElementById('headless-checkbox');
        this.pendingAlertCheckbox = document.getElementById('pending-alert-checkbox');
        this.pendingLimitInput = document.getElementById('pending-limit-input');
        this.telegramPendingAlertCheckbox = document.getElementById('telegram-pending-alert-checkbox');
        this.testTelegramAlertBtn = document.getElementById('test-telegram-alert-btn');
        this.sleepModeCheckbox = document.getElementById('sleep-mode-checkbox');
        this.sleepModeOptions = document.getElementById('sleep-mode-options');
        this.sleepTimeoutInput = document.getElementById('sleep-timeout-input');
        this.sleepRepeatInput = document.getElementById('sleep-repeat-input');
        this.sleepMaxRetriesInput = document.getElementById('sleep-max-retries-input');
        this.sleepFailureLimitInput = document.getElementById('sleep-failure-limit-input');
        this.batchReverseCheckbox = document.getElementById('batch-reverse-checkbox');
        this.transactionSoundCheckbox = document.getElementById('transaction-sound-checkbox');
        this.skipPdfCheckbox = document.getElementById('skip-pdf-checkbox');
        this.skipRandomCheckbox = document.getElementById('skip-random-checkbox');
        this.fullAutoCheckbox = document.getElementById('full-auto-checkbox');
        this.skipRepeatCheckbox = document.getElementById('skip-repeat-checkbox');
        this.repeatLimitInput = document.getElementById('repeat-limit-input');
        this.repeatOptionsDiv = document.getElementById('repeat-options');
        this.retryWrongRecipCheckbox = document.getElementById('retry-wrong-recip-checkbox');
        this.retryVerifiedCheckbox = document.getElementById('retry-verified-checkbox');
        this.autoRefreshInput = document.getElementById('auto-refresh-interval');
        this.speedSelect = document.getElementById('speed-select');
        
        this.clearCacheBtn = document.getElementById('clear-cache-btn');
        this.keyInput = document.getElementById('new-key-input');
        this.addKeyBtn = document.getElementById('add-key-btn');
        this.keysList = document.getElementById('keys-list');
        this.importKeysBtn = document.getElementById('import-keys-btn');
        this.exportKeysBtn = document.getElementById('export-keys-btn');
        
        this.bankNameInput = document.getElementById('bank-name');
        this.bankLenInput = document.getElementById('bank-len');
        this.bankPrefixesInput = document.getElementById('bank-prefixes');
        this.bankUrlInput = document.getElementById('bank-url');
        this.addBankBtn = document.getElementById('add-bank-btn');
        this.banksList = document.getElementById('banks-list');
        this.editingBankIndex = null;
    }

    async init(data) {
        this.loadSettings(data);
        this.bindEvents();
        this.loadKeys();
        this.loadBanks();
    }

    loadSettings(data) {
        if (data.maxReceiptAge) this.ageInput.value = data.maxReceiptAge;
        if (data.aiScanBehavior) this.aiBehaviorSelect.value = data.aiScanBehavior;
        if (data.targetName) this.targetNameInput.value = data.targetName;
        if (data.skippedNames) this.skippedNamesInput.value = data.skippedNames.join(', ');
        
        this.headlessCheckbox.checked = data.headlessMode !== false;
        this.pendingAlertCheckbox.checked = data.pendingAlertEnabled || false;
        if (data.pendingLimit) this.pendingLimitInput.value = data.pendingLimit;
        this.telegramPendingAlertCheckbox.checked = data.telegramPendingAlert || false;
        this.sleepModeCheckbox.checked = data.sleepModeEnabled || false;
        if (data.sleepModeTimeout) this.sleepTimeoutInput.value = data.sleepModeTimeout;
        if (data.sleepModeRepeat) this.sleepRepeatInput.value = data.sleepModeRepeat;
        if (data.sleepModeMaxRetries) this.sleepMaxRetriesInput.value = data.sleepModeMaxRetries;
        if (data.sleepModeFailureLimit) this.sleepFailureLimitInput.value = data.sleepModeFailureLimit;
        if (this.sleepModeOptions) this.sleepModeOptions.style.display = this.sleepModeCheckbox.checked ? 'block' : 'none';
        this.batchReverseCheckbox.checked = data.batchReverse || false;
        this.transactionSoundCheckbox.checked = data.transactionSoundEnabled || false;
        this.skipPdfCheckbox.checked = data.skipPdfEnabled || false;
        this.skipRandomCheckbox.checked = data.skipRandomEnabled || false;
        this.fullAutoCheckbox.checked = data.fullAutoMode || false;
        this.skipRepeatCheckbox.checked = data.skipRepeatEnabled !== false;
        if (data.repeatLimit) this.repeatLimitInput.value = data.repeatLimit;
        this.retryWrongRecipCheckbox.checked = data.retryWrongRecipient || false;
        this.retryVerifiedCheckbox.checked = data.retryVerified || false;
        if (this.repeatOptionsDiv) this.repeatOptionsDiv.style.display = this.skipRepeatCheckbox.checked ? 'block' : 'none';

        if (data.autoRefreshInterval) this.autoRefreshInput.value = data.autoRefreshInterval;
        if (data.processingSpeed) this.speedSelect.value = data.processingSpeed;

        this.updateFullAutoDependencies();
    }

    bindEvents() {
        const updateAge = (val) => {
            if (val < 0.5) val = 0.5;
            this.ageInput.value = val;
            chrome.storage.local.set({ maxReceiptAge: val });
        };

        this.ageMinus.onclick = () => updateAge(parseFloat(this.ageInput.value) - 0.5);
        this.agePlus.onclick = () => updateAge(parseFloat(this.ageInput.value) + 0.5);
        this.ageInput.onchange = () => updateAge(parseFloat(this.ageInput.value));

        this.aiBehaviorSelect.onchange = () => chrome.storage.local.set({ aiScanBehavior: this.aiBehaviorSelect.value });
        this.targetNameInput.onchange = () => chrome.storage.local.set({ targetName: this.targetNameInput.value.trim() });
        this.skippedNamesInput.onchange = () => {
            const val = this.skippedNamesInput.value;
            const names = val.split(',').map(n => n.trim()).filter(n => n);
            chrome.storage.local.set({ skippedNames: names });
        };
        this.headlessCheckbox.onchange = () => chrome.storage.local.set({ headlessMode: this.headlessCheckbox.checked });
        this.pendingAlertCheckbox.onchange = () => chrome.storage.local.set({ pendingAlertEnabled: this.pendingAlertCheckbox.checked });
        this.pendingLimitInput.onchange = () => chrome.storage.local.set({ pendingLimit: parseInt(this.pendingLimitInput.value) || 5 });
        this.telegramPendingAlertCheckbox.onchange = () => chrome.storage.local.set({ telegramPendingAlert: this.telegramPendingAlertCheckbox.checked });
        this.testTelegramAlertBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: "testPendingAlert", count: 5 });
        };
        this.sleepModeCheckbox.onchange = () => {
            chrome.storage.local.set({ sleepModeEnabled: this.sleepModeCheckbox.checked });
            if (this.sleepModeOptions) this.sleepModeOptions.style.display = this.sleepModeCheckbox.checked ? 'block' : 'none';
        };
        this.sleepTimeoutInput.onchange = () => chrome.storage.local.set({ sleepModeTimeout: parseInt(this.sleepTimeoutInput.value) || 10 });
        this.sleepRepeatInput.onchange = () => chrome.storage.local.set({ sleepModeRepeat: parseInt(this.sleepRepeatInput.value) || 2 });
        this.sleepMaxRetriesInput.onchange = () => chrome.storage.local.set({ sleepModeMaxRetries: parseInt(this.sleepMaxRetriesInput.value) || 10 });
        this.sleepFailureLimitInput.onchange = () => chrome.storage.local.set({ sleepModeFailureLimit: parseInt(this.sleepFailureLimitInput.value) || 5 });
        this.batchReverseCheckbox.onchange = () => chrome.storage.local.set({ batchReverse: this.batchReverseCheckbox.checked });
        this.transactionSoundCheckbox.onchange = () => chrome.storage.local.set({ transactionSoundEnabled: this.transactionSoundCheckbox.checked });
        this.skipPdfCheckbox.onchange = () => chrome.storage.local.set({ skipPdfEnabled: this.skipPdfCheckbox.checked });
        this.skipRandomCheckbox.onchange = () => chrome.storage.local.set({ skipRandomEnabled: this.skipRandomCheckbox.checked });
        
        this.fullAutoCheckbox.onchange = () => {
            chrome.storage.local.set({ fullAutoMode: this.fullAutoCheckbox.checked });
            this.updateFullAutoDependencies();
        };

        this.skipRepeatCheckbox.onchange = () => {
            chrome.storage.local.set({ skipRepeatEnabled: this.skipRepeatCheckbox.checked });
            if (this.repeatOptionsDiv) this.repeatOptionsDiv.style.display = this.skipRepeatCheckbox.checked ? 'block' : 'none';
        };
        this.repeatLimitInput.onchange = () => chrome.storage.local.set({ repeatLimit: parseInt(this.repeatLimitInput.value) || 3 });
        this.retryWrongRecipCheckbox.onchange = () => chrome.storage.local.set({ retryWrongRecipient: this.retryWrongRecipCheckbox.checked });
        this.retryVerifiedCheckbox.onchange = () => chrome.storage.local.set({ retryVerified: this.retryVerifiedCheckbox.checked });

        this.autoRefreshInput.onchange = () => {
            let val = parseInt(this.autoRefreshInput.value);
            if (val < 5) val = 5;
            chrome.storage.local.set({ autoRefreshInterval: val });
        };

        this.speedSelect.onchange = () => chrome.storage.local.set({ processingSpeed: this.speedSelect.value });

        if (this.clearCacheBtn) {
            this.clearCacheBtn.onclick = () => this.showClearCacheConfirmation();
        }

        this.addKeyBtn.onclick = () => this.addKey();
        if (this.exportKeysBtn) this.exportKeysBtn.onclick = () => this.exportKeys();
        if (this.importKeysBtn) this.setupImportKeys();

        this.addBankBtn.onclick = () => this.addBank();
    }

    updateFullAutoDependencies() {
        if (this.fullAutoCheckbox.checked) {
            this.skipRandomCheckbox.checked = true;
            this.skipRandomCheckbox.disabled = true;
            chrome.storage.local.set({ skipRandomEnabled: true });
        } else {
            this.skipPdfCheckbox.disabled = false;
            this.skipRandomCheckbox.disabled = false;
        }
    }

    async loadKeys() {
        const d = await chrome.storage.local.get(['apiKeys', 'activeKeyIndex']);
        this.renderKeys(d.apiKeys || [], d.activeKeyIndex || 0);
    }

    renderKeys(keys, activeIndex) {
        this.keysList.innerHTML = "";
        if (!keys || keys.length === 0) {
            this.keysList.innerHTML = "<div style='text-align:center; color:#94a3b8; font-size:11px;'>No keys found. Add one.</div>";
            return;
        }
        keys.forEach((key, index) => {
            const div = document.createElement('div');
            div.className = 'key-item';
            div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'space-between';
            
            const isMasked = key.length > 10;
            const displayKey = isMasked ? key.substring(0, 8) + "..." + key.substring(key.length - 4) : key;
            const isActive = index === (activeIndex || 0);
            const statusDot = isActive ? "🟢" : "⚪";
            
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; overflow:hidden; cursor:pointer;" title="Click to set active">
                    <span>${statusDot}</span>
                    <span style="font-family:monospace; color:#334155;">${displayKey}</span>
                </div>
                <button class="del-key-btn" data-index="${index}" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold;">×</button>
            `;
            
            div.firstElementChild.onclick = () => chrome.storage.local.set({ activeKeyIndex: index }, () => this.loadKeys());
            this.keysList.appendChild(div);
        });

        this.keysList.querySelectorAll('.del-key-btn').forEach(btn => {
            btn.onclick = (e) => {
                if (confirm("Are you sure you want to delete this API key?")) {
                    const idx = parseInt(e.target.dataset.index);
                    const newKeys = keys.filter((_, i) => i !== idx);
                    let newActive = activeIndex;
                    if (activeIndex >= idx && activeIndex > 0) newActive--;
                    chrome.storage.local.set({ apiKeys: newKeys, activeKeyIndex: newActive }, () => this.loadKeys());
                }
            };
        });
    }

    async addKey() {
        const val = this.keyInput.value.trim();
        if (!val) return;
        const d = await chrome.storage.local.get(['apiKeys']);
        const currentKeys = d.apiKeys || [];
        if (!currentKeys.includes(val)) {
            currentKeys.push(val);
            await chrome.storage.local.set({ apiKeys: currentKeys });
            this.keyInput.value = "";
            this.loadKeys();
        }
    }

    async exportKeys() {
        const { apiKeys } = await chrome.storage.local.get(['apiKeys']);
        if (!apiKeys || apiKeys.length === 0) {
            alert("No API keys to export.");
            return;
        }
        const dataToExport = { "apiKeys": apiKeys };
        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ebirr_verifier_apikeys_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    setupImportKeys() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        this.importKeysBtn.onclick = () => fileInput.click();

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    if (!importedData.apiKeys || !Array.isArray(importedData.apiKeys)) {
                        throw new Error("Invalid JSON. Expected an object with an 'apiKeys' array.");
                    }
                    const newKeys = importedData.apiKeys.filter(k => typeof k === 'string' && k.trim() !== '');
                    const { apiKeys: currentKeys = [] } = await chrome.storage.local.get(['apiKeys']);
                    const keySet = new Set([...currentKeys, ...newKeys]);
                    await chrome.storage.local.set({ apiKeys: Array.from(keySet) });
                    alert(`Successfully imported ${newKeys.length} key(s).`);
                    this.loadKeys();
                } catch (err) {
                    alert("Failed to import keys: " + err.message);
                } finally {
                    fileInput.value = '';
                }
            };
            reader.readAsText(file);
        };
    }

    async loadBanks() {
        const d = await chrome.storage.local.get(['banks']);
        this.renderBanks(d.banks || []);
    }

    renderBanks(banks) {
        this.banksList.innerHTML = "";
        if (!banks || banks.length === 0) {
            this.banksList.innerHTML = "<div style='text-align:center; color:#94a3b8; font-size:11px;'>No banks configured.</div>";
            return;
        }
        banks.forEach((bank, index) => {
            const div = document.createElement('div');
            div.className = 'bank-item';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:bold; color:#334155;">${bank.name}</span>
                    <div style="display:flex; gap:5px;">
                        <button class="edit-bank-btn" data-index="${index}" style="background:none; border:none; cursor:pointer; font-size:14px;" title="Edit">✏️</button>
                        <button class="del-bank-btn" data-index="${index}" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold;" title="Delete">×</button>
                    </div>
                </div>
                <div style="color:#64748b;">Len: ${bank.length} | Pre: ${bank.prefixes.join(', ')}</div>
                <div style="color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${bank.url}</div>
            `;
            this.banksList.appendChild(div);
        });

        this.banksList.querySelectorAll('.del-bank-btn').forEach(btn => {
            btn.onclick = async (e) => {
                if(!confirm("Delete this bank?")) return;
                const idx = parseInt(e.target.dataset.index);
                const newBanks = banks.filter((_, i) => i !== idx);
                await chrome.storage.local.set({ banks: newBanks });
                if (this.editingBankIndex === idx) this.cancelEdit();
                this.loadBanks();
            };
        });

        this.banksList.querySelectorAll('.edit-bank-btn').forEach(btn => {
            btn.onclick = (e) => {
                const idx = parseInt(e.target.closest('button').dataset.index);
                this.startEditBank(banks[idx], idx);
            };
        });
    }

    startEditBank(bank, index) {
        this.bankNameInput.value = bank.name;
        this.bankLenInput.value = bank.length;
        this.bankPrefixesInput.value = bank.prefixes.join(', ');
        this.bankUrlInput.value = bank.url;
        
        this.editingBankIndex = index;
        this.addBankBtn.innerText = "Update Bank";
        this.addBankBtn.style.backgroundColor = "#3b82f6";
        this.addBankBtn.style.color = "white";
        
        this.bankNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    cancelEdit() {
        this.editingBankIndex = null;
        this.addBankBtn.innerText = "Add Bank";
        this.addBankBtn.style.backgroundColor = "";
        this.addBankBtn.style.color = "";
        this.bankNameInput.value = ""; 
        this.bankLenInput.value = ""; 
        this.bankPrefixesInput.value = ""; 
        this.bankUrlInput.value = "";
    }

    async addBank() {
        const name = this.bankNameInput.value.trim();
        const len = parseInt(this.bankLenInput.value);
        const prefixesStr = this.bankPrefixesInput.value.trim();
        const url = this.bankUrlInput.value.trim();

        if (!name || !len || !prefixesStr || !url) { alert("Please fill all fields."); return; }

        const prefixes = prefixesStr.split(',').map(p => p.trim()).filter(p => p);
        const d = await chrome.storage.local.get(['banks']);
        let currentBanks = d.banks || [];
        
        if (this.editingBankIndex !== null) {
            if (this.editingBankIndex >= 0 && this.editingBankIndex < currentBanks.length) {
                currentBanks[this.editingBankIndex] = { name, length: len, prefixes, url };
            }
        } else {
            currentBanks.push({ name, length: len, prefixes, url });
        }
        
        await chrome.storage.local.set({ banks: currentBanks });
        
        this.cancelEdit();
        this.loadBanks();
    }

    showClearCacheConfirmation() {
        const overlay = document.createElement('div');
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.95); z-index:10000; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:'Segoe UI', sans-serif;";
        
        const modal = document.createElement('div');
        modal.style.cssText = "background:white; color:#334155; padding:25px; border-radius:12px; width:320px; text-align:center; box-shadow:0 20px 25px -5px rgba(0, 0, 0, 0.1);";
        
        modal.innerHTML = `
            <div style="font-size:40px; margin-bottom:15px;">🧹</div>
            <h3 style="margin-top:0; font-size:18px; color:#1e293b; margin-bottom:10px;">Clear Page Cache?</h3>
            <p style="font-size:13px; color:#64748b; margin-bottom:20px; line-height:1.5;">
                This will remove temporary status flags (like "Repeat", "Under 50") stored in your browser for the current page.
                <br><br>
                <strong style="color:#ef4444;">Note:</strong> This does <u>not</u> delete any transaction logs from the database.
            </p>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button id="cc-cancel" style="padding:8px 16px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">Cancel</button>
                <button id="cc-confirm" style="padding:8px 16px; border:none; background:#ef4444; color:white; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">Yes, Clear Cache</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('cc-cancel').onclick = () => overlay.remove();
        
        document.getElementById('cc-confirm').onclick = () => {
            overlay.remove();
            this.executeClearCache();
        };
    }

    executeClearCache() {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "updateSettings", settings: { clearCache: true } }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Clear Cache: Content script not ready.", chrome.runtime.lastError.message);
                        if (this.clearCacheBtn) {
                            const originalText = this.clearCacheBtn.innerText;
                            this.clearCacheBtn.innerText = "Refresh Page!";
                            this.clearCacheBtn.style.backgroundColor = "#f59e0b";
                            this.clearCacheBtn.style.color = "white";
                            this.clearCacheBtn.style.borderColor = "#f59e0b";
                            setTimeout(() => {
                                this.clearCacheBtn.innerText = originalText;
                                this.clearCacheBtn.style.backgroundColor = "#fff";
                                this.clearCacheBtn.style.color = "#ef4444";
                                this.clearCacheBtn.style.borderColor = "#ef4444";
                            }, 2000);
                        }
                        return;
                    }
                    
                    if (this.clearCacheBtn) {
                        const originalText = this.clearCacheBtn.innerText;
                        this.clearCacheBtn.innerText = "Cache Cleared!";
                        this.clearCacheBtn.style.backgroundColor = "#10b981";
                        this.clearCacheBtn.style.color = "white";
                        this.clearCacheBtn.style.borderColor = "#10b981";
                        setTimeout(() => {
                            this.clearCacheBtn.innerText = originalText;
                            this.clearCacheBtn.style.backgroundColor = "#fff";
                            this.clearCacheBtn.style.color = "#ef4444";
                            this.clearCacheBtn.style.borderColor = "#ef4444";
                        }, 1500);
                    }
                });
            }
        });
    }
}
