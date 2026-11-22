/*
 * app.js - shared code loaded on every page
 *   - creates the Supabase client
 *   - draws the header (navigation) and footer
 *   - small helpers: money, dates, stars, product cards, messages
 */

const STORE = {
    name: "Hirfa",
    vatRate: 0.05,          // UAE VAT 5% (already included in prices)
    deliveryFee: 15,        // AED
    freeDeliveryFrom: 200,  // AED
    maxQuantity: 20
};

const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

/* ---------- Supabase client ---------- */
const isSupabaseConfigured =
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    typeof SUPABASE_KEY === "string" &&
    !SUPABASE_KEY.startsWith("YOUR_");

const supabaseClient = isSupabaseConfigured && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

/* ---------- DOM helpers ---------- */
function $(selector, root = document) {
    return root.querySelector(selector);
}

function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

/* Every value that comes from the database is escaped before it is put
   into HTML, so a review like <script>...</script> is shown as text. */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}

const moneyFormatter = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" });

function formatMoney(amount) {
    return moneyFormatter.format(Number(amount) || 0);
}

function formatDate(value) {
    return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function currentPageWithQuery() {
    const page = window.location.pathname.split("/").pop() || "index.html";
    return page + window.location.search;
}

/* Only allow redirects to our own pages (prevents open-redirect attacks) */
function safeRedirectTarget(value) {
    return /^[a-z0-9-]+\.html(\?[a-z0-9=&%_.-]*)?$/i.test(value || "") ? value : "index.html";
}

/* ---------- Messages ---------- */
function showMessage(element, text, type = "info") {
    if (!element) return;
    element.className = `alert alert--${type}`;
    element.textContent = text;
    element.hidden = !text;
}

function showToast(text, type = "success") {
    let root = $("#toast-root");
    if (!root) {
        root = document.createElement("div");
        root.id = "toast-root";
        root.setAttribute("role", "status");
        root.setAttribute("aria-live", "polite");
        document.body.appendChild(root);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = text;
    root.appendChild(toast);
    setTimeout(() => toast.classList.add("is-leaving"), 2600);
    setTimeout(() => toast.remove(), 3000);
}

/* Friendly text for common Supabase errors */
function friendlyError(error) {
    if (!error) return "Something went wrong. Please try again.";
    if (error.code === "42501") return "You are not allowed to do this.";
    if (error.code === "23505") return "This record already exists.";
    if (error.message && error.message.includes("Failed to fetch")) return "Cannot reach the server. Check your internet connection.";
    return error.message || "Something went wrong. Please try again.";
}

/* ---------- Product display helpers ---------- */
const TINTS = ["#F3E3D3", "#E3ECE5", "#F1E4EC", "#E2EAF1", "#F4EACF", "#EADFD6"];

function tintFor(id) {
    return TINTS[Number(id) % TINTS.length];
}

function productImage(product) {
    return product.image_url || "images/categories/gifts.svg";
}

function starsHtml(rating, label = true) {
    const value = Number(rating) || 0;
    const full = Math.round(value);
    let stars = "";
    for (let i = 1; i <= 5; i++) {
        stars += `<span class="star${i <= full ? " is-on" : ""}" aria-hidden="true">&#9733;</span>`;
    }
    const text = label ? `Rated ${value.toFixed(1)} out of 5` : "";
    return `<span class="stars" ${label ? `role="img" aria-label="${text}"` : 'aria-hidden="true"'}>${stars}</span>`;
}

function stockBadge(stock) {
    if (stock <= 0) return '<span class="badge badge--muted">Sold out</span>';
    if (stock <= 5) return `<span class="badge badge--warn">Only ${stock} left</span>`;
    return "";
}

/* Products shown on the page, so "Add to cart" buttons can find them */
const productCache = new Map();

function cacheProducts(list) {
    (list || []).forEach(p => productCache.set(Number(p.product_id), p));
}

function productCardHtml(p) {
    const soldOut = p.stock <= 0;
    const url = `product-detail.html?id=${encodeURIComponent(p.product_id)}`;
    return `
    <article class="product-card">
        <a href="${url}" class="product-card__media" style="background:${tintFor(p.product_id)}">
            <img src="${escapeHtml(productImage(p))}" alt="${escapeHtml(p.name)}" loading="lazy">
            ${stockBadge(p.stock)}
        </a>
        <div class="product-card__body">
            <p class="eyebrow">${escapeHtml(p.category_name || "")}</p>
            <h3 class="product-card__title"><a href="${url}">${escapeHtml(p.name)}</a></h3>
            <p class="product-card__artisan">by ${escapeHtml(p.artisan)}</p>
            <div class="rating-line">${starsHtml(p.avg_rating)}<span class="muted">(${Number(p.review_count) || 0})</span></div>
            <div class="product-card__footer">
                <span class="price">${formatMoney(p.price)}</span>
                <button type="button" class="btn btn--small" data-add-to-cart="${p.product_id}" ${soldOut ? "disabled" : ""}>
                    ${soldOut ? "Sold out" : "Add to cart"}
                </button>
            </div>
        </div>
    </article>`;
}

function skeletonCards(count = 4) {
    return Array.from({ length: count }, () => '<div class="product-card product-card--skeleton" aria-hidden="true"></div>').join("");
}

/* ---------- Authentication helpers ---------- */
async function getCurrentUser() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session ? data.session.user : null;
}

/* Sends visitors who are not logged in to the login page */
async function requireLogin() {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = `login.html?redirect=${encodeURIComponent(currentPageWithQuery())}`;
        return null;
    }
    return user;
}

