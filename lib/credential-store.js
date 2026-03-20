/**
 * Credential Store
 * Encrypted storage for API keys and secrets
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple encryption for local storage
// In production, use age encryption or a proper secrets manager
const ALGORITHM = 'aes-256-gcm';

class CredentialStore {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.credPath = path.join(this.dataDir, 'credentials.json');
    this.keyPath = path.join(this.dataDir, '.key');
    
    this.ensureKey();
  }

  /**
   * Ensure encryption key exists
   */
  ensureKey() {
    if (!fs.existsSync(this.keyPath)) {
      const key = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(this.keyPath, key, { mode: 0o600 });
    }
  }

  getKey() {
    return Buffer.from(fs.readFileSync(this.keyPath, 'utf8'), 'hex');
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = this.getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    };
  }

  decrypt(encrypted) {
    const key = this.getKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Load all credentials (internal use)
   */
  loadAll() {
    if (!fs.existsSync(this.credPath)) {
      return {};
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(this.credPath, 'utf8'));
      const decrypted = {};
      
      for (const [name, encrypted] of Object.entries(data)) {
        decrypted[name] = this.decrypt(encrypted);
      }
      
      return decrypted;
    } catch (e) {
      console.error('Error loading credentials:', e.message);
      return {};
    }
  }

  /**
   * Save all credentials
   */
  saveAll(credentials) {
    const encrypted = {};
    
    for (const [name, value] of Object.entries(credentials)) {
      encrypted[name] = this.encrypt(value);
    }
    
    fs.writeFileSync(this.credPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  }

  /**
   * Get a credential
   */
  get(name) {
    const all = this.loadAll();
    return all[name] || null;
  }

  /**
   * Set a credential
   */
  set(name, value) {
    const all = this.loadAll();
    all[name] = value;
    this.saveAll(all);
  }

  /**
   * Delete a credential
   */
  delete(name) {
    const all = this.loadAll();
    delete all[name];
    this.saveAll(all);
  }

  /**
   * List credentials (masked values)
   */
  list() {
    const all = this.loadAll();
    const masked = {};
    
    for (const [name, value] of Object.entries(all)) {
      if (value && value.length > 8) {
        masked[name] = value.substring(0, 4) + '****' + value.substring(value.length - 4);
      } else {
        masked[name] = '****';
      }
    }
    
    return masked;
  }

  /**
   * Check if a credential exists and is non-empty
   */
  has(name) {
    const value = this.get(name);
    return value !== null && value.length > 0;
  }

  /**
   * Test a credential (provider-specific)
   */
  async test(name) {
    const value = this.get(name);
    if (!value) {
      return { success: false, error: 'Credential not found' };
    }

    // Provider-specific tests
    if (name === 'recall_api_key') {
      try {
        const res = await fetch('https://eu-central-1.recall.ai/api/v1/bot?limit=1', {
          headers: { 'Authorization': `Token ${value}` }
        });
        if (res.ok) {
          return { success: true, message: 'Recall.ai API key is valid' };
        } else {
          return { success: false, error: `API returned ${res.status}` };
        }
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    // Generic test - just check it exists
    return { success: true, message: 'Credential exists' };
  }
}

module.exports = { CredentialStore };
