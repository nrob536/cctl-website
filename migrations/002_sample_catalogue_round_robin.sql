-- Improve balanced catalogue sampling and ordered reads.
create index if not exists idx_toys_category_name on toys(category, name);

create or replace function public.sample_toys_round_robin(p_limit integer default 25)
returns table (
  id uuid,
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
  with normalized_toys as (
    select
      t.id,
      t.name,
      t.description,
      coalesce(nullif(trim(t.category), ''), 'Uncategorised') as category,
      t.age_range,
      t.image_url,
      t.available,
      t.created_at
    from toys t
    where t.available is true
  ),
  ranked_categories as (
    select category, row_number() over (order by category) as category_rank
    from (select distinct category from normalized_toys) categories
  ),
  ranked_toys as (
    select
      t.*,
      rc.category_rank,
      row_number() over (partition by t.category order by t.name, t.id) as toy_rank
    from normalized_toys t
    join ranked_categories rc using (category)
  )
  select id, name, description, category, age_range, image_url, available, created_at
  from ranked_toys
  order by toy_rank, category_rank, name, id
  limit greatest(p_limit, 0);
$$;

revoke all on function public.sample_toys_round_robin(integer) from public;
grant execute on function public.sample_toys_round_robin(integer) to anon, authenticated;