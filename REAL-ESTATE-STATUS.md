# Smart Real Estate Afghanistan | Implementation status

## Implemented in this package
- Separate office pages in sidebar: dashboard, properties, persons, deals, accounting, reports, recycle bin, settings; central admin entry retained.
- Forms for properties, clients, property requests (available as module code but not yet linked from navigation), sale/rent/mortgage deal types, commission payments, income, expenses, commission rules.
- PostgreSQL additive migration `012_real_estate.sql` and token-protected office-scoped API.
- Soft deletion for ordinary records; deal and commission payment deletion blocked.
- Partial commission payments bounded by configured deal commission, separate AFN/USD.
- CSV export and browser printing, mobile card layouts, tenant-scoped queries.

## Not yet complete vs PRD v3.0
- Official documents/private uploads, printable official receipts and dedicated contract viewer.
- Full accounting ledger, automated cash accounting, report filters and native Excel/PDF exports.
- Employee-level permission checks, finalized-deal amendment workflow, audit UI, backups restore tests.
- Complete three-language translation of newly added forms and Shamsi date-picker integration.
- Lifecycle synchronization of sold properties and rent renewal, tenant-isolated integration tests.
- Test deployment and build validation (dependencies unavailable in this runtime).

## Deployment
1. BACKUP DATABASE BEFORE CHANGE.
2. Deploy full project preserving existing `.env` and private data.
3. `npm ci` then `npm run db:migrate` and `npm run build`.
4. Restart server, verify `/api/health/postgres`, and test login and API permissions using two different office accounts.
5. Do not regard this package as production approved until above gaps are addressed and tested.

Existing SafarPro storage and tables are retained in the archive to prevent accidental loss of historic customer information; the new UI does not use its travel store.

## Rental reference integration (October 20, 2026)
- Added unified print-center preview and styles (A4/A5/POS, color schemes, sizing, margins, header/footer/logo, signatures).
- Added rental-style Gregorian/Jalali datepicker and header calendar selector. Real-estate API dates remain ISO Gregorian.
- Added dated report filters, CSV export, printing, AFN/USD separation and a calculated net office-income summary.
- Added print/office settings and mobile scrollable forms. Added client-request and commission-rule access points.
- Date conversion round-trip checks and TypeScript transpilation syntax checks passed.
- Production build, in-browser visual testing, and DB integration remain unverified because `npm ci` could not complete in the execution environment.
- The original status sections above refer to the initial PRD conversion and may not reflect the newly enhanced printing and calendar functionality.
