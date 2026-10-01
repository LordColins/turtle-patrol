-- =====================================================================
--  Turtle Patrol: reset before setup
--
--  Use ONLY when 01_setup.sql says the project already has tables or a
--  sign-up function with the same names, on a project with no real data.
--
--  It removes Turtle Patrol's tables, functions and photo rules, and any
--  "profiles" table left by a Supabase starter template, so that
--  01_setup.sql can run cleanly afterwards.
--
--  Safety: it stops and changes nothing if any nests are already recorded.
-- =====================================================================

begin;

do $$
declare n bigint;
begin
  if to_regclass('public.nests') is not null then
    execute 'select count(*) from public.nests' into n;
    if n > 0 then
      raise exception 'This project already has % recorded nest(s), so the reset was stopped. Nothing was changed.', n;
    end if;
  end if;
end $$;

-- Sign-up triggers on the login table
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_email_changed on auth.users;

-- Tables (and everything attached to them)
drop table if exists
  public.sensor_readings, public.sensors, public.history, public.attendance, public.patrol_team,
  public.patrols, public.gear_stock, public.visits, public.nest_results, public.nests,
  public.settings, public.seasons, public.sectors, public.regions, public.profiles
  cascade;

-- Functions
drop function if exists public.handle_new_user() cascade;
drop function if exists public.handle_email_change() cascade;
drop function if exists public.nest_rules() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.log_change() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.nickname_available(text) cascade;
drop function if exists public.get_nests(integer) cascade;
drop function if exists public.set_nest_photo(uuid, text) cascade;
drop function if exists public.request_admin() cascade;
drop function if exists public.set_role(uuid, text) cascade;
drop function if exists public.decline_admin_request(uuid) cascade;
drop function if exists public.admin_members() cascade;
drop function if exists public.copy_gear(integer, integer) cascade;
drop function if exists public.email_for_nickname(text) cascade;

-- Photo rules (the "photos" store itself is kept; setup reuses it)
drop policy if exists "photos: upload nest, visit and own profile photos" on storage.objects;
drop policy if exists "photos: see nest and profile photos (admins see all)" on storage.objects;
drop policy if exists "photos: replace your own profile photo" on storage.objects;
drop policy if exists "photos: delete your own profile photo, admins delete any" on storage.objects;

commit;

-- Done. Now run 01_setup.sql.
