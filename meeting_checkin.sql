-- Apply after meeting_hub.sql. Attendance is accessed only through the RPCs below.
begin;

create table public.meeting_checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  meeting_day date not null unique,
  token uuid not null unique default gen_random_uuid(),
  opens_at timestamptz not null,
  closes_at timestamptz not null check (closes_at >= opens_at),
  opened_by uuid not null
);

create table public.meeting_checkin_roster (
  session_id uuid not null references public.meeting_checkin_sessions(id),
  email text not null,
  name text not null,
  checked_in_at timestamptz,
  primary key (session_id, email)
);
create index meeting_checkin_roster_email on public.meeting_checkin_roster (email, session_id);

alter table public.meeting_checkin_sessions enable row level security;
alter table public.meeting_checkin_roster enable row level security;
revoke all on public.meeting_checkin_sessions, public.meeting_checkin_roster from public, anon, authenticated;

create schema if not exists tpg_meeting_private;
revoke all on schema tpg_meeting_private from public, anon, authenticated;
grant usage on schema tpg_meeting_private to authenticated;

create function tpg_meeting_private.open_meeting_checkin(p_title text, p_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.meeting_checkin_sessions;
  opened timestamptz := clock_timestamp();
begin
  if coalesce(public.meeting_hub_role(), '') not in ('owner','admin') then
    raise exception 'Meeting host access required' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 5 and 60 then
    raise exception 'Check-in must be open for 5 to 60 minutes';
  end if;
  insert into public.meeting_checkin_sessions(title, meeting_day, opens_at, closes_at, opened_by)
  values (btrim(p_title), (opened at time zone 'Asia/Kuala_Lumpur')::date,
          opened, opened + make_interval(mins => p_minutes), auth.uid())
  returning * into entry;

  insert into public.meeting_checkin_roster(session_id, email, name)
  select distinct on (lower(a.email)) entry.id, lower(a.email), coalesce(nullif(btrim(a.full_name), ''), a.email)
  from public.allowlist a
  where a.status::text = 'active'
  order by lower(a.email), a.email;

  return jsonb_build_object('id', entry.id);
end;
$$;

create function tpg_meeting_private.close_meeting_checkin(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.meeting_hub_role(), '') not in ('owner','admin') then
    raise exception 'Meeting host access required' using errcode = '42501';
  end if;
  update public.meeting_checkin_sessions
  set closes_at = least(closes_at, clock_timestamp())
  where id = p_session;
end;
$$;

create function tpg_meeting_private.submit_meeting_checkin(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member_email text;
  entry public.meeting_checkin_sessions;
  first_checkin timestamptz;
  checked_at timestamptz;
begin
  select lower(a.email) into member_email
  from public.my_access() a
  where auth.uid() is not null and a.status::text = 'active'
    and a.role::text in ('owner','admin','editor','agent')
  limit 1;
  if member_email is null then
    raise exception 'Active Agent access required' using errcode = '42501';
  end if;

  select * into entry from public.meeting_checkin_sessions s where s.token = p_token for share;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select r.checked_in_at into first_checkin from public.meeting_checkin_roster r
  where r.session_id = entry.id and r.email = member_email for update;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;

  if first_checkin is not null then
    return jsonb_build_object('status', 'already_checked_in', 'at', first_checkin);
  end if;
  checked_at := clock_timestamp();
  if checked_at < entry.opens_at or checked_at >= entry.closes_at then
    return jsonb_build_object('status', 'closed');
  end if;

  update public.meeting_checkin_roster
  set checked_in_at = checked_at where session_id = entry.id and email = member_email;
  return jsonb_build_object('status', 'checked_in', 'at', checked_at);
end;
$$;

create function tpg_meeting_private.my_meeting_attendance()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  member_email text;
  member_role text;
  counts jsonb;
  history jsonb;
  current_session jsonb;
begin
  select lower(a.email), a.role::text into member_email, member_role
  from public.my_access() a
  where auth.uid() is not null and a.status::text = 'active'
    and a.role::text in ('owner','admin','editor','agent')
  limit 1;
  if member_email is null then
    raise exception 'Active Agent access required' using errcode = '42501';
  end if;

  select jsonb_build_object('total', count(*),
      'attended', count(r.checked_in_at), 'missed', count(*) - count(r.checked_in_at),
      'percent', round(100.0 * count(r.checked_in_at) / nullif(count(*), 0)))
  into counts
  from public.meeting_checkin_roster r join public.meeting_checkin_sessions s on s.id = r.session_id
  where r.email = member_email and s.closes_at <= now();

  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.meeting_day desc), '[]')
  into history
  from (
    select s.title, s.meeting_day, s.closes_at, r.checked_in_at
    from public.meeting_checkin_roster r join public.meeting_checkin_sessions s on s.id = r.session_id
    where r.email = member_email
    order by s.meeting_day desc limit 30
  ) recent;

  if member_role in ('owner','admin') then
    select jsonb_build_object('id', s.id, 'title', s.title, 'closes_at', s.closes_at,
      'token', case when s.closes_at > now() then s.token end,
      'roster', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'email', r.email,
        'checked_in_at', r.checked_in_at) order by r.name, r.email)
        from public.meeting_checkin_roster r where r.session_id = s.id), '[]'))
    into current_session
    from public.meeting_checkin_sessions s
    where s.meeting_day = (now() at time zone 'Asia/Kuala_Lumpur')::date;
  end if;

  return jsonb_build_object('summary', counts, 'history', history, 'host_session', current_session,
    'team_total', (select count(*) from public.meeting_checkin_sessions s where s.closes_at <= now()));
end;
$$;

revoke all on function tpg_meeting_private.open_meeting_checkin(text, integer), tpg_meeting_private.close_meeting_checkin(uuid),
  tpg_meeting_private.submit_meeting_checkin(uuid), tpg_meeting_private.my_meeting_attendance() from public, anon;
grant execute on function tpg_meeting_private.open_meeting_checkin(text, integer), tpg_meeting_private.close_meeting_checkin(uuid),
  tpg_meeting_private.submit_meeting_checkin(uuid), tpg_meeting_private.my_meeting_attendance() to authenticated;

create function public.open_meeting_checkin(p_title text, p_minutes integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select tpg_meeting_private.open_meeting_checkin(p_title, p_minutes)
$$;

create function public.close_meeting_checkin(p_session uuid)
returns void language sql security invoker set search_path = '' as $$
  select tpg_meeting_private.close_meeting_checkin(p_session)
$$;

create function public.submit_meeting_checkin(p_token uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select tpg_meeting_private.submit_meeting_checkin(p_token)
$$;

create function public.my_meeting_attendance()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select tpg_meeting_private.my_meeting_attendance()
$$;

revoke all on function public.open_meeting_checkin(text, integer), public.close_meeting_checkin(uuid),
  public.submit_meeting_checkin(uuid), public.my_meeting_attendance() from public, anon;
grant execute on function public.open_meeting_checkin(text, integer), public.close_meeting_checkin(uuid),
  public.submit_meeting_checkin(uuid), public.my_meeting_attendance() to authenticated;

commit;
