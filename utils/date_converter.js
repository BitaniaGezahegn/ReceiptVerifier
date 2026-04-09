// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\utils\date_converter.js
/**
 * Parses a BOA (Bank of Abyssinia) date string into a Gregorian JS Date object.
 * BOA Format: 'DD/MM/YY HH:mm' (e.g., '17/03/26 13:31')
 * @param {string} boaDateString 
 * @returns {Date|null}
 */
function parseBOADate(boaDateString) {
    if (!boaDateString) return null;

    // Remove any extra whitespace
    const cleanStr = boaDateString.trim();
    
    // Match 17/03/26 13:31
    const match = cleanStr.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const [, dd, mm, yy, hh, min] = match;

    // The year is YY, so we assume 20YY.
    const fullYear = parseInt(yy, 10) + 2000;
    const monthIndex = parseInt(mm, 10) - 1; // JS months are 0-indexed
    const day = parseInt(dd, 10);
    const hour = parseInt(hh, 10);
    const minute = parseInt(min, 10);

    try {
        // We construct the date in UTC to avoid timezone issues during parsing.
        // The verification logic will compare it against Date.now().
        const date = new Date(Date.UTC(fullYear, monthIndex, day, hour, minute));
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        return null;
    }
}

/**
 * Parses a Telebirr date string.
 * Format: 'DD-MM-YYYY HH:mm:ss' (e.g., '07-04-2026 11:54:37')
 */
function parseTelebirrDate(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.trim();
    
    const match = cleanStr.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return null;

    const [, dd, mm, yyyy, hh, min, ss] = match;
    try {
        const date = new Date(Date.UTC(
            parseInt(yyyy, 10), 
            parseInt(mm, 10) - 1, 
            parseInt(dd, 10), 
            parseInt(hh, 10), 
            parseInt(min, 10), 
            parseInt(ss, 10)
        ));
        return isNaN(date.getTime()) ? null : date;
    } catch (e) { return null; }
}

/**
 * Standard parser for default banks (Kaafi, Coop, Wegagen)
 * Format: YYYY-MM-DD HH:mm:ss +ZZZZ
 * @param {string} dateString 
 * @returns {Date|null}
 */
function parseStandardDate(dateString) {
    if (!dateString) return null;
    const p = dateString.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\s(\+\d{4})/);
    if (p) {
        return new Date(`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}${p[7].slice(0,3)}:${p[7].slice(3)}`);
    }
    return null;
}

/**
 * Factory function to get the correct date parser based on bank name.
 * @param {string} bankName 
 * @returns {function(string): Date|null}
 */
export function getDateParser(bankName) {
    if (bankName === 'BOA') {
        return parseBOADate;
    }
    if (bankName === 'Telebirr') {
        return parseTelebirrDate;
    }
    return parseStandardDate;
}
