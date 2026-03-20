/**
 * Configuration Manager
 * Handles loading, saving, and validating skill configuration
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.configPath = path.join(this.dataDir, 'config.json');
    this.schemaPath = path.join(__dirname, '..', 'config', 'schema.json');
    
    this.ensureDataDir();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    const meetingsDir = path.join(this.dataDir, 'meetings');
    if (!fs.existsSync(meetingsDir)) {
      fs.mkdirSync(meetingsDir, { recursive: true });
    }
  }

  /**
   * Get default configuration
   */
  getDefaults() {
    const defaultPath = path.join(__dirname, '..', 'config', 'default.json');
    if (fs.existsSync(defaultPath)) {
      return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    }
    return {};
  }

  /**
   * Load current configuration (merged with defaults)
   */
  load() {
    const defaults = this.getDefaults();
    
    if (!fs.existsSync(this.configPath)) {
      return defaults;
    }
    
    try {
      const userConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return this.deepMerge(defaults, userConfig);
    } catch (e) {
      console.error('Error loading config:', e.message);
      return defaults;
    }
  }

  /**
   * Save configuration
   */
  save(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    return this.load();
  }

  /**
   * Update configuration (partial update)
   */
  update(partial) {
    const current = this.load();
    const updated = this.deepMerge(current, partial);
    return this.save(updated);
  }

  /**
   * Get JSON Schema for UI form generation
   */
  getSchema() {
    if (fs.existsSync(this.schemaPath)) {
      return JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
    }
    return null;
  }

  /**
   * Validate configuration against schema
   */
  validate(config) {
    const errors = [];
    
    // Basic required field validation
    if (!config.bot?.name) {
      errors.push({ field: 'bot.name', message: 'Bot name is required' });
    }
    
    if (!config.calendar?.source) {
      errors.push({ field: 'calendar.source', message: 'Calendar source is required' });
    }
    
    if (config.calendar?.source === 'api' && !config.calendar?.endpoint) {
      errors.push({ field: 'calendar.endpoint', message: 'Calendar endpoint is required when source is "api"' });
    }
    
    if (config.webhook?.onMeetingEnd) {
      try {
        new URL(config.webhook.onMeetingEnd);
      } catch {
        errors.push({ field: 'webhook.onMeetingEnd', message: 'Invalid webhook URL' });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Deep merge two objects
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        if (target[key] instanceof Object && !Array.isArray(target[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = { ...source[key] };
        }
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}

module.exports = { ConfigManager };
