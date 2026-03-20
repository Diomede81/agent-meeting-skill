---
name: agent-meeting-skill
description: Automatically join meetings, transcribe with speaker identification, and save notes. Platform agnostic (Teams, Zoom, Meet). Fully isolated skill with API configuration - installable on any OpenClaw agent.
---

# Agent Meeting Skill

Automated meeting attendance, transcription, and note-taking for AI agents.

## Design Principles

- **Fully Isolated** - No hardcoded paths or agent-specific dependencies
- **API-First** - All configuration via REST API (UI-ready)
- **Portable** - Install on any OpenClaw agent
- **Self-Contained** - Manages own data storage within skill directory

## Features

- 📅 **Calendar Integration** - Configurable calendar source via API
- 🎥 **Platform Agnostic** - Join Teams, Zoom, Google Meet
- 💬 **Chat Introduction** - Announce presence in meeting chat
- 🎙️ **Transcription** - Real-time transcription with speaker identification
- 🚪 **Auto Leave** - Detect meeting end and exit gracefully
- 📝 **Auto Save** - Process and save transcripts with proper naming

## API Endpoints

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/config | Get current configuration |
| PUT | /api/config | Update configuration |
| GET | /api/config/schema | JSON Schema for UI form generation |
| POST | /api/config/validate | Validate config without saving |

### Calendar

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/calendar/upcoming | List upcoming meetings |
| POST | /api/calendar/poll | Check calendar and auto-join (for cron) |
| POST | /api/calendar/test | Test calendar connection |

### Meetings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/meetings | List all saved transcripts |
| GET | /api/meetings/:id | Get specific transcript |
| DELETE | /api/meetings/:id | Delete a transcript |
| GET | /api/meetings/active | Get current active meeting |
| POST | /api/meetings/join | Join a meeting manually |
| POST | /api/meetings/leave | Leave current meeting |
| POST | /api/meetings/check | Check active meeting status (for cron) |

### Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/status | Skill health and current state |
| GET | /api/transcript/live | Live transcript (SSE stream) |

### Webhooks (Agent Notification)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/webhook/configure | Set webhook URL for notifications |
| GET | /api/webhook | Get current webhook config |

**Webhook Payload (sent to agent on meeting end):**
```json
{
  "event": "meeting.completed",
  "meeting": {
    "id": "abc123",
    "title": "Weekly Standup",
    "date": "2026-03-20T10:00:00Z",
    "duration": 2700,
    "platform": "teams",
    "attendees": ["Luca", "Masum", "Austin"]
  },
  "transcript": {
    "path": "meetings/2026-03-20_weekly-standup.md",
    "speakerCount": 3,
    "wordCount": 4521
  },
  "raw": "..." // Full transcript if includeTranscript=true
}
```

The agent receives this webhook and processes with its own model for:
- Summary generation
- Action item extraction
- Task assignment
- Follow-up scheduling

### Tokens (via token-manager)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/tokens | List required tokens and their status |
| GET | /api/tokens/verify | Verify all required tokens are configured |
| POST | /api/tokens/test/:service | Test a specific token |

## Configuration Schema

```json
{
  "bot": {
    "name": "Max",
    "introMessage": "👋 Hi, I'm {name} - I'm here to take notes for this meeting."
  },
  "calendar": {
    "source": "microsoft|google|ical",
    "endpoint": "http://localhost:3007/api/calendar",
    "agent": "luca",
    "pollIntervalMinutes": 5,
    "joinWindowMinutes": 5
  },
  "transcription": {
    "provider": "recall",
    "region": "eu-central-1",
    "speakerDiarization": true
  },
  "meetings": {
    "autoJoin": true,
    "autoLeave": true,
    "leaveDelaySeconds": 30,
    "sendIntroMessage": true
  },
  "storage": {
    "transcriptFormat": "markdown",
    "fileNamePattern": "{date}_{title}"
  },
  "platforms": {
    "teams": true,
    "zoom": true,
    "meet": true
  },
  "webhook": {
    "onMeetingEnd": "http://localhost:18789/webhook/meeting-complete",
    "includeTranscript": true
  }
}
```

## Agent Integration (Important)

**The skill does NOT summarize or extract actions.** It provides:
1. Raw transcript with speaker identification
2. Meeting metadata (title, date, attendees, duration)
3. Webhook notification when meeting ends

**The agent handles:**
- Summarization (using its own model)
- Action item extraction
- Action allocation to attendees
- Follow-up task creation
- Context-aware processing (knows people, projects, history)

This separation keeps the skill focused and lets the agent use its full context.

## OpenClaw Cron Integration

The skill provides two endpoints for cron-based automation:

### 1. Calendar Poll (check and auto-join)
```bash
POST /api/calendar/poll
```
Returns: `{ action: "joined"|"none"|"error", ... }`

### 2. Meeting Check (monitor active meeting)
```bash
POST /api/meetings/check
```
Returns: `{ status: "active"|"completed"|"idle"|"error", ... }`

### Recommended Cron Setup

Add these cron jobs via OpenClaw:

```javascript
// Poll calendar every 5 minutes (check for meetings to join)
{
  "name": "meeting-calendar-poll",
  "schedule": { "kind": "every", "everyMs": 300000 },
  "payload": { 
    "kind": "systemEvent", 
    "text": "[MEETING-SKILL] Poll calendar: curl -s -X POST http://localhost:3030/api/calendar/poll" 
  },
  "sessionTarget": "main"
}

// Check active meeting every 30 seconds (detect completion)
{
  "name": "meeting-status-check",
  "schedule": { "kind": "every", "everyMs": 30000 },
  "payload": { 
    "kind": "systemEvent", 
    "text": "[MEETING-SKILL] Check status: curl -s -X POST http://localhost:3030/api/meetings/check" 
  },
  "sessionTarget": "main"
}
```

Or the agent can call these endpoints directly when it receives a heartbeat.

## Credential Management (via token-manager-skill)

**This skill does NOT store credentials itself.** All API keys are managed via the centralized `token-manager-skill`.

### Required Tokens

Register these in token-manager before using this skill:

| Service | Location | Purpose |
|---------|----------|---------|
| `Recall.ai` | `~/.secrets/recall-api-key.txt` | Meeting bot API |

### Setup

1. Store the actual secret:
   ```bash
   echo "your-recall-api-key" > ~/.secrets/recall-api-key.txt
   chmod 600 ~/.secrets/recall-api-key.txt
   ```

2. Register in token-manager:
   ```bash
   curl -X POST http://localhost:3021/api/tokens \
     -H "Content-Type: application/json" \
     -d '{
       "service": "Recall.ai",
       "name": "API Key",
       "category": "api",
       "locationType": "file",
       "location": "~/.secrets/recall-api-key.txt",
       "notes": "Used by agent-meeting-skill"
     }'
   ```

3. Verify:
   ```bash
   curl http://localhost:3030/api/tokens/verify
   ```

## Data Storage

Skill data stored within skill directory, credentials via token-manager:

```
agent-meeting-skill/
├── data/
│   ├── config.json       # Skill configuration
│   ├── state.json        # Current state (active meeting, etc.)
│   └── meetings/         # Saved transcripts
│       ├── 2026-03-20_weekly-standup.md
│       └── 2026-03-21_project-review.md

~/.secrets/                # Managed by token-manager
└── recall-api-key.txt    # Recall.ai API key
```

## Installation

### Via ClawHub (recommended)
```bash
clawhub install agent-meeting-skill
```

### Manual
```bash
cd ~/.openclaw/skills/  # or agent's skill directory
git clone https://github.com/Diomede81/agent-meeting-skill.git
cd agent-meeting-skill
npm install
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| PORT | No | API server port (default: 3030) |
| DATA_DIR | No | Override data directory |
| TOKEN_MANAGER_URL | No | Token manager API URL (default: http://localhost:3021) |
| SECRETS_DIR | No | Override secrets directory (default: ~/.secrets) |

## Agent Integration

The skill exposes an API that agents query:

```bash
# Agent checks for meetings to join
curl http://localhost:3030/api/calendar/upcoming

# Agent can trigger manual join
curl -X POST http://localhost:3030/api/meetings/join \
  -d '{"url": "https://teams.microsoft.com/..."}'

# Agent can get live transcript
curl http://localhost:3030/api/transcript/live
```

## UI Integration

The skill is designed for UI configuration:

1. **Get Schema**: `GET /api/config/schema` returns JSON Schema
2. **Render Form**: UI generates form from schema
3. **Save Config**: `PUT /api/config` with form data
4. **Manage Credentials**: CRUD via `/api/credentials`

## File Structure

```
agent-meeting-skill/
├── SKILL.md              # This file
├── README.md             # Setup guide
├── package.json
├── config/
│   ├── default.json      # Default configuration
│   └── schema.json       # JSON Schema for UI
├── scripts/
│   ├── server.js         # API server (main entry)
│   ├── calendar-poll.js  # Calendar polling, auto-join
│   ├── monitor.js        # Meeting status monitoring
│   └── meeting-complete.js # Handle meeting end
├── lib/
│   ├── config-manager.js # Config CRUD
│   ├── token-client.js   # Token-manager integration
│   ├── recall-client.js  # Recall.ai API
│   ├── calendar-client.js # Calendar API
│   └── storage.js        # Data persistence
├── data/                 # Runtime data (gitignored)
│   ├── config.json
│   ├── state.json
│   └── meetings/
└── templates/
    └── transcript.md     # Transcript template
```

## Status Checklist

- [x] API server with Express
- [x] Config management (CRUD + schema)
- [x] Token-manager integration (replaces local credential storage)
- [x] Calendar integration (Microsoft Middleware)
- [x] Recall.ai client
- [x] Meeting join logic
- [x] Chat message sending
- [x] Meeting end detection
- [x] Transcript saving
- [x] Webhook notification to agent
- [ ] Live transcript SSE (real-time streaming)
- [ ] Google Calendar integration
- [ ] iCal integration
