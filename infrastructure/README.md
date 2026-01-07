# Infrastructure Documentation

This directory contains all infrastructure-related configurations for the Memecoin Lending Protocol.

## Directory Structure

```
infrastructure/
├── backup/              # PostgreSQL backup scripts and configuration
├── nginx/               # Nginx reverse proxy configuration (legacy)
├── pgbouncer/           # PgBouncer connection pooling configuration
│   ├── pgbouncer.ini            # PgBouncer configuration
│   ├── userlist.txt             # User authentication file
│   ├── generate-password-hash.sh # Password hash generator
│   └── monitor-pgbouncer.sh     # Monitoring script
├── postgres/            # PostgreSQL configuration files
│   ├── postgresql.conf           # Default PostgreSQL settings
│   ├── postgresql.production.conf # Production-hardened settings
│   ├── pg_hba.conf              # Authentication configuration
│   └── pg_hba.production.conf    # Production authentication config
├── redis/               # Redis configuration
└── ssl/                 # SSL/TLS certificates
    ├── generate-postgres-certs.sh  # Certificate generation script
    └── postgres/        # PostgreSQL SSL certificates
```

## PostgreSQL SSL/TLS Configuration

### Overview

The PostgreSQL database is configured to use SSL/TLS encryption for all connections to ensure data security in transit. This setup supports both development (self-signed certificates) and production (CA-signed certificates) environments.

### Quick Start

1. **Generate SSL certificates** (for development):
   ```bash
   ./infrastructure/ssl/generate-postgres-certs.sh
   ```

2. **Start PostgreSQL with SSL**:
   ```bash
   pnpm infra:up
   ```

3. **Connect with SSL**:
   Update your `.env` file:
   ```
   DATABASE_URL=postgresql://memecoin:password@localhost:5432/memecoin_lending?sslmode=require
   ```

### SSL Connection Modes

PostgreSQL supports different SSL modes:

- `disable` - No SSL (NOT RECOMMENDED)
- `allow` - Try SSL first, fall back to non-SSL
- `prefer` - Try SSL first, fall back to non-SSL (default)
- `require` - Always use SSL, but don't verify certificates ⚠️
- `verify-ca` - Always use SSL, verify server certificate is signed by trusted CA
- `verify-full` - Always use SSL, verify certificate and hostname match

### Development Setup

For development, use self-signed certificates:

```bash
# Generate certificates
./infrastructure/ssl/generate-postgres-certs.sh

# Connect with SSL required
DATABASE_URL=postgresql://memecoin:password@localhost:5432/memecoin_lending?sslmode=require
```

### Production Setup

For production, use certificates from a trusted CA:

1. **Obtain certificates** from your CA provider:
   - Server certificate (`server.crt`)
   - Server private key (`server.key`)
   - CA certificate (`ca.crt`)
   - Optional: DH parameters (`dhparams.pem`)

2. **Place certificates** in `infrastructure/ssl/postgres/production/`:
   ```bash
   mkdir -p infrastructure/ssl/postgres/production
   cp /path/to/server.crt infrastructure/ssl/postgres/production/
   cp /path/to/server.key infrastructure/ssl/postgres/production/
   cp /path/to/ca.crt infrastructure/ssl/postgres/production/
   chmod 600 infrastructure/ssl/postgres/production/*.key
   chmod 644 infrastructure/ssl/postgres/production/*.crt
   ```

3. **Use production compose file**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
   ```

4. **Connect with full verification**:
   ```
   DATABASE_URL=postgresql://memecoin:password@db.yourdomain.com:5432/memecoin_lending?sslmode=verify-full&sslcert=/path/to/client.crt&sslkey=/path/to/client.key&sslrootcert=/path/to/ca.crt
   ```

### Client Certificate Authentication

For enhanced security, you can use client certificates:

1. **Generate client certificates** (included in the script)
2. **Configure PostgreSQL** to require client certs (see `pg_hba.production.conf`)
3. **Connect with client certificate**:
   ```bash
   psql "postgresql://memecoin@localhost:5432/memecoin_lending?sslmode=verify-full&sslcert=client.crt&sslkey=client.key&sslrootcert=ca.crt"
   ```

### Troubleshooting SSL Issues

1. **Check PostgreSQL logs**:
   ```bash
   docker compose logs postgres
   ```

2. **Test SSL connection**:
   ```bash
   psql "postgresql://memecoin:password@localhost:5432/memecoin_lending?sslmode=require" -c "SELECT ssl_version();"
   ```

3. **Verify certificates**:
   ```bash
   openssl x509 -in infrastructure/ssl/postgres/server.crt -text -noout
   ```

4. **Common issues**:
   - Certificate permissions: Keys must be 600, certificates 644
   - Certificate paths: Ensure paths in config match mounted volumes
   - DNS/hostname mismatch: For `verify-full`, hostname must match certificate CN

### Security Best Practices

1. **Always use SSL in production** - Set `sslmode=require` minimum
2. **Use strong passwords** - Consider certificate-based auth for admin access
3. **Rotate certificates** - Set up certificate expiration monitoring
4. **Restrict network access** - Use firewall rules and Docker networks
5. **Monitor SSL connections** - Check logs for failed SSL handshakes
6. **Use TLS 1.2+** - Configured in `postgresql.conf`

### PM2 Application Configuration

When using PM2 for application deployment, update the `ecosystem.config.cjs`:

```javascript
env: {
  DATABASE_URL: 'postgresql://memecoin:password@localhost:5432/memecoin_lending?sslmode=require',
  // Or use individual parameters
  PGSSLMODE: 'require',
  PGSSLROOTCERT: '/path/to/ca.crt',
  // ... other env vars
}
```

### Monitoring SSL Connections

View active SSL connections:

```sql
SELECT pid, ssl, version, cipher, bits, compression, client_dn 
FROM pg_stat_ssl 
JOIN pg_stat_activity ON pg_stat_ssl.pid = pg_stat_activity.pid;
```

## Backup Configuration

The backup service automatically connects with SSL when `PGSSLMODE` is set. See `backup/README.md` for details.

## Redis Configuration

Redis can also be configured with SSL/TLS. See `redis/README.md` for details.

## PgBouncer Connection Pooling

### Overview

PgBouncer is a lightweight connection pooler for PostgreSQL that reduces the overhead of establishing new database connections. It's essential for high-traffic applications to efficiently manage database connections.

### Architecture

```
Node.js App → PgBouncer (port 6432) → PostgreSQL (port 5432)
```

### Quick Start

1. **Generate password hashes** for PgBouncer users:
   ```bash
   cd infrastructure/pgbouncer
   ./generate-password-hash.sh
   ```

2. **Start services** with PgBouncer:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
   ```

