#!/bin/bash
# Initialize WAL archiving setup

set -e

echo "Setting up WAL archiving..."

# Create base backup directory
mkdir -p /var/lib/postgresql/wal_archive

# Ensure proper permissions
chown postgres:postgres /var/lib/postgresql/wal_archive

# Create initial base backup marker
touch /var/lib/postgresql/wal_archive/.initialized

echo "WAL archiving setup complete"