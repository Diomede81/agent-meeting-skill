---
name: agent-meeting-skill
description: Automatically join meetings, transcribe with speaker identification, and save notes. Platform agnostic (Teams, Zoom, Meet). Use when agent needs to attend meetings, take notes, or review meeting transcripts.
---

# Agent Meeting Skill

Automated meeting attendance, transcription, and note-taking for AI agents.

## Features

- 📅 **Calendar Integration** - Pull meetings where agent is invited
- 🎥 **Platform Agnostic** - Join Teams, Zoom, Google Meet
- 💬 **Chat Introduction** - Announce presence in meeting chat
- 🎙️ **Transcription** - Real-time transcription with speaker identification
- 🚪 **Auto Leave** - Detect meeting end and exit gracefully
- 📝 **Auto Save** - Process and save transcripts with proper naming

## Requirements

### 1. Calendar Polling
- Query calendar for meetings where agent is an attendee
- Check for meetings starting within configurable window (e.g., 5 minutes)
- Support recurring meetings
- Filter by meeting types (Teams, Zoom, Meet URLs)

### 2. Meeting Join (Platform Agnostic)
- Join via meeting URL (extract from calendar event)
- Support: Microsoft Teams, Zoom, Google Meet
- Configure bot display name
- Detect meeting start/end states
- Handle waiting rooms and admission

### 3. Chat Introduction
- Send introduction message to meeting chat on join
- Configurable message template
- Example: "👋 Hi, I'm Max - Luca's AI assistant. I'm here to take notes."

### 4. Transcription with Speaker ID
- Real-time speech-to-text
- Speaker diarization (identify who said what)
- Handle multiple speakers
- Buffer and batch transcripts

### 5. Meeting End Detection
- Detect when meeting ends (host ends, all leave, timeout)
- Graceful exit
- Handle abrupt disconnections

### 6. Transcript Processing & Storage
- Save to `meetings/` folder in workspace
- Naming: `YYYY-MM-DD_meeting-title.md`
- Include:
  - Meeting metadata (title, date, attendees, duration)
  - Full transcript with speaker labels
  - Auto-generated summary (optional)

## Configuration

```json
{
  "calendarAgent": "luca",
  "botName": "Max",
  "introMessage": "👋 Hi, I'm {botName} - I'm here to take notes for this meeting.",
  "joinWindowMinutes": 5,
  "transcriptFolder": "meetings",
  "autoSummarize": true
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/upcoming | List upcoming meetings to join |
| POST | /api/join | Join a specific meeting |
| GET | /api/status | Current meeting status |
| POST | /api/leave | Leave current meeting |
| GET | /api/transcript | Get current transcript |
| GET | /api/meetings | List saved meeting transcripts |

## Dependencies

- **Calendar API**: Microsoft Middleware (port 3007)
- **Meeting Bot**: Recall.ai or similar service
- **Transcription**: Recall.ai built-in or external STT

## File Structure

```
agent-meeting-skill/
├── SKILL.md              # This file
├── README.md             # Setup guide
├── package.json
├── config/
│   └── default.json      # Default configuration
├── scripts/
│   ├── server.js         # API server
│   ├── calendar-poll.js  # Calendar polling
│   ├── meeting-bot.js    # Meeting join/leave logic
│   └── transcript.js     # Transcript processing
├── lib/
│   ├── recall-client.js  # Recall.ai API wrapper
│   └── calendar-client.js # Calendar API wrapper
└── templates/
    └── transcript.md     # Transcript template
```

## Usage

### Agent Workflow

```
1. Cron triggers calendar check every 5 minutes
2. If meeting starts within 5 min → auto-join
3. Send intro message to chat
4. Transcribe throughout meeting
5. On meeting end → leave and save transcript
6. Transcript saved to meetings/YYYY-MM-DD_title.md
```

### Manual Commands

```bash
# Start the skill server
npm start

# Check upcoming meetings
curl http://localhost:3030/api/upcoming

# Join a specific meeting
curl -X POST http://localhost:3030/api/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://teams.microsoft.com/..."}'

# Get current status
curl http://localhost:3030/api/status

# Leave meeting
curl -X POST http://localhost:3030/api/leave
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| RECALL_API_KEY | Yes | Recall.ai API key |
| RECALL_REGION | No | Recall.ai region (default: eu-central-1) |
| MIDDLEWARE_URL | No | Microsoft Middleware URL (default: http://localhost:3007) |
| PORT | No | API server port (default: 3030) |

## Status

- [ ] Calendar polling implementation
- [ ] Recall.ai integration
- [ ] Meeting join logic
- [ ] Chat message sending
- [ ] Transcription with speaker ID
- [ ] Meeting end detection
- [ ] Transcript saving
- [ ] API server
- [ ] Cron integration
