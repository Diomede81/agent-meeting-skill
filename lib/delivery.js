/**
 * Delivery Manager
 * Handles sending transcripts and summaries to configured channels
 */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3007';

class DeliveryManager {
  constructor(config) {
    this.config = config || {};
    this.middlewareUrl = MIDDLEWARE_URL;
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
    const isPlainText = ['whatsapp', 'teams'].includes(channel.type);
    
    if (mode === 'transcript') {
      return this.formatTranscriptOnly(meeting, transcript, isPlainText);
    }
    
    if (mode === 'summary') {
      return this.formatSummaryOnly(meeting, summary, isPlainText);
    }
    
    if (mode === 'both') {
      return this.formatBoth(meeting, transcript, summary, isPlainText);
    }
    
    return '';
  }

  /**
   * Format transcript only
   */
  formatTranscriptOnly(meeting, transcript, isPlainText) {
    const title = `📝 Meeting Transcript: ${meeting.title}`;
    const meta = `Date: ${this.formatDate(meeting.startedAt)}\nDuration: ${this.formatDuration(meeting.duration)}\nAttendees: ${this.formatAttendees(meeting.attendees)}`;
    
    const transcriptText = this.formatTranscript(transcript, isPlainText);
    
    if (isPlainText) {
      return `${title}\n\n${meta}\n\n---\n\n${transcriptText}`;
    }
    
    return `<h2>${title}</h2>
<p>${meta.replace(/\n/g, '<br>')}</p>
<hr>
${transcriptText}`;
  }

  /**
   * Format summary only
   */
  formatSummaryOnly(meeting, summary, isPlainText) {
    if (!summary) {
      return isPlainText 
        ? '⚠️ Summary not available'
        : '<p>⚠️ Summary not available</p>';
    }

    const title = `📋 Meeting Summary: ${meeting.title}`;
    const meta = `Date: ${this.formatDate(meeting.startedAt)}\nDuration: ${this.formatDuration(meeting.duration)}`;
    
    if (isPlainText) {
      let content = `${title}\n\n${meta}\n\n`;
      
      if (summary.overview) {
        content += `*Overview*\n${summary.overview}\n\n`;
      }
      
      if (summary.actionItems?.length > 0) {
        content += `*Action Items*\n`;
        summary.actionItems.forEach((item, i) => {
          content += `${i + 1}. ${item.action}`;
          if (item.assignee) content += ` → ${item.assignee}`;
          if (item.deadline) content += ` (by ${item.deadline})`;
          content += '\n';
        });
        content += '\n';
      }
      
      if (summary.speakerHighlights?.length > 0) {
        content += `*Key Points by Speaker*\n`;
        summary.speakerHighlights.forEach(speaker => {
          content += `\n👤 ${speaker.name}\n`;
          speaker.points.forEach(point => {
            content += `  • ${point}\n`;
          });
        });
        content += '\n';
      }
      
      if (summary.decisions?.length > 0) {
        content += `*Decisions Made*\n`;
        summary.decisions.forEach(decision => {
          content += `✓ ${decision}\n`;
        });
        content += '\n';
      }
      
      if (summary.followUps?.length > 0) {
        content += `*Follow-ups Required*\n`;
        summary.followUps.forEach(followUp => {
          content += `→ ${followUp}\n`;
        });
      }
      
      return content;
    }
    
    // HTML format for email
    let html = `<h2>${title}</h2><p>${meta.replace(/\n/g, '<br>')}</p>`;
    
    if (summary.overview) {
      html += `<h3>Overview</h3><p>${summary.overview}</p>`;
    }
    
    if (summary.actionItems?.length > 0) {
      html += `<h3>Action Items</h3><ol>`;
      summary.actionItems.forEach(item => {
        html += `<li><strong>${item.action}</strong>`;
        if (item.assignee) html += ` → ${item.assignee}`;
        if (item.deadline) html += ` <em>(by ${item.deadline})</em>`;
        html += `</li>`;
      });
      html += `</ol>`;
    }
    
    if (summary.speakerHighlights?.length > 0) {
      html += `<h3>Key Points by Speaker</h3>`;
      summary.speakerHighlights.forEach(speaker => {
        html += `<h4>👤 ${speaker.name}</h4><ul>`;
        speaker.points.forEach(point => {
          html += `<li>${point}</li>`;
        });
        html += `</ul>`;
      });
    }
    
    if (summary.decisions?.length > 0) {
      html += `<h3>Decisions Made</h3><ul>`;
      summary.decisions.forEach(decision => {
        html += `<li>✓ ${decision}</li>`;
      });
      html += `</ul>`;
    }
    
    if (summary.followUps?.length > 0) {
      html += `<h3>Follow-ups Required</h3><ul>`;
      summary.followUps.forEach(followUp => {
        html += `<li>→ ${followUp}</li>`;
      });
      html += `</ul>`;
    }
    
    return html;
  }

