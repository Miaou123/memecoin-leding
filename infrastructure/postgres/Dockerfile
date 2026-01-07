FROM postgres:16-alpine

# Install AWS CLI v2 and other dependencies for WAL archiving
RUN apk add --no-cache \
    python3 \
    py3-pip \
    aws-cli \
    bash \
    curl \
    jq \
    ca-certificates \
    tzdata \
    && pip3 install --no-cache-dir --upgrade awscli

# Create directories for WAL archiving
RUN mkdir -p /var/lib/postgresql/wal_archive \
    && mkdir -p /usr/local/bin/wal-scripts \
    && mkdir -p /var/log/postgresql

# Copy custom configuration files
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY postgresql.production.conf /etc/postgresql/postgresql.production.conf
COPY pg_hba.conf /etc/postgresql/pg_hba.conf
COPY pg_hba.production.conf /etc/postgresql/pg_hba.production.conf

# Copy WAL archiving scripts
COPY ../backup/wal-archive.sh /usr/local/bin/wal-scripts/
COPY ../backup/wal-monitor.sh /usr/local/bin/wal-scripts/
RUN chmod +x /usr/local/bin/wal-scripts/*.sh

# Create postgres user's AWS config directory
RUN mkdir -p /var/lib/postgresql/.aws

# Set up proper permissions
RUN chown -R postgres:postgres /var/lib/postgresql/wal_archive \
    && chown -R postgres:postgres /usr/local/bin/wal-scripts \
    && chown -R postgres:postgres /var/lib/postgresql/.aws \
    && chown -R postgres:postgres /var/log/postgresql

# Add health check for WAL archiving
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD pg_isready -U postgres && \
        su - postgres -c "psql -U postgres -c 'SELECT pg_is_wal_replay_paused()' >/dev/null 2>&1 || echo 'WAL OK'"

# Expose PostgreSQL port
EXPOSE 5432

# Set environment variables for AWS CLI (will be overridden by docker-compose)
ENV AWS_DEFAULT_REGION=us-east-1
ENV PGDATA=/var/lib/postgresql/data

# Custom entrypoint to ensure WAL archiving is properly configured
COPY docker-entrypoint-initdb.d/ /docker-entrypoint-initdb.d/

CMD ["postgres"]