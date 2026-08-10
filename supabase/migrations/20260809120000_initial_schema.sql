-- Floriva — initial schema
--
-- Conventions used throughout:
--
--   Money is a plain integer count of PESEWAS (GHS minor units). GHS 250.00 is
--   25000. Paystack requires minor units, and integers keep rounding errors out
--   of prices entirely. Never numeric, never float.
--
--   Row-level security is enabled on every table. In Supabase a table without
--   RLS is readable and writable by anyone holding the publishable key, which
--   ships in the browser — so RLS off is the same as public. Catalog tables get
--   an explicit public read policy; everything order-related gets none at all
--   and is reachable only through the server's secret key, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- search_path is pinned empty so the function cannot be hijacked by a schema
-- earlier on someone else's search path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  image_url   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  sku                   text unique,
  description           text,
  -- Per-product delivery note shown on the product page. Nullable so the shop
  -- can fall back to a site-wide default rather than repeating itself.
  delivery_information  text,
  image_url             text,
  category_id           uuid references public.categories (id) on delete set null,

  -- Price shown when a product has no variants, and the basis for the
  -- strike-through "was" price.
  base_price_pesewas    integer not null check (base_price_pesewas >= 0),
  compare_price_pesewas integer check (compare_price_pesewas >= 0),

  is_active             boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);
create index products_active_sort_idx on public.products (is_active, sort_order);

-- Size options. Each carries its own price rather than a multiplier, so the
-- shop can price a large bouquet at whatever it is actually worth.
create table public.product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  label          text not null,
  price_pesewas  integer not null check (price_pesewas >= 0),
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, label)
);

create index product_variants_product_id_idx on public.product_variants (product_id);


-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

create table public.delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  -- Unique so re-running the seed updates the fee rather than adding a second
  -- zone with the same name — duplicates here would show twice at checkout.
  name        text not null unique,
  fee_pesewas integer not null check (fee_pesewas >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- A single table covers both baskets-in-progress and real orders. `draft` rows
-- are created when a visitor reaches the message step, so the message text and
-- any audio have something to hang off before payment exists. The Paystack
-- webhook moves the row to `paid`; abandoned drafts are swept by
-- public.purge_stale_drafts().
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),

  -- Human-facing order number, also sent to Paystack as the transaction
  -- reference. Unique so a webhook retry cannot create a second order.
  reference              text not null unique,

  status                 text not null default 'draft'
                           check (status in (
                             'draft',
                             'pending_payment',
                             'paid',
                             'preparing',
                             'out_for_delivery',
                             'delivered',
                             'cancelled',
                             'refunded'
                           )),

  -- Ties a draft to the browser that started it. Cleared once paid.
  session_token          text,

  -- Buyer (who pays)
  buyer_name             text,
  buyer_email            text,
  buyer_phone            text,

  -- Recipient (who receives) — deliberately separate: most orders are gifts.
  recipient_name         text,
  recipient_phone        text,
  delivery_address       text,
  delivery_notes         text,

  delivery_zone_id       uuid references public.delivery_zones (id) on delete restrict,
  delivery_date          date,
  delivery_slot          text,

  -- Money. Snapshotted at checkout so later price or zone-fee changes never
  -- alter what an existing order says it charged.
  subtotal_pesewas       integer not null default 0 check (subtotal_pesewas >= 0),
  delivery_fee_pesewas   integer not null default 0 check (delivery_fee_pesewas >= 0),
  total_pesewas          integer not null default 0 check (total_pesewas >= 0),
  currency               text not null default 'GHS',

  paystack_reference     text,
  paid_at                timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index orders_status_created_idx on public.orders (status, created_at desc);
create index orders_session_token_idx on public.orders (session_token)
  where session_token is not null;
create index orders_delivery_date_idx on public.orders (delivery_date)
  where delivery_date is not null;

