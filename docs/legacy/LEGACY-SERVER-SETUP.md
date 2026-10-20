# SafarPro Central Admin and API Setup

SafarPro now contains two parts:

1. Vite frontend, including `/admin/*` and `/subscription`.
2. Node.js central API in `server/`, backed by PostgreSQL.

## Local development

Copy `.env.example` to `.env`, configure PostgreSQL, then run:

```bash
npm install
npm run db:migrate
npm run dev
```

Frontend: `http://localhost:5173`
Admin: `http://localhost:5173/admin/login`
API health: `http://127.0.0.1:3001/api/health/postgres`

## Production architecture

Recommended deployment:

- Frontend: Vercel
- API: Ubuntu VPS with PM2
- Database: PostgreSQL on the VPS or a managed PostgreSQL service

Set this Vercel environment variable before building:

```env
VITE_CENTRAL_API_URL=https://api.yourdomain.com
VITE_CENTRAL_ACCESS_ENABLED=true
```

On the VPS configure `.env` with strong admin credentials and database settings. Set `FRONTEND_ORIGINS` to the exact Vercel/custom domains allowed to call the API.

Example:

```env
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=CHANGE_TO_A_STRONG_PASSWORD
ADMIN_SESSION_SECRET=CHANGE_TO_A_LONG_RANDOM_SECRET
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=safarpro
PGUSER=safarpro_user
PGPASSWORD=CHANGE_ME
FRONTEND_ORIGINS=https://safarpro.vercel.app,https://app.yourdomain.com
```

Run migrations once:

```bash
npm run db:migrate
```

Start the API:

```bash
npm run start:api
```

With PM2:

```bash
pm2 start server/index.js --name safarpro-api
pm2 save
```

Nginx should proxy the API domain to `127.0.0.1:3001` and HTTPS should be enabled.

## Admin control included

The provider admin can manage companies, customers, devices, licenses, plans, subscriptions, payment requests, payment methods, messages, broadcast notices, credits, backups, audit logs, security and central settings.

The normal SafarPro app is protected by the central access gate. A company account/device can be approved, blocked, suspended, rejected or allowed according to its trial/license/subscription status. The device checks the central server periodically and also uses the last trusted offline access snapshot when appropriate.

## Temporary frontend-only testing

If you need to test the UI before the central API is online, build with:

```env
VITE_CENTRAL_ACCESS_ENABLED=false
```

Do not use that setting for production licensing.
