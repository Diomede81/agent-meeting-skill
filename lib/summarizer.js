/**
 * Meeting Summarizer
 * Generates AI summaries from meeting transcripts
 * 
 * This module prepares the prompt and structure for summarization.
 * The actual AI call is made by the agent via webhook.
 */

class MeetingSummarizer {
  constructor(options = {}) {
    this.options = {
      includeActionItems: true,
      includeSpeakerHighlights: true,
      includeDecisions: true,
      includeFollowUps: true,
      maxLength: 0,
      ...options
    };
  }

  /**
   * Generate a summarization prompt for the agent
   */
  generatePrompt(meeting, transcript) {
    const transcriptText = this.formatTranscriptForPrompt(transcript);
    const attendees = this.extractAttendees(transcript);
    
    let prompt = `Summarize the following meeting transcript.

**Meeting:** ${meeting.title || 'Meeting'}
**Date:** ${meeting.startedAt || 'Unknown'}
**Attendees:** ${attendees.join(', ')}

**Transcript:**
${transcriptText}

---

Please provide a structured summary with the following sections:
`;

    if (this.options.includeActionItems) {
      prompt += `
## Action Items
List all action items mentioned, including:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)
`;
    }

    if (this.options.includeSpeakerHighlights) {
      prompt += `
## Key Points by Speaker
For each speaker, list their main contributions and key points.
`;
    }

    if (this.options.includeDecisions) {
      prompt += `
## Decisions Made
List any decisions that were agreed upon during the meeting.
`;
    }

    if (this.options.includeFollowUps) {
      prompt += `
## Follow-ups Required
List items that need follow-up or further discussion.
`;
    }

    prompt += `
## Overview
Provide a brief 2-3 sentence overview of the meeting.
`;

    if (this.options.maxLength > 0) {
      prompt += `\nKeep the total summary under ${this.options.maxLength} characters.`;
    }

    return prompt;
  }

  /**
   * Format transcript for prompt
   */
  formatTranscriptForPrompt(transcript) {
    if (!transcript || !Array.isArray(transcript)) {
      return '[No transcript available]';
    }

    return transcript.map(entry => {
      const speaker = entry.participant?.name || entry.speaker || 'Unknown';
      const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
      return `${speaker}: ${text}`;
    }).join('\n\n');
  }

  /**
   * Extract unique attendees from transcript
   */
  extractAttendees(transcript) {
    if (!transcript || !Array.isArray(transcript)) {
      return [];
    }

    const seen = new Set();
    return transcript
      .filter(entry => {
        const name = entry.participant?.name || entry.speaker;
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      })
      .map(entry => entry.participant?.name || entry.speaker);
  }

  /**
   * Parse AI response into structured summary
   * Handles common markdown formats
   */
  parseResponse(responseText) {
    const summary = {
      overview: '',
      actionItems: [],
      speakerHighlights: [],
      decisions: [],
      followUps: []
    };

    // Split into sections
    const sections = responseText.split(/^##\s+/m);

    for (const section of sections) {
      const lines = section.trim().split('\n');
      const title = lines[0]?.toLowerCase() || '';
      const content = lines.slice(1).join('\n').trim();

      if (title.includes('overview') || title.includes('summary')) {
        summary.overview = content.replace(/^[\s\n]+/, '');
      }
      
      else if (title.includes('action')) {
        summary.actionItems = this.parseActionItems(content);
      }
      
      else if (title.includes('speaker') || title.includes('key points by')) {
        summary.speakerHighlights = this.parseSpeakerHighlights(content);
      }
      
      else if (title.includes('decision')) {
        summary.decisions = this.parseListItems(content);
      }
      
      else if (title.includes('follow')) {
        summary.followUps = this.parseListItems(content);
      }
    }

    return summary;
  }

  /**
   * Parse action items from markdown
   */
  parseActionItems(content) {
    const items = [];
    const lines = content.split('\n').filter(l => l.trim().match(/^[-*\d.]/));
    
    for (const line of lines) {
      const text = line.replace(/^[-*\d.\s]+/, '').trim();
      
      // Try to extract assignee (look for "→", "->", "@", "assigned to", "responsible:")
      let action = text;
      let assignee = null;
      let deadline = null;
      
      const assigneeMatch = text.match(/(?:→|->|@|assigned to:?|responsible:?)\s*([^(,]+)/i);
      if (assigneeMatch) {
        assignee = assigneeMatch[1].trim();
        action = text.replace(assigneeMatch[0], '').trim();
      }
      
      const deadlineMatch = text.match(/(?:by|deadline:?|due:?)\s*([^,)]+)/i);
      if (deadlineMatch) {
        deadline = deadlineMatch[1].trim();
        action = action.replace(deadlineMatch[0], '').trim();
      }
      
      // Clean up action text
      action = action.replace(/^[-:]\s*/, '').trim();
      
      if (action) {
        items.push({ action, assignee, deadline });
      }
    }
    
    return items;
  }

  /**
   * Parse speaker highlights
   */
  parseSpeakerHighlights(content) {
    const highlights = [];
    
    // Look for speaker headers (### Name or **Name** or Name:)
    const speakerBlocks = content.split(/(?=^###\s+|^\*\*[^*]+\*\*|^👤)/m);
    
    for (const block of speakerBlocks) {
      const lines = block.trim().split('\n');
      if (lines.length === 0) continue;
      
      // Extract speaker name
      let name = lines[0]
        .replace(/^###\s+/, '')
        .replace(/^\*\*|\*\*$/g, '')
        .replace(/^👤\s*/, '')
        .replace(/:$/, '')
        .trim();
      
      if (!name || name.length > 50) continue;
      
      // Extract points
      const points = lines.slice(1)
        .filter(l => l.trim().match(/^[-*•]/))
        .map(l => l.replace(/^[-*•\s]+/, '').trim())
        .filter(p => p.length > 0);
      
      if (points.length > 0) {
        highlights.push({ name, points });
      }
    }
    
    return highlights;
  }

  /**
   * Parse simple list items
   */
  parseListItems(content) {
    return content
      .split('\n')
      .filter(l => l.trim().match(/^[-*•✓→\d.]/))
      .map(l => l.replace(/^[-*•✓→\d.\s]+/, '').trim())
      .filter(item => item.length > 0);
  }
}

module.exports = { MeetingSummarizer };
