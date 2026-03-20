/**
 * Recall.ai API Client
 * Handles bot creation, status, transcription for meeting recording
 */

class RecallClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.region = config.region || 'eu-central-1';
    this.baseUrl = `https://${this.region}.recall.ai/api/v1`;
  }

  async request(method, endpoint, body = null) {
    const options = {
      method,
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await res.json();
    
    if (!res.ok) {
      const error = new Error(data.detail || data.error || 'Recall API error');
      error.status = res.status;
      error.data = data;
      throw error;
    }
    
    return data;
  }

  /**
   * Create a bot to join a meeting
   */
  async createBot(options) {
    const {
      meetingUrl,
      botName = 'Meeting Assistant',
      botImage = null,
      introMessage = null,
      transcriptWebhookUrl = null,
      variant = 'web_4_core'
    } = options;

    const payload = {
      meeting_url: meetingUrl,
      bot_name: botName,
      
      // Automatic leave settings
      automatic_leave: {
        everyone_left_timeout: { timeout: 30 },
        waiting_room_timeout: 1200 // 20 minutes
      },
      
      // Use web_4_core variant for best platform support
      variant: {
        microsoft_teams: variant,
        zoom: variant,
        google_meet: variant
      },
      
      // Recording config with transcription
      recording_config: {
        transcript: {
          provider: { assembly_ai_streaming: {} }
        }
      }
    };

    // Chat intro message
    if (introMessage) {
      payload.chat = {
        on_bot_join: {
          send_to: 'everyone',
          message: introMessage
        }
      };
    }

    // Bot avatar image (shown in meeting)
    if (botImage) {
      payload.bot_image = botImage;
    }

    // Real-time transcript webhook
    if (transcriptWebhookUrl) {
      payload.recording_config.realtime_endpoints = [{
        type: 'webhook',
        url: transcriptWebhookUrl,
        events: ['transcript.data']
      }];
    }

    return this.request('POST', '/bot', payload);
  }

  /**
   * Get bot status
   */
  async getBotStatus(botId) {
    return this.request('GET', `/bot/${botId}`);
  }

  /**
   * Make bot leave meeting
   */
  async leaveBot(botId) {
    return this.request('POST', `/bot/${botId}/leave`);
  }

  /**
   * Get bot transcript (after meeting ends)
   * Recall API v1: recordings[0].media_shortcuts.transcript.data.download_url
   */
  async getTranscript(botId) {
    const bot = await this.getBotStatus(botId);
    
    // Check recordings array for transcript
    const recording = bot.recordings?.[0];
    const transcriptUrl = recording?.media_shortcuts?.transcript?.data?.download_url;
    
    if (!transcriptUrl) {
      return null;
    }

    // Fetch transcript from S3 URL
    const res = await fetch(transcriptUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch transcript: ${res.status}`);
    }
    return res.json();
  }

  /**
   * Get meeting title from metadata
   */
  getMeetingTitle(bot) {
    return bot.recordings?.[0]?.media_shortcuts?.meeting_metadata?.data?.title || 'Meeting';
  }

  /**
   * Get bot recording (after meeting ends)
   */
  async getRecording(botId) {
    const bot = await this.getBotStatus(botId);
    return {
      video: bot.video_url,
      audio: bot.audio_url,
      transcript: bot.transcript?.url
    };
  }

  /**
   * List recent bots
   */
  async listBots(limit = 10) {
    return this.request('GET', `/bot?limit=${limit}`);
  }

  /**
   * Get current bot status code
   */
  getStatusCode(bot) {
    if (!bot.status_changes || bot.status_changes.length === 0) {
      return 'unknown';
    }
    return bot.status_changes[bot.status_changes.length - 1].code;
  }

  /**
   * Check if bot is in an active meeting
   */
  isActive(bot) {
    const status = this.getStatusCode(bot);
    return ['joining_call', 'in_waiting_room', 'in_call_not_recording', 'in_call_recording'].includes(status);
  }

  /**
   * Check if bot has completed
   */
  isComplete(bot) {
    const status = this.getStatusCode(bot);
    return ['done', 'fatal'].includes(status);
  }

  /**
   * Parse meeting URL to detect platform
   */
  static detectPlatform(meetingUrl) {
    const url = meetingUrl.toLowerCase();
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) {
      return 'teams';
    }
    if (url.includes('zoom.us')) {
      return 'zoom';
    }
    if (url.includes('meet.google.com')) {
      return 'meet';
    }
    if (url.includes('webex.com')) {
      return 'webex';
    }
    return 'unknown';
  }
}

module.exports = { RecallClient };
