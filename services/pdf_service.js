// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\pdf_service.js
export async function handlePdfCapture(url) {
    return new Promise((resolve, reject) => {
        // Safety timeout to prevent hanging indefinitely (45s)
        const timeoutId = setTimeout(() => {
            reject(new Error("PDF Capture Timeout"));
        }, 45000);

        chrome.windows.create({ url: url, type: 'popup', state: 'maximized', focused: true }, async (win) => {
            if (chrome.runtime.lastError) { clearTimeout(timeoutId); return reject(chrome.runtime.lastError); }
            const tabId = win.tabs[0].id;
            
            const checkListener = (tId, changeInfo, tab) => {
                if (tId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(checkListener);
                    setTimeout(async () => {
                        try {
                            // Ensure focus for rendering
                            await chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => window.focus() }).catch(() => {});

                            // 1. Get Dimensions
                            const dims = await chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: () => ({
                                    height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                                    viewHeight: window.innerHeight
                                })
                            });
                            
                            const { height, viewHeight } = dims[0].result;
                            const captures = [];
                            let currentY = 0;

                            // 2. Loop: Scroll & Capture
                            while (currentY < height || captures.length === 0) {
                                if (currentY > 0) {
                                    await chrome.scripting.executeScript({ target: { tabId: tabId }, func: (y) => window.scrollTo(0, y), args: [currentY] });
                                    await new Promise(r => setTimeout(r, 800)); // Wait for render
                                }

                                const dataUrl = await new Promise(res => chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 80 }, res));
                                if (dataUrl) captures.push(dataUrl);
                                
                                currentY += viewHeight;
                                if (captures.length >= 5) break; // Limit to 5 pages
                            }

                            chrome.windows.remove(win.id);
                            resolve(captures);
                        } catch (e) {
                            chrome.windows.remove(win.id);
                            reject(e);
                        } finally {
                            clearTimeout(timeoutId);
                        }
                    }, 3500); // Increased wait to ensure PDF renders properly
                }
            };
            chrome.tabs.onUpdated.addListener(checkListener);
        });
    });
}
