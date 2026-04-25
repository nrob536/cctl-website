# Community Toy Library

A community-run toy lending library web application. Members can browse a toy catalogue and make bookings using only a user ID. Library staff manage everything through Supabase's built-in table editor. The system sends automated overdue reminder emails daily.

The frontend is plain HTML, CSS, and JavaScript — no framework, no build step, no tooling required. Anyone comfortable editing a web page can contribute.

---

## Table of contents

- [Project overview](#project-overview)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database schema](#database-schema)
- [Booking rules](#booking-rules)
- [Automated email reminders](#automated-email-reminders)
- [Deploying to Cloudflare Pages](#deploying-to-cloudflare-pages)
- [Managing the toy catalogue](#managing-the-toy-catalogue)
- [Contributing](#contributing)

---

## Project overview

This site has three kinds of users:

- **Members** — browse the toy catalogue, book toys using their user ID (no password required), and renew or return loans via a simple self-service page.
- **Admins / library staff** — manage the toy catalogue and member records directly in the Supabase table editor (no code required).
- **The system** — a scheduled Edge Function runs each morning, checks for overdue loans, and sends reminder emails via Resend.

### Key design principles

- **No build step.** The frontend is plain HTML files. Open them in a browser or deploy them directly — no Node.js, no bundler, no compilation required.
- **Minimal personal data.** Members provide only a name and email/phone for notifications. Bookings are identified by a generated user ID (e.g. `TL-4829`).
- **No paid infrastructure** except the domain name.
- **Non-technical maintainers welcome.** Library staff can update the toy catalogue and manage bookings through Supabase's web interface without touching any code or the GitHub repository.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Plain HTML + CSS + [Alpine.js](https://alpinejs.dev) | No build step, easy to edit, readable by non-developers |
| Interactivity | Alpine.js (via CDN `<script>` tag) | Lightweight, HTML-first, no tooling needed |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) | Free, auto-deploys from GitHub on every push |
| Database & API | [Supabase](https://supabase.com) | Open-source PostgreSQL, built-in table editor for non-devs |
| Auth | Supabase anonymous auth | Members get a generated user ID — no password needed |
| Email notifications | [Resend](https://resend.com) | Simple API, generous free tier (3,000 emails/month) |
| Scheduled jobs | Supabase Edge Functions + `pg_cron` | Daily overdue check with no external server |
| Domain | Your choice (e.g. Namecheap, Cloudflare Registrar) | The only paid component |

---

## Repository structure

```
toy-library/
├── index.html              # Home page
├── catalogue.html          # Browse all toys with category filter
├── toy.html                # Individual toy page + booking form (?id=xxx)
├── my-bookings.html        # Member self-service: view, renew, return
├── css/
│   └── style.css           # Shared styles
├── js/
│   ├── config.js           # Supabase URL and anon key (public values only)
│   ├── supabase.js         # Supabase client initialisation
│   ├── catalogue.js        # Toy catalogue fetch + filter logic
│   ├── toy.js              # Single toy page + booking logic
│   └── my-bookings.js      # Member bookings fetch + renew/return logic
├── images/                 # Toy photos (or use Supabase Storage)
├── supabase/
│   └── functions/
│       └── send-reminders/
│           └── index.ts    # Edge Function: daily overdue email job
└── README.md
```

> **Note:** There is no `package.json`, no `node_modules`, and no build command. The HTML files are the deployable output.

---

## Getting started

### Prerequisites

- A text editor (e.g. [VS Code](https://code.visualstudio.com))
- A [Supabase](https://supabase.com) account (free)
- A [Resend](https://resend.com) account (free)
- A [Cloudflare](https://cloudflare.com) account (free)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) — only needed to deploy Edge Functions

### 1. Clone the repository

```bash
git clone https://github.com/your-org/toy-library.git
cd toy-library
```

No `npm install` needed. Open any `.html` file directly in your browser to preview it, or use a simple local server:

```bash
# Python (available by default on most computers)
python3 -m http.server 8080
# Then visit http://localhost:8080
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run the schema from the [Database schema](#database-schema) section below.
3. Enable **anonymous sign-ins** under Authentication → Settings → Auth providers.
4. Copy your project URL and anon key from Settings → API.

### 3. Configure the Supabase client

Open `js/config.js` and fill in your values:

```js
// js/config.js — safe to commit, these are public read-only keys
const SUPABASE_URL  = 'https://your-project.supabase.co'
const SUPABASE_ANON = 'your-anon-key'
const LIBRARY_NAME  = 'Hamilton Community Toy Library'
const LIBRARY_EMAIL = 'hello@yourdomain.nz'
```

This file is loaded via a `<script>` tag in every HTML page before any other JS. The anon key is intentionally public — Row Level Security in Supabase controls exactly what it can access.

### 4. Set up Resend

1. Create an account at [resend.com](https://resend.com).
2. Verify your sending domain (the domain you'll use for the library's email address).
3. Copy your API key — this is stored as a Supabase secret and never appears in the frontend files.

---

## Environment variables

The frontend has **no environment variables** — configuration lives in `js/config.js` as plain public values.

The Resend API key is used only inside the Supabase Edge Function and is stored as a Supabase secret:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
```

Cloudflare Pages requires no environment variables for this project since there is no build step.

---

## Database schema

Run this SQL in the Supabase SQL Editor to create all required tables.

```sql
-- Members table
create table members (
  id           uuid primary key default gen_random_uuid(),
  user_id      text unique not null,   -- e.g. TL-4829, shown to the member
  name         text not null,
  email        text,
  phone        text,
  is_blocked   boolean default false,  -- blocked if overdue loans outstanding
  created_at   timestamptz default now()
);

-- Toys table
create table toys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  category     text,
  age_range    text,                   -- e.g. "3–6 years"
  image_url    text,
  available    boolean default true,
  created_at   timestamptz default now()
);

-- Bookings table
create table bookings (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid references members(id),
  toy_id           uuid references toys(id),
  booked_at        timestamptz default now(),
  due_date         timestamptz not null,
  returned_at      timestamptz,
  renewal_count    int default 0,
  last_reminded_at timestamptz
);

-- Enable Row Level Security
alter table members  enable row level security;
alter table toys     enable row level security;
alter table bookings enable row level security;

-- RLS policies
create policy "Members can view their own record"
  on members for select using (auth.uid()::text = id::text);

create policy "Anyone can view toys"
  on toys for select using (true);

create policy "Members can view their own bookings"
  on bookings for select using (member_id = auth.uid());

create policy "Members can insert their own bookings"
  on bookings for insert with check (member_id = auth.uid());

-- Required RPC functions used by the frontend
-- 1) Lookup a member by user_id
create or replace function public.lookup_member(p_user_id text)
returns table (
  id uuid,
  user_id text,
  name text,
  email text,
  phone text,
  is_blocked boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.user_id, m.name, m.email, m.phone, m.is_blocked, m.created_at
  from public.members m
  where upper(trim(m.user_id)) = upper(trim(p_user_id))
  limit 1;
$$;

-- 2) Create a booking (enforces rules server-side)
create or replace function public.create_booking(
  p_user_id text,
  p_toy_id uuid,
  p_pickup_date date
)
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
  v_active_count int;
  v_available boolean;
  v_booking_id uuid;
  v_due_date timestamptz;
begin
  select m.id, m.is_blocked
  into v_member_id, v_is_blocked
  from public.members m
  where upper(trim(m.user_id)) = upper(trim(p_user_id))
  limit 1;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_is_blocked then
    raise exception 'MEMBER_BLOCKED';
  end if;

  select count(*)
  into v_active_count
  from public.bookings b
  where b.member_id = v_member_id
    and b.returned_at is null;

  if v_active_count >= 3 then
    raise exception 'MAX_ACTIVE_BOOKINGS';
  end if;

  select t.available
  into v_available
  from public.toys t
  where t.id = p_toy_id;

  if v_available is null or v_available = false then
    raise exception 'TOY_UNAVAILABLE';
  end if;

  v_due_date := (p_pickup_date::timestamptz + interval '14 days');

  insert into public.bookings (member_id, toy_id, due_date)
  values (v_member_id, p_toy_id, v_due_date)
  returning id into v_booking_id;

  update public.toys
  set available = false
  where id = p_toy_id;

  return query
  select v_booking_id, v_due_date;
end;
$$;

-- 3) List active bookings for a user
create or replace function public.list_active_bookings(p_user_id text)
returns table (
  booking_id uuid,
  toy_id uuid,
  toy_name text,
  toy_category text,
  due_date timestamptz,
  renewal_count int
)
language sql
security definer
set search_path = public
as $$
  select
    b.id as booking_id,
    t.id as toy_id,
    t.name as toy_name,
    t.category as toy_category,
    b.due_date,
    b.renewal_count
  from public.bookings b
  join public.members m on m.id = b.member_id
  join public.toys t on t.id = b.toy_id
  where upper(trim(m.user_id)) = upper(trim(p_user_id))
    and b.returned_at is null
  order by b.due_date asc;
$$;

-- 4) Renew a booking
create or replace function public.renew_booking(
  p_user_id text,
  p_booking_id uuid
)
returns table (
  booking_id uuid,
  due_date timestamptz,
  renewal_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_new_due_date timestamptz;
  v_new_renewal_count int;
begin
  select m.id
  into v_member_id
  from public.members m
  where upper(trim(m.user_id)) = upper(trim(p_user_id))
  limit 1;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  update public.bookings b
  set
    due_date = b.due_date + interval '14 days',
    renewal_count = b.renewal_count + 1
  where b.id = p_booking_id
    and b.member_id = v_member_id
    and b.returned_at is null
    and b.renewal_count < 2
  returning b.due_date, b.renewal_count
  into v_new_due_date, v_new_renewal_count;

  if v_new_due_date is null then
    raise exception 'MAX_RENEWALS_REACHED';
  end if;

  return query
  select p_booking_id, v_new_due_date, v_new_renewal_count;
end;
$$;

-- 5) Return a booking
create or replace function public.return_booking(
  p_user_id text,
  p_booking_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_toy_id uuid;
begin
  select m.id
  into v_member_id
  from public.members m
  where upper(trim(m.user_id)) = upper(trim(p_user_id))
  limit 1;

  if v_member_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  update public.bookings b
  set returned_at = now()
  where b.id = p_booking_id
    and b.member_id = v_member_id
    and b.returned_at is null
  returning b.toy_id into v_toy_id;

  if v_toy_id is not null then
    update public.toys
    set available = true
    where id = v_toy_id;
  end if;
end;
$$;

grant execute on function public.lookup_member(text) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, date) to anon, authenticated;
grant execute on function public.list_active_bookings(text) to anon, authenticated;
grant execute on function public.renew_booking(text, uuid) to anon, authenticated;
grant execute on function public.return_booking(text, uuid) to anon, authenticated;

-- Optional: force PostgREST schema cache refresh immediately
notify pgrst, 'reload schema';
```

---

## Booking rules

These rules are enforced server-side via Supabase database functions and cannot be bypassed through the frontend.

| Rule | Default value | Where enforced |
|---|---|---|
| Max toys per active booking | 3 | Postgres function called before insert |
| Max consecutive renewals | 2 | `renewal_count` column check |
| Standard loan period | 14 days | Set on `due_date` at booking time |
| Blocked members cannot book | Yes | `is_blocked` flag checked before insert |
| One booking per toy at a time | Yes | `available` flag set to false on booking |

To change a default value, update the relevant Postgres function in the Supabase SQL Editor. No frontend code changes are needed for rule adjustments.

---

## Automated email reminders

A Supabase Edge Function (`supabase/functions/send-reminders/index.ts`) runs on a daily schedule using `pg_cron`. It:

1. Queries for all bookings where `due_date < NOW()` and `returned_at IS NULL`.
2. Skips any booking where `last_reminded_at` is within the last 24 hours (to avoid repeat emails).
3. Calls the Resend API once per overdue member with a plain-language reminder.
4. Updates `last_reminded_at` on each processed booking.

### Deploying the Edge Function

```bash
# Install the Supabase CLI (Linux — choose one method)
# Option A: Homebrew
brew install supabase/tap/supabase

# Option B: direct binary download (no package manager required)
# Replace X.Y.Z with the latest version from https://github.com/supabase/cli/releases
wget https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz
tar -xzf supabase_linux_amd64.tar.gz
sudo mv supabase /usr/local/bin/

# macOS
brew install supabase/tap/supabase

# Windows (Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Log in and link to your project
supabase login
supabase link --project-ref your-project-ref

# Store the Resend API key as a secret
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx

# Deploy the function
supabase functions deploy send-reminders
```

### Setting up the daily schedule

Run this in the Supabase SQL Editor to fire the function every morning at 8am NZST (UTC+12, which is 8pm UTC the previous evening):

```sql
select cron.schedule(
  'daily-overdue-reminders',
  '0 20 * * *',
  $$
    select net.http_post(
      url     := 'https://your-project.supabase.co/functions/v1/send-reminders',
      headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
    );
  $$
);
```

---

## Deploying to Cloudflare Pages

Because there is no build step, deployment is simply pointing Cloudflare at the GitHub repository.

1. Push the repository to GitHub.
2. Log in to [Cloudflare Pages](https://pages.cloudflare.com) and click **Create a project**.
3. Connect your GitHub repository.
4. Leave the build command **blank** and set the output directory to `/` (the repo root).
5. Every push to `main` will automatically redeploy the site.

Point your domain's DNS to Cloudflare and assign the custom domain in Pages settings.

---

## Managing the toy catalogue

Library staff who are not comfortable with code can manage everything through the **Supabase table editor** at [supabase.com](https://supabase.com) — it works like a spreadsheet.

- **Add a toy** — open the `toys` table, click Insert, fill in the fields.
- **Mark a toy unavailable** — set `available` to `false`.
- **View all current loans** — open the `bookings` table, filter by `returned_at IS NULL`.
- **Block a member** — set `is_blocked` to `true` on their record in the `members` table.
- **Process a return** — set `returned_at` to today's date on the booking, and set `available` to `true` on the toy.

No coding or GitHub access required for any of these tasks.

---

## Contributing

Pull requests are welcome. For significant changes please open a GitHub Issue first to discuss the approach.

### Frontend changes

Edit the `.html`, `.css`, or `js/` files directly — there is no build step. To preview changes locally:

```bash
python3 -m http.server 8080
```

Alpine.js is loaded from a CDN `<script>` tag — no installation needed. See the [Alpine.js docs](https://alpinejs.dev/start-here) for syntax help. Keep in mind:

- Each HTML page is self-contained — shared logic lives in the `js/` files loaded via `<script>` tags.
- Alpine.js handles interactivity (filtering, form state, showing/hiding elements). Complex data fetching lives in the corresponding `js/` file.
- Avoid introducing a build step or bundler — the goal is that anyone with a text editor can make changes.

### Edge Function changes

The Supabase Edge Function is written in TypeScript and runs in Deno. To test it locally:

```bash
supabase functions serve send-reminders
```

See the [Supabase Edge Functions docs](https://supabase.com/docs/guides/functions) for more detail.

---

*Built with love for the community of Carterton, NZ*
