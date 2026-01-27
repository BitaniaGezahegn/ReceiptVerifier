// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\settings_ui.js
export class SettingsUI {
    constructor() {
        this.ageInput = document.getElementById('age-input');
        this.ageMinus = document.getElementById('age-minus');
        this.agePlus = document.getElementById('age-plus');
        this.aiBehaviorSelect = document.getElementById('ai-behavior-select');
        this.targetNameInput = document.getElementById('target-name-input');
        this.headlessCheckbox = document.getElementById('headless-checkbox');
        this.pendingAlertCheckbox = document.getElementById('pending-alert-checkbox');
        this.pendingLimitInput = document.getElementById('pending-limit-input');
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
        
        this.headlessCheckbox.checked = data.headlessMode !== false;
        this.pendingAlertCheckbox.checked = data.pendingAlertEnabled || false;
        if (data.pendingLimit) this.pendingLimitInput.value = data.pendingLimit;
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
        this.headlessCheckbox.onchange = () => chrome.storage.local.set({ headlessMode: this.headlessCheckbox.checked });
        this.pendingAlertCheckbox.onchange = () => chrome.storage.local.set({ pendingAlertEnabled: this.pendingAlertCheckbox.checked });
        this.pendingLimitInput.onchange = () => chrome.storage.local.set({ pendingLimit: parseInt(this.pendingLimitInput.value) || 5 });
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

        if (!this.clearCacheBtn && this.speedSelect && this.speedSelect.parentNode) {
            const container = document.createElement('div');
            container.style.cssText = "margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 15px;";
            
            this.clearCacheBtn = document.createElement('button');
            this.clearCacheBtn.id = 'clear-cache-btn';
            this.clearCacheBtn.innerText = 'Clear Cache';
            this.clearCacheBtn.style.cssText = "width: 100%; padding: 8px; background-color: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: background-color 0.2s;";
            
            this.clearCacheBtn.onmouseover = () => this.clearCacheBtn.style.backgroundColor = "#dc2626";
            this.clearCacheBtn.onmouseout = () => this.clearCacheBtn.style.backgroundColor = "#ef4444";

            container.appendChild(this.clearCacheBtn);
            this.speedSelect.parentNode.appendChild(container);
        }

        if (this.clearCacheBtn) {
            this.clearCacheBtn.onclick = () => {
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: "updateSettings", settings: { clearCache: true } });
                        const originalText = this.clearCacheBtn.innerText;
                        this.clearCacheBtn.innerText = "Cache Cleared!";
                        this.clearCacheBtn.style.backgroundColor = "#10b981";
                        setTimeout(() => {
                            this.clearCacheBtn.innerText = originalText;
                            this.clearCacheBtn.style.backgroundColor = "#ef4444";
                        }, 1500);
                    }
                });
            };
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
                    <button class="del-bank-btn" data-index="${index}" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold;">×</button>
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
                this.loadBanks();
            };
        });
    }

    async addBank() {
        const name = this.bankNameInput.value.trim();
        const len = parseInt(this.bankLenInput.value);
        const prefixesStr = this.bankPrefixesInput.value.trim();
        const url = this.bankUrlInput.value.trim();

        if (!name || !len || !prefixesStr || !url) { alert("Please fill all fields."); return; }

        const prefixes = prefixesStr.split(',').map(p => p.trim()).filter(p => p);
        const d = await chrome.storage.local.get(['banks']);
        const currentBanks = d.banks || [];
        currentBanks.push({ name, length: len, prefixes, url });
        await chrome.storage.local.set({ banks: currentBanks });
        
        this.bankNameInput.value = ""; this.bankLenInput.value = ""; this.bankPrefixesInput.value = ""; this.bankUrlInput.value = "";
        this.loadBanks();
    }
}
