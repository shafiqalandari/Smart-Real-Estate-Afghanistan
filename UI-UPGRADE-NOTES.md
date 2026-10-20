# UI Upgrade, Smart Real Estate Afghanistan

This package is the complete source snapshot after a focused UI improvement pass using the supplied retail application as visual inspiration.

Changes:
- Responsive six-card dashboard with icons, distinct accents, motion and quick actions.
- Redesigned record cards, search input, empty states, and record action buttons.
- Initial display capped at 24 records with incremental load for less DOM work.
- Reduced-motion support and dark-mode styles.

Unchanged: database schema, backend API, authentication, accounting logic, print service, subscription rules. These have NOT been comprehensively tested or redesigned in this pass.

Run `npm install`, then `npm run dev`. PostgreSQL configuration/migrations are still required for live registration and records. `npm run build` must be run on an environment with dependencies installed. No guarantee of bug-free production use is made.
