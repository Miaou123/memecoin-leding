# Backup Container for PostgreSQL
FROM postgres:16-alpine

# Install additional tools
RUN apk add --no-cache \
    bash \
    curl \
    aws-cli \
    gzip \
    openssl

# Create backup directory
RUN mkdir -p /backups && chmod 755 /backups

# Copy scripts
COPY backup.sh /usr/local/bin/backup
COPY restore.sh /usr/local/bin/restore

RUN chmod +x /usr/local/bin/backup /usr/local/bin/restore

# Set working directory
WORKDIR /backups

# Default command: run backup
CMD ["backup"]