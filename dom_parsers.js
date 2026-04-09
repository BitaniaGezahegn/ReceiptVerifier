/**
 * Parses the HTML of a Bank of Abyssinia receipt page.
 * @param {Document} doc - The DOM document to parse.
 * @returns {object} An object containing the scraped receipt data.
 */
export function parseBOAReceipt(doc) {
    const data = {};
    const rows = doc.querySelectorAll('#invoice table tbody tr');
    if (rows.length === 0) {
        // Check for the specific "not found" message as a fallback
        if (doc.body.innerText.includes("Invalid") || doc.body.innerText.includes("not found")) {
             return { recipient: null };
        }
        return { recipient: null };
    }

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 2) {
            const key = cells[0].innerText.trim();
            const value = cells[1].innerText.trim();

            switch (key) {
                case "Receiver's Name":
                    data.recipient = value;
                    break;
                case "Transferred amount":
                    data.amount = value;
                    break;
                case "Transaction Date":
                    data.date = value;
                    break;
            }
        }
    });

    return data.recipient ? data : { recipient: null };
}

/**
 * Parses the HTML of a Telebirr receipt page.
 * @param {Document} doc - The DOM document to parse.
 */
export function parseTelebirrReceipt(doc) {
    const data = {};
    const cells = Array.from(doc.querySelectorAll('td'));

    // 1. Extract Recipient (Credited Party)
    const recipLabel = cells.find(c => c.innerText.includes("Credited Party name"));
    if (recipLabel && recipLabel.nextElementSibling) {
        data.recipient = recipLabel.nextElementSibling.innerText.trim();
    }

    // 2. Extract Amount and Date from the Invoice Details table
    // Look for the label then find the data row
    const idLabel = cells.find(c => c.innerText.includes("Invoice No."));
    if (idLabel) {
        const headerRow = idLabel.closest('tr');
        const dataRow = headerRow ? headerRow.nextElementSibling : null;
        
        if (dataRow) {
            const values = dataRow.querySelectorAll('td');
            if (values.length >= 3) {
                data.date = values[1].innerText.trim();   // e.g. 07-04-2026 11:54:37
                data.amount = values[2].innerText.trim(); // e.g. 5.00 Birr
            }
        }
    }
    return data.recipient ? data : { recipient: null };
}