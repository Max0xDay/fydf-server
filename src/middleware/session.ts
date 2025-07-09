import { db } from "../database/database.ts";
import { generateSessionId } from "../utils/auth.ts";
import { config } from "../utils/config.ts";

export const sessions = new Map<string, { userId: string; username: string; expiresAt: Date }>();

export function loadSessionsFromDatabase(): void {
  console.log("Loading existing sessions from database...");
  const sessionRows = db.query("SELECT id, username, expires_at FROM sessions WHERE expires_at > ?", [new Date().toISOString()]);
  
  let loadedCount = 0;
  for (const row of sessionRows) {
    const [sessionId, username, expiresAtStr] = row;
    const expiresAt = new Date(expiresAtStr as string);
    
    sessions.set(sessionId as string, {
      userId: username as string,
      username: username as string,
      expiresAt
    });
    loadedCount++;
  }
  
  console.log(`Loaded ${loadedCount} existing sessions from database`);
}

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
  
  const cookies = cookie.split(';').map(c => c.trim());
  let sessionId: string | null = null;
  
  for (const cookie of cookies) {
    if (cookie.startsWith('session=')) {
      sessionId = cookie.substring('session='.length);
      break;
    }
  }
  
  if (!sessionId) return null;
  
  let session = sessions.get(sessionId);
  
  if (!session) {
    const sessionRows = db.query("SELECT username, expires_at FROM sessions WHERE id = ?", [sessionId]);
    if (sessionRows.length > 0) {
      const [username, expiresAtStr] = sessionRows[0];
      const expiresAt = new Date(expiresAtStr as string);
      
      if (expiresAt > new Date()) {
        session = {
          userId: username as string,
          username: username as string,
          expiresAt
        };
        sessions.set(sessionId, session);
      }
    }
  }
  
  if (!session) return null;
  
  if (session.expiresAt < new Date()) {
    sessions.delete(sessionId);
    db.query("DELETE FROM sessions WHERE id = ?", [sessionId]);
    return null;
  }
  
  return { userId: session.userId, username: session.username };
}
