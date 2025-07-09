import { db } from "../database/database.ts";
import { generateSessionId } from "../utils/auth.ts";
import { config } from "../utils/config.ts";

export const sessions = new Map<string, { userId: string; username: string; expiresAt: Date }>();

export function createSession(username: string): string {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + config.sessionDuration);
  
  sessions.set(sessionId, { userId: username, username, expiresAt });
  
  db.query("DELETE FROM sessions WHERE username = ?", [username]);
  db.query("INSERT INTO sessions (id, user_id, username, expires_at) VALUES (?, (SELECT id FROM users WHERE username = ?), ?, ?)", 
    [sessionId, username, username, expiresAt.toISOString()]);
  
  return sessionId;
}

export function cleanupExpiredSessions(): void {
  const now = new Date();
  for (const [sessionId, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(sessionId);
    }
  }
  db.query("DELETE FROM sessions WHERE expires_at < ?", [now.toISOString()]);
}

export function getUserFromSession(req: Request): { userId: string; username: string } | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  
  const sessionId = cookie.split("=")[1];
  const session = sessions.get(sessionId);
  
  if (!session) return null;
  
  if (session.expiresAt < new Date()) {
    sessions.delete(sessionId);
    db.query("DELETE FROM sessions WHERE id = ?", [sessionId]);
    return null;
  }
  
  return { userId: session.userId, username: session.username };
}
