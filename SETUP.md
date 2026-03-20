# Agent Meeting Skill - Setup Guide

## Prerequisites

1. **token-manager-skill** running on port 3021
2. **Microsoft Middleware** running on port 3007 (for calendar)
3. **Recall.ai API key** stored in token-manager database

## Step 1: Store Recall.ai API Key in Token Manager

**DO NOT create files in ~/.secrets/** - all API keys go in the token-manager database.

```bash
# Add via token-manager API
curl -X POST http://localhost:3021/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "service": "Recall.ai",
    "name": "RECALL_API_KEY",
    "value": "your-recall-api-key-here",
    "category": "api",
    "description": "Meeting bot API for agent-meeting-skill"
  }'

# Verify it's stored
curl "http://localhost:3021/api/search?q=Recall.ai" | jq '.token.hasValue'
# Should return: true
```

## Step 2: Install the Skill

```bash
cd ~/clawd/skills/agent-meeting-skill
npm install
```

## Step 3: Install Systemd Service

```bash
# Copy service file
mkdir -p ~/.config/systemd/user
cp service/agent-meeting-skill.service ~/.config/systemd/user/

# Enable and start
systemctl --user daemon-reload
systemctl --user enable agent-meeting-skill
systemctl --user start agent-meeting-skill

# Check status
systemctl --user status agent-meeting-skill
```

## Step 4: Configure the Skill

```bash
curl -X PUT http://localhost:3030/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "bot": {
      "name": "Max",
      "introMessage": "👋 Hi everyone, Max here — I am here to take notes."
    },
    "calendar": {
      "source": "api",
      "endpoint": "http://localhost:3007/api/calendar",
      "agent": "luca",
      "joinWindowMinutes": 5
    },
    "meetings": {
      "autoJoin": true,
      "sendIntroMessage": true
    },
    "webhook": {
      "onMeetingEnd": "http://localhost:18789/webhook/meeting-complete"
    }
  }'
```

## Step 5: Add OpenClaw Cron Jobs

The skill needs two cron jobs:
1. **Calendar poll** - check for meetings to join (every 5 min)
2. **Meeting check** - monitor active meetings (every 30 sec when active)

Add via OpenClaw cron tool or config.

## Step 6: Verify

```bash
# Check skill status
curl http://localhost:3030/api/status | jq

# Should show:
# - configured: true
# - tokens.allConfigured: true
```

## Troubleshooting

### "Recall.ai API key not configured"
Token not in database. Add via token-manager:
```bash
curl -X POST http://localhost:3021/api/tokens \
  -d '{"service": "Recall.ai", "name": "RECALL_API_KEY", "value": "your-key"}'
```

### "Calendar endpoint not configured"
Set calendar config:
```bash
curl -X PATCH http://localhost:3030/api/config \
  -d '{"calendar": {"endpoint": "http://localhost:3007/api/calendar", "agent": "luca"}}'
```

### Service won't start
Check logs:
```bash
journalctl --user -u agent-meeting-skill -f
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  OpenClaw Cron  │────▶│  Meeting Skill  │◀────┐
│  (poll/check)   │     │   (port 3030)   │     │
└─────────────────┘     └────────┬────────┘     │
                                 │              │
         ┌───────────────────────┼──────────────┤
         ▼                       ▼              │
┌─────────────────┐     ┌─────────────────┐    │
│ Token Manager   │     │   Recall.ai     │    │
│  (port 3021)    │     │   (API)         │    │
│  [credentials]  │     │  [meeting bot]  │    │
└─────────────────┘     └─────────────────┘    │
                                               │
┌─────────────────┐     ┌─────────────────┐    │
│ MS Middleware   │     │  Agent Webhook  │────┘
│  (port 3007)    │     │  (port 18789)   │
│  [calendar]     │     │  [transcript]   │
└─────────────────┘     └─────────────────┘
```
