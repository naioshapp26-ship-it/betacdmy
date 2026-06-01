# cPanel Deployment Guide - LMS Application

**Last Updated:** February 16, 2026
**Production Server:** `$SSH_HOST` (your cPanel server hostname)
**Production URL:** `$PRODUCTION_URL` (your production domain)
**Testing URL (Railway):** Your Railway deployment URL

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Dual Deployment Architecture](#dual-deployment-architecture)
3. [Initial cPanel Deployment (One-Time Setup)](#initial-cpanel-deployment-one-time-setup)
4. [How to Deploy Changes](#how-to-deploy-changes)
5. [Commands Reference](#commands-reference)
6. [Troubleshooting](#troubleshooting)
7. [Security Information](#security-information)

---

## Overview

This project is deployed in **two environments**:

| Environment | Platform | Purpose | Auto-Deploy |
|-------------|----------|---------|-------------|
| **Testing** | Railway | Test new features before going live | ✅ Yes (on git push) |
| **Production** | cPanel | Live customer-facing website | ❌ No (manual deploy script) |

---

## Dual Deployment Architecture

```
Your Local Machine
       ↓
   git push origin main
       ↓
   GitHub Repository
       ├─────→ Railway (Auto-deploys automatically)
       │       Test your changes here first
       │
       └─────→ cPanel (Manual deploy using script)
               Production site
```

**Workflow:**
1. Make code changes locally
2. Push to GitHub: `git push origin main`
3. Railway automatically deploys (wait 2-3 minutes)
4. Test on Railway to ensure everything works
5. If tests pass, run the deploy script for cPanel
6. Production is updated!

---

## Initial cPanel Deployment (One-Time Setup)

This section documents what was done to deploy the application to cPanel initially. **You don't need to repeat these steps** - they're documented for reference.

### 1. Server Access Information

```
SSH Host: $SSH_USER@$SSH_HOST
cPanel URL: $CPANEL_URL
Username: $SSH_USER
Password: $SSH_PASSWORD
```

**Note:** Replace the `$...` variables with your actual credentials. Keep these secure and never commit them to git.

### 2. Application Setup

**Application Directory:**
```
/home/$SSH_USER/public_html/$APP_DIRECTORY/
```

**Environment Configuration:**
```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME

# Recommended when you keep tenant tables in a separate database:
TENANT_DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$TENANT_DB_NAME

# Central DB (multi-tenant SaaS metadata: tenants, platform users, subscriptions, etc.)
CENTRAL_DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
MAIN_DOMAIN=$YOUR_DOMAIN
```

### 3. Database Setup

**Central Database:** `$DB_NAME`
**Tenant Database:** `$TENANT_DB_NAME`

Applied migrations:
- Central migrations: 001-026
- Tenant migrations: 001-025

**⚠️ IMPORTANT:**
- Central migration 025 adds support for `pending_payment` status required for tenant provisioning.
- Central migration 026 fixes a legacy `set_updated_at()` trigger crash when older tables are missing `updated_at`.

### 4. Apache Reverse Proxy

**Configuration File:** `/home/$SSH_USER/public_html/$YOUR_DOMAIN/.htaccess`

```apache
RewriteEngine On

# Force HTTPS
RewriteCond %{HTTPS} !=on
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

# Proxy WebSocket connections
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^(.*)$ http://127.0.0.1:3001/$1 [P,L]

# Proxy all requests to Node.js app
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ http://127.0.0.1:3001/$1 [P,L]
```

### 5. DNS Configuration

| Record Type | Name | Value | Purpose |
|-------------|------|-------|---------|
| A | $YOUR_DOMAIN | $SERVER_IP | Main domain |
| A | www.$YOUR_DOMAIN | $SERVER_IP | WWW subdomain |
| A | *.$YOUR_DOMAIN | $SERVER_IP | Wildcard for tenants |

**DNS was migrated from Railway CNAMEs to direct A records pointing to cPanel server.**

### 6. SSL/HTTPS Configuration

**⚠️ IMPORTANT: Wildcard SSL Required for Multi-Tenant SaaS**

This is a multi-tenant SaaS application where each tenant gets their own subdomain (e.g., `tenant1.betacdmy.com`, `tenant2.betacdmy.com`).

**SSL Strategy: Wildcard Certificate**
- A **single wildcard SSL certificate** (`*.betacdmy.com`) covers ALL tenant subdomains automatically
- No manual SSL provisioning needed per tenant
- Scalable to thousands of tenants

#### Current SSL Setup
- **Provider:** Let's Encrypt
- **Main Domain:** ✅ HTTPS enabled for `betacdmy.com` and `www.betacdmy.com`
- **Wildcard Certificate:** ⚠️ **REQUIRED** - Must be manually configured in cPanel/WHM

#### Setup Wildcard SSL Certificate
**See detailed guide:** [docs/WILDCARD_SSL_SETUP.md](./WILDCARD_SSL_SETUP.md)

**Quick summary:**
1. Verify wildcard DNS record exists: `*.betacdmy.com` → server IP
2. Request wildcard SSL in cPanel (SSL/TLS Status → AutoSSL or manual installation)
3. Configure Apache to use wildcard cert for `*.betacdmy.com`
4. Test tenant subdomains to verify SSL works

**Certificate Valid Until:** Check in cPanel → SSL/TLS Status

**⚠️ DO NOT create individual subdomains in cPanel** - This does not scale. Use wildcard DNS + wildcard SSL only.

### 7. Git & Deploy Script Setup

**Deploy Script Location:** `/home/$SSH_USER/public_html/deploy.sh`

**SSH Deploy Key:**
- **Type:** ED25519 (read-only)
- **Location:** `/home/$SSH_USER/.ssh/github_deploy_key`
- **Access:** Only your GitHub repository
- **Added to GitHub:** Repository Settings → Deploy Keys

**Git Repository:**
```bash
Remote: git@github.com:$GITHUB_USERNAME/$REPO_NAME.git
Branch: main
```

---

## How to Deploy Changes

### Option A: Deploy from Your Local Computer (Recommended)

**Single Command Deployment:**

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST 'bash /home/$SSH_USER/public_html/deploy.sh'
```

**What this does:**
1. Connects to cPanel server via SSH
2. Runs the deploy script
3. Pulls latest code from GitHub
4. Installs dependencies
5. Restarts the application

**Time:** 30-60 seconds

---

### Option B: Deploy from cPanel Terminal

**Steps:**
1. Go to: $CPANEL_URL
2. Login with: `$SSH_USER` / `$SSH_PASSWORD`
3. Search for "Terminal" and open it
4. Run:
```bash
bash /home/$SSH_USER/public_html/deploy.sh
```

---

### What the Deploy Script Does

The deploy script (`/home/$SSH_USER/public_html/deploy.sh`) automatically:

```bash
#!/bin/bash

# 1. Navigate to app directory
cd /home/$SSH_USER/public_html/$APP_DIRECTORY

# 2. Pull latest code from GitHub
git pull origin main

# 3. Install ALL dependencies (including dev dependencies for build tools)
NPM_CONFIG_CACHE=$APP_DIRECTORY/.npm-tmp PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit

# 4. Fix permissions on node_modules/.bin
chmod -R +x node_modules/.bin/

# 5. Build frontend (React/Vite)
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/vite build

# 6. Restart the Node.js application
pkill -f "node server.js"  # Kill existing process
sleep 2  # Wait for process to terminate
nohup node server.js > ./app.log 2>&1 &  # Start in background

# 7. Verify application started
sleep 3
ps aux | grep "node server.js" | grep -v grep

# 8. Show success message
echo "✅ Deployment complete!"
echo "🌐 Site: https://$YOUR_DOMAIN"
echo "📝 View logs: tail -f $APP_DIRECTORY/app.log"
```

**Important Notes:**
- The script uses `pkill` and `nohup` instead of PM2 to avoid permission issues in cPanel environments
- Frontend is **automatically rebuilt** on each deployment to ensure latest changes are visible
- Uses custom npm cache directory to avoid permission issues
- Skips Puppeteer download as it's not needed for runtime

---

## Commands Reference

### Check if Application is Running

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "ps aux | grep 'node server.js' | grep -v grep"
```

**Expected Output:**
```
$SSH_USER  31485  0.0  0.1  node server.js
```

---

### View Application Logs

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "tail -f /home/$SSH_USER/public_html/$APP_DIRECTORY/app.log"
```

Press `Ctrl+C` to stop viewing logs.

---

### Check Current Git Status

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cd /home/$SSH_USER/public_html/$APP_DIRECTORY && git status"
```

---

### See Last 5 Commits on Server

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cd /home/$SSH_USER/public_html/$APP_DIRECTORY && git log --oneline -5"
```

---

### Manually Restart Application

```bash
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "pkill -f 'node server.js' && cd /home/$SSH_USER/public_html/$APP_DIRECTORY && nohup node server.js > ./app.log 2>&1 &"
```

---

### Test Website Connectivity

**Test Main Domain:**
```bash
curl -I https://$YOUR_DOMAIN
```

**Test Subdomain (Tenant):**
```bash
curl -I https://$TENANT_SUBDOMAIN.$YOUR_DOMAIN
```

**Test API Endpoint:**
```bash
curl https://$YOUR_DOMAIN/api/bootstrap
```

---

## Troubleshooting

### Issue: Deploy Script Shows "Git pull failed"

**Cause:** GitHub SSH authentication issue

**Solution:**
```bash
# Test SSH connection to GitHub
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "ssh -T git@github.com"

# Should see: "Hi $GITHUB_USERNAME! You've successfully authenticated..."
```

If authentication fails, check if the deploy key is still active at:
https://github.com/$GITHUB_USERNAME/$REPO_NAME/settings/keys

---

### Issue: Website Shows Blank Page

**Cause:** Application crashed or not running

**Solution:**
```bash
# Check if app is running
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "ps aux | grep 'node server.js' | grep -v grep"

# Check application logs for errors
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "tail -50 /home/$SSH_USER/public_html/$APP_DIRECTORY/app.log"

# Restart application
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST 'bash /home/$SSH_USER/public_html/deploy.sh'
```

---

### Issue: npm install fails

**Cause:** Dependency conflicts or npm registry issues

**Solution:**
```bash
# SSH into server
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST

# Navigate to app directory
cd /home/$SSH_USER/public_html/$APP_DIRECTORY

# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm install --production

# Restart app
pkill -f "node server.js"
nohup node server.js > ./app.log 2>&1 &
```

---

### Issue: Database Connection Errors

**Cause:** Database credentials changed or PostgreSQL not running

**Solution:**
```bash
# Test database connection
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -c 'SELECT version();'"

# Check .env file
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cat /home/$SSH_USER/public_html/$APP_DIRECTORY/.env | grep DATABASE_URL"
```

---

### Issue: Tenant Provisioning Fails with "Tenant provisioning failed"

**Cause:** Database constraint violation - missing `pending_payment` status support

**Symptoms:**
- New tenant signup process fails at payment step
- Error in logs: "violates check constraint 'tenants_status_valid'"
- Error message: "Tenant provisioning failed"

**Solution:**
```bash
# 1. Check if migration 025 is applied
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -c \"SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_name = 'tenants_status_valid';\""

# 2. If the constraint doesn't include 'pending_payment', apply the fix:
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -c \"ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_valid; ALTER TABLE tenants ADD CONSTRAINT tenants_status_valid CHECK (status IN ('active', 'suspended', 'deleted', 'pending_payment'));\""

# 3. Add activated_at column if missing
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -c \"ALTER TABLE tenants ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;\""

# 4. Or run migration 025 to apply both fixes
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cd /home/$SSH_USER/public_html/$APP_DIRECTORY && npm run migrate:central"
```

---

### Issue: Changes Not Showing on Website

**Possible Causes:**
1. Forgot to run deploy script after pushing to GitHub
2. Browser cache showing old version
3. CDN caching (if using CDN)

**Solution:**
```bash
# 1. Verify latest commit on server
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cd /home/$SSH_USER/public_html/$APP_DIRECTORY && git log --oneline -1"

# Compare with GitHub latest commit
git log --oneline -1

# 2. If different, run deploy script
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST 'bash /home/$SSH_USER/public_html/deploy.sh'

# 3. Clear browser cache or test in incognito mode
```

---

## Security Information

### SSH Deploy Key

**Key Type:** ED25519 (read-only)
**Access Level:** Only your GitHub repository
**Location on Server:** `/home/$SSH_USER/.ssh/github_deploy_key`

**To revoke access:**
1. Go to: https://github.com/$GITHUB_USERNAME/$REPO_NAME/settings/keys
2. Find "cPanel Production Server"
3. Click "Delete"

### Server Credentials

**Important:** Keep these credentials secure and never commit them to git:

```
SSH: $SSH_USER@$SSH_HOST
Password: $SSH_PASSWORD
Database User: $DB_USER
Database Password: $DB_PASSWORD
```

### Environment Variables

Sensitive configuration is stored in:
```
/home/$SSH_USER/public_html/$APP_DIRECTORY/.env
```

This file is NOT tracked in git (listed in `.gitignore`).

---

## Complete Deployment Workflow Example

Here's a complete example of deploying a new feature:

```bash
# 1. Make changes to your code locally
# Edit files, add features, fix bugs...

# 2. Commit changes
git add .
git commit -m "Add new feature: user profile page"

# 3. Push to GitHub
git push origin main

# 4. Wait for Railway to auto-deploy (2-3 minutes)
# Visit your Railway URL to test

# 5. If everything works on Railway, deploy to cPanel production
sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST 'bash /home/$SSH_USER/public_html/deploy.sh'

# 6. Verify production site
curl -I https://$YOUR_DOMAIN

# 7. Done! ✅
```

**Expected Output:**
```
🚀 Starting deployment...
📥 Pulling latest changes from GitHub...
remote: Enumerating objects: 5, done.
remote: Counting objects: 100% (5/5), done.
From github.com:$GITHUB_USERNAME/$REPO_NAME
   f674ad3..a1b2c3d  main       -> origin/main
Updating f674ad3..a1b2c3d
Fast-forward
 src/components/Profile.jsx | 45 +++++++++++++++++++++++++++++
 1 file changed, 45 insertions(+)
📦 Installing dependencies...
up to date, audited 277 packages in 5s
🔄 Restarting application...
✅ Deployment complete!
🌐 Site: https://$YOUR_DOMAIN
```

---

## Quick Command Cheatsheet

| Task | Command |
|------|---------|
| **Deploy to Production** | `sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST 'bash /home/$SSH_USER/public_html/deploy.sh'` |
| **Check if App Running** | `sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "ps aux \| grep 'node server.js' \| grep -v grep"` |
| **View Logs** | `sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "tail -f /home/$SSH_USER/public_html/$APP_DIRECTORY/app.log"` |
| **Check Git Status** | `sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "cd /home/$SSH_USER/public_html/$APP_DIRECTORY && git status"` |
| **Test Website** | `curl -I https://$YOUR_DOMAIN` |

---

## Summary

You now have a **dual deployment setup**:

- **Railway:** Auto-deploys on every push (for testing)
- **cPanel:** Manual deploy using one command (for production)

The workflow is simple:
1. Push code → Railway auto-deploys
2. Test on Railway
3. Run deploy script → Production updated

**Questions or issues?** Check the troubleshooting section or contact server administrator.

---

**Deployment Status:** ✅ Complete
**Production URL:** https://$YOUR_DOMAIN
**Tenant Subdomain Example:** https://$TENANT_SUBDOMAIN.$YOUR_DOMAIN
**Last Updated:** February 16, 2026

---

## Environment Variables Reference

Replace these placeholders with your actual values when using the commands:

| Variable | Description | Example |
|----------|-------------|---------|
| `$SSH_USER` | cPanel SSH username | `cpanel_user` |
| `$SSH_PASSWORD` | cPanel SSH password | `SecurePass123!` |
| `$SSH_HOST` | Server hostname | `server.example.com` |
| `$CPANEL_URL` | cPanel control panel URL | `https://cpanel.example.com` |
| `$YOUR_DOMAIN` | Your production domain | `example.com` |
| `$APP_DIRECTORY` | App folder name in public_html | `my-app` |
| `$DB_USER` | PostgreSQL database user | `db_user` |
| `$DB_PASSWORD` | PostgreSQL database password | `DbPass456!` |
| `$DB_NAME` | Central database name | `central_db` |
| `$TENANT_DB_NAME` | Tenant database name | `tenant_db` |
| `$TENANT_SUBDOMAIN` | Example tenant subdomain | `beta` |
| `$GITHUB_USERNAME` | GitHub username | `yourusername` |
| `$REPO_NAME` | GitHub repository name | `your-repo` |
| `$SERVER_IP` | Server IP address | `192.168.1.1` |
