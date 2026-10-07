# Planner — build plan

A personal paper-style planner — the digital equivalent of a good ring-bound diary with year, month and week pages, goal pages, project pages and lists — running as a **static HTML + CSS + vanilla JS** site. **Google Sheets** is the datastore; **Google Calendar** is read live for appointments. No server, no build step.

It works across **horizons**, not just the week:

```
Year ─ Quarter ─ Month ─ Week ─ Day
  goals cascade down ▼        ▲ todos roll up
```

- **Goals** live at a horizon (this year, this quarter, this month) and can break down into smaller goals.
- **Projects** are concrete bodies of work that serve a goal (or just exist).
- **Todos** belong to a project and/or goal, and are scheduled at any precision: a day, a week, a month, a quarter, "someday", or nothing yet (inbox).
- **Deadlines** are separate from scheduling: a todo can be planned for "this week" but be *due* on Friday. Deadlines show up everywhere, including the year view.
- **Todos (general list)**: one place to see every open todo, sorted and filtered by due date, area, project.
- **Trips** have a date range, an itinerary, bookings, a packing list and their own prep todos, and show as bars across the month and year views.
- **Areas** group everything (e.g. Work, Home, Family, Personal).
- **Reviews** close each period and plan the next.

Priorities for v1, in order: **todos with deadlines → year view → trips**, then goals, projects and reviews.

Users: the owner and a partner (occasional editor). Must work well on desktop and phone.

---

## 1. Stack & constraints

- Plain HTML/CSS/JS, ES modules, no framework, no bundler. Runs from any static host and from `npx serve` locally.
- Google Identity Services (GIS) **token client** for sign-in (`https://accounts.google.com/gsi/client`).
- Google Sheets API v4 and Google Calendar API v3 called directly with `fetch` + bearer token. No `gapi` unless clearly needed.
- No secrets in the repo. The OAuth **client ID** is public by design and lives in `config.js`.
- backend should be modular and swappable in future
- Hosting: GitHub Pages (or Cloudflare Pages / the home NAS). HTTPS required.
- Timezone: the browser's local timezone (the owner splits time between two countries).
- Hash-based routing (`#/week/2026-W41`, `#/goals`, …) so every view is linkable and the back button works.

## 2. One-time Google setup (the owner does this manually)

1. Google Cloud Console → new project "planner".
2. Enable **Google Sheets API** and **Google Calendar API**.
3. OAuth consent screen: External, **Testing** mode. Add test users: the owner's and partner's Google accounts.
4. Credentials → OAuth client ID → **Web application**. Authorized JavaScript origins:
   - `http://localhost:3000` (dev)
   - the production URL (e.g. `https://<user>.github.io`)
5. Let the app create the "Planner" sheet on first run (see §4), then share it with the partner as Editor.
6. Put the client ID and spreadsheet ID in `config.js`.

Expect an "unverified app" warning on first sign-in — fine for a personal Testing-mode app.

## 3. Auth

- Scopes:
  - `https://www.googleapis.com/auth/spreadsheets`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `initTokenClient` → `requestAccessToken()` on a "Sign in with Google" button click (never on load).
- Token **in memory only**. Track expiry (~1h). On expiry or a 401, `requestAccessToken({prompt: ''})` for a silent refresh; if that fails, show the sign-in button without losing queued edits.
- Sign-out: `google.accounts.oauth2.revoke`.
- Later hardening (not v1): `drive.file` scope + Google Picker.

## 4. Data model (Google Sheet)

Row 1 of each tab is the header. **Never physically delete rows**; soft-delete with `deleted`. Every record has `id` (`crypto.randomUUID()`), `created_at`, `updated_at`, `deleted`.

### The `when` field (period strings)
One string format for scheduling at any precision, used across tabs:

| precision | format | example |
|---|---|---|
| day | `YYYY-MM-DD` | `2026-10-09` |
| week | `YYYY-Www` (ISO) | `2026-W41` |
| month | `YYYY-MM` | `2026-10` |
| quarter | `YYYY-Qn` | `2026-Q4` |
| year | `YYYY` | `2026` |
| someday | `someday` | |
| unscheduled | blank | inbox |

