-- =====================================================================
--  Turtle Patrol: part 2 (gear, patrols, attendance, team, control)
--  Run once in Supabase → SQL Editor, after 01 and 02. Safe to run again.
--  Expected result: "Success. No rows returned".
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Nests for everyone: now also says whether hatching results were
--    recorded (yes or no only; the numbers stay admin-only), so members'
--    alerts can stop once an admin has recorded them.
-- ---------------------------------------------------------------------
drop function if exists public.get_nests(integer);
create function public.get_nests(p_season integer)
returns table (id uuid, season smallint, sector_id smallint, number smallint, species text,
               found_on date, expected_hatch date, status text, has_cage boolean, has_pyramid boolean,
               lat double precision, lng double precision, notes text, photo_path text, created_at timestamptz,
               has_results boolean)
language sql stable security definer set search_path = '' as $$
  select n.id, n.season, n.sector_id, n.number, n.species, n.found_on, n.expected_hatch, n.status,
         n.has_cage, n.has_pyramid,
         case when public.is_admin() or s.members_see_exact_positions then n.lat else round(n.lat::numeric, 3)::double precision end,
         case when public.is_admin() or s.members_see_exact_positions then n.lng else round(n.lng::numeric, 3)::double precision end,
         n.notes, n.photo_path, n.created_at,
         exists (select 1 from public.nest_results r where r.nest_id = n.id)
    from public.nests n cross join public.settings s
   where n.season = p_season and not n.archived and auth.uid() is not null
   order by n.sector_id, n.number;
$$;

-- ---------------------------------------------------------------------
-- 2. Patrols with their team, and attendance, for one season.
--    Everyone signed in can read these (the table rules still apply).
-- ---------------------------------------------------------------------
create or replace function public.get_patrols(p_season integer)
returns table (id uuid, season smallint, sector_id smallint, day date, starts time, ends time, notes text,
               team uuid[], created_at timestamptz)
language sql stable set search_path = '' as $$
  select p.id, p.season, p.sector_id, p.day, p.starts, p.ends, p.notes,
         coalesce(array(select t.user_id from public.patrol_team t where t.patrol_id = p.id), '{}'::uuid[]),
         p.created_at
    from public.patrols p
   where p.season = p_season
   order by p.day, p.starts;
$$;

create or replace function public.get_attendance(p_season integer)
returns table (id uuid, patrol_id uuid, user_id uuid, status text, logged_at timestamptz,
               decided_by uuid, decided_at timestamptz)
language sql stable set search_path = '' as $$
  select a.id, a.patrol_id, a.user_id, a.status, a.logged_at, a.decided_by, a.decided_at
    from public.attendance a join public.patrols p on p.id = a.patrol_id
   where p.season = p_season;
$$;

