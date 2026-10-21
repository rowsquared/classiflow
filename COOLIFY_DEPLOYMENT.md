# Coolify Deployment Guide

This guide will help you deploy the classiflow application on Coolify.

## Prerequisites

- A Coolify instance (self-hosted or cloud)
- Git repository access

## Deployment Methods

There are two ways to deploy this application in Coolify:

1. **Docker Compose (Recommended)** - Includes PostgreSQL in the same deployment
2. **Dockerfile Only** - Requires separate PostgreSQL database

---

## Method 1: Docker Compose Deployment (Recommended)

This method deploys both the application and PostgreSQL database together using docker-compose.yml.

### 1. Create the Application

1. Navigate to **Projects** → **Add New Resource** → **Application**
2. Select your Git provider and repository
3. Configure deployment settings:
   - **Build Pack**: Select `docker-compose`
   - **Docker Compose Location**: `./docker-compose.yml`
   - **Port**: `3000`
   - **Branch**: `main` for production, `staging` for staging
4. Set **Auto Deploy** per [Deploy triggers](#deploy-triggers): on for staging, **off** for production.

### 2. Configure Environment Variables

Add the following environment variables in Coolify:

#### Required Variables

```env
# PostgreSQL Configuration (will be used by the embedded database)
POSTGRES_USER=classiflow
POSTGRES_PASSWORD=generate-a-secure-password-here
POSTGRES_DB=classiflow

# NextAuth Configuration
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-generated-secret-here

# Default Admin User
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
DEFAULT_ADMIN_NAME=Admin User
DEFAULT_ADMIN_USERNAME=admin  # Optional: defaults to username extracted from email if not set
```

#### Optional AI Labeling Variables

```env
# AI Labeling Service (if using)
AI_LABELING_API_URL=https://your-ai-service.example.com
AI_LABELING_API_KEY=your-api-key-here
AI_LABELING_BATCH_SIZE=100
AI_LEARNING_BATCH_SIZE=100
AI_LEARNING_MIN_NEW_ANNOTATIONS=500
AI_JOB_POLL_INTERVAL_MS=5000
AI_JOB_POLL_TIMEOUT_MS=600000

# Source slug for AI API (scopes taxonomy keys per deployment)
# Set to the subdomain-domain of your app host (strip www and TLD).
# Example: if your app is at https://classiflow.app.rowsquared.org → classiflow-app-rowsquared
AI_SOURCE_SLUG=classiflow-app-rowsquared
```

### 3. Generate NEXTAUTH_SECRET

Generate a secure secret for NextAuth:

```bash
openssl rand -base64 32
```

Use the output as your `NEXTAUTH_SECRET` value.

### 4. Configure Volumes (Important!)

Coolify should automatically create the volume for PostgreSQL data persistence, but verify:

1. Check that `postgres_data` volume is created
2. This ensures your database persists across deployments

### 5. Deploy

1. Click **Deploy** to start the deployment
2. Monitor the build logs
3. Coolify will:
   - Build the application Docker image
   - Start PostgreSQL container
   - Start the application container
   - Run database migrations automatically
   - **Automatically create the default admin user** (if it doesn't exist)
4. Access your application at your configured domain

### 6. Verify Deployment

Check the health endpoint:
```bash
curl https://your-domain.com/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-25T...",
  "database": "connected"
}
```

### 7. Admin User Auto-Creation

The default admin user is **automatically created** on first deployment using the environment variables you set:

- **Email**: Value from `DEFAULT_ADMIN_EMAIL`
- **Username**: Value from `DEFAULT_ADMIN_USERNAME` (or extracted from email if not set)
- **Password**: Value from `DEFAULT_ADMIN_PASSWORD`
- **Name**: Value from `DEFAULT_ADMIN_NAME`

**Important Notes:**
- The admin user is only created if it doesn't already exist
- You can login with either the **username** or **email** address
- You **must change the password** on first login (forced password reset)
- If you need to reset the admin password, update `DEFAULT_ADMIN_PASSWORD` and restart the container

---

## Troubleshooting

### `database "<name>" does not exist`
- This happens when `DATABASE_URL` points to a DB name that wasn't created. If you changed `POSTGRES_DB`/`DATABASE_URL` after the first deploy, the existing Postgres volume will not auto-create the new DB.
- Fix options:
  1. **Fresh volume** (wipes data): in Coolify redeploy with the `Remove volumes` option (or delete the `postgres_data` volume) so Postgres reinitializes with the current `POSTGRES_DB`.
  2. **Keep data**: connect to the Postgres container and create the DB manually, e.g. `psql -U $POSTGRES_USER -c "CREATE DATABASE <db> OWNER $POSTGRES_USER;"`.
- Ensure `DATABASE_URL` in the app matches the DB name you create.

### AI labeling API returns `Not Found`
- The base URL is set via `AI_LABELING_API_URL`. It must point at the service root that serves the expected endpoints (e.g., `/learn`, `/learn/{jobId}/status`, `/label`).
- If the provider uses a prefix (e.g., `/api`), include it in `AI_LABELING_API_URL` (e.g., `https://taxomind-api.rowsquared.org/api`).
- Verify with `curl -i "$AI_LABELING_API_URL/learn"`; a 200/401/403 indicates you hit the right service, a 404 means the base path is wrong.

### AI job cancel behavior
- When you cancel a job from the UI, the app cancels it both locally (in the database) and on the external Taxomind API (`POST /{endpoint}/{jobId}/cancel`).
- The external cancel is best-effort — if it fails (e.g. network issue), the local cancellation still proceeds and the polling loop stops.

---

## Method 2: Dockerfile Deployment (Separate Database)

Use this method if you want to manage PostgreSQL separately or use Coolify's managed database.

### 1. Create PostgreSQL Database

In your Coolify dashboard:

1. Navigate to **Databases** → **Add New Database**
2. Select **PostgreSQL**
3. Configure:
   - **Name**: `classiflow-db`
   - **PostgreSQL Version**: `16` (or latest)
   - **Username**: `classiflow`
   - **Password**: Generate a secure password
   - **Database Name**: `classiflow`
4. Click **Create**
5. Note the internal connection string

### 2. Create the Application

1. Navigate to **Projects** → **Add New Resource** → **Application**
2. Select your Git provider and repository
3. Configure build settings:
   - **Build Pack**: `dockerfile`
   - **Dockerfile Location**: `./Dockerfile`
   - **Port**: `3000`

### 3. Configure Environment Variables

```env
# Database (use the connection string from the separate database)
DATABASE_URL=postgresql://classiflow:your-password@classiflow-db:5432/classiflow?schema=public

# NextAuth Configuration
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-generated-secret-here

# Default Admin User
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=ChangeMe123!
DEFAULT_ADMIN_NAME=Admin User
DEFAULT_ADMIN_USERNAME=admin  # Optional: defaults to username extracted from email if not set
```

### 4. Add Start Command

In Coolify, set the start command to run migrations and initialize admin:

```bash
sh -c "npx prisma migrate deploy && node scripts/init-admin.js && node server.js"
```

**Note**: The `init-admin.js` script automatically creates the default admin user if it doesn't exist, using the environment variables you configured.

### 5. Deploy

1. Click **Deploy** to start the deployment
2. Monitor the build logs
3. Once deployed, the database migrations will run automatically
4. Access your application at your configured domain

## Post-Deployment

### First Login

1. Navigate to your application URL
2. Login with the default admin credentials:
   - **Username or Email**: Value from `DEFAULT_ADMIN_EMAIL` (or `DEFAULT_ADMIN_USERNAME` if set)
   - **Password**: Value from `DEFAULT_ADMIN_PASSWORD`
3. **Important**: You **must** change your password immediately after first login (forced password reset)

**Note**: The admin user is automatically created during deployment. Check the deployment logs to confirm it was created successfully.

### Database Migrations

Migrations run automatically on each deployment via the start command. If you need to run migrations manually:

```bash
npx prisma migrate deploy
```

### Verify Deployment

Check the health endpoint:
```bash
curl https://your-domain.com/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-25T...",
  "database": "connected"
}
```

---

## Important Notes

### Database Persistence

When using **Method 1 (Docker Compose)**:
- PostgreSQL data is stored in a Docker volume (`postgres_data`)
- This volume persists across container restarts and redeployments
- **Important**: Always configure backups for production use

### Networking

The docker-compose setup creates an internal network where:
- The app container connects to PostgreSQL using hostname `postgres`
- PostgreSQL is only accessible within the Docker network (secure by default)
- Only port 3000 is exposed externally for the application

### Database Backups

#### For Docker Compose Deployment:

Container names are generated per deployment (the compose file sets none, so
production and staging can share a host). Find the Postgres container first:

```bash
docker ps --filter "ancestor=postgres:16-alpine" --format '{{.Names}}'

# Backup (--no-owner keeps the dump restorable under a different role)
docker exec <postgres-container> pg_dump --no-owner -U classiflow classiflow > backup.sql

# Restore
cat backup.sql | docker exec -i <postgres-container> psql -U classiflow classiflow
```

For automated backups, consider:
- Setting up a cron job to backup the Docker volume
- Using Coolify's backup commands if available
- Implementing external backup solutions

#### For Separate Database Deployment:

Coolify provides built-in backup functionality:
1. Go to your PostgreSQL database settings in Coolify
2. Navigate to **Backups**
3. Configure backup schedule and retention
4. Enable backups

### Scaling

To scale the application:

1. Go to your application settings
2. Adjust **Replicas** count (requires load balancer)
3. Note: Database connections may need adjustment for multiple instances

## Troubleshooting

### Build Fails

**Issue**: ESLint errors during build
- **Solution**: The `next.config.ts` is configured with `eslint.ignoreDuringBuilds: true`
- **Reason**: Minor ESLint warnings are acceptable and don't affect functionality
- **Note**: You can still run `pnpm lint` separately to review warnings

**Issue**: `npm install` or `pnpm install` fails
- **Solution**: The Dockerfile now uses `npm ci --legacy-peer-deps` with fallback to `npm install`
- **Cause**: Dependency conflicts or lockfile issues in containerized builds
- **Fix**: The Dockerfile copies prisma schema before install and uses npm for better compatibility

**Issue**: Prisma client generation fails
- **Solution**: Ensure all Prisma schema files are properly copied
- The build process generates Prisma client before building Next.js

**Issue**: Prisma schema not found during install
- **Solution**: The Dockerfile now copies the prisma directory before running npm install
- **Reason**: The postinstall script needs the schema to generate the Prisma client
- **Note**: This is why we copy `prisma` folder early in the build process

### Runtime Issues

**Issue**: Database connection fails
- **Solution**: Verify `DATABASE_URL` uses the correct internal hostname
- Check database is running and accessible

**Issue**: 503 errors on health check
- **Solution**: Check database connection string
- Verify migrations have run successfully
- Check application logs in Coolify

### Migration Issues

**Issue**: Migrations don't run
- **Solution**: Ensure start command includes `npx prisma migrate deploy`
- Check write permissions for Prisma

**Issue**: Migration fails with permissions error
- **Solution**: Verify database user has CREATE/ALTER permissions

### Port Allocation Issues

**Issue**: `Bind for 0.0.0.0:5432 failed: port is already allocated`
- **Cause**: PostgreSQL port mapping conflicts in Coolify
- **Solution**: Port mappings should be commented out in docker-compose for Coolify
- **Fix**: Lines 16-17 should be commented (as configured by default)

**Issue**: `Bind for 0.0.0.0:3000 failed: port is already allocated`
- **Cause**: App port mapping conflicts - Coolify manages ports externally
- **Solution**: Port mappings should be commented out in docker-compose for Coolify
- **Fix**: Lines 34-35 should be commented (as configured by default)
- **Note**: For local testing, these ports MUST be uncommented

**Issue**: Can't access app at localhost:3000 locally
- **Cause**: Port mapping commented out (Coolify configuration)
- **Solution**: Uncomment lines 34-35 in docker-compose.yml for local testing

## Environment-Specific Notes

### Production Recommendations

1. Use strong passwords for `NEXTAUTH_SECRET` and `DEFAULT_ADMIN_PASSWORD`
2. Change default admin password immediately after first login
3. Enable database backups
4. Configure SSL/TLS (handled by Coolify)
5. Set up monitoring and alerts
6. Review and adjust resource limits

### Persistent Storage

The application uses PostgreSQL for all persistent data. Ensure:

- Database volume is persisted in Coolify
- Regular backups are configured
- Backup retention meets your requirements

## Support

For issues specific to:
- **classiflow application**: Check the main README.md
- **Coolify deployment**: Visit [Coolify Documentation](https://coolify.io/docs)
- **Prisma migrations**: Visit [Prisma Documentation](https://www.prisma.io/docs)

## Local Testing with Docker

Before deploying to Coolify, test locally:

### Important: Port Mapping Configuration

The docker-compose files are configured for Coolify deployment by default (ports commented out). For local testing, you MUST uncomment the port mappings:

1. **Edit docker-compose.yml**:
   - Uncomment lines 34-35 for app port mapping (3000:3000) - **REQUIRED for local access**
   - Optionally uncomment lines 16-17 for PostgreSQL if you need direct database access

2. **Run locally**:
```bash
# Copy environment file
cp .env.example .env

# Edit .env with your values
nano .env

# Clean Docker cache completely (important for Prisma version)
docker-compose down -v
docker builder prune -af
docker system prune -af

# Build and run (with --no-cache to ensure fresh build)
docker-compose build --no-cache
docker-compose up

# Access at http://localhost:3000
```

3. **Before deploying to Coolify**, remember to:
   - Comment out the port mappings again (or use git to restore the original file)
   - Commit and push your changes

## Updating the Application

Migrations run automatically on each deployment. How a deployment is triggered
depends on the branch; see [Deploy triggers](#deploy-triggers).

## Deploy triggers

The two environments are triggered differently, on purpose.

| Branch | Coolify auto-deploy | What deploys it |
| --- | --- | --- |
| `staging` | on | Coolify deploys on every push. CI also runs, as a report card. |
| `main` (production) | **off** | The `deploy-prod` job in `.github/workflows/ci.yml` calls Coolify's deploy API, and only after the `smoke` and `checks` jobs pass. |

Staging may be briefly broken; the fast feedback is worth more than a gate.
Production may not: a red run leaves the previous release serving.
Turning Coolify auto-deploy back on for production removes the gate entirely,
because Coolify does not wait for GitHub Actions.

`smoke` builds the image from the same `Dockerfile` and `docker-compose.yml`
Coolify uses, starts the stack on an empty database, and checks that migrations
applied, the default admin was created, `/api/health` reports a connected
database and `/login` renders. `checks` runs the typecheck and unit tests
(`npm run typecheck`, `npm test`); the build itself skips type errors, so this
is where they are caught. Lint runs in `checks` too but only reports for now,
because `main` still has lint errors; make it blocking once they are fixed.

Two repository secrets drive the production deploy. Without them the job fails
loudly rather than skipping, because a release that quietly deploys nothing is
the worst outcome:

| Secret | Value |
| --- | --- |
| `COOLIFY_PROD_WEBHOOK` | The production application's deploy endpoint, `https://<coolify-host>/api/v1/deploy?uuid=<app-uuid>&force=false`. Not the git webhook. |
| `COOLIFY_API_TOKEN` | A Coolify API token with deploy permission. |

### Releases

Work lands on `staging` (directly or by pull request). Production only moves by
fast-forwarding `main` to `staging`:

```bash
node scripts/promote-main.mjs --dry-run
```

```bash
node scripts/promote-main.mjs
```

The script refuses anything that is not a fast-forward, so `main` never holds a
commit that was not on `staging` first and the two branches stay in sync. Never
push or merge into `main` by hand. The `main` ruleset requires the `smoke` and
`checks` checks, so the push is rejected until CI has passed on `staging` for
that commit.

**Roll back by going forward**: revert the bad commit on `staging`, let CI pass,
promote again. Resetting `main` backwards breaks every later promotion. If
production cannot wait, redeploy the previous deployment from the Coolify UI,
then follow up with the revert. Migrations do not roll back with the code;
check what a release migrated before reverting across it.
