/**
 * Calendar Client Tests
 */

const { CalendarClient } = require('../lib/calendar-client');

describe('CalendarClient', () => {
  describe('filterAndFormat', () => {
    let client;
    
    beforeEach(() => {
      client = new CalendarClient({
        source: 'api',
        endpoint: 'http://localhost:3007/api/calendar',
        agent: 'luca',
        joinWindowMinutes: 5
      });
    });

    const createEvent = (startOffset, endOffset, hasUrl = true) => {
      const now = new Date();
      return {
        id: 'test-event-' + Math.random(),
        subject: 'Test Meeting',
        start: { dateTime: new Date(now.getTime() + startOffset * 60000).toISOString() },
        end: { dateTime: new Date(now.getTime() + endOffset * 60000).toISOString() },
        onlineMeeting: hasUrl ? { joinUrl: 'https://teams.microsoft.com/test' } : null,
        isOnlineMeeting: hasUrl
      };
    };

    test('includes meeting starting in 2 minutes (within window)', () => {
      const events = [createEvent(2, 32)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Test Meeting');
    });

    test('includes meeting starting now', () => {
      const events = [createEvent(0, 30)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(1);
    });

    test('includes meeting that started 2 minutes ago (just started)', () => {
      const events = [createEvent(-2, 28)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(1);
    });

    test('includes meeting currently in progress (started 10 min ago)', () => {
      const events = [createEvent(-10, 20)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(1);
    });

    test('excludes meeting starting in 10 minutes (outside window)', () => {
      const events = [createEvent(10, 40)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(0);
    });

    test('excludes meeting that ended 5 minutes ago', () => {
      const events = [createEvent(-35, -5)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(0);
    });

    test('excludes meeting without join URL', () => {
      const events = [createEvent(2, 32, false)];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(0);
    });

    test('sorts multiple meetings by start time', () => {
      const events = [
        createEvent(3, 33),
        createEvent(1, 31),
        createEvent(2, 32)
      ];
      const result = client.filterAndFormat(events);
      expect(result.length).toBe(3);
      // Should be sorted by start time (earliest first)
      const starts = result.map(r => new Date(r.start).getTime());
      expect(starts[0]).toBeLessThan(starts[1]);
      expect(starts[1]).toBeLessThan(starts[2]);
    });
  });
});
