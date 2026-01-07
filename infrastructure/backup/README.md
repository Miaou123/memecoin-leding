# PostgreSQL Backup System

Production-grade backup solution for Memecoin Lending Protocol PostgreSQL database.

## Features

- **Automated backups** every 6 hours
- **Local storage** with 7-day retention
- **S3 remote storage** with 30-day retention
- **Backup integrity verification**
- **Telegram notifications** on backup events
- **Safe restore** with pre-restore safety backup
- **Docker-based** deployment

## Quick Start

### 1. Configure Environment

Add these to your `.env` file:

```bash
# Required
DB_PASSWORD=your_secure_password

# Optional but recommended for production
BACKUP_S3_BUCKET=your-backup-bucket
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Optional - uses main app's Telegram config if set
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 2. Start Backup Service

```bash
# Start automated backup service
docker compose -f docker-compose.yml -f docker-compose.backup.yml up -d postgres-backup

# Check logs
docker compose logs postgres-backup
```

### 3. Verify Backups

```bash
# List local backups
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --list

# Check backup volume
docker volume ls | grep postgres_backups
```

## Manual Operations

### Create Backup Now

```bash
# Run one-off backup
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-backup-now
```

### List Backups

```bash
# List local backups
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --list

# List S3 backups (if configured)
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --list-s3
```

### Restore Database

```bash
# Restore from latest backup (dry run first!)
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --latest --dry-run

# Restore from latest backup (DANGEROUS - will replace all data)
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --latest

# Restore from specific backup
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore /backups/memecoin_lending_20240115_120000.dump

# Restore from S3
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --from-s3 s3://your-bucket/memecoin-lending/postgres/backup.dump
```

## S3 Setup

### 1. Create S3 Bucket

```bash
# Create bucket
aws s3 mb s3://your-backup-bucket --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket your-backup-bucket \
  --versioning-configuration Status=Enabled

# Set lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
  --bucket your-backup-bucket \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "BackupLifecycle",
        "Status": "Enabled",
        "Filter": {"Prefix": "memecoin-lending/postgres/"},
        "Transitions": [
          {"Days": 30, "StorageClass": "GLACIER"}
        ],
        "Expiration": {"Days": 365}
      }
    ]
  }'
```

### 2. Create IAM User

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-backup-bucket/*",
        "arn:aws:s3:::your-backup-bucket"
      ]
    }
  ]
}
```

## Backup Strategy

### Local Backups
- **Frequency**: Every 6 hours
- **Retention**: 7 days
- **Location**: Docker volume `postgres_backups`
- **Formats**: 
  - `.dump` - PostgreSQL custom format (compressed, flexible restore)
  - `.sql.gz` - Gzipped SQL for manual inspection

### Remote Backups (S3)
- **Frequency**: Every backup is uploaded
- **Retention**: 30 days in S3, then moved to Glacier
- **Storage Class**: STANDARD_IA (Infrequent Access)
- **Lifecycle**: Glacier after 30 days, deleted after 1 year

### Notifications
- Telegram alerts on:
  - ✅ Successful backups
  - ❌ Failed backups
  - 🔄 Database restores

## Monitoring

### Check Backup Health

```bash
# View recent backup logs
docker compose logs --tail 100 postgres-backup

# Check backup sizes
docker compose exec postgres-backup ls -lah /backups/

# Verify latest backup
docker compose exec postgres-backup pg_restore --list /backups/latest.dump
```

### Backup Metrics

Monitor these key metrics:
- Backup completion time
- Backup file size
- S3 upload success
- Available disk space
- Number of retained backups

## Disaster Recovery

### Recovery Time Objective (RTO)
- **Local restore**: ~5-10 minutes
- **S3 restore**: ~15-30 minutes (depends on size)

### Recovery Point Objective (RPO)
- **Maximum data loss**: 6 hours (backup frequency)
- **Typical data loss**: < 3 hours

### Recovery Procedures

1. **Identify backup to restore**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --list
   ```

2. **Test restore (dry run)**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --latest --dry-run
   ```

3. **Stop application**
   ```bash
   docker compose stop api
   ```

4. **Perform restore**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm postgres-restore --latest
   ```

5. **Restart application**
   ```bash
   docker compose start api
   ```

## Troubleshooting

### Backup Failures

```bash
# Check disk space
docker system df

# Check PostgreSQL connectivity
docker compose exec postgres-backup pg_isready -h postgres -U memecoin

# Test backup manually
docker compose exec postgres-backup /usr/local/bin/backup
```

### S3 Issues

```bash
# Test S3 credentials
docker compose exec postgres-backup aws s3 ls s3://your-bucket/

# Check AWS credentials
docker compose exec postgres-backup env | grep AWS
```

### Restore Issues

```bash
# Verify backup integrity
docker compose exec postgres-backup pg_restore --list /backups/your-backup.dump

# Check database permissions
docker compose exec postgres psql -U memecoin -c "\l"
```

## Best Practices

1. **Test restores regularly** - At least monthly in staging
2. **Monitor backup sizes** - Sudden changes may indicate issues
3. **Verify S3 uploads** - Check AWS console periodically
4. **Keep credentials secure** - Use AWS IAM roles in production
5. **Document recovery procedures** - Update runbooks as needed
6. **Set up monitoring alerts** - For backup failures and disk space

## Security Considerations

- Backups contain sensitive financial data
- Encrypt S3 bucket with KMS
- Use IAM roles instead of keys when possible
- Restrict backup access to authorized personnel
- Audit restore operations
- Consider encryption at rest for local backups

## Maintenance

### Weekly
- Verify backup completion
- Check available disk space
- Review backup sizes for anomalies

### Monthly
- Test restore procedure in staging
- Review S3 costs and storage
- Update documentation as needed

### Quarterly
- Full disaster recovery drill
- Review and update backup retention policies
- Audit access permissions