import { parseBankDate } from '../utils/helpers.js';

export function verifyTransactionData(data, expectedAmt, targetName, maxHours) {
    let foundName = data.recipient || "";
    console.log("[Verification] Starting check for data:", data);
    
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
    let amtStr = String(data.amount || "").trim();

    console.log("[Verification] Raw Amount String:", amtStr);

    // GUARD: If the amount string contains the Transaction ID (e.g. starts with DD), 
    // we must treat it as missing data to avoid "77 ETB" errors.
    if (amtStr.toUpperCase().includes("DD")) {
        console.warn("[Verification] Amount string contains ID prefix (DD). Resetting to 0.");
        amtStr = "";
    }

    const normalizedAmt = amtStr.replace(/,/g, '');
    const amtMatch = normalizedAmt.match(/\d+\.\d{2}/);
    
    console.log("[Verification] Regex Amt Match:", amtMatch);

    // Only allow digits/dots. If the result is a suspicious number (like 77 from an ID), 
    // the amtOk check will handle the mismatch.
    const cleanAmtStr = amtMatch ? amtMatch[0] : (amtStr ? amtStr.replace(/[^0-9.]/g, '') : "0");
    // Ensure foundAmt is a valid number primitive and never NaN
    const foundAmt = parseFloat(cleanAmtStr) || 0;
    
    const amtOk = Math.abs(foundAmt - numExpected) < 0.01;
  
    // Date Check
    let timeStr = "N/A";
    let timeOk = false;
    let bankDate = data.date || null;
    
    // Guard: If the date string looks like a code fragment, ignore it
    if (bankDate && (bankDate.includes('=>') || bankDate.includes('{') || bankDate.includes('('))) {
        bankDate = null;
    }

    console.log("[Verification] Bank Date for parsing:", bankDate);

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
          console.log(`[Verification] Time Check: ${timeStr}, Ok: ${timeOk}`);
        }
    }
  
    let status = "Verified";
    let color = "#4CAF50";
    let statusText = "✅ ALL OK";
  
    // Prioritize "Data Missing" over "Mismatch" if scraping was problematic
    if (!data.recipient || foundAmt === 0 || !bankDate) {
        status = "Data Missing"; color = "#f44336"; statusText = "❌ DATA MISSING";
    }
    else if (!nameOk) { status = "Wrong Recipient"; color = "#f44336"; statusText = "❌ NAME MISMATCH"; }
    else if (!timeOk) { status = "Old Receipt"; color = "#ff9800"; statusText = "🕰️ OLD RECEIPT"; }
    else if (foundAmt < 50) { status = "Under 50"; color = "#f44336"; statusText = "📉 UNDER 50"; }
    else if (!amtOk) { status = `AA is ${foundAmt}`; color = "#f44336"; statusText = "⚠️ AMT MISMATCH"; }
  
    // If name is OK, return the targetName for consistency. Otherwise, return what was found.
    const finalRecipientName = nameOk ? targetName : foundName;
    
    // Ensure all fields are serializable and non-null for the UI
    const finalSenderName = String(data.senderName || "-");
    const finalSenderPhone = String(data.senderPhone || "-");

    return { 
        status, color, statusText, 
        foundAmt: Number(foundAmt) || 0, 
        timeStr: String(timeStr || "N/A"), 
        bankDate: String(bankDate || ""), 
        senderName: finalSenderName, 
        senderPhone: finalSenderPhone, 
        foundName: String(finalRecipientName || "N/A"), 
        nameOk, amtOk, timeOk, isReason 
    };
  }