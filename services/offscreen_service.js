// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\offscreen_service.js
export async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'To crop and process screenshots',
  });
}

export async function parseReceiptWithOffscreen(url) {
    await setupOffscreenDocument();
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Bank Check Timeout")), 20000);
        chrome.runtime.sendMessage({ action: 'parseReceipt', url: url }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
                reject(new Error("Connection Error: " + chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

export async function processImageWithOffscreen(dataUrl) {
    await setupOffscreenDocument();
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'processImage', dataUrl }, (response) => {
            resolve(response?.base64);
        });
    });
}

export async function cropImageWithOffscreen(dataUrl, rect, tabId) {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({ action: 'cropImage', dataUrl: dataUrl, rect: rect, tabId: tabId });
}
