// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\boa_service.js
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
     * Core Brute-force Logic.
     * Iterates 0-9, constructing candidates and checking against the bank portal.
     * @param {string} prefix - Digits before the missing index.
     * @param {string} suffix - Digits after the missing index.
     * @returns {Promise<string|null>} The full valid ID if found, otherwise null.
     */
    async solve(prefix, suffix) {
        try {
            await this.init();

            for (let digit = 0; digit <= 9; digit++) {
                const candidateId = `${prefix}`;
                const targetUrl = `${this.baseUrl}`;

                console.log(`[BOA Verifier] Testing digit  (ID: )...`);

                // 1. Update URL
                await chrome.tabs.update(this.tabId, { url: targetUrl });

                // 2. Wait for page load (navigation complete)
                await this._waitForTabLoad(this.tabId, targetUrl);

                // 3. Inject Detection Logic (Async MutationObserver)
                const result = await chrome.scripting.executeScript({
                    target: { tabId: this.tabId },
                    func: this._detectionLogic
                });

                const status = result && result[0] ? result[0].result : "ERROR";

                if (status === "SUCCESS") {
                    console.log(`[BOA Verifier] MATCH FOUND: `);
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
            const timeout = setTimeout(() => resolve(), 5000); // 5s fallback safety

            const listener = (tid, changeInfo, tab) => {
                if (tid === tabId && changeInfo.status === 'complete') {
                    // Ensure we are not catching the 'complete' of the previous page
                    if (!tab.url || tab.url.includes("bankofabyssinia.com")) {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timeout);
                        resolve();
                    }
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    }

    /**
     * Injected Script: Runs inside the bank page.
     * Uses MutationObserver to detect React rendering changes.
     */
    _detectionLogic() {
        return new Promise((resolve) => {
            const TIMEOUT_MS = 7000;
            let observer = null;
            let timer = null;

            const finish = (result) => {
                if (observer) observer.disconnect();
                if (timer) clearTimeout(timer);
                resolve(result);
            };

            const scan = () => {
                const text = document.body.innerText || "";
                
                // SUCCESS MARKERS
                if (text.includes("Source Account") || text.includes("Reference Number")) {
                    finish("SUCCESS");
                    return true;
                }
                
                // FAILURE MARKERS
                if (text.includes("Invalid") || text.includes("not found")) {
                    finish("FAILURE");
                    return true;
                }
                
                return false;
            };

            // 1. Immediate Check (in case it rendered instantly)
            if (scan()) return;

            // 2. Observer for Async React Rendering
            observer = new MutationObserver(() => {
                scan();
            });
            observer.observe(document.body, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });

            // 3. Promise-based Timeout
            timer = setTimeout(() => {
                finish("TIMEOUT");
            }, TIMEOUT_MS);
        });
    }
}
