export interface VisionResult {
  profileKey: string | null;
  confidence: number;
  visualContext?: string;
  reason?: string;
}

export interface VisionProviderInput {
  semanticContext?: string;
  controlType: string;
  candidateKeys: string[];
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  visibility?: 'visible' | 'partially-visible' | 'outside-viewport' | 'hidden';
  screenshot?: { dataUrl: string; width: number; height: number };
}

export interface VisionProvider {
  analyzeField(input: VisionProviderInput): Promise<VisionResult>;
}

export class MockVisionProvider implements VisionProvider {
  async analyzeField(input: VisionProviderInput): Promise<VisionResult> {
    const { semanticContext, candidateKeys } = input;
    if (!semanticContext) return { profileKey: null, confidence: 0, reason: 'no context' };

    const lower = semanticContext.toLowerCase();
    
    // Simple mock behavior for tests
    if (lower.includes('vision test match') && candidateKeys.includes('visionMatchedKey')) {
      return { profileKey: 'visionMatchedKey', confidence: 0.95, visualContext: 'Mock OCR text', reason: 'mock test match' };
    }
    
    return { profileKey: null, confidence: 0, reason: 'abstain' };
  }
}

export interface LocalVisionProviderConfig {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
}

export class LocalVisionProvider implements VisionProvider {
  private endpoint: string;
  private model: string;
  private timeoutMs: number;

  constructor(config: LocalVisionProviderConfig = {}) {
    this.endpoint = config.endpoint || 'http://127.0.0.1:11434/api/generate';
    this.model = config.model || 'llava';
    this.timeoutMs = config.timeoutMs || 15000;
  }

  async analyzeField(input: VisionProviderInput): Promise<VisionResult> {
    const { candidateKeys, semanticContext, controlType, nearbyText, screenshot } = input;
    if (candidateKeys.length === 0) {
      return { profileKey: null, confidence: 0, reason: 'no_candidates' };
    }

    if (!screenshot || !screenshot.dataUrl) {
      return { profileKey: null, confidence: 0, reason: 'no_image_provided' };
    }

    // Strip prefix from dataUrl if it exists
    const base64Image = screenshot.dataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    const keysList = candidateKeys.map(k => `"${k}"`).join(', ');
    const prompt = `You are an accessibility agent identifying form fields from an image crop.
The field is a ${controlType}.
Semantic context: ${semanticContext || 'none'}.
Nearby text: ${nearbyText || 'none'}.

Available keys: [${keysList}].

Select the ONE key from the list that matches the field in the image.
You MUST output ONLY valid JSON in this exact format, with no markdown formatting or explanation:
{
  "profileKey": "chosenKey",
  "confidence": 0.95
}
If no key matches, output:
{
  "profileKey": null,
  "confidence": 0
}`;

    try {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), this.timeoutMs);

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          images: [base64Image]
        }),
        signal: abort.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return { profileKey: null, confidence: 0, reason: `http_error_${res.status}` };
      }

      const data = await res.json();
      const rawText = (data.response || '').trim();

      // Attempt to clean markdown wrapper if present
      let jsonStr = rawText;
      if (jsonStr.startsWith('```')) {
        const lines = jsonStr.split('\n');
        if (lines[0].startsWith('```')) lines.shift();
        if (lines[lines.length - 1].startsWith('```')) lines.pop();
        jsonStr = lines.join('\n').trim();
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed || typeof parsed !== 'object') {
        return { profileKey: null, confidence: 0, reason: 'invalid_json_shape' };
      }

      if (parsed.profileKey && !candidateKeys.includes(parsed.profileKey)) {
        return { profileKey: null, confidence: 0, reason: 'hallucinated_key' };
      }

      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0.8) {
        return { profileKey: null, confidence: parsed.confidence || 0, reason: 'low_confidence' };
      }

      return {
        profileKey: parsed.profileKey,
        confidence: parsed.confidence
      };

    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        return { profileKey: null, confidence: 0, reason: 'timeout' };
      }
      return { profileKey: null, confidence: 0, reason: 'network_error' };
    }
  }
}
