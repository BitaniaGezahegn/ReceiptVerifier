// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\popup\charts.js
import { getTransactionsForRange, getUserTransactionsForRange } from '../../services/storage_service.js';

let tooltipEl = null;

function getTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chart-tooltip';
        tooltipEl.style.cssText = "position:fixed; display:none; background:rgba(15, 23, 42, 0.9); color:white; padding:6px 10px; border-radius:6px; font-size:11px; pointer-events:none; z-index:1000; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); font-weight: 500;";
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

const showTooltip = (x, y, text) => {
    const el = getTooltip();
    el.style.left = (x + 10) + 'px';
    el.style.top = (y + 10) + 'px';
    el.innerText = text;
    el.style.display = 'block';
};

const hideTooltip = () => {
    const el = getTooltip();
    el.style.display = 'none';
};

export function renderChart(okCount, failCount) {
    let canvas = document.getElementById('verification-chart');
    if (!canvas) return;

    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    canvas = newCanvas;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 100;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - 10;
    const total = okCount + failCount;

    ctx.clearRect(0, 0, size, size);

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

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.65, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.font = `bold ${Math.round(size * 0.22)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, cx, cy - 8);

    ctx.fillStyle = '#64748b';
    ctx.font = `${Math.round(size * 0.11)}px sans-serif`;
    ctx.fillText("Today", cx, cy + 10);

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - (size / 2);
        const dy = y - (size / 2);
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist <= radius && dist >= radius * 0.5) {
            let angle = Math.atan2(dy, dx);
            if (angle < -0.5 * Math.PI) {
                angle += 2 * Math.PI; 
            }
            
            const segment = segments.find(s => angle >= s.start && angle < s.end);
            if (segment) {
                const label = segment.color === '#4ade80' ? 'Verified' : 'Failed';
                const percent = Math.round((segment.count / total) * 100);
                showTooltip(e.clientX, e.clientY, `: ${segment.count} (%)`);
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
}

export function renderHourlyChart(items) {
    let canvas = document.getElementById('hourly-chart');
    if (!canvas) return;
    
    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    canvas = newCanvas;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = rect.width * dpr;
    const height = rect.height * dpr;
    const paddingBottom = 20 * dpr;
    const chartHeight = height - paddingBottom;
    
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.scale(dpr, dpr);

    const logicalWidth = width / dpr;
    const logicalHeight = height / dpr;
    const logicalChartHeight = logicalHeight - 20;

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
        
        ctx.fillStyle = count > 0 ? '#3b82f6' : '#e2e8f0';
        ctx.fillRect(x + 1, y, barWidth - 2, h);
        
        bars.push({ x: x + 1, y, w: barWidth - 2, h, count, hour: i });

        if (i % 6 === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = "10px sans-serif";
            ctx.fillText(i, x + (barWidth/2), logicalChartHeight + 4);
        }
    });

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
}

export function renderBankChart(items, configuredBanks) {
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
    canvas.style.width = `px`;
    canvas.style.height = `px`;
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const banks = {};
    const banksList = configuredBanks || [];
    
    items.forEach(item => {
        const id = item.id.toString();
        let bankName = "Unknown";
        const match = banksList.find(b => b.prefixes.some(p => id.startsWith(p)));
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

    let startAngle = -Math.PI / 2;
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
    
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, 2 * Math.PI);
    ctx.fillStyle = 'white';
    ctx.fill();

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist <= radius) {
            let angle = Math.atan2(dy, dx);
            let checkAngle = angle + Math.PI/2;
            if (checkAngle < 0) checkAngle += 2*Math.PI;
            
            let currentStart = 0;
            let found = false;
            
            for (const [name, count] of Object.entries(banks)) {
                const sliceSpan = (count / total) * 2 * Math.PI;
                if (checkAngle >= currentStart && checkAngle < currentStart + sliceSpan) {
                    const percent = Math.round((count / total) * 100);
                    showTooltip(e.clientX, e.clientY, `:  (%)`);
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
}

export function initSpeedChart(onChangeCallback) {
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
    
    const recentList = document.getElementById('recent-list');
    const bankCanvas = document.getElementById('bank-chart');
    
    if (recentList && recentList.parentNode) {
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
    
    document.getElementById('speed-range-select').addEventListener('change', onChangeCallback);
}

export async function renderSpeedChart(currentScope) {
    let canvas = document.getElementById('speed-chart');
    if (!canvas) return;
    
    const select = document.getElementById('speed-range-select');
    const range = select ? select.value : '30m';
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    const now = Date.now();
    let startTime, bucketSizeMs, labelFormat;
    
    if (range === '30m') {
        startTime = now - 30 * 60 * 1000;
        bucketSizeMs = 60 * 1000; 
        labelFormat = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    } else if (range === '1h') {
        startTime = now - 60 * 60 * 1000;
        bucketSizeMs = 60 * 1000; 
        labelFormat = (d) => d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    } else if (range === '24h') {
        startTime = now - 24 * 60 * 60 * 1000;
        bucketSizeMs = 60 * 60 * 1000; 
        labelFormat = (d) => d.getHours() + 'h';
    } else { 
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        bucketSizeMs = 6 * 60 * 60 * 1000; 
        labelFormat = (d) => d.toLocaleDateString([], {weekday:'short'});
    }
    
    const buckets = [];
    let t = startTime;
    while (t < now) {
        buckets.push({ start: t, end: t + bucketSizeMs, count: 0 });
        t += bucketSizeMs;
    }
    
    const txFetcher = currentScope === 'team' ? getTransactionsForRange : getUserTransactionsForRange;
    const speedItems = await txFetcher(startTime, now);
    
    speedItems.forEach(item => {
        const ts = item.timestamp || new Date(item.dateVerified).getTime();
        if (ts >= startTime && ts <= now) {
            const bucket = buckets.find(b => ts >= b.start && ts < b.end);
            if (bucket) bucket.count++;
        }
    });
    
    const dataPoints = buckets.map(b => b.count / (bucketSizeMs / 60000));
    
    const currentTPM = dataPoints[dataPoints.length - 1] || 0;
    const lineColor = currentTPM >= 5 ? '#10b981' : '#3b82f6';

    const padding = { top: 20, right: 10, bottom: 20, left: 30 };
    const chartW = (rect.width) - padding.left - padding.right;
    const chartH = (rect.height) - padding.top - padding.bottom;
    
    const maxVal = Math.max(...dataPoints, 0.1);
    const getY = (val) => padding.top + chartH - ((val / maxVal) * chartH);
    const getX = (idx) => padding.left + (idx / (dataPoints.length - 1)) * chartW;
    
    ctx.beginPath(); ctx.strokeStyle = '#e2e8f0';
    for (let i=0; i<=4; i++) { const y = padding.top + (chartH * i/4); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left+chartW, y); }
    ctx.stroke();
    
    ctx.beginPath(); ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
    dataPoints.forEach((val, i) => { const x = getX(i); const y = getY(val); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.stroke();
    
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
}
