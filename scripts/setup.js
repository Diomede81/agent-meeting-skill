#!/usr/bin/env node
/**
 * Agent Meeting Skill - Setup Script
 * 
 * Run this after installation to:
 * 1. Verify token-manager has Recall.ai API key
 * 2. Configure delivery channels
 * 3. Set up OpenClaw cron jobs for polling
 * 4. Register the skill's internal webhook processor
 * 
 * Usage: node scripts/setup.js [--interactive]
 */

const path = require('path');
const fs = require('fs');

const TOKEN_MANAGER_URL = process.env.TOKEN_MANAGER_URL || 'http://localhost:3021';
const SKILL_PORT = process.env.PORT || 3030;
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');

async function main() {
  console.log('🎤 Agent Meeting Skill - Setup\n');
  
  // Step 1: Check token-manager
  console.log('1️⃣ Checking token-manager...');
  try {
    const res = await fetch(`${TOKEN_MANAGER_URL}/api/search?q=Recall.ai`);
    const data = await res.json();
    
    if (data.found && data.token?.hasValue) {
      console.log('   ✅ Recall.ai API key found in token-manager');
    } else {
      console.log('   ❌ Recall.ai API key NOT found');
      console.log('   Run: curl -X POST http://localhost:3021/api/tokens \\');
      console.log('     -d \'{"service": "Recall.ai", "name": "RECALL_API_KEY", "value": "your-key"}\'');
      process.exit(1);
    }
  } catch (e) {
    console.log(`   ❌ Token manager not reachable: ${e.message}`);
    process.exit(1);
  }
  
  // Step 2: Check/create config
  console.log('\n2️⃣ Checking configuration...');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log('   ✅ Config exists');
  } catch {
    const defaultConfig = require('../config/default.json');
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    config = defaultConfig;
    console.log('   ✅ Created default config');
  }
  
  // Step 3: Set up internal webhook (skill processes its own completions)
  console.log('\n3️⃣ Configuring webhook...');
  
  // The skill will handle its own meeting completions internally
  // No external webhook needed - delivery happens directly from the skill
  config.webhook = {
    onMeetingEnd: null, // Disabled - skill handles delivery internally
    includeTranscript: true,
    retryCount: 3
  };
  
  // Ensure delivery is configured
  if (!config.delivery?.channels?.length) {
    console.log('   ⚠️  No delivery channels configured');
    console.log('   Configure via: curl -X PUT http://localhost:3030/api/delivery \\');
    console.log('     -d \'{"mode": "summary", "channels": [{"type": "whatsapp", "target": "+447402268975"}]}\'');
  } else {
    console.log(`   ✅ Delivery configured: ${config.delivery.mode} to ${config.delivery.channels.length} channel(s)`);
  }
  
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  
  // Step 4: Print cron job setup instructions
  console.log('\n4️⃣ Cron jobs...');
  console.log('   The skill provides cron job definitions at GET /api/cron');
  console.log('   Add to OpenClaw via the cron tool or config.');
  
  // Step 5: Verify skill is running
  console.log('\n5️⃣ Checking skill status...');
  try {
    const res = await fetch(`http://localhost:${SKILL_PORT}/api/status`);
    const status = await res.json();
    
    if (status.status === 'ok') {
      console.log('   ✅ Skill running on port ' + SKILL_PORT);
      console.log(`   ✅ Tokens configured: ${status.tokens?.every(t => t.hasValue) ? 'yes' : 'no'}`);
    }
  } catch {
    console.log('   ⚠️  Skill not running. Start with:');
    console.log('   systemctl --user start agent-meeting-skill');
  }
  
  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Configure delivery channels via /api/delivery');
  console.log('2. Test with: curl -X POST http://localhost:3030/api/meetings/join -d \'{"url": "..."}\'');
}

main().catch(console.error);