`js/periods.js` owns all of this: parse, format, contains(a, b) (e.g. `2026-Q4` contains `2026-W41` and `2026-10-09`), start/end dates, next/prev, label ("Q4 2026", "October", "W41 · 6–12 Oct"). Weeks belong to the month/quarter/year containing their Thursday (ISO rule).

### `Areas`
`id, name, color, order, archived`

### `Goals`
| column | notes |
|---|---|
| id | |
| title | |
| when | year, quarter or month period (e.g. `2026`, `2026-Q4`, `2026-10`) |
| area_id | |
| parent_id | optional — a quarterly goal under a yearly one, etc. |
| why | one line on why it matters |
| measure | how you'll know it's done (free text) |
| status | `active` / `achieved` / `dropped` / `paused` |
| progress | 0–100, manual; UI also shows computed progress from linked todos/projects |
| order | sort within period |
| notes | |
| created_at, updated_at, deleted | |

### `Projects`
| column | notes |
|---|---|
| id | |
| title | |
| area_id | |
| goal_id | optional |
| status | `active` / `waiting` / `on_hold` / `someday` / `done` / `dropped` |
| target | optional period string for when it should land |
| notes | |
| order | |
| created_at, updated_at, done_at, deleted | |

### `Tasks`
| column | notes |
|---|---|
| id | |
| title | |
| when | any precision from the table above, blank = inbox |
| time | `HH:MM`, only meaningful when `when` is a day |
| due | optional hard deadline `YYYY-MM-DD` (separate from when you plan to do it) |
| due_time | optional `HH:MM` for deadlines with a time (e.g. "submit by 17:00") |
| remind_days | optional — days before `due` it starts showing as "due soon" (default from Settings) |
| due_event_id | set if the deadline was added to Google Calendar as an all-day event |
| priority | optional `high` / blank |
| done | `TRUE`/`FALSE` |
| area_id, project_id, goal_id, trip_id | all optional |
| list_id | optional — for todos that live in a list (see Lists) |
| notes | |
| order | |
| event_id | set if a calendar event was created from this todo |
| created_at, updated_at, done_at, deleted | |

### `Periods`
One row per period that has planning content — the "top of the page" for a day, week, month, quarter or year.
`period, focus_1, focus_2, focus_3, notes, review, reviewed_at, updated_at`

- `focus_*`: the priorities for that period.
- `review`: free-text reflection written during the review.

