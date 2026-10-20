# Smart Real Estate Afghanistan, Rental UI Integration

This project is the complete Smart Real Estate source archive, updated using the supplied `rentel_project_sim(6).zip` as a **design and functionality reference**. It does not include live customer data from the rental system.

## Applied

- Transferred and adapted the rental project's print preview/print-style engine, isolated from the original rental business modules.
- Unified office letterhead: logo, office name, address, phone number, header subtitle, signature, footer and page number. Logo images are resized before saving.
- Paper sizes A4, A5, Letter, Legal, 58 mm and 80 mm; portrait/landscape; margin and rows-per-page.
- Print color designs (8), custom accent, text weights and adjustable title/body/footer font sizes.
- Print preview accessible from property/customer/deal/commission-related record screens and five report categories, with CSV download for Excel. PDF is produced through the browser's print dialog (`Save as PDF`), **not by a PDF export server**.
- Gregorian/Jalali calendar picker adapted from rental, including manual entry and calendar view. Header calendar selector and settings selection remain synchronized.
- Server-stored date fields continue using Gregorian ISO `YYYY-MM-DD`; Jalali conversion only applies to displayed/printed dates. This protects existing records from accidental double conversion.
- AFN and USD remain separate, including in report summaries and net-income display. No automatic exchange rate conversion or combining amounts.
- Office identity settings, dark/light theme choices, three interface languages (with expanded estate translations) and the responsive modal scroll layout.
- Customer requests accessible via the Customers section and commission rates via Reports.

## Important differences / limitations

- `Print PDF` opens the browser print dialog; choose `Save as PDF`. The CSV export opens in Excel but is **not a native XLSX file**.
- The office identity and **print preferences are currently held in browser localStorage**, not centralized PostgreSQL per office. Records still use the previously implemented PostgreSQL-backed real-estate API.
- This release does not claim full translation of every legacy admin page, native Excel/PDF generation, permission-driven document security, all PRD v3 accounting processes, or server-backed backup/restore.
- Source compilation with full dependencies could not be completed in this sandbox. TypeScript/TSX syntax parsing (65 files), server-side JS syntax, and date round-trip checks succeeded, but live UI/E2E and database tests were not performed.

## Deploying on your server

1. Back up the existing Smart Real Estate database and deployed project folder.
2. Deploy this complete archive without overwriting production `.env` values or private files.
3. In the project directory run `npm ci`, `npm run db:migrate`, `npm run build`.
4. Restart **only** the process serving this real-estate app, not other VPS services.
5. Verify logins, tenant isolation, properties/deals, printing, Jalali/Gregorian dates and both AFN and USD against staging records before production use.

## New/modified files for this transfer

- `src/print-service.ts`, `src/PrintCenter.tsx`, `src/print-center.css`
- `src/MarketDatePicker.tsx`, `src/CalendarModeMenu.tsx`, `src/estate-shared.css`
- `src/estateFormat.ts`, `src/pages/Reports.tsx`
- `src/Settings.tsx`, `src/App.tsx`, `src/components/Header.tsx`, `src/components/Sidebar.tsx`
- `src/pages/RealEstate.tsx`, `src/dateSystem.ts`, `src/i18n.ts`
