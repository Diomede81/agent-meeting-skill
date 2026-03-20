# Third-Party Services

This document outlines all external services required for the Agent Meeting Skill.

## Meeting Bot Providers

The skill needs a meeting bot service to join meetings, capture audio/video, and transcribe.

### Option 1: Recall.ai (Recommended)

**Website:** https://www.recall.ai  
**What it does:** Meeting bot API - joins meetings, records, transcribes

| Feature | Details |
|---------|---------|
| **Platforms** | Zoom, Teams, Google Meet, Webex, GoTo Meeting, Slack |
| **Pricing** | $0.50/hour (Pay As You Go) |
| **Transcription** | Built-in: +$0.15/hour, or BYOK |
| **Storage** | 7 days free, then $0.05/hr for 30-day retention |
| **Free Trial** | 5 hours |
| **Compliance** | SOC-2, HIPAA |

**Pros:**
- Most mature platform (YC-backed, 3000+ customers)
- Enterprise compliance (SOC-2, HIPAA)
- Desktop Recording SDK (no visible bot)
- Good documentation

**Cons:**
- Higher price ($0.50/hr vs $0.35/hr alternatives)
- 500 hr/month limit on Pay As You Go
- 2 hour per-recording limit on PAYG

**API Docs:** https://docs.recall.ai

---

### Option 2: Skribby

**Website:** https://skribby.io  
**What it does:** Meeting bot API - cheaper alternative to Recall.ai

| Feature | Details |
|---------|---------|
| **Platforms** | Zoom, Teams, Google Meet |
| **Pricing** | $0.35/hour (lowest in market) |
| **Transcription** | Pass-through pricing (BYOK) |
| **Free Trial** | 5 hours |
| **Support** | Direct to engineering team |

**Pros:**
- 30% cheaper than Recall.ai
- 10+ transcription model options (Deepgram, Whisper, etc.)
- BYOK for transcription providers
- No monthly minimums

**Cons:**
- Smaller company
- No desktop SDK
- Less enterprise features

**API Docs:** https://skribby.io/docs

---

### Option 3: MeetingBaaS

**Website:** https://meetingbaas.com  
**What it does:** Meeting bot API with calendar integrations

| Feature | Details |
|---------|---------|
| **Platforms** | Zoom, Teams, Google Meet |
| **Pricing** | Token-based (~$0.50/hr effective) |
| **Subscriptions** | Free, Pro ($99/mo), Scale ($199/mo) |
| **Transcription** | Gladia built-in, or BYOK |

**Pros:**
- Built-in calendar integrations
- Tokens don't expire

**Cons:**
- Complex token pricing model
- Requires subscription for best rates
- More expensive when calculated hourly

---

### Option 4: Vexa (Self-Hosted)

**Website:** https://github.com/AshishBansal-Official/vexa  
**What it does:** Open-source meeting bot (self-hosted)

| Feature | Details |
|---------|---------|
| **Platforms** | Google Meet only |
| **Pricing** | Free (your infrastructure costs) |
| **License** | Apache 2.0 |

**Pros:**
- No per-hour fees
- Full data ownership
- Fully customizable

**Cons:**
- Google Meet only (no Teams/Zoom)
- Requires DevOps expertise
- No commercial support
- Significant setup time

---

## Transcription Providers

If using BYOK (Bring Your Own Key) transcription:

### Deepgram
- **Website:** https://deepgram.com
- **Pricing:** $0.0043/min (~$0.26/hr)
- **Features:** Real-time streaming, speaker diarization
- **Best for:** Cost-effective, good accuracy

### OpenAI Whisper API
- **Website:** https://platform.openai.com
- **Pricing:** $0.006/min (~$0.36/hr)
- **Features:** High accuracy, many languages
- **Best for:** Accuracy-focused use cases

### AssemblyAI
- **Website:** https://www.assemblyai.com
- **Pricing:** $0.00025/sec (~$0.90/hr)
- **Features:** Real-time, speaker labels, summaries
- **Best for:** Full-featured transcription

---

## Calendar Providers

For pulling meeting invitations:

### Microsoft Graph API (via Middleware)
- **What:** Access to Outlook/Teams calendar
- **Skill uses:** Our existing Microsoft Middleware (port 3007)
- **Authentication:** OAuth 2.0

### Google Calendar API
- **What:** Access to Google Calendar
- **Pricing:** Free (quota limits apply)
- **Authentication:** OAuth 2.0

### iCal/CalDAV
- **What:** Generic calendar protocol
- **Pricing:** Free
- **Best for:** Self-hosted calendars

---

## Summarization & Action Extraction

**NOT handled by this skill.**

The skill sends a webhook to the agent when meetings complete. The agent then:
1. Processes transcript with its own model
2. Generates summary
3. Extracts action items
4. Assigns actions to attendees
5. Creates follow-up tasks

This keeps the skill focused on capture, while the agent (with full context about people, projects, and history) handles intelligent processing.

---

## Recommended Stack

For most users, we recommend:

| Component | Service | Monthly Cost (20 hrs/mo) |
|-----------|---------|--------------------------|
| Meeting Bot | Recall.ai | $10 |
| Transcription | Recall built-in | $3 |
| Calendar | Microsoft Middleware | Free (self-hosted) |
| **Total** | | **~$13/month** |

Summarization handled by agent's existing model (no additional cost).

### Budget Alternative:

| Component | Service | Monthly Cost (20 hrs/mo) |
|-----------|---------|--------------------------|
| Meeting Bot | Skribby | $7 |
| Transcription | Deepgram (BYOK) | $5.20 |
| Calendar | Microsoft Middleware | Free |
| **Total** | | **~$12/month** |

---

## Required Credentials

| Credential | Where to Get | Required |
|------------|--------------|----------|
| `recall_api_key` | https://www.recall.ai/signup | Yes (if using Recall) |
| `skribby_api_key` | https://platform.skribby.io/register | Yes (if using Skribby) |
| `deepgram_api_key` | https://console.deepgram.com | If using BYOK transcription |
| `openai_api_key` | https://platform.openai.com | If using summarization |

---

## Comparison Summary

| Provider | Price/hr | Platforms | Best For |
|----------|----------|-----------|----------|
| **Recall.ai** | $0.50 | All major | Enterprise, compliance |
| **Skribby** | $0.35 | All major | Cost-conscious, startups |
| **MeetingBaaS** | ~$0.50 | All major | Calendar integrations |
| **Vexa** | Free* | Meet only | Self-hosted, Google Meet |

*Infrastructure costs apply