### `Trips`
| column | notes |
|---|---|
| id | |
| title | e.g. "Lakeside — half term" |
| destination | free text |
| start, end | `YYYY-MM-DD` (inclusive) |
| status | `idea` / `planning` / `booked` / `done` / `cancelled` |
| who | free text (who's going) |
| area_id | |
| color | optional override for the bar colour |
| event_id | optional — all-day multi-day Google Calendar event mirroring the trip |
| notes | |
| created_at, updated_at, deleted | |

### `TripItems`
Itinerary and bookings for a trip — one row per thing.
| column | notes |
|---|---|
| id | |
| trip_id | |
| kind | `flight` / `stay` / `transport` / `activity` / `food` / `note` |
| title | e.g. "Flight out", "Hotel name" |
| date, time | start `YYYY-MM-DD` + optional `HH:MM` |
| end_date, end_time | optional (e.g. hotel check-out, arrival time) |
| location | |
| reference | booking/confirmation reference |
| link | URL |
| cost, currency | optional |
| notes | |
| order | |
| created_at, updated_at, deleted | |

Trip **prep todos** ("book flights", "renew passport", "arrange pet sitter") are normal `Tasks` with `trip_id` and usually a `due`. Each trip gets an auto-created **packing list** (a `Lists` row with `trip_id`), and can copy items from a previous trip's packing list.

### `Lists`
Paper-planner "notes pages": packing lists, books to read, gift ideas, shopping, etc.
`id, title, area_id, trip_id, notes, order, created_at, updated_at, deleted` — items are rows in `Tasks` with `list_id` set.

### `Settings`
Key/value: `calendars` (comma-separated calendar IDs to show), `background_calendars` (e.g. public holidays for both countries, school terms — shown as shading, not events), `week_start` (`mon`), `review_day` (e.g. `sun`), `default_remind_days` (e.g. `3`).

### First run
If `SPREADSHEET_ID` is empty, offer "Create planner sheet": create the spreadsheet with all tabs + headers + a few default areas, then show the new ID to paste into `config.js`.

### Sheet access layer (`js/sheet.js`)
- `loadAll()` → one `values:batchGet` across all tabs → in-memory maps `id → {rowIndex, record}` per tab.
- `append(tab, record)` → `values:append`.
- `update(tab, id, patch)` → single-row `values:update`, setting `updated_at`.
- Before writing, compare the row's `updated_at` with what was loaded; if the sheet is newer, reload that row, merge, re-render. Last write wins per row; never overwrite a different row.
- Refresh on window focus and every 60s while visible.
- Column order is read from the header row, not hard-coded, so adding a column in the Sheet doesn't break the app.

## 5. Calendar (`js/calendar.js`)

- `listCalendars()` for settings; default to primary.
- `listEvents(start, end)` across selected calendars: `singleEvents=true`, `orderBy=startTime`. Fetch for whatever range the current view shows (day, week, month).
- Events are displayed only — **not copied into the Sheet**.
- "Add to calendar" on a todo with a day + time → `events.insert` on primary (30 min default), store `event_id`; offer to update the event if the todo's date/time changes.
- "Add deadline to calendar" → all-day event on the due date titled `Due: <title>`, store `due_event_id`.
- "Add trip to calendar" → all-day multi-day event spanning the trip, store `event_id`; keep dates in sync when the trip changes.
- Background calendars (public holidays, school terms) are fetched for the visible range and rendered as shading/labels, not as normal events. Google's public holiday calendars (one per country) are added once via the Settings calendar picker.

## 6. Views

All views share a header: horizon switcher (**Day · Week · Month · Quarter · Year**), ‹ prev / Today / next ›, and links to **Todos · Trips · Goals · Projects · Lists · Inbox**, plus sync status, settings, sign out.

### Deadlines everywhere
- A todo with a `due` date shows a **due marker on its due day** in Day/Week/Month/Year views, even if it's scheduled for a different day or not scheduled at all.
- States: **overdue** (red), **due soon** (within `remind_days`, amber), **due later** (neutral). Done todos drop their marker.
- A persistent **"Due soon" strip** at the top of Day and Week views lists overdue + due-soon items.

### Todos (general list)
The everyday working list — every open todo in one place.
- Default grouping by deadline: **Overdue · Due this week · Due this month · Due later · No deadline**.
- Alternative groupings: by area, by project, by scheduled `when`.
- Filters: area, project, trip, priority, has deadline, show done.
- Inline add at the top (goes to the list's current filter context, e.g. adding while filtered to a project sets `project_id`).
- Each row: checkbox, title, due chip ("Fri", "in 12 days", "3 days late"), scheduled chip, area/project/trip chips.

### Day
- Focus (3) for the day, events timeline, todos for the day.
- "Also this week" strip: week-level todos not yet given a day, with "do today".
- Carried over: undone todos from past days.

### Week — two-page spread (desktop) / day-by-day (mobile)
- Left page: Mon, Tue, Wed + **Week focus (3)**. Right page: Thu, Fri, Sat/Sun + **Notes**.
- Each day: all-day events, timed events (muted, read-only), then todos (checkbox, title, time/project/goal chips) and an "add…" line.
- Side rail: **This week, no day yet** (todos with `when` = this week), **From this month** (month-level todos to pull in), **Carried over**, **Goals in play** (active goals for the current month/quarter, with progress bars).

### Month
- Calendar grid with events and day-todos (compact; tap a day to open it).
- Beside the grid: **Month focus (3)**, **Month goals**, **This month, no date yet** todos, notes.

### Quarter
- Three month columns with each month's focus and goals.
- **Quarter goals** with progress, linked projects underneath.

### Year — the wall planner
The centrepiece view: a whole year on one screen, like a wall planner.
- **Grid**: 12 rows (months) × 31 day columns on desktop; weekends tinted; today outlined; public holidays and school-term breaks shaded from background calendars.
- **Trips** drawn as coloured bars across their days (colour by trip, label inside the bar; status `idea` drawn dashed).
- **Deadlines** as small markers on their due day (overdue red, due soon amber); hover/tap shows the list.
- **Events**: multi-day events as thin bars; single events as dots (density, not detail).
- Tap a day → that Day view; tap a trip → the trip page; tap a month label → the Month view.
- Toggle layers: trips / deadlines / events / holidays.
- Below or beside the grid: **Year focus**, **Year goals** by area (expandable to quarterly/monthly sub-goals and projects), notes.
- **Mobile**: vertical scroll of 12 compact month blocks (7-column mini calendars) with the same bars and markers.
- Rolling mode option: "next 12 months" instead of Jan–Dec.

### Trips
- **Trips list**: upcoming (with countdown "in 23 days"), current, ideas, past. Each card shows dates, destination, status, open prep todos and next deadline.
- **Trip page**:
  - Header: title, destination, dates, who, status, "add to calendar".
  - **Itinerary**: day-by-day from start to end, each day listing its `TripItems` (flights, stays, activities…) with times, locations, references and links; stays shown as spanning their nights. Add item inline on any day.
  - **Bookings**: flat list of flights/stays/transport with references and costs, plus a total by currency.
  - **Prep todos**: tasks with `trip_id`, sorted by due date, with suggested deadlines relative to departure (e.g. "online check-in: 1 day before").
  - **Packing list**: checklist (Lists row with `trip_id`); "copy from previous trip"; reset ticks.
  - Notes.
- Trips appear as bars in Month, Quarter and Year views and as an all-day banner in Day/Week views while they're happening.
- Trip items with a date also appear in the Day view for that date.

### Goals
- Tree: year → quarter → month goals, grouped by area. Filter by status.
- Goal detail: why, measure, status, progress (manual + computed), sub-goals, linked projects, linked todos (open/done), notes.

### Projects
- Board by status (Active / Waiting / On hold / Someday / Done), grouped or filtered by area.
- Each card shows the **next action** (first open todo by `when`, then `order`) and open todo count.
- Project detail: notes, goal link, todo list with scheduling controls.

### Lists
- List of lists; each opens as a simple checklist.

### Inbox & Someday
- Inbox: todos with blank `when`. Quick triage per todo: today / this week / this month / pick a date / someday / assign project or goal.
- Someday: todos and projects marked `someday`, to revisit in reviews.

### Reviews
Guided, step-by-step flow, opened from any period view ("Review this week/month/quarter/year"):
1. **Look back** — what got done (completed todos, achieved goals), what didn't.
2. **Carry forward** — for each unfinished item in the period: move to next period / reschedule / someday / drop.
3. **Goals check** — update status and progress of goals at this horizon.
4. **Reflect** — write into `Periods.review`.
5. **Plan next** — set the next period's focus (3), pick goals and pull todos in.
Mark `reviewed_at`. Show a gentle "review due" badge when a period has ended without one.

### Quick capture
Global "+" (and `n` key) that opens a capture box. Light natural parsing: `Call tiler fri 10am #house` → day + time + area/project by tag; `Renew insurance due 31 oct` → deadline; `Book flights due 2w @half-term` → deadline + trip by tag. Unparsed text goes to the Inbox. Keep the parser small and predictable; show what was parsed before saving.

### Interactions (everywhere)
- Edit in place; drag todos between days, into the side rail periods, or onto Inbox/Someday (desktop); "move to…" sheet on mobile.
- Optimistic updates; saving/saved/failed indicator; queued writes retried when back online.
- Keyboard: `n` capture, `←/→` prev/next period, `t` today, `d w m q y` switch horizon, `g` goals, `p` projects, `i` inbox.

### Look
- Paper planner feel: warm off-white pages, subtle ruled lines, a thin spine on the two-page spread, ribbon-style tabs for horizons, a serif for headings and a clean sans for entries. Area colours as small tabs/dots, not big blocks. Dark mode via `prefers-color-scheme`.
- No UI libraries. Readable at phone width with no horizontal scroll.

## 7. File layout

```
index.html
css/planner.css
js/config.js          // CLIENT_ID, SPREADSHEET_ID
js/auth.js            // GIS token client, refresh
js/sheet.js           // Sheets read/write, header-driven row mapping
js/calendar.js        // Calendar read/create
js/store.js           // in-memory state, selectors, optimistic updates, write queue
js/periods.js         // period parsing/containment/navigation (pure, unit-tested)
js/capture.js         // quick-capture parser (pure, unit-tested)
js/router.js          // hash routing
js/ui/day.js
js/ui/week.js
js/ui/month.js
js/ui/quarter.js
js/ui/year.js
js/ui/todos.js        // general list, deadline grouping
js/ui/trips.js        // trips list + trip page
js/ui/goals.js
js/ui/projects.js
js/ui/lists.js
js/ui/inbox.js
js/ui/review.js
js/ui/task.js         // todo item + editor (shared)
js/ui/components.js   // chips, progress bars, period picker
js/mock.js            // fake data across a year for offline dev (?mock=1)
tests/periods.test.html
tests/capture.test.html
manifest.webmanifest
```

`periods.js` and `capture.js` are pure functions with small browser-run test pages (no test framework needed) — they're where the subtle bugs will be.

## 8. Milestones

Each milestone leaves the app working; `?mock=1` stays usable throughout.

1. **Foundations in mock mode.** `periods.js` + tests, router, header/horizon switcher, Week spread and Day view from mock data (including todos with deadlines and a couple of trips), paper styling, mobile layout.
2. **Auth + Sheet.** Sign-in/out, token refresh, "Create planner sheet", `loadAll()`, header-driven mapping.
3. **Todos + deadlines end-to-end.** Add/edit/tick/move/soft-delete; `when` at any precision; `due` with overdue/due-soon states; the general **Todos** view; "Due soon" strip; Week side rail; optimistic writes + queue.
4. **Calendar.** Events in Day/Week; calendar picker incl. background calendars (holidays); "add to calendar" for todos and deadlines.
5. **Year view (wall planner)** with deadlines, events, holidays and placeholder trip bars; Month view.
6. **Trips.** Trips + TripItems tabs, trips list, trip page (itinerary, bookings, prep todos, packing list), bars in Month/Year, "add trip to calendar".
7. **Quarter view, period focus + notes** across all horizons.
8. **Goals.** Goals tab, tree view, goal detail, goals in period views with progress.
9. **Projects + Areas.** Project board, next actions, area filters and colours.
10. **Inbox, Someday, Lists, quick capture** (+ `capture.js` tests).
11. **Reviews.** Weekly first, then month/quarter/year using the same flow.
12. **Polish + deploy.** Drag & drop, keyboard shortcuts, PWA manifest/icon, deploy to GitHub Pages, add production origin to the OAuth client.

## 9. Testing checklist (manual, per milestone)

- Sign in fresh; sign in after token expiry (clear the token in memory).
- Create a todo at each precision (day, week, month, quarter, year, someday, inbox) and confirm it appears in exactly the right views.
- Move todos between precisions (month → specific day, day → someday) and confirm persistence in the Sheet.
- Edit a row directly in the Sheet; confirm the app picks it up on focus.
- Two browsers (owner + partner) editing different records at once — nothing lost.
- Offline edit, then back online — it saves.
- Period edges: Sunday→Monday, ISO week 52/53→1, weeks spanning two months/quarters/years, DST weeks.
- Deadlines: a todo scheduled for Monday but due Friday shows on both days correctly; overdue/due-soon states flip at midnight local time; ticking it done clears the markers.
- Year view: a trip spanning a month boundary (and a year boundary) draws as a continuous bar across both rows; holidays shade correctly for both countries.
- Trip page: itinerary covers every day from start to end; a stay spanning several nights shows on each; changing trip dates updates the calendar event.
- Complete a weekly review and a monthly review end to end; carried items land in the right next period.
- Phone width (375px): no horizontal scroll, everything tappable.

## 10. Out of scope for v1

- Recurring todos and habits (likely v2 — e.g. `repeat` column with simple rules)
- Notifications/reminders (use Google Calendar)
- Per-person private sections
- Attachments
