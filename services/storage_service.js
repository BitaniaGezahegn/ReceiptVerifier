// Centralized Database Logic
import { db, auth } from './firebase_config.js';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  increment,
  deleteDoc,
  where,
  onSnapshot,
  writeBatch,
  startAfter,
  Timestamp
} from '../firebase/firebase-firestore.js';

import { ensureAuthReady } from './auth_service.js';
import { isRetryableStatus, parseBankDate } from '../utils/helpers.js';
// Collection Names
const COL_TX = "transactions";
const COL_STATS = "daily_stats";
const COL_METADATA = "metadata";
const DOC_LAST_ACTIVITY = "last_activity";
const COL_SMS_VAULT = "sms_vault";

/**
 * Centralized function to build and log a complete transaction record.
 * This handles new, repeat, and failed verifications, and updates daily stats.
 * @param {string} id - The transaction ID to save under.
 * @param {object} verificationResult - The result from `verifyTransactionData` or a similar structure.
 * @param {object|null} [existingTx=null] - The existing transaction from DB if it's a repeat.
 * @param {string|null} [originalId=null] - The AI-extracted ID, if the final ID is a 'RANDOM' key.
 * @param {string|null} [portalId=null] - The internal portal/management ID of the transaction.
 */
export async function logTransactionResult(
  id,
  verificationResult,
  existingTx = null,
  originalId = null,
  portalId = null
) {
    console.log(`[Storage] logTransactionResult: ID=${id}, Status=${verificationResult.status}, PortalID=${portalId}`);
    await ensureAuthReady();
    if (!auth.currentUser) return;

    let statusToSave = verificationResult.status;
    // Prevent "Repeat" from overwriting the original status in the database
    if (statusToSave === "Repeat" && existingTx && existingTx.status) {
        statusToSave = existingTx.status;
    }

    const isSuccess = statusToSave === "Verified" || statusToSave.startsWith("AA");
    const now = Date.now();

    // Calculate repeat count: Don't increment if the previous status was a failure/retryable
    let repeatCount = 0;
    if (existingTx) {
        const wasFailure = isRetryableStatus(existingTx.status);
        repeatCount = (existingTx.repeatCount || 0) + (wasFailure ? 0 : 1);
    }

    // Ensure Bank 404 saves as incomplete (null sender/date) so it triggers retry logic next time
    const isBank404 = statusToSave === "Bank 404";

    // Build the canonical payload
    const payload = {
        ...(existingTx || {}), // Start with existing data if it's a repeat
        id: id,
        amount: verificationResult.foundAmt,
        status: statusToSave,
        timestamp: existingTx ? existingTx.timestamp : now,
        dateVerified: existingTx ? 
          existingTx.dateVerified : new Date(now).toLocaleString(),
        senderName: isBank404 ? null : 
          (verificationResult.senderName || (existingTx && existingTx.senderName) || null),
        senderPhone: isBank404 ? null : 
          (verificationResult.senderPhone || (existingTx && existingTx.senderPhone) || null),
        recipientName: isBank404 ? null : 
          (verificationResult.foundName || (existingTx && existingTx.recipientName) || null),
        bankDate: isBank404 ? null : 
          (verificationResult.bankDate || (existingTx && existingTx.bankDate) || null),
        transactionTime: parseBankDate(verificationResult.bankDate) || 
          (existingTx && existingTx.transactionTime) || null,
        repeatCount: repeatCount,
        processedBy: auth.currentUser.email,
        processedByUid: auth.currentUser.uid,
        lastUpdated: now,
        bankCheckResult: verificationResult.bankCheckResult || "",
        lastRepeat: existingTx ? now : null,
        imported: existingTx ? !!existingTx.imported : false,
        originalId: originalId || (existingTx && existingTx.originalId) || null,
    };

    await saveTransaction(id, payload);
    console.log(`[Storage] Transaction ${id} saved. Updating daily stats.`);
    await updateDailyStats(isSuccess, verificationResult.foundAmt || 0);
}

export async function updateLastActivity(portalId) {
    await ensureAuthReady();
    if (!auth.currentUser || !portalId) return;

    console.log(`[Storage] Updating last activity for PortalID: ${portalId}`);
    const now = Date.now();
    await setDoc(doc(db, COL_METADATA, DOC_LAST_ACTIVITY), {
        lastPortalId: portalId,
        timestamp: now,
        user: auth.currentUser.email
    }, { merge: true });
}

export function onLastMarkedUpdate(callback) {
    if (!auth.currentUser) return () => {};
    const docRef = doc(db, COL_METADATA, DOC_LAST_ACTIVITY);
    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data());
        }
    }, (error) => console.error("onLastMarkedUpdate error:", error));
}

