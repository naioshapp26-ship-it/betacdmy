# Wildcard SSL Certificate Setup for Multi-Tenant SaaS - cPanel

## Overview
This guide explains how to set up a **wildcard SSL certificate** for your multi-tenant SaaS application on cPanel. A wildcard certificate (*.betacdmy.com) covers ALL subdomains automatically, so you don't need to create individual certificates for each tenant.

## Why Wildcard SSL?
- ✅ **Scalable**: One certificate covers unlimited subdomains (tenant1.betacdmy.com, tenant2.betacdmy.com, etc.)
- ✅ **Automatic**: New tenant subdomains get SSL immediately, no provisioning needed
- ✅ **Manageable**: Single certificate to manage instead of hundreds/thousands
- ❌ **Individual subdomains in cPanel**: NOT scalable for multi-tenant (would need 1000+ subdomain records)

## Prerequisites
- cPanel/WHM access
- Domain DNS managed by cPanel or external provider
- Wildcard DNS record (*.betacdmy.com) pointing to your server IP

## Step-by-Step Setup in cPanel UI

### Step 1: Verify Wildcard DNS Record
Before requesting SSL, ensure wildcard DNS is configured:

1. **Check DNS Zone in cPanel:**
   - Go to: cPanel → **Zone Editor**
   - Look for an A record: `*.betacdmy.com` → `38.242.219.11` (your server IP)
   - If missing, add it:
     - Type: `A`
     - Name: `*.betacdmy.com` (or just `*` depending on UI)
     - Points to: Your server IP address
     - TTL: 14400 (4 hours)

2. **Verify DNS propagation:**
   ```bash
   nslookup randomtenant.betacdmy.com
   # Should return your server IP
   ```

### Step 2: Request Wildcard SSL Certificate in cPanel

#### Option A: AutoSSL (Automatic - Recommended)
cPanel's AutoSSL can provision wildcard certificates automatically if configured:

1. Go to: cPanel → **SSL/TLS Status**
2. Look for `*.betacdmy.com` in the list
3. If it shows "No certificate installed", click **Run AutoSSL**
4. AutoSSL will attempt to provision a Let's Encrypt certificate

**Note:** AutoSSL for wildcards requires DNS validation (not HTTP validation). This may not work if your DNS is external to cPanel.

#### Option B: Manual Let's Encrypt via WHM (Requires Root/WHM Access)
If you have WHM access:

1. Go to: WHM → **AutoSSL**
2. Navigate to: **Manage AutoSSL**
3. Enable AutoSSL for wildcard domains
4. Or manually request via: **SSL/TLS** → **Manage SSL Hosts**

#### Option C: Third-Party Wildcard SSL (Manual Installation)
If Auto SSL doesn't work for wildcards, you can purchase/obtain a wildcard SSL certificate:

