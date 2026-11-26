begin;

-- Uses the same live allowlist as the portal. No authorization comes from
-- browser UI, user-editable metadata or an email supplied by the caller.
create or replace function public.meeting_hub_role()
returns text
language sql stable security invoker set search_path = ''
as $$
  select nullif(a.role::text, '')
  from public.my_access() a
  where auth.uid() is not null and a.status::text = 'active'
  limit 1
$$;
revoke all on function public.meeting_hub_role() from public, anon;
grant execute on function public.meeting_hub_role() to authenticated;

create table public.meeting_hub_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('minutes', 'stock', 'awards')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  event_date date not null,
  body text not null default '' check (char_length(body) <= 12000),
  meeting_id uuid references public.meeting_hub_entries(id) on delete set null,
  listing_category text,
  listing_id text,
  meeting_price text check (char_length(meeting_price) <= 100),
  stock_status text,
  checked_on date,
  poster_path text unique,
  award_type text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'minutes' and meeting_id is null and listing_id is null and listing_category is null
      and meeting_price is null and stock_status is null and checked_on is null and poster_path is null and award_type is null)
    or
    (kind = 'stock' and listing_category is not null and listing_category in ('industry','residential')
      and listing_id is not null and listing_id ~ '^[0-9]{1,24}$'
      and stock_status is not null and stock_status in ('unconfirmed','available','closed')
      and (stock_status = 'unconfirmed' or checked_on is not null)
      and poster_path is null and award_type is null)
    or
    (kind = 'awards' and award_type is not null and award_type in ('Top 5','Rookie','Project Performance')
      and poster_path is not null and poster_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.](png|jpg|webp)$'
      and meeting_id is null and listing_id is null and listing_category is null
      and meeting_price is null and stock_status is null and checked_on is null)
  )
);
create index meeting_hub_entries_kind_date on public.meeting_hub_entries(kind, event_date desc);
create index meeting_hub_entries_meeting_id on public.meeting_hub_entries(meeting_id);
create unique index meeting_hub_award_month
  on public.meeting_hub_entries(award_type, (extract(year from event_date)), (extract(month from event_date)))
  where kind = 'awards';
alter table public.meeting_hub_entries enable row level security;
revoke all on public.meeting_hub_entries from public, anon, authenticated;
grant select, insert on public.meeting_hub_entries to authenticated;
grant update (stock_status, checked_on) on public.meeting_hub_entries to authenticated;

create policy "Active agents read Meeting Hub" on public.meeting_hub_entries
  for select to authenticated using ((select public.meeting_hub_role()) in ('owner','admin','editor','agent'));
create policy "Staff publish Meeting Hub" on public.meeting_hub_entries
  for insert to authenticated with check ((select public.meeting_hub_role()) in ('owner','admin','editor')
    and (poster_path is null or split_part(poster_path, '/', 1) = (select auth.uid())::text));
create policy "Staff update Meeting Hub" on public.meeting_hub_entries
  for update to authenticated using ((select public.meeting_hub_role()) in ('owner','admin','editor'))
  with check ((select public.meeting_hub_role()) in ('owner','admin','editor'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-hub-posters', 'meeting-hub-posters', false, 5242880,
        array['image/jpeg','image/png','image/webp']);

-- Restrictive policies protect this bucket even if the project has other
-- permissive Storage policies. Other buckets retain their existing rules.
create policy "Meeting posters cannot be read anonymously" on storage.objects
  as restrictive for select to anon using (bucket_id <> 'meeting-hub-posters');
create policy "Meeting posters require an eligible reader" on storage.objects
  as restrictive for select to authenticated using (bucket_id <> 'meeting-hub-posters' or
    ((select public.meeting_hub_role()) in ('owner','admin','editor','agent')
     and (exists (select 1 from public.meeting_hub_entries e
                  where e.kind = 'awards' and e.poster_path = name)
          or ((select public.meeting_hub_role()) in ('owner','admin','editor')
              and split_part(name, '/', 1) = (select auth.uid())::text))));
create policy "Active agents read published meeting posters" on storage.objects
  for select to authenticated using (
    bucket_id = 'meeting-hub-posters'
    and exists (select 1 from public.meeting_hub_entries e where e.kind = 'awards' and e.poster_path = name)
  );
create policy "Meeting poster upload guard" on storage.objects
  as restrictive for insert to public with check (bucket_id <> 'meeting-hub-posters' or
    (case when current_user = 'authenticated' then
      (select public.meeting_hub_role()) in ('owner','admin','editor')
      and split_part(name, '/', 1) = (select auth.uid())::text else false end));
create policy "Staff upload meeting posters" on storage.objects
  for insert to authenticated with check (bucket_id = 'meeting-hub-posters');
create policy "Meeting posters cannot be overwritten by clients" on storage.objects
  as restrictive for update to public using (bucket_id <> 'meeting-hub-posters')
  with check (bucket_id <> 'meeting-hub-posters');
create policy "Meeting poster delete guard" on storage.objects
  as restrictive for delete to public using (bucket_id <> 'meeting-hub-posters' or
    (case when current_user = 'authenticated' then
      (select public.meeting_hub_role()) in ('owner','admin','editor')
      and split_part(name, '/', 1) = (select auth.uid())::text
      and not exists (select 1 from public.meeting_hub_entries e where e.poster_path = name)
      else false end));
create policy "Staff remove their unpublished meeting poster uploads" on storage.objects
  for delete to authenticated using (bucket_id = 'meeting-hub-posters');
create policy "Staff read their unpublished meeting poster uploads" on storage.objects
  for select to authenticated using (bucket_id = 'meeting-hub-posters'
    and (select public.meeting_hub_role()) in ('owner','admin','editor')
    and split_part(name, '/', 1) = (select auth.uid())::text);

commit;
