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
List all action items in this exact format:
- [Action description] → [Assignee] (by [deadline])

Example:
- Review the Q3 budget proposal → Sarah (by Friday)
- Set up follow-up meeting with client → John (by next week)
- Send updated contract draft → Legal team

Include the full action description first, then assignee if mentioned, then deadline if mentioned.
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
   * Expected format: "Action description → Assignee (by deadline)"
   * Or: "Action description - Assignee - deadline"
   */
  parseActionItems(content) {
    const items = [];
    const lines = content.split('\n').filter(l => l.trim().match(/^[-*\d.]/));
    
    for (const line of lines) {
      const text = line.replace(/^[-*\d.\s]+/, '').trim();
      if (!text) continue;
      
      let action = text;
      let assignee = null;
      let deadline = null;
      
      // Pattern 1: "Action → Assignee (by date)" or "Action -> Assignee (due date)"
      const arrowMatch = text.match(/^(.+?)\s*(?:→|->)\s*([^(]+)(?:\s*\((?:by|due:?)\s*([^)]+)\))?$/i);
      if (arrowMatch) {
        action = arrowMatch[1].trim();
        assignee = arrowMatch[2].trim();
        deadline = arrowMatch[3]?.trim() || null;
      } else {
        // Pattern 2: "Action - assigned to: Name - by: date"
        const assignedMatch = text.match(/^(.+?)\s*[-–]\s*(?:assigned to:?|responsible:?)\s*([^-–]+)(?:\s*[-–]\s*(?:by|due|deadline):?\s*(.+))?$/i);
        if (assignedMatch) {
          action = assignedMatch[1].trim();
          assignee = assignedMatch[2].trim();
          deadline = assignedMatch[3]?.trim() || null;
        } else {
          // Pattern 3: Look for trailing "(Name)" or "(by date)" 
          const trailingMatch = text.match(/^(.+?)\s*\(([^)]+)\)\s*(?:\(([^)]+)\))?$/);
          if (trailingMatch) {
            action = trailingMatch[1].trim();
            const part2 = trailingMatch[2].trim();
            const part3 = trailingMatch[3]?.trim();
            
            // Check if part2 is a date or assignee
            if (part2.match(/\d|week|month|day|tomorrow|monday|tuesday|wednesday|thursday|friday/i)) {
              deadline = part2;
              assignee = part3 || null;
            } else {
              assignee = part2;
              deadline = part3 || null;
            }
          }
          // Otherwise keep full text as action
        }
      }
      
      // Final cleanup
      action = action.replace(/^[-:]\s*/, '').trim();
      
      // Always include action even if we couldn't parse assignee/deadline
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
