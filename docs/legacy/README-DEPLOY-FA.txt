SafarPro customer login and configurable demo update

Files in ZIP are relative to /var/www/safarpro. No changes to other projects.

IMPORTANT: This update requires ONE new SQL migration. DO NOT rerun all old migrations.

1) Backup all files first and upload/commit ZIP contents to private GitHub repo.
2) git fetch origin main; git status -sb; save local server fixes before pull; git pull --ff-only
3) Execute ONLY new SQL migration, after checking PGDATABASE=safarpro:
   cd /var/www/safarpro
   set -a; source .env; set +a   # only if .env safe shell syntax; otherwise do not source
   PGPASSWORD='(password)' psql -h 127.0.0.1 -U safarpro_user -d safarpro -v ON_ERROR_STOP=1 -f server/db/migrations/010_default_trial_settings.sql
   Better: psql -h 127.0.0.1 -U safarpro_user -d safarpro -W -v ON_ERROR_STOP=1 -f server/db/migrations/010_default_trial_settings.sql (prompts password)
4) node --check server/routes/central-api.js
5) npm run build  (must succeed BEFORE restarting API)
6) pm2 restart safarpro-api --update-env
7) curl -fsS https://safarpro.afghanpower.tech/api/health
8) Test admin/settings trial value; customer signup, signin and trial expiry on test customer.

Note: Fresh accounts receive configurable trial period; existing accounts keep their original expiry. Admin/customer registration uses the default configured period.
Security: Never enable VITE_CENTRAL_ACCESS_ENABLED=false in production. Do not share .env secrets.
