-- Messages sent from the contact form.
--
-- A contact form that validates and then discards what someone wrote is worse
-- than no form at all: the sender believes they have reached the shop. This
-- gives them somewhere to land.

create table if not exists public.contact_messages (
  id                uuid primary key default gen_random_uuid(),

  name              text not null,
  email             text not null,
  phone             text,
  message           text not null,

  -- Ticked the "news and offers" box. Stored separately from the message
  -- because it is a standing permission, not part of what they asked.
  marketing_consent boolean not null default false,

  -- Set when a person has actually dealt with it, so the admin can show what
  -- is still outstanding rather than an ever-growing list.
  handled_at        timestamptz,

  created_at        timestamptz not null default now()
);

comment on table public.contact_messages is
  'Enquiries from the public contact form. Written only by the server.';

-- Newest first is the only order this is ever read in.
create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);

-- Outstanding enquiries, which is what the shop actually works from.
create index if not exists contact_messages_unhandled_idx
  on public.contact_messages (created_at desc)
  where handled_at is null;

/*
 * Row-level security on, with no policies at all.
 *
 * That is deliberate rather than unfinished: no policy means no access through
 * the publishable key, so a browser can neither read other people's enquiries
 * nor forge one. The server writes with the secret key, which bypasses RLS —
 * so the only way to reach this table is through our own endpoint.
 */
alter table public.contact_messages enable row level security;
