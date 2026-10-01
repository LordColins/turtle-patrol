-- =====================================================================
--  Turtle Patrol: sign in with nickname
--  Run once in Supabase → SQL Editor, after 01_setup.sql. Safe to run again.
--
--  Supabase signs people in with their email. People here sign in with a
--  nickname, but emails must stay private. login_email() checks the
--  nickname and password inside the database and returns the email only
--  when the password is right; the app then signs in normally.
--
--  Protection against guessing: after 5 wrong passwords for a nickname,
--  that nickname is locked for 15 minutes.
-- =====================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.login_attempts (
  nick_key     text primary key,            -- the nickname in lower case
  failures     smallint not null default 0,
  locked_until timestamptz
);
alter table public.login_attempts enable row level security;   -- no rules: nobody reaches it from the app
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.login_email(p_nick text, p_password text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key   text := lower(trim(coalesce(p_nick, '')));
  v_email text;
  v_hash  text;
  v_row   public.login_attempts%rowtype;
begin
  if v_key = '' or coalesce(p_password, '') = '' then
    return null;
  end if;

  select * into v_row from public.login_attempts where nick_key = v_key;
  if found and v_row.locked_until is not null then
    if v_row.locked_until > now() then
      raise exception 'Too many wrong passwords for this nickname. Try again in % minutes, or reset your password.',
        greatest(1, ceil(extract(epoch from (v_row.locked_until - now())) / 60))::int;
    end if;
    update public.login_attempts set failures = 0, locked_until = null where nick_key = v_key;
  end if;

  select u.email, u.encrypted_password into v_email, v_hash
    from public.profiles p join auth.users u on u.id = p.id
   where lower(p.nickname) = v_key;

  if coalesce(v_hash, '') <> '' and extensions.crypt(p_password, v_hash) = v_hash then
    delete from public.login_attempts where nick_key = v_key;
    return v_email;
  end if;

  insert into public.login_attempts as a (nick_key, failures) values (v_key, 1)
  on conflict (nick_key) do update
    set failures = a.failures + 1,
        locked_until = case when a.failures + 1 >= 5 then now() + interval '15 minutes' else null end;
  return null;
end $$;

revoke execute on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

commit;
