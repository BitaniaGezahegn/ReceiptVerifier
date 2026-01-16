import { loginWithGoogle, logout, getCurrentUser } from './services/auth_service.js';
import { getRecentTransactions, getMoreTransactions, getDailyStats, saveTransaction, deleteTransaction, getStatsForDate, getTransactionsForDate, onDailyStatsUpdate, onRecentTransactionsUpdate, getTransactionsForRange, onUserDailyStatsUpdate, getUserTransactionsForDate, getUserTransactionsForRange, getTransaction } from './services/storage_service.js';
import { auth } from './services/firebase_config.js';
import { onAuthStateChanged } from './firebase/firebase-auth.js';

document.addEventListener('DOMContentLoaded', async () => {
  let unsubscribeDailyStats = null;
  let unsubscribeRecentTx = null;
  let currentScope = 'my'; // 'team' or 'my'
  let lastVisibleDoc = null; // For infinite scroll
  let isLoadingMore = false; // To prevent multiple fetches

  // --- NEW: Flags for on-demand loading ---
  let hasDashboardLoaded = false;
  let hasHistoryLoaded = false;

  // --- NEW: Cache for recent transactions to reduce reads on popup open ---
  const RECENT_TX_CACHE_TTL = 30 * 1000; // 30 seconds
  let recentTxCache = {
      data: null,
      timestamp: 0,
      lastDoc: null
  };

  // Cleanup listeners when popup closes to prevent memory leaks
  window.addEventListener('unload', () => {
    if (unsubscribeDailyStats) unsubscribeDailyStats();
    if (unsubscribeRecentTx) unsubscribeRecentTx();
  });

  function getTimeAgo(item) {
    let ts = null;
    // Prioritize bankDate, then timestamp, then the old dateVerified string
    if (item.bankDate) {
        try {
            // Format from bank is 'YYYY-MM-DD HH:MM:SS +ZZZZ'
            const p = item.bankDate.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\s(\+\d{4})/);
            if (p) {
              ts = new Date(`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}${p[7].slice(0,3)}:${p[7].slice(3)}`).getTime();
            } else {
                // Fallback for other date string formats
                ts = new Date(item.bankDate).getTime();
            }
        } catch(e) { /* ignore */ }
    }
    
    if (!ts || isNaN(ts)) {
        ts = item.timestamp;
    }

    if (!ts || isNaN(ts)) {
        try {
            // Fallback for very old data that might have this format
            ts = new Date(item.dateVerified).getTime();
        } catch(e) { /* ignore */ }
    }

    if (!ts || isNaN(ts)) return "N/A";
    
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return "Just now";
    
    const diffMins = Math.floor(diffMs / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    
    if (h >= 24) {
        const days = Math.floor(h / 24);
        return days > 1 ? `${days} days ago` : `1 day ago`;
    }
    return h > 0 ? `${h}h ${m}m ago` : `${m}m ago`;
}

  // 0. AUTH & DATA LOADING WRAPPER
  const initPopup = async (user) => {
    // Show/Hide Login UI
    const loginOverlay = document.getElementById('login-overlay');
    if (!user) {
        if(loginOverlay) loginOverlay.style.display = 'flex';
        return;
    }
    if(loginOverlay) loginOverlay.style.display = 'none';

    // Load Settings (Local)
    const localSettings = await chrome.storage.local.get(null);
    
    // Merge for UI compatibility
    const data = { ...localSettings };
    
  // Tab Switching Logic
  const tabs = document.querySelectorAll('.tab-link');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const tabId = tab.dataset.tab;
      document.getElementById(tabId).classList.add('active');

      // --- NEW: On-demand loading logic ---
      if (tabId === 'dashboard' && !hasDashboardLoaded) {
          loadDashboardData();
      } else if (tabId === 'history' && !hasHistoryLoaded) {
          loadHistoryData();
      }
    });
  });

  // --- NEW: Check if an initial tab needs loading (if not settings) ---
  const activeTab = document.querySelector('.tab-link.active');
  if (activeTab && activeTab.dataset.tab !== 'settings') {
    activeTab.click(); // Simulate a click to trigger the loading logic
  }

  // --- NEW: Scope Toggle Logic ---
  const scopeToggle = document.getElementById('stats-scope-toggle');
  if (scopeToggle) {
      scopeToggle.querySelectorAll('.scope-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
              if (btn.classList.contains('active')) return;
              scopeToggle.querySelector('.active').classList.remove('active');
              btn.classList.add('active');
              currentScope = btn.dataset.scope;
              
              const todayStr = new Date().toISOString().split('T')[0];
              const currentDate = datePicker.value || todayStr;
              updateDashboard(currentDate);
              await renderSpeedChart();
          });
      });
  }

  // Existing Logic
  const tableBody = document.getElementById('log-body');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const okSumEl = document.getElementById('ok-sum');
  const failSumEl = document.getElementById('fail-sum');
  const successRateEl = document.getElementById('success-rate');
  const avgAmountEl = document.getElementById('avg-amount');
  const clearRecentBtn = document.getElementById('clear-recent-btn');
  const datePicker = document.getElementById('date-picker');
  const tableContainer = document.querySelector('.table-container');

  // Inject "Show Imported Only" Checkbox
  let importedCheckbox = document.getElementById('filter-imported');
  if (!importedCheckbox && searchInput && searchInput.parentNode) {
      const container = document.createElement('div');
      container.style.cssText = "margin: 8px 0; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748b;";
      container.innerHTML = `
          <input type="checkbox" id="filter-imported" style="cursor:pointer;">
          <label for="filter-imported" style="cursor:pointer; user-select:none;">Show Imported Only</label>
      `;
      searchInput.parentNode.insertBefore(container, searchInput.nextSibling);
      importedCheckbox = document.getElementById('filter-imported');
  }
  
  // 1. Stats Variables
  let okTotal = 0;
  let failTotal = 0;
  let okCount = 0;
  let failCount = 0;

  const renderStats = () => {
    okSumEl.innerText = okTotal.toLocaleString();
    failSumEl.innerText = failTotal.toLocaleString();
    
    const totalTx = okCount + failCount;
    const rate = totalTx > 0 ? Math.round((okCount / totalTx) * 100) : 0;
    const avg = okCount > 0 ? Math.round(okTotal / okCount) : 0;
    
    if (successRateEl) successRateEl.innerText = `${rate}%`;
    if (avgAmountEl) avgAmountEl.innerText = avg.toLocaleString();
  };

  // 2. Render Chart (Temporarily Disabled)
  // 2. Render Chart (Vanilla Canvas)
  const renderChart = () => {
    let canvas = document.getElementById('verification-chart');
    if (!canvas) return;

    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    canvas = newCanvas;

    // High DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 100;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - 10;
    const total = okCount + failCount;

    ctx.clearRect(0, 0, size, size);

    // Empty State
    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 15;
      ctx.stroke();
      
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${Math.round(size * 0.13)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No Data", cx, cy);
      return;
    }

    let startAngle = -0.5 * Math.PI;
    const segments = [];

    const drawSlice = (count, color) => {
      if (count <= 0) return;
      const slice = (count / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
      ctx.fillStyle = color;
      ctx.fill();
      segments.push({ start: startAngle, end: startAngle + slice, count, color });
      startAngle += slice;
    };

    drawSlice(okCount, '#4ade80');
    drawSlice(failCount, '#f87171');

    // Doughnut Hole
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.65, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Center Text
    ctx.fillStyle = '#334155';
    ctx.font = `bold ${Math.round(size * 0.22)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, cx, cy - 8);

    ctx.fillStyle = '#64748b';
    ctx.font = `${Math.round(size * 0.11)}px sans-serif`;
    ctx.fillText("Today", cx, cy + 10);

    // Hover Logic
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - (size / 2); // Use logical size
        const dy = y - (size / 2);
        const dist = Math.sqrt(dx*dx + dy*dy);

        // Check if mouse is within the doughnut ring (approximate)
        if (dist <= radius && dist >= radius * 0.5) {
            let angle = Math.atan2(dy, dx);
            // Normalize angle to match canvas arc (0 to 2PI, starting at -0.5PI)
            // Canvas 0 is at 3 o'clock. Our start is -0.5PI (12 o'clock).
            // atan2 returns -PI to PI.
            if (angle < -0.5 * Math.PI) {
                angle += 2 * Math.PI; 
            }
            
            const segment = segments.find(s => angle >= s.start && angle < s.end);
            if (segment) {
                const label = segment.color === '#4ade80' ? 'Verified' : 'Failed';
                const percent = Math.round((segment.count / total) * 100);
                showTooltip(e.clientX, e.clientY, `${label}: ${segment.count} (${percent}%)`);
                canvas.style.cursor = 'pointer';
            } else {
                hideTooltip();
                canvas.style.cursor = 'default';
            }
        } else {
            hideTooltip();
            canvas.style.cursor = 'default';
        }
    });
    
    canvas.addEventListener('mouseleave', hideTooltip);
  };

  // Tooltip Helper
  let tooltipEl = document.getElementById('chart-tooltip');
  if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chart-tooltip';
      tooltipEl.style.cssText = "position:fixed; display:none; background:rgba(15, 23, 42, 0.9); color:white; padding:6px 10px; border-radius:6px; font-size:11px; pointer-events:none; z-index:1000; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); font-weight: 500;";
      document.body.appendChild(tooltipEl);
  }
  
  const showTooltip = (x, y, text) => {
      tooltipEl.style.left = (x + 10) + 'px';
      tooltipEl.style.top = (y + 10) + 'px';
      tooltipEl.innerText = text;
      tooltipEl.style.display = 'block';
  };
  
  const hideTooltip = () => {
      tooltipEl.style.display = 'none';
  };

  // 2.2 Render Hourly Chart
  const renderHourlyChart = (items) => {
      let canvas = document.getElementById('hourly-chart');
      if (!canvas) return;
      
      // Clone to remove old listeners
      const newCanvas = canvas.cloneNode(true);
      canvas.parentNode.replaceChild(newCanvas, canvas);
      canvas = newCanvas;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      const width = rect.width * dpr;
      const height = rect.height * dpr;
      const paddingBottom = 20 * dpr; // Space for labels
      const chartHeight = height - paddingBottom;
      
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.scale(dpr, dpr);

      // Logical dimensions
      const logicalWidth = width / dpr;
      const logicalHeight = height / dpr;
      const logicalChartHeight = logicalHeight - 20;

      // Aggregate Data
      const hours = new Array(24).fill(0);
      items.forEach(item => {
          const date = new Date(item.timestamp || item.dateVerified);
          hours[date.getHours()]++;
      });

      const max = Math.max(...hours, 1);
      const barWidth = logicalWidth / 24;
      const bars = [];

      ctx.fillStyle = '#3b82f6';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      hours.forEach((count, i) => {
          const h = (count / max) * logicalChartHeight;
          const x = i * barWidth;
          const y = logicalChartHeight - h;
          
          // Draw Bar
          ctx.fillStyle = count > 0 ? '#3b82f6' : '#e2e8f0';
          ctx.fillRect(x + 1, y, barWidth - 2, h);
          
          // Store for hover
          bars.push({ x: x + 1, y, w: barWidth - 2, h, count, hour: i });

          // Draw Labels (0, 6, 12, 18)
          if (i % 6 === 0) {
              ctx.fillStyle = '#94a3b8';
              ctx.font = "10px sans-serif";
              ctx.fillText(i, x + (barWidth/2), logicalChartHeight + 4);
          }
      });

      // Hover Listener
      canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          
          const barIndex = Math.floor(mouseX / (logicalWidth / 24));
          const bar = bars[barIndex];
          
          if (bar) {
              const txt = bar.count > 0 ? `${bar.hour}:00 - ${bar.count} txns` : `${bar.hour}:00 - No activity`;
              showTooltip(e.clientX, e.clientY, txt);
              canvas.style.cursor = 'pointer';
          } else {
              hideTooltip();
              canvas.style.cursor = 'default';
          }
      });
      
      canvas.addEventListener('mouseleave', hideTooltip);
  };

  // 2.3 Render Bank Chart
  const renderBankChart = (items) => {
      let canvas = document.getElementById('bank-chart');
      if (!canvas) return;

      const newCanvas = canvas.cloneNode(true);
      canvas.parentNode.replaceChild(newCanvas, canvas);
      canvas = newCanvas;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // Aggregate Data
      const banks = {};
      const configuredBanks = data.banks || [];
      
      items.forEach(item => {
          const id = item.id.toString();
          let bankName = "Unknown";
          const match = configuredBanks.find(b => b.prefixes.some(p => id.startsWith(p)));
          if (match) bankName = match.name;
          banks[bankName] = (banks[bankName] || 0) + 1;
      });

      const total = items.length;
      const cx = 50;
      const cy = 50;
      const radius = 40;

      if (total === 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
          ctx.strokeStyle = '#f1f5f9';
          ctx.lineWidth = 10;
          ctx.stroke();
          return;
      }

      let startAngle = -Math.PI / 2; // Start at top
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ec4899'];
      let colorIdx = 0;

      for (const [name, count] of Object.entries(banks)) {
          const slice = (count / total) * 2 * Math.PI;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
          ctx.fillStyle = colors[colorIdx % colors.length];
          ctx.fill();
          startAngle += slice;
          colorIdx++;
      }
      
      // Donut Hole
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.5, 0, 2 * Math.PI);
      ctx.fillStyle = 'white';
      ctx.fill();

      // Hover Listener
      canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist <= radius) {
              let angle = Math.atan2(dy, dx);
              // Normalize to 0 - 2PI starting from top (-PI/2)
              let checkAngle = angle + Math.PI/2;
              if (checkAngle < 0) checkAngle += 2*Math.PI;
              
              let currentStart = 0;
              let found = false;
              
              for (const [name, count] of Object.entries(banks)) {
                  const sliceSpan = (count / total) * 2 * Math.PI;
                  if (checkAngle >= currentStart && checkAngle < currentStart + sliceSpan) {
                      const percent = Math.round((count / total) * 100);
                      showTooltip(e.clientX, e.clientY, `${name}: ${count} (${percent}%)`);
                      found = true;
                      break;
                  }
                  currentStart += sliceSpan;
              }
              if (!found) hideTooltip();
          } else {
              hideTooltip();
          }
      });
      
      canvas.addEventListener('mouseleave', hideTooltip);
  };

  // 2.4 Render Speed Chart (TPM)
  const initSpeedChart = () => {
      if (document.getElementById('speed-chart-container')) return;
      
      const container = document.createElement('div');
      container.id = 'speed-chart-container';
      container.style.cssText = "grid-column: 1 / -1; width: 100%; margin-top: 20px; margin-bottom: 20px; background: white; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); box-sizing: border-box;";
      
      container.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <div style="display:flex; align-items:center; gap:8px;">
                  <h3 style="margin:0; font-size:13px; font-weight:600; color:#334155;">Processing Speed (TPM)</h3>
                  <span style="font-size:9px; background:#dcfce7; color:#166534; padding:2px 6px; border-radius:10px;">● LIVE</span>
              </div>
              <select id="speed-range-select" style="padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 11px; background-color: #f8fafc; color: #475569; outline: none; cursor: pointer;">
                  <option value="30m">Last 30 Minutes</option>
                  <option value="1h">Last Hour</option>
                  <option value="24h">Last 24 Hours</option>
                  <option value="7d">Last 7 Days</option>
              </select>
          </div>
          <div style="position: relative; height: 200px; width: 100%;">
              <canvas id="speed-chart"></canvas>
          </div>
      `;
      
      // Robust Insertion Logic
      const recentList = document.getElementById('recent-list');
      const bankCanvas = document.getElementById('bank-chart');
      
      if (recentList && recentList.parentNode) {
          // Insert before recent list (and its header if present)
          let target = recentList;
          if (target.previousElementSibling && target.previousElementSibling.tagName.match(/^H[1-6]$/)) {
              target = target.previousElementSibling;
          }
          recentList.parentNode.insertBefore(container, target);
      } else if (bankCanvas && bankCanvas.parentElement && bankCanvas.parentElement.parentElement) {
          bankCanvas.parentElement.parentElement.appendChild(container);
      } else {
          (document.querySelector('.tab-content.active') || document.body).appendChild(container);
      }
      
      document.getElementById('speed-range-select').addEventListener('change', renderSpeedChart);

  };

  const renderSpeedChart = async () => {
      let canvas = document.getElementById('speed-chart');
      if (!canvas) return;
      
      const select = document.getElementById('speed-range-select');
      const range = select ? select.value : '30m';
      
      // Setup Canvas
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      // Config
      const now = Date.now();
      let startTime, bucketSizeMs, labelFormat;
      
      if (range === '30m') {
          startTime = now - 30 * 60 * 1000;
          bucketSizeMs = 60 * 1000; // 1 min
          labelFormat = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      } else if (range === '1h') {
          startTime = now - 60 * 60 * 1000;
          bucketSizeMs = 60 * 1000; // 1 min
          labelFormat = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      } else if (range === '24h') {
          startTime = now - 24 * 60 * 60 * 1000;
          bucketSizeMs = 60 * 60 * 1000; // 1 hour
          labelFormat = (d) => d.getHours() + 'h';
      } else { // 7d
          startTime = now - 7 * 24 * 60 * 60 * 1000;
          bucketSizeMs = 6 * 60 * 60 * 1000; // 6 hours
          labelFormat = (d) => d.toLocaleDateString([], {weekday:'short'});
      }
      
      // Bucketing
      const buckets = [];
      let t = startTime;
      while (t < now) {
          buckets.push({ start: t, end: t + bucketSizeMs, count: 0 });
          t += bucketSizeMs;
      }
      
      // Fetch Data from Firestore for the specific range
      const txFetcher = currentScope === 'team' ? getTransactionsForRange : getUserTransactionsForRange;
      const speedItems = await txFetcher(startTime, now);
      
      speedItems.forEach(item => {
          const ts = item.timestamp || new Date(item.dateVerified).getTime();
          if (ts >= startTime && ts <= now) {
              const bucket = buckets.find(b => ts >= b.start && ts < b.end);
              if (bucket) bucket.count++;
          }
      });
      
      // Calculate TPM
      const dataPoints = buckets.map(b => b.count / (bucketSizeMs / 60000));
      
      // Determine Color (Green if > 5 TPM)
      const currentTPM = dataPoints[dataPoints.length - 1] || 0;
      const lineColor = currentTPM >= 5 ? '#10b981' : '#3b82f6';

      // Draw Chart
      const padding = { top: 20, right: 10, bottom: 20, left: 30 };
      const chartW = (rect.width) - padding.left - padding.right;
      const chartH = (rect.height) - padding.top - padding.bottom;
      
      const maxVal = Math.max(...dataPoints, 0.1);
      const getY = (val) => padding.top + chartH - ((val / maxVal) * chartH);
      const getX = (idx) => padding.left + (idx / (dataPoints.length - 1)) * chartW;
      
      // Draw Axes & Line (Simplified for brevity, reusing context)
      ctx.beginPath(); ctx.strokeStyle = '#e2e8f0';
      for (let i=0; i<=4; i++) { const y = padding.top + (chartH * i/4); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left+chartW, y); }
      ctx.stroke();
      
      ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
      dataPoints.forEach((val, i) => { const x = getX(i); const y = getY(val); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
      ctx.stroke();
      
      // Hover
      canvas.onmousemove = (e) => {
          const r = canvas.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const idx = Math.round(((mx - padding.left) / chartW) * (dataPoints.length - 1));
          if (idx >= 0 && idx < dataPoints.length) {
              const val = dataPoints[idx];
              const b = buckets[idx];
              showTooltip(e.clientX, e.clientY, `${labelFormat(new Date(b.start))}: ${val.toFixed(2)} TPM (${b.count} txns)`);
          } else hideTooltip();
      };
      canvas.onmouseleave = hideTooltip;
  };

  // --- NEW: Data loading functions ---
  const loadDashboardData = async () => {
    if (hasDashboardLoaded) return;
    console.log("Loading dashboard data...");
    
    const todayStr = new Date().toISOString().split('T')[0];
    if (datePicker) datePicker.value = todayStr;
    
    await updateDashboard(todayStr);
    
    initSpeedChart();
    await renderSpeedChart();
    
    const { transactions } = await getRecentTransactions(5);
    renderRecent(transactions);
    
    // This listener is now ONLY for the dashboard's "Recent Activity"
    unsubscribeRecentTx = onRecentTransactionsUpdate(5, (liveTransactions) => renderRecent(liveTransactions));
    
    hasDashboardLoaded = true;
  };

  let allItems = []; // Moved to a higher scope for loadHistoryData
  const loadHistoryData = async () => {
    if (hasHistoryLoaded) return;
    console.log("Loading history data...");

    const now = Date.now();
    let transactions, lastDoc;

    if (recentTxCache.data && (now - recentTxCache.timestamp < RECENT_TX_CACHE_TTL)) {
        transactions = recentTxCache.data;
        lastDoc = recentTxCache.lastDoc;
    } else {
        const result = await getRecentTransactions(100);
        transactions = result.transactions;
        lastDoc = result.lastDoc;
        recentTxCache = { data: transactions, timestamp: now, lastDoc: lastDoc };
    }
    lastVisibleDoc = lastDoc;
    allItems = transactions;
    allItems.sort((a, b) => (b.timestamp || new Date(b.dateVerified)) - (a.timestamp || new Date(a.dateVerified)));
    
    renderTable();
    
    hasHistoryLoaded = true;
  };

  // 2.1 Update Dashboard Logic
  const updateDashboard = async (dateStr) => {
    // Clean up previous listener to prevent multiple updates
    if (unsubscribeDailyStats) {
      unsubscribeDailyStats();
    }

    // Show a loading state on the dashboard cards
    okSumEl.innerText = '…';
    failSumEl.innerText = '…';
    if (successRateEl) successRateEl.innerText = '…';
    if (avgAmountEl) avgAmountEl.innerText = '…';

    // Set up new listener for the selected date's stats
    const statsListener = currentScope === 'team' ? onDailyStatsUpdate : onUserDailyStatsUpdate;
    const txFetcher = currentScope === 'team' ? getTransactionsForDate : getUserTransactionsForDate;

    // --- OPTIMIZATION ---
    // 1. Fetch the transaction list for charts ONCE when the date/scope changes.
    const itemsForDate = await txFetcher(dateStr);
    renderHourlyChart(itemsForDate);
    renderBankChart(itemsForDate);

    // 2. Set up a listener that ONLY updates the stats, not the whole transaction list.
    unsubscribeDailyStats = statsListener(dateStr, (dailyStats) => {
      // Update overview stats from the live data
      okCount = dailyStats.success || 0;
      failCount = dailyStats.fail || 0;
      okTotal = dailyStats.amount || 0;
      failTotal = dailyStats.failAmount || 0;

      // Re-render only the components that depend on aggregate stats
      renderStats();
      renderChart();
    });
  };

  // 2.5 Render Recent Activity (Dashboard)
  const renderRecent = (items = []) => {
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
                <div style="width: 24px; height: 24px; border-radius: 50%; background: ${statusColor}15; color: ${statusColor}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">
                    ${statusIcon}
                </div>
                <div>
                    <div class="recent-id">${item.id}</div>
                    <div class="recent-meta">${timeStr} • ${item.senderName || 'Unknown'}</div>
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 700; font-size: 13px; color: #334155;">${item.amount}</div>
                <div style="font-size: 10px; font-weight: 600; color: ${statusColor};">${item.status}</div>
            </div>
        `;
        container.appendChild(div);
    });
  };

  // 3. Render Table
  const renderTable = () => {
    const filterText = searchInput ? searchInput.value : "";
    const showImported = importedCheckbox ? importedCheckbox.checked : false;

    tableBody.innerHTML = "";
    const filtered = allItems.filter(item => {
      const matchesText = item.id.toString().includes(filterText) || item.status.toLowerCase().includes(filterText.toLowerCase());
      const matchesImport = showImported ? item.imported === true : true;
      return matchesText && matchesImport;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';
      let lastDate = null;

      filtered.forEach(item => {
        // Date Grouping Logic
        const itemDateObj = new Date(item.timestamp || item.dateVerified);
        const dateStr = itemDateObj.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        
        if (dateStr !== lastDate) {
            const dateRow = document.createElement('tr');
            dateRow.style.cursor = 'pointer';
            dateRow.style.userSelect = 'none';
            dateRow.innerHTML = `<td colspan="5" class="date-header"><span style="display:inline-block; width:20px;">▼</span>${dateStr}</td>`;
            
            dateRow.onclick = () => {
                const rows = tableBody.querySelectorAll(`tr[data-date="${dateStr}"]`);
                const icon = dateRow.querySelector('span');
                const isCollapsed = icon.innerText === '▶';
                icon.innerText = isCollapsed ? '▼' : '▶';
                rows.forEach(r => r.style.display = isCollapsed ? '' : 'none');
            };

            tableBody.appendChild(dateRow);
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
        const ageStr = getTimeAgo(item);
        const ageInfo = ageStr !== "N/A" ? `<br><span style="font-size:10px; color:#64748b;">Age: ${ageStr}</span>` : "";
        
        const count = (item.repeatCount || 0) + 1;

        row.innerHTML = `
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
                <span class="id-text">${item.id}</span>
                <button class="copy-btn" data-copy="${item.id}" title="Copy ID">📋</button>
            </div>
            <div style="font-size:10px; color:#94a3b8; margin-top:3px;">
                ${timeStr} <span style="color:#64748b;">(x${count})</span>${ageInfo}
            </div>
          </td>
          <td>${senderInfo}</td>
          <td>${item.amount}</td>
          <td class="${isVerified ? 'status-ok' : (isAA ? '' : 'status-err')}" style="${isAA ? 'color:#3b82f6; font-weight:bold;' : ''}">${item.status}</td>
          <td style="text-align:center; white-space:nowrap;">
            <button class="edit-btn" data-id="${item.id}" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.7; margin-right:5px;" title="Edit">✏️</button>
            <button class="del-item-btn" data-id="${item.id}" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.7;" title="Delete Log">🗑️</button>
          </td>
        `;
        tableBody.appendChild(row);
      });

      // Copy Button Logic
      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const text = e.target.dataset.copy;
            navigator.clipboard.writeText(text);
            
            // Visual Feedback
            const original = e.target.innerText;
            e.target.innerText = '✅';
            e.target.style.opacity = '1';
            setTimeout(() => {
                e.target.innerText = original;
                e.target.style.opacity = '';
            }, 1000);
        };
      });

      document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.target.closest('button').dataset.id;
            openEditModal(id);
        };
      });

      document.querySelectorAll('.del-item-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.target.closest('button').dataset.id;
            if (confirm("Delete transaction " + id + "?")) {
                await deleteTransaction(id);
                location.reload();
            }
        };
      });
    }
  };

  // Infinite Scroll Logic
  if (tableContainer) {
    tableContainer.addEventListener('scroll', async () => {
        if (isLoadingMore || !lastVisibleDoc) return;

        const { scrollTop, scrollHeight, clientHeight } = tableContainer;
        // Load more when user is 150px from the bottom
        if (scrollHeight - scrollTop < clientHeight + 150) {
            isLoadingMore = true;

            const loadingRow = document.createElement('tr');
            loadingRow.id = 'loading-more-row';
            loadingRow.innerHTML = `<td colspan="5" style="text-align:center; padding:15px; color:#94a3b8; font-style:italic;">Loading more...</td>`;
            tableBody.appendChild(loadingRow);

            const { transactions: newTransactions, lastDoc: newLastDoc } = await getMoreTransactions(lastVisibleDoc, 50);

            const existingLoadingRow = document.getElementById('loading-more-row');
            if (existingLoadingRow) tableBody.removeChild(existingLoadingRow);

            if (newTransactions.length > 0) {
                allItems.push(...newTransactions);
                renderTable(); // Re-render with new items
                lastVisibleDoc = newLastDoc;
            } else {
                lastVisibleDoc = null; 
                const endRow = document.createElement('tr');
                endRow.id = 'end-of-history-row';
                endRow.innerHTML = `<td colspan="5" style="text-align:center; padding:15px; color:#cbd5e1; font-style:italic;">- End of History -</td>`;
                if (!document.getElementById('end-of-history-row')) tableBody.appendChild(endRow);
            }
            isLoadingMore = false;
        }
    });
  }

  // 6. Edit Modal Logic
  const editModal = document.getElementById('edit-modal');
  const editIdInput = document.getElementById('edit-id');
  const editOldIdInput = document.getElementById('edit-old-id');
  const editAmountInput = document.getElementById('edit-amount');
  const editStatusInput = document.getElementById('edit-status');
  const cancelEditBtn = document.getElementById('cancel-edit');
  const saveEditBtn = document.getElementById('save-edit');

  const openEditModal = (id) => {
      const item = allItems.find(i => i.id == id);
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
      const item = allItems.find(i => i.id == oldId);
      if (!item) return;
      
      const newItem = { ...item, id: newId, amount: parseFloat(editAmountInput.value), status: editStatusInput.value.trim() };
      
      if (oldId !== newId) await deleteTransaction(oldId);
      await saveTransaction(newId, newItem);
      location.reload();
  };

  // 4. Settings Logic (Max Receipt Age)
  const ageInput = document.getElementById('age-input');
  const ageMinus = document.getElementById('age-minus');
  const agePlus = document.getElementById('age-plus');
  const aiBehaviorSelect = document.getElementById('ai-behavior-select');
  const targetNameInput = document.getElementById('target-name-input');

  const headlessCheckbox = document.getElementById('headless-checkbox');
  const pendingAlertCheckbox = document.getElementById('pending-alert-checkbox');

  const pendingLimitInput = document.getElementById('pending-limit-input');
  const batchReverseCheckbox = document.getElementById('batch-reverse-checkbox');
  const transactionSoundCheckbox = document.getElementById('transaction-sound-checkbox');
  const skipPdfCheckbox = document.getElementById('skip-pdf-checkbox');
  const skipRandomCheckbox = document.getElementById('skip-random-checkbox');
  const fullAutoCheckbox = document.getElementById('full-auto-checkbox');
  const skipRepeatCheckbox = document.getElementById('skip-repeat-checkbox');
  const repeatLimitInput = document.getElementById('repeat-limit-input');
  const repeatOptionsDiv = document.getElementById('repeat-options');
  const retryWrongRecipCheckbox = document.getElementById('retry-wrong-recip-checkbox');
  const retryVerifiedCheckbox = document.getElementById('retry-verified-checkbox');
  const autoRefreshInput = document.getElementById('auto-refresh-interval');
  const speedSelect = document.getElementById('speed-select');

  if (data.maxReceiptAge) ageInput.value = data.maxReceiptAge;
  if (data.aiScanBehavior) aiBehaviorSelect.value = data.aiScanBehavior;
  if (data.targetName) targetNameInput.value = data.targetName;
  
  // Default to true if undefined
  headlessCheckbox.checked = data.headlessMode !== false;
  pendingAlertCheckbox.checked = data.pendingAlertEnabled || false;
  if (data.pendingLimit) pendingLimitInput.value = data.pendingLimit;
  batchReverseCheckbox.checked = data.batchReverse || false;
  transactionSoundCheckbox.checked = data.transactionSoundEnabled || false;
  skipPdfCheckbox.checked = data.skipPdfEnabled || false;
  skipRandomCheckbox.checked = data.skipRandomEnabled || false;
  fullAutoCheckbox.checked = data.fullAutoMode || false;
  skipRepeatCheckbox.checked = data.skipRepeatEnabled !== false; // Default true
  if (data.repeatLimit) repeatLimitInput.value = data.repeatLimit;
  retryWrongRecipCheckbox.checked = data.retryWrongRecipient || false;
  retryVerifiedCheckbox.checked = data.retryVerified || false;
  if (repeatOptionsDiv) repeatOptionsDiv.style.display = skipRepeatCheckbox.checked ? 'block' : 'none';

  if (data.autoRefreshInterval) autoRefreshInput.value = data.autoRefreshInterval;
  if (data.processingSpeed) speedSelect.value = data.processingSpeed;

  const updateFullAutoDependencies = () => {
    if (fullAutoCheckbox.checked) {
      skipRandomCheckbox.checked = true;
      skipRandomCheckbox.disabled = true;
      chrome.storage.local.set({ skipRandomEnabled: true });
    } else {
      skipPdfCheckbox.disabled = false;
      skipRandomCheckbox.disabled = false;
    }
  };
  updateFullAutoDependencies();

  const updateAge = (val) => {
      if (val < 0.5) val = 0.5;
      ageInput.value = val;
      chrome.storage.local.set({ maxReceiptAge: val });
  };

  ageMinus.onclick = () => updateAge(parseFloat(ageInput.value) - 0.5);
  agePlus.onclick = () => updateAge(parseFloat(ageInput.value) + 0.5);
  ageInput.onchange = () => updateAge(parseFloat(ageInput.value));

  aiBehaviorSelect.onchange = () => {
    chrome.storage.local.set({ aiScanBehavior: aiBehaviorSelect.value });
  };

  targetNameInput.onchange = () => {
    chrome.storage.local.set({ targetName: targetNameInput.value.trim() });
  };

  headlessCheckbox.onchange = () => {
    chrome.storage.local.set({ headlessMode: headlessCheckbox.checked });
  };

  pendingAlertCheckbox.onchange = () => {
    chrome.storage.local.set({ pendingAlertEnabled: pendingAlertCheckbox.checked });
  };

  pendingLimitInput.onchange = () => {
    chrome.storage.local.set({ pendingLimit: parseInt(pendingLimitInput.value) || 5 });
  };

  batchReverseCheckbox.onchange = () => {
    chrome.storage.local.set({ batchReverse: batchReverseCheckbox.checked });
  };

  transactionSoundCheckbox.onchange = () => {
    chrome.storage.local.set({ transactionSoundEnabled: transactionSoundCheckbox.checked });
  };

  skipPdfCheckbox.onchange = () => {
    chrome.storage.local.set({ skipPdfEnabled: skipPdfCheckbox.checked });
  };

  skipRandomCheckbox.onchange = () => {
    chrome.storage.local.set({ skipRandomEnabled: skipRandomCheckbox.checked });
  };

  fullAutoCheckbox.onchange = () => {
    chrome.storage.local.set({ fullAutoMode: fullAutoCheckbox.checked });
    updateFullAutoDependencies();
  };

  if (skipRepeatCheckbox) {
      skipRepeatCheckbox.onchange = () => {
          chrome.storage.local.set({ skipRepeatEnabled: skipRepeatCheckbox.checked });
          if (repeatOptionsDiv) repeatOptionsDiv.style.display = skipRepeatCheckbox.checked ? 'block' : 'none';
      };
  }
  if (repeatLimitInput) {
      repeatLimitInput.onchange = () => chrome.storage.local.set({ repeatLimit: parseInt(repeatLimitInput.value) || 3 });
  }
  if (retryWrongRecipCheckbox) {
      retryWrongRecipCheckbox.onchange = () => chrome.storage.local.set({ retryWrongRecipient: retryWrongRecipCheckbox.checked });
  }
  if (retryVerifiedCheckbox) {
      retryVerifiedCheckbox.onchange = () => chrome.storage.local.set({ retryVerified: retryVerifiedCheckbox.checked });
  }

  autoRefreshInput.onchange = () => {
    let val = parseInt(autoRefreshInput.value);
    if (val < 5) val = 5;
    chrome.storage.local.set({ autoRefreshInterval: val });
  };

  speedSelect.onchange = () => {
    chrome.storage.local.set({ processingSpeed: speedSelect.value });
  };

  // 5. API Key Management
  const keyInput = document.getElementById('new-key-input');
  const addKeyBtn = document.getElementById('add-key-btn');
  const keysList = document.getElementById('keys-list');
  const importKeysBtn = document.getElementById('import-keys-btn');
  const exportKeysBtn = document.getElementById('export-keys-btn');

  const renderKeys = (keys, activeIndex) => {
    keysList.innerHTML = "";
    if (!keys || keys.length === 0) {
        keysList.innerHTML = "<div style='text-align:center; color:#94a3b8; font-size:11px;'>No keys found. Add one.</div>";
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
        
        div.firstElementChild.onclick = () => chrome.storage.local.set({ activeKeyIndex: index }, () => loadKeys());
        keysList.appendChild(div);
    });

    document.querySelectorAll('.del-key-btn').forEach(btn => {
        btn.onclick = (e) => {
            if (confirm("Are you sure you want to delete this API key?")) {
                const idx = parseInt(e.target.dataset.index);
                const newKeys = keys.filter((_, i) => i !== idx);
                let newActive = activeIndex;
                if (activeIndex >= idx && activeIndex > 0) newActive--;
                chrome.storage.local.set({ apiKeys: newKeys, activeKeyIndex: newActive }, () => loadKeys());
            }
        };
    });
  };

  const loadKeys = async () => {
      const d = await chrome.storage.local.get(['apiKeys', 'activeKeyIndex']);
      renderKeys(d.apiKeys || [], d.activeKeyIndex || 0);
  };

  addKeyBtn.onclick = async () => {
      const val = keyInput.value.trim();
      if (!val) return;
      const d = await chrome.storage.local.get(['apiKeys']);
      const currentKeys = d.apiKeys || [];
      if (!currentKeys.includes(val)) {
          currentKeys.push(val);
          await chrome.storage.local.set({ apiKeys: currentKeys });
          keyInput.value = "";
          loadKeys();
      }
  };

  // Export Keys Logic
  if (exportKeysBtn) {
    exportKeysBtn.onclick = async () => {
        const { apiKeys } = await chrome.storage.local.get(['apiKeys']);
        if (!apiKeys || apiKeys.length === 0) {
            alert("No API keys to export.");
            return;
        }
        const dataToExport = {
            "apiKeys": apiKeys
        };
        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ebirr_verifier_apikeys_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };
  }

  // Import Keys Logic
  if (importKeysBtn) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      importKeysBtn.onclick = () => fileInput.click();

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
                  loadKeys();
              } catch (err) {
                  alert("Failed to import keys: " + err.message);
              } finally {
                  fileInput.value = '';
              }
          };
          reader.readAsText(file);
      };
  }

  loadKeys();

  // 6. Bank Management
  const bankNameInput = document.getElementById('bank-name');
  const bankLenInput = document.getElementById('bank-len');
  const bankPrefixesInput = document.getElementById('bank-prefixes');
  const bankUrlInput = document.getElementById('bank-url');
  const addBankBtn = document.getElementById('add-bank-btn');
  const banksList = document.getElementById('banks-list');

  const renderBanks = (banks) => {
      banksList.innerHTML = "";
      if (!banks || banks.length === 0) {
          banksList.innerHTML = "<div style='text-align:center; color:#94a3b8; font-size:11px;'>No banks configured.</div>";
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
          banksList.appendChild(div);
      });

      document.querySelectorAll('.del-bank-btn').forEach(btn => {
          btn.onclick = async (e) => {
              if(!confirm("Delete this bank?")) return;
              const idx = parseInt(e.target.dataset.index);
              const newBanks = banks.filter((_, i) => i !== idx);
              await chrome.storage.local.set({ banks: newBanks });
              loadBanks();
          };
      });
  };

  const loadBanks = async () => {
      const d = await chrome.storage.local.get(['banks']);
      renderBanks(d.banks || []);
  };

  addBankBtn.onclick = async () => {
      const name = bankNameInput.value.trim();
      const len = parseInt(bankLenInput.value);
      const prefixesStr = bankPrefixesInput.value.trim();
      const url = bankUrlInput.value.trim();

      if (!name || !len || !prefixesStr || !url) { alert("Please fill all fields."); return; }

      const prefixes = prefixesStr.split(',').map(p => p.trim()).filter(p => p);
      const d = await chrome.storage.local.get(['banks']);
      const currentBanks = d.banks || [];
      currentBanks.push({ name, length: len, prefixes, url });
      await chrome.storage.local.set({ banks: currentBanks });
      
      bankNameInput.value = ""; bankLenInput.value = ""; bankPrefixesInput.value = ""; bankUrlInput.value = "";
      loadBanks();
  };
  loadBanks();

  if (searchInput) searchInput.addEventListener('input', () => renderTable());
  if (importedCheckbox) importedCheckbox.addEventListener('change', () => renderTable());

  document.getElementById('export-btn').onclick = () => {
    if (allItems.length === 0) return;
    let csv = "ID,Amount,Status,Date,Sender Name,Sender Phone,Repeat Count,Imported\n";
    allItems.forEach(i => {
        const senderName = i.senderName ? `"${i.senderName.replace(/"/g, '""')}"` : "";
        const senderPhone = i.senderPhone ? `"${i.senderPhone.replace(/"/g, '""')}"` : "";
        const status = i.status ? `"${i.status.replace(/"/g, '""')}"` : "";
        let dateStr = i.dateVerified || (i.timestamp ? new Date(i.timestamp).toLocaleString() : "");
        const date = `"${dateStr.replace(/"/g, '""')}"`;
        const imported = i.imported ? "Yes" : "No";
        csv += `${i.id},${i.amount},${status},${date},${senderName},${senderPhone},${i.repeatCount || 0},${imported}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Full_Report_${new Date().toLocaleDateString()}.csv`;
    a.click();
  };

  // Helper for Import Modal
  const showImportModal = (stats, itemsToSave) => {
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
          
          // Batch save to Firestore
          const promises = Object.values(itemsToSave).map(item => saveTransaction(item.id, item));
          await Promise.all(promises);
          
          overlay.remove();
          location.reload();
      };
  };

  // Import Logic
  const importBtn = document.getElementById('import-btn');
  if (importBtn) {
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

              for (let i = 1; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;
                  
                  // Robust CSV Split (Handles quotes)
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
                      const key = `tx_${id}`;
                      
                      // Merge Logic: Get existing from storage (data) or current batch (newItems)
                      const existing = newItems[key] || data[key];
                      const isUpdate = !!existing;
                      const importRepeatCount = (countIdx !== -1) ? (parseInt(row[countIdx]) || 0) : 0;
                      const previousCount = existing ? (existing.repeatCount || 0) : 0;

                      let ts = new Date(date).getTime() || Date.now();
                      // Fix future dates on import
                      if (ts > Date.now() + 86400000) {
                          const d = new Date(ts);
                          d.setFullYear(d.getFullYear() - 1);
                          ts = d.getTime();
                      }

                      const senderName = senderNameIdx !== -1 ? row[senderNameIdx]?.trim() : null;
                      const senderPhone = senderPhoneIdx !== -1 ? row[senderPhoneIdx]?.trim() : null;

                      newItems[key] = {
                          ...(existing || {}), // Preserve existing rich data (senderName, etc)
                          id, amount, status, dateVerified: date,
                          timestamp: ts,
                          repeatCount: previousCount + importRepeatCount,
                          imported: true,
                          // Add more fields from CSV if available
                          senderName: senderName || (existing ? existing.senderName : null),
                          senderPhone: senderPhone || (existing ? existing.senderPhone : null),
                          // Fields not in CSV will be null or from existing record
                      };
                      
                      if (isUpdate) mergedCount++;
                      else newCount++;
                      
                      importedCount++;
                  }
              }

              if (importedCount > 0) {
                  showImportModal({ total: importedCount, new: newCount, merged: mergedCount }, newItems);
              } else {
                  alert("No valid transactions found.");
              }
          };
          reader.readAsText(file);
          fileInput.value = '';
      };
  }

  const clearHistory = () => {
      alert("Clearing history is disabled in Centralized Database mode to preserve team data.");
  };

  // MIGRATION LOGIC
  const migrateBtn = document.getElementById('migrate-btn');
  if (migrateBtn) {
      migrateBtn.onclick = async () => {
          // 1. Fetch Local Data
          const localData = await chrome.storage.local.get(null);
          const txKeys = Object.keys(localData).filter(k => k.startsWith('tx_') && typeof localData[k] === 'object');
          const total = txKeys.length;

          if (total === 0) {
              alert("No local history found to upload.");
              return;
          }

          // 2. Show Migration Modal
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
                      <span id="mig-count">0 / ${total}</span>
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
              document.getElementById('mig-progress').style.width = `${pct}%`;
              document.getElementById('mig-count').innerText = `${processed} / ${total}`;
              document.getElementById('mig-percent').innerText = `${pct}%`;
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

          // 3. Process in Batches (Concurrency Control)
          const BATCH_SIZE = 10; // Parallel requests
          
          // Helper to process one item
          const processItem = async (key) => {
              if (isCancelled) return;
              const item = localData[key];
              try {
                  // Check existence (Read cost)
                  const exists = await getTransaction(item.id);
                  
                  if (exists) {
                      skipped++;
                  } else {
                      // Upload (Write cost)
                      // Ensure data schema alignment
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
                  skipped++; // Treat error as skip to continue
              } finally {
                  processed++;
                  updateUI();
              }
          };

          // Chunk loop
          for (let i = 0; i < total; i += BATCH_SIZE) {
              if (isCancelled) break;
              const chunk = txKeys.slice(i, i + BATCH_SIZE);
              await Promise.all(chunk.map(key => processItem(key)));
          }

          if (!isCancelled) {
              // Final State
              const btn = document.getElementById('mig-cancel');
              btn.innerText = "Close";
              btn.style.background = "#3b82f6";
              btn.style.color = "white";
              btn.style.border = "none";
              btn.onclick = () => {
                  modal.remove();
                  location.reload();
              };
              
              // Confetti or success message
              const h3 = modal.querySelector('h3');
              h3.innerText = "Migration Complete! 🎉";
              h3.style.color = "#10b981";
          }
      };
  }

  document.getElementById('clear-btn').onclick = clearHistory;
  if (clearRecentBtn) clearRecentBtn.onclick = clearHistory;

  // Account Dropdown Logic
  const accountBtn = document.getElementById('account-btn');
  const accountDropdown = document.getElementById('account-dropdown');
  const userEmailDisplay = document.getElementById('user-email-display');
  const logoutBtn = document.getElementById('logout-btn');

  if (userEmailDisplay) userEmailDisplay.innerText = user.email;

  // Update avatar with user's profile picture
  const avatarDiv = document.querySelector('.avatar');
  if (avatarDiv && user.photoURL) {
      avatarDiv.innerHTML = `<img src="${user.photoURL}" style="width: 100%; height: 100%; object-fit: cover;" alt="User Avatar" referrerpolicy="no-referrer">`;
  }

  if (accountBtn && accountDropdown) {
      accountBtn.onclick = (e) => {
          e.stopPropagation();
          accountDropdown.classList.toggle('show');
      };
      document.addEventListener('click', () => accountDropdown.classList.remove('show'));
      accountDropdown.onclick = (e) => e.stopPropagation();
  }

  if (logoutBtn) {
      logoutBtn.onclick = async () => {
          await logout();
          location.reload();
      };
  }

  }; // End initPopup

  // Inject Login Overlay HTML
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#0f172a; z-index:9999; display:none; flex-direction:column; align-items:center; justify-content:center; color:white;";
  overlay.innerHTML = `
    <h2 style="margin-bottom:20px;">Ebirr Verifier Pro</h2>
    <button id="google-login-btn" style="background:white; color:#333; border:none; padding:10px 20px; border-radius:5px; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:10px;">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18"> Sign in with Google
    </button>
  `;
  document.body.appendChild(overlay);

  document.getElementById('google-login-btn').onclick = async () => {
      try {
          await loginWithGoogle();
      } catch (e) {
          alert("Login failed: " + e.message);
      }
  };

  // Listen for Auth State
  onAuthStateChanged(auth, (user) => {
      initPopup(user);
  });
});