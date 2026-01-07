#!/bin/bash
# PostgreSQL SSL Certificate Generation Script
# This script generates self-signed SSL certificates for PostgreSQL

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CERT_DIR="./infrastructure/ssl/postgres"
DAYS_VALID=3650  # 10 years for self-signed certs
KEY_SIZE=4096
COUNTRY="US"
STATE="CA"
LOCALITY="San Francisco"
ORGANIZATION="Memecoin Lending"
ORGANIZATIONAL_UNIT="Database"
COMMON_NAME="postgres"

echo -e "${GREEN}PostgreSQL SSL Certificate Generator${NC}"
echo "======================================"

# Check if running from project root
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: This script must be run from the project root directory${NC}"
    exit 1
fi

# Create directory if it doesn't exist
mkdir -p "$CERT_DIR"

echo -e "${YELLOW}Generating certificates in: $CERT_DIR${NC}"

# Generate CA private key
echo -e "\n${GREEN}1. Generating CA private key...${NC}"
openssl genrsa -out "$CERT_DIR/ca.key" $KEY_SIZE

# Generate CA certificate
echo -e "\n${GREEN}2. Generating CA certificate...${NC}"
openssl req -new -x509 -days $DAYS_VALID -key "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORGANIZATIONAL_UNIT/CN=PostgreSQL CA"

# Generate server private key
echo -e "\n${GREEN}3. Generating server private key...${NC}"
openssl genrsa -out "$CERT_DIR/server.key" $KEY_SIZE

# Generate server certificate request
echo -e "\n${GREEN}4. Generating server certificate request...${NC}"
openssl req -new -key "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORGANIZATIONAL_UNIT/CN=$COMMON_NAME"

# Create extensions file for server certificate
cat > "$CERT_DIR/server_extensions.cnf" << EOF
subjectAltName = DNS:postgres,DNS:localhost,DNS:*.postgres,IP:127.0.0.1,IP:::1
EOF

# Sign server certificate with CA
echo -e "\n${GREEN}5. Signing server certificate with CA...${NC}"
openssl x509 -req -in "$CERT_DIR/server.csr" -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" \
    -CAcreateserial -out "$CERT_DIR/server.crt" -days $DAYS_VALID \
    -extfile "$CERT_DIR/server_extensions.cnf"

# Generate client private key (for optional client certificate authentication)
echo -e "\n${GREEN}6. Generating client private key...${NC}"
openssl genrsa -out "$CERT_DIR/client.key" $KEY_SIZE

# Generate client certificate request
echo -e "\n${GREEN}7. Generating client certificate request...${NC}"
openssl req -new -key "$CERT_DIR/client.key" -out "$CERT_DIR/client.csr" \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORGANIZATIONAL_UNIT/CN=postgres-client"

# Sign client certificate with CA
echo -e "\n${GREEN}8. Signing client certificate with CA...${NC}"
openssl x509 -req -in "$CERT_DIR/client.csr" -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" \
    -CAcreateserial -out "$CERT_DIR/client.crt" -days $DAYS_VALID

# Set appropriate permissions
echo -e "\n${GREEN}9. Setting appropriate permissions...${NC}"
chmod 600 "$CERT_DIR"/*.key
chmod 644 "$CERT_DIR"/*.crt

# Clean up temporary files
rm -f "$CERT_DIR"/*.csr "$CERT_DIR"/*.srl "$CERT_DIR"/server_extensions.cnf

# Create a combined certificate for PostgreSQL (server.crt + ca.crt)
echo -e "\n${GREEN}10. Creating combined certificate for PostgreSQL...${NC}"
cat "$CERT_DIR/server.crt" "$CERT_DIR/ca.crt" > "$CERT_DIR/server-combined.crt"

# Generate DH parameters for extra security (optional but recommended)
echo -e "\n${GREEN}11. Generating DH parameters (this may take a moment)...${NC}"
openssl dhparam -out "$CERT_DIR/dhparams.pem" 2048

# Create .gitignore to prevent committing certificates
cat > "$CERT_DIR/.gitignore" << EOF
# Ignore all certificate files
*.key
*.crt
*.pem
*.csr
*.srl

# But allow this gitignore file
!.gitignore

# Allow README if you add documentation
!README.md
EOF

echo -e "\n${GREEN}✅ SSL certificates generated successfully!${NC}"
echo -e "\nGenerated files:"
echo -e "  - CA Certificate: ${YELLOW}$CERT_DIR/ca.crt${NC}"
echo -e "  - CA Private Key: ${YELLOW}$CERT_DIR/ca.key${NC}"
echo -e "  - Server Certificate: ${YELLOW}$CERT_DIR/server.crt${NC}"
echo -e "  - Server Private Key: ${YELLOW}$CERT_DIR/server.key${NC}"
echo -e "  - Combined Server Certificate: ${YELLOW}$CERT_DIR/server-combined.crt${NC}"
echo -e "  - Client Certificate: ${YELLOW}$CERT_DIR/client.crt${NC}"
echo -e "  - Client Private Key: ${YELLOW}$CERT_DIR/client.key${NC}"
echo -e "  - DH Parameters: ${YELLOW}$CERT_DIR/dhparams.pem${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Update docker-compose.yml to mount these certificates"
echo "2. Configure PostgreSQL to use SSL"
echo "3. Update DATABASE_URL to include sslmode=require"
echo ""
echo -e "${YELLOW}For production:${NC}"
echo "Replace these self-signed certificates with certificates from a trusted CA"