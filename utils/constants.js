// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\utils\constants.js
export const SELECTORS = {
    headerRow: 'tr[name="table-header"]',
    row: '.table-vertical table tr:not(.table-head):not(.total-row)',
    tableContainer: '.table-vertical',
    amount: 'td.text-right span',
    imageLink: 'a[href*="WebUserDocuments"]',
    
    columnHeaders: {
        confirm: 'Confirm',
        reject: 'Reject',
    },
    
    modal: '.modal.modal_min',
    modalContent: '.modal_content',
    modalInputAmount: 'input[placeholder="Amount"]',
    modalInputComment: 'input[placeholder="Comment"]',
    modalBtnConfirm: '.modal_content button.btn-success',
    modalBtnCancel: '.modal_content button.btn-default',
    modalBtnReject: '.modal_content button.btn-danger'
};

export const BANK_XPATHS = {
    recipient: '//*[@id="invoice"]/table[1]/tbody/tr[4]/td/table/tbody/tr/td[2]/table/tbody/tr[2]/td',
    reason: '//*[@id="invoice"]/table[1]/tbody/tr[6]/td/table/tbody/tr[3]/td[2]',
    date: '//*[@id="invoice"]/table[1]/tbody/tr[3]/td/table/tbody/tr[1]/td[3]',
    amount: '//*[@id="invoice"]/table[1]/tbody/tr[3]/td/table/tbody/tr[3]/td[3]/strong[2]',
    senderName: '//*[@id="invoice"]/table[1]/tbody/tr[4]/td/table/tbody/tr/td[1]/table/tbody/tr[2]/td',
    senderPhone: '//*[@id="invoice"]/table[1]/tbody/tr[4]/td/table/tbody/tr/td[1]/table/tbody/tr[4]/td'
};

export const TIMEOUT_MS = 30000;
export const MAX_CONCURRENCY = 1;

export const SPEED_CONFIG = {
    very_slow: { batchDelay: 5000, modalPoll: 500, rowPoll: 1000, autoClickTimer: 5 },
    slow:      { batchDelay: 3500, modalPoll: 300, rowPoll: 800,  autoClickTimer: 4 },
    normal:    { batchDelay: 3000, modalPoll: 200, rowPoll: 500,  autoClickTimer: 3 },
    fast:      { batchDelay: 1500, modalPoll: 100, rowPoll: 300,  autoClickTimer: 1 },
    very_fast: { batchDelay: 500,  modalPoll: 50,  rowPoll: 100,  autoClickTimer: 0 }
};
