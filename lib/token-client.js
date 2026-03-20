/**
 * Token Manager Client
 * 
 * Integrates with token-manager-skill for credential management.
 * Follows the pattern: metadata in registry, secrets in ~/.secrets/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';
const SECRETS_DIR = process.env.SECRETS_DIR || path.join(os.homedir(), '.secrets');

class TokenClient {
  constructor(tokenManagerUrl = TOKEN_MANAGER_URL) {
    this.baseUrl = tokenManagerUrl;
    this.secretsDir = SECRETS_DIR;
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
   * Get a token value by reading from its registered location
   */
  async get(service) {
    const token = await this.search(service);
    if (!token) {
      return null;
    }

    return this.readTokenValue(token);
  }

  /**
   * Read token value from its location
   */
  readTokenValue(token) {
    const { locationType, location } = token;

    switch (locationType) {
      case 'file':
        return this.readFromFile(location);
      case 'env':
        return process.env[location] || null;
      case 'database':
        // Not implemented - would need db connection
        console.warn('Database token storage not yet supported');
        return null;
      default:
        // Default to file if locationType not specified
        return this.readFromFile(location);
    }
  }

  /**
   * Read token from file (supports ~ expansion and .age encrypted files)
   */
  readFromFile(location) {
    // Expand ~ to home directory
    let filePath = location.replace(/^~/, os.homedir());
    
    // Handle relative paths
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(this.secretsDir, filePath);
    }

    try {
      // Check if it's an encrypted .age file
      if (filePath.endsWith('.age')) {
        return this.readAgeFile(filePath);
      }

      // Plain text file
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (e) {
      console.error(`Failed to read token from ${filePath}: ${e.message}`);
      return null;
    }
  }

  /**
   * Read age-encrypted file
   */
  readAgeFile(filePath) {
    const { execSync } = require('child_process');
    const keyPath = path.join(os.homedir(), '.age', 'key.txt');

    try {
      const result = execSync(`age -d -i "${keyPath}" "${filePath}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Try to parse as JSON (common for token files)
      try {
        return JSON.parse(result.trim());
      } catch {
        return result.trim();
      }
    } catch (e) {
      console.error(`Failed to decrypt ${filePath}: ${e.message}`);
      return null;
    }
  }

  /**
   * Check if a token exists in the registry
   */
  async has(service) {
    const token = await this.search(service);
    return token !== null;
  }

  /**
   * Verify a token exists and is readable
   */
  async verify(service) {
    const token = await this.search(service);
    if (!token) {
      return { success: false, error: 'Token not found in registry' };
    }

    const value = this.readTokenValue(token);
    if (!value) {
      return { success: false, error: 'Token file not readable' };
    }

    return { success: true, location: token.location };
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
        name: 'API Key',
        category: 'api',
        locationType: 'file',
        location: '~/.secrets/recall-api-key.txt',
        notes: 'Required for meeting bot functionality'
      }
    ];
  }

  /**
   * Check if all required tokens are configured
   */
  async checkRequiredTokens() {
    const required = TokenClient.getRequiredTokens();
    const results = [];

    for (const token of required) {
      const found = await this.search(token.service);
      const value = found ? this.readTokenValue(found) : null;
      
      results.push({
        service: token.service,
        registered: !!found,
        readable: !!value,
        location: found?.location || token.location
      });
    }

    return {
      allConfigured: results.every(r => r.registered && r.readable),
      tokens: results
    };
  }
}

module.exports = { TokenClient };
