/*
 * products.js - products.html
 *   Search, category filter, sorting and SMART SEARCH.
 *   Every filter becomes part of the Supabase REST query, so the
 *   database does the searching (no hardcoded product arrays).
 */

const filterForm = $("#filters");
const productGrid = $("#product-grid");
const resultCount = $("#result-count");

const SORTS = {
    featured:   [["is_featured", false], ["name", true]],
    price_asc:  [["price", true], ["name", true]],
    price_desc: [["price", false], ["name", true]],
    rating:     [["avg_rating", false], ["review_count", false]],
    newest:     [["created_at", false]],
    name:       [["name", true]]
};

/* Keep only letters, numbers and hyphens so the keywords cannot break
   the REST filter syntax. Up to 5 keywords. */
function getKeywords(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter(word => word.length > 1)
        .slice(0, 5);
}

function readFilters() {
    const data = new FormData(filterForm);
    return {
        q: (data.get("q") || "").trim(),
        category: data.get("category") || "",
        min: data.get("min") || "",
        max: data.get("max") || "",
        rating: data.get("rating") || "",
        inStock: data.get("inStock") === "on",
        sort: SORTS[data.get("sort")] ? data.get("sort") : "featured"
    };
}

function writeFiltersToForm(filters) {
    filterForm.q.value = filters.q || "";
    filterForm.category.value = filters.category || "";
    filterForm.min.value = filters.min || "";
    filterForm.max.value = filters.max || "";
    filterForm.rating.value = filters.rating || "";
    filterForm.inStock.checked = Boolean(filters.inStock);
    filterForm.sort.value = filters.sort || "featured";
}

/* Keep the filters in the address bar so a search can be shared or bookmarked */
function syncUrl(filters) {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.category) params.set("category", filters.category);
    if (filters.min) params.set("min", filters.min);
    if (filters.max) params.set("max", filters.max);
    if (filters.rating) params.set("rating", filters.rating);
    if (filters.inStock) params.set("inStock", "1");
    if (filters.sort !== "featured") params.set("sort", filters.sort);
    const query = params.toString();
    history.replaceState(null, "", query ? `products.html?${query}` : "products.html");
}

function buildQuery(filters) {
    let query = supabaseClient.from("product_catalog").select("*");

    // Multiple keywords: every keyword must appear in the name,
    // description, artisan, materials or category name.
    const words = getKeywords(filters.q);
    const fieldsFor = word =>
        ["name", "description", "artisan", "materials", "category_name"]
            .map(field => `${field}.ilike.*${word}*`)
            .join(",");
    if (words.length === 1) {
        query = query.or(fieldsFor(words[0]));
    } else if (words.length > 1) {
        query = query.or(`and(${words.map(w => `or(${fieldsFor(w)})`).join(",")})`);
    }

    if (filters.category) query = query.eq("category_slug", filters.category);
    if (filters.min !== "") query = query.gte("price", Number(filters.min));
    if (filters.max !== "") query = query.lte("price", Number(filters.max));
    if (filters.rating) query = query.gte("avg_rating", Number(filters.rating));
    if (filters.inStock) query = query.gt("stock", 0);

    SORTS[filters.sort].forEach(([column, ascending]) => {
        query = query.order(column, { ascending });
    });
    return query;
}

function describeFilters(filters, count) {
    const parts = [];
    if (filters.q) parts.push(`matching "${filters.q}"`);
    if (filters.category) {
        const option = filterForm.category.selectedOptions[0];
        parts.push(`in ${option ? option.textContent : filters.category}`);
    }
    if (filters.min && filters.max) parts.push(`between ${formatMoney(filters.min)} and ${formatMoney(filters.max)}`);
    else if (filters.min) parts.push(`from ${formatMoney(filters.min)}`);
    else if (filters.max) parts.push(`up to ${formatMoney(filters.max)}`);
    if (filters.rating) parts.push(`rated ${filters.rating}+ stars`);
    if (filters.inStock) parts.push("in stock");
    const noun = count === 1 ? "product" : "products";
    return `${count} ${noun}${parts.length ? " " + parts.join(", ") : ""}`;
}

let searchToken = 0;

async function runSearch() {
    if (!supabaseClient) {
        productGrid.innerHTML = "";
        resultCount.textContent = "";
        return;
    }

    const filters = readFilters();
    const priceError = $("#price-error");
    if (filters.min !== "" && filters.max !== "" && Number(filters.min) > Number(filters.max)) {
        showMessage(priceError, "Minimum price must be lower than maximum price.", "error");
        return;
    }
    showMessage(priceError, "");
    syncUrl(filters);

    const token = ++searchToken;
    productGrid.setAttribute("aria-busy", "true");
    productGrid.innerHTML = skeletonCards(8);

    const { data, error } = await buildQuery(filters);
    if (token !== searchToken) return; // a newer search started

    productGrid.removeAttribute("aria-busy");
    if (error) {
        productGrid.innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        resultCount.textContent = "";
        return;
    }

    cacheProducts(data);
    resultCount.textContent = describeFilters(filters, data.length);
    productGrid.innerHTML = data.length
        ? data.map(productCardHtml).join("")
        : `<div class="empty-state empty-state--wide">
               <h2>No products found</h2>
               <p>Try fewer keywords, a wider price range or another category.</p>
               <button type="button" class="btn btn--ghost" id="clear-empty">Clear all filters</button>
           </div>`;
}

async function loadCategoryOptions() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from("category").select("name, slug").order("name");
    if (error) return;
    filterForm.category.insertAdjacentHTML(
        "beforeend",
        data.map(c => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join("")
    );
}

function clearFilters() {
    writeFiltersToForm({ sort: filterForm.sort.value });
    runSearch();
}

/* Quick "smart search" shortcuts */
const PRESETS = {
    under100: { max: "100", inStock: true, sort: "price_asc" },
    toprated: { rating: "4", sort: "rating" },
    gifts:    { category: "gifts", max: "150", inStock: true, sort: "price_asc" },
    newest:   { sort: "newest" }
};

let debounceTimer;

async function initProductsPage() {
    await loadCategoryOptions();

    writeFiltersToForm({
        q: getParam("q") || "",
        category: getParam("category") || "",
        min: getParam("min") || "",
        max: getParam("max") || "",
        rating: getParam("rating") || "",
        inStock: getParam("inStock") === "1",
        sort: SORTS[getParam("sort")] ? getParam("sort") : "featured"
    });

    filterForm.addEventListener("submit", event => {
        event.preventDefault();
        runSearch();
        $(".filters").classList.remove("is-open");
    });
    filterForm.addEventListener("change", event => {
        if (event.target.name !== "q") runSearch();
    });
    filterForm.q.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 400);
    });
    $("#clear-filters").addEventListener("click", clearFilters);
    productGrid.addEventListener("click", event => {
        if (event.target.id === "clear-empty") clearFilters();
    });

    $all("[data-preset]").forEach(button => {
        button.addEventListener("click", () => {
            writeFiltersToForm({ q: filterForm.q.value.trim(), ...PRESETS[button.dataset.preset] });
            runSearch();
        });
    });

    $("#toggle-filters").addEventListener("click", () => {
        const panel = $(".filters");
        const open = panel.classList.toggle("is-open");
        $("#toggle-filters").setAttribute("aria-expanded", String(open));
    });

    runSearch();
}

initProductsPage();