export async function updateDailyStats(isSuccess, amount) {
    await ensureAuthReady();
    if (!auth.currentUser) return; // Guard: Must be logged in

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const teamStatsRef = doc(db, COL_STATS, today);
    const userStatsRef = doc(db, 'users', auth.currentUser.uid, 
        'daily_stats', today);
    
    console.log(`[Storage] Updating daily stats for ${today}. Success: ${isSuccess}, Amount: ${amount}`);
    const val = parseFloat(amount);
    const safeAmount = isNaN(val) ? 0 : val;

    const incrementData = {
        total: increment(1),
        success: increment(isSuccess ? 1 : 0),
        fail: increment(isSuccess ? 0 : 1),
        amount: increment(isSuccess ? safeAmount : 0),
        failAmount: increment(isSuccess ? 0 : safeAmount),
        lastUpdated: Date.now()
    };

    try {
        console.log("[Storage] Committing batch update for daily stats.");
        const batch = writeBatch(db);
        batch.set(teamStatsRef, incrementData, { merge: true });
        batch.set(userStatsRef, incrementData, { merge: true });
        await batch.commit();
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            throw new Error("OFFLINE");
            console.warn("[Storage] Offline during stats update.");
        }
        console.error("Stats Update Error:", e);
    }
}

export async function saveTransaction(id, data) {
    await ensureAuthReady();
    if (!auth.currentUser) return;

    console.log(`[Storage] Saving transaction ${id} with data:`, data);
    try {
        // Add metadata about who processed it
        const enrichedData = {
            ...data,
            processedBy: auth.currentUser.email,
            processedByUid: auth.currentUser.uid,
            lastUpdated: Date.now()
        };
        
        // Use setDoc with merge to update or create
        await setDoc(doc(db, COL_TX, id), enrichedData, { merge: true });
    } catch (e) {
        console.error(`[Storage] Save Transaction Error for ID ${id}:`, e);
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            throw new Error("OFFLINE");
        }
        console.error("Save Tx Error:", e);
    }
}

export async function getTransaction(id) {
    // If not logged in, we can't check DB. 
    // In background script, we might need to wait for auth or fail gracefully.
    await ensureAuthReady();
    if (!auth.currentUser) return null;

    console.log(`[Storage] Fetching transaction: ${id}`);
    try {
        const docRef = doc(db, COL_TX, id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            console.log(`[Storage] Transaction ${id} found:`, docSnap.data());
            return docSnap.data();
        } else {
            console.log(`[Storage] Transaction ${id} not found.`);
            return null;
        }
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            console.warn("[Storage] Offline during getTransaction.");
            throw new Error("OFFLINE");
        }
        console.error("Storage Error:", e);
        return null;
    }
}

export async function getRecentTransactions(limitCount = 100) {
    await ensureAuthReady();
    if (!auth.currentUser) return { transactions: [], lastDoc: null };

    const transactions = [];
    console.log(`[Storage] Fetching recent transactions (limit: ${limitCount}).`);
    let lastDoc = null;
    try {
        const q = query(collection(db, COL_TX), orderBy("timestamp", "desc"), limit(limitCount));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
        lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
        console.log(`[Storage] Found ${transactions.length} recent transactions.`);
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            console.warn("Storage (getRecentTransactions): Client offline.");
            return { transactions: [], lastDoc: null };
        }
        console.error("Fetch Error:", e);
    }
    return { transactions, lastDoc };
}

export async function getMoreTransactions(startAfterDoc, limitCount = 50) {
    await ensureAuthReady();
    if (!auth.currentUser || !startAfterDoc) return { transactions: [], lastDoc: null };

    const transactions = [];
    console.log(`[Storage] Fetching more transactions (limit: ${limitCount}, starting after: ${startAfterDoc.id}).`);
    let lastDoc = null;
    try {
        const q = query(
            collection(db, COL_TX), 
            orderBy("timestamp", "desc"), 
            startAfter(startAfterDoc),
            limit(limitCount)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
        lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
        console.log(`[Storage] Found ${transactions.length} more transactions.`);
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            console.warn("Storage (getMoreTransactions): Client offline.");
            return { transactions: [], lastDoc: null };
        }
        console.error("Fetch More Error:", e);
    }
    return { transactions, lastDoc };
}

export function onDailyStatsUpdate(dateStr, callback) {
    if (!auth.currentUser) return () => {};
    const docRef = doc(db, COL_STATS, dateStr);
    
    console.log(`[Storage] Subscribing to daily stats for date: ${dateStr}`);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
        const stats = docSnap.exists() ? docSnap.data() : { total: 0, success: 0, fail: 0, amount: 0, failAmount: 0 };
        callback(stats);
    }, (error) => {
        console.error("onDailyStatsUpdate error:", error);
        callback({ total: 0, success: 0, fail: 0, amount: 0, failAmount: 0 });
    });

    return unsubscribe;
}

