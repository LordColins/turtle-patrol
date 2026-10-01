# Turtle Patrol: from prototype to live website

Written 01/10/2026, updated the same day: we stay on Supabase's free plan for the first seasons. Target: live and tested before the 2027 nesting season (May).

## How the live site is put together

| Part | What it is | Cost |
|---|---|---|
| Website | Plain files (HTML, CSS, JavaScript), like the prototype. No build tools. | Free |
| Hosting | GitHub Pages: the files go in a GitHub repository and are published at an https address. Can move to the university server later, since it's just files. | Free |
| Database, logins, photos | Supabase free plan: stores all data, handles sign-in and password reset, keeps photos, enforces who can see what. Limits: 500 MB of data and 1 GB of photos, enough for several seasons at our size. | Free. Pro ($25/month) is an optional upgrade later |
| Backups | A nightly job on GitHub copies the database into a private GitHub repository (Supabase's own recommended method). Photos are backed up separately. | Free |
| Satellite map | Leaflet map library with Esri World Imagery (free developer account). | Free within the monthly allowance |
| Email (sign-up confirmation, password reset) | University mail server, or a free sender such as Brevo. Supabase's own email only reaches Supabase team members, 2 per hour. | Free |
| Domain | Optional: a university subdomain (ask IT), or buy one. | Free, or about €10–15 a year |
| On phones | Open the site, then "Add to Home Screen": it gets an icon and opens full screen like an app. | Free |

Why plain files instead of a framework: nothing to compile or install, any student with basic web skills can maintain it, and it runs on any web host, including the university's.

## Steps

### Step 1. Accounts (you, about 30 minutes)
1. Choose one shared project email that stays with the project when people leave, ideally a university address. Use it for every account below, and store the passwords where a second admin can reach them.
2. **GitHub** (github.com → Sign up). Holds the code and hosts the site. Teachers can get free extras through GitHub Education, but the free plan is enough.
3. **Supabase** (supabase.com → Start your project → sign in with GitHub or the project email).
   - New project → Name: `turtle-patrol` → Region: **Central EU (Frankfurt)**, closest to Cyprus.
   - Database password: create a strong one and save it safely. You will rarely need it.
4. **ArcGIS** (developers.arcgis.com → free account) for the satellite map. This can wait until Step 3.

### Step 2. Database (you, 5 minutes; script is ready and tested)
1. Supabase → **SQL Editor** → New query → paste all of `database/01_setup.sql` → **Run**. What you may see:
   - "Success. No rows returned": done.
   - "GOOD NEWS: Turtle Patrol setup has already been run": it worked on an earlier run; nothing to do.
   - "This project already has tables or a sign-up function with the same names": paste and run `database/00_reset_before_setup.sql`, then run `01_setup.sql` again. The reset only works while no nests are recorded.
2. Check: **Table Editor** shows tables such as `nests`, `visits`, `patrols`, `profiles`; the `sectors` table has Bedis Left, Bedis Right, Crystal and Zaradise.
3. Then paste and run `database/02_nickname_login.sql` the same way (nickname sign-in). Expected: "Success. No rows returned". Safe to run again.
4. **Project Settings → Data API**: copy the **Project URL**. **Project Settings → API Keys**: copy the **publishable** key (older projects call it the "anon public" key). Send both to Claude. They are safe to share; the database rules protect the data.
   - Never share the **service_role / secret key** or the database password.
5. While building only: **Authentication → Sign In / Providers → Email** → turn **Confirm email** off, so test accounts work without an email sender. Turn it back on in Step 8.

### Step 3. Live app, part 1 (Claude) — built 01/10/2026, 93 end-to-end checks pass
Converts the prototype into the real app, connected to Supabase:
- sign up, sign in with nickname, sign out, password reset. `database/02_nickname_login.sql` (run once in SQL Editor) keeps emails private and locks a nickname for 15 minutes after 5 wrong passwords
- the satellite map (opens on the project's regions; the Cyprus chip shows the whole island); admins draw new sectors, move borders (drag corners, add or remove corners), rename, set usual need, delete empty sectors
- nests: add (paste coordinates, GPS "My location", or tap the map; nearest sector found automatically), photos (shrunk on the phone, stored privately), details, editing, remove/restore, change history, admin coordinates with Copy and "Show on map"
- hatching results with the success formula (admins only; opens on the expected hatching date or when marked Hatched)
- visits: anyone adds; admins see the Visits page, nesting success, and the map on/off switch
- seasons: switch, type in past seasons, admins add the next season
- installable on phones (home screen icon); `check.html` self-check page

### Step 4. Live app, part 2 (Claude)
Gear and shortage alerts, patrols and the map Patrol button, attendance and approvals, Team and profiles, Alerts, Control panel (members, roles, admin requests, regions, rules, full history), export to Excel.

### Step 5. Put it online (together)
1. On GitHub create an empty repository named `turtle-patrol`. Claude connects to it and puts the code there.
2. Repository → Settings → Pages → deploy from the main branch. The site goes live at `https://<account>.github.io/turtle-patrol/`.
3. Backups: create a second, **private** repository named `turtle-patrol-backups`. Claude adds the nightly backup job; you paste the database connection address into the repository's secrets once. Never put backups in a public repository.
4. Sign up on the site with your nickname, then in Supabase → SQL Editor run the one line at the end of the setup script to make yourself the first admin. From then on, admins promote others in the app.
5. In Supabase → Authentication → URL Configuration: set the Site URL to the live address, so password-reset links open the right page.

### Step 6. Real data (admins, December–January)
Draw the real sector borders on the satellite map, set each beach's usual need, enter gear counts, type in the 2025 season after switching the Season button to 2025.

### Step 7. Beach test (February–March)
Three or four people use it on real patrols, on their own phones, in sunlight. Claude fixes what they find.

### Step 8. Launch (April)
1. Email sender: Supabase → Authentication → Emails → SMTP settings, with the university's mail server details (ask IT) or a free Brevo account. Turn **Confirm email** back on.
2. Domain: a university subdomain such as `turtles.<university domain>` (ask IT), or a bought domain, connected in GitHub Pages settings.
3. Stay on the free plan. Keep in mind: a free project pauses after a week with no use (only likely off-season); an admin switches it back on in the Supabase dashboard. Check the nightly backups are arriving once a month. Upgrading to Pro ($25/month) later adds Supabase's own daily backups and stops pausing.
4. Short training session; everyone adds the site to their home screen.

### Later
Offline saving for beaches with no signal, nest sensors, the Mediterranean turtle-tracking map.

## Rules to keep
- Never share the service_role/secret key or the database password.
- Coordinates: members' maps show exact nest dots, which means the coordinates reach their phones. If that ever becomes a concern, switch `members_see_exact_positions` off in the `settings` table: members then get positions rounded to about 100 m.
- Keep at least two admins at all times.
- Backups only ever go to a private repository: they contain emails and nest coordinates.

## How testing works
Claude's workspace cannot connect to Supabase, so Claude tests the app against a stand-in copy of the database and the real check happens in your browser. Clear on-screen error messages will make any problem easy to report.
