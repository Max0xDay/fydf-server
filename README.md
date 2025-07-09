# FYDF - Fixing Your Duplicate Files

A professional file management server built with Deno and TypeScript.

## Quick Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd fydf-server
   ```

2. **Install dependencies and setup**:
   ```bash
   ./install.sh
   ```
   This will install Deno if needed and make scripts executable.

3. **Configure the server**:
   ```bash
   ./setup.sh
   ```
   The setup script will:
   - Configure storage location (default or custom path)
   - Set proper permissions
   - Create necessary directories
   - Generate .env file if needed

4. **Start the server**:
   ```bash
   ./start.sh
   ```

5. **Access the application**:
   - Open http://localhost:8000
   - Login with: `penguin` / `penguin`

## Scripts

- `./install.sh` - Install Deno and prepare scripts
- `./setup.sh` - Interactive setup for storage configuration
- `./start.sh` - Start the server with proper environment loading

## Features

- Secure session-based authentication
- **Resumable file uploads** - Continue uploads after page reload or connection loss
- Chunked transfer support for large files
- File download and management
- Responsive web interface
- SQLite database storage
- Automatic cleanup of expired upload sessions
- Configurable storage locations

## Project Structure

```
fydf-server/
├── src/                 # Source code
│   ├── database/        # Database utilities
│   ├── middleware/      # Session management
│   ├── routes/          # API endpoints
│   └── utils/           # Configuration and utilities
├── public/              # Static web assets
│   ├── css/             # Stylesheets
│   ├── js/              # Client-side JavaScript
│   └── views/           # HTML templates
├── storage/             # Default file storage
├── main.ts              # Server entry point
├── setup.sh             # Setup script
├── start.sh             # Start script
└── .env                 # Environment configuration
```

## Configuration

The application uses environment variables for configuration. Run `./setup.sh` to configure automatically, or create a `.env` file manually:

```env
FYDF_STORAGE_PATH="/path/to/your/storage"
```

If no `.env` file exists, the application uses `./storage` as the default storage location.

## Manual Setup

If you prefer manual setup:

1. **For default storage** (recommended):
   ```bash
   # No setup needed, application creates ./storage automatically
   deno run --allow-net --allow-read --allow-write --allow-env main.ts
   ```

2. **For custom storage path**:
   ```bash
   # Create storage directory
   sudo mkdir -p /your/custom/path
   sudo chown -R $USER:$USER /your/custom/path
   sudo chmod -R 755 /your/custom/path
   
   # Create .env file
   echo 'FYDF_STORAGE_PATH="/your/custom/path"' > .env
   
   # Start server
   deno run --allow-net --allow-read --allow-write --allow-env main.ts
   ```

## API Endpoints

### Authentication
- `POST /api/login` - User login
- `POST /api/logout` - User logout

### File Management
- `GET /api/files` - List user files
- `POST /api/upload` - Upload single file
- `POST /api/upload-chunk` - Chunked file upload
- `GET /api/download` - Download file
- `DELETE /api/delete` - Delete file

### Pages
- `/` - Redirects based on authentication status
- `/login` - Login page
- `/home` - File management dashboard

## Default Credentials

- Username: `penguin`
- Password: `penguin`

## Troubleshooting

### Permission Issues
- Never run the server with sudo
- Ensure storage directory is owned by your user
- Use the setup script to configure permissions correctly

### Storage Issues
- Run `./setup.sh` to reconfigure storage
- Check that .env file has correct path
- Verify directory permissions with `ls -la /path/to/storage`

## Resumable Uploads

The application supports resumable uploads that can continue even after:
- Page reload
- Browser restart
- Network interruption
- Connection timeout

### How it works:
1. **Upload interruption**: If an upload is interrupted, the progress is saved
2. **Page reload**: When you return, incomplete uploads are automatically detected
3. **File selection**: You'll be prompted to re-select the same file to continue
4. **Resume**: Upload continues from where it left off, skipping already uploaded chunks

### Resume process:
- Incomplete uploads appear in a "Resume Incomplete Uploads" section
- Click "Resume Upload" and select the same file
- Upload continues automatically from the last completed chunk
- Progress is preserved and displayed accurately

This feature is especially useful for large files or unstable connections.

