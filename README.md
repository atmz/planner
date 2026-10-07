# Planner

A paper-style planner (year, quarter, month, week and day pages, todos with deadlines, trips, goals, projects, lists and reviews) as a static site. Google Sheets is the datastore and Google Calendar is read live. No server, no build step.

- **Try it with sample data:** open `index.html?mock=1` (changes stay in your browser).
- **Run locally:** `python3 -m http.server 3000`, then open http://localhost:3000.
- **Use your own Google account:** follow PLAN.md §2 to create an OAuth client, put its ID in `js/config.js`, sign in and click "Create planner sheet".
- **Tests:** `node tests/run.mjs` (unit) and `node tests/smoke.mjs` (headless Chrome over every view).

The OAuth client ID and spreadsheet ID in `js/config.js` are not secrets: sign-in is limited to the OAuth app's test users, and the sheet is only readable by people it is shared with.
