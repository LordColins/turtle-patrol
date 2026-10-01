# Sea turtle patrol website — agreed decisions

Last updated: 01/10/2026 (part 2 of the live app built). Prototype (version 3): https://claude.ai/artifact/5WfdpqqWq3tFDQSQuWv6XU

## Look and branding
- Sign-in page: cave picture as full background; sign-in box on top with the EMU SAGEM Underwater Research and Imaging Center logo as a faint watermark in the middle.
- Logo also in the top bar and at the top of the sign-in box. App name for now: "Turtle Patrol".

## Structure
- One project area → 3 regions: Famagusta, İskele, Bafra (admins can add more).
- Each region has beach sectors drawn on the map. Famagusta: Bedis Left, Bedis Right, Crystal. İskele: Zaradise. Bafra: none yet. (Long Beach, Bafra Beach and Kumyalı were prototype examples only.) Borders are drawn by admins on the satellite map.
- Season (Year) button: every page shows one season's data (nests, visits, gear counts, patrols). Sectors are shared by all seasons. Past seasons (e.g. 2025) are typed in manually after switching the season. Future seasons start empty; admins can copy gear counts from the previous season.
- Main map in the live site: satellite view.
- Sections: Map, Nests, Gear, Patrols, Alerts, Visits (admins), Team, Control (admins). On phones, sections after the 5th go under "More"; on computers all are in the left rail.

## Accounts and roles
- Login: nickname + password. Email is required (password reset only).
- Anyone can create an account and becomes a Member. Becoming Admin needs approval from an existing admin.
- Members CAN: add nests and visits (coordinates, GPS or tapping the map), add photos, see nest dots on the map, see nest status, dates, species and notes, see gear, patrols, alerts and the team, edit their own profile, log their own attendance.
- Members CANNOT: see coordinates, hatching results or success, see visits after saving them, edit existing nests, gear, patrols, map or members, approve attendance, open Control, see other people's emails.
- Tapping a nest on the map shows members only the nest number, beach and photo.
- Admins: everything.

## Nests
- ID order: number-region-sector-date, date as DD/MM/YYYY, e.g. 3-FAM-BDL-01/08/2026. The number is the main name.
- Species: Caretta caretta, Chelonia mydas.
- Statuses: Not protected, Protected, Hatching, Hatched, Predation.
- Expected hatching = date found + 2 months. Adjustable globally and per nest.
- Missing cage or pyramid → Not protected → shown in Alerts so patrols bring extra gear.
- Expected hatching within 7 days → "Hatching soon" alert. Hatched without results → urgent alert.
- Hatching results (admins only): total eggs, hatched, unhatched, alive hatchlings, dead hatchlings.
- Hatching success = hatched eggs ÷ total eggs × 100 (confirmed).
- Photo per nest (resized, hidden location data removed). Sensor section present but empty.

## Visits (turtle came ashore, no nest)
- "Add visit" button next to "Add nest" on the map, same style and size. Anyone can add one.
- Fields: coordinates, beach sector, date, what was found (tracks only = false crawl, or started digging with no eggs = abandoned attempt), species (loggerhead, green, not sure), optional photo, notes, who logged it.
- Visits tab: admins only. Shows totals and nesting success = nests ÷ (nests + visits).
- Hidden on the map by default. The Visits tab has an On/Off switch "Show visits on the map"; when on, visits show as diamonds and a "Visits shown · Hide" button appears on the map.

## Coordinates and position
- One box: "latitude, longitude", e.g. 35.14294, 33.93160. Pasting from other apps works (brackets, semicolons, decimal commas, degrees-minutes-seconds).
- Outside Cyprus or swapped coordinates are rejected with a clear message.
- Nests and visits can be placed three ways: paste coordinates, "Use my location" (phone GPS), or tap the map. Nearest beach sector (within 3 km) is picked automatically.
- Blue "you are here" dot (live site: phone GPS, needs HTTPS and one-time permission).
- Admins: coordinates with Copy and "Show on map" on nest and visit pages.

