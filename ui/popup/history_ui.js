// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\history_ui.js
import { getRecentTransactions, getMoreTransactions, deleteTransaction, saveTransaction, getTransaction } from '../../services/storage_service.js';
import { getTimeAgo } from '../../utils/helpers.js';

export class HistoryUI {
    constructor() {
        this.allItems = [];
        this.lastVisibleDoc = null;
        this.isLoadingMore = false;
        this.hasLoaded = false;
        
        this.tableBody = document.getElementById('log-body');
        this.emptyState = document.getElementById('empty-state');
        this.searchInput = document.getElementById('search-input');
        this.tableContainer = document.querySelector('.table-container');
        this.clearRecentBtn = document.getElementById('clear-recent-btn');
        this.importedCheckbox = null;

        this.recentTxCache = {
            data: null,
            timestamp: 0,
            lastDoc: null
        };
        this.RECENT_TX_CACHE_TTL = 30 * 1000;
    }

    init() {
        if (this.searchInput && this.searchInput.parentNode) {
            const container = document.createElement('div');
            container.style.cssText = "margin: 8px 0; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748b;";
            container.innerHTML = `
                <input type="checkbox" id="filter-imported" style="cursor:pointer;">
                <label for="filter-imported" style="cursor:pointer; user-select:none;">Show Imported Only</label>
            `;
            this.searchInput.parentNode.insertBefore(container, this.searchInput.nextSibling);
            this.importedCheckbox = document.getElementById('filter-imported');
        }

        if (this.searchInput) this.searchInput.addEventListener('input', () => this.renderTable());
        if (this.importedCheckbox) this.importedCheckbox.addEventListener('change', () => this.renderTable());
        
        if (this.tableContainer) {
            this.tableContainer.addEventListener('scroll', () => this.handleScroll());
        }

        document.getElementById('export-btn').onclick = () => this.exportData();
        
        const importBtn = document.getElementById('import-btn');
        if (importBtn) this.setupImport(importBtn);

        const migrateBtn = document.getElementById('migrate-btn');
        if (migrateBtn) this.setupMigration(migrateBtn);

        document.getElementById('clear-btn').onclick = () => this.clearHistory();
        if (this.clearRecentBtn) this.clearRecentBtn.onclick = () => this.clearHistory();

        this.setupEditModal();
    }

    async loadData() {
        if (this.hasLoaded) return;
        console.log("Loading history data...");

        const now = Date.now();
        let transactions, lastDoc;

        if (this.recentTxCache.data && (now - this.recentTxCache.timestamp < this.RECENT_TX_CACHE_TTL)) {
            transactions = this.recentTxCache.data;
            lastDoc = this.recentTxCache.lastDoc;
        } else {
            const result = await getRecentTransactions(100);
            transactions = result.transactions;
            lastDoc = result.lastDoc;
            this.recentTxCache = { data: transactions, timestamp: now, lastDoc: lastDoc };
        }
        this.lastVisibleDoc = lastDoc;
        this.allItems = transactions;
        this.allItems.sort((a, b) => (b.timestamp || new Date(b.dateVerified)) - (a.timestamp || new Date(a.dateVerified)));
        
        this.renderTable();
        this.hasLoaded = true;
    }

