import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
import { config } from "../utils/config.ts";
import { hashPassword, generateSessionId } from "../utils/auth.ts";

export const db = new DB(config.dbPath);

export function initializeDatabase() {
  db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
}

export async function createUser(username: string, password: string): Promise<boolean> {
  try {
    const salt = generateSessionId();
    const passwordHash = await hashPassword(password, salt);
    
    db.query("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)", 
      [username, passwordHash, salt]);
    return true;
  } catch {
    return false;
  }
}

export async function verifyUser(username: string, password: string): Promise<boolean> {
  const result = db.query("SELECT password_hash, salt FROM users WHERE username = ?", [username]);
  if (result.length === 0) return false;
  
  const [passwordHash, salt] = result[0];
  const inputHash = await hashPassword(password, salt as string);
  return inputHash === passwordHash;
}

export async function initializeDefaultUser() {
  const userCount = db.query("SELECT COUNT(*) FROM users").flat()[0] as number;
  if (userCount === 0) {
    console.log("Creating default user: penguin/penguin");
    await createUser("penguin", "penguin");
  } else {
    console.log("Database already has users, skipping default user creation");
  }
}
