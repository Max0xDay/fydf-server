#!/bin/bash

echo "Starting FYDF - Fixing Your Duplicate Files..."

if [[ -f ".env" ]]; then
    echo "Environment configuration found in .env file"
    echo "Storage path will be loaded automatically by the application"
else
    echo "No .env file found, using default storage: ./storage"
fi

# Stop any existing instances
pkill -f "deno.*main.ts" 2>/dev/null || true

echo "Server starting on http://localhost:8000"
echo "Default credentials: penguin/penguin"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

deno run --allow-net --allow-read --allow-write --allow-env main.ts
