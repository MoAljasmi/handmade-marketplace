# Hirfa – Handmade Products Marketplace

**INT424 E-Commerce – Final Project (Project 3: Handmade Products Marketplace)**

Hirfa ("craft" in Arabic) is an online marketplace for handmade jewelry, decorations, candles, accessories and gifts made by artisans in the UAE. Customers can search the catalogue, buy products, follow their orders and review the items they bought.

| | |
|---|---|
| **GitHub repository** | https://github.com/MoAljasmi/handmade-marketplace |
| **Live website (GitHub Pages)** | https://moaljasmi.github.io/handmade-marketplace/ |

## Team

| Name | Student ID |
|---|---|
| Student Name | Student ID |
| Student Name | Student ID |
| Student Name | Student ID |

Section: 2B3B · Instructor: _Instructor Name_ · Semester: _Semester_

## Main features

- **Product catalogue from Supabase**: products, categories, prices, stock and ratings are read from the database (nothing is hardcoded).
- **Categories, search, filters and sorting**: keyword search, category filter, sort by price, rating, date or name.
- **Smart search**: several keywords at once (every word must match), price range, minimum rating, "in stock only", plus one-click shortcuts such as "In stock under AED 100". All filters run as database queries.
- **Product details** with stock status, materials, maker name and related products.
- **Registration and login** with Supabase Auth.
- **Shopping cart** saved in `localStorage`, with prices and stock re-checked against the database.
- **Checkout**: the order is saved in `orders` and the products in `order_items`; the database sets the real prices, checks and reduces stock and calculates totals (5% VAT included, AED 15 delivery, free from AED 200).
- **Order confirmation** page and **My account** page (order history, cancel a pending order, edit saved details).
- **Reviews and ratings** (Project 3 additional feature): only verified buyers can review, one review per product, and customers can edit or delete their own review.
- **Analytics dashboard** for administrators: total sales, orders, average order value, customers, ratings, revenue by category, revenue over the last 14 days, orders by status, best sellers, top rated and low-stock products with a restock form.
- **Responsive design** for mobile, tablet and desktop.

## Technologies

| Technology | Used for |
|---|---|
| HTML5 | Page structure and forms |
| CSS3 | Layout and responsive design (`css/style.css`) |
| JavaScript | Application logic (`js/`) |
| Supabase (PostgreSQL) | Database, views, triggers and functions |
| Supabase Auth | Registration and login |
| Supabase REST API | All reads and writes through `supabase-js` |
| Row Level Security | Protecting customer data |
| Chart.js | Dashboard charts |
| GitHub / GitHub Pages | Source control and hosting |

## Project structure

```
handmade-marketplace/
├── index.html               Home: categories and featured products
├── products.html            Shop: search, filters, sorting, smart search
├── product-detail.html      Product details, reviews and ratings
├── about.html               About, delivery, payment and privacy
├── login.html / register.html
├── cart.html                Shopping cart
├── checkout.html            Delivery details and payment method
├── order-confirmation.html  Order summary after checkout
├── account.html             Order history and saved details
├── dashboard.html           Analytics (administrators only)
├── css/style.css
├── js/
│   ├── config.js            Supabase URL and publishable key
│   ├── app.js               Supabase client, header, footer, helpers
│   ├── auth.js              Register and log in
│   ├── cart.js              Cart (localStorage) and cart page
│   ├── checkout.js          Saves orders and order items
│   ├── home.js / products.js / product-detail.js
│   ├── account.js / confirmation.js / dashboard.js
├── images/                  Logo, category illustrations and icons (made for this project)
├── database/database.sql    Tables, RLS policies, triggers, functions and sample data
└── README.md
```

## Database structure