export function onRecentTransactionsUpdate(limitCount, callback) {
    if (!auth.currentUser) return () => {};
    
    console.log(`[Storage] Subscribing to recent transactions (limit: ${limitCount})`);
    const q = query(collection(db, COL_TX), orderBy("timestamp", "desc"), limit(limitCount));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
        callback(transactions);
    }, (error) => {
        console.error("onRecentTransactionsUpdate error: ", error);
        callback([]);
    });

    return unsubscribe;
}

export function onUserDailyStatsUpdate(dateStr, callback) {
    if (!auth.currentUser) return () => {};
    const docRef = doc(db, 'users', auth.currentUser.uid, 'daily_stats', dateStr);
    console.log(`[Storage] Subscribing to user daily stats for date: ${dateStr}`);
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
        const stats = docSnap.exists() ? docSnap.data() : { total: 0, success: 0, fail: 0, amount: 0, failAmount: 0 };
        callback(stats);
    }, (error) => {
        console.error("onUserDailyStatsUpdate error:", error);
        callback({ total: 0, success: 0, fail: 0, amount: 0, failAmount: 0 });
    });

    return unsubscribe;
}

export async function getDailyStats() {
    await ensureAuthReady();
    if (!auth.currentUser) return null;

    const today = new Date().toISOString().split('T')[0];
    console.log(`[Storage] Getting daily stats for today: ${today}`);
    try {
        const docRef = doc(db, COL_STATS, today);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
        return null;
    }
}

export async function getStatsForDate(dateStr) { // dateStr is YYYY-MM-DD
    await ensureAuthReady();
    if (!auth.currentUser) return null;
    console.log(`[Storage] Getting stats for date: ${dateStr}`);
    try {
        const docRef = doc(db, COL_STATS, dateStr);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            return null;
        }
        console.error("Get Stats Error:", e);
        return null;
    }
}

export async function deleteTransaction(id) {
    await ensureAuthReady();
    if (!auth.currentUser) return;
    console.log(`[Storage] Deleting transaction: ${id}`);
    try {
        await deleteDoc(doc(db, COL_TX, id));
    } catch (e) {
        if (e.message && (e.message.includes("offline") || e.code === "unavailable")) {
            console.warn("Storage (deleteTransaction): Client offline. Delete queued.");
            return;
        }
        console.error("Delete Tx Error:", e);
    }
}

