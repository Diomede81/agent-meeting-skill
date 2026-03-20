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
const { TokenClient } = require('../lib/token-client');
const { CalendarClient } = require('../lib/calendar-client');
const { RecallClient } = require('../lib/recall-client');
const { StorageManager } = require('../lib/storage');

// Initialize
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = process.env.PORT || 3030;
const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';

const configManager = new ConfigManager(DATA_DIR);
const tokenClient = new TokenClient(TOKEN_MANAGER_URL);
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

app.get('/api/status', async (req, res) => {
  const config = configManager.load();
  const tokenCheck = await tokenClient.checkRequiredTokens();
  const activeMeeting = storage.getActiveMeeting();
  
  res.json({
    status: 'ok',
    version: '1.0.0',
    configured: tokenCheck.allConfigured,
    tokens: tokenCheck.tokens,
    tokenManagerUrl: TOKEN_MANAGER_URL,
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

// ============ TOKENS (via token-manager-skill) ============

app.get('/api/tokens', async (req, res) => {
  const required = TokenClient.getRequiredTokens();
  const check = await tokenClient.checkRequiredTokens();
  
  res.json({
    tokenManagerUrl: TOKEN_MANAGER_URL,
    required,
    status: check
  });
});

app.get('/api/tokens/verify', async (req, res) => {
  const check = await tokenClient.checkRequiredTokens();
  res.json(check);
});

app.post('/api/tokens/test/:service', async (req, res) => {
  const result = await tokenClient.verify(req.params.service);
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

/**
 * Poll calendar and auto-join meetings
 * Called by OpenClaw cron or agent directly
 */
app.post('/api/calendar/poll', async (req, res) => {
  const config = configManager.load();
  
  // Check if auto-join is enabled
  if (!config.meetings?.autoJoin) {
    return res.json({ action: 'none', reason: 'Auto-join disabled' });
  }
  
  // Check for active meeting
  const active = storage.getActiveMeeting();
  if (active) {
    return res.json({ 
      action: 'none', 
      reason: 'Already in meeting',
      activeMeeting: { title: active.title, botId: active.botId }
    });
  }
  
  // Check credentials
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    return res.status(400).json({ 
      action: 'error', 
      reason: 'Recall.ai API key not configured' 
    });
  }
  
  // Check calendar config
  if (!config.calendar?.endpoint) {
    return res.status(400).json({ 
      action: 'error', 
      reason: 'Calendar endpoint not configured' 
    });
  }
  
  // Get upcoming meetings
  let meetings;
  try {
    const calendarClient = new CalendarClient(config.calendar);
    meetings = await calendarClient.getUpcoming();
  } catch (e) {
    return res.status(500).json({ action: 'error', reason: e.message });
  }
  
  if (meetings.length === 0) {
    return res.json({ action: 'none', reason: 'No meetings starting soon' });
  }
  
  // Filter by enabled platforms
  const enabledPlatforms = Object.entries(config.platforms || {})
    .filter(([_, enabled]) => enabled)
    .map(([platform]) => platform);
  
  const joinable = meetings.filter(m => 
    !m.platform || enabledPlatforms.includes(m.platform)
  );
  
  if (joinable.length === 0) {
    return res.json({ 
      action: 'none', 
      reason: 'Found meetings but none on enabled platforms',
      meetings: meetings.map(m => ({ title: m.title, platform: m.platform }))
    });
  }
  
  // Join first meeting
  const meeting = joinable[0];
  
  try {
    const recall = new RecallClient({ apiKey, region: config.transcription?.region });
    
    const botName = config.bot?.name || 'Meeting Assistant';
    let introMessage = null;
    if (config.meetings?.sendIntroMessage !== false) {
      introMessage = (config.bot?.introMessage || "👋 Hi, I'm {name} - I'm here to take notes.")
        .replace('{name}', botName);
    }
    
    const bot = await recall.createBot({
      meetingUrl: meeting.meetingUrl,
      botName,
      introMessage
    });
    
    // Save state
    const meetingState = {
      botId: bot.id,
      title: meeting.title,
      url: meeting.meetingUrl,
      platform: meeting.platform,
      startedAt: new Date().toISOString(),
      calendarEventId: meeting.id
    };
    storage.setActiveMeeting(meetingState);
    
    res.json({
      action: 'joined',
      meeting: meetingState,
      message: `Joined "${meeting.title}" on ${meeting.platform}`
    });
  } catch (e) {
    res.status(500).json({ action: 'error', reason: e.message });
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
    const apiKey = await tokenClient.get('Recall.ai');
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
  
  // Get credentials via token-manager
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    return res.status(400).json({ 
      error: 'Recall.ai API key not configured',
      help: 'Add token via token-manager: POST http://localhost:3021/api/tokens with service "Recall.ai" and location "~/.secrets/recall-api-key.txt"'
    });
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
  
  const apiKey = await tokenClient.get('Recall.ai');
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
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    return res.status(400).json({ error: 'Recall.ai API key not configured' });
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
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    return res.status(400).json({ error: 'Recall.ai API key not configured' });
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

// ============ MONITOR ACTIVE MEETING ============

/**
 * Check status of active meeting and handle completion
 * Called by OpenClaw cron or agent directly
 */
app.post('/api/meetings/check', async (req, res) => {
  const active = storage.getActiveMeeting();
  
  if (!active) {
    return res.json({ status: 'idle', message: 'No active meeting' });
  }
  
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    return res.json({ status: 'error', message: 'No API key' });
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ apiKey, region: config.transcription?.region });
  
  let bot;
  try {
    bot = await recall.getBotStatus(active.botId);
  } catch (e) {
    return res.json({ status: 'error', message: e.message });
  }
  
  const statusCode = recall.getStatusCode(bot);
  
  // Check if meeting completed
  if (recall.isComplete(bot)) {
    // Fetch and save transcript
    let transcript = null;
    let transcriptPath = null;
    
    try {
      if (bot.transcript?.url) {
        const transcriptRes = await fetch(bot.transcript.url);
        transcript = await transcriptRes.json();
      }
    } catch (e) {
      console.error('Failed to fetch transcript:', e.message);
    }
    
    const meeting = {
      ...active,
      duration: calculateDuration(bot.status_changes),
      attendees: []
    };
    
    if (transcript) {
      transcriptPath = storage.saveTranscript(meeting, transcript, {
        transcriptFormat: config.storage?.transcriptFormat,
        fileNamePattern: config.storage?.fileNamePattern,
        botName: config.bot?.name
      });
    }
    
    storage.clearActiveMeeting();
    
    // Send webhook to agent
    if (config.webhook?.onMeetingEnd) {
      await sendAgentWebhook(config.webhook, meeting, transcript, transcriptPath);
    }
    
    return res.json({
      status: 'completed',
      meeting: {
        title: meeting.title,
        duration: meeting.duration,
        transcriptPath
      },
      webhookSent: !!config.webhook?.onMeetingEnd
    });
  }
  
  // Still active
  return res.json({
    status: 'active',
    botStatus: statusCode,
    meeting: {
      title: active.title,
      botId: active.botId,
      startedAt: active.startedAt
    }
  });
});

function calculateDuration(statusChanges) {
  if (!statusChanges || statusChanges.length < 2) return null;
  const inCall = statusChanges.find(s => s.code === 'in_call_recording');
  const done = statusChanges.find(s => s.code === 'done');
  if (inCall && done) {
    return Math.round((new Date(done.created_at) - new Date(inCall.created_at)) / 1000);
  }
  return null;
}

async function sendAgentWebhook(webhookConfig, meeting, transcript, transcriptPath) {
  const { onMeetingEnd, includeTranscript = true, retryCount = 3 } = webhookConfig;
  
  const payload = {
    event: 'meeting.completed',
    timestamp: new Date().toISOString(),
    meeting: {
      id: meeting.botId,
      title: meeting.title,
      date: meeting.startedAt,
      duration: meeting.duration,
      platform: meeting.platform
    },
    transcript: { path: transcriptPath }
  };
  
  if (includeTranscript && transcript) {
    payload.raw = transcript;
  }
  
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const res = await fetch(onMeetingEnd, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) return true;
    } catch (e) {
      console.error(`Webhook attempt ${attempt} failed:`, e.message);
    }
    if (attempt < retryCount) await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  return false;
}

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
