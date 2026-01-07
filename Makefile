.PHONY: help build test deploy infra ssl

# Default target
help:
	@echo "Memecoin Lending Protocol - Makefile"
	@echo "===================================="
	@echo ""
	@echo "Available targets:"
	@echo "  make ssl-generate    - Generate self-signed SSL certificates for PostgreSQL"
	@echo "  make ssl-verify      - Verify SSL certificate configuration"
	@echo "  make ssl-clean       - Remove generated SSL certificates"
	@echo ""
	@echo "  make infra-up        - Start infrastructure (PostgreSQL, Redis, Backup)"
	@echo "  make infra-down      - Stop infrastructure"
	@echo "  make infra-logs      - View infrastructure logs"
	@echo "  make infra-ssl       - Start infrastructure with SSL verification"
	@echo ""
	@echo "  make build           - Build all applications"
	@echo "  make test            - Run all tests"
	@echo "  make deploy          - Deploy smart contracts"
	@echo ""
	@echo "  make pm2-start       - Start applications with PM2"
	@echo "  make pm2-stop        - Stop PM2 applications"
	@echo "  make pm2-restart     - Restart PM2 applications"
	@echo "  make pm2-logs        - View PM2 logs"
	@echo ""
	@echo "  make start-all       - Start infrastructure and applications"
	@echo "  make stop-all        - Stop everything"

# SSL Certificate Management
ssl-generate:
	@echo "🔐 Generating PostgreSQL SSL certificates..."
	@./infrastructure/ssl/generate-postgres-certs.sh

ssl-verify:
	@echo "🔍 Verifying SSL certificates..."
	@if [ -f infrastructure/ssl/postgres/server.crt ]; then \
		echo "✅ Server certificate found"; \
		openssl x509 -in infrastructure/ssl/postgres/server.crt -noout -dates; \
	else \
		echo "❌ Server certificate not found. Run 'make ssl-generate' first"; \
		exit 1; \
	fi
	@if [ -f infrastructure/ssl/postgres/ca.crt ]; then \
		echo "✅ CA certificate found"; \
		openssl x509 -in infrastructure/ssl/postgres/ca.crt -noout -subject; \
	else \
		echo "❌ CA certificate not found"; \
		exit 1; \
	fi