-- ---------------------------------------------------------------------
-- 3. Admins: save a patrol and its team in one step.
-- ---------------------------------------------------------------------
create or replace function public.save_patrol(p_id uuid, p_season integer, p_sector integer, p_day date,
                                              p_starts time, p_ends time, p_notes text, p_team uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can plan patrols.'; end if;
  if p_day is null or extract(year from p_day) <> p_season then raise exception 'Pick a date in the % season.', p_season; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'The estimated finish must be later than the start.'; end if;
  if coalesce(array_length(p_team, 1), 0) = 0 then raise exception 'Add at least one person to the team.'; end if;
  if p_id is null then
    insert into public.patrols (season, sector_id, day, starts, ends, notes)
    values (p_season, p_sector, p_day, p_starts, p_ends, coalesce(p_notes, ''))
    returning id into v_id;
  else
    update public.patrols
       set sector_id = p_sector, day = p_day, starts = p_starts, ends = p_ends, notes = coalesce(p_notes, '')
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'That patrol no longer exists.'; end if;
  end if;
  delete from public.patrol_team where patrol_id = v_id and not (user_id = any (p_team));
  insert into public.patrol_team (patrol_id, user_id)
  select v_id, u from unnest(p_team) as u
  on conflict do nothing;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. Admins: move free cages or pyramids from one beach to another.
--    Gear on a nest that is still incubating is not free.
--    With p_protect, nests at the destination that are waiting for gear
--    get it (and become Protected once they have both).
--    Returns how many nests became Protected.
-- ---------------------------------------------------------------------
create or replace function public.move_gear(p_season integer, p_from integer, p_to integer, p_kind text,
                                            p_count integer, p_protect boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_stock int; v_used int; v_free int; v_fixed int := 0;
  v_name text; v_word text;
  v_fc int; v_fp int;
  r record;
begin
  if not public.is_admin() then raise exception 'Only admins can move gear.'; end if;
  if p_kind not in ('cages', 'pyramids') then raise exception 'Choose cages or pyramids.'; end if;
  if p_from = p_to then raise exception 'Pick two different beaches.'; end if;
  if p_count is null or p_count < 1 then raise exception 'Enter how many to move, 1 or more.'; end if;

  insert into public.gear_stock (season, sector_id) values (p_season, p_from), (p_season, p_to)
  on conflict do nothing;
  perform 1 from public.gear_stock where season = p_season and sector_id in (p_from, p_to) for update;

  select case when p_kind = 'cages' then cages else pyramids end into v_stock
    from public.gear_stock where season = p_season and sector_id = p_from;
  select count(*) into v_used from public.nests
   where season = p_season and sector_id = p_from and not archived and status in ('notprot', 'prot', 'hatching')
     and (case when p_kind = 'cages' then has_cage else has_pyramid end);
  v_free := greatest(0, v_stock - v_used);
  if p_count > v_free then
    select name into v_name from public.sectors where id = p_from;
    v_word := case when p_kind = 'cages' then (case when v_free = 1 then 'free cage' else 'free cages' end)
                                         else (case when v_free = 1 then 'free pyramid' else 'free pyramids' end) end;
    raise exception '% has only % %.', v_name, v_free, v_word;
  end if;

  if p_kind = 'cages' then
    update public.gear_stock set cages = cages - p_count where season = p_season and sector_id = p_from;
    update public.gear_stock set cages = cages + p_count where season = p_season and sector_id = p_to;
  else
    update public.gear_stock set pyramids = pyramids - p_count where season = p_season and sector_id = p_from;
    update public.gear_stock set pyramids = pyramids + p_count where season = p_season and sector_id = p_to;
  end if;

  if p_protect then
    for r in select id, has_cage, has_pyramid from public.nests
              where season = p_season and sector_id = p_to and not archived and status = 'notprot'
              order by number loop
      select g.cages - (select count(*) from public.nests n where n.season = p_season and n.sector_id = p_to and not n.archived
                         and n.status in ('notprot', 'prot', 'hatching') and n.has_cage),
             g.pyramids - (select count(*) from public.nests n where n.season = p_season and n.sector_id = p_to and not n.archived
                         and n.status in ('notprot', 'prot', 'hatching') and n.has_pyramid)
        into v_fc, v_fp
        from public.gear_stock g where g.season = p_season and g.sector_id = p_to;
      if (not r.has_cage and v_fc > 0) or (not r.has_pyramid and v_fp > 0) then
        update public.nests
           set has_cage = has_cage or v_fc > 0, has_pyramid = has_pyramid or v_fp > 0
         where id = r.id;
        if (r.has_cage or v_fc > 0) and (r.has_pyramid or v_fp > 0) then v_fixed := v_fixed + 1; end if;
      end if;
    end loop;
  end if;
  return v_fixed;
end $$;

-- ---------------------------------------------------------------------
-- 5. Admins: one line per season for the Control panel.
-- ---------------------------------------------------------------------
create or replace function public.season_summary()
returns table (year smallint, nests bigint, removed bigint, visits bigint, patrols bigint, gear_rows bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can see the season overview.'; end if;
  return query
    select s.year,
           (select count(*) from public.nests n where n.season = s.year and not n.archived),
           (select count(*) from public.nests n where n.season = s.year and n.archived),
           (select count(*) from public.visits v where v.season = s.year),
           (select count(*) from public.patrols p where p.season = s.year),
           (select count(*) from public.gear_stock g where g.season = s.year)
      from public.seasons s
     order by s.year desc;
end $$;

-- ---------------------------------------------------------------------
-- 6. Attendance
--    a) Record who approved or declined, and when, automatically.
--    b) "The patrol day has come" is judged in Cyprus time.
--    c) People can take back their own attendance while it is still waiting.
-- ---------------------------------------------------------------------
create or replace function public.attendance_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then new.decided_by := auth.uid(); new.decided_at := now(); end if;
  elsif new.status is distinct from old.status then
    if new.status = 'pending' then new.decided_by := null; new.decided_at := null;
    else new.decided_by := auth.uid(); new.decided_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists attendance_stamp on public.attendance;
create trigger attendance_stamp before insert or update on public.attendance
  for each row execute function public.attendance_stamp();

drop policy if exists "log your own attendance" on public.attendance;
create policy "log your own attendance" on public.attendance
  for insert to authenticated with check (
    (select public.is_admin())
    or (user_id = (select auth.uid()) and status = 'pending' and decided_by is null
        and exists (select 1 from public.patrols p
                     where p.id = patrol_id and p.day <= (now() at time zone 'Europe/Nicosia')::date)));

drop policy if exists "take back your own waiting attendance" on public.attendance;
create policy "take back your own waiting attendance" on public.attendance
  for delete to authenticated using (user_id = (select auth.uid()) and status = 'pending');

-- ---------------------------------------------------------------------
-- 7. Who may call the new functions: signed-in people only.
-- ---------------------------------------------------------------------
revoke execute on function public.get_nests(integer), public.get_patrols(integer), public.get_attendance(integer),
                           public.save_patrol(uuid, integer, integer, date, time, time, text, uuid[]),
                           public.move_gear(integer, integer, integer, text, integer, boolean),
                           public.season_summary(), public.attendance_stamp()
  from public, anon;
grant execute on function public.get_nests(integer), public.get_patrols(integer), public.get_attendance(integer),
                          public.save_patrol(uuid, integer, integer, date, time, time, text, uuid[]),
                          public.move_gear(integer, integer, integer, text, integer, boolean),
                          public.season_summary()
  to authenticated;

commit;
