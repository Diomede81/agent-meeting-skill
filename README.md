# Agent Meeting Skill

**Fully isolated, API-configurable meeting skill for OpenClaw agents**

Join meetings, transcribe with speaker identification, and save notes automatically.

## Design Principles

| Principle | Description |
|-----------|-------------|
| 🔌 **Isolated** | No hardcoded paths or agent-specific code |
| 🌐 **API-First** | All configuration via REST API |
| 📦 **Portable** | Install on any OpenClaw agent |
| 🎨 **UI-Ready** | JSON Schema for form generation |

## Quick Start

```bash
# Install
git clone https://github.com/Diomede81/agent-meeting-skill.git
cd agent-meeting-skill
npm install

# 1. Store Recall.ai API key (credentials managed by token-manager-skill)
echo "your-recall-api-key" > ~/.secrets/recall-api-key.txt
chmod 600 ~/.secrets/recall-api-key.txt

# 2. Register in token-manager
curl -X POST http://localhost:3021/api/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "service": "Recall.ai",
    "name": "API Key",
    "category": "api",
    "locationType": "file",
    "location": "~/.secrets/recall-api-key.txt"
  }'

# 3. Start API server
npm start
# → http://localhost:3030

# 4. Configure skill
curl -X PUT http://localhost:3030/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "bot": {"name": "Max"},
    "calendar": {"source": "api", "endpoint": "http://localhost:3007/api/calendar", "agent": "luca"}
  }'

# 5. Verify tokens are configured
curl http://localhost:3030/api/tokens/verify
```

## API Reference

### Configuration

```bash
# Get current config
GET /api/config

# Update config
PUT /api/config
Content-Type: application/json
{"bot": {"name": "Max"}, ...}

# Get JSON Schema (for UI forms)
GET /api/config/schema

# Validate config without saving
POST /api/config/validate
Content-Type: application/json
{"bot": {"name": "Max"}, ...}
```

### Tokens (via token-manager-skill)

```bash
# Check required tokens status
GET /api/tokens

# Verify all required tokens are configured
GET /api/tokens/verify

# Test a specific token
POST /api/tokens/test/Recall.ai
```

**Note:** Credentials are managed by `token-manager-skill` (port 3021), not stored locally.

### Calendar

```bash
# Get upcoming meetings
GET /api/calendar/upcoming

# Test calendar connection
POST /api/calendar/test
```

### Meetings

```bash
# List saved transcripts
GET /api/meetings

# Get specific transcript
GET /api/meetings/2026-03-20_weekly-standup

# Get active meeting status
GET /api/meetings/active

# Join meeting manually
POST /api/meetings/join
Content-Type: application/json
{"url": "https://teams.microsoft.com/l/meetup-join/..."}

# Leave current meeting
POST /api/meetings/leave

# Live transcript (Server-Sent Events)
GET /api/transcript/live
```

### Status

```bash
# Health check
GET /api/status
```

## UI Integration

The skill is designed for any UI to configure it:

```javascript
// 1. Fetch schema
const schema = await fetch('/api/config/schema').then(r => r.json());

// 2. Generate form from JSON Schema
// (use react-jsonschema-form, ajv, or similar)

// 3. Save configuration
await fetch('/api/config', {
  method: 'PUT',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(formData)
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      UI / Mission Control                    │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP/REST
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Meeting Skill API                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Config  │  │ Calendar │  │ Meetings │  │ Credentials│   │
│  │  Manager │  │  Client  │  │   Bot    │  │   Store   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────┬───────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Calendar API │    │  Recall.ai   │    │   Storage    │
│ (Middleware) │    │ (Meeting Bot)│    │  (data/*.md) │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Data Storage

All data stored within skill directory (portable):

```
data/
├── config.json       # User configuration
├── credentials.enc   # Encrypted credentials
├── state.json        # Runtime state
└── meetings/         # Saved transcripts
    ├── 2026-03-20_weekly-standup.md
    └── 2026-03-21_project-review.md
```

## Transcript Format

```markdown
# Meeting: Weekly Standup

**Date:** 2026-03-20 10:00 AM  
**Duration:** 45 minutes  
**Platform:** Microsoft Teams  
**Attendees:** Luca, Masum, Austin

---

## Transcript

**Luca (10:00:15):** Good morning everyone, let's get started.

**Masum (10:00:22):** Morning! I'll go first with the Empathika update...

---

## Summary

- Empathika v2.3 release scheduled for next week
- Action item: Masum to finalize API documentation
- Next standup: Thursday 10 AM

---

*Transcribed by Max*
```

## Required Tokens (via token-manager)

| Service | Location | Required | Description |
|---------|----------|----------|-------------|
| `Recall.ai` | `~/.secrets/recall-api-key.txt` | Yes | Meeting bot API |

Register tokens via token-manager-skill (port 3021) before using this skill.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3030 | API server port |
| `DATA_DIR` | `./data` | Override data directory |
| `TOKEN_MANAGER_URL` | `http://localhost:3021` | Token manager API URL |
| `SECRETS_DIR` | `~/.secrets` | Override secrets directory |

## License

MIT
