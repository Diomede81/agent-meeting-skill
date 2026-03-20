/**
 * Meeting Summarizer
 * Generates AI summaries from meeting transcripts
 * 
 * This module prepares the prompt and structure for summarization.
 * The actual AI call is made by the agent via the cron job.
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
   * Returns a prompt that requests STRICT JSON output
   */
  generatePrompt(meeting, transcript) {
    const transcriptText = this.formatTranscriptForPrompt(transcript);
    const attendees = this.extractAttendees(transcript);
    
    const prompt = `You are analyzing a meeting transcript. Generate a structured summary.

**Meeting:** ${meeting.title || 'Meeting'}
**Date:** ${meeting.startedAt || 'Unknown'}
**Attendees:** ${attendees.join(', ')}

**Transcript:**
${transcriptText}

---

## INSTRUCTIONS

Analyze the transcript and output a JSON object with this EXACT structure:

\`\`\`json
{
  "overview": "2-3 sentence summary of what was discussed and accomplished",
  "actionItems": [
    {
      "action": "Description of what needs to be done",
      "assignee": "Person responsible (or null if not specified)",
      "deadline": "When it's due (or null if not specified)"
    }
  ],
  "speakerHighlights": [
    {
      "name": "Speaker Name",
      "points": ["Key point 1", "Key point 2"]
    }
  ],
  "decisions": ["Decision 1", "Decision 2"],
  "followUps": ["Follow-up item 1", "Follow-up item 2"]
}
\`\`\`

## RULES

1. **overview**: REQUIRED. Always provide a 2-3 sentence summary.

2. **actionItems**: Extract ALL tasks, todos, commitments, or things people said they would do.
   - "action" must be a complete sentence describing the task
   - "assignee" is who should do it (use their name from the transcript)
   - "deadline" is when (use exact words from transcript like "by Friday" or "next week")
   - If no assignee/deadline mentioned, use null

3. **speakerHighlights**: Key contributions from each person who spoke.
   - Include ALL speakers from the transcript
   - List 2-5 key points per speaker

4. **decisions**: Any agreements, conclusions, or choices made during the meeting.
   - If no decisions were made, use empty array []

5. **followUps**: Items that need follow-up, further discussion, or weren't resolved.
   - If none, use empty array []

## OUTPUT FORMAT

Respond with ONLY the JSON object. No markdown code blocks, no explanation, no other text.
Start your response with { and end with }

${this.options.maxLength > 0 ? `Keep the total response under ${this.options.maxLength} characters.` : ''}`;

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
   * Expects JSON response from the prompt above
   */
  parseResponse(responseText) {
    const defaultSummary = {
      overview: '',
      actionItems: [],
      speakerHighlights: [],
      decisions: [],
      followUps: []
    };

    if (!responseText || typeof responseText !== 'string') {
      return defaultSummary;
    }

    // Clean up response - remove markdown code blocks if present
    let cleaned = responseText.trim();
    
    // Remove ```json ... ``` wrapper
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    
    // Find JSON object boundaries
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      console.error('Could not find JSON in response');
      return this.parseLegacyResponse(responseText);
    }

    const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

    try {
      const parsed = JSON.parse(jsonStr);
      
      // Validate and normalize the structure
      return {
        overview: typeof parsed.overview === 'string' ? parsed.overview : '',
        actionItems: this.normalizeActionItems(parsed.actionItems),
        speakerHighlights: this.normalizeSpeakerHighlights(parsed.speakerHighlights),
        decisions: this.normalizeStringArray(parsed.decisions),
        followUps: this.normalizeStringArray(parsed.followUps)
      };
    } catch (e) {
      console.error('Failed to parse JSON response:', e.message);
      return this.parseLegacyResponse(responseText);
    }
  }

  /**
   * Normalize action items array
   */
  normalizeActionItems(items) {
    if (!Array.isArray(items)) return [];
    
    return items.map(item => {
      if (typeof item === 'string') {
        return { action: item, assignee: null, deadline: null };
      }
      return {
        action: typeof item.action === 'string' ? item.action : String(item.action || ''),
        assignee: item.assignee || null,
        deadline: item.deadline || null
      };
    }).filter(item => item.action);
  }

  /**
   * Normalize speaker highlights array
   */
  normalizeSpeakerHighlights(highlights) {
    if (!Array.isArray(highlights)) return [];
    
    return highlights.map(h => ({
      name: typeof h.name === 'string' ? h.name : 'Unknown',
      points: Array.isArray(h.points) ? h.points.filter(p => typeof p === 'string') : []
    })).filter(h => h.points.length > 0);
  }

  /**
   * Normalize string array
   */
  normalizeStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => typeof item === 'string' && item.trim()).map(s => s.trim());
  }

  /**
   * Fallback: Parse legacy markdown response format
   * Used when JSON parsing fails
   */
  parseLegacyResponse(responseText) {
    const summary = {
      overview: '',
      actionItems: [],
      speakerHighlights: [],
      decisions: [],
      followUps: []
    };

    // Split into sections by ## headers
    const sections = responseText.split(/^##\s+/m);

    for (const section of sections) {
      const lines = section.trim().split('\n');
      const title = lines[0]?.toLowerCase() || '';
      const content = lines.slice(1).join('\n').trim();

      if (title.includes('overview') || title.includes('summary')) {
        summary.overview = content.replace(/^[\s\n]+/, '');
      }
      else if (title.includes('action')) {
        summary.actionItems = this.parseActionItemsLegacy(content);
      }
      else if (title.includes('speaker') || title.includes('key points by')) {
        summary.speakerHighlights = this.parseSpeakerHighlightsLegacy(content);
      }
      else if (title.includes('decision')) {
        summary.decisions = this.parseListItemsLegacy(content);
      }
      else if (title.includes('follow')) {
        summary.followUps = this.parseListItemsLegacy(content);
      }
    }

    return summary;
  }

  /**
   * Legacy: Parse action items from markdown
   */
  parseActionItemsLegacy(content) {
    const items = [];
    const lines = content.split('\n').filter(l => l.trim().match(/^[-*\d.]/));
    
    for (const line of lines) {
      const text = line.replace(/^[-*\d.\s]+/, '').trim();
      if (!text) continue;
      
      let action = text;
      let assignee = null;
      let deadline = null;
      
      // Pattern: "Action → Assignee (by date)"
      const arrowMatch = text.match(/^(.+?)\s*(?:→|->)\s*([^(]+)(?:\s*\((?:by|due:?)\s*([^)]+)\))?$/i);
      if (arrowMatch) {
        action = arrowMatch[1].trim();
        assignee = arrowMatch[2].trim();
        deadline = arrowMatch[3]?.trim() || null;
      }
      
      action = action.replace(/^[-:]\s*/, '').trim();
      if (action) {
        items.push({ action, assignee, deadline });
      }
    }
    
    return items;
  }

  /**
   * Legacy: Parse speaker highlights
   */
  parseSpeakerHighlightsLegacy(content) {
    const highlights = [];
    const speakerBlocks = content.split(/(?=^###\s+|^\*\*[^*]+\*\*|^👤)/m);
    
    for (const block of speakerBlocks) {
      const lines = block.trim().split('\n');
      if (lines.length === 0) continue;
      
      let name = lines[0]
        .replace(/^###\s+/, '')
        .replace(/^\*\*|\*\*$/g, '')
        .replace(/^👤\s*/, '')
        .replace(/:$/, '')
        .trim();
      
      if (!name || name.length > 50) continue;
      
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
   * Legacy: Parse simple list items
   */
  parseListItemsLegacy(content) {
    return content
      .split('\n')
      .filter(l => l.trim().match(/^[-*•✓→\d.]/))
      .map(l => l.replace(/^[-*•✓→\d.\s]+/, '').trim())
      .filter(item => item.length > 0);
  }
}

module.exports = { MeetingSummarizer };
