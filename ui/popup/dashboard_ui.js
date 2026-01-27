// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\dashboard_ui.js
import { getRecentTransactions, getTransactionsForDate, getUserTransactionsForDate, onDailyStatsUpdate, onUserDailyStatsUpdate, onRecentTransactionsUpdate } from '../../services/storage_service.js';
import { renderChart, renderHourlyChart, renderBankChart, initSpeedChart, renderSpeedChart } from './charts.js';

export class DashboardUI {
    constructor() {
        this.unsubscribeDailyStats = null;
        this.unsubscribeRecentTx = null;
        this.currentScope = 'my';
        this.hasLoaded = false;
        
        this.okSumEl = document.getElementById('ok-sum');
        this.failSumEl = document.getElementById('fail-sum');
        this.successRateEl = document.getElementById('success-rate');
        this.avgAmountEl = document.getElementById('avg-amount');
        this.datePicker = document.getElementById('date-picker');
        this.scopeToggle = document.getElementById('stats-scope-toggle');
        
        this.okTotal = 0;
        this.failTotal = 0;
        this.okCount = 0;
        this.failCount = 0;
        this.configuredBanks = [];
    }

    async init(settings) {
        this.configuredBanks = settings.banks || [];
        
        if (this.scopeToggle) {
            this.scopeToggle.querySelectorAll('.scope-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (btn.classList.contains('active')) return;
                    this.scopeToggle.querySelector('.active').classList.remove('active');
                    btn.classList.add('active');
                    this.currentScope = btn.dataset.scope;
                    
                    const todayStr = new Date().toISOString().split('T')[0];
                    const currentDate = this.datePicker.value || todayStr;
                    this.updateDashboard(currentDate);
                    await renderSpeedChart(this.currentScope);
                });
            });
        }
    }

    async loadData() {
        if (this.hasLoaded) return;
        console.log("Loading dashboard data...");
        
        const todayStr = new Date().toISOString().split('T')[0];
        if (this.datePicker) this.datePicker.value = todayStr;
        
        await this.updateDashboard(todayStr);
        
        initSpeedChart(() => renderSpeedChart(this.currentScope));
        await renderSpeedChart(this.currentScope);
        
        const { transactions } = await getRecentTransactions(5);
        this.renderRecent(transactions);
        
        this.unsubscribeRecentTx = onRecentTransactionsUpdate(5, (liveTransactions) => this.renderRecent(liveTransactions));
        
        this.hasLoaded = true;
    }

    async updateDashboard(dateStr) {
        if (this.unsubscribeDailyStats) {
            this.unsubscribeDailyStats();
        }

        this.okSumEl.innerText = '…';
        this.failSumEl.innerText = '…';
        if (this.successRateEl) this.successRateEl.innerText = '…';
        if (this.avgAmountEl) this.avgAmountEl.innerText = '…';

        const statsListener = this.currentScope === 'team' ? onDailyStatsUpdate : onUserDailyStatsUpdate;
        const txFetcher = this.currentScope === 'team' ? getTransactionsForDate : getUserTransactionsForDate;

        const itemsForDate = await txFetcher(dateStr);
        renderHourlyChart(itemsForDate);
        renderBankChart(itemsForDate, this.configuredBanks);

        this.unsubscribeDailyStats = statsListener(dateStr, (dailyStats) => {
            this.okCount = dailyStats.success || 0;
            this.failCount = dailyStats.fail || 0;
            this.okTotal = dailyStats.amount || 0;
            this.failTotal = dailyStats.failAmount || 0;

            this.renderStats();
            renderChart(this.okCount, this.failCount);
        });
    }

    renderStats() {
        this.okSumEl.innerText = this.okTotal.toLocaleString();
        this.failSumEl.innerText = this.failTotal.toLocaleString();
        
        const totalTx = this.okCount + this.failCount;
        const rate = totalTx > 0 ? Math.round((this.okCount / totalTx) * 100) : 0;
        const avg = this.okCount > 0 ? Math.round(this.okTotal / this.okCount) : 0;
        
        if (this.successRateEl) this.successRateEl.innerText = `${rate}%`;
        if (this.avgAmountEl) this.avgAmountEl.innerText = avg.toLocaleString();
    }

    renderRecent(items = []) {
        const container = document.getElementById('recent-list');
        if (!container) return;
        
        const recent = items.slice(0, 5);
        if (recent.length === 0) {
            container.innerHTML = "<div style='text-align:center; color:#94a3b8; font-size:12px; padding:15px; font-style:italic;'>No recent transactions</div>";
            return;
        }
        
        container.innerHTML = '';

        recent.forEach(item => {
            const div = document.createElement('div');
            div.className = 'recent-item';
            
            const isVerified = item.status.includes('Verified');
            const isAA = item.status.includes('AA');
            let statusColor = '#dc2626';
            let statusIcon = '✕';

            if (isVerified) { statusColor = '#059669'; statusIcon = '✓'; }
            else if (isAA) { statusColor = '#3b82f6'; statusIcon = '✓'; }
            
            const dateObj = new Date(item.timestamp || item.dateVerified);
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background: 15; color: ; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">
                        
                    </div>
                    <div>
                        <div class="recent-id">${item.id}</div>
                        <div class="recent-meta"> • ${item.senderName || 'Unknown'}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 700; font-size: 13px; color: #334155;">${item.amount}</div>
                    <div style="font-size: 10px; font-weight: 600; color: ;">${item.status}</div>
                </div>
            `;
            container.appendChild(div);
        });
    }

    cleanup() {
        if (this.unsubscribeDailyStats) this.unsubscribeDailyStats();
        if (this.unsubscribeRecentTx) this.unsubscribeRecentTx();
    }
}
