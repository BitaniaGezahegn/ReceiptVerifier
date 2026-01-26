// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\dashboard_ui.js
import { onDailyStatsUpdate, onRecentTransactionsUpdate } from '../../services/storage_service.js';

export class DashboardUI {
    constructor() {
        this.statsUnsubscribe = null;
        this.recentUnsubscribe = null;
    }

    init(settings) {
        this.settings = settings;
        this.container = document.getElementById('dashboard');
        if (!this.container) return;
        
        // Render structure if empty
        if (!this.container.querySelector('.stats-grid')) {
            this.renderLayout();
        }
    }

    renderLayout() {
        this.container.innerHTML = `
            <div class="stats-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px;">
                <div class="stat-card" style="background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 500;">Today's Volume</div>
                    <div class="stat-value" id="stat-amount" style="font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px;">0 ETB</div>
                </div>
                <div class="stat-card" style="background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 500;">Verified</div>
                    <div class="stat-value" id="stat-success" style="font-size: 18px; font-weight: 700; color: #10b981; margin-top: 4px;">0</div>
                </div>
                <div class="stat-card" style="background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 500;">Failed / Skipped</div>
                    <div class="stat-value" id="stat-fail" style="font-size: 18px; font-weight: 700; color: #ef4444; margin-top: 4px;">0</div>
                </div>
                <div class="stat-card" style="background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); border: 1px solid #f1f5f9;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 500;">Total Processed</div>
                    <div class="stat-value" id="stat-total" style="font-size: 18px; font-weight: 700; color: #3b82f6; margin-top: 4px;">0</div>
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h3 style="font-size: 15px; font-weight: 700; color: #334155; margin: 0;">Recent Activity</h3>
                <span style="font-size: 11px; color: #94a3b8; background: #f8fafc; padding: 2px 8px; border-radius: 12px;">Live Updates</span>
            </div>
            
            <div id="recent-activity-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 450px; overflow-y: auto; padding-bottom: 10px;">
                <!-- Items injected here -->
                <div style="text-align:center; padding: 20px; color: #cbd5e1;">Loading activity...</div>
            </div>
        `;
    }

    loadData() {
        this.cleanup();

        const today = new Date().toISOString().split('T')[0];
        
        // 1. Stats Listener
        this.statsUnsubscribe = onDailyStatsUpdate(today, (stats) => {
            this.updateStatsUI(stats);
        });

        // 2. Recent Transactions Listener
        this.recentUnsubscribe = onRecentTransactionsUpdate(25, (transactions) => {
            this.updateRecentList(transactions);
        });
    }

    updateStatsUI(stats) {
        if (!stats) return;
        const fmt = (n) => new Intl.NumberFormat('en-ET').format(n);
        
        const elAmount = document.getElementById('stat-amount');
        const elSuccess = document.getElementById('stat-success');
        const elFail = document.getElementById('stat-fail');
        const elTotal = document.getElementById('stat-total');

        if(elAmount) elAmount.innerText = `${fmt(stats.amount || 0)} ETB`;
        if(elSuccess) elSuccess.innerText = fmt(stats.success || 0);
        if(elFail) elFail.innerText = fmt(stats.fail || 0);
        if(elTotal) elTotal.innerText = fmt(stats.total || 0);
    }

    updateRecentList(transactions) {
        const list = document.getElementById('recent-activity-list');
        if (!list) return;
        
        list.innerHTML = '';
        
        if (transactions.length === 0) {
            list.innerHTML = `
                <div style="text-align:center; padding: 40px 20px; color: #94a3b8; background: #f8fafc; border-radius: 8px; border: 1px dashed #e2e8f0;">
                    <div style="font-size: 24px; margin-bottom: 8px;">📭</div>
                    <div>No recent activity found</div>
                </div>`;
            return;
        }

        transactions.forEach(tx => {
            const el = this.createTransactionCard(tx);
            list.appendChild(el);
        });
    }

