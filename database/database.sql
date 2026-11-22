-- =====================================================================
--  Hirfa - Handmade Products Marketplace
--  INT424 Final Project - Supabase (PostgreSQL) database script
--
--  How to use:
--    Supabase Dashboard -> SQL Editor -> New query -> paste this whole
--    file -> Run.  Running it again resets every table and sample row.
--
--  Contents
--    0. Reset
--    1. Tables (category, product, customers, orders, order_items, reviews)
--    2. Indexes
--    3. View used by the shop and smart search (product_catalog)
--    4. Functions and triggers (business rules enforced by the database)
--    5. Row Level Security (RLS) policies
--    6. Privileges (which columns each role may touch)
--    7. Analytics function for the dashboard
--    8. Sample data
--    9. Useful queries (admin account, smart search examples)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Reset
-- ---------------------------------------------------------------------
drop trigger  if exists on_auth_user_created on auth.users;
drop view     if exists public.product_catalog;
drop table    if exists public.reviews     cascade;
drop table    if exists public.order_items cascade;
drop table    if exists public.orders      cascade;
drop table    if exists public.customers   cascade;
drop table    if exists public.product     cascade;
drop table    if exists public.category    cascade;
drop function if exists public.handle_new_user()         cascade;
drop function if exists public.is_admin()                cascade;
drop function if exists public.prepare_order_item()      cascade;
drop function if exists public.recalculate_order_total() cascade;
drop function if exists public.restore_stock_on_cancel() cascade;
drop function if exists public.set_review_fields()       cascade;
drop function if exists public.get_dashboard_stats()     cascade;


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Product categories (jewelry, candles, ...)
create table public.category (
    category_id  bigint generated always as identity primary key,
    name         varchar(60)  not null unique,
    slug         varchar(60)  not null unique,
    description  text,
    image_url    text
);

-- Handmade products sold on the marketplace
create table public.product (
    product_id   bigint generated always as identity primary key,
    category_id  bigint        not null references public.category (category_id) on delete restrict,
    name         varchar(120)  not null,
    description  text          not null,
    price        numeric(10,2) not null check (price > 0),          -- AED, VAT included
    stock        integer       not null default 0 check (stock >= 0),
    artisan      varchar(80)   not null,                            -- maker of the item
    materials    varchar(160),
    image_url    text,
    is_featured  boolean       not null default false,
    created_at   timestamptz   not null default now()
);

-- One row per registered user (linked 1-to-1 with Supabase Auth users)
create table public.customers (
    customer_id  uuid          primary key references auth.users (id) on delete cascade,
    full_name    varchar(100)  not null,
    email        varchar(255)  not null unique,
    phone        varchar(20),
    city         varchar(60),
    address      text,
    is_admin     boolean       not null default false,
    created_at   timestamptz   not null default now()
);

-- Orders placed at checkout
create table public.orders (
    order_id          bigint generated always as identity primary key,
    customer_id       uuid          not null default auth.uid()
                                    references public.customers (customer_id) on delete cascade,
    order_date        timestamptz   not null default now(),
    status            varchar(20)   not null default 'pending'
                      check (status in ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    shipping_name     varchar(100)  not null,
    shipping_phone    varchar(20)   not null,
    shipping_city     varchar(60)   not null,
    shipping_address  text          not null,
    payment_method    varchar(30)   not null
                      check (payment_method in ('cash_on_delivery', 'card_on_delivery')),
    notes             text          check (char_length(notes) <= 500),
    subtotal          numeric(10,2) not null default 0,   -- sum of items (VAT included)
    delivery_fee      numeric(10,2) not null default 0,
    vat               numeric(10,2) not null default 0,   -- 5% VAT contained in the total
    total             numeric(10,2) not null default 0
);

-- Products inside each order
create table public.order_items (
    order_item_id  bigint generated always as identity primary key,
    order_id       bigint        not null references public.orders (order_id) on delete cascade,
    product_id     bigint        not null references public.product (product_id) on delete restrict,
    quantity       integer       not null check (quantity between 1 and 20),
    unit_price     numeric(10,2) not null check (unit_price > 0),   -- copied from product by trigger
    unique (order_id, product_id)
);

-- Product reviews and ratings (additional feature of Project 3)
create table public.reviews (
    review_id      bigint generated always as identity primary key,
    product_id     bigint        not null references public.product (product_id) on delete cascade,
    customer_id    uuid          not null default auth.uid()
                                 references public.customers (customer_id) on delete cascade,
    reviewer_name  varchar(100)  not null,                     -- filled by trigger, e.g. "Mariam K."
    rating         smallint      not null check (rating between 1 and 5),
    comment        text          check (char_length(comment) <= 1000),
    created_at     timestamptz   not null default now(),
    updated_at     timestamptz,
    unique (product_id, customer_id)                           -- one review per customer per product
);


-- ---------------------------------------------------------------------
-- 2. Indexes (speed up filtering, joins and sorting)
-- ---------------------------------------------------------------------
create index product_category_idx    on public.product (category_id);
create index product_price_idx       on public.product (price);
create index orders_customer_idx     on public.orders (customer_id);
create index order_items_order_idx   on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);
create index reviews_product_idx     on public.reviews (product_id);


