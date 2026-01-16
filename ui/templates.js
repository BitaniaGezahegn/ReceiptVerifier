export const getAmountPickerHtml = () => {
    const amounts = [50, 100, 150, 200, 300, 500, 1000, 2000, 5000];
    const dialpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
    return `
      <style>
        .q-amt, .dial-key { padding:10px; cursor:pointer; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; font-weight:600; font-family:inherit; color: #475569; transition: all 0.2s; font-size: 16px; }
        .q-amt:hover, .dial-key:hover { background: #3b82f6; color: white; border-color: #3b82f6; }
        .input-container { display:flex; gap: 10px; margin-bottom:15px; }
        #ebirr-val { width:100%; padding:12px; border: 1px solid #e2e8f0; border-radius:8px; font-size:18px; text-align:center; box-sizing: border-box; font-weight: bold; color: #1e293b; }
        #ebirr-val:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 8px rgba(59, 130, 246, 0.4); }
        #continue-btn { padding: 12px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 16px; }
        #continue-btn:hover { background: #2563eb; }
        h3 { margin: 0 0 10px 0; color: #1e293b; font-size: 20px; font-weight: 600; }
        .toggle-container { margin-bottom: 15px; display: flex; justify-content: center; align-items: center; }
        #mode-toggle { font-size: 12px; background: #e2e8f0; border: none; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
        #quick-amounts, #dial-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        #dial-pad { display: none; }
      </style>
      <h3>Enter Check Amount (ETB)</h3>
      <div class="input-container"><input type="number" id="ebirr-val" placeholder="0.00"><button id="continue-btn">Check</button></div>
      <div class="toggle-container"><button id="mode-toggle">Switch to Dial Pad</button></div>
      <div id="quick-amounts">${amounts.map(amt => `<button class="q-amt">${amt}</button>`).join('')}</div>
      <div id="dial-pad">${dialpadKeys.map(key => `<button class="dial-key">${key}</button>`).join('')}</div>
    `;
};

export const getStatusHtml = () => `
    <style>
      :host { position:fixed; top:20px; left:50%; transform: translateX(-50%); z-index:2147483647; font-family: 'Segoe UI', system-ui, sans-serif; }
      .container { background: white; border-radius: 50px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15); padding: 12px 24px; display: flex; align-items: center; gap: 15px; border: 1px solid #e2e8f0; min-width: 300px; }
      .loader { width: 20px; height: 20px; border: 3px solid #3b82f6; border-bottom-color: transparent; border-radius: 50%; display: inline-block; box-sizing: border-box; animation: rotation 1s linear infinite; }
      .text-content span { display: block; color: #1e293b; font-size: 15px; font-weight: 700; }
      .text-content small { color: #64748b; font-size: 12px; font-weight: 500; }
      #manual-btn { margin-left: auto; background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; }
      #manual-btn:hover { background: #e2e8f0; }
      @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
    <div class="container"><div class="loader"></div><div class="text-content"><span id="status-text">AI Extraction...</span><small>Scanning image for transaction ID.</small></div><button id="manual-btn">Manual</button></div>
`;

export const getDuplicateHtml = (id, date, status) => `
    <style>
      .card { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); width: 320px; text-align: center; border: 1px solid #f1f5f9; }
      h3 { margin: 0 0 10px 0; color: #f59e0b; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; }
      p { color: #475569; font-size:15px; line-height:1.6; margin: 5px 0; }
      .info-box { background: #fffbeb; padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid #fcd34d; text-align: left; }
      .info-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 13px; }
      .btn-primary { width: 100%; padding: 12px; background: #f59e0b; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.3); }
      .btn-primary:hover { background: #d97706; transform: translateY(-1px); }
      .btn-secondary { width: 100%; padding: 10px; background: transparent; color: #64748b; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px; margin-top: 8px; transition: all 0.2s; }
      .btn-secondary:hover { background: #f8fafc; color: #334155; }
    </style>
    <div class="card">
    <h3>Duplicate Found</h3><p>This transaction ID has been processed before.</p>
    <div class="info-box"><div class="info-row"><span style="color:#92400e">ID</span> <b>${id}</b></div><div class="info-row"><span style="color:#92400e">Date</span> <b>${date.split(',')[0]}</b></div><div class="info-row"><span style="color:#92400e">Status</span> <b>${status}</b></div></div>
    <button id="btn-copy-exit" class="btn-primary">Copy "${status}" & Exit</button><button id="btn-continue" class="btn-secondary">Check Anyway</button></div>
`;

export const getAiFailureHtml = () => `
    <style>
      .card { background: white; padding: 25px; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); width: 320px; text-align: center; border: 1px solid #f1f5f9; }
      h3 { margin: 0 0 10px 0; color: #ef4444; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; }
      p { color: #475569; font-size:14px; margin: 0 0 20px 0; line-height: 1.5; }
      button { width: 100%; padding: 12px; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.2s; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; }
      .btn-random { background: #f59e0b; color: white; } .btn-random:hover { background: #d97706; }
      .btn-manual { background: #3b82f6; color: white; } .btn-manual:hover { background: #2563eb; }
      .btn-close { background: white; color: #64748b; border: 1px solid #e2e8f0; } .btn-close:hover { background: #f8fafc; color: #334155; }
    </style>
    <div class="card"><h3>AI Scan Failed</h3><p>Could not detect a valid transaction ID. How would you like to proceed?</p>
    <button id="btn-random" class="btn-random">Copy "Random" & Exit</button><button id="btn-manual" class="btn-manual">Manual Entry</button><button id="btn-close" class="btn-close">Close</button></div>
`;

