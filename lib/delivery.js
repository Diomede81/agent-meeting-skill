/**
 * Delivery Manager
 * Handles sending transcripts and summaries to configured channels
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3007';
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

class DeliveryManager {
  constructor(config) {
    this.config = config || {};
    this.middlewareUrl = MIDDLEWARE_URL;
    this.templates = this.loadTemplates();
  }

  /**
   * Load email templates
   */
  loadTemplates() {
    const templates = {};
    
    try {
      const transcriptPath = path.join(TEMPLATES_DIR, 'email-transcript.html');
      if (fs.existsSync(transcriptPath)) {
        templates.transcript = Handlebars.compile(fs.readFileSync(transcriptPath, 'utf8'));
      }
      
      const summaryPath = path.join(TEMPLATES_DIR, 'email-summary.html');
      if (fs.existsSync(summaryPath)) {
        templates.summary = Handlebars.compile(fs.readFileSync(summaryPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load templates:', e.message);
    }
    
    return templates;
  }

  /**
   * Deliver meeting results based on config
   */
  async deliver(meeting, transcript, summary = null) {
    const { mode, channels } = this.config;
    
    if (mode === 'none' || !channels || channels.length === 0) {
      return { delivered: false, reason: 'No delivery configured' };
    }

    const results = [];
    
    for (const channel of channels) {
      if (!channel.enabled) continue;
      
      try {
        const content = this.formatContent(meeting, transcript, summary, mode, channel);
        const result = await this.sendToChannel(channel, content, meeting);
        results.push({ channel: channel.type, target: channel.target, success: true, ...result });
      } catch (error) {
        console.error(`Delivery to ${channel.type} failed:`, error.message);
        results.push({ channel: channel.type, target: channel.target, success: false, error: error.message });
      }
    }

    return {
      delivered: results.some(r => r.success),
      results
    };
  }

  /**
   * Format content based on delivery mode
   */
  formatContent(meeting, transcript, summary, mode, channel) {
    const isEmail = channel.type === 'email';
    
    // Prepare template data
    const data = {
      title: meeting.title || 'Meeting',
      date: this.formatDate(meeting.startedAt),
      duration: this.formatDuration(meeting.duration),
      platform: this.formatPlatform(meeting.platform),
      attendees: this.formatAttendeesArray(meeting.attendees),
      transcript: this.formatTranscriptArray(transcript),
      botName: 'Max',
      ...summary
    };
    
    if (mode === 'transcript') {
      if (isEmail && this.templates.transcript) {
        return this.templates.transcript(data);
      }
      return this.formatTranscriptPlain(meeting, transcript);
    }
    
    if (mode === 'summary') {
      data.includeTranscript = false;
      if (isEmail && this.templates.summary) {
        return this.templates.summary(data);
      }
      return this.formatSummaryPlain(meeting, summary);
    }
    
    if (mode === 'both') {
      data.includeTranscript = true;
      if (isEmail && this.templates.summary) {
        return this.templates.summary(data);
      }
      return this.formatBothPlain(meeting, transcript, summary);
    }
    
    return '';
  }

  /**
   * Format attendees as array for template
   */
  formatAttendeesArray(attendees) {
    if (!attendees || !Array.isArray(attendees)) return [];
    return attendees.map(a => ({
      name: typeof a === 'string' ? a : a.name,
      isHost: a.isHost || false
    }));
  }

  /**
   * Format transcript as array for template
   */
  formatTranscriptArray(transcript) {
    if (!transcript || !Array.isArray(transcript)) return [];
    
    return transcript.map(entry => {
      const speaker = entry.participant?.name || entry.speaker || 'Unknown';
      const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
      const timestamp = entry.words?.[0]?.start_timestamp?.absolute 
        ? this.formatTime(entry.words[0].start_timestamp.absolute)
        : null;
      
      return { speaker, text, timestamp };
    });
  }

  /**
   * Format transcript as plain text
   */
  formatTranscriptPlain(meeting, transcript) {
    const lines = [
      `📝 MEETING TRANSCRIPT`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📌 ${meeting.title || 'Meeting'}`,
      `📅 ${this.formatDate(meeting.startedAt)}`,
      `⏱️ ${this.formatDuration(meeting.duration)}`,
      `💻 ${this.formatPlatform(meeting.platform)}`,
      `👥 ${this.formatAttendees(meeting.attendees)}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``
    ];
    
    if (transcript && Array.isArray(transcript)) {
      transcript.forEach(entry => {
        const speaker = entry.participant?.name || entry.speaker || 'Unknown';
        const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
        lines.push(`**${speaker}:**`);
        lines.push(text);
        lines.push(``);
      });
    }
    
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Transcribed by Max`);
    
    return lines.join('\n');
  }

  /**
   * Format summary as plain text
   */
  formatSummaryPlain(meeting, summary) {
    const lines = [
      `📋 MEETING SUMMARY`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📌 ${meeting.title || 'Meeting'}`,
      `📅 ${this.formatDate(meeting.startedAt)}`,
      `⏱️ ${this.formatDuration(meeting.duration)}`,
      ``
    ];
    
    if (summary?.overview) {
      lines.push(`📝 OVERVIEW`);
      lines.push(summary.overview);
      lines.push(``);
    }
    
    if (summary?.actionItems?.length > 0) {
      lines.push(`✅ ACTION ITEMS`);
      summary.actionItems.forEach((item, i) => {
        let line = `${i + 1}. ${item.action}`;
        if (item.assignee) line += ` → ${item.assignee}`;
        if (item.deadline) line += ` (${item.deadline})`;
        lines.push(line);
      });
      lines.push(``);
    }
    
    if (summary?.speakerHighlights?.length > 0) {
      lines.push(`👥 KEY POINTS BY SPEAKER`);
      summary.speakerHighlights.forEach(speaker => {
        lines.push(`\n👤 ${speaker.name}`);
        speaker.points.forEach(point => {
          lines.push(`  • ${point}`);
        });
      });
      lines.push(``);
    }
    
    if (summary?.decisions?.length > 0) {
      lines.push(`🎯 DECISIONS`);
      summary.decisions.forEach(d => lines.push(`✓ ${d}`));
      lines.push(``);
    }
    
    if (summary?.followUps?.length > 0) {
      lines.push(`📌 FOLLOW-UPS`);
      summary.followUps.forEach(f => lines.push(`→ ${f}`));
      lines.push(``);
    }
    
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Summarized by Max`);
    
    return lines.join('\n');
  }

  /**
   * Format both transcript and summary as plain text
   */
  formatBothPlain(meeting, transcript, summary) {
    return this.formatSummaryPlain(meeting, summary) + 
      '\n\n' + 
      this.formatTranscriptPlain(meeting, transcript);
  }

  /**
   * Send to specific channel
   */
  async sendToChannel(channel, content, meeting) {
    switch (channel.type) {
      case 'email':
        return this.sendEmail(channel, content, meeting);
      case 'webhook':
        return this.sendWebhook(channel, content, meeting);
      default:
        throw new Error(`Channel type "${channel.type}" not supported. Use email or webhook.`);
    }
  }

  /**
   * Send via email
   */
  async sendEmail(channel, content, meeting) {
    const agent = channel.agent || 'max';
    const mode = this.config.mode || 'transcript';
    const prefix = mode === 'transcript' ? '📝' : '📋';
    const subject = `${prefix} ${meeting.title || 'Meeting'} - ${this.formatDate(meeting.startedAt)}`;
    
    const res = await fetch(`${this.middlewareUrl}/api/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent,
        to: channel.target,
        subject,
        body: content,
        isHtml: content.includes('<html')
      })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `Email send failed: ${res.status}`);
    }
    
    const result = await res.json();
    return { messageId: result.messageId };
  }

  /**
   * Send via webhook
   */
  async sendWebhook(channel, content, meeting) {
    const res = await fetch(channel.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'meeting.transcript',
        timestamp: new Date().toISOString(),
        meeting: {
          title: meeting.title,
          date: meeting.startedAt,
          duration: meeting.duration,
          platform: meeting.platform
        },
        content
      })
    });
    
    if (!res.ok) {
      throw new Error(`Webhook failed: ${res.status}`);
    }
    
    return { status: res.status };
  }

  /**
   * Format helpers
   */
  formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatTime(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} minutes`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }

  formatPlatform(platform) {
    const names = {
      teams: 'Microsoft Teams',
      zoom: 'Zoom',
      meet: 'Google Meet',
      webex: 'Webex'
    };
    return names[platform] || platform || 'Unknown';
  }

  formatAttendees(attendees) {
    if (!attendees || attendees.length === 0) return 'Unknown';
    return attendees.map(a => typeof a === 'string' ? a : a.name).join(', ');
  }
}

module.exports = { DeliveryManager };