    renderTable() {
        const filterText = this.searchInput ? this.searchInput.value : "";
        const showImported = this.importedCheckbox ? this.importedCheckbox.checked : false;

        this.tableBody.innerHTML = "";
        const filtered = this.allItems.filter(item => {
            const matchesText = item.id.toString().includes(filterText) || item.status.toLowerCase().includes(filterText.toLowerCase());
            const matchesImport = showImported ? item.imported === true : true;
            return matchesText && matchesImport;
        });

        if (filtered.length === 0) {
            this.emptyState.style.display = 'block';
        } else {
            this.emptyState.style.display = 'none';
            let lastDate = null;

            filtered.forEach(item => {
                const itemDateObj = new Date(item.timestamp || item.dateVerified);
                const dateStr = itemDateObj.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                
                if (dateStr !== lastDate) {
                    const dateRow = document.createElement('tr');
                    dateRow.style.cursor = 'pointer';
                    dateRow.style.userSelect = 'none';
                    dateRow.innerHTML = `<td colspan="5" class="date-header"><span style="display:inline-block; width:20px;">▼</span>${dateStr}</td>`;
                    
                    dateRow.onclick = () => {
                        const rows = this.tableBody.querySelectorAll(`tr[data-date=""]`);
                        const icon = dateRow.querySelector('span');
                        const isCollapsed = icon.innerText === '▶';
                        icon.innerText = isCollapsed ? '▼' : '▶';
                        rows.forEach(r => r.style.display = isCollapsed ? '' : 'none');
                    };

                    this.tableBody.appendChild(dateRow);
                    lastDate = dateStr;
                }

                const row = document.createElement('tr');
                row.setAttribute('data-date', dateStr);
                const isVerified = item.status.includes('Verified');
                const isAA = item.status.includes('AA');
                const timeStr = item.dateVerified.split(',')[1]?.trim() || itemDateObj.toLocaleTimeString();
                const senderInfo = item.senderName ? 
                    `<b>${item.senderName}</b><br><span style="font-size:9px; color:#64748b;">${item.senderPhone || ''}</span>` : 
                    `<span style="color:#cbd5e1;">-</span>`;
                const ageStr = getTimeAgo(item.timestamp, item.bankDate || item.dateVerified);
                const ageInfo = ageStr !== "N/A" ? `<br><span style="font-size:10px; color:#64748b;">Age: </span>` : "";
                
                const count = (item.repeatCount || 0) + 1;

                row.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="id-text">${item.id}</span>
                        <button class="copy-btn" data-copy="${item.id}" title="Copy ID">📋</button>
                    </div>
                    <div style="font-size:10px; color:#94a3b8; margin-top:3px;">
                         <span style="color:#64748b;">(x)</span>
                    </div>
                </td>
                <td></td>
                <td>${item.amount}</td>
                <td class="${isVerified ? 'status-ok' : (isAA ? '' : 'status-err')}" style="${isAA ? 'color:#3b82f6; font-weight:bold;' : ''}">${item.status}</td>
                <td style="text-align:center; white-space:nowrap;">
                    <button class="edit-btn" data-id="${item.id}" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.7; margin-right:5px;" title="Edit">✏️</button>
                    <button class="del-item-btn" data-id="${item.id}" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.7;" title="Delete Log">🗑️</button>
                </td>
                `;
                this.tableBody.appendChild(row);
            });

            this.attachRowListeners();
        }
    }

    attachRowListeners() {
        this.tableBody.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const text = e.target.dataset.copy;
                navigator.clipboard.writeText(text);
                const original = e.target.innerText;
                e.target.innerText = '✅';
                e.target.style.opacity = '1';
                setTimeout(() => {
                    e.target.innerText = original;
                    e.target.style.opacity = '';
                }, 1000);
            };
        });

        this.tableBody.querySelectorAll('.edit-btn').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.target.closest('button').dataset.id;
                this.openEditModal(id);
            };
        });

        this.tableBody.querySelectorAll('.del-item-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const id = e.target.closest('button').dataset.id;
                if (confirm("Delete transaction " + id + "?")) {
                    await deleteTransaction(id);
                    location.reload();
                }
            };
        });
    }

    async handleScroll() {
        if (this.isLoadingMore || !this.lastVisibleDoc) return;

        const { scrollTop, scrollHeight, clientHeight } = this.tableContainer;
        if (scrollHeight - scrollTop < clientHeight + 150) {
            this.isLoadingMore = true;

            const loadingRow = document.createElement('tr');
            loadingRow.id = 'loading-more-row';
            loadingRow.innerHTML = `<td colspan="5" style="text-align:center; padding:15px; color:#94a3b8; font-style:italic;">Loading more...</td>`;
            this.tableBody.appendChild(loadingRow);

            const { transactions: newTransactions, lastDoc: newLastDoc } = await getMoreTransactions(this.lastVisibleDoc, 50);

            const existingLoadingRow = document.getElementById('loading-more-row');
            if (existingLoadingRow) this.tableBody.removeChild(existingLoadingRow);

            if (newTransactions.length > 0) {
                this.allItems.push(...newTransactions);
                this.renderTable();
                this.lastVisibleDoc = newLastDoc;
            } else {
                this.lastVisibleDoc = null; 
                const endRow = document.createElement('tr');
                endRow.id = 'end-of-history-row';
                endRow.innerHTML = `<td colspan="5" style="text-align:center; padding:15px; color:#cbd5e1; font-style:italic;">- End of History -</td>`;
                if (!document.getElementById('end-of-history-row')) this.tableBody.appendChild(endRow);
            }
            this.isLoadingMore = false;
        }
    }

    setupEditModal() {
        const editModal = document.getElementById('edit-modal');
        const editIdInput = document.getElementById('edit-id');
        const editOldIdInput = document.getElementById('edit-old-id');
        const editAmountInput = document.getElementById('edit-amount');
        const editStatusInput = document.getElementById('edit-status');
        const cancelEditBtn = document.getElementById('cancel-edit');
        const saveEditBtn = document.getElementById('save-edit');

        this.openEditModal = (id) => {
            const item = this.allItems.find(i => i.id == id);
            if (!item) return;
            
            editOldIdInput.value = item.id;
            editIdInput.value = item.id;
            editAmountInput.value = item.amount;
            editStatusInput.value = item.status;
            
            editModal.style.display = 'flex';
        };

        cancelEditBtn.onclick = () => {
            editModal.style.display = 'none';
        };

        saveEditBtn.onclick = async () => {
            const oldId = editOldIdInput.value;
            const newId = editIdInput.value.trim();
            const item = this.allItems.find(i => i.id == oldId);
            if (!item) return;
            
            const newItem = { ...item, id: newId, amount: parseFloat(editAmountInput.value), status: editStatusInput.value.trim() };
            
            if (oldId !== newId) await deleteTransaction(oldId);
            await saveTransaction(newId, newItem);
            location.reload();
        };
    }

    exportData() {
        if (this.allItems.length === 0) return;
        let csv = "ID,Amount,Status,Date,Sender Name,Sender Phone,Repeat Count,Imported\n";
        this.allItems.forEach(i => {
            const senderName = i.senderName ? `"${i.senderName.replace(/"/g, '""')}"` : "";
            const senderPhone = i.senderPhone ? `"${i.senderPhone.replace(/"/g, '""')}"` : "";
            const status = i.status ? `"${i.status.replace(/"/g, '""')}"` : "";
            let dateStr = i.dateVerified || (i.timestamp ? new Date(i.timestamp).toLocaleString() : "");
            const date = `"${dateStr.replace(/"/g, '""')}"`;
            const imported = i.imported ? "Yes" : "No";
            csv += `${i.id},${i.amount},,,,,${i.repeatCount || 0},\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Full_Report_${new Date().toLocaleDateString()}.csv`;
        a.click();
    }

    setupImport(importBtn) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        importBtn.onclick = () => fileInput.click();

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                const text = event.target.result;
                const lines = text.split(/\r\n|\n/);
                if (lines.length < 2) {
                    alert("Invalid CSV: No data found.");
                    return;
                }

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
                const idIdx = headers.indexOf('id');
                const amtIdx = headers.indexOf('amount');
                const statusIdx = headers.indexOf('status');
                const dateIdx = headers.indexOf('date');
                const countIdx = headers.findIndex(h => h.includes('count') || h.includes('repeat'));
                const senderNameIdx = headers.indexOf('sender name');
                const senderPhoneIdx = headers.indexOf('sender phone');

                if (idIdx === -1 || amtIdx === -1 || statusIdx === -1) {
                    alert("Invalid CSV: Missing required columns (ID, Amount, Status).");
                    return;
                }

                let importedCount = 0;
                let newCount = 0;
                let mergedCount = 0;
                const newItems = {};

                // Need to fetch existing data to merge properly, or rely on what's loaded
                // For simplicity, we assume what's loaded in allItems is enough or we just overwrite
                // But to be safe, we should check against DB. Since that's expensive, we'll check against loaded items.
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const row = [];
                    let inQuote = false, col = '';
                    for (let c of line) {
                        if (c === '"') { inQuote = !inQuote; continue; }
                        if (c === ',' && !inQuote) { row.push(col); col = ''; continue; }
                        col += c;
                    }
                    row.push(col);

                    if (row.length < headers.length) continue;

                    const id = row[idIdx].trim();
                    const amount = parseFloat(row[amtIdx]);
                    const status = row[statusIdx].trim();
                    const date = dateIdx !== -1 ? row[dateIdx].trim() : new Date().toLocaleString();

                    if (id && !isNaN(amount)) {
                        const key = `tx_`;
                        const existing = this.allItems.find(item => item.id == id);
                        const isUpdate = !!existing;
                        const importRepeatCount = (countIdx !== -1) ? (parseInt(row[countIdx]) || 0) : 0;
                        const previousCount = existing ? (existing.repeatCount || 0) : 0;

                        let ts = new Date(date).getTime() || Date.now();
                        if (ts > Date.now() + 86400000) {
                            const d = new Date(ts);
                            d.setFullYear(d.getFullYear() - 1);
                            ts = d.getTime();
                        }

                        const senderName = senderNameIdx !== -1 ? row[senderNameIdx]?.trim() : null;
                        const senderPhone = senderPhoneIdx !== -1 ? row[senderPhoneIdx]?.trim() : null;

                        newItems[key] = {
                            ...(existing || {}),
                            id, amount, status, dateVerified: date,
                            timestamp: ts,
                            repeatCount: previousCount + importRepeatCount,
                            imported: true,
                            senderName: senderName || (existing ? existing.senderName : null),
                            senderPhone: senderPhone || (existing ? existing.senderPhone : null),
                        };
                        
                        if (isUpdate) mergedCount++;
                        else newCount++;
                        
                        importedCount++;
                    }
                }

