(async () => {
    const src = chrome.runtime.getURL('integration.js');
    await import(src);
})();