#!/bin/bash
# Install ss-manager watcher as launchd daemon
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.ss-manager"
PLIST_NAME="com.chakshu.ss-manager"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

# Install dependencies
cd "$SCRIPT_DIR"
npm install

# Create config dir
mkdir -p "$CONFIG_DIR"

# Create .env if it doesn't exist
if [ ! -f "$CONFIG_DIR/.env" ]; then
    echo "Creating config at $CONFIG_DIR/.env"
    cat > "$CONFIG_DIR/.env" << 'ENVEOF'
MINIO_ENDPOINT=ss.chakshu.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=ssmanager
MINIO_SECRET_KEY=CHANGE_ME_PLEASE
MINIO_BUCKET=screenshots
WATCH_DIR=$HOME/Desktop
ENVEOF
    echo "⚠️  Edit $CONFIG_DIR/.env and set your MinIO credentials"
fi

# Generate plist with correct paths
sed "s|__WORKING_DIR__|$SCRIPT_DIR|g; s|__HOME__|$HOME|g; s|__NODE__|$(which node)|g" "$PLIST_SRC" > "$PLIST_DST"

# Unload if already loaded
launchctl bootout gui/$(id -u) "$PLIST_DST" 2>/dev/null || true

# Load
launchctl bootstrap gui/$(id -u) "$PLIST_DST"

echo "✅ ss-manager watcher installed and running"
echo "📋 Logs: ~/Library/Logs/ss-manager.log"