create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,

  -- References kept for reporting, but nulled rather than cascading if a
  -- product is ever deleted: an order must survive its catalog.
  product_id           uuid references public.products (id) on delete set null,
  variant_id           uuid references public.product_variants (id) on delete set null,

  -- Snapshots. What the customer saw and agreed to pay, frozen at purchase.
  -- Without these, editing a price would silently rewrite past orders.
  product_name         text not null,
  variant_label        text,
  unit_price_pesewas   integer not null check (unit_price_pesewas >= 0),

  quantity             integer not null check (quantity > 0 and quantity <= 20),
  line_total_pesewas   integer not null check (line_total_pesewas >= 0),

  created_at           timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);


-- ---------------------------------------------------------------------------
-- Gift messages
-- ---------------------------------------------------------------------------

-- One row per message. order_item_id null means "one message for the whole
-- order"; set means the message belongs to that single bouquet.
create table public.order_messages (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  order_item_id  uuid references public.order_items (id) on delete cascade,

  body           text check (char_length(body) <= 2000),
  -- Whether the words were typed or produced with AI assistance. Recorded for
  -- the shop's own understanding, not shown to the recipient.
  body_source    text not null default 'typed'
                   check (body_source in ('typed', 'ai_assisted')),

  voice_kind     text not null default 'none'
                   check (voice_kind in ('none', 'recorded', 'uploaded', 'tts')),
  -- Path within the Supabase Storage bucket, not a public URL: the object is
  -- served through a signed URL so audio cannot be enumerated.
  audio_path     text,
  audio_mime     text,
  audio_seconds  integer check (audio_seconds >= 0),
  tts_voice_id   text,

  -- Unguessable token behind the QR code (/m/<token>). Must not be derivable
  -- from the order — otherwise anyone could walk the sequence and listen to
  -- other people's private messages. Generated by the application with a CSPRNG.
  play_token     text not null unique check (char_length(play_token) >= 24),
  played_at      timestamptz,
  play_count     integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index order_messages_order_id_idx on public.order_messages (order_id);


-- ---------------------------------------------------------------------------
-- Newsletter
-- ---------------------------------------------------------------------------

create table public.newsletter_subscribers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  unsubscribed_at timestamptz,
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger order_messages_set_updated_at
  before update on public.order_messages
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

-- Drops abandoned baskets and, by cascade, their messages. Audio objects in
-- storage must be removed alongside this — the database cannot do that itself,
-- so the caller is responsible for deleting the returned audio paths.
create or replace function public.purge_stale_drafts(older_than interval default interval '7 days')
returns table (deleted_order_id uuid, audio_path text)
language sql
-- Deliberately NOT security definer: this is called server-side with the secret
-- key, which already bypasses RLS. Granting it definer rights would hand a
-- delete-everything function to any role that could reach it.
set search_path = ''
as $$
  with doomed as (
    select id from public.orders
    where status = 'draft'
      and created_at < now() - older_than
  ),
  paths as (
    select m.order_id, m.audio_path
    from public.order_messages m
    join doomed d on d.id = m.order_id
    where m.audio_path is not null
  ),
  removed as (
    delete from public.orders
    where id in (select id from doomed)
    returning id
  )
  select removed.id, paths.audio_path
  from removed
  left join paths on paths.order_id = removed.id;
$$;


-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.categories             enable row level security;
alter table public.products               enable row level security;
alter table public.product_variants       enable row level security;
alter table public.delivery_zones         enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.order_messages         enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- Catalog: readable by anyone, but only the rows the shop has published.
-- No insert/update/delete policies exist, so writes are impossible with the
-- publishable key regardless of what the browser sends.
create policy "public reads active categories"
  on public.categories for select
  to anon, authenticated
  using (is_active);

create policy "public reads active products"
  on public.products for select
  to anon, authenticated
  using (is_active);

create policy "public reads active variants"
  on public.product_variants for select
  to anon, authenticated
  using (is_active);

create policy "public reads active delivery zones"
  on public.delivery_zones for select
  to anon, authenticated
  using (is_active);

-- Orders, items, messages and subscribers deliberately have NO policies.
-- With RLS enabled and no policy, every request through the publishable key is
-- denied. All access runs server-side through the secret key, which bypasses
-- RLS — including the QR playback page, which looks a message up by token on
-- the server rather than exposing the table to the browser.
