// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\utils\image_processor.js
export function processImageLocally(dataUrl, applyFilters = false) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const slices = [];
            const aspectRatio = img.height / img.width;

            // Tall Image Detection (Height > 2.5x Width) - Fix for "Squished Text"
            if (aspectRatio > 2.5) {
                const sliceHeight = img.width; // Make slices square-ish
                const overlap = sliceHeight * 0.2; // 20% overlap
                let y = 0;

                while (y < img.height) {
                    let sh = sliceHeight;
                    if (y + sh > img.height) sh = img.height - y;
                    
                    slices.push(processCanvas(img, 0, y, img.width, sh, applyFilters));
                    
                    if (y + sh >= img.height) break;
                    y += (sliceHeight - overlap);
                }
            } else {
                slices.push(processCanvas(img, 0, 0, img.width, img.height, applyFilters));
            }
            resolve(slices);
        };
        img.onerror = () => resolve([]);
        img.src = dataUrl;
    });
}

function processCanvas(img, sx, sy, sw, sh, applyFilters) {
    const canvas = document.createElement('canvas');
    const maxDim = 2048; 
    let width = sw; let height = sh;
    
    if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } 
    else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
    
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    
    if (applyFilters) ctx.filter = 'grayscale(1) contrast(1.2)';
    
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.95);
}
