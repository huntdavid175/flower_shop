-- Storage buckets, declared rather than clicked.
--
-- `voice-messages` already exists because it was created through the API during
-- development, which means a fresh environment would not have it and the voice
-- feature would fail on first upload with nothing to explain why. Both buckets
-- are defined here so the storage layer can be rebuilt from the repository.
--
-- `on conflict do nothing` keeps this safe to re-run against the live project,
-- where one of the two is already there.

-- Product photography. Public: these are shop images on a public catalogue, and
-- signing every one of them would mean a round trip per thumbnail.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB; a bouquet photograph has no business being larger
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

-- Voice recordings. Private, and deliberately so: each one is a personal
-- message to a named recipient and is reachable only through a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-messages',
  'voice-messages',
  false,
  10485760, -- 10 MB, matching the limit the upload endpoint enforces
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/x-m4a']
)
on conflict (id) do nothing;

-- Anyone may read product images; nobody may write them from a browser.
-- Uploads go through the admin, which holds the secret key and bypasses this.
drop policy if exists "product images are public" on storage.objects;
create policy "product images are public"
  on storage.objects for select
  using (bucket_id = 'product-images');
