-- La Fleur — seed data
--
-- Mirrors src/lib/catalog.ts so the site behaves identically once it reads from
-- the database instead of that array. Prices are integer pesewas.
--
-- Idempotent: safe to run repeatedly. Uses on conflict on the natural keys
-- rather than fixed uuids, so re-seeding updates rather than duplicates.
--
-- NOTE: product names, prices and copy came from the template and are
-- placeholders. The shop's real catalog replaces them.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

insert into public.categories (slug, name, image_url, sort_order) values
  ('flowers',  'Flowers',  '/images/flower1.jpg',   1),
  ('vases',    'Vases',    '/images/product5.avif',     2),
  ('plants',   'Plants',   '/images/product7.avif',   3),
  ('pottery',  'Pottery',  '/images/product6.avif',  4),
  ('candles',  'Candles',  '/images/product8.avif',  5),
  ('seeds',    'Seeds',    '/images/seeds.avif',    6)
on conflict (slug) do update
  set name = excluded.name,
      image_url = excluded.image_url,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------------
-- Delivery zones
--
-- Placeholder Accra-area zones with placeholder fees. The shop must replace
-- these with the areas it actually covers and what it actually charges.
-- ---------------------------------------------------------------------------

insert into public.delivery_zones (name, fee_pesewas, sort_order) values
  ('Accra Central',            2500, 1),
  ('East Legon & Airport',     3500, 2),
  ('Tema & Spintex',           4500, 3),
  ('Greater Accra — outskirts', 6000, 4)
on conflict (name) do update
  set fee_pesewas = excluded.fee_pesewas,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

insert into public.products
  (slug, name, sku, image_url, category_id, base_price_pesewas, compare_price_pesewas, description, sort_order)
values
  ('rose-elegance',   'Rose Elegance',   'FS-RE-001', '/images/flower1.jpg',
     (select id from public.categories where slug = 'flowers'), 5900, 9700,
     'Ranunculus in soft blush and cream, wrapped in matte rose paper and finished with a satin ribbon.', 1),

  ('carnation-love',  'Carnation Love',  'FS-CL-002', '/images/flower2.jpg',
     (select id from public.categories where slug = 'flowers'), 7900, 9700,
     'Deep crimson roses spiralled with ruscus, sleeved in charcoal and burgundy. Bold and unmistakably romantic.', 2),

  ('lily-grace',      'Lily Grace',      'FS-LG-003', '/images/flower3.jpg',
     (select id from public.categories where slug = 'flowers'), 8900, null,
     'Blue and white hydrangea gathered with broad green foliage in a soft champagne wrap.', 3),

  ('jasmine-whisper', 'Jasmine Whisper', 'FS-JW-004', '/images/flower4.jpg',
     (select id from public.categories where slug = 'flowers'), 2400, 8900,
     'Fresh lilac stems with glossy foliage, wrapped in lavender and tied with a matching ribbon.', 4),

  ('natures-touch',   'Nature’s Touch',  'FS-NT-005', '/images/product1.jpg',
     (select id from public.categories where slug = 'vases'), 2300, 7700,
     'Sweet pea and delicate blossom branches arranged across a pair of matte ceramic vases.', 5),

  ('iris-delight',    'Iris Delight',    'FS-ID-006', '/images/product2.jpg',
     (select id from public.categories where slug = 'flowers'), 5300, 5700,
     'Yellow tulips in a sculptural ring vase — simple, bright and cheerful.', 6),

  ('hibiscus-flame',  'Hibiscus Flame',  'FS-HF-007', '/images/product3.jpg',
     (select id from public.categories where slug = 'flowers'), 4500, 4800,
     'Scabiosa, carnation and green chrysanthemum in a low stone bowl, styled tall and airy.', 7),

  ('velvet-petals',   'Velvet Petals',   'FS-VP-008', '/images/product4.jpg',
     (select id from public.categories where slug = 'flowers'), 6500, null,
     'Muscari and craspedia in an amber glass bud vase, set against warm ochre and terracotta.', 8),

  ('eterna-vase',     'Eterna Vase',     'FS-EV-009', '/images/product5.avif',
     (select id from public.categories where slug = 'vases'), 2400, 3700,
     'A pair of glazed ceramic vases in cream and pale blue. Sold as a set.', 9),

  ('heritage-clay',   'Heritage Clay',   'FS-HC-010', '/images/product6.avif',
     (select id from public.categories where slug = 'pottery'), 2400, 3600,
     'Hand-thrown stoneware in warm earth tones, with a smaller companion pot.', 10),

  ('green-petals',    'Green Petals',    'FS-GP-011', '/images/product7.avif',
     (select id from public.categories where slug = 'plants'), 6500, 8900,
     'A young monstera in a mint glazed pot — easy to care for and hard to kill.', 11),

  ('glownest-candle', 'GlowNest Candle', 'FS-GC-012', '/images/product8.avif',
     (select id from public.categories where slug = 'candles'), 2400, 3600,
     'Bergamot and thyme soy candle in a white ceramic vessel. Around 45 hours of burn time.', 12)
on conflict (slug) do update
  set name = excluded.name,
      sku = excluded.sku,
      image_url = excluded.image_url,
      category_id = excluded.category_id,
      base_price_pesewas = excluded.base_price_pesewas,
      compare_price_pesewas = excluded.compare_price_pesewas,
      description = excluded.description,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------------
-- Size variants
--
-- Every bouquet gets three sizes. Small sits at the product's base price;
-- medium and large step up. The steps are placeholders — the shop sets real
-- prices per arrangement, which is exactly why price lives on the variant
-- rather than being a multiplier in code.
-- ---------------------------------------------------------------------------

insert into public.product_variants (product_id, label, price_pesewas, sort_order)
select p.id, v.label, p.base_price_pesewas + v.uplift, v.sort_order
from public.products p
cross join (values
  ('Small',  0,    1),
  ('Medium', 2000, 2),
  ('Large',  4500, 3)
) as v(label, uplift, sort_order)
on conflict (product_id, label) do update
  set price_pesewas = excluded.price_pesewas,
      sort_order = excluded.sort_order;
