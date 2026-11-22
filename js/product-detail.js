/*
 * product-detail.js - product-detail.html
 *   SELECT one product, its reviews and related products.
 *   Reviews: INSERT (new review), UPDATE (edit own review),
 *   DELETE (remove own review). RLS only lets verified buyers review.
 */

const productId = Number(getParam("id"));
let currentProduct = null;
let currentUser = null;
let myReview = null;

async function loadProduct() {
    const container = $("#product");
    if (!supabaseClient) {
        container.innerHTML = "";
        return;
    }
    if (!Number.isInteger(productId) || productId <= 0) {
        showNotFound();
        return;
    }

    const { data, error } = await supabaseClient
        .from("product_catalog")
        .select("*")
        .eq("product_id", productId)
        .maybeSingle();

    if (error) {
        container.innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        return;
    }
    if (!data) {
        showNotFound();
        return;
    }

    currentProduct = data;
    cacheProducts([data]);
    document.title = `${data.name} | Hirfa`;
    renderProduct(data);
}

function showNotFound() {
    $("#product").innerHTML = `
    <div class="empty-state">
        <h1>Product not found</h1>
        <p>This product may have been removed.</p>
        <a href="products.html" class="btn">Back to the shop</a>
    </div>`;
    $("#reviews-section").hidden = true;
    $("#related-section").hidden = true;
}

function renderProduct(p) {
    const soldOut = p.stock <= 0;
    const maxQty = Math.min(p.stock, STORE.maxQuantity);
    $("#breadcrumb-category").innerHTML =
        `<a href="products.html?category=${encodeURIComponent(p.category_slug)}">${escapeHtml(p.category_name)}</a>`;
    $("#breadcrumb-name").textContent = p.name;

    $("#product").innerHTML = `
    <div class="product-detail__media" style="background:${tintFor(p.product_id)}">
        <img src="${escapeHtml(productImage(p))}" alt="${escapeHtml(p.name)}">
    </div>
    <div class="product-detail__info">
        <p class="eyebrow">${escapeHtml(p.category_name)}</p>
        <h1>${escapeHtml(p.name)}</h1>
        <p class="product-detail__artisan">Handmade by <strong>${escapeHtml(p.artisan)}</strong></p>
        <a href="#reviews-section" class="rating-line">
            ${starsHtml(p.avg_rating)}
            <span>${Number(p.avg_rating).toFixed(1)} &middot; ${p.review_count} review${Number(p.review_count) === 1 ? "" : "s"}</span>
        </a>
        <p class="product-detail__price">${formatMoney(p.price)} <span class="muted">incl. VAT</span></p>
        <p class="stock ${soldOut ? "stock--out" : p.stock <= 5 ? "stock--low" : "stock--in"}">
            ${soldOut ? "Sold out" : p.stock <= 5 ? `Only ${p.stock} left in stock` : `In stock (${p.stock} available)`}
        </p>
        <p class="product-detail__description">${escapeHtml(p.description)}</p>
        ${p.materials ? `<p><strong>Materials:</strong> ${escapeHtml(p.materials)}</p>` : ""}

        <form id="add-form" class="add-form">
            <label for="quantity">Quantity</label>
            <input type="number" id="quantity" name="quantity" min="1" max="${Math.max(maxQty, 1)}" value="1" ${soldOut ? "disabled" : ""} required>
            <button type="submit" class="btn btn--large" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out" : "Add to cart"}</button>
        </form>

        <ul class="perks">
            <li>Delivery across all 7 emirates in 2 to 4 working days</li>
            <li>Free delivery on orders from ${formatMoney(STORE.freeDeliveryFrom)}</li>
            <li>Pay by cash or card when your order arrives</li>
        </ul>
    </div>`;

    const form = $("#add-form");
    form.addEventListener("submit", event => {
        event.preventDefault();
        const qty = Number(form.quantity.value);
        if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
            showToast(`Please choose between 1 and ${maxQty}.`, "error");
            return;
        }
        const added = Cart.add(p, qty);
        if (added === 0) {
            showToast("You already have all available stock in your cart.", "error");
        } else if (added < qty) {
            showToast(`Only ${added} more could be added (stock limit).`, "error");
        } else {
            showToast(`${p.name} added to your cart`);
        }
    });
}

