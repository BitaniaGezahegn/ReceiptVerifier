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