ssl-clean:
	@echo "🧹 Cleaning SSL certificates..."
	@read -p "Are you sure you want to delete all SSL certificates? [y/N] " confirm && \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		rm -f infrastructure/ssl/postgres/*.{key,crt,pem}; \
		echo "✅ SSL certificates removed"; \
	else \
		echo "❌ Cancelled"; \
	fi

# Infrastructure Management
infra-up: ssl-verify
	@echo "🚀 Starting infrastructure with SSL..."
	@docker compose up -d

infra-down:
	@echo "🛑 Stopping infrastructure..."
	@docker compose down

infra-logs:
	@docker compose logs -f

infra-ssl:
	@echo "🔒 Starting infrastructure with production SSL..."
	@docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

infra-test-ssl:
	@echo "🔍 Testing PostgreSQL SSL connection..."
	@docker compose exec postgres psql -U memecoin -d memecoin_lending -c "SELECT version(), ssl_version(), ssl_cipher();" || \
		echo "❌ Failed to connect. Is PostgreSQL running with SSL?"

# Application Management
build:
	@echo "🔨 Building applications..."
	@pnpm build

test:
	@echo "🧪 Running tests..."
	@pnpm test

deploy:
	@echo "📦 Deploying smart contracts..."
	@pnpm deploy:devnet

# PM2 Management
pm2-start: build
	@echo "🚀 Starting applications with PM2..."
	@pnpm pm2:start

pm2-stop:
	@echo "🛑 Stopping PM2 applications..."
	@pnpm pm2:stop

pm2-restart:
	@echo "🔄 Restarting PM2 applications..."
	@pnpm pm2:restart

pm2-logs:
	@pnpm pm2:logs

# Combined Commands
start-all: ssl-verify infra-up pm2-start
	@echo "✅ Everything is running!"
	@echo "   - Infrastructure: PostgreSQL (SSL), Redis, Backup"
	@echo "   - Applications: Server, Web (PM2)"
	@echo ""
	@echo "View logs:"
	@echo "   - Infrastructure: make infra-logs"
	@echo "   - Applications: make pm2-logs"

stop-all: pm2-stop infra-down
	@echo "✅ Everything stopped"

# Database Management
db-migrate:
	@echo "🗄️ Running database migrations (direct connection)..."
	@./scripts/db-migrate-direct.sh

db-migrate-via-pgbouncer:
	@echo "⚠️  Warning: Migrations should use direct connection, not PgBouncer"
	@echo "Use: make db-migrate"

db-backup:
	@echo "💾 Creating database backup..."
	@docker compose exec postgres-backup backup

db-connect:
	@echo "🔌 Connecting to PostgreSQL directly (bypassing PgBouncer)..."
	@docker compose exec postgres psql -U memecoin -d memecoin_lending

db-connect-pgbouncer:
	@echo "🔌 Connecting via PgBouncer..."
	@psql -h localhost -p 6432 -U memecoin memecoin_lending

# PgBouncer Management
pgbouncer-monitor:
	@echo "📊 Monitoring PgBouncer..."
	@./infrastructure/pgbouncer/monitor-pgbouncer.sh

pgbouncer-stats:
	@echo "📈 PgBouncer Statistics..."
	@psql -h localhost -p 6432 -U admin pgbouncer -c "SHOW STATS;"

pgbouncer-pools:
	@echo "🏊 PgBouncer Connection Pools..."
	@psql -h localhost -p 6432 -U admin pgbouncer -c "SHOW POOLS;"

pgbouncer-reload:
	@echo "🔄 Reloading PgBouncer configuration..."
	@psql -h localhost -p 6432 -U admin pgbouncer -c "RELOAD;"

pgbouncer-password:
	@echo "🔐 Generate PgBouncer password hash..."
	@cd infrastructure/pgbouncer && ./generate-password-hash.sh

# Development Helpers
dev-reset: stop-all ssl-clean
	@echo "🧹 Resetting development environment..."
	@rm -rf logs/
	@mkdir -p logs
	@make ssl-generate
	@make start-all

# WAL Archiving and PITR
wal-status:
	@echo "🔍 Checking WAL archiving status..."
	@docker compose exec postgres psql -U memecoin -d memecoin_lending -c "SELECT * FROM pg_stat_archiver;"
	@echo ""
	@echo "📊 Current WAL location:"
	@docker compose exec postgres psql -U memecoin -d memecoin_lending -c "SELECT pg_current_wal_lsn();"
	@echo ""
	@echo "📁 Recent WAL archives in S3:"
	@aws s3 ls s3://${BACKUP_S3_BUCKET}/memecoin-lending/postgres/wal-archive/ --recursive | tail -10

wal-monitor:
	@echo "📊 Monitoring WAL archiving..."
	@./infrastructure/backup/wal-monitor.sh

pitr-list:
	@echo "📋 Listing available recovery points..."
	@./infrastructure/backup/pitr-restore.sh list

pitr-restore:
	@echo "🔄 Starting Point-in-Time Recovery..."
	@echo "Usage: make pitr-restore TIMESTAMP=\"2024-01-15 14:30:00\""
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "❌ Error: TIMESTAMP required"; \
		echo "Example: make pitr-restore TIMESTAMP=\"2024-01-15 14:30:00\""; \
		exit 1; \
	fi
	@./infrastructure/backup/pitr-restore.sh restore --timestamp "$(TIMESTAMP)"

pitr-restore-dry:
	@echo "🔍 PITR dry run..."
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "❌ Error: TIMESTAMP required"; \
		echo "Example: make pitr-restore-dry TIMESTAMP=\"2024-01-15 14:30:00\""; \
		exit 1; \
	fi
	@./infrastructure/backup/pitr-restore.sh restore --timestamp "$(TIMESTAMP)" --dry-run

# Production Deployment
prod-check:
	@echo "🔍 Checking production readiness..."
	@echo ""
	@echo "SSL Certificates:"
	@if [ -d infrastructure/ssl/postgres/production ]; then \
		echo "✅ Production certificate directory exists"; \
		ls -la infrastructure/ssl/postgres/production/; \
	else \
		echo "❌ Production certificates missing"; \
		echo "   Place your CA-signed certificates in infrastructure/ssl/postgres/production/"; \
	fi
	@echo ""
	@echo "Environment:"
	@if [ -f .env ]; then \
		echo "✅ .env file exists"; \
		grep -q "sslmode=verify-full" .env && echo "✅ SSL mode set to verify-full" || echo "⚠️  SSL mode not set to verify-full"; \
	else \
		echo "❌ .env file missing"; \
	fi

prod-deploy: prod-check
	@echo "🚀 Deploying production configuration..."
	@docker compose -f docker-compose.yml -f docker-compose.production.yml up -d