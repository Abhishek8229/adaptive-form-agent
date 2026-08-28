export async function captureCroppedScreenshot(
  tabId: number,
  boundingBox: { x: number; y: number; width: number; height: number },
  padding = 150,
  maxDimension = 1024
): Promise<{ dataUrl: string; width: number; height: number; cropOffset: { x: number; y: number; scale: number } } | undefined> {
  try {
    // Determine windowId
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId === chrome.windows.WINDOW_ID_NONE) return undefined;
    
    // Capture visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    if (!dataUrl) return undefined;

    // Load image into OffscreenCanvas
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);

    // Calculate crop
    const imgW = imageBitmap.width;
    const imgH = imageBitmap.height;

    let cx = Math.max(0, boundingBox.x - padding);
    let cy = Math.max(0, boundingBox.y - padding);
    let cw = boundingBox.width + padding * 2;
    let ch = boundingBox.height + padding * 2;

    // Clamp to image dimensions
    if (cx + cw > imgW) cw = imgW - cx;
    if (cy + ch > imgH) ch = imgH - cy;

    // Scale down if it exceeds max dimension while preserving aspect ratio
    let targetW = cw;
    let targetH = ch;
    if (targetW > maxDimension || targetH > maxDimension) {
      if (targetW > targetH) {
        targetH = Math.round(targetH * (maxDimension / targetW));
        targetW = maxDimension;
      } else {
        targetW = Math.round(targetW * (maxDimension / targetH));
        targetH = maxDimension;
      }
    }

    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(imageBitmap, cx, cy, cw, ch, 0, 0, targetW, targetH);

    const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          dataUrl: reader.result as string,
          width: targetW, height: targetH, cropOffset: { x: cx, y: cy, scale: targetW / cw }
        });
      };
      reader.readAsDataURL(croppedBlob);
    });

  } catch (e) {
    console.error('Failed to capture cropped screenshot', e);
    return undefined;
  }
}
