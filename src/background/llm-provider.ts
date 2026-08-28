export interface LLMMatchResult {
  profileKey: string | null;
  confidence: number;
  reason?: string;
}

export interface LLMProviderInput {
  semanticContext?: string;
  controlType: string;
  questionIntent?: string;
  candidateKeys: string[];
}

export interface LocalLLMProvider {
  matchProfileKey(input: LLMProviderInput): Promise<LLMMatchResult>;
}

export class MockLLMProvider implements LocalLLMProvider {
  async matchProfileKey(input: LLMProviderInput): Promise<LLMMatchResult> {
    const { semanticContext, candidateKeys } = input;
    if (!semanticContext) return { profileKey: null, confidence: 0, reason: 'no context' };

    const lower = semanticContext.toLowerCase();
    
    // Very simple mock behavior for tests
    if (lower.includes('llm test match') && candidateKeys.includes('llmMatchedKey')) {
      return { profileKey: 'llmMatchedKey', confidence: 0.95, reason: 'mock test match' };
    }
    
    return { profileKey: null, confidence: 0, reason: 'abstain' };
  }
}

export interface OllamaConfig {
  endpoint?: string;
  model?: string;
  confidenceThreshold?: number;
}

export class OllamaLLMProvider implements LocalLLMProvider {
  private endpoint: string;
  private model: string;
  private threshold: number;

  constructor(config: OllamaConfig = {}) {
    this.endpoint = config.endpoint || 'http://127.0.0.1:11434';
    this.model = config.model || 'llama3';
    this.threshold = config.confidenceThreshold ?? 0.8;
  }

  async matchProfileKey(input: LLMProviderInput): Promise<LLMMatchResult> {
    const abstain = (reason: string): LLMMatchResult => ({ profileKey: null, confidence: 0, reason });

    if (!input.candidateKeys || input.candidateKeys.length === 0) {
      return abstain('No candidate keys');
    }

    const prompt = `You are a strict data-matching assistant.
Your task is to match a form field question to exactly ONE of the provided profile keys, or output null if none match perfectly.

Field Context: "${input.semanticContext || ''}"
Control Type: ${input.controlType}
${input.questionIntent ? `Question Intent: ${input.questionIntent}` : ''}

Candidate Keys:
${input.candidateKeys.map(k => `- ${k}`).join('\n')}

Output ONLY valid JSON matching this schema:
{
  "profileKey": "matched_key_here_or_null",
  "confidence": 0.95
}
Do not write any other text. No explanations.`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 sec timeout

      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return abstain(`HTTP error: ${res.status}`);
      }

      const data = await res.json();
      const responseText = data.response;

      if (!responseText) {
        return abstain('Empty response');
      }

      // Defensive parsing (strip markdown fences if model ignored "format: json")
      let cleanText = responseText.trim();
      if (cleanText.startsWith('\`\`\`json')) {
        cleanText = cleanText.substring(7);
      } else if (cleanText.startsWith('\`\`\`')) {
        cleanText = cleanText.substring(3);
      }
      if (cleanText.endsWith('\`\`\`')) {
        cleanText = cleanText.substring(0, cleanText.length - 3);
      }
      cleanText = cleanText.trim();

      const parsed = JSON.parse(cleanText);

      if (typeof parsed.profileKey !== 'string') {
        return abstain('profileKey missing or not string');
      }

      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      if (confidence < this.threshold) {
        return abstain(`Low confidence: ${confidence}`);
      }

      if (!input.candidateKeys.includes(parsed.profileKey)) {
        return abstain('Model hallucinated invalid key');
      }

      return {
        profileKey: parsed.profileKey,
        confidence,
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return abstain('Timeout');
      }
      return abstain(`Error: ${e.message}`);
    }
  }
}
