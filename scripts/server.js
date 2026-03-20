#!/usr/bin/env node
/**
 * Agent Meeting Skill - API Server
 * 
 * Provides REST API for:
 * - Configuration management
 * - Credential storage
 * - Calendar integration
 * - Meeting management (join, leave, status)
 * - Transcript access
 */

const express = require('express');
const path = require('path');

const { ConfigManager } = require('../lib/config-manager');
const { CredentialStore } = require('../lib/credential-store');
const { CalendarClient } = require('../lib/calendar-client');
const { RecallClient } = require('../lib/recall-client');
const { StorageManager } = require('../lib/storage');

// Initialize
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = process.env.PORT || 3030;

const configManager = new ConfigManager(DATA_DIR);
const credentialStore = new CredentialStore(DATA_DIR);
const storage = new StorageManager(DATA_DIR);

const app = express();
app.use(express.json());

// CORS for UI access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============ STATUS ============

app.get('/api/status', (req, res) => {
  const config = configManager.load();
  const hasRecallKey = credentialStore.has('recall_api_key');
  const activeMeeting = storage.getActiveMeeting();
  
  res.json({
    status: 'ok',
    version: '1.0.0',
    configured: hasRecallKey,
    activeMeeting: activeMeeting ? {
      botId: activeMeeting.botId,
      title: activeMeeting.title,
      startedAt: activeMeeting.startedAt
    } : null,
    config: {
      botName: config.bot?.name,
      calendarSource: config.calendar?.source,
      webhookConfigured: !!config.webhook?.onMeetingEnd
    }
  });
});

// ============ CONFIGURATION ============

app.get('/api/config', (req, res) => {
  const config = configManager.load();
  res.json(config);
});

app.put('/api/config', (req, res) => {
  const validation = configManager.validate(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: 'Validation failed', errors: validation.errors });
  }
  
  const config = configManager.save(req.body);
  res.json({ success: true, config });
});

app.patch('/api/config', (req, res) => {
  const config = configManager.update(req.body);
  const validation = configManager.validate(config);
  
  res.json({ success: true, config, warnings: validation.errors });
});

app.get('/api/config/schema', (req, res) => {
  const schema = configManager.getSchema();
  if (!schema) {
    return res.status(404).json({ error: 'Schema not found' });
  }
  res.json(schema);
});

app.post('/api/config/validate', (req, res) => {
  const validation = configManager.validate(req.body);
  res.json(validation);
});

// ============ CREDENTIALS ============

app.get('/api/credentials', (req, res) => {
  const credentials = credentialStore.list();
  res.json({ credentials });
});

app.post('/api/credentials', (req, res) => {
  const { name, value } = req.body;
  if (!name || !value) {
    return res.status(400).json({ error: 'name and value required' });
  }
  
  credentialStore.set(name, value);
  res.json({ success: true, message: `Credential '${name}' saved` });
});

app.delete('/api/credentials/:name', (req, res) => {
  credentialStore.delete(req.params.name);
  res.json({ success: true, message: `Credential '${req.params.name}' deleted` });
});

app.post('/api/credentials/test/:name', async (req, res) => {
  const result = await credentialStore.test(req.params.name);
  res.json(result);
});

// ============ CALENDAR ============

