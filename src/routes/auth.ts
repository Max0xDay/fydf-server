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

  return new Response(JSON.stringify({ success: true, redirect: "/home" }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `session=${sessionId}; HttpOnly; Path=/`,
    },
  });
}

export function handleLogout(req: Request): Response {
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const sessionId = cookie.split("=")[1];
    sessions.delete(sessionId);
    db.query("DELETE FROM sessions WHERE id = ?", [sessionId]);
  }

  return new Response(JSON.stringify({ success: true, redirect: "/login" }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": "session=; HttpOnly; Path=/; Max-Age=0",
    },
  });
}