  /**
   * Format both transcript and summary
   */
  formatBoth(meeting, transcript, summary, isPlainText) {
    const summaryContent = this.formatSummaryOnly(meeting, summary, isPlainText);
    const transcriptContent = this.formatTranscript(transcript, isPlainText);
    
    if (isPlainText) {
      return `${summaryContent}\n\n---\n\n📝 *Full Transcript*\n\n${transcriptContent}`;
    }
    
    return `${summaryContent}<hr><h2>📝 Full Transcript</h2>${transcriptContent}`;
  }

  /**
   * Format transcript text
   */
  formatTranscript(transcript, isPlainText) {
    if (!transcript || !Array.isArray(transcript)) {
      return isPlainText ? '_No transcript available_' : '<em>No transcript available</em>';
    }

    const lines = transcript.map(entry => {
      const speaker = entry.participant?.name || entry.speaker || 'Unknown';
      const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
      
      if (isPlainText) {
        return `*${speaker}:* ${text}`;
      }
      return `<p><strong>${speaker}:</strong> ${text}</p>`;
    });

    return lines.join(isPlainText ? '\n\n' : '\n');
  }

  /**
   * Send to specific channel
   */
  async sendToChannel(channel, content, meeting) {
    switch (channel.type) {
      case 'email':
        return this.sendEmail(channel, content, meeting);
      case 'whatsapp':
        return this.sendWhatsApp(channel, content, meeting);
      case 'teams':
        return this.sendTeams(channel, content, meeting);
      case 'slack':
        return this.sendSlack(channel, content, meeting);
      case 'webhook':
        return this.sendWebhook(channel, content, meeting);
      default:
        throw new Error(`Unknown channel type: ${channel.type}`);
    }
  }

  /**
   * Send via email
   */
  async sendEmail(channel, content, meeting) {
    const agent = channel.agent || 'max';
    const subject = `Meeting Notes: ${meeting.title} - ${this.formatDate(meeting.startedAt)}`;
    
    const res = await fetch(`${this.middlewareUrl}/api/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent,
        to: channel.target,
        subject,
        body: content
      })
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Email send failed');
    }
    
    return { messageId: (await res.json()).messageId };
  }

  /**
   * Send via WhatsApp (via OpenClaw message tool)
   */
  async sendWhatsApp(channel, content, meeting) {
    // WhatsApp has message length limits, split if needed
    const MAX_LENGTH = 4000;
    const messages = this.splitMessage(content, MAX_LENGTH);
    
    // This will be called via the agent's message tool
    // Return the formatted messages for the agent to send
    return {
      messages,
      target: channel.target,
      requiresAgentSend: true
    };
  }

  /**
   * Send via Teams
   */
  async sendTeams(channel, content, meeting) {
    // Use the Teams reply script
    const { execSync } = require('child_process');
    const scriptPath = process.env.TEAMS_SCRIPT_PATH || 
      `${process.env.HOME}/clawd/memory/projects/microsoft-integration/scripts/max-teams-reply.js`;
    
    // HTML format for Teams
    const htmlContent = content.replace(/\n/g, '<br>');
    
    execSync(`node "${scriptPath}" '${channel.target}' '${htmlContent.replace(/'/g, "\\'")}'`);
    
    return { sent: true };
  }

  /**
   * Send via Slack
   */
  async sendSlack(channel, content, meeting) {
    // Placeholder - implement based on Slack integration
    throw new Error('Slack delivery not yet implemented');
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
   * Split long message for WhatsApp
   */
  splitMessage(content, maxLength) {
    if (content.length <= maxLength) {
      return [content];
    }
    
    const messages = [];
    let remaining = content;
    
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        messages.push(remaining);
        break;
      }
      
      // Find a good split point (newline or space)
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength / 2) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt < maxLength / 2) {
        splitAt = maxLength;
      }
      
      messages.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trim();
    }
    
    return messages;
  }

  /**
   * Format helpers
   */
  formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }

  formatAttendees(attendees) {
    if (!attendees || attendees.length === 0) return 'Unknown';
    return attendees.map(a => typeof a === 'string' ? a : a.name).join(', ');
  }
}

module.exports = { DeliveryManager };
