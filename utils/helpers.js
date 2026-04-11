// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\utils\helpers.js
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTimeAgo(timestamp, dateStr) {
    let ts = timestamp;
    if (!ts && dateStr) {
        ts = parseBankDate(dateStr);
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

/**
 * Parses a bank date string into a timestamp. Handles various formats.
 * @param {string | null} dateStr - The date string from the bank.
 * @returns {number | null} The timestamp in milliseconds, or null if parsing fails.
 */
export function parseBankDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const cleanedDateStr = dateStr.trim();

    try {
        // 1. Prioritize format matching (DD-MM-YYYY or DD/MM/YYYY)
        // This prevents browsers from misinterpreting DD-MM-YYYY as MM-DD-YYYY or picking up noisy ISO strings
        const dmyMatch = cleanedDateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+T?:?(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (dmyMatch) {
            const day = dmyMatch[1].padStart(2, '0');
            const month = dmyMatch[2].padStart(2, '0');
            const year = dmyMatch[3];
            const hour = dmyMatch[4] || '00';
            const minute = dmyMatch[5] || '00';
            const second = dmyMatch[6] || '00';
            
            // Construct local date components to match the system clock used in Date.now()
            const localDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
            if (!isNaN(localDate.getTime())) {
                console.log(`[Ebirr Verifier] Parsed date as local DMY: "${cleanedDateStr}" -> ${localDate.toISOString()}`);
                return localDate.getTime();
            }
        }

        // 2. Fallback to generic Date constructor for other formats (e.g. ISO-like "2026-03-12 22:35:42 +0300")
        const isoDate = new Date(cleanedDateStr);
        if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 1990) {
            console.log(`[Ebirr Verifier] Parsed date as ISO-like: "${cleanedDateStr}" -> ${isoDate.toISOString()}`);
            return isoDate.getTime();
        }

        console.error(`[Ebirr Verifier] FAILED to parse date: "${cleanedDateStr}"`);
        return null;
    } catch (e) {
        console.error(`[Ebirr Verifier] Error parsing date: "${cleanedDateStr}"`, e);
        return null;
    }
}