                if (importedCount > 0) {
                    this.showImportModal({ total: importedCount, new: newCount, merged: mergedCount }, newItems);
                } else {
                    alert("No valid transactions found.");
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        };
    }

    showImportModal(stats, itemsToSave) {
        const overlay = document.createElement('div');
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;";
        
        const modal = document.createElement('div');
        modal.style.cssText = "background:white; padding:20px; border-radius:8px; width:300px; box-shadow:0 4px 6px rgba(0,0,0,0.1); font-family: 'Segoe UI', sans-serif;";
        
        modal.innerHTML = `
            <h3 style="margin-top:0; color:#334155; font-size:16px;">Import Summary</h3>
            <div style="margin:15px 0; font-size:13px; color:#475569;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #f1f5f9;">
                    <span>Total Valid Rows:</span> <b>${stats.total}</b>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>New Transactions:</span> <b style="color:#10b981;">${stats.new}</b>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span>Merged/Updated:</span> <b style="color:#3b82f6;">${stats.merged}</b>
                </div>
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                <button id="btn-cancel-import" style="padding:6px 12px; border:1px solid #cbd5e1; background:white; border-radius:4px; cursor:pointer; font-size:12px;">Cancel</button>
                <button id="btn-confirm-import" style="padding:6px 12px; border:none; background:#3b82f6; color:white; border-radius:4px; cursor:pointer; font-size:12px;">Import Data</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        document.getElementById('btn-cancel-import').onclick = () => overlay.remove();
        document.getElementById('btn-confirm-import').onclick = async () => {
            const btn = document.getElementById('btn-confirm-import');
            btn.innerText = "Importing...";
            btn.disabled = true;
            
            const promises = Object.values(itemsToSave).map(item => saveTransaction(item.id, item));
            await Promise.all(promises);
            
            overlay.remove();
            location.reload();
        };
    }

    setupMigration(migrateBtn) {
        migrateBtn.onclick = async () => {
            const localData = await chrome.storage.local.get(null);
            const txKeys = Object.keys(localData).filter(k => k.startsWith('tx_') && typeof localData[k] === 'object');
            const total = txKeys.length;

            if (total === 0) {
                alert("No local history found to upload.");
                return;
            }

            const modal = document.createElement('div');
            modal.id = 'migration-modal';
            modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.95); z-index:10000; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:'Segoe UI', sans-serif;";
            modal.innerHTML = `
                <div style="background:white; color:#334155; padding:25px; border-radius:12px; width:320px; text-align:center; box-shadow:0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);">
                    <h3 style="margin-top:0; font-size:18px; color:#1e293b;">Syncing History</h3>
                    <p style="font-size:13px; color:#64748b; margin-bottom:20px;">
                        Checking ${total.toLocaleString()} local records against the database...
                    </p>
                    
                    <div style="background:#e2e8f0; border-radius:999px; height:8px; width:100%; margin-bottom:10px; overflow:hidden;">
                        <div id="mig-progress" style="background:#8b5cf6; height:100%; width:0%; transition:width 0.2s;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b; margin-bottom:20px;">
                        <span id="mig-count">0 / </span>
                        <span id="mig-percent">0%</span>
                    </div>

                    <div style="text-align:left; background:#f8fafc; padding:10px; border-radius:6px; font-size:11px; color:#475569; margin-bottom:20px;">
                        <div>🔍 Checked: <b id="mig-checked">0</b></div>
                        <div>☁️ Uploaded: <b id="mig-uploaded" style="color:#10b981;">0</b></div>
                        <div>⏭️ Skipped: <b id="mig-skipped" style="color:#64748b;">0</b></div>
                    </div>

                    <button id="mig-cancel" style="padding:8px 16px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">Cancel</button>
                </div>
            `;
            document.body.appendChild(modal);

            let processed = 0;
            let uploaded = 0;
            let skipped = 0;
            let isCancelled = false;

            const updateUI = () => {
                const pct = Math.round((processed / total) * 100);
                document.getElementById('mig-progress').style.width = `%`;
                document.getElementById('mig-count').innerText = ` / `;
                document.getElementById('mig-percent').innerText = `%`;
                document.getElementById('mig-checked').innerText = processed;
                document.getElementById('mig-uploaded').innerText = uploaded;
                document.getElementById('mig-skipped').innerText = skipped;
            };

            document.getElementById('mig-cancel').onclick = () => {
                isCancelled = true;
                modal.remove();
                alert("Migration cancelled.");
                location.reload();
            };

            const BATCH_SIZE = 10;
            
            const processItem = async (key) => {
                if (isCancelled) return;
                const item = localData[key];
                try {
                    const exists = await getTransaction(item.id);
                    
                    if (exists) {
                        skipped++;
                    } else {
                        const payload = {
                            id: item.id,
                            amount: item.amount,
                            status: item.status,
                            timestamp: item.timestamp || new Date(item.dateVerified).getTime(),
                            dateVerified: item.dateVerified,
                            senderName: item.senderName || null,
                            senderPhone: item.senderPhone || null,
                            recipientName: item.recipientName || null,
                            bankDate: item.bankDate || null,
                            repeatCount: item.repeatCount || 0
                        };
                        await saveTransaction(item.id, payload);
                        uploaded++;
                    }
                } catch (e) {
                    console.error("Migration error for", item.id, e);
                    skipped++;
                } finally {
                    processed++;
                    updateUI();
                }
            };

            for (let i = 0; i < total; i += BATCH_SIZE) {
                if (isCancelled) break;
                const chunk = txKeys.slice(i, i + BATCH_SIZE);
                await Promise.all(chunk.map(key => processItem(key)));
            }

            if (!isCancelled) {
                const btn = document.getElementById('mig-cancel');
                btn.innerText = "Close";
                btn.style.background = "#3b82f6";
                btn.style.color = "white";
                btn.style.border = "none";
                btn.onclick = () => {
                    modal.remove();
                    location.reload();
                };
                
                const h3 = modal.querySelector('h3');
                h3.innerText = "Migration Complete! 🎉";
                h3.style.color = "#10b981";
            }
        };
    }

    clearHistory() {
        alert("Clearing history is disabled in Centralized Database mode to preserve team data.");
    }
}
