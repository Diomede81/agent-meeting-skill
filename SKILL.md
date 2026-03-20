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
| POST | /api/calendar/source | Configure calendar source |
| GET | /api/calendar/source | Get calendar source config |
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

### Credentials

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/credentials | List configured credentials (masked) |
| POST | /api/credentials | Add/update a credential |
| DELETE | /api/credentials/:name | Remove a credential |
| POST | /api/credentials/test/:name | Test a credential |

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

## Credential Management

Credentials stored locally in skill's `data/` directory (encrypted):

| Credential | Required For |
|------------|--------------|
| `recall_api_key` | Recall.ai meeting bot |
| `calendar_token` | Calendar API access (if not using middleware) |
| `openai_api_key` | Summarization (optional) |

## Data Storage

All data stored within skill directory:

```
agent-meeting-skill/
├── data/
│   ├── config.json       # User configuration
│   ├── credentials.enc   # Encrypted credentials
│   ├── state.json        # Current state (active meeting, etc.)
│   └── meetings/         # Saved transcripts
│       ├── 2026-03-20_weekly-standup.md
│       └── 2026-03-21_project-review.md
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
│   └── schema.json       # JSON Schema for config
├── scripts/
│   ├── server.js         # API server (main entry)
│   ├── calendar.js       # Calendar integration
│   ├── meeting-bot.js    # Meeting join/leave
│   └── transcript.js     # Transcript processing
├── lib/
│   ├── config-manager.js # Config CRUD
│   ├── credential-store.js # Encrypted credential storage
│   ├── recall-client.js  # Recall.ai API
│   └── storage.js        # Data persistence
├── data/                 # Runtime data (gitignored)
│   ├── config.json
│   ├── credentials.enc
│   └── meetings/
└── templates/
    └── transcript.md     # Transcript template
```

## Status Checklist

- [ ] API server with Express
- [ ] Config management (CRUD + schema)
- [ ] Credential storage (encrypted)
- [ ] Calendar integration (pluggable sources)
- [ ] Recall.ai client
- [ ] Meeting join logic
- [ ] Chat message sending
- [ ] Transcription streaming
- [ ] Meeting end detection
- [ ] Transcript saving
- [ ] Live transcript SSE
- [ ] Webhook notification to agent