| Table | Purpose | Key columns |
|---|---|---|
| `category` | Product categories | `category_id` PK, `name`, `slug` |
| `product` | Handmade products | `product_id` PK, `category_id` FK → category, `price`, `stock`, `artisan` |
| `customers` | Customer profiles (1-to-1 with Supabase Auth users) | `customer_id` PK/FK → auth.users, `full_name`, `email`, `is_admin` |
| `orders` | Orders | `order_id` PK, `customer_id` FK → customers, `status`, shipping details, `subtotal`, `vat`, `delivery_fee`, `total` |
| `order_items` | Products in each order | `order_item_id` PK, `order_id` FK → orders, `product_id` FK → product, `quantity`, `unit_price` |
| `reviews` | Ratings and reviews | `review_id` PK, `product_id` FK → product, `customer_id` FK → customers, `rating` 1–5, `comment` |

Relationships: a category has many products; a customer has many orders and reviews; an order has many order items; a product appears in many order items and has many reviews.

The view `product_catalog` joins products with their category and average rating and is used by the shop and the smart search. The function `get_dashboard_stats()` returns the dashboard figures to administrators only.

## REST API operations

| Operation | Table | Where |
|---|---|---|
| SELECT | `product_catalog`, `category` | Home, shop, product page (`home.js`, `products.js`, `product-detail.js`) |
| SELECT | `orders` + `order_items` | My account, order confirmation |
| INSERT | `orders`, `order_items` | Checkout (`checkout.js`) |
| INSERT | `reviews` | Product page – write a review |
| UPDATE | `customers` | My account – save details; checkout – save address |
| UPDATE | `orders.status` | My account – cancel a pending order |
| UPDATE | `reviews` | Product page – edit your review |
| UPDATE | `product.stock` | Dashboard – restock (administrators only) |
| DELETE | `reviews` | Product page – delete your review |
| RPC | `get_dashboard_stats`, `is_admin` | Dashboard, header |

## Setup instructions

### 1. Supabase

1. Create a project at https://supabase.com (keep the database password private).
2. Open **SQL Editor → New query**, paste the whole of `database/database.sql` and click **Run**. This creates the tables, RLS policies, triggers and sample data.
3. Go to **Project Settings → API** (or **API Keys**) and copy the **Project URL** and the **publishable** (or legacy **anon**) key.
4. Open `js/config.js` and replace `YOUR_PROJECT_URL` and `YOUR_PUBLISHABLE_OR_ANON_KEY`. Never use the service-role key.
5. In **Authentication → URL Configuration**, set the **Site URL** to the GitHub Pages address so confirmation e-mails open the live site. For quick testing you can turn off **Confirm email** under **Authentication → Sign In / Providers → Email**.
6. Register on the website, then make your account an administrator to open the dashboard:

   ```sql
   update public.customers set is_admin = true where email = 'your-email@example.com';
   ```

### 2. Run locally

Open the folder in GitHub Codespaces or VS Code and serve it with any static server, for example the **Live Server** extension, or:

```
python -m http.server 5500
```

Then open http://localhost:5500.

### 3. Deploy to GitHub Pages

Repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**. After a minute the site is live at https://moaljasmi.github.io/handmade-marketplace/.

## Security review

| # | Risk | Why it is dangerous | How we prevent it |
|---|---|---|---|
| 1 | Exposing secret keys | The service-role key bypasses all security | Only the publishable key is in `config.js`; the service-role key and database password are never in the code |
| 2 | Reading other customers' data | Names, phones and addresses are personal data (UAE PDPL) | RLS: customers can only select their own row in `customers`, `orders` and `order_items` |
| 3 | Changing prices or totals from the browser | A user could pay AED 1 for any product | Column privileges block `unit_price`, `total` and `is_admin`; triggers copy the real price and calculate totals on the server |
| 4 | Modifying another user's orders or reviews | Fraud and fake activity | RLS `with check (customer_id = auth.uid())`; orders can only move from `pending` to `cancelled` by their owner |
| 5 | Fake reviews and script injection | Misleads customers; stored XSS can steal sessions | Reviews require a real purchase (RLS); one review per product; every value is HTML-escaped before display; input is validated in the form and by database `check` constraints |

## Notes

- Product pictures are simple illustrations drawn for this project. Real product photos can replace them by changing `image_url` in the `product` table.
- No real payments are processed. Customers pay by cash or card on delivery, and card numbers are never collected.
