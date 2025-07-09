import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { config } from "./src/utils/config.ts";
import { initializeDatabase, initializeDefaultUser } from "./src/database/database.ts";
import { cleanupExpiredSessions, getUserFromSession } from "./src/middleware/session.ts";
import { serveStaticFile } from "./src/utils/static.ts";
import { handleLogin, handleLogout } from "./src/routes/auth.ts";
import { handleUpload, handleChunkedUpload, handleDownload, listFiles, handleDelete } from "./src/routes/files.ts";

async function initialize() {
  initializeDatabase();
  await initializeDefaultUser();
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, config.cleanupInterval);
  await ensureDir(config.storagePath);
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  switch (path) {
    case "/": {
      const user = getUserFromSession(req);
      if (user) {
        return new Response("", {
          status: 302,
          headers: { Location: "/home" }
        });
      } else {
        return new Response("", {
          status: 302,
          headers: { Location: "/login" }
        });
      }
    }
    case "/login":
      return await serveStaticFile("public/views/login.html");
    case "/home": {
      const homeUser = getUserFromSession(req);
      if (!homeUser) {
        return new Response("", {
          status: 302,
          headers: { Location: "/login" }
        });
      }
      return await serveStaticFile("public/views/home.html");
    }
    case "/css/styles.css":
      return await serveStaticFile("public/css/styles.css");
    case "/js/login.js":
      return await serveStaticFile("public/js/login.js");
    case "/js/home.js":
      return await serveStaticFile("public/js/home.js");
    case "/api/login":
      if (req.method === "POST") return await handleLogin(req);
      break;
    case "/api/logout":
      if (req.method === "POST") return handleLogout(req);
      break;
    case "/api/upload":
      if (req.method === "POST") return await handleUpload(req);
      break;
    case "/api/upload-chunk":
      if (req.method === "POST") return await handleChunkedUpload(req);
      break;
    case "/api/download":
      if (req.method === "GET") return await handleDownload(req);
      break;
    case "/api/files":
      if (req.method === "GET") return await listFiles(req);
      break;
    case "/api/delete":
      if (req.method === "DELETE") return await handleDelete(req);
      break;
  }

  return new Response("Not Found", { status: 404 });
}

console.log(`FYDF - Fixing Your Duplicate Files server running on http://localhost:${config.port}`);
console.log(`Storage path: ${config.storagePath}`);
console.log("Default user: penguin/penguin");

await initialize();
await serve(handler, { port: config.port });
