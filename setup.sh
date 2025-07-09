#!/bin/bash

set -e

echo "FYDF - Fixing Your Duplicate Files Setup"
echo "==========================================="

read -p "Do you want to use a custom storage path? (y/N): " use_custom
use_custom=${use_custom:-n}

if [[ $use_custom =~ ^[Yy]$ ]]; then
    read -p "Enter the full path for storage (e.g., /mnt/loml1/fydf): " custom_path
    
    if [[ -z "$custom_path" ]]; then
        echo "No path provided. Using default ./storage"
        storage_path="./storage"
    else
        storage_path="$custom_path"
        echo "Setting up custom storage path: $storage_path"
        
        if [[ ! -d "$storage_path" ]]; then
            echo "Creating directory..."
            sudo mkdir -p "$storage_path"
        fi
        
        echo "Setting ownership to current user..."
        sudo chown -R $USER:$USER "$storage_path"
        
        echo "Setting permissions..."
        sudo chmod -R 755 "$storage_path"
        
        echo "FYDF_STORAGE_PATH=\"$storage_path\"" > .env
        echo "Created .env file with storage path"
        
        echo "Custom storage path configured successfully!"
        echo "To use it, run: source .env && deno run --allow-net --allow-read --allow-write --allow-env main.ts"
    fi
else
    storage_path="./storage"
    echo "Using default storage path: $storage_path"
    
    if [[ -f ".env" ]]; then
        rm .env
        echo "Removed existing .env file"
    fi
fi

if [[ "$storage_path" == "./storage" ]]; then
    mkdir -p "./storage"
    echo "Created local storage directory"
fi

echo ""
echo "Setup complete! You can now run:"
echo "   deno run --allow-net --allow-read --allow-write --allow-env main.ts"
echo ""
echo "The server will be available at: http://localhost:8000"
echo "Default credentials: penguin/penguin"
echo ""
echo "Important: Never run the server with sudo!"