    createTransactionCard(tx) {
        const div = document.createElement('div');
        div.className = 'activity-item';
        
        // Determine Styles
        let statusColor = '#64748b'; 
        let statusBg = '#f1f5f9';
        let borderColor = '#cbd5e1';
        let icon = '📝';

        if (tx.status === 'Verified' || (tx.status && tx.status.startsWith('AA'))) {
            statusColor = '#10b981'; // Green
            statusBg = '#ecfdf5';
            borderColor = '#10b981';
            icon = '✅';
        } else if (tx.status === 'Repeat') {
            statusColor = '#f59e0b'; // Amber
            statusBg = '#fffbeb';
            borderColor = '#f59e0b';
            icon = '🔁';
        } else if (tx.status === 'Bank 404' || tx.status === 'Invalid ID' || tx.status === 'Under 50') {
            statusColor = '#f59e0b';
            statusBg = '#fffbeb';
            borderColor = '#f59e0b';
            icon = '⚠️';
        } else if (tx.status === 'Random' || tx.status === 'PDF') {
            statusColor = '#64748b';
            statusBg = '#f8fafc';
            borderColor = '#94a3b8';
            icon = '❓';
        } else {
            statusColor = '#ef4444'; // Red
            statusBg = '#fef2f2';
            borderColor = '#ef4444';
            icon = '❌';
        }

        const timeAgo = this.getTimeAgo(tx.timestamp);
        const processedBy = tx.processedBy ? tx.processedBy.split('@')[0] : 'System';
        
        div.style.cssText = `
            background: white;
            border-left: 4px solid ${borderColor};
            padding: 10px;
            border-radius: 6px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            border-top: 1px solid #f1f5f9;
            border-right: 1px solid #f1f5f9;
            border-bottom: 1px solid #f1f5f9;
            transition: transform 0.1s;
            margin-bottom: 8px;
        `;

        // Detail Rows
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                <div style="font-family: monospace; font-weight: 700; color: #334155; font-size: 14px;">${tx.id}</div>
                <span style="font-size:10px; color:${statusColor}; background:${statusBg}; padding:2px 6px; border-radius:4px; font-weight:600; display: inline-flex; align-items:center; gap:3px;">
                        ${icon} ${tx.status}
                </span>
            </div>
            
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed #e2e8f0;">
                <div style="font-size:18px; font-weight:800; color:#0f172a;">${tx.amount} <span style="font-size:11px; font-weight:500; color:#64748b;">ETB</span></div>
                <div style="font-size:10px; color:#94a3b8; font-style: italic;">${timeAgo}</div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr auto 1fr; gap: 8px; font-size: 11px; align-items:center; margin-bottom: 6px;">
                <div style="overflow:hidden;">
                    <div style="color:#94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">Sender</div>
                    <div style="color:#334155; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${tx.senderName || '-'}">
                        ${tx.senderName || '<span style="color:#cbd5e1;">-</span>'}
                    </div>
                    <div style="color:#64748b; font-size: 9px; margin-top: 1px;">${tx.senderPhone || ''}</div>
                </div>
                <div style="color:#cbd5e1;">➔</div>
                <div style="overflow:hidden; text-align:right;">
                    <div style="color:#94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;">Recipient</div>
                    <div style="color:#0f172a; font-weight:700; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${tx.recipientName || '-'}">
                        ${tx.recipientName || '<span style="color:#cbd5e1;">-</span>'}
                    </div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; padding-top: 4px; border-top: 1px solid #f8fafc;">
                <div>📅 ${tx.bankDate || '-'}</div>
                <div>👤 ${processedBy}</div>
            </div>
        `;

        return div;
    }

    getTimeAgo(timestamp) {
        if (!timestamp) return '';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        if (seconds < 60) return 'Just now';
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `m ago`;
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `h ago`;
        
        const days = Math.floor(hours / 24);
        if (days < 7) return `d ago`;
        
        return new Date(timestamp).toLocaleDateString();
    }

    cleanup() {
        if (this.statsUnsubscribe) {
            this.statsUnsubscribe();
            this.statsUnsubscribe = null;
        }
        if (this.recentUnsubscribe) {
            this.recentUnsubscribe();
            this.recentUnsubscribe = null;
        }
    }
}
