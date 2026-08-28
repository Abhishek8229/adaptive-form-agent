export interface OCRRequest {
  screenshot: string; // base64 jpeg
  nearbyText?: string;
}

export interface OCRRegion {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRResponse {
  text: string;
  confidence: number;
  regions?: OCRRegion[];
}

export interface OCRProvider {
  extractText(req: OCRRequest): Promise<OCRResponse>;
}

export interface LocalOCRProviderOptions {
  endpoint?: string;
  timeoutMs?: number;
}

function parseRegions(input: any): OCRRegion[] | undefined {
  if (!Array.isArray(input)) return undefined;
  
  const regions: OCRRegion[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    
    const text = item.text;
    const conf = item.confidence;
    const x = item.x;
    const y = item.y;
    const w = item.width;
    const h = item.height;
    
    if (typeof text !== 'string' || text.trim() === '') continue;
    if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) continue;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) continue;
    if (typeof y !== 'number' || !Number.isFinite(y) || y < 0) continue;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) continue;
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) continue;
    
    regions.push({
      text: text.trim(),
      confidence: conf,
      x,
      y,
      width: w,
      height: h
    });
  }
  
  return regions.length > 0 ? regions : undefined;
}

export class LocalOCRProvider implements OCRProvider {
  private endpoint: string;
  private timeoutMs: number;

  constructor(options: LocalOCRProviderOptions = {}) {
    this.endpoint = options.endpoint || 'http://127.0.0.1:11434/api/ocr';
    this.timeoutMs = options.timeoutMs || 5000;
  }

  async extractText(req: OCRRequest): Promise<OCRResponse> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: req.screenshot,
          context: req.nearbyText,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return { text: '', confidence: 0 };
      }

      const data = await res.json();
      
      let parsed = data;
      if (typeof data.response === 'string') {
        try {
          const cleaned = data.response.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          return { text: '', confidence: 0 };
        }
      }

      if (!parsed || typeof parsed !== 'object') {
        return { text: '', confidence: 0 };
      }
      
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;
      
      if (confidence < 0.5) {
        return { text: '', confidence: 0 };
      }

      const validRegions = parseRegions(parsed.regions);

      return { text, confidence, regions: validRegions };
    } catch (e) {
      return { text: '', confidence: 0 };
    }
  }
}

export function selectBestOCRRegion(
  regions: OCRRegion[],
  _imageWidth: number,
  _imageHeight: number,
  fieldX: number,
  fieldY: number
): OCRRegion | undefined {
  if (!regions || regions.length === 0) return undefined;
  const fieldCenterX = Math.min(fieldX, 150) + 10;
  const fieldCenterY = Math.min(fieldY, 150) + 10;
  let bestRegion: OCRRegion | undefined = undefined;
  let bestScore = -Infinity;
  for (const r of regions) {
    const regionCenterX = r.x + r.width / 2;
    const regionCenterY = r.y + r.height / 2;
    const dx = regionCenterX - fieldCenterX;
    const dy = regionCenterY - fieldCenterY;
    const distancePenalty = Math.sqrt(dx * dx + dy * dy);
    const lengthBonus = Math.min(r.text.length, 50) * 2;
    let score = (1500 - distancePenalty) * r.confidence + lengthBonus;
    if (score > bestScore) {
      bestScore = score;
      bestRegion = r;
    }
  }
  return bestRegion;
}
