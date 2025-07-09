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
