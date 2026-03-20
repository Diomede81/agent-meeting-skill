# Agent Meeting Skill

**OpenClaw skill for automated meeting attendance and transcription**

Join meetings, transcribe with speaker identification, and save notes automatically.

## Features

| Feature | Description |
|---------|-------------|
| 📅 Calendar Integration | Pull meetings where agent is invited |
| 🎥 Platform Agnostic | Teams, Zoom, Google Meet |
| 💬 Chat Introduction | Announce presence in meeting chat |
| 🎙️ Transcription | Real-time with speaker identification |
| 🚪 Auto Leave | Detect meeting end and exit |
| 📝 Auto Save | Save transcripts with proper naming |

## Quick Start

```bash
# Clone
git clone https://github.com/Diomede81/agent-meeting-skill.git
cd agent-meeting-skill

# Install
npm install

# Configure
cp config/default.json config/local.json
# Edit config/local.json with your settings

# Start
npm start
```

## Requirements

- Node.js 18+
- Recall.ai API key
- Microsoft Middleware running (for calendar access)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  Calendar API   │────▶│  Calendar Poll   │
│  (Middleware)   │     │  (every 5 min)   │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │ Meeting within │
                        │   5 minutes?   │
                        └───────┬────────┘
                                │ Yes
                                ▼
┌─────────────────┐     ┌──────────────────┐
│   Recall.ai     │◀────│   Meeting Bot    │
│   (Join/STT)    │     │   (Join + Chat)  │
└────────┬────────┘     └──────────────────┘
         │
         │ Transcription
         ▼
┌─────────────────┐     ┌──────────────────┐
│   Transcript    │────▶│   Save to File   │
│   Processing    │     │   meetings/*.md  │
└─────────────────┘     └──────────────────┘
```

## Configuration

```json
{
  "calendarAgent": "luca",
  "botName": "Max",
  "introMessage": "👋 Hi, I'm {botName} - I'm here to take notes.",
  "joinWindowMinutes": 5,
  "transcriptFolder": "meetings",
  "autoSummarize": true,
  "recallRegion": "eu-central-1"
}
```

## API Reference

### GET /api/upcoming
List meetings that will be joined.

### POST /api/join
Join a specific meeting manually.

### GET /api/status
Get current meeting status (joined, transcribing, idle).

### POST /api/leave
Leave current meeting manually.

### GET /api/transcript
Get current meeting transcript.

### GET /api/meetings
List all saved meeting transcripts.

## Workflow

1. **Poll Calendar** - Check for meetings every 5 minutes
2. **Auto Join** - Join meetings starting within the join window
3. **Introduce** - Send chat message announcing presence
4. **Transcribe** - Real-time transcription with speaker IDs
5. **Detect End** - Monitor for meeting end signals
6. **Save** - Process and save transcript to `meetings/YYYY-MM-DD_title.md`

## Transcript Format

```markdown
# Meeting: Weekly Standup
**Date:** 2026-03-20 10:00 AM  
**Duration:** 45 minutes  
**Attendees:** Luca, Masum, Austin

---

## Transcript

**Luca (10:00:15):** Good morning everyone, let's get started.

**Masum (10:00:22):** Morning! I'll go first...

...

---

## Summary
(Auto-generated summary of key points)
```

## License

MIT
