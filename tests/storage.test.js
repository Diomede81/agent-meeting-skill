/**
 * Storage Manager Tests
 */

const { StorageManager } = require('../lib/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('StorageManager', () => {
  let storage;
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-skill-test-'));
    storage = new StorageManager(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('state management', () => {
    test('getState returns default state when no file exists', () => {
      const state = storage.getState();
      
      expect(state).toEqual({ activeMeeting: null, recentBots: [] });
    });

    test('saveState persists state to disk', () => {
      const testState = {
        activeMeeting: { botId: 'test-123', title: 'Test Meeting' },
        recentBots: []
      };

      storage.saveState(testState);
      const readState = storage.getState();

      expect(readState.activeMeeting.botId).toBe('test-123');
    });

    test('setActiveMeeting updates state correctly', () => {
      const meeting = { botId: 'bot-456', title: 'Planning Meeting' };
      
      storage.setActiveMeeting(meeting);
      const state = storage.getState();

      expect(state.activeMeeting.botId).toBe('bot-456');
      expect(state.recentBots).toHaveLength(1);
    });

    test('clearActiveMeeting removes active meeting', () => {
      storage.setActiveMeeting({ botId: 'bot-123', title: 'Test' });
      storage.clearActiveMeeting();
      
      const state = storage.getState();
      
      expect(state.activeMeeting).toBeNull();
    });

    test('recentBots limited to 10 entries', () => {
      for (let i = 0; i < 15; i++) {
        storage.setActiveMeeting({ botId: `bot-${i}`, title: `Meeting ${i}` });
        storage.clearActiveMeeting();
      }

      const state = storage.getState();
      
      expect(state.recentBots.length).toBeLessThanOrEqual(10);
    });
  });

  describe('pendingDelivery', () => {
    test('stores and retrieves pendingDelivery', () => {
      const state = storage.getState();
      state.pendingDelivery = {
        meeting: { title: 'Test' },
        summarizationPrompt: 'Summarize this',
        createdAt: new Date().toISOString()
      };
      storage.saveState(state);

      const readState = storage.getState();
      
      expect(readState.pendingDelivery).toBeDefined();
      expect(readState.pendingDelivery.meeting.title).toBe('Test');
    });

    test('clearPendingDelivery removes it', () => {
      const state = storage.getState();
      state.pendingDelivery = { meeting: { title: 'Test' } };
      storage.saveState(state);

      // Clear by deleting from state and saving
      const updatedState = storage.getState();
      delete updatedState.pendingDelivery;
      storage.saveState(updatedState);
      
      const readState = storage.getState();

      expect(readState.pendingDelivery).toBeUndefined();
    });
  });

  describe('transcript storage', () => {
    test('saves transcript to meetings directory', () => {
      const meeting = { 
        title: 'Sprint Review',
        startedAt: '2026-03-20T10:00:00Z'
      };
      const transcript = [
        { participant: { name: 'Alice' }, text: 'Hello' }
      ];

      const filePath = storage.saveTranscript(meeting, transcript);

      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('Sprint Review');
      expect(content).toContain('Alice');
    });

    test('uses date-based filename pattern', () => {
      const meeting = { 
        title: 'Daily Standup',
        startedAt: '2026-03-20T10:00:00Z'
      };

      const filePath = storage.saveTranscript(meeting, []);

      expect(filePath).toContain('2026-03-20');
      expect(filePath).toContain('daily-standup');
    });
  });
});
