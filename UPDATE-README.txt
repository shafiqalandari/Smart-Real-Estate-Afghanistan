Smart Real Estate - Dark Mode + separated income and expenses

Changed files:
- src/App.tsx: removes stale admin condition and separates financial navigation in Accounting.
- src/components/Sidebar.tsx and src/pages/Dashboard.tsx: fix incompatible HandCoins icon and duplicate imports.
- src/pages/RealEstate.tsx: distinguish income/expense entry clearly.
- src/estate-premium.css: improve midnight contrasts, modal, empty-state and financial shortcut layout.

IMPORTANT:
This patch builds ON TOP OF prior Smart Real Estate Dark & CRUD update.
Copy with the same relative directory paths.
Before updating production, commit/push then run npm ci && npm run build on VPS.
No backend, database migration or restart is required for this frontend-only update.
No live financial CRUD test was performed.
For existing browser users with a saved light theme, change the theme in Settings once to Midnight; new users default to Midnight.
