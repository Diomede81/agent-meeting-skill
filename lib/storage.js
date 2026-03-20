/**
 * Storage Manager
 * Handles meeting data, transcripts, and state persistence
 */

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

class StorageManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.meetingsDir = path.join(this.dataDir, 'meetings');
    this.statePath = path.join(this.dataDir, 'state.json');
    this.templatePath = path.join(__dirname, '..', 'templates', 'transcript.md');
    
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.meetingsDir)) {
      fs.mkdirSync(this.meetingsDir, { recursive: true });
    }
  }

  /**
   * Get current state
   */
  getState() {
    if (!fs.existsSync(this.statePath)) {
      return { activeMeeting: null, recentBots: [] };
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      return { activeMeeting: null, recentBots: [] };
    }
  }

  /**
   * Save state
   */
  saveState(state) {
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Set active meeting
   */
  setActiveMeeting(meeting) {
    const state = this.getState();
    state.activeMeeting = meeting;
    
    // Add to recent bots
    if (meeting?.botId) {
      state.recentBots = state.recentBots || [];
      state.recentBots.unshift({
        botId: meeting.botId,
        title: meeting.title,
        startedAt: new Date().toISOString()
      });
      // Keep only last 10
      state.recentBots = state.recentBots.slice(0, 10);
    }
    
    this.saveState(state);
  }

  /**
   * Clear active meeting
   */
  clearActiveMeeting() {
    const state = this.getState();
    state.activeMeeting = null;
    this.saveState(state);
  }

  /**
   * Get active meeting
   */
  getActiveMeeting() {
    return this.getState().activeMeeting;
  }

  /**
   * Generate filename from pattern
   */
  generateFilename(meeting, pattern = '{date}_{title}') {
    const date = new Date(meeting.start || meeting.date || Date.now());
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    
    // Sanitize title for filename
    const title = (meeting.title || 'meeting')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
    
    return pattern
      .replace('{date}', dateStr)
      .replace('{time}', timeStr)
      .replace('{title}', title);
  }

  /**
   * Save transcript
   */
  saveTranscript(meeting, transcript, config = {}) {
    const format = config.transcriptFormat || 'markdown';
    const pattern = config.fileNamePattern || '{date}_{title}';
    const botName = config.botName || 'Meeting Assistant';
    
    const filename = this.generateFilename(meeting, pattern);
    
    if (format === 'json') {
      const filePath = path.join(this.meetingsDir, `${filename}.json`);
      const data = {
        meeting,
        transcript,
        savedAt: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return filePath;
    }
    
    if (format === 'txt') {
      const filePath = path.join(this.meetingsDir, `${filename}.txt`);
      const text = this.formatTranscriptText(meeting, transcript);
      fs.writeFileSync(filePath, text);
      return filePath;
    }
    
    // Default: markdown
    const filePath = path.join(this.meetingsDir, `${filename}.md`);
    const markdown = this.formatTranscriptMarkdown(meeting, transcript, botName);
    fs.writeFileSync(filePath, markdown);
    return filePath;
  }

  /**
   * Format transcript as markdown
   */
  formatTranscriptMarkdown(meeting, transcript, botName) {
    // Try to use template
    if (fs.existsSync(this.templatePath)) {
      const template = Handlebars.compile(fs.readFileSync(this.templatePath, 'utf8'));
      return template({
        title: meeting.title || 'Meeting',
        date: this.formatDate(meeting.start || meeting.date),
        duration: this.formatDuration(meeting.duration),
        platform: meeting.platform || 'Unknown',
        attendees: this.formatAttendees(meeting.attendees),
        meetingId: meeting.id || meeting.botId,
        transcript: this.formatTranscriptLines(transcript),
        botName
      });
    }
    
    // Fallback format
    return `# Meeting: ${meeting.title || 'Meeting'}

**Date:** ${this.formatDate(meeting.start || meeting.date)}  
**Duration:** ${this.formatDuration(meeting.duration)}  
**Platform:** ${meeting.platform || 'Unknown'}  
**Attendees:** ${this.formatAttendees(meeting.attendees)}

---

## Transcript

${this.formatTranscriptLines(transcript)}

---

*Transcribed by ${botName}*
`;
  }

  /**
   * Format transcript lines with speaker labels
   * Handles Recall.ai format: { participant: { name: "..." }, words: [...] }
   */
  formatTranscriptLines(transcript) {
    if (!transcript || !Array.isArray(transcript)) {
      return '_No transcript available_';
    }

    return transcript.map(entry => {
      // Handle Recall.ai format
      const speaker = entry.participant?.name || entry.speaker || entry.participant || 'Unknown';
      
      // Get timestamp from first word if available
      const firstWord = entry.words?.[0];
      const time = firstWord?.start_timestamp?.absolute 
        ? this.formatTimestamp(firstWord.start_timestamp.absolute)
        : '';
      
      // Combine words into text
      const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
      
      if (time) {
        return `**${speaker} (${time}):** ${text}`;
      }
      return `**${speaker}:** ${text}`;
    }).join('\n\n');
  }

  /**
   * Format transcript as plain text
   */
  formatTranscriptText(meeting, transcript) {
    const lines = [`Meeting: ${meeting.title || 'Meeting'}`, ''];
    
    if (transcript && Array.isArray(transcript)) {
      for (const entry of transcript) {
        const speaker = entry.speaker || 'Unknown';
        const text = entry.text || '';
        lines.push(`[${speaker}] ${text}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Format duration in seconds to human readable
   */
  formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} minutes`;
  }

  /**
   * Format timestamp - handles both seconds and ISO strings
   */
  formatTimestamp(timestamp) {
    if (typeof timestamp === 'string') {
      // ISO string - extract time portion
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    // Seconds format
    const mins = Math.floor(timestamp / 60);
    const secs = Math.floor(timestamp % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format attendees list
   * Handles both string arrays and object arrays [{name: "..."}]
   */
  formatAttendees(attendees) {
    if (!attendees || !Array.isArray(attendees) || attendees.length === 0) {
      return 'Unknown';
    }
    return attendees.map(a => typeof a === 'string' ? a : a.name).join(', ');
  }

  /**
   * List all saved meetings
   */
  listMeetings() {
    if (!fs.existsSync(this.meetingsDir)) {
      return [];
    }
    
    return fs.readdirSync(this.meetingsDir)
      .filter(f => f.endsWith('.md') || f.endsWith('.json') || f.endsWith('.txt'))
      .map(filename => {
        const filePath = path.join(this.meetingsDir, filename);
        const stats = fs.statSync(filePath);
        return {
          id: filename.replace(/\.(md|json|txt)$/, ''),
          filename,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a specific meeting transcript
   */
  getMeeting(id) {
    const files = this.listMeetings();
    const meeting = files.find(f => f.id === id);
    
    if (!meeting) {
      return null;
    }
    
    const content = fs.readFileSync(meeting.path, 'utf8');
    return {
      ...meeting,
      content
    };
  }

  /**
   * Delete a meeting transcript
   */
  deleteMeeting(id) {
    const meeting = this.getMeeting(id);
    if (meeting) {
      fs.unlinkSync(meeting.path);
      return true;
    }
    return false;
  }
}

module.exports = { StorageManager };
