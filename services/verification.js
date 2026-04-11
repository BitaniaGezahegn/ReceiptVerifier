import { parseBankDate } from '../utils/helpers.js';

export function verifyTransactionData(data, expectedAmt, targetName, maxHours) {
    let foundName = data.recipient || "";
    
    // Normalize whitespace
    foundName = foundName.replace(/[\s\u00A0]+/g, ' ').trim();
  
    let isReason = false;
    if (foundName.includes("Wallet to Wallet CH") || foundName.includes("KAAFI Microfinance Bank")) {
        if (data.reason) {
            foundName = data.reason.replace(/[\s\u00A0]+/g, ' ').trim();
            isReason = true;
        } else {
            foundName = foundName.replace(/[\s\u00A0]+/g, ' ').trim();
        }
    }
    
    const cleanTarget = targetName.replace(/[\s\u00A0]+/g, ' ').trim().toLowerCase();
    const nameOk = foundName.toLowerCase().includes(cleanTarget);
    
    // Robust Amount Parsing
    const numExpected = parseFloat(expectedAmt);
    // Remove commas first to ensure thousands (e.g. 1,250.00) are not truncated by the regex
    const normalizedAmt = (data.amount || "0").replace(/,/g, '');
    const amtMatch = normalizedAmt.match(/\d+\.\d{2}/);
    const cleanAmtStr = amtMatch ? amtMatch[0] : (data.amount || "0").replace(/[^0-9.]/g, '');
    const foundAmt = parseFloat(cleanAmtStr);
    
    const amtOk = Math.abs(foundAmt - numExpected) < 0.01;
  
    // Date Check
    let timeStr = "N/A";
    let timeOk = false;
    let bankDate = data.date || null;
    
    if (data.date) {
        const ts = parseBankDate(data.date);
        if (ts) {
          const transDate = new Date(ts);
          const diffMs = Date.now() - ts;
          const diffMins = Math.floor(diffMs / 60000);
          const h = Math.floor(diffMins / 60);
          const m = diffMins % 60;
          timeStr = h > 0 ? `${h} hrs, ${m} min ago` : `${m} min ago`;
          timeOk = diffMs > 0 && diffMs <= maxHours * 3600000;
        }
    }
  
    let status = "Verified";
    let color = "#4CAF50";
    let statusText = "✅ ALL OK";
  
    if (!nameOk) { status = "Wrong Recipient"; color = "#f44336"; statusText = "❌ NAME MISMATCH"; }
    else if (!timeOk) { status = "Old Receipt"; color = "#ff9800"; statusText = "🕰️ OLD RECEIPT"; }
    else if (foundAmt < 50) { status = "Under 50"; color = "#f44336"; statusText = "📉 UNDER 50"; }
    else if (!amtOk) { status = `AA is ${foundAmt}`; color = "#f44336"; statusText = "⚠️ AMT MISMATCH"; }
  
    // If name is OK, return the targetName for consistency. Otherwise, return what was found.
    const finalRecipientName = nameOk ? targetName : foundName;

    return { status, color, statusText, foundAmt, timeStr, bankDate, senderName: data.senderName, senderPhone: data.senderPhone, foundName: finalRecipientName, nameOk, amtOk, timeOk, isReason };
  }