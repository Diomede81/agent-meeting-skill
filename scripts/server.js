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
const { DeliveryManager } = require('../lib/delivery');
const { MeetingSummarizer } = require('../lib/summarizer');


// Initialize
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = process.env.PORT || 3030;
const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';

const configManager = new ConfigManager(DATA_DIR);
const tokenClient = new TokenClient(TOKEN_MANAGER_URL);
const storage = new StorageManager(DATA_DIR);


const app = express();
app.use(express.json({ limit: '10mb' }));

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
    // Fetch transcript from Recall.ai
    let transcript = null;
    let transcriptPath = null;
    
    try {
      transcript = await recall.getTranscript(active.botId);
    } catch (e) {
      console.error('Failed to fetch transcript:', e.message);
    }
    
    // Get meeting title from recording metadata
    const meetingTitle = recall.getMeetingTitle(bot) || active.title;
    
    const meeting = {
      ...active,
      title: meetingTitle,
      duration: calculateDuration(bot.status_changes),
      attendees: extractAttendees(transcript)
    };
    
    if (transcript) {
      transcriptPath = storage.saveTranscript(meeting, transcript, {
        transcriptFormat: config.storage?.transcriptFormat,
        fileNamePattern: config.storage?.fileNamePattern,
        botName: config.bot?.name
      });
    }
    
    storage.clearActiveMeeting();
    
    // Handle delivery based on config
    let deliveryResult = { delivered: false };
    const deliveryConfig = config.delivery;
    
    if (deliveryConfig?.mode && deliveryConfig.mode !== 'none' && deliveryConfig?.channels?.length > 0) {
      // Generate summary if needed
      let summary = null;
      if (deliveryConfig.mode === 'summary' || deliveryConfig.mode === 'both') {
        const summarizer = new MeetingSummarizer(deliveryConfig.summaryOptions || {});
        const prompt = summarizer.generatePrompt(meeting, transcript);
        
        // Store the prompt for the polling agent to process
        const state = storage.getState();
        state.pendingDelivery = {
          meeting,
          transcript,
          transcriptPath,
          summarizationPrompt: prompt,
          deliveryConfig,
          createdAt: new Date().toISOString()
        };
        storage.saveState(state);
      } else {
        // Transcript only - can deliver directly
        const delivery = new DeliveryManager(deliveryConfig);
        deliveryResult = await delivery.deliver(meeting, transcript, null);
      }
    }
    
    // Also send webhook if configured (for external integrations)
    let webhookSent = false;
    if (config.webhook?.onMeetingEnd) {
      webhookSent = await sendAgentWebhook(
        config.webhook, 
        config.delivery, 
        meeting, 
        transcript, 
        transcriptPath
      );
    }
    
    return res.json({
      status: 'completed',
      meeting: {
        title: meeting.title,
        duration: meeting.duration,
        transcriptPath,
        attendees: meeting.attendees
      },
      delivery: {
        mode: deliveryConfig?.mode || 'none',
        channels: (deliveryConfig?.channels || []).length,
        result: deliveryResult,
        pendingSummary: deliveryConfig?.mode === 'summary' || deliveryConfig?.mode === 'both'
      },
      webhookSent
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

function extractAttendees(transcript) {
  if (!transcript || !Array.isArray(transcript)) return [];
  const seen = new Set();
  return transcript
    .filter(entry => entry.participant?.name && !seen.has(entry.participant.name))
    .map(entry => {
      seen.add(entry.participant.name);
      return {
        name: entry.participant.name,
        isHost: entry.participant.is_host || false
      };
    });
}

async function sendAgentWebhook(webhookConfig, deliveryConfig, meeting, transcript, transcriptPath) {
  const { onMeetingEnd, includeTranscript = true, retryCount = 3 } = webhookConfig;
  
  // Generate summarization prompt if needed
  let summarizationPrompt = null;
  if (deliveryConfig?.mode === 'summary' || deliveryConfig?.mode === 'both') {
    const summarizer = new MeetingSummarizer(deliveryConfig?.summaryOptions || {});
    summarizationPrompt = summarizer.generatePrompt(meeting, transcript);
  }
  
  const payload = {
    event: 'meeting.completed',
    timestamp: new Date().toISOString(),
    meeting: {
      id: meeting.botId,
      title: meeting.title,
      date: meeting.startedAt,
      duration: meeting.duration,
      platform: meeting.platform,
      attendees: meeting.attendees
    },
    transcript: { path: transcriptPath },
    delivery: {
      mode: deliveryConfig?.mode || 'none',
      channels: deliveryConfig?.channels || [],
      summarizationPrompt
    }
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

// ============ DELIVERY ============

/**
 * Deliver transcript/summary to configured channels
 * Can be called manually or triggered after meeting
 */
app.post('/api/deliver/:botId', async (req, res) => {
  const { botId } = req.params;
  const { summary } = req.body; // Optional: pre-generated summary
  
  const config = configManager.load();
  const deliveryConfig = config.delivery;
  
  if (!deliveryConfig?.channels?.length) {
    return res.status(400).json({ 
      error: 'No delivery channels configured',
      hint: 'Configure delivery.channels in config'
    });
  }
  
  // Get stored transcript
  const meetings = storage.listMeetings();
  const meeting = meetings.find(m => m.includes(botId)) || meetings[meetings.length - 1];
  
  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  
  // Read the transcript file
  const transcriptPath = path.join(storage.meetingsDir, meeting);
  const transcriptContent = require('fs').readFileSync(transcriptPath, 'utf8');
  
  // For now, return the formatted content for agent to send
  const delivery = new DeliveryManager(deliveryConfig);
  
  // If mode is summary and no summary provided, return prompt
  if ((deliveryConfig.mode === 'summary' || deliveryConfig.mode === 'both') && !summary) {
    const summarizer = new MeetingSummarizer(deliveryConfig.summaryOptions || {});
    
    // Parse meeting info from filename
    const meetingInfo = {
      title: meeting.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/\.md$/, '').replace(/-/g, ' '),
      botId
    };
    
    return res.json({
      needsSummary: true,
      prompt: summarizer.generatePrompt(meetingInfo, [{ text: transcriptContent }]),
      meeting: meetingInfo,
      channels: deliveryConfig.channels.filter(c => c.enabled)
    });
  }
  
  // Deliver with summary
  res.json({
    ready: true,
    mode: deliveryConfig.mode,
    channels: deliveryConfig.channels.filter(c => c.enabled),
    summary: summary || null
  });
});

/**
 * Get pending delivery that needs agent processing (summary generation)
 */
app.get('/api/delivery/pending', (req, res) => {
  const state = storage.getState();
  
  if (!state.pendingDelivery) {
    return res.json({ pending: false });
  }
  
  res.json({
    pending: true,
    meeting: state.pendingDelivery.meeting,
    summarizationPrompt: state.pendingDelivery.summarizationPrompt,
    channels: state.pendingDelivery.deliveryConfig?.channels || [],
    createdAt: state.pendingDelivery.createdAt
  });
});

/**
 * Complete pending delivery with generated summary
 */
app.post('/api/delivery/complete', async (req, res) => {
  const { summary } = req.body;
  const state = storage.getState();
  
  if (!state.pendingDelivery) {
    return res.status(400).json({ error: 'No pending delivery' });
  }
  
  const { meeting, transcript, deliveryConfig } = state.pendingDelivery;
  
  // Parse summary if it's a string (raw AI response)
  let parsedSummary = summary;
  if (typeof summary === 'string') {
    const summarizer = new MeetingSummarizer(deliveryConfig?.summaryOptions || {});
    parsedSummary = summarizer.parseResponse(summary);
  }
  
  // Deliver
  const delivery = new DeliveryManager(deliveryConfig);
  const result = await delivery.deliver(meeting, transcript, parsedSummary);
  
  // Clear pending
  delete state.pendingDelivery;
  storage.saveState(state);
  
  res.json({
    success: true,
    deliveryResult: result
  });
});

/**
 * Get delivery configuration and available channels
 */
app.get('/api/delivery', (req, res) => {
  const config = configManager.load();
  const schema = configManager.getSchema();
  
  res.json({
    current: config.delivery || { mode: 'none', channels: [] },
    schema: schema.properties?.delivery,
    availableChannels: ['email', 'whatsapp', 'teams', 'slack', 'webhook']
  });
});

/**
 * Update delivery configuration
 */
app.put('/api/delivery', (req, res) => {
  const config = configManager.load();
  config.delivery = { ...config.delivery, ...req.body };
  configManager.save(config);
  
  res.json({ success: true, delivery: config.delivery });
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

// ============ CRON JOBS ============

/**
 * Get cron job definitions for OpenClaw
 * UI can use this to configure cron jobs
 */
app.get('/api/cron', (req, res) => {
  const config = configManager.load();
  const cron = config.cron || {};
  
  const jobs = [];
  
  if (cron.calendarPollEnabled !== false) {
    jobs.push({
      id: 'meeting-calendar-poll',
      name: 'Meeting Calendar Poll',
      description: 'Check calendar for upcoming meetings and auto-join',
      schedule: {
        kind: 'every',
        everyMs: cron.calendarPollIntervalMs || 300000
      },
      endpoint: `http://localhost:${PORT}/api/calendar/poll`,
      method: 'POST'
    });
  }
  
  if (cron.meetingCheckEnabled !== false) {
    jobs.push({
      id: 'meeting-status-check',
      name: 'Meeting Status Check',
      description: 'Monitor active meetings for completion',
      schedule: {
        kind: 'every',
        everyMs: cron.meetingCheckIntervalMs || 30000
      },
      endpoint: `http://localhost:${PORT}/api/meetings/check`,
      method: 'POST'
    });
  }
  
  res.json({
    enabled: jobs.length > 0,
    jobs,
    config: cron
  });
});

/**
 * GET /api/cron/jobs
 * Get cron job definitions ready for OpenClaw installation
 * 
 * The agent should use the OpenClaw cron tool to install these jobs:
 * cron(action=add, job=<job object from this endpoint>)
 */
app.get('/api/cron/jobs', (req, res) => {
  const config = configManager.load();
  const cron = config.cron || {};
  
  const jobs = [];
  
  // Calendar poll job
  if (cron.calendarPollEnabled !== false) {
    jobs.push({
      name: 'meeting-calendar-poll',
      schedule: {
        kind: 'every',
        everyMs: cron.calendarPollIntervalMs || 60000
      },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: `Poll calendar for upcoming meetings and auto-join:
1. GET http://localhost:${PORT}/api/calendar/upcoming - check for meetings starting within 5 minutes
2. For any meeting with a joinUrl, POST http://localhost:${PORT}/api/calendar/join/:meetingId
3. Reply NO_REPLY unless you joined a meeting or there was an error`,
        timeoutSeconds: 60
      },
      delivery: { mode: 'none' },
      enabled: true
    });
  }
  
  // Meeting status check job
  if (cron.meetingCheckEnabled !== false) {
    jobs.push({
      name: 'meeting-status-check',
      schedule: {
        kind: 'every',
        everyMs: cron.meetingCheckIntervalMs || 60000
      },
      sessionTarget: 'isolated',
      payload: {
        kind: 'agentTurn',
        message: `Check meeting skill for completed meetings and pending deliveries:
1. POST http://localhost:${PORT}/api/meetings/check - detect completed meetings
2. GET http://localhost:${PORT}/api/delivery/pending - check for pending summaries
3. If pending, generate summary from the prompt and POST to http://localhost:${PORT}/api/delivery/complete
4. Reply NO_REPLY unless there was an error`,
        timeoutSeconds: 120
      },
      delivery: { mode: 'none' },
      enabled: true
    });
  }
  
  res.json({
    jobs,
    instructions: 'Use OpenClaw cron tool to install: cron(action=add, job=<job>)'
  });
});

// ============ START ============

app.listen(PORT, () => {
  console.log(`Agent Meeting Skill API running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Token Manager: ${TOKEN_MANAGER_URL}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /api/status           - Health check`);
  console.log(`  GET  /api/config           - Get configuration`);
  console.log(`  PUT  /api/config           - Update configuration`);
  console.log(`  GET  /api/config/schema    - JSON Schema for UI`);
  console.log(`  GET  /api/tokens           - Check required tokens`);
  console.log(`  GET  /api/calendar/upcoming - Get upcoming meetings`);
  console.log(`  POST /api/calendar/poll    - Poll calendar (for cron)`);
  console.log(`  POST /api/meetings/join    - Join a meeting`);
  console.log(`  POST /api/meetings/leave   - Leave current meeting`);
  console.log(`  POST /api/meetings/check   - Check active meeting (for cron)`);
  console.log(`  GET  /api/meetings         - List saved transcripts`);
  console.log(`  GET  /api/delivery         - Get delivery configuration`);
  console.log(`  PUT  /api/delivery         - Update delivery configuration`);
  console.log(`  POST /api/deliver/:botId   - Deliver transcript/summary`);
  console.log(`  GET  /api/cron             - Get cron job definitions`);
});