## Gear
- Each active nest needs 1 cage + 1 pyramid. Gear frees up automatically when a nest is Hatched or Predation.
- Summary tiles: cages on nests, pyramids on nests, free cages / pyramids, total cages / pyramids, missing on found nests.
- Bars show each beach's own stock (1 of 1 in use fills the bar).
- Each sector has a "usual need". Below it → amber + alert. Nests without gear → red + alert.
- The "Below usual need" / "Short now" chip is a button: tap to show or hide the explanation and the free-gear tip. Below usual need starts closed; Short now starts open because it is urgent. Free-gear tips are grouped per beach.
- Live site: admins set counts with − / + or by typing the number; a count cannot go below the gear already on nests. A new season starts with "Copy counts from <last season>".
- "Move gear" moves only free gear. When the destination has nests waiting for gear, a tick box offers to mark them protected (tick only once the gear is placed on them).
- When adding a nest, the form shows the beach's free cages and pyramids; a box starts unticked if that beach has none left.

## Patrols and attendance
- Date, sector, estimated start and finish, team, notes. Hot-hours warning (default 11:00–16:00).
- Map "Patrol" button (top right) shows the next patrol day.
- NO email reminders.
- Attendance: after a patrol starts, team members tap "I was on duty" (others can tap "I joined this patrol too" within 7 days). Status: waiting → approved or not approved by an admin.
- Admins approve on the patrol itself or in Control → "Attendance to approve"; they can also "Mark present". Alerts remind members to log duties from the last 7 days and remind admins of waiting approvals.
- Live site: a member can "Take back" their own attendance while it is still waiting. The database records who approved or declined it, and when. "The patrol day has come" is judged in Cyprus time.
- Deleting a patrol also deletes its attendance records (the confirmation says so).

## Team
- "Meet the team" page for everyone: cards with photo (or initials), name, position, status, admin badge and duties this season.
- Profile: photo, name, @nickname, position, status, about, year joined, attendance for the season (approved and waiting, by month).
- Everyone can edit their own profile (photo, name, position, status, about).

## Also required
- Mobile-first design; installable on the phone home screen.
- Change history (who changed what, when) and daily backups.
- Later: offline saving, nest sensors, Mediterranean satellite tab with tagged turtle positions and last update time.

## Chosen tools (updated 01/10/2026)
- Website: plain HTML/CSS/JavaScript files, no build tools (replaces the earlier Next.js idea: simpler to maintain and runs on any host).
- Hosting: GitHub Pages (free); can move to the university server later.
- Database, logins, photos: Supabase FREE plan (decided 01/10/2026), region Central EU (Frankfurt). The university server was considered; Supabase free was chosen for now as it needs no IT support. Setup script: claude/database/01_setup.sql (tested: 63 permission checks pass).
- Satellite map: Leaflet with Esri World Imagery (free ArcGIS developer account).
- Email for sign-up confirmation and password reset: university mail server or Brevo (Supabase's built-in email only reaches Supabase team members, 2 per hour).
- Backups: free nightly copy of the database via GitHub Actions into a private repository (Supabase's recommended method); photos backed up separately.
- Supabase Pro ($25/month) is a later upgrade, once the project is established and payment is set up.
- Members' map positions: exact for now; one setting (members_see_exact_positions) rounds them to about 100 m.
- Step-by-step plan: claude/build-plan.md

## Control panel (admins)
- Admin requests (approve / decline), attendance to approve (season shown), members with emails and Make admin / Make member (at least one admin is always kept).
- Seasons table: counts per season, Add season, Copy gear, Show, and an Excel download of the whole season (Summary, Nests with coordinates and results, Visits, Gear, Patrols, Attendance). The Excel file is made in the browser, no outside service.
- Regions: add, rename, change code, delete (only when empty). Sectors: edit name, code, usual need.
- Nest rules: months to hatching, "hatching soon" days, hot hours, and whether members see exact nest positions or positions rounded to about 100 m.
- Change history in plain words with "Show older changes".

## Database scripts (run in this order in Supabase → SQL Editor)
- 01_setup.sql (tables, rules, photo store, starting data) · 02_nickname_login.sql (nickname sign-in, lockout) · 03_part2.sql (patrol and attendance functions, gear moves, season overview, attendance stamps). Each is safe to run again.
