/*
 * home.js - index.html
 *   SELECT categories and featured products from Supabase
 */

async function loadCategories() {
    const grid = $("#category-grid");
    if (!supabaseClient) {
        grid.innerHTML = "";
        return;
    }

    const { data, error } = await supabaseClient
        .from("category")
        .select("category_id, name, slug, description, image_url")
        .order("category_id");

    if (error) {
        grid.innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        return;
    }

    grid.innerHTML = data.map(c => `
        <a class="category-card" href="products.html?category=${encodeURIComponent(c.slug)}" style="background:${tintFor(c.category_id)}">
            <img src="${escapeHtml(c.image_url || "images/categories/gifts.svg")}" alt="" loading="lazy">
            <span class="category-card__name">${escapeHtml(c.name)}</span>
            <span class="category-card__text">${escapeHtml(c.description || "")}</span>
        </a>`).join("");
}

async function loadFeatured() {
    const grid = $("#featured-grid");
    if (!supabaseClient) {
        grid.innerHTML = "";
        return;
    }
    grid.innerHTML = skeletonCards(4);

    const { data, error } = await supabaseClient
        .from("product_catalog")
        .select("*")
        .eq("is_featured", true)
        .order("avg_rating", { ascending: false })
        .limit(8);

    if (error) {
        grid.innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        return;
    }
    cacheProducts(data);
    grid.innerHTML = data.length
        ? data.map(productCardHtml).join("")
        : '<p class="muted">No featured products yet.</p>';
}

$("#hero-search").addEventListener("submit", event => {
    event.preventDefault();
    const q = $("#hero-q").value.trim();
    window.location.href = q ? `products.html?q=${encodeURIComponent(q)}` : "products.html";
});

loadCategories();
loadFeatured();
