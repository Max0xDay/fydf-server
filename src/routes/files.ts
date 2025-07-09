import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { getUserFromSession } from "../middleware/session.ts";
import { config } from "../utils/config.ts";

export async function handleUpload(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return new Response("Bad Request", { status: 400 });
  }

  const userDir = join(config.storagePath, user.userId);
  await ensureDir(userDir);

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return new Response("No file uploaded", { status: 400 });
    }

    const filePath = join(userDir, file.name);
    const fileBuffer = await file.arrayBuffer();
    await Deno.writeFile(filePath, new Uint8Array(fileBuffer));

    return new Response(JSON.stringify({ 
      success: true, 
      filename: file.name,
      size: fileBuffer.byteLength 
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response("Upload failed", { status: 500 });
  }
}

export async function handleChunkedUpload(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  const chunk = url.searchParams.get("chunk");
  const totalChunks = url.searchParams.get("totalChunks");

  if (!filename || chunk === null || !totalChunks) {
    return new Response("Bad Request", { status: 400 });
  }

  const userDir = join(config.storagePath, user.userId);
  await ensureDir(userDir);

  const tempDir = join(userDir, ".temp");
  await ensureDir(tempDir);

  const chunkPath = join(tempDir, `${filename}.chunk${chunk}`);
  const body = await req.arrayBuffer();
  await Deno.writeFile(chunkPath, new Uint8Array(body));

  const chunkNum = parseInt(chunk);
  const totalNum = parseInt(totalChunks);

  if (chunkNum === totalNum - 1) {
    const finalPath = join(userDir, filename);
    const file = await Deno.create(finalPath);

    for (let i = 0; i < totalNum; i++) {
      const chunkData = await Deno.readFile(join(tempDir, `${filename}.chunk${i}`));
      await file.write(chunkData);
      await Deno.remove(join(tempDir, `${filename}.chunk${i}`));
    }

    file.close();
    return new Response(JSON.stringify({ success: true, complete: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, complete: false }), {
    headers: { "content-type": "application/json" },
  });
}

export async function handleDownload(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  if (!filename) return new Response("Bad Request", { status: 400 });

  const filePath = join(config.storagePath, user.userId, filename);

  try {
    const file = await Deno.open(filePath, { read: true });
    const stat = await file.stat();
    
    const stream = file.readable;
    
    return new Response(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": stat.size.toString(),
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}

export async function listFiles(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const userDir = join(config.storagePath, user.userId);
  await ensureDir(userDir);

  const files = [];
  for await (const entry of Deno.readDir(userDir)) {
    if (entry.isFile) {
      const stat = await Deno.stat(join(userDir, entry.name));
      files.push({
        name: entry.name,
        size: stat.size,
        modified: stat.mtime,
      });
    }
  }

  return new Response(JSON.stringify(files), {
    headers: { "content-type": "application/json" },
  });
}

export async function handleDelete(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  if (!filename) return new Response("Bad Request", { status: 400 });

  const filePath = join(config.storagePath, user.userId, filename);

  try {
    await Deno.remove(filePath);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}

interface UploadSession {
  id: string;
  filename: string;
  totalSize: number;
  totalChunks: number;
  uploadedChunks: Set<number>;
  created: number;
  lastActivity: number;
  userId: string;
}

const uploadSessions = new Map<string, UploadSession>();

export function handleUploadStatus(req: Request): Response {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  
  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }

  const session = uploadSessions.get(sessionId);
  if (!session || session.userId !== user.userId) {
    return new Response("Session not found", { status: 404 });
  }

  return new Response(JSON.stringify({
    sessionId: session.id,
    filename: session.filename,
    totalChunks: session.totalChunks,
    uploadedChunks: Array.from(session.uploadedChunks),
    progress: (session.uploadedChunks.size / session.totalChunks) * 100
  }), {
    headers: { "content-type": "application/json" },
  });
}

export async function handleUploadInit(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const { filename, totalSize, chunkSize } = body;

  if (!filename || !totalSize || !chunkSize) {
    return new Response("Missing required fields", { status: 400 });
  }

  const sessionId = crypto.randomUUID();
  const totalChunks = Math.ceil(totalSize / chunkSize);
  
  const userDir = join(config.storagePath, user.userId);
  await ensureDir(userDir);
  
  const tempDir = join(userDir, ".temp");
  await ensureDir(tempDir);

  const session: UploadSession = {
    id: sessionId,
    filename,
    totalSize,
    totalChunks,
    uploadedChunks: new Set(),
    created: Date.now(),
    lastActivity: Date.now(),
    userId: user.userId
  };

  uploadSessions.set(sessionId, session);

  return new Response(JSON.stringify({
    sessionId,
    totalChunks,
    existingChunks: []
  }), {
    headers: { "content-type": "application/json" },
  });
}

export async function handleResumableChunkUpload(req: Request): Promise<Response> {
  const user = getUserFromSession(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const chunkIndex = url.searchParams.get("chunkIndex");

  if (!sessionId || chunkIndex === null) {
    return new Response("Missing required parameters", { status: 400 });
  }

  const session = uploadSessions.get(sessionId);
  if (!session || session.userId !== user.userId) {
    return new Response("Session not found", { status: 404 });
  }

  const chunkNum = parseInt(chunkIndex);
  if (chunkNum < 0 || chunkNum >= session.totalChunks) {
    return new Response("Invalid chunk index", { status: 400 });
  }

  const userDir = join(config.storagePath, user.userId);
  const tempDir = join(userDir, ".temp");
  const chunkPath = join(tempDir, `${sessionId}.chunk${chunkNum}`);

  try {
    const body = await req.arrayBuffer();
    await Deno.writeFile(chunkPath, new Uint8Array(body));
    
    session.uploadedChunks.add(chunkNum);
    session.lastActivity = Date.now();

    const isComplete = session.uploadedChunks.size === session.totalChunks;
    
    if (isComplete) {
      await assembleFile(session, userDir, tempDir);
      uploadSessions.delete(sessionId);
    }

    return new Response(JSON.stringify({
      success: true,
      complete: isComplete,
      progress: (session.uploadedChunks.size / session.totalChunks) * 100
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Chunk upload error:", error);
    return new Response("Chunk upload failed", { status: 500 });
  }
}

async function assembleFile(session: UploadSession, userDir: string, tempDir: string) {
  const finalPath = join(userDir, session.filename);
  const file = await Deno.create(finalPath);

  try {
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = join(tempDir, `${session.id}.chunk${i}`);
      const chunkData = await Deno.readFile(chunkPath);
      await file.write(chunkData);
      await Deno.remove(chunkPath);
    }
  } finally {
    file.close();
  }
}

export function cleanupExpiredSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;

  for (const [sessionId, session] of uploadSessions.entries()) {
    if (now - session.lastActivity > maxAge) {
      uploadSessions.delete(sessionId);
      
      const userDir = join(config.storagePath, session.userId);
      const tempDir = join(userDir, ".temp");
      
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = join(tempDir, `${sessionId}.chunk${i}`);
        Deno.remove(chunkPath).catch(() => {});
      }
    }
  }
}