export async function getTransactionsForDate(dateStr) { // dateStr is YYYY-MM-DD
    await ensureAuthReady();
    if (!auth.currentUser) return [];

    const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
    console.log(`[Storage] Fetching transactions for date: ${dateStr}`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();

    const transactions = [];
    try {
        const q = query(
            collection(db, COL_TX),
            where("timestamp", ">=", startOfDay),
            where("timestamp", "<=", endOfDay)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
        console.log(`[Storage] Found ${transactions.length} transactions for ${dateStr}.`);
    } catch (e) {
        console.error("Fetch by date error:", e);
    }
    return transactions;
}

/**
 * Retrieves an SMS entry from the sms_vault by its primary ID.
 * @param {string} id - The Kaffi transaction ID.
 * @returns {Promise<object|null>}
 */
export async function getSmsEntryById(id) {
    await ensureAuthReady();
    if (!auth.currentUser || !id) return null;
    
    console.log(`[SMS Vault] Attempting direct lookup for ID: ${id}`);
    try {
        const docRef = doc(db, COL_SMS_VAULT, id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().status === "pending") {
            console.log(`[SMS Vault] DIRECT MATCH FOUND for ID: ${id}. Data:`, docSnap.data());
            const match = { id: docSnap.id, ...docSnap.data() };
            console.log(`[SMS Vault] DIRECT MATCH FOUND: ${match.id}`);
            return match;
        }
        return null;
    } catch (e) {
        console.error("[SMS Vault] ID Lookup Error:", e);
        return null;
    }
}

/**
 * Retrieves an SMS entry from the sms_vault by its claimedByScreenshotId.
 * This is used to find potential repeat transactions that were previously verified.
 * @param {string} claimedId - The ID from the screenshot that might have claimed an SMS.
 * @returns {Promise<object|null>} The matching SMS data or null if not found.
 */
export async function getSmsEntryByClaimedId(claimedId) {
    await ensureAuthReady();
    if (!auth.currentUser || !claimedId) {
        console.warn("[SMS Vault] Missing claimedId for lookup.");
        return null;
    }

    console.log(`[SMS Vault] Searching for claimedId: ${claimedId}`);
    try {
        const q = query(
            collection(db, COL_SMS_VAULT),
            where("claimedByScreenshotId", "==", claimedId),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const match = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
            console.log(`[SMS Vault] CLAIMED MATCH FOUND: ID ${match.id} for claimedId ${claimedId}`);
            return match;
        }
        console.log(`[SMS Vault] No claimed SMS found for claimedId: ${claimedId}.`);
        return null;
    } catch (e) {
        console.error("[SMS Vault] Claimed ID Query Error:", e);
        return null;
    }
}

/**
 * Retrieves an SMS entry from the sms_vault collection based on sender phone and amount.
 * @param {string} senderPhone - The sender's phone number.
 * @param {number} amount - The transaction amount.
 * @param {number} [timeWindowMinutes=720] - Search window (default 12 hours).
 * @returns {Promise<object|null>} The matching SMS data or null if not found.
 */
export async function getSmsEntryByFingerprint(
  senderPhone, 
  amount, 
  timeWindowMinutes = 720
) {
    await ensureAuthReady();
    if (!auth.currentUser) {
        console.warn("[SMS Vault] Not authenticated. Cannot query SMS vault.");
        return null;
    }
    if (!senderPhone || !amount) {
        console.warn("[SMS Vault] Missing senderPhone or amount for fingerprint lookup.");
        return null;
    }

    const now = Timestamp.now();
    const startTime = new Timestamp(
        now.seconds - (timeWindowMinutes * 60), now.nanoseconds);

    // Normalize to last 9 digits to match vault storage
    const normalizedPhone = senderPhone.replace(/\D/g, "").slice(-9);

    console.log(`[SMS Vault] Fingerprint lookup: Phone=${normalizedPhone}, Amount=${amount}, Status=pending, Since=${startTime.toDate().toLocaleString()}`);
    try {
        const q = query(
            collection(db, COL_SMS_VAULT),
            where("senderPhone", "==", normalizedPhone),
            where("amount", "==", amount), // Exact amount match
            where("transactionTimestamp", ">=", startTime), // Within time window
            where("status", "==", "pending"), // Only consider pending SMS for matching
            limit(1) // We only need one match
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const match = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
            console.log(`[SMS Vault] FINGERPRINT MATCH FOUND: ID ${match.id} (Sender: ${match.senderName})`);
            return match;
        }
        console.log(`[SMS Vault] No pending SMS found matching fingerprint (Phone: ${normalizedPhone}, Amount: ${amount}).`);
        return null;
    } catch (e) {
        console.error("[SMS Vault] Query Error:", e);
        return null;
    }
}

/**
 * Updates an SMS entry in the sms_vault collection.
 * @param {string} id - The ID of the SMS document.
 * @param {object} updates - An object containing the fields to update.
 */
export async function updateSmsEntry(id, updates) {
    await ensureAuthReady();
    if (!auth.currentUser) return;
    
    console.log(`[SMS Vault] Updating SMS entry ${id} with:`, updates);
    try { await setDoc(doc(db, COL_SMS_VAULT, id), updates, { merge: true }); }
    catch (e) { console.error(`[SMS Vault] Error updating entry ${id}:`, e); }
}

export async function getUserTransactionsForDate(dateStr) { // dateStr is YYYY-MM-DD
    await ensureAuthReady();
    if (!auth.currentUser) return [];

    const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
    const endOfDay = new Date(`${dateStr}T23:59:59.999`).getTime();

    const transactions = [];
    try {
        const q = query(
            collection(db, COL_TX),
            where("processedByUid", "==", auth.currentUser.uid),
            where("timestamp", ">=", startOfDay),
            where("timestamp", "<=", endOfDay)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
    } catch (e) {
        console.error("Fetch user tx by date error:", e);
    }
    return transactions;
}

export async function getUserTransactionsForRange(startTime, endTime) {
    await ensureAuthReady();
    if (!auth.currentUser) return [];

    const transactions = [];
    try {
        const q = query(
            collection(db, COL_TX),
            where("processedByUid", "==", auth.currentUser.uid),
            where("timestamp", ">=", startTime),
            where("timestamp", "<=", endTime)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
    } catch (e) {
        console.error("Fetch user tx by range error:", e);
    }
    return transactions;
}

export async function getTransactionsForRange(startTime, endTime) {
    await ensureAuthReady();
    if (!auth.currentUser) return [];

    const transactions = [];
    try {
        const q = query(
            collection(db, COL_TX),
            where("timestamp", ">=", startTime),
            where("timestamp", "<=", endTime)
        );
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
    } catch (e) {
        console.error("Fetch by range error:", e);
    }
    return transactions;
}