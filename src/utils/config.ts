import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

let env: Record<string, string> = {};
try {
  env = await load();
} catch (_error) {
  console.log("No .env file found, using system environment variables only");
}

export const config = {
  port: 8000,
  storagePath: env.FYDF_STORAGE_PATH || Deno.env.get("FYDF_STORAGE_PATH") || "./storage",
  chunkSize: 1024 * 1024 * 5,
  maxFileSize: 1024 * 1024 * 1024 * 5,
  dbPath: "./fydf.db",
  sessionDuration: 7 * 24 * 60 * 60 * 1000, 
  cleanupInterval: 60 * 60 * 1000, 
};