-- ---------------------------------------------------------------------
-- 3. View: product + category name + average rating
--    Used by the shop pages and the smart search.
--    security_invoker = true means the caller's RLS rules still apply.
-- ---------------------------------------------------------------------
create view public.product_catalog
with (security_invoker = true) as
select
    p.product_id,
    p.name,
    p.description,
    p.price,
    p.stock,
    p.artisan,
    p.materials,
    p.image_url,
    p.is_featured,
    p.created_at,
    p.category_id,
    c.name                                         as category_name,
    c.slug                                         as category_slug,
    coalesce(round(avg(r.rating)::numeric, 1), 0)  as avg_rating,
    count(r.review_id)                             as review_count
from public.product p
join public.category c     on c.category_id = p.category_id
left join public.reviews r on r.product_id  = p.product_id
group by p.product_id, c.category_id;


-- ---------------------------------------------------------------------
-- 4. Functions and triggers
-- ---------------------------------------------------------------------

-- 4.1 Create a customers row automatically when someone registers
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.customers (customer_id, email, full_name, phone)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
        nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
    )
    on conflict (customer_id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Users who registered before this script was run also get a customers row
insert into public.customers (customer_id, email, full_name, phone)
select id,
       coalesce(email, ''),
       coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), split_part(email, '@', 1)),
       nullif(trim(raw_user_meta_data ->> 'phone'), '')
from auth.users
on conflict (customer_id) do nothing;

-- 4.2 Is the logged-in user an administrator?
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select c.is_admin from public.customers c where c.customer_id = auth.uid()),
        false
    );
$$;

-- 4.3 Before an order item is saved:
--     * take the real price from the product table (the browser cannot change prices)
--     * check the stock and reduce it in the same transaction
create function public.prepare_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_price numeric(10,2);
    v_name  text;
begin
    update public.product
       set stock = stock - new.quantity
     where product_id = new.product_id
       and stock >= new.quantity
    returning price into v_price;

    if not found then
        select name into v_name from public.product where product_id = new.product_id;
        raise exception 'Not enough stock for "%"', coalesce(v_name, 'this product');
    end if;

    new.unit_price := v_price;
    return new;
end;
$$;

create trigger order_items_before_insert
before insert on public.order_items
for each row execute function public.prepare_order_item();

-- 4.4 After items are added: recalculate the order totals on the server
--     Prices include 5% VAT; delivery is AED 15, free from AED 200.
create function public.recalculate_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_subtotal numeric(10,2);
    v_delivery numeric(10,2);
begin
    select coalesce(sum(quantity * unit_price), 0)
      into v_subtotal
      from public.order_items
     where order_id = new.order_id;

    v_delivery := case when v_subtotal >= 200 then 0 else 15 end;

    update public.orders
       set subtotal     = v_subtotal,
           delivery_fee = v_delivery,
           total        = v_subtotal + v_delivery,
           vat          = round((v_subtotal + v_delivery) * 5 / 105, 2)
     where order_id = new.order_id;

    return null;
end;
$$;

create trigger order_items_after_insert
after insert on public.order_items
for each row execute function public.recalculate_order_total();