app.get('/api/calendar/upcoming', async (req, res) => {
  try {
    const config = configManager.load();
    const client = new CalendarClient(config.calendar);
    const meetings = await client.getUpcoming();
    res.json({ meetings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/calendar/test', async (req, res) => {
  try {
    const config = configManager.load();
    const client = new CalendarClient(config.calendar);
    const result = await client.test();
    res.json(result);
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ============ MEETINGS ============

app.get('/api/meetings', (req, res) => {
  const meetings = storage.listMeetings();
  res.json({ meetings });
});

app.get('/api/meetings/active', async (req, res) => {
  const active = storage.getActiveMeeting();
  
  if (!active) {
    return res.json({ active: false });
  }
  
  // Get latest status from Recall
  try {
    const apiKey = credentialStore.get('recall_api_key');
    if (apiKey) {
      const config = configManager.load();
      const recall = new RecallClient({ apiKey, region: config.transcription?.region });
      const bot = await recall.getBotStatus(active.botId);
      
      return res.json({
        active: true,
        meeting: active,
        status: recall.getStatusCode(bot),
        isComplete: recall.isComplete(bot)
      });
    }
  } catch (e) {
    // Ignore errors, return cached state
  }
  
  res.json({ active: true, meeting: active });
});

app.get('/api/meetings/:id', (req, res) => {
  const meeting = storage.getMeeting(req.params.id);
  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  res.json(meeting);
});

app.delete('/api/meetings/:id', (req, res) => {
  const deleted = storage.deleteMeeting(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  res.json({ success: true });
});

// ============ JOIN/LEAVE ============

app.post('/api/meetings/join', async (req, res) => {
  const { url, meetingUrl } = req.body;
  const meeting_url = url || meetingUrl;
  
  if (!meeting_url) {
    return res.status(400).json({ error: 'Meeting URL required' });
  }
  
  // Check for active meeting
  const active = storage.getActiveMeeting();
  if (active) {
    return res.status(409).json({ 
      error: 'Already in a meeting', 
      activeMeeting: active 
    });
  }
  
  // Get credentials and config
  const apiKey = credentialStore.get('recall_api_key');
  if (!apiKey) {
    return res.status(400).json({ error: 'Recall API key not configured' });
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  try {
    // Build intro message
    const botName = config.bot?.name || 'Meeting Assistant';
    let introMessage = null;
    if (config.meetings?.sendIntroMessage !== false) {
      introMessage = (config.bot?.introMessage || "👋 Hi, I'm {name} - I'm here to take notes for this meeting.")
        .replace('{name}', botName);
    }
    
    // Create bot
    const bot = await recall.createBot({
      meetingUrl: meeting_url,
      botName,
      introMessage
    });
    
    // Save active meeting state
    const meeting = {
      botId: bot.id,
      title: req.body.title || 'Meeting',
      url: meeting_url,
      platform: RecallClient.detectPlatform(meeting_url),
      startedAt: new Date().toISOString()
    };
    storage.setActiveMeeting(meeting);
    
    res.json({ 
      success: true, 
      botId: bot.id,
      meeting
    });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.data });
  }
});

app.post('/api/meetings/leave', async (req, res) => {
  const active = storage.getActiveMeeting();
  if (!active) {
    return res.status(400).json({ error: 'No active meeting' });
  }
  
  const apiKey = credentialStore.get('recall_api_key');
  if (!apiKey) {
    storage.clearActiveMeeting();
    return res.json({ success: true, message: 'Cleared local state (no API key)' });
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  try {
    await recall.leaveBot(active.botId);
    storage.clearActiveMeeting();
    res.json({ success: true, message: 'Left meeting' });
  } catch (e) {
    storage.clearActiveMeeting();
    res.json({ success: true, message: 'Cleared local state', warning: e.message });
  }
});

// ============ BOT STATUS ============

app.get('/api/bot/:botId', async (req, res) => {
  const apiKey = credentialStore.get('recall_api_key');
  if (!apiKey) {
    return res.status(400).json({ error: 'Recall API key not configured' });
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  try {
    const bot = await recall.getBotStatus(req.params.botId);
    res.json({
      id: bot.id,
      status: recall.getStatusCode(bot),
      statusHistory: bot.status_changes,
      isActive: recall.isActive(bot),
      isComplete: recall.isComplete(bot),
      video: bot.video_url,
      audio: bot.audio_url,
      transcript: bot.transcript?.url
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ TRANSCRIPT ============

app.get('/api/transcript/:botId', async (req, res) => {
  const apiKey = credentialStore.get('recall_api_key');
  if (!apiKey) {
    return res.status(400).json({ error: 'Recall API key not configured' });
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  try {
    const transcript = await recall.getTranscript(req.params.botId);
    res.json({ transcript });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ WEBHOOK RECEIVER ============

// Receive real-time transcript updates from Recall
app.post('/webhook/transcript', (req, res) => {
  // Store transcript updates in state for live streaming
  const active = storage.getActiveMeeting();
  if (active) {
    const state = storage.getState();
    state.liveTranscript = state.liveTranscript || [];
    state.liveTranscript.push(req.body);
    storage.saveState(state);
  }
  res.sendStatus(200);
});

// ============ START ============

app.listen(PORT, () => {
  console.log(`Agent Meeting Skill API running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/status           - Health check`);
  console.log(`  GET  /api/config           - Get configuration`);
  console.log(`  PUT  /api/config           - Update configuration`);
  console.log(`  GET  /api/config/schema    - Get JSON Schema`);
  console.log(`  GET  /api/credentials      - List credentials`);
  console.log(`  POST /api/credentials      - Add credential`);
  console.log(`  GET  /api/calendar/upcoming - Get upcoming meetings`);
  console.log(`  POST /api/meetings/join    - Join a meeting`);
  console.log(`  POST /api/meetings/leave   - Leave current meeting`);
  console.log(`  GET  /api/meetings         - List saved transcripts`);
});
