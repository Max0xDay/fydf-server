# Fydf - Fast File Transfer System

A high-performance file transfer system built with Deno, focusing on fast uploads and downloads with secure user-specific storage.

## Features

- **Fast File Transfers**: Optimized chunked uploads for large files (up to 5GB)
- **Secure Authentication**: SQLite database with hashed passwords and salted storage
- **Session Management**: Database-backed sessions with automatic expiration
- **User Isolation**: Each user has their own folder with secure access
- **Streaming Downloads**: Efficient file streaming for fast downloads
- **Drag & Drop**: Modern drag-and-drop interface
- **Configurable Storage**: Store files on any drive via environment variables
- **No Dependencies**: Pure Deno with vanilla HTML/CSS/JS

## Requirements

- Deno 1.40+ installed
- Write permissions for storage directory and database file

## Database

The system uses SQLite for secure user and session management:
- **Users table**: Stores usernames, hashed passwords, and salts
- **Sessions table**: Manages user sessions with automatic expiration
- **Password hashing**: SHA-256 with unique salts for each user

## Setup

1. Create a project directory and save all files:
   - `server.ts` - Main server code
   - `index.html` - Frontend HTML
   - `styles.css` - CSS styles
   - `script.js` - Client-side JavaScript

2. Configure storage path (optional):
   ```bash
   export FYDF_STORAGE_PATH="/path/to/your/storage"
   ```
   
   Default is `./storage` in the current directory.

## Running the Server

```bash
# Run with required permissions
deno run --allow-net --allow-read --allow-write --allow-env server.ts

# Or with a custom port
deno run --allow-net --allow-read --allow-write --allow-env server.ts --port=3000
```

## Usage

1. Open http://localhost:8000 in your browser
2. Login with demo credentials:
   - Username: `user1`, Password: `pass123`
   - Username: `user2`, Password: `pass456`
3. Upload files by:
   - Clicking the upload area
   - Dragging and dropping files
   - Multiple file selection supported
4. Download or delete files from your file list

## Performance Optimizations

- **Chunked Uploads**: Files larger than 5MB are automatically chunked
- **Concurrent Uploads**: Up to 3 files upload simultaneously
- **Streaming**: Both uploads and downloads use streaming for memory efficiency
- **Direct Disk Writing**: Files are written directly to disk without buffering

## Configuration

Edit the `config` object in `server.ts`:

```typescript
const config = {
  port: 8000,                          // Server port
  storagePath: "./storage",            // Storage directory
  chunkSize: 1024 * 1024 * 5,         // 5MB chunks
  maxFileSize: 1024 * 1024 * 1024 * 5 // 5GB max
};
```

## Storage Structure

```
storage/
├── user1/
│   ├── file1.pdf
│   ├── image.jpg
│   └── .temp/        # Temporary chunks during upload
├── user2/
│   └── document.docx
└── fydf.db           # SQLite database
```

## Security Features

- **Password Security**: All passwords are hashed using SHA-256 with unique salts
- **Session Management**: Database-backed sessions with 24-hour expiration
- **User Isolation**: Each user can only access their own files
- **Secure Cookies**: HttpOnly cookies prevent XSS attacks
- **Input Validation**: All file operations are validated and sanitized

## Security Notes

- This system uses secure password hashing and session management
- For production, consider implementing:
  - Rate limiting for login attempts
  - File type validation and virus scanning
  - HTTPS/TLS encryption
  - CSRF protection
  - Additional authentication factors

## Customization

### Adding Users

You can add users programmatically using the database functions:
```typescript
await createUser("newuser", "newpassword");
```

Or directly via SQL:
```sql
INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?);
```

### Changing Storage Location

Set the environment variable before running:
```bash
FYDF_STORAGE_PATH=/mnt/external-drive/fydf-storage deno run --allow-all server.ts
```

## Troubleshooting

1. **Permission Denied**: Ensure Deno has write permissions to the storage directory
2. **Port in Use**: Change the port in the config or via command line
3. **Large Files Fail**: Check available disk space and increase chunk size if needed
4. **Slow Uploads**: Reduce chunk size for better progress feedback