-- 4.5 When an order is cancelled, put its products back in stock
create function public.restore_stock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'cancelled' and old.status <> 'cancelled' then
        update public.product p
           set stock = p.stock + oi.quantity
          from public.order_items oi
         where oi.order_id = new.order_id
           and oi.product_id = p.product_id;
    end if;
    return null;
end;
$$;

create trigger orders_after_status_update
after update of status on public.orders
for each row execute function public.restore_stock_on_cancel();

-- 4.6 Reviews: show a short reviewer name ("Mariam K.") taken from the
--     customer's profile, so nobody can post under someone else's name
create function public.set_review_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_full  text;
    v_parts text[];
begin
    if tg_op = 'INSERT' then
        select trim(full_name) into v_full from public.customers where customer_id = new.customer_id;
        v_parts := regexp_split_to_array(coalesce(nullif(v_full, ''), 'Customer'), '\s+');
        new.reviewer_name := v_parts[1]
            || case when array_length(v_parts, 1) > 1
                    then ' ' || left(v_parts[array_length(v_parts, 1)], 1) || '.'
                    else '' end;
        new.created_at := now();
    else
        new.updated_at := now();
    end if;
    return new;
end;
$$;

create trigger reviews_before_write
before insert or update on public.reviews
for each row execute function public.set_review_fields();


-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.category    enable row level security;
alter table public.product     enable row level security;
alter table public.customers   enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews     enable row level security;

-- category: public catalogue
create policy "Anyone can view categories"
    on public.category for select
    to anon, authenticated
    using (true);

-- product: everyone can browse, only administrators can change
create policy "Anyone can view products"
    on public.product for select
    to anon, authenticated
    using (true);

create policy "Admins can add products"
    on public.product for insert
    to authenticated
    with check (public.is_admin());

create policy "Admins can update products"
    on public.product for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Admins can delete products"
    on public.product for delete
    to authenticated
    using (public.is_admin());

-- customers: each user sees and edits only their own profile
create policy "Customers can view their own profile"
    on public.customers for select
    to authenticated
    using (customer_id = auth.uid() or public.is_admin());

create policy "Customers can update their own profile"
    on public.customers for update
    to authenticated
    using (customer_id = auth.uid())
    with check (customer_id = auth.uid());

-- orders: each user sees, places and cancels only their own orders
create policy "Customers can view their own orders"
    on public.orders for select
    to authenticated
    using (customer_id = auth.uid() or public.is_admin());

create policy "Customers can place their own orders"
    on public.orders for insert
    to authenticated
    with check (customer_id = auth.uid() and status = 'pending');

create policy "Customers can cancel their own pending orders"
    on public.orders for update
    to authenticated
    using (customer_id = auth.uid() and status = 'pending')
    with check (customer_id = auth.uid() and status in ('pending', 'cancelled'));

-- order_items: visible and insertable only through the customer's own orders
create policy "Customers can view items of their own orders"
    on public.order_items for select
    to authenticated
    using (exists (
        select 1 from public.orders o
         where o.order_id = order_items.order_id
           and (o.customer_id = auth.uid() or public.is_admin())
    ));

create policy "Customers can add items to their own pending orders"
    on public.order_items for insert
    to authenticated
    with check (exists (
        select 1 from public.orders o
         where o.order_id = order_items.order_id
           and o.customer_id = auth.uid()
           and o.status = 'pending'
    ));

-- reviews: public to read; only verified buyers can write; owners edit/delete
create policy "Anyone can read reviews"
    on public.reviews for select
    to anon, authenticated
    using (true);

create policy "Verified buyers can review products they bought"
    on public.reviews for insert
    to authenticated
    with check (
        customer_id = auth.uid()
        and exists (
            select 1
              from public.order_items oi
              join public.orders o on o.order_id = oi.order_id
             where o.customer_id = auth.uid()
               and oi.product_id = reviews.product_id
               and o.status <> 'cancelled'
        )
    );

create policy "Customers can edit their own reviews"
    on public.reviews for update
    to authenticated
    using (customer_id = auth.uid())
    with check (customer_id = auth.uid());

