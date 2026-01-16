import { BANK_XPATHS } from './utils/constants.js';

console.log("[Offscreen] Script loaded.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Offscreen] Received message:", request.action);
  if (request.action === 'processImage') {
    processImage(request.dataUrl).then(base64 => sendResponse({ base64 }));
    return true;
  } else if (request.action === 'cropImage') {
    cropImage(request.dataUrl, request.rect, request.tabId);
  } else if (request.action === 'parseReceipt') {
    parseReceipt(request.url).then(sendResponse);
    return true;
  }
});

async function cropImage(dataUrl, rect, tabId) {
  const img = new Image();
  img.onload = async () => {
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
    const reader = new FileReader();
    reader.onload = () => {
      chrome.runtime.sendMessage({
        action: 'croppingComplete',
        base64: reader.result.split(',')[1],
        tabId: tabId
      });
    };
    reader.readAsDataURL(blob);
  };
  img.src = dataUrl;
}

async function parseReceipt(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await response.text();
    
    // Explicitly check for the 404 page content
    if (text.includes('Not Found Page')) {
        return { recipient: null };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');

    const getText = (xpath) => {
      const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue ? result.singleNodeValue.innerText.replace(/[\s\u00A0]+/g, ' ').trim() : null;
    };

    return {
      recipient: getText(BANK_XPATHS.recipient),
      senderName: getText(BANK_XPATHS.senderName),
      senderPhone: getText(BANK_XPATHS.senderPhone),
      reason: getText(BANK_XPATHS.reason),
      date: getText(BANK_XPATHS.date),
      amount: getText(BANK_XPATHS.amount)
    };
  } catch (err) {
    if (err.name === 'AbortError') return { error: "Bank Request Timed Out" };
    return { error: err.message };
  }
}

async function processImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      // Use OffscreenCanvas for processing
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');

      // Resize logic - 1536 balances OCR detail and payload size
      const maxDim = 1536; 
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;

      // Apply pre-processing filters
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'grayscale(1) contrast(1.5)';
      ctx.drawImage(img, 0, 0, width, height);

      // Get the processed image as a Blob (Optimized Quality)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });

      // Convert Blob to Base64 data URL
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    };
    img.onerror = () => resolve(null); // Prevent hanging on invalid images
    img.src = dataUrl;
  });
}
