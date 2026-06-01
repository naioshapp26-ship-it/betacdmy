/**
 * Guest Mode Manager
 * Handles client-side guest session state in localStorage
 */

export type GuestRole = 'STUDENT' | 'INSTRUCTOR';

export interface GuestSession {
  role: GuestRole;
  sessionId: string;
  timestamp: number;
}

const GUEST_SESSION_KEY = 'betacademy_guest_session';

/**
 * Generate a unique session ID for analytics tracking
 */
function generateSessionId(): string {
  return `guest-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Set guest mode with specified role
 */
export function setGuestMode(role: GuestRole): GuestSession {
  const session: GuestSession = {
    role,
    sessionId: generateSessionId(),
    timestamp: Date.now()
  };
  
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('Failed to save guest session:', error);
  }
  
  return session;
}

/**
 * Get current guest session if exists
 */
export function getGuestMode(): GuestSession | null {
  try {
    const saved = localStorage.getItem(GUEST_SESSION_KEY);
    if (!saved) return null;
    
    const session: GuestSession = JSON.parse(saved);
    
    // Validate session structure
    if (!session.role || !session.sessionId || !session.timestamp) {
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('Failed to read guest session:', error);
    return null;
  }
}

/**
 * Check if currently in guest mode
 */
export function isGuest(): boolean {
  return getGuestMode() !== null;
}

/**
 * Clear guest mode (typically after signup/login)
 */
export function clearGuestMode(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY);
  } catch (error) {
    console.error('Failed to clear guest session:', error);
  }
}

/**
 * Get guest session duration in minutes
 */
export function getSessionDuration(): number | null {
  const session = getGuestMode();
  if (!session) return null;
  
  return Math.floor((Date.now() - session.timestamp) / 1000 / 60);
}
