/**
 * Avatar Manager
 * Handles agent avatar upload to S3 and retrieval
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// S3 Configuration
const S3_BUCKET = process.env.S3_BUCKET || 'max-agent-s3-bucket';
const S3_REGION = process.env.S3_REGION || 'eu-north-1';
const S3_PREFIX = 'avatars/';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

// Get AWS creds from age-encrypted secrets
function getAwsCreds() {
  try {
    const creds = execSync(
      'age -d -i <(echo "AGE-SECRET-KEY-1PX2LYZ7R9S3NQ3UMFKMJYMUGRN6N03080G67GX4NA2WZ96AV0VVSRYA98M") .secrets/credentials.age',
      { shell: '/bin/bash', cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8' }
    );
    const lines = creds.split('\n');
    let key = '', secret = '';
    for (const line of lines) {
      if (line.includes('aws_access_key_id')) key = line.split('=')[1].trim();
      if (line.includes('aws_secret_access_key')) secret = line.split('=')[1].trim();
    }
    return { key, secret };
  } catch (e) {
    console.error('Failed to get AWS creds:', e.message);
    return { key: null, secret: null };
  }
}

class AvatarManager {
  constructor(config = {}) {
    this.bucket = config.bucket || S3_BUCKET;
    this.region = config.region || S3_REGION;
    this.prefix = config.prefix || S3_PREFIX;
    this.baseUrl = config.baseUrl || S3_BASE_URL;
    
    // Get credentials
    const creds = getAwsCreds();
    
    this.s3 = new S3Client({
      region: this.region,
      credentials: creds.key ? {
        accessKeyId: creds.key,
        secretAccessKey: creds.secret
      } : undefined
    });
    
    // Local cache of avatar URLs per agent
    this.avatarCache = new Map();
  }

  /**
   * Upload avatar for an agent
   * @param {string} agentId - Agent identifier (e.g., 'max', 'sophia')
   * @param {Buffer|string} imageData - Image data (Buffer or base64 string)
   * @param {string} mimeType - Image MIME type (image/png, image/jpeg, etc.)
   * @returns {Promise<{success: boolean, url: string}>}
   */
  async uploadAvatar(agentId, imageData, mimeType = 'image/png') {
    if (!agentId || !imageData) {
      throw new Error('agentId and imageData are required');
    }

    // Sanitize agent ID
    const safeAgentId = agentId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    
    // Convert base64 to buffer if needed
    let buffer = imageData;
    if (typeof imageData === 'string') {
      // Remove data URL prefix if present
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    }

    // Validate it's actually an image (check magic bytes)
    if (!this.isValidImage(buffer)) {
      throw new Error('Invalid image data');
    }

    // Determine extension from MIME type
    const ext = this.getExtension(mimeType);
    
    // Generate unique filename with hash for cache busting
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
    const key = `${this.prefix}${safeAgentId}-${hash}${ext}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000', // 1 year cache
    });

    await this.s3.send(command);

    // Construct public URL
    const url = `${this.baseUrl}/${key}`;
    
    // Update cache
    this.avatarCache.set(safeAgentId, url);

    return {
      success: true,
      url,
      key,
      agentId: safeAgentId
    };
  }

  /**
   * Upload avatar from local file path
   */
  async uploadFromFile(agentId, filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = this.getMimeType(ext);

    return this.uploadAvatar(agentId, buffer, mimeType);
  }

  /**
   * Get avatar URL for an agent
   * Returns null if no avatar set
   */
  async getAvatarUrl(agentId) {
    const safeAgentId = agentId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    
    // Check cache first
    if (this.avatarCache.has(safeAgentId)) {
      return this.avatarCache.get(safeAgentId);
    }

    // Could add S3 listing here to find existing avatars
    // For now, return from config if set
    return null;
  }

  /**
   * Delete avatar for an agent
   */
  async deleteAvatar(agentId, key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    await this.s3.send(command);
    
    const safeAgentId = agentId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    this.avatarCache.delete(safeAgentId);

    return { success: true };
  }

  /**
   * Validate image magic bytes
   */
  isValidImage(buffer) {
    if (buffer.length < 8) return false;
    
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return true;
    }
    
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return true;
    }
    
    // GIF: 47 49 46
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return true;
    }
    
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get file extension from MIME type
   */
  getExtension(mimeType) {
    const map = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp'
    };
    return map[mimeType] || '.png';
  }

  /**
   * Get MIME type from file extension
   */
  getMimeType(ext) {
    const map = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    return map[ext.toLowerCase()] || 'image/png';
  }
}

module.exports = { AvatarManager };
