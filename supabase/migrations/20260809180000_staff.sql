-- Who is allowed into the admin.
--
-- Membership is a row here, not a flag on the auth user. Supabase's `auth.users`
-- table will happily hold a customer account one day; being able to sign in must
-- never be the same thing as being able to read every order in the shop.
--
-- Accounts are created from the Supabase dashboard (Authentication → Users) and
-- then granted access by inserting a row here. There is deliberately no signup
-- page: a public one on an admin is a standing invitation.

create table if not exists public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text,
  role       text not null default 'staff' check (role in ('staff', 'owner')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.staff is
  'Grants admin access. A row here is what lets an authenticated user into /admin.';

alter table public.staff enable row level security;

-- Signed-in staff may read their own row and nothing else. Every server-side
-- check uses the secret key and bypasses this; the policy exists so that a
-- browser holding a valid session cannot enumerate the team.
drop policy if exists "staff read self" on public.staff;
create policy "staff read self"
  on public.staff for select
  using (auth.uid() = user_id);

-- No insert, update or delete policy: membership changes only through the
-- dashboard or a server holding the secret key.

create index if not exists staff_active_idx
  on public.staff (user_id) where is_active;

-- The admin lists orders by status and works through them by delivery date.
-- Without these, every page load is a sequential scan once the shop is busy.
create index if not exists orders_status_created_idx
  on public.orders (status, created_at desc);

create index if not exists orders_delivery_date_idx
  on public.orders (delivery_date)
  where status in ('paid', 'preparing', 'out_for_delivery');
