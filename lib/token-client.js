/**
 * Token Manager Client
 * 
 * Integrates with token-manager-skill for credential management.
 * Token values are stored in the token-manager's SQLite database.
 */

const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';

class TokenClient {
  constructor(tokenManagerUrl = TOKEN_MANAGER_URL) {
    this.baseUrl = tokenManagerUrl;
  }

  /**
   * Search for a token in the registry
   */
  async search(service) {
    try {
      const res = await fetch(`${this.baseUrl}/api/search?q=${encodeURIComponent(service)}`);
      const data = await res.json();
      return data.found ? data.token : null;
    } catch (e) {
      console.error(`Token manager search failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Get a token value from the database
   */
  async get(service) {
    try {
      // First search to find the token
      const token = await this.search(service);
      if (!token) {
        return null;
      }

      // Then get the actual value via /api/tokens/:id/value
      const res = await fetch(`${this.baseUrl}/api/tokens/${token.id}/value`);
      if (!res.ok) {
        console.error(`Failed to get token value: ${res.status}`);
        return null;
      }

      const data = await res.json();
      return data.value || null;
    } catch (e) {
      console.error(`Token manager get failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Get token value by name directly (faster)
   */
  async getByName(name) {
    try {
      const res = await fetch(`${this.baseUrl}/api/lookup/${encodeURIComponent(name)}`);
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      return data.value || null;
    } catch (e) {
      console.error(`Token lookup failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Check if a token exists in the registry
   */
  async has(service) {
    const token = await this.search(service);
    return token !== null && token.hasValue;
  }

  /**
   * Verify a token exists and has a value
   */
  async verify(service) {
    const token = await this.search(service);
    if (!token) {
      return { success: false, error: 'Token not found in registry' };
    }

    if (!token.hasValue) {
      return { success: false, error: 'Token registered but no value stored' };
    }

    // Try to actually get the value to confirm it's readable
    const value = await this.get(service);
    if (!value) {
      return { success: false, error: 'Token value not readable' };
    }

    return { success: true, service: token.service, id: token.id };
  }

  /**
   * List all tokens (metadata only)
   */
  async list() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tokens`);
      const data = await res.json();
      return data.tokens || [];
    } catch (e) {
      console.error(`Failed to list tokens: ${e.message}`);
      return [];
    }
  }

  /**
   * Check if token manager is available
   */
  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get required tokens for this skill
   */
  static getRequiredTokens() {
    return [
      {
        service: 'Recall.ai',
        name: 'RECALL_API_KEY',
        category: 'api',
        description: 'Meeting bot API - required for joining meetings and transcription'
      }
    ];
  }

  /**
   * Check if all required tokens are configured
   */
  async checkRequiredTokens() {
    const required = TokenClient.getRequiredTokens();
    const results = [];

    for (const req of required) {
      const token = await this.search(req.service);
      
      results.push({
        service: req.service,
        registered: !!token,
        hasValue: token?.hasValue || false,
        status: token?.status || 'unknown'
      });
    }

    return {
      allConfigured: results.every(r => r.registered && r.hasValue),
      tokens: results
    };
  }
}

module.exports = { TokenClient };