create policy "Customers can delete their own reviews, admins can moderate"
    on public.reviews for delete
    to authenticated
    using (customer_id = auth.uid() or public.is_admin());


-- ---------------------------------------------------------------------
-- 6. Privileges
--    RLS decides WHICH ROWS a user can reach; these grants decide WHICH
--    COLUMNS. Example: a customer may update their phone number but can
--    never set is_admin, change an order total or edit a unit price.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on public.category, public.product, public.customers,
              public.orders, public.order_items, public.reviews
         from anon, authenticated;

-- Public catalogue
grant select on public.category, public.product, public.reviews, public.product_catalog
   to anon, authenticated;

-- Products (RLS limits these to administrators)
grant insert, update, delete on public.product to authenticated;

-- Customer profile
grant select on public.customers to authenticated;
grant update (full_name, phone, city, address) on public.customers to authenticated;

-- Orders
grant select on public.orders to authenticated;
grant insert (shipping_name, shipping_phone, shipping_city, shipping_address, payment_method, notes)
   on public.orders to authenticated;
grant update (status) on public.orders to authenticated;

-- Order items (unit_price is set by the trigger, never by the browser)
grant select on public.order_items to authenticated;
grant insert (order_id, product_id, quantity) on public.order_items to authenticated;

-- Reviews
grant insert (product_id, rating, comment) on public.reviews to authenticated;
grant update (rating, comment) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

grant usage on all sequences in schema public to authenticated;

-- Functions callable from the website
revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Analytics for the dashboard (administrators only)
--    Returns totals only, never customer names, e-mails or addresses.
-- ---------------------------------------------------------------------
create function public.get_dashboard_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    result json;
begin
    if not public.is_admin() then
        raise exception 'Access denied: administrators only' using errcode = '42501';
    end if;

    select json_build_object(
        'total_products',    (select count(*) from product),
        'total_stock_units', (select coalesce(sum(stock), 0) from product),
        'total_customers',   (select count(*) from customers),
        'total_orders',      (select count(*) from orders where status <> 'cancelled' and total > 0),
        'cancelled_orders',  (select count(*) from orders where status = 'cancelled'),
        'total_sales',       (select coalesce(sum(total), 0) from orders where status <> 'cancelled' and total > 0),
        'avg_order_value',   (select coalesce(round(avg(total), 2), 0) from orders where status <> 'cancelled' and total > 0),
        'total_reviews',     (select count(*) from reviews),
        'avg_rating',        (select coalesce(round(avg(rating), 1), 0) from reviews),

        'top_products', (
            select coalesce(json_agg(t), '[]'::json) from (
                select p.product_id, p.name,
                       sum(oi.quantity)                 as units_sold,
                       sum(oi.quantity * oi.unit_price) as revenue
                  from order_items oi
                  join orders  o on o.order_id   = oi.order_id
                  join product p on p.product_id = oi.product_id
                 where o.status <> 'cancelled'
                 group by p.product_id, p.name
                 order by units_sold desc, revenue desc
                 limit 5
            ) t),

        'top_rated', (
            select coalesce(json_agg(t), '[]'::json) from (
                select product_id, name, avg_rating, review_count
                  from product_catalog
                 where review_count > 0
                 order by avg_rating desc, review_count desc
                 limit 5
            ) t),

        'low_stock', (
            select coalesce(json_agg(t), '[]'::json) from (
                select product_id, name, stock
                  from product
                 where stock <= 5
                 order by stock, name
            ) t),

        'sales_by_category', (
            select coalesce(json_agg(t), '[]'::json) from (
                select c.name as category,
                       coalesce(sum(s.quantity * s.unit_price), 0) as revenue,
                       coalesce(sum(s.quantity), 0)                as units
                  from category c
                  left join (
                        select p.category_id, oi.quantity, oi.unit_price
                          from order_items oi
                          join orders  o on o.order_id   = oi.order_id
                          join product p on p.product_id = oi.product_id
                         where o.status <> 'cancelled'
                  ) s on s.category_id = c.category_id
                 group by c.category_id, c.name
                 order by revenue desc, c.name
            ) t),

        'orders_by_status', (
            select coalesce(json_agg(t), '[]'::json) from (
                select status, count(*) as orders
                  from orders
                 where total > 0
                 group by status
                 order by orders desc
            ) t),

        'sales_last_14_days', (
            select coalesce(json_agg(t order by t.day), '[]'::json) from (
                select d::date                   as day,
                       coalesce(sum(o.total), 0) as revenue,
                       count(o.order_id)         as orders
                  from generate_series(current_date - 13, current_date, interval '1 day') d
                  left join orders o
                         on o.order_date::date = d::date
                        and o.status <> 'cancelled'
                        and o.total > 0
                 group by d
            ) t)
    ) into result;

    return result;
