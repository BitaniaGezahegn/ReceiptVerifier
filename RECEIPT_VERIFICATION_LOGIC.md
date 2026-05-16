# Receipt Verification Logic & Architecture (v4.0)

This document provides a detailed technical reference for the SMS-only verification model implemented in the Bank Receipt Verifier Pro extension.

## 1. Core Architectural Principle
The extension has transitioned from a dual-mode (Bank Scraping + SMS) system to a **purely SMS-based model**. It relies on a centralized `sms_vault` in Firestore, which is populated by an external SMS forwarder.

---

## 2. Verification Processing Flow

### Phase 1: Data Extraction (AI Vision)
1.  The receipt image (or screenshot) is captured.
2.  The image is sent to the AI Vision service (`ai_service.js`).
3.  The AI extracts the **Transaction ID**.
4.  If the ID format is unrecognized, the system retries with the raw, unenhanced image.
5.  If extraction still fails, the status is marked as **"Random"**.

### Phase 2: SMS Vault Lookup (`verifyViaSms`)
The extracted ID is processed through `sms_verification_service.js` with the following matching logic:

1.  **Direct ID Match**:
    *   Query: `sms_vault` where `id == extractedId`.
    *   Used for all bank types.
2.  **Claimed ID Match**:
    *   Query: `sms_vault` where `claimedByScreenshotId == extractedId`.
    *   Ensures that if a single transaction is verified using different screenshot IDs, it is still caught as a duplicate.
3.  **Fingerprint Match (Non-Kaafi Fallback)**:
    *   Condition: Only triggered for IDs not matching the "Kaafi" bank format.
    *   Query: `sms_vault` where `senderPhone == customerPhone` AND `amount == portalAmount`.
    *   Reasoning: Transfers from other banks into the Kaafi account often appear in the SMS feed with different metadata; fingerprinting ensures these are correctly verified even if OCR on the ID is slightly imperfect.

### Phase 3: Status Determination & Priority
Once a vault record is found, the final status is determined by these rules (in order):

1.  **Under 50**: If `vault.amount < 50`. (Checks the actual money received, not what the portal claimed).
2.  **Repeat**: If `vault.verificationCount > 0`. (Indicates the money was already "used" for another receipt).
3.  **AA is [Amt]**: If `vault.amount != portalAmount`. (Amount mismatch between receipt and portal).
4.  **Verified**: First-time success with a valid amount.

---

## 3. Integration & Automation Logic

### Portal Injection (`dom_manager.js`)
When a result is returned to the Web Management portal, the extension automatically fills the rejection/confirmation comments:

*   **Repeat** → Comments `"Repeat"`
*   **Wrong Recipient** → Comments `"Wrong Recipient"`
*   **Random** → Comments `"Random"`
*   **Under 50** → Comments `"Under 50"`
*   **AA is [Amt]** → Comments `"AA is [foundAmount]"` in the Confirm module.

### Batch Processing
*   The system can iterate through the portal's task queue.
*   **Reverse Mode**: Allows processing from the bottom of the list.
*   **Auto Mode**: Continuously refreshes and processes new receipts as they arrive.

---

## 4. Maintenance & Configuration
*   **Bank Formats**: Managed in `config.js` or via the Settings UI (Length and Prefix rules).
*   **API Keys**: Supports multiple Groq/AI keys with automatic rotation on rate limits.
*   **Time Checks**: As of v4.0, all time-based rejections (e.g., "Max Receipt Age") have been removed to allow for flexible verification of older records.
