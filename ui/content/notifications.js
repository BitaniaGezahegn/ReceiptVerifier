// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\ui\content\notifications.js
let autoHideTimer = null;

export function showNotification(message, type = 'process') {
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
        
        const style = document.createElement('style');
        style.innerHTML = `
            .ebirr-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #3b82f6; border-radius: 50%; animation: ebirr-spin 1s linear infinite; }
            @keyframes ebirr-spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
        document.body.appendChild(island);
    }

    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }

    let icon = '<div class="ebirr-spinner"></div>';
    if (type === 'success') icon = '<span style="color:#4ade80; font-size:16px;">✓</span>';
    if (type === 'error') icon = '<span style="color:#f87171; font-size:16px;">✕</span>';
    if (type === 'timeout') icon = '<span style="color:#fbbf24; font-size:16px;">⚠️</span>';

    island.innerHTML = `${icon}<span>${message}</span>`;
    island.style.top = '20px';

    if (type === 'success' || type === 'error') {
        autoHideTimer = setTimeout(() => {
            if (island) island.style.top = '-80px';
            autoHideTimer = null;
        }, 3000);
    }
}

export function startCooldownTimer(seconds, callback, label = "Refreshing in") {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }

    let island = document.getElementById('ebirr-dynamic-island');
    if (!island) {
        showNotification(label + "...", "process");
        island = document.getElementById('ebirr-dynamic-island');
    }
    
    island.style.overflow = 'hidden'; 
    island.innerHTML = `
        <div style="position: relative; z-index: 2; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 16px;">⏳</span>
            <span id="ebirr-timer-text" style="font-variant-numeric: tabular-nums;">${label} ${seconds}s</span>
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
    
    setTimeout(() => {
        if(bar) {
            bar.style.transition = `transform ${seconds}s linear`;
            bar.style.transform = 'scaleX(0)';
        }
    }, 50);

    let remaining = seconds;
    if (window.ebirrRefreshTimer) clearInterval(window.ebirrRefreshTimer);
    
    window.ebirrRefreshTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(window.ebirrRefreshTimer);
            window.ebirrRefreshTimer = null;
            // Island remains visible for smooth transition to next status
            if (callback) callback();
        } else {
            if (text) text.innerText = `${label} ${remaining}s`;
        }
    }, 1000);
}

export function hideNotification() {
    let island = document.getElementById('ebirr-dynamic-island');
    if (island) {
        island.style.top = '-80px';
    }
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }
}
