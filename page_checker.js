
function isImagePage() {
    const url = window.location.href;
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;

    // Check if the URL ends with an image extension
    if (imageExtensions.test(url)) {
        return true;
    }

    // Check if the page is just a single image element (Chrome's default image viewer)
    if (document.body && document.body.children.length === 1 && document.body.children[0].tagName === 'IMG') {
        return true;
    }
    
    return false;
}

function createScreenshotButton() {
    const button = document.createElement('button');
    button.id = 'ebirr-screenshot-button';
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.zIndex = '2147483646';
    button.style.background = 'rgba(0, 0, 0, 0.6)';
    button.style.color = 'white';
    button.style.border = '2px solid white';
    button.style.borderRadius = '50%';
    button.style.width = '50px';
    button.style.height = '50px';
    button.style.fontSize = '24px';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4)';
    button.style.transition = 'all 0.2s';
    button.innerHTML = '📷';
    button.title = 'Take a screenshot (Ctrl+Shift+S)';

    button.onmouseover = () => {
        button.style.background = 'rgba(0, 0, 0, 0.8)';
        button.style.transform = 'scale(1.1)';
    };
    button.onmouseout = () => {
        button.style.background = 'rgba(0, 0, 0, 0.6)';
        button.style.transform = 'scale(1)';
    };
    
    document.body.appendChild(button);

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id) {
            chrome.runtime.sendMessage({ action: 'initiateScreenshot' });
        } else {
            alert("Ebirr Verifier: Extension updated or reloaded. Please refresh this page to use the tool.");
            button.style.display = 'none';
        }
    });
}

/**
 * Telebirr Receipt Extraction Logic
 * Runs when this script is loaded inside a Telebirr receipt page (even in an iframe)
 */
function handleTelebirrExtraction() {
    if (!window.location.href.includes('transactioninfo.ethiotelecom.et')) return;

    const extract = () => {
        const fullText = document.body ? document.body.innerText : "";
        const findValue = (label) => {
            const regex = new RegExp(`${label}\\s*[:]?\\s*([^\\n\\r]+)`, 'i');
            const match = fullText.match(regex);
            return match ? match[1].trim() : null;
        };

        const recipient = findValue("Credited Party name") || findValue("የገንዘብ ተቀባይ ስም");
        const amount = findValue("Settled Amount") || findValue("የተከፈለው መጠን");

        if (recipient && amount) {
            return {
                recipient,
                senderName: findValue("Payer Name") || findValue("የከፋይ ስም"),
                senderPhone: findValue("Payer Number") || findValue("የከፋይ ስልክ ቁጥር"),
                date: findValue("Transaction Date") || findValue("የግብይት ቀን"),
                amount,
                reason: findValue("Remark") || ""
            };
        }
        return null;
    };

    // 1. Try immediate extraction
    const initialData = extract();
    if (initialData) {
        chrome.runtime.sendMessage({ action: 'telebirr_data_extracted', url: window.location.href, data: initialData });
        return;
    }

    // 2. Use MutationObserver to wait for the dynamic table to load
    const observer = new MutationObserver((mutations, obs) => {
        const data = extract();
        if (data) {
            obs.disconnect();
            chrome.runtime.sendMessage({ action: 'telebirr_data_extracted', url: window.location.href, data: data });
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Safety: disconnect after 25s
    setTimeout(() => observer.disconnect(), 25000);
}

function init() {
    if (isImagePage()) {
        // Prevent adding the button if it's already there
        if (!document.getElementById('ebirr-screenshot-button')) {
            createScreenshotButton();
        }
    }

    // If we are on a Telebirr receipt page, start extraction
    if (window.location.host.includes('ethiotelecom.et')) {
        handleTelebirrExtraction();
    }
}

// Run the checks immediately and after load to catch all cases
init();
window.addEventListener('load', init);
// Also watch for DOM changes in case the viewer loads dynamically
new MutationObserver(init).observe(document.body, { childList: true, subtree: true });
