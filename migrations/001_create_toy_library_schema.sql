-- Toy Library schema with tight client access through RPC-only writes.

create extension if not exists "uuid-ossp";

create table if not exists members (
  id uuid primary key default uuid_generate_v4(),
  user_id text unique not null,
  name text not null,
  email text not null,
  phone text,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists toys (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  category text,
  age_range text,
  image_url text,
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  toy_id uuid not null references toys(id) on delete cascade,
  booked_at timestamptz not null default now(),
  due_date timestamptz not null,
  returned_at timestamptz,
  renewal_count integer not null default 0,
  last_reminded_at timestamptz,
  constraint bookings_renewal_count_check check (renewal_count between 0 and 2)
);

-- Enforce one active booking per toy.
create unique index if not exists idx_bookings_one_active_per_toy
  on bookings(toy_id)
  where returned_at is null;

create index if not exists idx_members_user_id on members(user_id);
create index if not exists idx_bookings_member_id on bookings(member_id);
create index if not exists idx_bookings_due_date on bookings(due_date);
create index if not exists idx_bookings_returned_at on bookings(returned_at);
create index if not exists idx_toys_available on toys(available);

alter table members enable row level security;
alter table toys enable row level security;
alter table bookings enable row level security;

-- Tight table access:
-- 1) Public can read toys only.
-- 2) No direct anon/authenticated read/write on members or bookings.
drop policy if exists "Disable all access to members by default" on members;
drop policy if exists "Allow service role access" on members;
drop policy if exists "Disable all access to bookings by default" on bookings;
drop policy if exists "Allow service role to manage bookings" on bookings;
drop policy if exists "Allow service role to manage toys" on toys;
drop policy if exists "Allow public read access to toys" on toys;
drop policy if exists toys_public_read on toys;
create policy toys_public_read
on toys
for select
to anon, authenticated
using (true);

-- RPC functions are security definer and become the only client path for member/bookings logic.
create or replace function public.lookup_member(p_user_id text)
returns table (
  member_id uuid,
  user_id text,
  name text,
  is_blocked boolean
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.user_id, m.name, m.is_blocked
  from members m
  where m.user_id = p_user_id;
$$;

create or replace function public.list_active_bookings(p_user_id text)
returns table (
  booking_id uuid,
  toy_id uuid,
  toy_name text,
  toy_category text,
  due_date timestamptz,
  renewal_count integer
)
language sql
security definer
set search_path = public
as $$
  select
    b.id as booking_id,
    b.toy_id,
    t.name as toy_name,
    t.category as toy_category,
    b.due_date,
    b.renewal_count
  from members m
  join bookings b on b.member_id = m.id
  join toys t on t.id = b.toy_id
  where m.user_id = p_user_id
    and b.returned_at is null
  order by b.due_date asc;
$$;

create or replace function public.create_booking(p_user_id text, p_toy_id uuid, p_pickup_date date default current_date)
returns table (
  booking_id uuid,
  due_date timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_is_blocked boolean;
  v_active_count integer;
  v_due_date timestamptz;
  v_booking_id uuid;
  v_available boolean;
begin
  select id, is_blocked into v_member_id, v_is_blocked
  from members
  where user_id = p_user_id;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_is_blocked then
    raise exception 'MEMBER_BLOCKED';
  end if;

  select count(*) into v_active_count
  from bookings
  where member_id = v_member_id
    and returned_at is null;

  if v_active_count >= 3 then
    raise exception 'MAX_ACTIVE_BOOKINGS';
  end if;

  select available into v_available
  from toys
  where id = p_toy_id
  for update;

  if v_available is null then
    raise exception 'TOY_NOT_FOUND';
  end if;

  if not v_available then
    raise exception 'TOY_UNAVAILABLE';
  end if;

  v_due_date := (p_pickup_date::timestamptz + interval '14 days');

  insert into bookings (member_id, toy_id, booked_at, due_date, renewal_count, returned_at)
  values (v_member_id, p_toy_id, now(), v_due_date, 0, null)
  returning id into v_booking_id;

  update toys
  set available = false
  where id = p_toy_id;

  return query
  select v_booking_id, v_due_date;
end;
$$;

create or replace function public.renew_booking(p_user_id text, p_booking_id uuid)
returns table (
  booking_id uuid,
  due_date timestamptz,
  renewal_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_row bookings%rowtype;
begin
  select id into v_member_id
  from members
  where user_id = p_user_id;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  select * into v_row
  from bookings
  where id = p_booking_id
    and member_id = v_member_id
    and returned_at is null
  for update;

  if v_row.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_row.renewal_count >= 2 then
    raise exception 'MAX_RENEWALS_REACHED';
  end if;

  update bookings
  set
    due_date = v_row.due_date + interval '14 days',
    renewal_count = v_row.renewal_count + 1
  where id = p_booking_id
  returning bookings.id, bookings.due_date, bookings.renewal_count
  into booking_id, due_date, renewal_count;

  return next;
end;
$$;

create or replace function public.return_booking(p_user_id text, p_booking_id uuid)
returns table (
  booking_id uuid,
  returned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_toy_id uuid;
begin
  select id into v_member_id
  from members
  where user_id = p_user_id;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  update bookings
  set returned_at = now()
  where id = p_booking_id
    and member_id = v_member_id
    and returned_at is null
  returning bookings.id, bookings.toy_id, bookings.returned_at
  into booking_id, v_toy_id, returned_at;

  if booking_id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  update toys
  set available = true
  where id = v_toy_id;

  return next;
end;
$$;

-- Lock down function execution and explicitly allow app roles.
revoke all on function public.lookup_member(text) from public;
revoke all on function public.list_active_bookings(text) from public;
revoke all on function public.create_booking(text, uuid, date) from public;
revoke all on function public.renew_booking(text, uuid) from public;
revoke all on function public.return_booking(text, uuid) from public;

grant execute on function public.lookup_member(text) to anon, authenticated;
grant execute on function public.list_active_bookings(text) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, date) to anon, authenticated;
grant execute on function public.renew_booking(text, uuid) to anon, authenticated;
grant execute on function public.return_booking(text, uuid) to anon, authenticated;

-- Optional helper for staff/service-role querying overdue loans.
create or replace view overdue_bookings as
select
  b.id,
  b.member_id,
  b.toy_id,
  b.due_date,
  b.last_reminded_at,
  t.name as toy_name,
  m.name as member_name,
  m.email as member_email,
  m.phone as member_phone
from bookings b
join toys t on t.id = b.toy_id
join members m on m.id = b.member_id
where b.due_date < now()
  and b.returned_at is null
order by b.due_date asc;
