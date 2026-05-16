/**
 * offscreen_service.js — STUB
 *
 * The offscreen document (offscreen.js / offscreen.html) has been removed as part of the
 * SMS-only verification refactor. The bank portal scraping that relied on it is no longer used.
 *
 * The `setupOffscreenDocument` export is kept as a no-op so that any remaining callers
 * (e.g. the screenshot-crop flow in message_router.js) can still call it without errors.
 * The cropper flow sends a direct `cropImage` message to the background service worker and
 * does not actually require an offscreen document.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function setupOffscreenDocument() {
    // No-op: offscreen document has been removed.
}

export async function processImageWithOffscreen(dataUrl) {
    // No-op stub — image processing is now handled inline in integration_controller.js
    return null;
}

export async function cropImageWithOffscreen(dataUrl, rect, tabId) {
    // No-op stub — cropping is triggered directly via chrome.runtime.sendMessage in message_router.js
}
