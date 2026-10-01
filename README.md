# Turtle Patrol

Phone-first website for the sea turtle nest patrols of the EMU SAGEM Underwater Research and Imaging Center (Cyprus).
Plain HTML, CSS and JavaScript: no build step, no installs. Data, sign-in and photos are stored in Supabase.

## Files

| Path | What it is |
|---|---|
| `index.html` | The app page |
| `check.html` | Self-check: open it after any setup change; it says what is wrong and how to fix it |
| `js/config.js` | **The only settings file**: Supabase address, publishable key, ArcGIS key |
| `js/app.js` | Screens and buttons |
| `js/api.js` | Everything that talks to Supabase |
| `js/map.js` | The satellite map (Leaflet) and the sector drawing tools |
| `js/util.js` | Dates, coordinates, photos, icons |
| `js/boot.js` | Starts the app once the libraries have loaded |
| `css/app.css` | Look and layout, light and dark |
| `sw.js`, `manifest.webmanifest`, `img/icon-*` | Home-screen install on phones |
| `database/` | SQL scripts, run once each in Supabase → SQL Editor, in number order |

## Database scripts

1. `01_setup.sql`: tables, security rules, photo storage, starting regions and sectors. If it reports that tables already exist, run `00_reset_before_setup.sql` first (only works while no nests are recorded).
2. `02_nickname_login.sql`: sign-in with nickname while keeping emails private; locks a nickname for 15 minutes after 5 wrong passwords.

First admin: sign up on the site, then run in SQL Editor:
`update public.profiles set role = 'admin' where lower(nickname) = lower('YOUR_NICKNAME');`

## Publishing (GitHub Pages)

Repository → Settings → Pages → Source: deploy from branch `main`, folder `/ (root)`.
Then Supabase → Authentication → URL Configuration: set **Site URL** to the Pages address and add the same address to **Redirect URLs**, so password-reset links open the site.

## Rules

- Only the **publishable** key goes in `js/config.js`. Never put the secret/service_role key or the database password in this repository.
- Who can see what is enforced by the database, not by the page: members never receive coordinates of visits, hatching results, other people's emails or history.
- Backups go only to a private repository.

## Trying it on a computer

Run `python3 -m http.server 8080` in this folder and open http://localhost:8080. It connects to the real Supabase project in `js/config.js`.
