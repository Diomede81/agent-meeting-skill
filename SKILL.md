# Agent Meeting Skill

Automated meeting attendance, transcription, and intelligent note-taking for OpenClaw agents.

## Features

- **Auto-join meetings** from calendar within configurable window
- **Real-time transcription** via Recall.ai with speaker identification
- **AI-powered summaries** with action items, decisions, and speaker highlights
- **Multi-channel delivery** — send transcripts/summaries to email, WhatsApp, Teams, Slack, or webhooks
- **Supports** Microsoft Teams, Zoom, Google Meet

## Quick Start

```bash
# 1. Ensure token-manager is running (port 3021)
# 2. Add Recall.ai API key to token-manager
curl -X POST http://localhost:3021/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"service": "Recall.ai", "name": "RECALL_API_KEY", "value": "your-key"}'

# 3. Install and start the skill
cd ~/clawd/skills/agent-meeting-skill
npm install
systemctl --user enable --now agent-meeting-skill

# 4. Configure delivery
curl -X PUT http://localhost:3030/api/delivery \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "summary",
    "channels": [
      {"type": "whatsapp", "enabled": true, "target": "+447402268975"},
      {"type": "email", "enabled": true, "target": "you@example.com", "agent": "max"}
    ]
  }'
```

## Configuration

### Delivery Modes

| Mode | Description |
|------|-------------|
| `transcript` | Send raw transcript only |
| `summary` | AI-generated summary with action items and speaker highlights |
| `both` | Send both transcript and summary |
| `none` | Save locally only, no delivery |

### Delivery Channels

| Channel | Target Format | Notes |
|---------|---------------|-------|
| `email` | Email address | Requires `agent` for sender account |
| `whatsapp` | Phone number | E.164 format (+447...) |
| `teams` | Chat ID | Teams chat/channel ID |
| `slack` | Channel | #channel or webhook URL |
| `webhook` | URL | POST with JSON payload |

### Summary Options

```json
{
  "summaryOptions": {
    "includeActionItems": true,
    "includeSpeakerHighlights": true,
    "includeDecisions": true,
    "includeFollowUps": true,
    "maxLength": 0
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Health check |
| `/api/config` | GET/PUT | Configuration |
| `/api/config/schema` | GET | JSON Schema for UI |
| `/api/delivery` | GET/PUT | Delivery configuration |
| `/api/deliver/:botId` | POST | Manually deliver transcript |
| `/api/meetings/join` | POST | Join meeting by URL |
| `/api/meetings/check` | POST | Check active meeting status |
| `/api/calendar/poll` | POST | Poll calendar for meetings |
| `/api/cron` | GET | Get cron job definitions |

## Example: Join a Meeting

```bash
curl -X POST http://localhost:3030/api/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"url": "https://teams.microsoft.com/l/meetup-join/..."}'
```

## Example: Configure via API

```bash
# Set to transcript-only delivery via email
curl -X PUT http://localhost:3030/api/delivery \
  -d '{"mode": "transcript", "channels": [{"type": "email", "target": "you@example.com"}]}'

# Set to summary via WhatsApp and Teams
curl -X PUT http://localhost:3030/api/delivery \
  -d '{
    "mode": "summary",
    "channels": [
      {"type": "whatsapp", "target": "+447402268975"},
      {"type": "teams", "target": "19:abc123@thread.v2"}
    ]
  }'
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  OpenClaw Cron  │────▶│  Meeting Skill  │
│  (poll/check)   │     │   (port 3030)   │
└─────────────────┘     └────────┬────────┘
                                 │
         ┌───────────────────────┼───────────────────┐
         ▼                       ▼                   ▼
┌─────────────────┐     ┌─────────────────┐ ┌──────────────┐
│ Token Manager   │     │   Recall.ai     │ │  MS Middleware│
│  (port 3021)    │     │   (meeting bot) │ │  (port 3007)  │
└─────────────────┘     └─────────────────┘ └──────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Delivery Manager │
                        │ (email/WA/Teams) │
                        └─────────────────┘
```

## Webhook Payload

When a meeting completes, the skill sends a webhook with:

```json
{
  "event": "meeting.completed",
  "timestamp": "2026-03-20T15:46:00.000Z",
  "meeting": {
    "id": "bot-uuid",
    "title": "Meeting Title",
    "date": "2026-03-20T15:30:00.000Z",
    "duration": 960,
    "platform": "teams",
    "attendees": [{"name": "Luca Licata", "isHost": true}]
  },
  "transcript": {"path": "/path/to/transcript.md"},
  "delivery": {
    "mode": "summary",
    "channels": [...],
    "summarizationPrompt": "..."
  },
  "raw": [...]
}
```

## Dependencies

- **token-manager-skill** (port 3021) — API key storage
- **Microsoft Middleware** (port 3007) — Calendar integration
- **Recall.ai** — Meeting bot and transcription
