// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\boa_service.js
import { getDateParser } from '../utils/date_converter.js';

export class BOABruteforce {
    constructor() {
        this.tabId = null;
        this.baseUrl = "https://cs.bankofabyssinia.com/slip/?trx=";
    }

    /**
     * Initializes the background tab if not already active.
     */
    async init() {
        if (!this.tabId) {
            const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
            this.tabId = tab.id;
        }
    }

    /**
     * Clean up: closes the tab to prevent memory leaks.
     */
    async cleanup() {
        if (this.tabId) {
            try {
                await chrome.tabs.remove(this.tabId);
            } catch (e) {
                // Tab might already be closed or context invalidated
            }
            this.tabId = null;
        }
    }

    /**
     * Verifies a single, complete BOA transaction ID.
     * @param {string} id - The full transaction ID to verify.
     * @returns {Promise<object|null>} The parsed receipt data, or null if invalid/timeout.
     */
    async verifyAndParse(id) {
        const MAX_ATTEMPTS = 3;
        let lastError = null;

        try {
            await this.init();
            const targetUrl = `${this.baseUrl}${id}`;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    console.log(`[BOA Verifier] Verification attempt ${attempt}/${MAX_ATTEMPTS} for ${id}`);
                    
                    // 1. Update URL (Force reload on retry)
                    await chrome.tabs.update(this.tabId, { url: targetUrl });

                    // 2. Wait for page load and React render
                    await this._waitForTabLoad(this.tabId, targetUrl);
                    
                    // Small safety buffer for hydration
                    await new Promise(r => setTimeout(r, 800));

                    const result = await chrome.scripting.executeScript({
                        target: { tabId: this.tabId },
                        func: detectionLogic
                    });

                    const output = (result && result[0] && result[0].result) || { status: "ERROR", scannedText: "Script injection failed or returned null." };

                    if (output.status === "SUCCESS" && output.data) {
                        return { ...output.data, bank: 'BOA' };
                    }

                    if (output.status === "FAILURE") {
                        return { recipient: null }; 
                    }

                    // If ERROR or TIMEOUT, throw to trigger retry
                    throw new Error(output.status);

                } catch (e) {
                    console.warn(`[BOA Verifier] Attempt ${attempt} failed:`, e.message);
                    lastError = e;
                    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1000));
                }
            }

            return { error: `Bank Verification Failed: ${lastError ? lastError.message : "Unknown Error"}` };
        } catch (e) {
            console.error("[BOA Verifier] verifyAndParse error:", e);
            return { error: e.message || "Connection Failed" };
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Core Brute-force Logic.
     * Iterates 0-9, constructing candidates and checking against the bank portal.
     * @param {string} prefix - The partial ID (e.g. FT26076QG1MH).
     * @param {string} suffix - The last 4 digits of the Source Account (e.g. 2424).
     * @returns {Promise<string|null>} The full valid ID if found, otherwise null.
     */
    async solve(prefix, suffix) {
        try {
            await this.init();

            for (let digit = 0; digit <= 9; digit++) {
                // Construct ID: Prefix + Guess Digit + Suffix
                const candidateId = `${prefix}${digit}${suffix}`;
                const targetUrl = `${this.baseUrl}${candidateId}`;

                console.log(`[BOA Verifier] Testing digit ${digit} (ID: ${candidateId})...`);

                // 1. Update URL
                await chrome.tabs.update(this.tabId, { url: targetUrl });

                // 2. Wait for page load (navigation complete)
                await this._waitForTabLoad(this.tabId, targetUrl);

                // 3. Inject Detection Logic (Async MutationObserver)
                const result = await chrome.scripting.executeScript({
                    target: { tabId: this.tabId },
                    func: detectionLogic
                });

                const output = (result && result[0] && result[0].result) || { status: "ERROR" };

                if (output.status === "SUCCESS") {
                    return candidateId;
                }
                
                // If FAILURE or TIMEOUT, assume invalid and continue loop
            }
        } catch (e) {
            console.error("[BOA Verifier] Module Error:", e);
        } finally {
            await this.cleanup();
        }

        return null;
    }

    /**
     * Helper to wait for the tab to report 'complete' status for the new URL.
     */
    _waitForTabLoad(tabId, expectedUrlPrefix) {
        return new Promise(resolve => {
            let listener;
            
            const cleanup = () => {
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
            };

            const timeout = setTimeout(() => {
                cleanup();
                resolve();
            }, 10000); // Increased to 10s for slower connections

            listener = (tid, changeInfo, tab) => {
                if (tid === tabId && changeInfo.status === 'complete') {
                    // Ensure we are not catching the 'complete' of the previous page
                    // And ignore about:blank which can trigger early
                    if (tab.url && tab.url !== 'about:blank' && (!expectedUrlPrefix || tab.url.includes("bankofabyssinia.com"))) {
                        clearTimeout(timeout);
                        cleanup();
                        resolve();
                    }
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    }
}

/**
 * Injected Script: Runs inside the bank page.
 * Defined outside class to ensure clean serialization.
 */
function detectionLogic() {
    return new Promise((resolve) => {
        try {
            if (!document || !document.body) {
                resolve({ status: "FAILURE", scannedText: "Document body is null" });
                return;
            }

            const TIMEOUT_MS = 7000;
            let observer = null;
            let timer = null;

            const finish = (result) => {
                if (observer) observer.disconnect();
                if (timer) clearTimeout(timer);
                resolve(result);
            };

            const scrape = () => {
                const data = {};
                // Direct DOM scraping inside the tab
                const rows = document.querySelectorAll('#invoice table tbody tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length === 2) {
                        const key = cells[0].innerText.trim();
                        const value = cells[1].innerText.trim();
                        if (key.includes("Receiver's Name")) data.recipient = value;
                        else if (key.includes("Transferred amount")) data.amount = value;
                        else if (key.includes("Transaction Date")) data.date = value;
                        else if (key.includes("Source Account Name")) data.senderName = value;
                    }
                });
                return data;
            };

            const scan = () => {
                try {
                    const text = document.body.innerText || "";
                    
                    // SUCCESS MARKERS
                    if (text.includes("Source Account") || text.includes("Reference Number") || text.includes("Receiver's Name") || text.includes("Transaction Type")) {
                        const data = scrape();
                        // Only consider it a success if we actually extracted the critical data (recipient)
                        if (data.recipient) {
                            finish({ status: "SUCCESS", data: data });
                            return true;
                        }
                    }
                    // FAILURE MARKERS
                    if (text.includes("Invalid") || text.includes("not found")) {
                        finish({ status: "FAILURE" });
                        return true;
                    }
                } catch (e) { /* ignore inner scan errors */ }
                return false;
            };

            // 1. Immediate Check (in case it rendered instantly)
            if (scan()) return;

            // 2. Observer for Async React Rendering
            observer = new MutationObserver(() => {
                if (scan()) {
                    observer.disconnect();
                    if (timer) clearTimeout(timer);
                }
            });
            observer.observe(document.body, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });

            // 3. Promise-based Timeout
            timer = setTimeout(() => {
                finish({ status: "TIMEOUT" });
            }, TIMEOUT_MS);
        } catch (e) {
            resolve({ status: "ERROR", scannedText: "Injection Error: " + e.message });
        }
    });
}