async function checkIsAdmin() {
    if (!supabaseClient) return false;
    const { data, error } = await supabaseClient.rpc("is_admin");
    return !error && data === true;
}

/* ---------- Header and footer ---------- */
const CART_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/></svg>`;

function renderHeader(user, isAdmin) {
    const header = $("#site-header");
    if (!header) return;
    const page = document.body.dataset.page;
    const link = (href, label, key) =>
        `<a href="${href}" class="nav__link${page === key ? " is-active" : ""}"${page === key ? ' aria-current="page"' : ""}>${label}</a>`;

    header.innerHTML = `
    <div class="container header__inner">
        <a href="index.html" class="logo" aria-label="Hirfa home">
            <img src="images/logo.svg" alt="" width="34" height="34">
            <span>Hirfa</span>
        </a>
        <nav id="main-nav" class="nav" aria-label="Main">
            ${link("index.html", "Home", "home")}
            ${link("products.html", "Shop", "products")}
            ${link("about.html", "About", "about")}
            ${isAdmin ? link("dashboard.html", "Dashboard", "dashboard") : ""}
            ${user ? link("account.html", "My account", "account") : link("login.html", "Log in", "login")}
            ${user
                ? '<button type="button" class="nav__link nav__button" id="logout-btn">Log out</button>'
                : link("register.html", "Register", "register")}
        </nav>
        <div class="header__actions">
            <a href="cart.html" class="cart-link${page === "cart" ? " is-active" : ""}" aria-label="Shopping cart">
                ${CART_ICON}<span class="cart-count" id="cart-count">0</span>
            </a>
            <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="Open menu">
                <span></span><span></span><span></span>
            </button>
        </div>
    </div>`;

    const toggle = $(".nav-toggle", header);
    const nav = $("#main-nav", header);
    toggle.addEventListener("click", () => {
        const open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
    });

    const logout = $("#logout-btn", header);
    if (logout) {
        logout.addEventListener("click", async () => {
            await supabaseClient.auth.signOut();
            window.location.href = "index.html";
        });
    }

    if (typeof updateCartCount === "function") updateCartCount();
}

function renderFooter() {
    const footer = $("#site-footer");
    if (!footer) return;
    footer.innerHTML = `
    <div class="container footer__grid">
        <div>
            <a href="index.html" class="logo logo--light"><img src="images/logo.svg" alt="" width="30" height="30"><span>Hirfa</span></a>
            <p>A marketplace for handmade products from makers across the UAE.</p>
        </div>
        <div>
            <h3>Shop</h3>
            <a href="products.html">All products</a>
            <a href="products.html?category=jewelry">Jewelry</a>
            <a href="products.html?category=candles">Candles</a>
            <a href="products.html?category=gifts">Gifts</a>
        </div>
        <div>
            <h3>Help</h3>
            <a href="about.html#delivery">Delivery</a>
            <a href="about.html#payment">Payment</a>
            <a href="about.html#privacy">Privacy</a>
        </div>
        <div>
            <h3>Account</h3>
            <a href="account.html">My orders</a>
            <a href="cart.html">Cart</a>
        </div>
    </div>
    <div class="container footer__bottom">
        <p>&copy; ${new Date().getFullYear()} Hirfa. INT424 student project. Prices in AED and include 5% VAT.</p>
    </div>`;
}

function showSetupNotice() {
    const main = $("main");
    if (!main || supabaseClient) return;
    const notice = document.createElement("div");
    notice.className = "container";
    notice.innerHTML = `<div class="alert alert--warn setup-notice">
        <strong>Database not connected.</strong> Add your Supabase Project URL and publishable key in
        <code>js/config.js</code>, then run <code>database/database.sql</code> in the Supabase SQL Editor.
    </div>`;
    main.prepend(notice);
}

/* ---------- Start every page ---------- */
async function initLayout() {
    renderHeader(null, false);
    renderFooter();
    showSetupNotice();
    const user = await getCurrentUser();
    if (user) {
        renderHeader(user, false);
        const admin = await checkIsAdmin();
        if (admin) renderHeader(user, true);
    }
}

initLayout();