export const getResultOverlayHtml = (result, repeatCount) => {
    const { status, color, statusText, foundAmt, timeStr, senderName, senderPhone, foundName, nameOk, amtOk, timeOk } = result;
    const isSuccess = status === "Verified";
    return `
      <style>
        .modal { background: white; width: 360px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); overflow: hidden; border: 1px solid #e2e8f0; animation: slideDown 0.3s ease-out; }
        @keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .header { background: ${color}; padding: 16px 20px; color: white; display: flex; align-items: center; justify-content: space-between; }
        .header h2 { margin: 0; font-size: 18px; font-weight: 700; }
        .content { padding: 20px; }
        .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
        .row:last-child { border-bottom: none; }
        .label { color: #64748b; font-size: 14px; font-weight: 500; }
        .value { color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; }
        .check-icon { font-size: 16px; margin-left: 8px; }
        .sender-box { background: #f8fafc; border-radius: 8px; padding: 12px; margin-top: 15px; border: 1px solid #e2e8f0; }
        .sender-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
        .sender-label { color: #64748b; } .sender-val { color: #334155; font-weight: 600; }
        .actions { padding: 0 20px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
        button { width: 100%; padding: 12px; border-radius: 10px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #3b82f6; color: white; } .btn-primary:hover { background: #2563eb; }
        .btn-secondary { background: white; color: #64748b; border: 1px solid #e2e8f0; } .btn-secondary:hover { background: #f8fafc; color: #334155; }
        .value-name { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="header"><h2>${statusText}</h2></div>
      <div class="content">
        <div class="row"><span class="label">Amount</span><div style="display:flex; align-items:center;"><span class="value">${foundAmt} ETB</span><span class="check-icon">${amtOk ? '✅' : '❌'}</span></div></div>
        <div class="row"><span class="label">Count</span><div style="display:flex; align-items:center;"><span class="value">${(repeatCount || 0) + 1}</span></div></div>
        <div class="row"><span class="label">Recipient</span><div style="display:flex; align-items:center;"><span class="value value-name" title="${foundName}">${foundName}</span><span class="check-icon">${nameOk ? '✅' : '❌'}</span></div></div>
        <div class="row"><span class="label">Age</span><div style="display:flex; align-items:center;"><span class="value">${timeStr}</span><span class="check-icon">${timeOk ? '✅' : '❌'}</span></div></div>
        ${(senderName || senderPhone) ? `<div class="sender-box">${senderName ? `<div class="sender-row"><span class="sender-label">Sender:</span><span class="sender-val">${senderName}</span></div>` : ''}${senderPhone ? `<div class="sender-row"><span class="sender-label">Phone:</span><span class="sender-val">${senderPhone}</span></div>` : ''}</div>` : ''}
      </div>
      <div class="actions"><button id="btn-action" class="btn-primary">${isSuccess ? 'Exit' : `Copy "${status}" & Exit`}</button><button id="btn-continue" class="btn-secondary">Continue</button></div>
    `;
};

export const getRandomReviewHtml = (isPdf) => {
    const title = isPdf ? "📄 PDF Document" : "⚠️ Random Image Detected";
    const msg = isPdf ? "This is a PDF file. Please verify it manually." : "The AI thinks this image is random or invalid.";
    return `
      <h3 style="color:#ef4444; margin:0 0 10px 0; font-size:18px;">${title}</h3>
      <p style="color:#4b5563; font-size:14px; margin-bottom:20px; line-height:1.5;">${msg}</p>
      <div style="display:flex; gap:10px;">
          <button id="btn-cancel" style="flex:1; padding:10px; border:1px solid #d1d5db; background:white; border-radius:6px; cursor:pointer; font-weight:600; color:#4b5563;">Keep Open</button>
          <button id="btn-ok" style="flex:1; padding:10px; border:none; background:#ef4444; color:white; border-radius:6px; cursor:pointer; font-weight:600;">Reject & Close</button>
      </div>
    `;
};

export const getCustomConfirmHtml = (title, message, okText, cancelText) => `
    <style>
      h3 { margin: 0 0 10px 0; color: #1e293b; font-size: 18px; font-weight: 600; }
      p { color: #475569; font-size:15px; line-height:1.6; margin: 0 0 20px 0; }
      .btn-group { display: flex; gap: 10px; }
      button {
        flex: 1; padding: 12px; border: none; border-radius: 8px; 
        cursor: pointer; font-weight: 600; font-size: 14px;
        transition: opacity 0.2s;
      }
      #btn-ok { background: #3b82f6; color: white; }
      #btn-cancel { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    </style>
    <h3>${title}</h3>
    <p>${message}</p>
    <div class="btn-group">
      <button id="btn-cancel">${cancelText || 'Cancel'}</button>
      <button id="btn-ok">${okText || 'OK'}</button>
    </div>
`;

export const getCustomPromptHtml = (title, message) => `
    <style>
      h3 { margin: 0 0 10px 0; color: #1e293b; font-size: 18px; font-weight: 600; }
      p { color: #475569; font-size:15px; margin: 0 0 15px 0; }
      #prompt-input { 
        width: 100%; padding: 12px; border: 1px solid #e2e8f0; 
        border-radius: 8px; box-sizing: border-box; outline: none;
        font-size: 16px; text-align: center; margin-bottom: 20px;
      }
      #prompt-input:focus { border-color: #3b82f6; }
      .btn-group { display: flex; gap: 10px; }
      button {
        flex: 1; padding: 12px; border: none; border-radius: 8px; 
        cursor: pointer; font-weight: 600; font-size: 14px;
        transition: opacity 0.2s;
      }
      #btn-ok { background: #3b82f6; color: white; }
      #btn-cancel { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    </style>
    <h3>${title}</h3>
    <p>${message}</p>
    <input type="text" id="prompt-input" />
    <div class="btn-group">
      <button id="btn-cancel">Cancel</button>
      <button id="btn-ok">Submit</button>
    </div>
`;