3. **Update application connection** to use PgBouncer:
   ```bash
   # .env file
   DATABASE_URL=postgresql://memecoin:password@localhost:6432/memecoin_lending
   ```

### Configuration

PgBouncer is configured with:
- **Transaction pooling mode**: Best for web applications
- **Max client connections**: 1000
- **Default pool size**: 25 connections per user/database
- **Reserve pool**: 10 connections for burst traffic

Key settings in `pgbouncer.ini`:
```ini
pool_mode = transaction        # Share connections between transactions
max_client_conn = 1000        # Total client connections allowed
default_pool_size = 25        # Connections per user/database pair
reserve_pool_size = 10        # Extra connections for peak load
```

### When to Use Direct Connection vs PgBouncer

| Operation | Connection Type | URL | Reason |
|-----------|----------------|-----|---------|
| Application queries | PgBouncer | `postgresql://user@localhost:6432/db` | Connection pooling, performance |
| Database migrations | Direct | `postgresql://user@localhost:5432/db` | DDL operations, schema changes |
| Bulk data operations | Direct | `postgresql://user@localhost:5432/db` | Long-running transactions |
| Monitoring/Admin | Direct | `postgresql://user@localhost:5432/db` | Database statistics, maintenance |

### User Management

1. **Add a new user**:
   ```bash
   # Generate password hash
   ./infrastructure/pgbouncer/generate-password-hash.sh
   
   # Add to userlist.txt
   "username" "md5hash"
   
   # Reload PgBouncer
   docker compose exec pgbouncer psql -U admin -d pgbouncer -c "RELOAD;"
   ```

2. **Update existing user password**:
   - Generate new hash
   - Update userlist.txt
   - Run RELOAD command

### Monitoring

1. **Real-time monitoring**:
   ```bash
   ./infrastructure/pgbouncer/monitor-pgbouncer.sh
   ```

2. **Connect to admin console**:
   ```bash
   psql -h localhost -p 6432 -U admin pgbouncer
   ```

3. **Key monitoring commands**:
   ```sql
   SHOW POOLS;     -- Connection pool status
   SHOW STATS;     -- Database statistics
   SHOW CLIENTS;   -- Active client connections
   SHOW SERVERS;   -- Backend server connections
   SHOW CONFIG;    -- Current configuration
   ```

### Performance Tuning

1. **Monitor pool usage**:
   ```sql
   -- Check for waiting clients
   SHOW POOLS;
   -- Look at cl_waiting column
   ```

2. **Adjust pool sizes** based on load:
   ```ini
   # For high concurrent users
   default_pool_size = 50
   
   # For bursty traffic
   reserve_pool_size = 20
   reserve_pool_timeout = 10
   ```

3. **Connection lifecycle tuning**:
   ```ini
   server_lifetime = 3600      # Reuse connections for 1 hour
   server_idle_timeout = 600   # Close idle connections after 10 min
   ```

### Troubleshooting

1. **"no more connections allowed"**:
   - Increase `max_client_conn` or `default_pool_size`
   - Check for connection leaks in application

2. **"query_wait_timeout"**:
   - Increase `query_wait_timeout`
   - Add more PostgreSQL connections
   - Check for long-running queries

3. **High server turnover** (sv_used count):
   - Increase `server_lifetime`
   - Check for connection errors

### Production Checklist

- [ ] Generate secure password hashes
- [ ] Set appropriate pool sizes based on load testing
- [ ] Configure SSL/TLS for PgBouncer connections
- [ ] Set up monitoring and alerting
- [ ] Document connection strings for different environments
- [ ] Plan for connection limits during peak traffic
- [ ] Configure log rotation for PgBouncer logs

### PM2 Configuration with PgBouncer

Update `ecosystem.config.cjs` to use PgBouncer:

```javascript
env: {
  // Application connections through PgBouncer
  DATABASE_URL: 'postgresql://memecoin:password@localhost:6432/memecoin_lending',
  
  // Direct connection for migrations (if needed)
  DATABASE_URL_DIRECT: 'postgresql://memecoin:password@localhost:5432/memecoin_lending?sslmode=require',
}
```

### Migration Script Example

```bash
#!/bin/bash
# Use direct connection for migrations
export DATABASE_URL=$DATABASE_URL_DIRECT
pnpm db:migrate
```

## Additional Resources

- [PostgreSQL SSL Documentation](https://www.postgresql.org/docs/current/ssl-tcp.html)
- [PgBouncer Documentation](https://www.pgbouncer.org/)
- [Docker Compose Override Documentation](https://docs.docker.com/compose/extends/)
- [PM2 Environment Configuration](https://pm2.keymetrics.io/docs/usage/application-declaration/)