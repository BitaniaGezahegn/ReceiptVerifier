// --- UI INJECTION FUNCTIONS ---

export function showRandomReviewModal(html, mgmtTabId, rowId, extractedId, imgUrl) {
    const host = document.createElement('div');
    host.style.cssText = "position:fixed; top:20px; right:20px; z-index:2147483647; font-family:sans-serif;";
    
    const modal = document.createElement('div');
    modal.style.cssText = "background:white; padding:20px; border-radius:12px; width:300px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.3); border: 1px solid #e2e8f0;";
    
    modal.innerHTML = html;
    
    host.appendChild(modal);
    document.body.appendChild(host);
    
    host.querySelector('#btn-ok').onclick = () => {
      chrome.runtime.sendMessage({ action: "confirmRandomReject", mgmtTabId: mgmtTabId, rowId: rowId, extractedId: extractedId, imgUrl: imgUrl });
    };
    
    host.querySelector('#btn-cancel').onclick = () => host.remove();
  }
  
  export function showCustomConfirm(html) {
    return new Promise((resolve) => {
      if (document.getElementById("ebirr-host-confirm")) return;
      const host = document.createElement('div');
      host.id = "ebirr-host-confirm";
      host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;";
      document.body.appendChild(host);
  
      const shadow = host.attachShadow({ mode: 'open' });
      const modal = document.createElement('div');
      modal.style = `
        position:fixed; top:50%; left:50%; 
        transform:translate(-50%, -50%); 
        background: #f8fafc; padding: 25px; 
        border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.4); 
        width:350px; text-align:center; border: 1px solid #e2e8f0;
      `;
      modal.innerHTML = html;
      shadow.appendChild(modal);
  
      const done = (result) => { host.remove(); resolve(result); };
      shadow.getElementById('btn-ok').onclick = () => done(true);
      shadow.getElementById('btn-cancel').onclick = () => done(false);
      host.addEventListener('click', (e) => { if (e.target === host) done(false); });
      modal.addEventListener('click', (e) => e.stopPropagation());
    });
  }
  
  export function showCustomPrompt(html) {
    return new Promise((resolve) => {
      if (document.getElementById("ebirr-host-prompt")) return;
      const host = document.createElement('div');
      host.id = "ebirr-host-prompt";
      host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;";
      document.body.appendChild(host);
  
      const shadow = host.attachShadow({ mode: 'open' });
      const modal = document.createElement('div');
      modal.style = `
        position:fixed; top:50%; left:50%; 
        transform:translate(-50%, -50%); 
        background: #f8fafc; padding: 25px; 
        border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.4); 
        width:350px; text-align:center; border: 1px solid #e2e8f0;
      `;
      modal.innerHTML = html;
      shadow.appendChild(modal);
  
      const input = shadow.getElementById('prompt-input');
      input.focus();
      const done = (value) => { host.remove(); resolve(value); };
  
      shadow.getElementById('btn-ok').onclick = () => done(input.value);
      shadow.getElementById('btn-cancel').onclick = () => done(null);
      host.addEventListener('click', (e) => { if (e.target === host) done(null); });
      modal.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(input.value);
        if (e.key === 'Escape') done(null);
      });
    });
  }
  
  export function updateStatus(message) {
      const span = document.querySelector('#ebirr-status span');
      if (span) span.innerText = message;
  }
  
  export async function showAmountPicker(html) {
    if (document.getElementById('ebirr-host')) return new Promise(() => {});
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.id = "ebirr-host";
      host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); pointer-events:auto;";
      document.body.appendChild(host);
      const shadow = host.attachShadow({mode: 'open'});
      const modal = document.createElement('div');
      modal.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background: #f8fafc; padding:25px; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.6); width:340px; font-family: 'Segoe UI', sans-serif; text-align:center; border: 1px solid #e2e8f0;`;
      modal.innerHTML = html;
      shadow.appendChild(modal);
      const input = shadow.getElementById('ebirr-val');
      const continueBtn = shadow.getElementById('continue-btn');
      const modeToggle = shadow.getElementById('mode-toggle');
      const quickAmounts = shadow.getElementById('quick-amounts');
      const dialPad = shadow.getElementById('dial-pad');
      const focusInput = () => { input.focus(); input.select(); };
      focusInput(); setTimeout(focusInput, 50);
      const done = (val) => { host.remove(); resolve(val); };
      quickAmounts.querySelectorAll('.q-amt').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); done(parseFloat(btn.innerText)); }; });
      continueBtn.onclick = () => { if (input.value) done(parseFloat(input.value)); };
      input.onkeydown = (e) => { if (e.key === 'Enter' && input.value) { e.preventDefault(); done(parseFloat(input.value)); } if (e.key === 'Escape') done(null); };
      modeToggle.onclick = () => {
        const isQuickMode = quickAmounts.style.display !== 'none';
        if (isQuickMode) { quickAmounts.style.display = 'none'; dialPad.style.display = 'grid'; modeToggle.textContent = 'Switch to Quick Amounts'; } 
        else { quickAmounts.style.display = 'grid'; dialPad.style.display = 'none'; modeToggle.textContent = 'Switch to Dial Pad'; }
      };
      dialPad.querySelectorAll('.dial-key').forEach(key => {
        key.onclick = () => { const value = key.innerText; if (value === '⌫') input.value = input.value.slice(0, -1); else input.value += value; };
      });
      modal.addEventListener('click', (e) => e.stopPropagation());
      host.addEventListener('click', () => done(null));
    });
  }
  
  export function runShowStatus(html, amt) {
      if (document.getElementById('ebirr-status-host')) return;
      const host = document.createElement('div');
      host.id = 'ebirr-status-host';
      document.body.appendChild(host);
      const shadow = host.attachShadow({mode: 'open'});
      const statusModal = document.createElement('div');
      statusModal.id = 'ebirr-status';
      statusModal.innerHTML = html;
      shadow.appendChild(statusModal);
      shadow.getElementById('manual-btn').onclick = () => { host.remove(); chrome.runtime.sendMessage({ action: "triggerManualPrompt", amount: amt }); };
  }
  
  export function showDuplicateModal(html, id, amount, status) {
      const host = document.createElement('div');
      host.id = "ebirr-host-duplicate";
      host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif;";
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const modal = document.createElement('div');
      modal.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); font-family: 'Segoe UI', system-ui, sans-serif;`;
      modal.innerHTML = html;
      shadow.appendChild(modal);
      const done = () => host.remove();
      shadow.getElementById('btn-copy-exit').onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(status).finally(() => { chrome.runtime.sendMessage({ action: "closeTab" }); done(); }); };
      shadow.getElementById('btn-continue').onclick = (e) => { e.stopPropagation(); chrome.runtime.sendMessage({ action: "continueDuplicate", id: id, amount: amount }); done(); };
      host.addEventListener('click', done); modal.addEventListener('click', (e) => e.stopPropagation());
  }
  
  export function showAiFailureModal(html, amount) {
    if (document.getElementById('ebirr-failure-host')) return;
    const host = document.createElement('div');
    host.id = 'ebirr-failure-host';
    host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', system-ui, sans-serif;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const modal = document.createElement('div');
    modal.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); font-family: 'Segoe UI', system-ui, sans-serif;`;
    modal.innerHTML = html;
    shadow.appendChild(modal);
    const close = () => host.remove();
    shadow.getElementById('btn-random').onclick = () => { navigator.clipboard.writeText("Random").finally(() => { chrome.runtime.sendMessage({ action: "closeTab" }); close(); }); };
    shadow.getElementById('btn-manual').onclick = () => { close(); chrome.runtime.sendMessage({ action: "triggerManualPrompt", amount: amount }); };
    shadow.getElementById('btn-close').onclick = close;
    host.addEventListener('click', (e) => { if(e.target === host) close(); });
  }
  
  export function showResultOverlay(html, transId, status, foundAmt, senderName, senderPhone, timeStr, foundName) {
    if (document.getElementById('ebirr-result-host')) return;
    const host = document.createElement('div');
    host.id = 'ebirr-result-host';
    host.style = "position:fixed; top:30px; left:50%; transform:translateX(-50%); z-index:2147483647; font-family: 'Segoe UI', system-ui, sans-serif;";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = html;
    shadow.appendChild(modal);
    const saveAndClose = (shouldCloseTab) => {
      window.removeEventListener('keydown', handleKeydown);
      host.remove();
      if (shouldCloseTab) chrome.runtime.sendMessage({ action: "closeTab" });
    };
    const isSuccess = status === "Verified";
    shadow.getElementById('btn-action').onclick = () => { if (!isSuccess) { navigator.clipboard.writeText(status).finally(() => saveAndClose(true)); } else { saveAndClose(true); } };
    shadow.getElementById('btn-continue').onclick = () => saveAndClose(false);
    const handleKeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); shadow.getElementById('btn-action').click(); } };
    window.addEventListener('keydown', handleKeydown);
  }
  
  export function grabImageData(imgSrc) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "fetchImageBase64", url: imgSrc }, (response) => {
        if (!response || response.error || !response.data) { resolve(null); return; }
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 2560; 
          let width = img.width; let height = img.height;
          if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.filter = 'grayscale(1) contrast(1.5)';
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 1.0).split(',')[1]);
        };
        img.onerror = () => resolve(null);
        img.src = "data:image/jpeg;base64," + response.data;
      });
      setTimeout(() => resolve(null), 8000);
    });
  }
  
  export function scrapeBankData(xpaths) {
    const getX = (p) => { const res = document.evaluate(p, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; return res ? res.innerText.replace(/[\s\u00A0]+/g, ' ').trim() : null; };
    const nodeR = getX(xpaths.recipient); const nodeD = getX(xpaths.date); const nodeA = getX(xpaths.amount);
    
    if (!nodeR || !nodeD || !nodeA) return { error: "Data Missing on Bank Page" };

    return {
        recipient: nodeR,
        reason: getX(xpaths.reason),
        date: nodeD,
        amount: nodeA,
        senderName: getX(xpaths.senderName),
        senderPhone: getX(xpaths.senderPhone)
    };
  }
  
  export function modalInjection(amt, imgSrc, mode, askHtml, manualHtml) {
    function showCustomConfirm(html) {
      return new Promise((resolve) => {
        if (document.getElementById("ebirr-host-confirm")) return;
        const host = document.createElement('div');
        host.id = "ebirr-host-confirm";
        host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;";
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const modal = document.createElement('div');
        modal.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background: #f8fafc; padding: 25px; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.4); width:350px; text-align:center; border: 1px solid #e2e8f0;`;
        modal.innerHTML = html;
        shadow.appendChild(modal);
        const done = (result) => { host.remove(); resolve(result); };
        shadow.getElementById('btn-ok').onclick = () => done(true);
        shadow.getElementById('btn-cancel').onclick = () => done(false);
        host.addEventListener('click', (e) => { if (e.target === host) done(false); });
        modal.addEventListener('click', (e) => e.stopPropagation());
      });
    }

    function showCustomPrompt(html) {
      return new Promise((resolve) => {
        if (document.getElementById("ebirr-host-prompt")) return;
        const host = document.createElement('div');
        host.id = "ebirr-host-prompt";
        host.style = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:2147483647; background:rgba(0,0,0,0.5); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;";
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const modal = document.createElement('div');
        modal.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background: #f8fafc; padding: 25px; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.4); width:350px; text-align:center; border: 1px solid #e2e8f0;`;
        modal.innerHTML = html;
        shadow.appendChild(modal);
        const input = shadow.getElementById('prompt-input');
        input.focus();
        const done = (value) => { host.remove(); resolve(value); };
        shadow.getElementById('btn-ok').onclick = () => done(input.value);
        shadow.getElementById('btn-cancel').onclick = () => done(null);
        host.addEventListener('click', (e) => { if (e.target === host) done(null); });
        modal.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
      });
    }

    async function run() {
      if (mode === 'ask') {
        const useAI = await showCustomConfirm(askHtml);
        if (useAI) {
          chrome.runtime.sendMessage({ action: "startAI", amount: amt, src: imgSrc });
        } else {
          const manId = await showCustomPrompt(manualHtml);
          if (manId) {
            chrome.runtime.sendMessage({ action: "manualIdEntry", id: manId.replace(/\D/g, ''), amount: amt });
          }
        }
      } else if (mode === 'manual') {
        const manId = await showCustomPrompt(manualHtml);
        if (manId) {
          chrome.runtime.sendMessage({ action: "manualIdEntry", id: manId.replace(/\D/g, ''), amount: amt });
        }
      }
    }
    run();
  }