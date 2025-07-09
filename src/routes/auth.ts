import { verifyUser } from "../database/database.ts";
import { createSession, sessions } from "../middleware/session.ts";
import { db } from "../database/database.ts";

export async function handleLogin(req: Request): Promise<Response> {
  const data = await req.json();
  const { username, password } = data;

  if (!await verifyUser(username, password)) {
    return new Response(JSON.stringify({ success: false }), {
      headers: { "content-type": "application/json" },
    });
  }

  const sessionId = createSession(username);
  
  const maxAge = 7 * 24 * 60 * 60; 

  return new Response(JSON.stringify({ success: true, redirect: "/home" }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `session=${sessionId}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict`,
    },
  });
}

export function handleLogout(req: Request): Response {
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const cookies = cookie.split(';').map(c => c.trim());
    let sessionId: string | null = null;
    
    for (const cookie of cookies) {
      if (cookie.startsWith('session=')) {
        sessionId = cookie.substring('session='.length);
        break;
      }
    }
    
    if (sessionId) {
      sessions.delete(sessionId);
      db.query("DELETE FROM sessions WHERE id = ?", [sessionId]);
    }
  }

  return new Response(JSON.stringify({ success: true, redirect: "/login" }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict",
    },
  });
}
