-- Automatic Tuesday morning sessions and a role-checked report.
alter table public.meeting_checkin_sessions
  alter column opened_by drop not null,
  add column weekly boolean not null default false,
  add constraint meeting_checkin_opener check (weekly = (opened_by is null));

create function tpg_meeting_private.ensure_weekly_checkin(p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  local_at timestamp := p_now at time zone 'Asia/Kuala_Lumpur';
  local_day date := local_at::date;
  new_session uuid;
  active_session uuid;
begin
  if extract(isodow from local_day) <> 2 or local_at::time >= time '12:00' then
    return null;
  end if;
  insert into public.meeting_checkin_sessions(title, meeting_day, opens_at, closes_at, weekly)
  values ('Weekly Team Meeting', local_day, local_day::timestamp at time zone 'Asia/Kuala_Lumpur',
          (local_day + time '12:00') at time zone 'Asia/Kuala_Lumpur', true)
  on conflict (meeting_day) do nothing returning id into new_session;

  if new_session is not null then
    insert into public.meeting_checkin_roster(session_id, email, name)
    select distinct on (lower(a.email)) new_session, lower(a.email),
      coalesce(nullif(btrim(a.full_name), ''), a.email)
    from public.allowlist a
    where a.status = 'active' and a.role in ('owner','admin','editor','agent')
    order by lower(a.email), a.email;
    return new_session;
  end if;
  select s.id into active_session from public.meeting_checkin_sessions s
  where s.meeting_day = local_day and s.weekly;
  return active_session;
end;
$$;
revoke all on function tpg_meeting_private.ensure_weekly_checkin(timestamptz) from public, anon, authenticated;

create function tpg_meeting_private.submit_weekly_checkin()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  checked_at timestamptz := clock_timestamp();
  local_day date := (checked_at at time zone 'Asia/Kuala_Lumpur')::date;
  entry public.meeting_checkin_sessions;
begin
  if coalesce(public.meeting_hub_role(), '') not in ('owner','admin','editor','agent') then
    raise exception 'Active Agent access required' using errcode = '42501';
  end if;
  if extract(isodow from local_day) <> 2 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  perform tpg_meeting_private.ensure_weekly_checkin(checked_at);
  select s.* into entry from public.meeting_checkin_sessions s where s.meeting_day = local_day and s.weekly;
  if not found then return jsonb_build_object('status', 'closed'); end if;
  return tpg_meeting_private.submit_meeting_checkin(entry.token);
end;
$$;

create function tpg_meeting_private.weekly_checkin_report(p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  entry public.meeting_checkin_sessions;
  report jsonb;
  dates jsonb;
begin
  if coalesce(public.meeting_hub_role(), '') not in ('owner','admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(s.meeting_day order by s.meeting_day desc), '[]') into dates
  from public.meeting_checkin_sessions s where s.weekly and s.closes_at <= now();
  select s.* into entry from public.meeting_checkin_sessions s
  where s.weekly and s.closes_at <= now() and (p_day is null or s.meeting_day = p_day)
  order by s.meeting_day desc limit 1;
  if not found then return jsonb_build_object('dates', dates, 'report', null); end if;

  with attendance as (
    select r.name, r.email, r.checked_in_at,
      case when r.checked_in_at is null then 'Absent'
           when (r.checked_in_at at time zone 'Asia/Kuala_Lumpur')::time >= time '10:31' then 'Late'
           else 'Present' end as status
    from public.meeting_checkin_roster r where r.session_id = entry.id
  ), fines as (
    select *, case status when 'Absent' then 150 when 'Late' then 30 else 0 end as fine from attendance
  )
  select jsonb_build_object('day', entry.meeting_day, 'expected', count(*),
    'late', count(*) filter (where status = 'Late'),
    'absent', count(*) filter (where status = 'Absent'),
    'total_rm', coalesce(sum(fine), 0),
    'exceptions', coalesce(jsonb_agg(to_jsonb(fines) order by (status = 'Absent'), lower(name), email)
      filter (where status in ('Late','Absent')), '[]'))
  into report from fines;
  return jsonb_build_object('dates', dates, 'report', report);
end;
$$;

revoke all on function tpg_meeting_private.submit_weekly_checkin(), tpg_meeting_private.weekly_checkin_report(date) from public, anon;
grant execute on function tpg_meeting_private.submit_weekly_checkin(), tpg_meeting_private.weekly_checkin_report(date) to authenticated;

create function public.submit_weekly_checkin()
returns jsonb language sql security invoker set search_path = '' as $$
  select tpg_meeting_private.submit_weekly_checkin()
$$;
create function public.weekly_checkin_report(p_day date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select tpg_meeting_private.weekly_checkin_report(p_day)
$$;
revoke all on function public.submit_weekly_checkin(), public.weekly_checkin_report(date) from public, anon;
grant execute on function public.submit_weekly_checkin(), public.weekly_checkin_report(date) to authenticated;

-- The previous manual controls no longer apply to Tuesday sessions.
revoke execute on function public.open_meeting_checkin(text, integer), public.close_meeting_checkin(uuid),
  tpg_meeting_private.open_meeting_checkin(text, integer), tpg_meeting_private.close_meeting_checkin(uuid) from authenticated;

create extension if not exists pg_cron;
-- The production scheduler clock is GMT. These runs are Tuesday 00:00 and 00:01 in Malaysia.
select cron.schedule('tpg-tuesday-checkin-open', '0,1 16 * * 1',
  'select tpg_meeting_private.ensure_weekly_checkin(clock_timestamp())');
