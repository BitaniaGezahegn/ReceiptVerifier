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
    // Gracefully handle future dates (e.g. server clock skew)
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

    let cleanedDateStr = dateStr.trim();

    try {
        // Attempt 1: Parse with new Date(), which is good for ISO-like formats
        // e.g., "2026-03-12 22:35:42 +0300 EAT"
        let isoDate = new Date(cleanedDateStr);
        if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 1990) {
            console.log(`[Ebirr Verifier] Parsed date as ISO-like: "${cleanedDateStr}" -> ${isoDate.toISOString()}`);
            return isoDate.getTime();
        }

        // Attempt 2: Remove trailing timezone abbreviation (e.g. " EAT") which often confuses parsers
        // Format: "2026-03-17 08:15:06 +0300 EAT" -> "2026-03-17 08:15:06 +0300"
        const noTzAbbrev = cleanedDateStr.replace(/\s+[A-Z]{3,}$/, '').trim();
        if (noTzAbbrev !== cleanedDateStr) {
             isoDate = new Date(noTzAbbrev);
             if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 1990) {
                console.log(`[Ebirr Verifier] Parsed date (removed TZ abbrev): "${noTzAbbrev}"`);
                return isoDate.getTime();
            }
        }

        // Attempt 3: Explicit regex for YYYY-MM-DD HH:mm:ss (+ZZZZ)
        const ymdMatch = cleanedDateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
        if (ymdMatch) {
             const [_, y, m, d, hh, mm, ss] = ymdMatch;
             const offsetMatch = cleanedDateStr.match(/([+\-]\d{4})/);
             const offset = offsetMatch ? offsetMatch[1] : ''; // e.g. +0300
             
             // Construct standard ISO: YYYY-MM-DDTHH:mm:ss+ZZZZ
             const constructedIso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${(hh||'00').padStart(2,'0')}:${(mm||'00').padStart(2,'0')}:${(ss||'00').padStart(2,'0')}${offset}`;
             const dDate = new Date(constructedIso);
             if (!isNaN(dDate.getTime())) {
                 return dDate.getTime();
             }
        }

        // Fallback for ambiguous formats like DD/MM/YYYY or DD-MM-YYYY
        const dmyMatch = cleanedDateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?: T:(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (dmyMatch) {
            const day = dmyMatch[1].padStart(2, '0');
            const month = dmyMatch[2].padStart(2, '0');
            const year = dmyMatch[3];
            const hour = dmyMatch[4] || '00';
            const minute = dmyMatch[5] || '00';
            const second = dmyMatch[6] || '00';
            
            // Construct as YYYY-MM-DDTHH:MM:SSZ to force UTC and avoid ambiguity
            const dmyDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
            if (!isNaN(dmyDate.getTime())) {
                console.log(`[Ebirr Verifier] Parsed date as DMY: "${cleanedDateStr}" -> ${dmyDate.toISOString()}`);
                return dmyDate.getTime();
            }
        }

        // Attempt 4: "DD/MM/YY HH:mm" (Common in Ethiopian Banks, e.g. "17/03/26 13:31" -> 17th March 2026)
        const slashMatch = cleanedDateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/);
        if (slashMatch) {
             const [, dd, mm, yy, hh, min] = slashMatch;
             const d = parseInt(dd, 10);
             const m = parseInt(mm, 10) - 1; // 0-indexed
             const y = parseInt(yy, 10);
             const fullYear = 2000 + y;

             const date = new Date(fullYear, m, d, parseInt(hh, 10), parseInt(min, 10));
             if (!isNaN(date.getTime())) {
                 console.log(`[Ebirr Verifier] Parsed date as DD/MM/YY: "${cleanedDateStr}" -> ${date.toISOString()}`);
                 return date.getTime();
             }
        }

        console.error(`[Ebirr Verifier] FAILED to parse date: "${cleanedDateStr}"`);
        return null;
    } catch (e) {
        console.error(`[Ebirr Verifier] Error parsing date: "${cleanedDateStr}"`, e);
        return null;
    }
}
