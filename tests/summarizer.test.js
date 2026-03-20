/**
 * Summarizer Tests
 */

const { MeetingSummarizer } = require('../lib/summarizer');

describe('MeetingSummarizer', () => {
  let summarizer;

  beforeEach(() => {
    summarizer = new MeetingSummarizer({
      includeActionItems: true,
      includeSpeakerHighlights: true,
      includeDecisions: true,
      includeFollowUps: true
    });
  });

  describe('generatePrompt', () => {
    test('generates prompt with meeting details', () => {
      const meeting = { title: 'Sprint Planning', startedAt: '2026-03-20T10:00:00Z' };
      const transcript = [
        { participant: { name: 'Alice' }, text: 'Let us discuss the roadmap.' },
        { participant: { name: 'Bob' }, text: 'I will handle the API work.' }
      ];
      
      const prompt = summarizer.generatePrompt(meeting, transcript);
      
      expect(prompt).toContain('Sprint Planning');
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
      expect(prompt).toContain('actionItems');
      expect(prompt).toContain('JSON');
    });

    test('extracts attendees from transcript', () => {
      const transcript = [
        { participant: { name: 'Alice' }, text: 'Hello' },
        { participant: { name: 'Bob' }, text: 'Hi' },
        { participant: { name: 'Alice' }, text: 'Let us start' }
      ];
      
      const attendees = summarizer.extractAttendees(transcript);
      
      expect(attendees).toEqual(['Alice', 'Bob']);
    });

    test('handles empty transcript', () => {
      const meeting = { title: 'Empty Meeting' };
      const prompt = summarizer.generatePrompt(meeting, []);
      
      expect(prompt).toContain('Empty Meeting');
      // Empty array produces empty transcript text, null produces [No transcript available]
      expect(prompt).toContain('**Transcript:**');
    });
  });

  describe('parseResponse', () => {
    test('parses valid JSON response', () => {
      const response = JSON.stringify({
        overview: 'Team discussed Q2 goals.',
        actionItems: [
          { action: 'Review budget', assignee: 'Alice', deadline: 'Friday' }
        ],
        speakerHighlights: [
          { name: 'Bob', points: ['Presented metrics', 'Proposed timeline'] }
        ],
        decisions: ['Approved new feature'],
        followUps: ['Schedule design review']
      });

      const result = summarizer.parseResponse(response);

      expect(result.overview).toBe('Team discussed Q2 goals.');
      expect(result.actionItems).toHaveLength(1);
      expect(result.actionItems[0].action).toBe('Review budget');
      expect(result.actionItems[0].assignee).toBe('Alice');
      expect(result.speakerHighlights).toHaveLength(1);
      expect(result.decisions).toEqual(['Approved new feature']);
      expect(result.followUps).toEqual(['Schedule design review']);
    });

    test('parses JSON wrapped in markdown code block', () => {
      const response = '```json\n{"overview": "Test meeting", "actionItems": [], "speakerHighlights": [], "decisions": [], "followUps": []}\n```';
      
      const result = summarizer.parseResponse(response);
      
      expect(result.overview).toBe('Test meeting');
    });

    test('normalizes action items without assignee/deadline', () => {
      const response = JSON.stringify({
        overview: 'Test',
        actionItems: [
          { action: 'Do something' },
          { action: 'Do another thing', assignee: null }
        ],
        speakerHighlights: [],
        decisions: [],
        followUps: []
      });

      const result = summarizer.parseResponse(response);

      expect(result.actionItems[0].assignee).toBeNull();
      expect(result.actionItems[0].deadline).toBeNull();
    });

    test('returns empty structure for invalid JSON', () => {
      // Suppress expected console.error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const response = 'This is not valid JSON at all';
      const result = summarizer.parseResponse(response);
      
      // Should return default structure (legacy parser fallback)
      expect(result).toHaveProperty('overview');
      expect(result).toHaveProperty('actionItems');
      expect(Array.isArray(result.actionItems)).toBe(true);
      
      consoleSpy.mockRestore();
    });

    test('handles missing fields gracefully', () => {
      const response = JSON.stringify({
        overview: 'Partial response'
        // Missing other fields
      });

      const result = summarizer.parseResponse(response);

      expect(result.overview).toBe('Partial response');
      expect(result.actionItems).toEqual([]);
      expect(result.decisions).toEqual([]);
    });
  });
});
