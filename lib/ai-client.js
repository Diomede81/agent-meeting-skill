/**
 * AI Client
 * Calls AI providers for completions
 * Uses token-manager to get API keys, provider-agnostic
 */

class AIClient {
  constructor(options = {}) {
    this.tokenManagerUrl = options.tokenManagerUrl || 'http://localhost:3021';
    this.timeout = options.timeout || 60000; // 60 seconds
    this.model = options.model || 'gpt-4o-mini'; // Fast and cheap for summaries
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
      
      // Get the actual value
      const valueRes = await fetch(`${this.tokenManagerUrl}/api/tokens/${token.id}/value`);
      const valueData = await valueRes.json();
      return valueData.value || null;
    } catch (e) {
      console.error(`Failed to get ${service} API key:`, e.message);
      return null;
    }
  }

  /**
   * Generate a completion using OpenAI
   * @param {string} prompt - The prompt to send
   * @param {object} options - Optional settings
   * @returns {Promise<string>} - The AI response
   */
  async complete(prompt, options = {}) {
    const { maxTokens = 2000 } = options;
    
    // Get OpenAI API key from token manager
    const apiKey = await this.getApiKey('OpenAI');
    if (!apiKey) {
      throw new Error('OpenAI API key not found in token-manager. Add it with service "OpenAI".');
    }
    
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
          temperature: 0.3 // Lower temperature for more consistent structured output
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
      throw new Error(`AI completion failed: ${error.message}`);
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
