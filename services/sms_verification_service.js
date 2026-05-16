import { 
    getSmsEntryById, 
    getSmsEntryByClaimedId, 
    getSmsEntryByFingerprint, 
    updateSmsEntry, 
    getTransaction, 
    logTransactionResult 
} from './storage_service.js';
import { auth } from './firebase_config.js';
import { getTimeAgo } from '../utils/helpers.js';

/**
 * Centralized service for verifying transactions strictly against the SMS Vault.
 * 
 * Match Priority:
 *   1. Direct ID Match   — getSmsEntryById(id)
 *   2. Claimed ID Match  — getSmsEntryByClaimedId(id)  (catches repeats under a different screenshot)
 *   3. Fingerprint Match — getSmsEntryByFingerprint(phone, amount)  (skipped for Kaffi IDs)
 *
 * Returns: { found: boolean, result: Object, originalId: string }
 *
 * Possible statuses in result:
 *   "Verified"        — First-time verified match in SMS vault
 *   "Repeat"          — Already verified before (verificationCount > 0)
 *   "Wrong Recipient" — Valid transaction ID format but no SMS vault match found
 */
export async function verifyViaSms(id, expectedAmount, customerPhone, portalId = null, isKaffiId = false) {
    let isDirectMatch = false;
    let smsEntry = null;

    // 1. Direct ID Match
    smsEntry = await getSmsEntryById(id);
    if (smsEntry) isDirectMatch = true;

    // 2. Claimed ID Match (for repeats under a different screenshot ID)
    if (!smsEntry) {
        smsEntry = await getSmsEntryByClaimedId(id);
        if (smsEntry && smsEntry.id === id) isDirectMatch = true;
    }

    // 3. Fingerprint Match (phone + amount — skip for Kaffi IDs)
    if (!smsEntry && !isKaffiId && customerPhone && expectedAmount) {
        smsEntry = await getSmsEntryByFingerprint(customerPhone, expectedAmount);
    }

    if (smsEntry) {
        console.log(`[SMS Verification] SUCCESS: Match found (${smsEntry.id}).`);
        let status = "Verified";
        let color = "#10b981";
        let statusText = "✅ VERIFIED (SMS)";
        let repeatCount = smsEntry.verificationCount || 0;

        if (smsEntry.amount < 50) {
            status = "Under 50";
            color = "#f59e0b";
            statusText = "📉 UNDER 50";
        } else if (repeatCount > 0) {
            status = "Repeat";
            color = "#f59e0b";
            statusText = "🔁 DUPLICATE / REPEAT";
        }

        const dateVerified = new Date().toLocaleString();
        const processedBy = auth.currentUser ? auth.currentUser.email : "System";
        const processedByUid = auth.currentUser ? auth.currentUser.uid : "system-uid";

        await updateSmsEntry(smsEntry.id, {
            verificationCount: repeatCount + 1,
            claimedByScreenshotId: id,
            status: status === "Verified" ? "verified" : "duplicate",
            dateVerified,
            processedBy,
            processedByUid,
        });

        const bankDateStr = smsEntry.transactionTimestamp
            ? new Date(smsEntry.transactionTimestamp.toDate()).toLocaleString()
            : "N/A";
        const timeStr = smsEntry.transactionTimestamp
            ? getTimeAgo(smsEntry.transactionTimestamp.toDate().getTime())
            : "Just now";

        const verificationResult = {
            status,
            foundAmt: smsEntry.amount,
            senderName: smsEntry.senderName,
            senderPhone: smsEntry.senderPhone,
            foundName: smsEntry.recipientName || "Kaafi",
            bankDate: bankDateStr,
            timeStr,
            repeatCount,
            color,
            statusText,
            bankName: isDirectMatch ? "Kaafi" : "Other",
            id: smsEntry.id,
            processedBy
        };

        const existingTx = await getTransaction(smsEntry.id);
        await logTransactionResult(smsEntry.id, verificationResult, existingTx, id, portalId);

        return { found: true, result: verificationResult, originalId: id };
    }

    // No SMS match found — valid ID was extracted but has no corresponding SMS entry.
    // Treat as "Wrong Recipient": the receipt's transaction belongs to a different account.
    console.log(`[SMS Verification] No SMS match found for ID: ${id}. Returning "Wrong Recipient".`);

    return {
        found: false,
        result: {
            status: "Wrong Recipient",
            color: "#ef4444",
            statusText: "❌ WRONG RECIPIENT",
            foundAmt: 0,
            timeStr: "N/A",
            foundName: "N/A",
            senderName: "-",
            senderPhone: "-",
            repeatCount: 0,
            bankName: "Other",
            id
        },
        originalId: id
    };
}
