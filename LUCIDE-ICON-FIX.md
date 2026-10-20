# Fix: blank login / missing Handshake icon

## Cause
The installed version of `lucide-react` (`0.263.1`) does not expose the `Handshake` export used by the estate office Sidebar and login gate. The browser therefore failed to initialize the UI.

## Changed files
- `src/components/Sidebar.tsx`: replace `Handshake` import and menu icon with `FileText`.
- `src/components/EstateAccessGate.tsx`: replace `Handshake` import and login feature icon with `FileText`.

## Update steps on Windows (PowerShell)
1. Stop the Vite process with `Ctrl + C`.
2. Replace both changed source files, keeping the same paths.
3. Clear Vite's optimized dependency cache (inside the project folder):
   `if (Test-Path .\node_modules\.vite) { Remove-Item -Recurse -Force .\node_modules\.vite }`
4. Start: `npm run dev:web`.
5. Open `http://localhost:5173` and press `Ctrl + Shift + R`.
6. Run `npm run dev:api` separately for the backend as required.

## Verification
Verified both source files no longer contain `Handshake` and the project ZIP was built from the previous full version.
The live Vite build/browser runtime could not be run in this environment because npm dependencies are not installed and registry access is unavailable. If another icon import error appears, share the displayed error text.
