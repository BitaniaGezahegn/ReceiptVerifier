const STORAGE_KEY = 'ebirr_flagged_ids';

// SVG for the flag icon
const FLAG_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
  <line x1="4" y1="22" x2="4" y2="15"></line>
</svg>
`;

function init() {
    console.log("Ebirr Flag Injector: Loaded and observing for table changes.");
    // Use a small delay to let the page finish its initial render, just in case.
    setTimeout(scanAndInject, 500);

    // Watch for table updates (pagination, filtering, etc.)
    const observer = new MutationObserver(() => {
        // Debounce the scan to avoid running it too many times during rapid DOM changes.
        if (window.ebirrFlagScanTimeout) {
            clearTimeout(window.ebirrFlagScanTimeout);
        }
        window.ebirrFlagScanTimeout = setTimeout(scanAndInject, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

async function scanAndInject() {
    console.log("Ebirr Flag Injector: Scanning for table...");
    // 1. Find the most likely data table on the page.
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length === 0) {
        return; // No tables on the page, nothing to do.
    }
    const table = tables.reduce((p, c) => (c.rows.length > p.rows.length ? c : p), tables[0]);

    // Use a more robust selector that doesn't rely on `tbody` and excludes the header.
    const rows = table.querySelectorAll('tr:not(.table-head)');
    if (rows.length === 0) return;

    // 2. Find the ID column index dynamically.
    let idIndex = -1;
    // Use a more robust selector for the header row.
    const headerRow = table.querySelector('thead tr, tr.table-head, tr[name="table-header"]');
    if (headerRow) {
        const headers = Array.from(headerRow.querySelectorAll('th'));
        // Be more specific to avoid matching "User ID".
        const foundIndex = headers.findIndex(th => /transaction id/i.test(th.textContent));
        if (foundIndex !== -1) {
            idIndex = foundIndex;
        }
    }

    // 3. Fallback if no header is found or no matching column name.
    if (idIndex === -1) {
        // The previous smart-guessing logic was unreliable. Defaulting to the first column
        // is safer for this specific table structure, as "Transaction ID" is the first column.
        console.warn("Ebirr Flag Injector: Could not determine 'Transaction ID' column from header. Defaulting to column 0.");
        idIndex = 0;
    }

    console.log(`Ebirr Flag Injector: Using column index ${idIndex} for Transaction ID.`);

    // 4. Get flagged IDs from storage.
    let storage;
    try {
        storage = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (e) {
        if (e.message.includes("Extension context invalidated")) {
            console.warn("Ebirr Flag Injector: Extension context invalidated. Stopping.");
            return;
        }
        throw e;
    }
    const flaggedMap = storage[STORAGE_KEY] || {};

    // 5. Inject flags.
    rows.forEach(row => {
        if (row.dataset.flagInjected) return; // Prevent duplicates
        
        // Mark as processed immediately to prevent re-scanning in case of errors.
        row.dataset.flagInjected = "true";

        const cells = row.querySelectorAll('td');
        if (cells.length <= idIndex) return;

        const targetCell = cells[idIndex];
        if (!targetCell) return;
        
        const txId = targetCell.textContent.trim();
        
        // If there's no text content or it's not a numeric ID, skip this row.
        // This handles empty cells and cells with placeholder text like "N/A".
        if (!txId || !/^\d+$/.test(txId)) {
            return;
        }

        // Create the icon container
        const flagSpan = document.createElement('span');
        flagSpan.innerHTML = FLAG_SVG;
        flagSpan.style.cssText = "cursor: pointer; margin-left: 8px; vertical-align: middle; transition: color 0.2s ease, background-color 0.2s ease;";
        flagSpan.title = "Flag/Unflag this transaction";

        // Set initial color and row style
        const isFlagged = !!flaggedMap[txId];
        updateFlagStyle(flagSpan, row, isFlagged);

        // Click Handler
        flagSpan.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();

            try {
                // Re-fetch storage to ensure we don't overwrite other tabs' changes
                const currentStore = await chrome.storage.local.get([STORAGE_KEY]);
                const currentMap = currentStore[STORAGE_KEY] || {};
                
                if (currentMap[txId]) {
                    delete currentMap[txId]; // Unflag
                    updateFlagStyle(flagSpan, row, false);
                } else {
                    currentMap[txId] = true; // Flag
                    updateFlagStyle(flagSpan, row, true);
                }
                
                await chrome.storage.local.set({ [STORAGE_KEY]: currentMap });
            } catch (err) {
                if (err.message.includes("Extension context invalidated")) {
                    alert("Extension updated. Please refresh the page.");
                }
            }
        };

        // Append the flag to the cell.
        targetCell.appendChild(flagSpan);
    });
}

function updateFlagStyle(span, row, isFlagged) {
    if (isFlagged) {
        span.style.color = "#ef4444";
        span.style.fill = "currentColor";
        if (row) row.style.backgroundColor = "#2a0a0a";
    } else {
        span.style.color = "#94a3b8";
        span.style.fill = "none";
        if (row) row.style.backgroundColor = "";
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