1. **Obtain Wildcard Certificate:**
   - Purchase from SSL provider (Let's Encrypt via certbot, or commercial CA)
   - For Let's Encrypt via Certbot on server:
     ```bash
     sudo certbot certonly --manual --preferred-challenges=dns -d "*.betacdmy.com" -d "betacdmy.com"
     ```
   - Follow DNS verification prompts (add TXT records as instructed)

2. **Install in cPanel:**
   - Go to: cPanel → **SSL/TLS** → **Manage SSL Sites**
   - Select domain: `betacdmy.com`
   - Paste Certificate, Private Key, and CA Bundle
   - Check "Browse for a Certificate" → Upload wildcard cert
   - Click **Install Certificate**

### Step 3: Configure Apache to Use Wildcard SSL

After installing the wildcard certificate, configure Apache virtual hosts:

1. **Check if wildcard vhost exists:**
   ```bash
   grep -r "*.betacdmy.com" /etc/apache2/sites-enabled/
   ```

2. **Create/Update Apache config** (if needed, requires SSH root access):
   ```bash
   sudo nano /etc/apache2/sites-available/wildcard-betacdmy.conf
   ```

   Add:
   ```apache
   <VirtualHost *:443>
       ServerName betacdmy.com
       ServerAlias *.betacdmy.com

       DocumentRoot /home/edunaiosh/public_html/betacdmy-app/dist

       SSLEngine on
       SSLCertificateFile /path/to/wildcard-cert.crt
       SSLCertificateKeyFile /path/to/wildcard-key.key
       SSLCertificateChainFile /path/to/chain.crt

       # Proxy to Node.js app
       ProxyPass / http://localhost:3001/
       ProxyPassReverse / http://localhost:3001/

       # WebSocket support
       RewriteEngine On
       RewriteCond %{HTTP:Upgrade} websocket [NC]
       RewriteCond %{HTTP:Connection} upgrade [NC]
       RewriteRule ^/(.*)$ ws://localhost:3001/$1 [P,L]
   </VirtualHost>
   ```

3. **Enable and reload:**
   ```bash
   sudo a2ensite wildcard-betacdmy.conf
   sudo systemctl reload apache2
   ```

### Step 4: Remove Individual Tenant Subdomains from cPanel

If you previously created individual subdomains (like `testa.betacdmy.com`), delete them:

1. Go to: cPanel → **Subdomains**
2. Find `testa` (or whichever test subdomains exist)
3. Click **Remove** next to each
4. Confirm deletion

**Why?** Individual subdomain records in cPanel are unnecessary with wildcard DNS + wildcard SSL. The application handles routing via tenant middleware at runtime.

### Step 5: Verify Wildcard SSL Works

Test multiple subdomains:

```bash
# Test main domain
curl -I https://betacdmy.com

# Test random tenant subdomains
curl -I https://tenant1.betacdmy.com
curl -I https://tenant2.betacdmy.com
curl -I https://anythinghere.betacdmy.com
```

All should return:
- `HTTP/1.1 200 OK` or similar (not connection error)
- Subject CN or SAN includes `*.betacdmy.com`

### Step 6: Update Environment Configuration

Remove cPanel API credentials from `.env` (no longer needed for SSL):

```bash
# Remove these lines:
CPANEL_HOST=...
CPANEL_USERNAME=...
CPANEL_API_TOKEN=...
```

## Troubleshooting

### Issue: "AutoSSL cannot provision wildcard certificate"
**Solution:** cPanel AutoSSL may not support wildcard certs in all configurations. Use Option C (manual certificate).

### Issue: "Certificate shows wrong domain for tenant subdomain"
**Solution:** Check Apache vhost config has `ServerAlias *.betacdmy.com` and wildcard SSL cert is properly installed.

### Issue: "DNS resolution fails for tenant subdomains"
**Solution:** Verify wildcard DNS record exists:
```bash
dig *.betacdmy.com
# Should return A record pointing to your server
```

### Issue: "SSL works for main domain but not subdomains"
**Solution:** The SSL certificate must be a wildcard certificate (CN=*.betacdmy.com), not individual domain cert.

## Security Best Practices

1. **Rotate API tokens:** If you used cPanel API token previously, revoke it
2. **Monitor certificate expiry:** Set up alerts for SSL expiration (60-day Let's Encrypt certs auto-renew)
3. **Restrict certificate access:** Only authorized users should have access to private keys
4. **Enable HSTS:** Force HTTPS for all subdomains

## Summary

✅ **Wildcard DNS** (`*.betacdmy.com` → server IP) - Handles ALL subdomains at DNS level
✅ **Wildcard SSL** (`*.betacdmy.com` certificate) - Secures ALL subdomains automatically
✅ **Application-level routing** - Tenant middleware resolves tenants from `subdomain.domain.com`
❌ **NO individual subdomain records in cPanel** - Not needed and not scalable

With this setup, when a new tenant signs up with subdomain "newclient", the URL `https://newclient.betacdmy.com` automatically:
1. Resolves via wildcard DNS
2. Gets SSL via wildcard certificate
3. Routes to the app via tenant middleware

**No manual provisioning required!**
