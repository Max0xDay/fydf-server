#!/bin/bash

set -e

echo "FYDF Server Installation"
echo "========================"

if ! command -v deno &> /dev/null; then
    echo "Deno not found. Installing Deno..."
    curl -fsSL https://deno.land/install.sh | sh
    export PATH="$HOME/.deno/bin:$PATH"
    echo "Deno installed successfully"
else
    echo "Deno is already installed"
fi

echo "Setting up FYDF server..."
chmod +x setup.sh start.sh

echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Run ./setup.sh to configure storage"
echo "2. Run ./start.sh to start the server"
echo ""
echo "Or run setup and start in one command:"
echo "./setup.sh && ./start.sh"