/* ---------- Reviews ---------- */
async function loadReviews() {
    if (!supabaseClient || !currentProduct) return;

    const { data, error } = await supabaseClient
        .from("reviews")
        .select("review_id, customer_id, reviewer_name, rating, comment, created_at, updated_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

    if (error) {
        $("#review-list").innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        return;
    }

    myReview = currentUser ? data.find(r => r.customer_id === currentUser.id) || null : null;
    renderReviewSummary(data);
    renderReviewList(data);
    renderReviewForm();
}

function renderReviewSummary(reviews) {
    const count = reviews.length;
    const average = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
    const bars = [5, 4, 3, 2, 1].map(star => {
        const n = reviews.filter(r => r.rating === star).length;
        const pct = count ? Math.round((n / count) * 100) : 0;
        return `
        <div class="bar-row">
            <span>${star} &#9733;</span>
            <span class="bar"><span style="width:${pct}%"></span></span>
            <span class="muted">${n}</span>
        </div>`;
    }).join("");

    $("#review-summary").innerHTML = `
        <p class="review-summary__score">${average.toFixed(1)}</p>
        ${starsHtml(average)}
        <p class="muted">${count} review${count === 1 ? "" : "s"}</p>
        <div class="bars">${bars}</div>`;
}

function renderReviewList(reviews) {
    const list = $("#review-list");
    if (reviews.length === 0) {
        list.innerHTML = '<p class="muted">No reviews yet. Customers who buy this item can be the first to review it.</p>';
        return;
    }
    list.innerHTML = reviews.map(r => `
        <article class="review${currentUser && r.customer_id === currentUser.id ? " review--mine" : ""}">
            <header>
                ${starsHtml(r.rating)}
                <strong>${escapeHtml(r.reviewer_name)}</strong>
                <span class="badge badge--success">Verified buyer</span>
                <span class="muted">${formatDate(r.created_at)}${r.updated_at ? " (edited)" : ""}</span>
            </header>
            ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : ""}
        </article>`).join("");
}

function renderReviewForm() {
    const box = $("#review-form-box");
    if (!currentUser) {
        box.innerHTML = `<p>Bought this item? <a href="login.html?redirect=${encodeURIComponent(currentPageWithQuery())}">Log in</a> to write a review.</p>`;
        return;
    }

    const editing = Boolean(myReview);
    box.innerHTML = `
    <form id="review-form" class="review-form" novalidate>
        <h3>${editing ? "Edit your review" : "Write a review"}</h3>
        <fieldset class="star-input">
            <legend>Your rating</legend>
            ${[5, 4, 3, 2, 1].map(n => `
                <input type="radio" id="star-${n}" name="rating" value="${n}" ${myReview && myReview.rating === n ? "checked" : ""}>
                <label for="star-${n}" title="${n} star${n > 1 ? "s" : ""}">&#9733;<span class="sr-only">${n} star${n > 1 ? "s" : ""}</span></label>`).join("")}
        </fieldset>
        <label for="comment">Your review (optional)</label>
        <textarea id="comment" name="comment" rows="4" maxlength="1000" placeholder="What did you like about it?">${escapeHtml(myReview ? myReview.comment || "" : "")}</textarea>
        <div id="review-message" class="alert" hidden></div>
        <div class="form-actions">
            <button type="submit" class="btn">${editing ? "Update review" : "Submit review"}</button>
            ${editing ? '<button type="button" class="btn btn--ghost btn--danger" id="delete-review">Delete review</button>' : ""}
        </div>
        <p class="hint">Only customers who have ordered this product can review it.</p>
    </form>`;

    const form = $("#review-form");
    form.addEventListener("submit", submitReview);
    const del = $("#delete-review");
    if (del) del.addEventListener("click", deleteReview);
}

async function submitReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#review-message");
    const rating = Number(new FormData(form).get("rating"));
    const comment = form.comment.value.trim();

    if (!rating) {
        showMessage(message, "Please choose a rating from 1 to 5 stars.", "error");
        return;
    }

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;

    let result;
    if (myReview) {
        // UPDATE: change my existing review
        result = await supabaseClient
            .from("reviews")
            .update({ rating, comment: comment || null })
            .eq("review_id", myReview.review_id);
    } else {
        // INSERT: new review (RLS checks that I bought this product)
        result = await supabaseClient
            .from("reviews")
            .insert({ product_id: productId, rating, comment: comment || null });
    }

    button.disabled = false;
    if (result.error) {
        const text = result.error.code === "42501"
            ? "Only customers who have ordered this product can review it."
            : friendlyError(result.error);
        showMessage(message, text, "error");
        return;
    }

    showToast(myReview ? "Your review was updated" : "Thank you for your review!");
    await refreshAfterReviewChange();
}

async function deleteReview(event) {
    const button = event.currentTarget;
    if (button.dataset.confirm !== "yes") {
        button.dataset.confirm = "yes";
        button.textContent = "Click again to delete";
        return;
    }
    // DELETE: remove my review
    const { error } = await supabaseClient.from("reviews").delete().eq("review_id", myReview.review_id);
    if (error) {
        showMessage($("#review-message"), friendlyError(error), "error");
        return;
    }
    showToast("Your review was deleted");
    await refreshAfterReviewChange();
}

async function refreshAfterReviewChange() {
    await loadProduct();
    await loadReviews();
}

/* ---------- Related products ---------- */
async function loadRelated() {
    if (!supabaseClient || !currentProduct) return;
    const { data, error } = await supabaseClient
        .from("product_catalog")
        .select("*")
        .eq("category_id", currentProduct.category_id)
        .neq("product_id", productId)
        .gt("stock", 0)
        .limit(4);

    if (error || !data.length) {
        $("#related-section").hidden = true;
        return;
    }
    cacheProducts(data);
    $("#related-grid").innerHTML = data.map(productCardHtml).join("");
}

async function initProductPage() {
    currentUser = await getCurrentUser();
    await loadProduct();
    if (!currentProduct) return;
    loadReviews();
    loadRelated();
}

initProductPage();
