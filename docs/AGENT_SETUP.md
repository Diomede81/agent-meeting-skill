# Agent Meeting Skill - Setup Instructions

**Skill:** agent-meeting-skill  
**Version:** 1.0.0  
**Port:** 3030  
**Purpose:** Automatically join meetings, transcribe conversations, generate AI summaries, and deliver results via email.

---

## 🔧 Prerequisites

### Required Services

| Service | URL | Purpose |
|---------|-----|---------|
| **Token Manager** | http://localhost:3021 | Secure credential storage |
| **Microsoft Middleware** | http://localhost:3007 | Calendar access & email delivery |

**Check services are running:**
```bash
curl -s http://localhost:3021/api/status | jq '.status'
curl -s http://localhost:3007/health | jq '.status'
```

---

## 🔑 Required Tokens

Register these tokens in token-manager before using the skill:

### 1. Recall.ai API Key (REQUIRED)

```bash
curl -X POST http://localhost:3021/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "service": "Recall.ai",
    "name": "RECALL_API_KEY",
    "value": "<your-recall-api-key>",
    "region": "eu-central-1"
  }'
```

**Get a key:** https://www.recall.ai/ (Sign up for API access)

### Verify token is registered:
```bash
curl -s "http://localhost:3021/api/search?q=Recall.ai" | jq '.token.hasValue'
# Should return: true
```

---

## ⏰ Cron Jobs (REQUIRED)

Install these cron jobs for automatic operation:

### 1. Calendar Poll Job
Checks calendar every 60 seconds and auto-joins meetings.

```
cron(action=add, job={
  "name": "meeting-calendar-poll",
  "schedule": {"kind": "every", "everyMs": 60000},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Poll calendar for upcoming meetings and auto-join:\n1. GET http://localhost:3030/api/calendar/upcoming - check for meetings starting within 5 minutes\n2. For any meeting with a joinUrl, POST http://localhost:3030/api/calendar/join/:meetingId\n3. Reply NO_REPLY unless you joined a meeting or there was an error",
    "timeoutSeconds": 60
  },
  "delivery": {"mode": "none"},
  "enabled": true
})
```

### 2. Meeting Status Check Job
Monitors active meetings for completion and triggers delivery.

```
cron(action=add, job={
  "name": "meeting-status-check",
  "schedule": {"kind": "every", "everyMs": 60000},
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Check meeting skill for completed meetings and pending deliveries:\n1. POST http://localhost:3030/api/meetings/check - detect completed meetings\n2. GET http://localhost:3030/api/delivery/pending - check for pending summaries\n3. If pending, generate summary from the prompt and POST to http://localhost:3030/api/delivery/complete\n4. Reply NO_REPLY unless there was an error",
    "timeoutSeconds": 120
  },
  "delivery": {"mode": "none"},
  "enabled": true
})
```

**Get job definitions programmatically:**
```bash
curl -s http://localhost:3030/api/cron/jobs | jq '.jobs'
```

---

## 📧 Delivery Configuration

Configure where to send meeting summaries:

```bash
curl -X PUT http://localhost:3030/api/delivery \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "summary",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "target": "<recipient-email>",
        "agent": "max"
      }
    ]
  }'
```

**Delivery modes:**
- `summary` - AI-generated summary with action items (recommended)
- `both` - Summary + full transcript
- `none` - Save locally only

---

## 🤖 Bot Configuration

Set the bot name and intro message:

```bash
curl -X PUT http://localhost:3030/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "bot": {
      "name": "Max",
      "introMessage": "👋 Hi everyone, I'm Max - I'll be taking notes for this meeting."
    }
  }'
```

---

## 📅 Calendar Configuration

Configure calendar source (Microsoft 365 via middleware):

```bash
curl -X PUT http://localhost:3030/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "calendar": {
      "source": "api",
      "endpoint": "http://localhost:3007/api/calendar",
      "agent": "luca",
      "joinWindowMinutes": 5
    }
  }'
```

**Note:** The `agent` parameter should match the calendar owner in Microsoft Middleware.

---

## ✅ Verification Checklist

Run these checks to verify setup:

### 1. Skill Status
```bash
curl -s http://localhost:3030/api/status | jq
```
Expected: `status: "ok"`, tokens showing `hasValue: true`

### 2. Calendar Access
```bash
curl -s http://localhost:3030/api/calendar/upcoming | jq
```
Expected: List of upcoming meetings (may be empty if none scheduled)

### 3. Delivery Config
```bash
curl -s http://localhost:3030/api/delivery | jq '.current'
```
Expected: Your configured delivery settings

### 4. Test Join (manual)
```bash
curl -X POST http://localhost:3030/api/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"url": "<teams-meeting-url>"}'
```
Expected: `success: true` with botId

---

## 📡 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Health check and config summary |
| `/api/config` | GET/PUT | View/update configuration |
| `/api/config/schema` | GET | JSON Schema for UI forms |
| `/api/tokens` | GET | Check required tokens |
| `/api/calendar/upcoming` | GET | Get meetings starting soon |
| `/api/calendar/join/:id` | POST | Join a calendar meeting |
| `/api/meetings/join` | POST | Join meeting by URL |
| `/api/meetings/leave` | POST | Leave current meeting |
| `/api/meetings/check` | POST | Check for completed meetings |
| `/api/meetings` | GET | List saved transcripts |
| `/api/delivery` | GET/PUT | View/update delivery settings |
| `/api/delivery/pending` | GET | Check for pending summaries |
| `/api/delivery/complete` | POST | Submit summary and deliver |
| `/api/cron/jobs` | GET | Get cron job definitions |

---

## 🚨 Troubleshooting

### "Recall.ai API key not configured"
Register the token in token-manager (see Required Tokens section above).

### Meetings not auto-joining
1. Check cron jobs are installed: `cron(action=list)`
2. Verify calendar has `onlineMeeting.joinUrl` in events
3. Check `joinWindowMinutes` setting (default: 5 minutes before start)

### No email received after meeting
1. Check delivery config: `curl http://localhost:3030/api/delivery`
2. Verify Microsoft Middleware is running on port 3007
3. Check the `agent` parameter matches a valid email sender

### Bot joins but no transcript
1. Meeting must have audio/speech to transcribe
2. Check Recall.ai dashboard for bot status
3. Verify bot was admitted to the meeting (not stuck in lobby)

---

## 📂 Data Storage

- **Config:** `data/config.json`
- **State:** `data/state.json`
- **Transcripts:** `data/meetings/<botId>/`

---

## 🔗 Related Documentation

- **Recall.ai API:** https://docs.recall.ai/
- **Token Manager:** See token-manager-skill documentation
- **Microsoft Middleware:** See microsoft-middleware documentation

---

*This document was auto-generated. For updates, check `/api/setup` endpoint.*
