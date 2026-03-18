/**
 * Approximates an Ethiopian Calendar date string to a Gregorian JS Date object.
 * This is an approximation and may be off by a few days, but is sufficient
 * for "max age" checks where precision isn't critical.
 * @param {string} ecDateString - The date string in 'YY/MM/DD HH:mm' format.
 * @returns {Date|null} A JS Date object or null if parsing fails.
 */
export function approximateECToGC(ecDateString) {
    if (!ecDateString) return null;

    // Format: 17/03/26 13:31
    const match = ecDateString.match(/(\d{2})\/(\d{2})\/(\d{2})\s(\d{2}):(\d{2})/);
    if (!match) return null;

    const [, yy, mm, dd, hh, min] = match;

    // 1. Approximate Year
    // EC 2016 is GC 2023/2024. EC 2017 is GC 2024/2025.
    // A simple +7 offset to the EC year is a reasonable approximation.
    const ecYear = parseInt(yy, 10) + 2000;
    const gcYear = ecYear + 7;

    // 2. Create a Gregorian date.
    // NOTE: We use the EC month and day directly. This is the main source of
    // inaccuracy, but for checking if a receipt is a few hours old, it's sufficient.
    const monthIndex = parseInt(mm, 10) - 1; // JS months are 0-indexed

    try {
        const date = new Date(Date.UTC(gcYear, monthIndex, parseInt(dd, 10), parseInt(hh, 10), parseInt(min, 10)));
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        return null;
    }
}