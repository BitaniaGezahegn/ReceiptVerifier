
function startCropper() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'ebirr-cropper-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.background = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '2147483647';
        overlay.style.cursor = 'crosshair';
        document.body.appendChild(overlay);

        const selectionBox = document.createElement('div');
        selectionBox.style.position = 'absolute';
        selectionBox.style.border = '2px dashed #fff';
        selectionBox.style.background = 'rgba(255, 255, 255, 0.2)';
        selectionBox.style.display = 'none';
        overlay.appendChild(selectionBox);

        let startX, startY, isDrawing = false;

        overlay.addEventListener('mousedown', (e) => {
            isDrawing = true;
            startX = e.clientX;
            startY = e.clientY;
            selectionBox.style.left = startX + 'px';
            selectionBox.style.top = startY + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
        });

        overlay.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            const width = e.clientX - startX;
            const height = e.clientY - startY;
            selectionBox.style.width = Math.abs(width) + 'px';
            selectionBox.style.height = Math.abs(height) + 'px';
            selectionBox.style.left = (width > 0 ? startX : e.clientX) + 'px';
            selectionBox.style.top = (height > 0 ? startY : e.clientY) + 'px';
        });

        overlay.addEventListener('mouseup', (e) => {
            if (!isDrawing) return;
            isDrawing = false;
            const rect = {
                x: parseInt(selectionBox.style.left),
                y: parseInt(selectionBox.style.top),
                width: parseInt(selectionBox.style.width),
                height: parseInt(selectionBox.style.height)
            };
            overlay.remove();
            
            // Resolve with rect, but add devicePixelRatio for high-res screens
            resolve({
                x: rect.x * window.devicePixelRatio,
                y: rect.y * window.devicePixelRatio,
                width: rect.width * window.devicePixelRatio,
                height: rect.height * window.devicePixelRatio,
            });
        });
    });
}

startCropper().then(rect => {
    chrome.runtime.sendMessage({ action: 'captureCropped', rect: rect });
});
