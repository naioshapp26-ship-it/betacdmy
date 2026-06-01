# cPanel Environment Variables (Production)

This file documents the environment variables that the application reads and may require on the **cPanel production** deployment.

> Notes
> - Use **production** values on cPanel (domain, DB, URLs). Do **not** copy Railway testing values verbatim.
> - Variables under “Integration-specific” are required **only if** you use that integration in the app.
> - `VITE_*` variables are **frontend build-time** variables (Vite). They are not read by the Node.js backend at runtime.

---

## Database

### DATABASE_URL
**Required.** PostgreSQL connection string used by the backend to connect to the database.

- Example: `postgresql://USER:PASSWORD@HOST:5432/DBNAME`
- On cPanel, this should point to the **production** database (often localhost DB created in cPanel).

### PGSSL
**Required (set explicitly).** Controls whether Postgres connections use SSL.

- Typical cPanel local DB: `PGSSL=false`
- External managed DB: `PGSSL=true`

### PGSSL_REJECT_UNAUTHORIZED
**Required (set explicitly).** TLS certificate validation behavior for Postgres SSL.

- Common managed DB (valid cert): `true`
- Some proxies/self-signed setups: `false`

---

## Multi-tenant / Provisioning

### TENANT_DB_ENCRYPTION_KEY
**Required.** Used to encrypt/decrypt tenant database connection strings stored in the central database.

- Must be stable (do not rotate casually) or existing encrypted values can become unreadable.

### PAYMENT_CONFIG_ENCRYPTION_KEY
**Required.** Used to encrypt/decrypt payment gateway credentials stored in the database.

- Must be stable (do not rotate casually) or existing encrypted payment config values can become unreadable.

### TENANT_DATABASE_URL_TEMPLATE
**Required if you create tenant databases/URLs via the provisioning flow.** Template for generating a tenant DB URL.

- Must contain the `{db}` placeholder.
- Example: `postgresql://USER:PASSWORD@HOST:5432/{db}?sslmode=require`

### PROVISIONING_ADMIN_DATABASE_URL
**Required if the app must create/drop databases automatically.** Admin connection string used for `CREATE DATABASE` / `DROP DATABASE` operations.

- Example: `postgresql://USER:PASSWORD@HOST:5432/postgres`

---

## Domains / URLs / CORS

### MAIN_DOMAIN
**Required.** The base domain used by the backend to resolve tenant subdomains.

- Production example: `betacdmy.com`
- Do **not** include protocol (`https://`) or paths.

### FRONTEND_URL
**Required.** The base URL used to build redirect URLs (notably Stripe checkout success/cancel URLs).

- Production example: `https://www.betacdmy.com`

### PROTOCOL
**Required.** Protocol used when constructing certain derived URLs.

- Typically: `https`

### CORS_ALLOWED_ORIGINS
**Required.** Comma-separated list of allowed origins for API requests.

- Example: `https://betacdmy.com,https://www.betacdmy.com,https://*.betacdmy.com`

---

## Live Classes (Integration-specific)

### SMRRTX_API_URL
Required **only if** using Smrrtx meeting creation.

### SMRRTX_API_KEY
Required **only if** using Smrrtx meeting creation.

### SMRRTX_MEETINGS_PATH
Optional for Smrrtx; defaults to `/v1/meetings`.

### ZOOM_CLIENT_ID
Required **only if** using Zoom meeting creation.

### ZOOM_CLIENT_SECRET
Required **only if** using Zoom meeting creation.

### ZOOM_ACCOUNT_ID
Required **only if** using Zoom meeting creation.

### ZOOM_USER_ID
Optional for Zoom; defaults to `me`.

### GOOGLE_SERVICE_ACCOUNT_EMAIL
Required **only if** using Google Meet creation via Google Calendar API.

### GOOGLE_SERVICE_ACCOUNT_KEY
Required **only if** using Google Meet creation via Google Calendar API.

- Store the key with newline escaping and the app will convert `\\n` to real newlines.

### GOOGLE_CALENDAR_ID
Required **only if** using Google Meet creation via Google Calendar API.

---

## Frontend (Build-time)

### VITE_MAIN_DOMAIN
**Frontend build-time only.** Used by the React/Vite frontend to decide whether the current host is the main site or a tenant subdomain.

- Production example (when building for cPanel): `betacdmy.com`
- Not used by Node.js backend runtime.
