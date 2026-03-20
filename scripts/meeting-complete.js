#!/usr/bin/env node
/**
 * Meeting Complete Handler
 * 
 * Called when a meeting ends to:
 * 1. Fetch final transcript from Recall.ai
 * 2. Save transcript to file
 * 3. Send webhook to agent for processing
 * 
 * Usage:
 *   node meeting-complete.js <botId>
 *   
 * Or triggered automatically by monitoring bot status.
 */

const path = require('path');
const { ConfigManager } = require('../lib/config-manager');
const { TokenClient } = require('../lib/token-client');
const { RecallClient } = require('../lib/recall-client');
const { StorageManager } = require('../lib/storage');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';

async function handleMeetingComplete(botId) {
  const configManager = new ConfigManager(DATA_DIR);
  const tokenClient = new TokenClient(TOKEN_MANAGER_URL);
  const storage = new StorageManager(DATA_DIR);
  
  const config = configManager.load();
  const apiKey = await tokenClient.get('Recall.ai');
  
  if (!apiKey) {
    console.error('Recall.ai API key not configured in token-manager');
    return { success: false, error: 'No API key' };
  }
  
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  console.log(`Processing completed meeting: ${botId}`);
  
  // Get bot details
  let bot;
  try {
    bot = await recall.getBotStatus(botId);
  } catch (e) {
    console.error('Failed to get bot status:', e.message);
    return { success: false, error: e.message };
  }
  
  // Get active meeting info
  const activeMeeting = storage.getActiveMeeting();
  const meeting = {
    id: botId,
    botId,
    title: activeMeeting?.title || 'Meeting',
    start: activeMeeting?.startedAt,
    platform: activeMeeting?.platform,
    url: activeMeeting?.url,
    duration: calculateDuration(bot.status_changes),
    attendees: extractAttendees(bot)
  };
  
  // Fetch transcript
  console.log('Fetching transcript...');
  let transcript = null;
  try {
    if (bot.transcript?.url) {
      const res = await fetch(bot.transcript.url);
      transcript = await res.json();
      console.log(`Got transcript with ${transcript?.length || 0} entries`);
    }
  } catch (e) {
    console.error('Failed to fetch transcript:', e.message);
  }
  
  // Save transcript to file
  let transcriptPath = null;
  if (transcript) {
    console.log('Saving transcript...');
    transcriptPath = storage.saveTranscript(meeting, transcript, {
      transcriptFormat: config.storage?.transcriptFormat,
      fileNamePattern: config.storage?.fileNamePattern,
      botName: config.bot?.name
    });
    console.log(`Saved to: ${transcriptPath}`);
  }
  
  // Clear active meeting
  storage.clearActiveMeeting();
  
  // Send webhook to agent
  if (config.webhook?.onMeetingEnd) {
    console.log('Sending webhook to agent...');
    await sendWebhook(config.webhook, meeting, transcript, transcriptPath);
  }
  
  return {
    success: true,
    meeting,
    transcriptPath,
    wordCount: countWords(transcript)
  };
}

function calculateDuration(statusChanges) {
  if (!statusChanges || statusChanges.length < 2) return null;
  
  const inCall = statusChanges.find(s => s.code === 'in_call_recording');
  const done = statusChanges.find(s => s.code === 'done');
  
  if (inCall && done) {
    const start = new Date(inCall.created_at);
    const end = new Date(done.created_at);
    return Math.round((end - start) / 1000);
  }
  
  return null;
}

function extractAttendees(bot) {
  // TODO: Extract from bot.participants if available
  return [];
}

function countWords(transcript) {
  if (!transcript || !Array.isArray(transcript)) return 0;
  return transcript.reduce((sum, entry) => {
    const text = entry.text || entry.words?.map(w => w.text).join(' ') || '';
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);
}

async function sendWebhook(webhookConfig, meeting, transcript, transcriptPath) {
  const { onMeetingEnd, includeTranscript = true, retryCount = 3 } = webhookConfig;
  
  const payload = {
    event: 'meeting.completed',
    timestamp: new Date().toISOString(),
    meeting: {
      id: meeting.botId,
      title: meeting.title,
      date: meeting.start,
      duration: meeting.duration,
      platform: meeting.platform,
      attendees: meeting.attendees
    },
    transcript: {
      path: transcriptPath,
      speakerCount: countSpeakers(transcript),
      wordCount: countWords(transcript)
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
      
      if (res.ok) {
        console.log(`✅ Webhook sent successfully`);
        return true;
      }
      
      console.log(`Webhook attempt ${attempt} failed: ${res.status}`);
    } catch (e) {
      console.log(`Webhook attempt ${attempt} error: ${e.message}`);
    }
    
    if (attempt < retryCount) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  
  console.error('❌ All webhook attempts failed');
  return false;
}

function countSpeakers(transcript) {
  if (!transcript || !Array.isArray(transcript)) return 0;
  const speakers = new Set();
  transcript.forEach(entry => {
    if (entry.speaker) speakers.add(entry.speaker);
  });
  return speakers.size;
}

// CLI invocation
if (require.main === module) {
  const botId = process.argv[2];
  if (!botId) {
    console.error('Usage: node meeting-complete.js <botId>');
    process.exit(1);
  }
  
  handleMeetingComplete(botId)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
    })
    .catch(e => {
      console.error('Error:', e);
      process.exit(1);
    });
}

module.exports = { handleMeetingComplete };
