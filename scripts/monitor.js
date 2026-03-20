#!/usr/bin/env node
/**
 * Meeting Monitor
 * 
 * Polls active meeting status and triggers completion handler when done.
 * Run alongside the main server or as a separate process.
 * 
 * Usage:
 *   node monitor.js                    # Run once
 *   node monitor.js --continuous       # Run continuously (every 30s)
 */

const path = require('path');
const { ConfigManager } = require('../lib/config-manager');
const { CredentialStore } = require('../lib/credential-store');
const { RecallClient } = require('../lib/recall-client');
const { StorageManager } = require('../lib/storage');
const { handleMeetingComplete } = require('./meeting-complete');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30000'); // 30 seconds
const CONTINUOUS = process.argv.includes('--continuous');

async function checkMeetingStatus() {
  const configManager = new ConfigManager(DATA_DIR);
  const credentialStore = new CredentialStore(DATA_DIR);
  const storage = new StorageManager(DATA_DIR);
  
  const active = storage.getActiveMeeting();
  
  if (!active) {
    return { status: 'idle', message: 'No active meeting' };
  }
  
  const apiKey = credentialStore.get('recall_api_key');
  if (!apiKey) {
    return { status: 'error', message: 'No API key configured' };
  }
  
  const config = configManager.load();
  const recall = new RecallClient({ 
    apiKey, 
    region: config.transcription?.region 
  });
  
  let bot;
  try {
    bot = await recall.getBotStatus(active.botId);
  } catch (e) {
    return { status: 'error', message: e.message };
  }
  
  const statusCode = recall.getStatusCode(bot);
  
  console.log(`[${new Date().toISOString()}] Meeting: ${active.title} | Status: ${statusCode}`);
  
  // Check if meeting is complete
  if (recall.isComplete(bot)) {
    console.log('Meeting completed, processing...');
    
    // Handle completion
    const result = await handleMeetingComplete(active.botId);
    
    return {
      status: 'completed',
      botId: active.botId,
      result
    };
  }
  
  // Check for fatal errors
  if (statusCode === 'fatal') {
    console.log('Meeting ended with fatal error');
    storage.clearActiveMeeting();
    return {
      status: 'error',
      message: 'Meeting ended with fatal error',
      botStatus: bot.status_changes
    };
  }
  
  return {
    status: 'active',
    botId: active.botId,
    botStatus: statusCode,
    title: active.title
  };
}

async function runOnce() {
  const result = await checkMeetingStatus();
  console.log('Result:', JSON.stringify(result, null, 2));
  return result;
}

async function runContinuous() {
  console.log(`Starting continuous monitor (interval: ${POLL_INTERVAL}ms)`);
  
  while (true) {
    try {
      await checkMeetingStatus();
    } catch (e) {
      console.error('Monitor error:', e.message);
    }
    
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// CLI
if (require.main === module) {
  if (CONTINUOUS) {
    runContinuous().catch(console.error);
  } else {
    runOnce().catch(console.error);
  }
}

module.exports = { checkMeetingStatus };
