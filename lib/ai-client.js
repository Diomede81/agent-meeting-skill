/**
 * AI Client
 * Calls AI providers for completions
 * Uses token-manager to get API keys, supports OpenAI and Anthropic
 */

// Provider configurations
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    tokenService: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast, cheap)' },
      { id: 'gpt-4o', name: 'GPT-4o (balanced)' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (powerful)' },
      { id: 'o1-mini', name: 'o1 Mini (reasoning)' },
      { id: 'o1', name: 'o1 (advanced reasoning)' }
    ],
    defaultModel: 'gpt-4o-mini'
  },
  anthropic: {
    name: 'Anthropic',
    tokenService: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    models: [
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku (fast, cheap)' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (balanced)' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (powerful)' }
    ],
    defaultModel: 'claude-3-5-haiku-latest'
  }
};

class AIClient {
  constructor(options = {}) {
    this.tokenManagerUrl = options.tokenManagerUrl || 'http://localhost:3021';
    this.timeout = options.timeout || 60000;
    this.provider = options.provider || 'openai';
    this.model = options.model || PROVIDERS[this.provider]?.defaultModel || 'gpt-4o-mini';
  }

  /**
   * Get available providers (those with API keys in token-manager)
   */
  static async getAvailableProviders(tokenManagerUrl = 'http://localhost:3021') {
    const available = [];
    
    try {
      const response = await fetch(`${tokenManagerUrl}/api/tokens`);
      const data = await response.json();
      const tokens = data.tokens || [];
      
      for (const [providerId, config] of Object.entries(PROVIDERS)) {
        const hasKey = tokens.some(t => 
          t.service === config.tokenService && t.hasValue
        );
        
        available.push({
          id: providerId,
          name: config.name,
          available: hasKey,
          models: config.models,
          defaultModel: config.defaultModel
        });
      }
    } catch (e) {
      console.error('Failed to check available providers:', e.message);
      // Return all providers but mark as unavailable
      for (const [providerId, config] of Object.entries(PROVIDERS)) {
        available.push({
          id: providerId,
          name: config.name,
          available: false,
          models: config.models,
          defaultModel: config.defaultModel
        });
      }
    }
    
    return available;
  }

  /**
   * Get API key from token manager
   */
  async getApiKey(service) {
    try {
      const response = await fetch(`${this.tokenManagerUrl}/api/tokens`);
      const data = await response.json();
      const token = data.tokens?.find(t => t.service === service);
      
      if (!token?.id) {
        return null;
      }
      
      const valueRes = await fetch(`${this.tokenManagerUrl}/api/tokens/${token.id}/value`);
      const valueData = await valueRes.json();
      return valueData.value || null;
    } catch (e) {
      console.error(`Failed to get ${service} API key:`, e.message);
      return null;
    }
  }

  /**
   * Generate a completion using configured provider
   */
  async complete(prompt, options = {}) {
    const { maxTokens = 2000 } = options;
    const providerConfig = PROVIDERS[this.provider];
    
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${this.provider}. Use 'openai' or 'anthropic'.`);
    }
    
    const apiKey = await this.getApiKey(providerConfig.tokenService);
    if (!apiKey) {
      throw new Error(`${providerConfig.name} API key not found in token-manager. Add it with service "${providerConfig.tokenService}".`);
    }
    
    if (this.provider === 'anthropic') {
      return this.completeAnthropic(prompt, apiKey, maxTokens);
    } else {
      return this.completeOpenAI(prompt, apiKey, maxTokens);
    }
  }

  /**
   * OpenAI completion
   */
  async completeOpenAI(prompt, apiKey, maxTokens) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${error.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error('AI completion timed out');
      }
      throw new Error(`OpenAI completion failed: ${error.message}`);
    }
  }

  /**
   * Anthropic completion
   */
  async completeAnthropic(prompt, apiKey, maxTokens) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Anthropic API error: ${response.status} - ${error.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      return data.content?.[0]?.text || '';
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error('AI completion timed out');
      }
      throw new Error(`Anthropic completion failed: ${error.message}`);
    }
  }

  /**
   * Generate meeting summary from transcript
   * @param {string} prompt - The summarization prompt (includes transcript)
   * @returns {Promise<object>} - Parsed summary object
   */
  async generateSummary(prompt) {
    const response = await this.complete(prompt);
    
    // Parse JSON response
    let summary = this.parseJsonResponse(response);
    
    // If parsing failed, return a basic structure with the raw response
    if (!summary.overview && !summary.actionItems?.length) {
      summary = {
        overview: response.substring(0, 500),
        actionItems: [],
        speakerHighlights: [],
        decisions: [],
        followUps: [],
        _raw: response,
        _parseError: true
      };
    }
    
    return summary;
  }

  /**
   * Parse JSON from AI response
   */
  parseJsonResponse(response) {
    const defaultSummary = {
      overview: '',
      actionItems: [],
      speakerHighlights: [],
      decisions: [],
      followUps: []
    };

    if (!response || typeof response !== 'string') {
      return defaultSummary;
    }

    // Clean up response - remove markdown code blocks if present
    let cleaned = response.trim();
    
    // Remove ```json ... ``` wrapper
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    
    // Find JSON object boundaries
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return defaultSummary;
    }

    const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

    try {
      const parsed = JSON.parse(jsonStr);
      
      return {
        overview: typeof parsed.overview === 'string' ? parsed.overview : '',
        actionItems: this.normalizeActionItems(parsed.actionItems),
        speakerHighlights: this.normalizeSpeakerHighlights(parsed.speakerHighlights),
        decisions: this.normalizeStringArray(parsed.decisions),
        followUps: this.normalizeStringArray(parsed.followUps)
      };
    } catch (e) {
      console.error('Failed to parse JSON response:', e.message);
      return defaultSummary;
    }
  }

  normalizeActionItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
      if (typeof item === 'string') {
        return { action: item, assignee: null, deadline: null };
      }
      return {
        action: typeof item.action === 'string' ? item.action : String(item.action || ''),
        assignee: item.assignee || null,
        deadline: item.deadline || null
      };
    }).filter(item => item.action);
  }

  normalizeSpeakerHighlights(highlights) {
    if (!Array.isArray(highlights)) return [];
    return highlights.map(h => ({
      name: typeof h.name === 'string' ? h.name : 'Unknown',
      points: Array.isArray(h.points) ? h.points.filter(p => typeof p === 'string') : []
    })).filter(h => h.points.length > 0);
  }

  normalizeStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => typeof item === 'string' && item.trim()).map(s => s.trim());
  }
}

module.exports = { AIClient };
