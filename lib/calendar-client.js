/**
 * Calendar Client
 * Fetches upcoming meetings from various calendar sources
 */

class CalendarClient {
  constructor(config) {
    this.source = config.source || 'api';
    this.endpoint = config.endpoint;
    this.agent = config.agent;
    this.joinWindowMinutes = config.joinWindowMinutes || 5;
  }

  /**
   * Get upcoming meetings within join window
   */
  async getUpcoming() {
    switch (this.source) {
      case 'api':
      case 'microsoft':
        return this.fetchFromMiddleware();
      case 'google':
        return this.fetchFromGoogle();
      case 'ical':
        return this.fetchFromIcal();
      default:
        throw new Error(`Unknown calendar source: ${this.source}`);
    }
  }

  /**
   * Fetch from Microsoft Middleware API
   */
  async fetchFromMiddleware() {
    if (!this.endpoint) {
      throw new Error('Calendar endpoint not configured');
    }

    const url = `${this.endpoint}/list/${this.agent}?days=1`;
    
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Calendar API error: ${res.status}`);
    }

    const events = await res.json();
    return this.filterAndFormat(events);
  }

  /**
   * Fetch from Google Calendar API
   */
  async fetchFromGoogle() {
    // TODO: Implement Google Calendar integration
    throw new Error('Google Calendar integration not yet implemented');
  }

  /**
   * Fetch from iCal URL
   */
  async fetchFromIcal() {
    // TODO: Implement iCal integration
    throw new Error('iCal integration not yet implemented');
  }

  /**
   * Filter events to those starting soon or currently in progress
   */
  filterAndFormat(events) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.joinWindowMinutes * 60 * 1000);
    const windowEnd = new Date(now.getTime() + this.joinWindowMinutes * 60 * 1000);
    
    return events
      .map(event => this.formatEvent(event))
      .filter(event => {
        if (!event.meetingUrl) return false;
        
        const start = new Date(event.start);
        const end = new Date(event.end);
        
        // Include if:
        // 1. Meeting is currently happening (start <= now <= end)
        // 2. Meeting starts within the join window (now <= start <= windowEnd)
        // 3. Meeting just started within the past joinWindowMinutes
        const isHappening = start <= now && now <= end;
        const isStartingSoon = start >= now && start <= windowEnd;
        const justStarted = start >= windowStart && start <= now;
        
        return isHappening || isStartingSoon || justStarted;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  /**
   * Format event to consistent structure
   */
  formatEvent(event) {
    // Handle Microsoft Graph API format
    const start = event.start?.dateTime || event.start;
    const end = event.end?.dateTime || event.end;
    
    // Extract meeting URL from various fields
    const meetingUrl = this.extractMeetingUrl(event);
    
    // Get attendees
    const attendees = (event.attendees || []).map(a => 
      a.emailAddress?.name || a.email || a.name || a
    ).filter(Boolean);

    return {
      id: event.id,
      title: event.subject || event.summary || event.title || 'Untitled Meeting',
      start,
      end,
      meetingUrl,
      platform: meetingUrl ? this.detectPlatform(meetingUrl) : null,
      attendees,
      location: event.location?.displayName || event.location || '',
      organizer: event.organizer?.emailAddress?.name || event.organizer?.email || null,
      raw: event
    };
  }

  /**
   * Extract meeting URL from event
   */
  extractMeetingUrl(event) {
    // Check online meeting URL (Teams)
    if (event.onlineMeeting?.joinUrl) {
      return event.onlineMeeting.joinUrl;
    }
    
    // Check location field
    if (event.location?.displayName) {
      const url = this.findUrl(event.location.displayName);
      if (url) return url;
    }
    
    // Check body content
    if (event.body?.content) {
      const url = this.findUrl(event.body.content);
      if (url) return url;
    }
    
    // Check webLink (sometimes contains meeting URL)
    if (event.webLink && this.isMeetingUrl(event.webLink)) {
      return event.webLink;
    }
    
    return null;
  }

  /**
   * Find meeting URL in text
   */
  findUrl(text) {
    if (!text) return null;
    
    // Common meeting URL patterns
    const patterns = [
      /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i,
      /https:\/\/[a-z0-9]+\.zoom\.us\/j\/[^\s"<>]+/i,
      /https:\/\/meet\.google\.com\/[a-z-]+/i,
      /https:\/\/[a-z0-9]+\.webex\.com\/[^\s"<>]+/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    
    return null;
  }

  /**
   * Check if URL is a meeting URL
   */
  isMeetingUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('teams.microsoft.com') ||
      lower.includes('zoom.us') ||
      lower.includes('meet.google.com') ||
      lower.includes('webex.com')
    );
  }

  /**
   * Detect meeting platform from URL
   */
  detectPlatform(url) {
    const lower = url.toLowerCase();
    if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'teams';
    if (lower.includes('zoom.us')) return 'zoom';
    if (lower.includes('meet.google.com')) return 'meet';
    if (lower.includes('webex.com')) return 'webex';
    return 'unknown';
  }

  /**
   * Test calendar connection
   */
  async test() {
    try {
      if (!this.endpoint) {
        return { success: false, error: 'Calendar endpoint not configured' };
      }

      const url = `${this.endpoint}/list/${this.agent}?days=1`;
      const res = await fetch(url);
      
      if (res.ok) {
        const events = await res.json();
        return { 
          success: true, 
          message: `Connected. Found ${events.length} events in next 24 hours.` 
        };
      } else {
        return { success: false, error: `API returned ${res.status}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { CalendarClient };
