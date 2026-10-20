# Calendar and sidebar fix

- Date popup uses a body-level portal so scrollable forms no longer clip it.
- Popup automatically chooses above/below the date field based on viewport space.
- Light theme calendar uses light background, dark text and clear selected-day contrast.
- Mobile calendar size and overflow improved.
- Removed old Travel ERP wording from shared modal.

Sidebar audit: Dashboard, Properties, Customers, Deals, Accounting, Reports, Recycle Bin, Settings, Admin are present. The related features Income/Expenses, Customer Requests, Commissions, and Commission Rules are nested in the relevant sections and were not duplicated in sidebar.

Testing caveat: visual browser interaction and full build were not executed here; verify calendar behavior in both themes and mobile after replacement.
