
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
        chrome.runtime.sendMessage({ action: 'initiateScreenshot' });
    });
}

function init() {
    if (isImagePage()) {
        // Prevent adding the button if it's already there
        if (!document.getElementById('ebirr-screenshot-button')) {
            createScreenshotButton();
        }
    }
}

// Run the checks immediately and after load to catch all cases
init();
window.addEventListener('load', init);
// Also watch for DOM changes in case the viewer loads dynamically
new MutationObserver(init).observe(document.body, { childList: true, subtree: true });
