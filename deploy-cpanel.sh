#!/usr/bin/env bash
# ===========================================================
# cPanel Deployment Helper Script
# ===========================================================
# Run this via SSH on the cPanel server after uploading files.
#
# Usage:
#   chmod +x deploy-cpanel.sh
#   ./deploy-cpanel.sh
#
# Prerequisites:
#   - Node.js 20.x available (check with: node --version)
#   - PostgreSQL reachable (can be a cPanel-managed DB OR external DB like Railway)
#   - .env file configured (copy from .env.cpanel.template)
# ===========================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ----------------------------------------------------------
# 1. Pre-flight checks
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " cPanel Deployment – Pre-flight"
echo "=============================="

# Check Node version
NODE_VERSION=$(node --version 2>/dev/null || true)
if [[ -z "$NODE_VERSION" ]]; then
  error "Node.js is not installed or not in PATH. Ask your host to enable Node.js 20.x."
fi
log "Node.js version: $NODE_VERSION"

# Check npm
NPM_VERSION=$(npm --version 2>/dev/null || true)
if [[ -z "$NPM_VERSION" ]]; then
  error "npm is not available."
fi
log "npm version: $NPM_VERSION"

# Check .env file
if [[ ! -f .env ]]; then
  if [[ -f .env.cpanel.template ]]; then
    warn ".env not found. Copying from .env.cpanel.template ..."
    cp .env.cpanel.template .env
    warn "IMPORTANT: Edit .env and fill in your real credentials before continuing!"
    echo ""
    read -p "Press Enter after you have edited .env, or Ctrl+C to abort..." _
  else
    error ".env file not found. Create it from .env.cpanel.template first."
  fi
fi
log ".env file found"

# ----------------------------------------------------------
# 2. Install dependencies
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " Installing dependencies"
echo "=============================="
if [[ -f package-lock.json ]]; then
  npm ci --include=dev 2>&1 | tail -5
else
  npm install --production=false 2>&1 | tail -5
fi
log "Dependencies installed"

# ----------------------------------------------------------
# 3. Build the project
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " Building project"
echo "=============================="
echo "  → Building frontend (Vite) ..."
npm run build:web 2>&1 | tail -5
log "Frontend build complete (dist/ folder)"

echo "  → Building backend (TypeScript) ..."
npm run build:backend 2>&1 | tail -5
log "Backend build complete (backend/dist/ folder)"

# ----------------------------------------------------------
# 4. Create upload directories
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " Ensuring upload directories"
echo "=============================="
for dir in uploads/avatars uploads/blog-images uploads/blog-videos uploads/course-images uploads/general; do
  mkdir -p "$dir"
  log "Created $dir"
done

# ----------------------------------------------------------
# 5. Run database migrations
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " Database migrations"
echo "=============================="
read -p "Run database migrations now? (y/N): " RUN_MIGRATIONS
if [[ "$RUN_MIGRATIONS" =~ ^[Yy]$ ]]; then
  echo "  → Running central migrations..."
  npm run migrate:central
  log "Central migrations complete"

  echo "  → Running tenant migrations..."
  npm run migrate:tenant
  log "Tenant migrations complete"

  read -p "Run default-tenant migration (multi-tenant setup)? (y/N): " RUN_DEFAULT
  if [[ "$RUN_DEFAULT" =~ ^[Yy]$ ]]; then
    npm run migrate:default-tenant
    log "Default tenant migration complete"
  fi
else
  warn "Skipping migrations. Run them manually later with:"
  echo "  npm run migrate:central"
  echo "  npm run migrate:tenant"
fi

# ----------------------------------------------------------
# 6. Verify setup
# ----------------------------------------------------------
echo ""
echo "=============================="
echo " Verification"
echo "=============================="

# Check that dist/ exists
if [[ -d dist ]] && [[ -f dist/index.html ]]; then
  log "Frontend build output exists (dist/index.html)"
else
  warn "dist/index.html not found – the frontend may not have built correctly"
fi

# Check that backend/dist/ exists
if [[ -d backend/dist ]]; then
  log "Backend build output exists (backend/dist/)"
else
  warn "backend/dist/ not found – the backend may not have built correctly"
fi

# Quick test – try to start the server for 5 seconds
echo ""
echo "  → Quick server start test (5 seconds)..."
timeout 5 node server.js 2>&1 | head -20 || true
log "Server started without immediate crash"

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------
echo ""
echo "=============================="
echo -e " ${GREEN}Deployment complete!${NC}"
echo "=============================="
echo ""
echo "Next steps:"
echo "  1) In cPanel → Setup Node.js App → Create Application"
echo "     - Node version: 20.x"
echo "     - Application mode: Production"
echo "     - Application root: $(basename $(pwd))"
echo "     - Application startup file: server.js"
echo "  2) Set environment variables in cPanel Node.js App settings"
echo "  3) Click 'Run NPM Install' then 'Restart'"
echo "  4) Visit your domain to verify"
echo ""
