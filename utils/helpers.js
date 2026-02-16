// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\utils\helpers.js
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTimeAgo(timestamp, dateStr) {
    let ts = timestamp;
    if (!ts && dateStr) {
        try {
            // Handle bank format 'YYYY-MM-DD HH:MM:SS +ZZZZ'
            const p = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\s(\+\d{4})/);
            if (p) {
                ts = new Date(`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}${p[7].slice(0,3)}:${p[7].slice(3)}`).getTime();
            } else {
                ts = new Date(dateStr).getTime();
            }
        } catch (e) { /* ignore */ }
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
    return h > 0 ? `${h} hrs, ${m} min ago` : `${m} min ago`;
}

export function safeClick(element) {
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

export function getRawBase64(data) {
    if (!data) return null;
    const commaIndex = data.indexOf(',');
    return commaIndex > -1 ? data.substring(commaIndex + 1) : data;
}

export function getMimeTypeFromDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,/);
    return match ? match[1] : 'image/jpeg';
}

export function isRetryableStatus(status) {
    return status === "Bank 404" || status === "AI Error" || status === "API Limit" || status === "Offline" || status === "Image Load Failed";
}
