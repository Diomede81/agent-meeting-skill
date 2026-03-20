#!/usr/bin/env node
/**
 * Calendar Poll Script
 * 
 * Checks calendar for upcoming meetings and auto-joins if configured.
 * Run via cron or as part of the main server.
 * 
 * Usage:
 *   node calendar-poll.js              # Check and join if meeting found
 *   node calendar-poll.js --dry-run    # Check only, don't join
 */

const path = require('path');
const { ConfigManager } = require('../lib/config-manager');
const { TokenClient } = require('../lib/token-client');
const { CalendarClient } = require('../lib/calendar-client');
const { StorageManager } = require('../lib/storage');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';
const DRY_RUN = process.argv.includes('--dry-run');
const API_URL = process.env.SKILL_API_URL || 'http://localhost:3030';

async function poll() {
  const configManager = new ConfigManager(DATA_DIR);
  const tokenClient = new TokenClient(TOKEN_MANAGER_URL);
  const storage = new StorageManager(DATA_DIR);
  
  const config = configManager.load();
  
  // Check if auto-join is enabled
  if (!config.meetings?.autoJoin) {
    console.log('Auto-join disabled in config');
    return;
  }
  
  // Check for active meeting
  const active = storage.getActiveMeeting();
  if (active) {
    console.log(`Already in meeting: ${active.title} (${active.botId})`);
    return;
  }
  
  // Check credentials via token-manager
  const apiKey = await tokenClient.get('Recall.ai');
  if (!apiKey) {
    console.log('Recall.ai API key not configured in token-manager');
    return;
  }
  
  // Check calendar config
  if (!config.calendar?.endpoint) {
    console.log('Calendar endpoint not configured');
    return;
  }
  
  // Get upcoming meetings
  console.log('Checking calendar for upcoming meetings...');
  const calendarClient = new CalendarClient(config.calendar);
  
  let meetings;
  try {
    meetings = await calendarClient.getUpcoming();
  } catch (e) {
    console.error('Failed to fetch calendar:', e.message);
    return;
  }
  
  if (meetings.length === 0) {
    console.log('No meetings starting soon');
    return;
  }
  
  // Filter by enabled platforms
  const enabledPlatforms = Object.entries(config.platforms || {})
    .filter(([_, enabled]) => enabled)
    .map(([platform]) => platform);
  
  const joinable = meetings.filter(m => 
    !m.platform || enabledPlatforms.includes(m.platform)
  );
  
  if (joinable.length === 0) {
    console.log(`Found ${meetings.length} meeting(s) but none on enabled platforms`);
    return;
  }
  
  // Take the first meeting
  const meeting = joinable[0];
  console.log(`\nFound meeting to join:`);
  console.log(`  Title: ${meeting.title}`);
  console.log(`  Start: ${meeting.start}`);
  console.log(`  Platform: ${meeting.platform}`);
  console.log(`  URL: ${meeting.meetingUrl}`);
  
  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would join this meeting');
    return;
  }
  
  // Join via API
  console.log('\nJoining meeting...');
  try {
    const res = await fetch(`${API_URL}/api/meetings/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: meeting.meetingUrl,
        title: meeting.title
      })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      console.log(`✅ Joined! Bot ID: ${data.botId}`);
    } else {
      console.error('❌ Failed to join:', data.error);
    }
  } catch (e) {
    console.error('❌ Error joining:', e.message);
  }
}

poll().catch(console.error);
