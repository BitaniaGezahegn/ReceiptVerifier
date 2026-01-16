// Centralized Database Logic
import { db, auth } from './firebase_config.js';
import { doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit, increment, deleteDoc, where, onSnapshot, writeBatch, startAfter } from '../firebase/firebase-firestore.js';
import { ensureAuthReady } from './auth_service.js';

// Collection Names
const COL_TX = "transactions";
const COL_STATS = "daily_stats";

/**
 * Parses a bank date string into a timestamp.
 * @param {string | null} bankDateStr - The date string from the bank.
 * @returns {number | null}
 */
function parseBankDate(bankDateStr) {
    if (!bankDateStr) return null;
    try {
        // Format from bank is 'YYYY-MM-DD HH:MM:SS +ZZZZ'
        const p = bankDateStr.match(/(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})\s(\+\d{4})/);
        if (p) {
          // e.g. new Date('2024-01-01T12:30:00+03:00')
          return new Date(`${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}${p[7].slice(0,3)}:${p[7].slice(3)}`).getTime();
        }
        // Fallback for other date string formats that JS can parse
        const ts = new Date(bankDateStr).getTime();
        return isNaN(ts) ? null : ts;
    } catch (e) {
        return null;
    }
}

/**
 * Centralized function to build and log a complete transaction record.
 * This handles new, repeat, and failed verifications, and updates daily stats.
 * @param {string} id - The transaction ID to save under.
 * @param {object} verificationResult - The result from `verifyTransactionData` or a similar structure.
 * @param {object|null} [existingTx=null] - The existing transaction from DB if it's a repeat.
 * @param {string|null} [originalId=null] - The AI-extracted ID, if the final ID is a 'RANDOM' key.
 */
export async function logTransactionResult(id, verificationResult, existingTx = null, originalId = null) {
    await ensureAuthReady();
    if (!auth.currentUser) return;

    let statusToSave = verificationResult.status;
    // Prevent "Repeat" from overwriting the original status in the database
    if (statusToSave === "Repeat" && existingTx && existingTx.status) {
        statusToSave = existingTx.status;
    }

    const isSuccess = statusToSave === "Verified" || statusToSave.startsWith("AA");
    const now = Date.now();

    // Build the canonical payload
    const payload = {
        ...(existingTx || {}), // Start with existing data if it's a repeat
        id: id,
        amount: verificationResult.foundAmt,
        status: statusToSave,
        timestamp: existingTx ? existingTx.timestamp : now, // Keep original verification time for new entries
        dateVerified: existingTx ? existingTx.dateVerified : new Date(now).toLocaleString(),
        senderName: verificationResult.senderName || (existingTx && existingTx.senderName) || null,
        senderPhone: verificationResult.senderPhone || (existingTx && existingTx.senderPhone) || null,
        recipientName: verificationResult.foundName || (existingTx && existingTx.recipientName) || null,
        bankDate: verificationResult.bankDate || (existingTx && existingTx.bankDate) || null,
        transactionTime: parseBankDate(verificationResult.bankDate) || (existingTx && existingTx.transactionTime) || null,
        repeatCount: existingTx ? (existingTx.repeatCount || 0) + 1 : 0,
        processedBy: auth.currentUser.email,
        processedByUid: auth.currentUser.uid,
        lastUpdated: now,
        lastRepeat: existingTx ? now : null,
        imported: existingTx ? !!existingTx.imported : false,
        originalId: originalId || (existingTx && existingTx.originalId) || null,
    };

    await saveTransaction(id, payload);
    await updateDailyStats(isSuccess, verificationResult.foundAmt || 0);
}

export async function updateDailyStats(isSuccess, amount) {
    await ensureAuthReady();
    if (!auth.currentUser) return; // Guard: Must be logged in

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const teamStatsRef = doc(db, COL_STATS, today);
    const userStatsRef = doc(db, 'users', auth.currentUser.uid, 'daily_stats', today);
    
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
        const batch = writeBatch(db);
        batch.set(teamStatsRef, incrementData, { merge: true });
        batch.set(userStatsRef, incrementData, { merge: true });
        await batch.commit();
    } catch (e) {
        console.error("Stats Update Error:", e);
    }
}

export async function saveTransaction(id, data) {
    await ensureAuthReady();
    if (!auth.currentUser) return;

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
        console.error("Save Tx Error:", e);
    }
}

export async function getTransaction(id) {
    // If not logged in, we can't check DB. 
    // In background script, we might need to wait for auth or fail gracefully.
    await ensureAuthReady();
    if (!auth.currentUser) return null;

    try {
        const docRef = doc(db, COL_TX, id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            return null;
        }
    } catch (e) {
        console.error("Storage Error:", e);
        return null;
    }
}

export async function getRecentTransactions(limitCount = 100) {
    await ensureAuthReady();
    if (!auth.currentUser) return { transactions: [], lastDoc: null };

    const transactions = [];
    let lastDoc = null;
    try {
        const q = query(collection(db, COL_TX), orderBy("timestamp", "desc"), limit(limitCount));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
            transactions.push(doc.data());
        });
        lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
    } catch (e) {
        console.error("Fetch Error:", e);
    }
    return { transactions, lastDoc };
}

export async function getMoreTransactions(startAfterDoc, limitCount = 50) {
    await ensureAuthReady();
    if (!auth.currentUser || !startAfterDoc) return { transactions: [], lastDoc: null };

    const transactions = [];
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
    } catch (e) {
        console.error("Fetch More Error:", e);
    }
    return { transactions, lastDoc };
}

export function onDailyStatsUpdate(dateStr, callback) {
    if (!auth.currentUser) return () => {};
    const docRef = doc(db, COL_STATS, dateStr);
    
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
    try {
        const docRef = doc(db, COL_STATS, dateStr);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
        console.error("Get Stats Error:", e);
        return null;
    }
}

export async function deleteTransaction(id) {
    await ensureAuthReady();
    if (!auth.currentUser) return;
    try {
        await deleteDoc(doc(db, COL_TX, id));
    } catch (e) {
        console.error("Delete Tx Error:", e);
    }
}

export async function getTransactionsForDate(dateStr) { // dateStr is YYYY-MM-DD
    await ensureAuthReady();
    if (!auth.currentUser) return [];

    const startOfDay = new Date(`${dateStr}T00:00:00`).getTime();
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
    } catch (e) {
        console.error("Fetch by date error:", e);
    }
    return transactions;
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