end;
$$;

revoke execute on function public.get_dashboard_stats() from public, anon;
grant  execute on function public.get_dashboard_stats() to authenticated;


-- ---------------------------------------------------------------------
-- 8. Sample data
-- ---------------------------------------------------------------------
insert into public.category (name, slug, description, image_url) values
    ('Handmade Jewelry', 'jewelry',     'Rings, necklaces and bracelets shaped by hand by local makers.', 'images/categories/jewelry.svg'),
    ('Decorations',      'decorations', 'Pottery, palm-leaf weaving and wall art for a warmer home.',      'images/categories/decorations.svg'),
    ('Candles',          'candles',     'Hand-poured soy and beeswax candles with scents of the region.',  'images/categories/candles.svg'),
    ('Accessories',      'accessories', 'Bags, wallets and scarves stitched and dyed by hand.',            'images/categories/accessories.svg'),
    ('Gifts',            'gifts',       'Gift sets and keepsakes for Eid, Ramadan and every celebration.', 'images/categories/gifts.svg');

insert into public.product (category_id, name, description, price, stock, artisan, materials, image_url, is_featured)
select c.category_id, v.name, v.description, v.price, v.stock, v.artisan, v.materials,
       'images/categories/' || v.slug || '.svg', v.featured
from (values
    -- Handmade Jewelry
    ('jewelry', 'Sadu Pattern Silver Ring',
     'A sterling silver band engraved by hand with a geometric pattern inspired by traditional Sadu weaving. Polished to a soft satin finish.',
     145.00, 12, 'Mariam Al Ketbi', '925 sterling silver', true),
    ('jewelry', 'Pearl Drop Necklace',
     'A single freshwater pearl on a fine gold-plated chain, a tribute to the pearl-diving heritage of the Gulf. Chain length 45 cm.',
     260.00, 6, 'Noura Jewels', 'Freshwater pearl, gold-plated brass chain', true),
    ('jewelry', 'Beaded Desert Bracelet',
     'Sand, terracotta and turquoise glass beads strung by hand on a strong stretch cord. One size fits most wrists.',
     75.00, 25, 'Layla Crafts', 'Glass beads, elastic cord', false),
    ('jewelry', 'Hammered Brass Earrings',
     'Lightweight drop earrings hammered by hand so each pair catches the light differently. Hypoallergenic hooks.',
     95.00, 4, 'Mariam Al Ketbi', 'Hammered brass, hypoallergenic steel hooks', false),

    -- Decorations
    ('decorations', 'Hand-Thrown Clay Vase',
     'Thrown on the wheel and finished with a natural sand-coloured glaze. Every vase has small differences in shape and tone. Height 24 cm.',
     180.00, 8, 'Al Hajar Pottery', 'Stoneware clay, natural glaze', true),
    ('decorations', 'Palm Leaf Khoos Basket',
     'Woven from dried palm leaves using the traditional Khoos technique. Perfect for fruit, dates or as a planter cover. Diameter 30 cm.',
     120.00, 15, 'Fatima Khoos Studio', 'Dried palm leaves', false),
    ('decorations', 'Arabic Calligraphy Wall Art',
     'An original calligraphy piece written with a reed pen on handmade cotton paper and framed in oak. Size 40 x 50 cm.',
     220.00, 3, 'Hamad Ink', 'Ink on cotton paper, oak frame', false),
    ('decorations', 'Macrame Wall Hanging',
     'A soft cotton rope wall hanging knotted by hand on a piece of driftwood. Adds texture to bedrooms and living rooms. Width 45 cm.',
     135.00, 0, 'Knot & Loom', 'Cotton rope, driftwood', false),

    -- Candles
    ('candles', 'Oud & Amber Soy Candle',
     'A hand-poured soy wax candle with warm notes of oud and amber. Cotton wick, around 45 hours of burn time.',
     85.00, 30, 'Bukhoor Light Co.', 'Soy wax, cotton wick, oud fragrance oil', true),
    ('candles', 'Rose & Saffron Candle',
     'Delicate Taif rose with a touch of saffron, poured in a reusable amber glass jar. Around 40 hours of burn time.',
     90.00, 22, 'Bukhoor Light Co.', 'Soy wax, rose oil, saffron', false),
    ('candles', 'Beeswax Pillar Candles (Set of 3)',
     'Three pure beeswax pillars rolled by hand. Beeswax burns slowly and cleanly with a gentle honey scent.',
     110.00, 5, 'Hive & Wick', 'Pure beeswax, cotton wick', false),
    ('candles', 'Date Palm Candle in Clay Pot',
     'A sweet date and cardamom scented candle poured into a small handmade clay pot that you can reuse after the candle ends.',
     70.00, 18, 'Al Hajar Pottery', 'Soy wax, handmade clay pot', false),

    -- Accessories
    ('accessories', 'Embroidered Leather Wallet',
     'A slim full-grain leather wallet stitched by hand, with a small embroidered pattern on the front. Six card slots.',
     160.00, 10, 'Saif Leatherworks', 'Full-grain leather, waxed cotton thread', false),
    ('accessories', 'Sadu Woven Tote Bag',
     'A sturdy everyday tote made from hand-woven Sadu fabric with a cotton lining and an inner pocket.',
     195.00, 7, 'Fatima Khoos Studio', 'Wool Sadu weave, cotton lining', true),
    ('accessories', 'Hand-Dyed Silk Scarf',
     'A lightweight silk scarf dyed by hand with natural indigo and pomegranate dyes. Size 180 x 70 cm.',
     140.00, 9, 'Indigo Atelier', '100% silk, natural dyes', false),
    ('accessories', 'Beaded Phone Strap',
     'A colourful hand-beaded strap that clips to most phone cases, so your phone is always within reach.',
     45.00, 40, 'Layla Crafts', 'Glass beads, nylon cord', false),

    -- Gifts
    ('gifts', 'Ramadan Lantern Gift Box',
     'A small hand-finished brass lantern with a beeswax tea light and a box of premium dates. Ready to give.',
     240.00, 6, 'Hirfa Studio', 'Brass lantern, beeswax, dates', true),
    ('gifts', 'Personalised Wooden Name Plate',
     'A hand-carved acacia wood name plate in Arabic or English. Add the name in the order notes at checkout.',
     125.00, 14, 'Timber Tales', 'Acacia wood, natural oil finish', false),
    ('gifts', 'Handmade Soap & Candle Set',
     'Two goat-milk soaps and four beeswax tea lights wrapped in a reusable cotton pouch.',
     99.00, 20, 'Hive & Wick', 'Goat milk soap, beeswax, cotton pouch', false),
    ('gifts', 'Finjan Coffee Cups (Set of 4)',
     'Four small stoneware cups for Arabic coffee, glazed by hand in desert sand and turquoise tones.',
     150.00, 2, 'Al Hajar Pottery', 'Glazed stoneware', false)
) as v(slug, name, description, price, stock, artisan, materials, featured)
join public.category c on c.slug = v.slug;


-- ---------------------------------------------------------------------
-- 9. Useful queries (run them separately when you need them)
-- ---------------------------------------------------------------------

-- 9.1 Make your own account an administrator (opens the dashboard page):
-- update public.customers set is_admin = true where email = 'your-email@example.com';

-- 9.2 Smart search examples (the website builds the same queries through the REST API):
-- select name, price, stock, avg_rating from public.product_catalog
--  where category_slug = 'candles' and price between 50 and 100 and stock > 0
--  order by price;
--
-- select name, price from public.product_catalog
--  where (name ilike '%silver%' or description ilike '%silver%')
--    and (name ilike '%ring%'   or description ilike '%ring%');

-- 9.3 Check the RLS policies:
-- select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by tablename;
