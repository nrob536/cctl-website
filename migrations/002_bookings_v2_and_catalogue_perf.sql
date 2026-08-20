-- Performance and bookings v2 rollout
-- 1) Add category-first catalogue query helpers.
-- 2) Introduce bookings_v2 with numeric Toy ID snapshot support.

-- Helpful indexes for read-heavy catalogue usage.
create index if not exists idx_toys_category_name on toys(category, name);
create index if not exists idx_toys_public_id on toys("ID");
create unique index if not exists idx_toys_id_unique on toys(id);

drop function if exists public.get_balanced_toys(integer);

create or replace function public.get_balanced_toys(
  p_limit integer default 25,
  p_category text default null,
  p_default_category text default null
)
returns table (
  id uuid,
  toy_public_id integer,
  name text,
  description text,
  category text,
  age_range text,
  image_url text,
  available boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with normalized as (
    select
      t.id,
      case
        when trim(coalesce(t."ID"::text, '')) ~ '^\d+$' then trim(t."ID"::text)::integer
        else null
      end as toy_public_id,
      t.name,
      t.description,
      coalesce(nullif(trim(t.category), ''), 'Uncategorized') as category,
      t.age_range,
      t.image_url,
      t.available,
      t.created_at
    from toys t
  ),
  selected_category as (
    select
      coalesce(
        nullif(trim(p_category), ''),
        (
          select c.category
          from (
            select distinct n.category
            from normalized n
          ) c
          where c.category = nullif(trim(p_default_category), '')
          limit 1
        ),
        (
          select n.category
          from normalized n
          order by n.category asc
          limit 1
        )
      ) as category
  )
  select
    n.id,
    n.toy_public_id,
    n.name,
    n.description,
    n.category,
    n.age_range,
    n.image_url,
    n.available,
    n.created_at
  from normalized n
  cross join selected_category s
  where n.category = s.category
  order by n.available desc, n.name asc, n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;

create or replace function public.list_toy_categories()
returns table (
  category text,
  is_default boolean
)
language sql
security definer
set search_path = public
as $$
  with normalized_categories as (
    select distinct coalesce(nullif(trim(t.category), ''), 'Uncategorized') as category
    from toys t
  )
  select
    c.category,
    (row_number() over (order by c.category asc) = 1) as is_default
  from normalized_categories c
  order by c.category asc;
$$;

revoke all on function public.get_balanced_toys(integer, text, text) from public;
revoke all on function public.list_toy_categories() from public;

grant execute on function public.get_balanced_toys(integer, text, text) to anon, authenticated;
grant execute on function public.list_toy_categories() to anon, authenticated;

create table if not exists bookings_v2 (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  toy_id uuid not null references toys(id) on delete cascade,
  toy_public_id integer not null,
  booked_at timestamptz not null default now(),
  due_date timestamptz not null,
  returned_at timestamptz,
  renewal_count integer not null default 0,
  last_reminded_at timestamptz,
  constraint bookings_v2_renewal_count_check check (renewal_count between 0 and 2)
);

create unique index if not exists idx_bookings_v2_one_active_per_toy
  on bookings_v2(toy_id)
  where returned_at is null;

create index if not exists idx_bookings_v2_member_id on bookings_v2(member_id);
create index if not exists idx_bookings_v2_due_date on bookings_v2(due_date);
create index if not exists idx_bookings_v2_returned_at on bookings_v2(returned_at);
create index if not exists idx_bookings_v2_toy_public_id on bookings_v2(toy_public_id);

alter table bookings_v2 enable row level security;

create or replace function public.list_active_bookings_v2(p_user_id text)
returns table (
  booking_id uuid,
  toy_id uuid,
  toy_public_id integer,
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
    b.toy_public_id,
    t.name as toy_name,
    t.category as toy_category,
    b.due_date,
    b.renewal_count
  from members m
  join bookings_v2 b on b.member_id = m.id
  join toys t on t.id = b.toy_id
  where m.user_id = p_user_id
    and b.returned_at is null
  order by b.due_date asc;
$$;

create or replace function public.create_booking_v2(p_user_id text, p_toy_id uuid, p_pickup_date date default current_date)
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
  v_toy_public_id integer;
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
  from bookings_v2
  where member_id = v_member_id
    and returned_at is null;

  if v_active_count >= 3 then
    raise exception 'MAX_ACTIVE_BOOKINGS';
  end if;

  select
    available,
    case
      when trim(coalesce("ID"::text, '')) ~ '^\d+$' then trim("ID"::text)::integer
      else null
    end
  into v_available, v_toy_public_id
  from toys
  where id = p_toy_id
  for update;

  if v_available is null then
    raise exception 'TOY_NOT_FOUND';
  end if;

  if v_toy_public_id is null then
    raise exception 'TOY_PUBLIC_ID_MISSING';
  end if;

  if not v_available then
    raise exception 'TOY_UNAVAILABLE';
  end if;

  v_due_date := (p_pickup_date::timestamptz + interval '14 days');

  insert into bookings_v2 (member_id, toy_id, toy_public_id, booked_at, due_date, renewal_count, returned_at)
  values (v_member_id, p_toy_id, v_toy_public_id, now(), v_due_date, 0, null)
  returning id into v_booking_id;

  update toys
  set available = false
  where id = p_toy_id;

  return query
  select v_booking_id, v_due_date;
end;
$$;

create or replace function public.renew_booking_v2(p_user_id text, p_booking_id uuid)
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
  v_row bookings_v2%rowtype;
begin
  select id into v_member_id
  from members
  where user_id = p_user_id;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  select * into v_row
  from bookings_v2
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

  update bookings_v2
  set
    due_date = v_row.due_date + interval '14 days',
    renewal_count = v_row.renewal_count + 1
  where id = p_booking_id
  returning bookings_v2.id, bookings_v2.due_date, bookings_v2.renewal_count
  into booking_id, due_date, renewal_count;

  return next;
end;
$$;

create or replace function public.return_booking_v2(p_user_id text, p_booking_id uuid)
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

  update bookings_v2
  set returned_at = now()
  where id = p_booking_id
    and member_id = v_member_id
    and returned_at is null
  returning bookings_v2.id, bookings_v2.toy_id, bookings_v2.returned_at
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

revoke all on function public.list_active_bookings_v2(text) from public;
revoke all on function public.create_booking_v2(text, uuid, date) from public;
revoke all on function public.renew_booking_v2(text, uuid) from public;
revoke all on function public.return_booking_v2(text, uuid) from public;

grant execute on function public.list_active_bookings_v2(text) to anon, authenticated;
grant execute on function public.create_booking_v2(text, uuid, date) to anon, authenticated;
grant execute on function public.renew_booking_v2(text, uuid) to anon, authenticated;
grant execute on function public.return_booking_v2(text, uuid) to anon, authenticated;
