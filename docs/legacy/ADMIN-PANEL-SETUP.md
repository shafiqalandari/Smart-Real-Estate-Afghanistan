# SafarPro Admin Panel

The central provider admin is integrated into the same frontend bundle but loads only under `/admin/*`.

Use:

- `/admin/login` for provider admin access
- `/subscription` for the customer subscription page
- `/` for the SafarPro ERP

The provider admin API and PostgreSQL database run from the `server/` directory. For complete setup and deployment instructions, read `SAFARPRO-SERVER-SETUP.md`.

Quick local setup:

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```
