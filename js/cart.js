/*
 * cart.js - shopping cart saved in localStorage
 *   - Cart object used by every page (add, update, remove, totals)
 *   - "Add to cart" buttons on product cards
 *   - cart.html page: shows the items and checks prices/stock in Supabase
 */

const CART_KEY = "hirfa_cart_v1";

const Cart = {
    items() {
        try {
            const data = JSON.parse(localStorage.getItem(CART_KEY));
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    },

    save(items) {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(items));
        } catch {
            showToast("Your browser blocked saving the cart.", "error");
        }
        updateCartCount();
    },

    /* Returns the number of items actually added (0 when no more stock) */
    add(product, quantity = 1) {
        const items = this.items();
        const id = Number(product.product_id);
        const existing = items.find(i => i.product_id === id);
        const limit = Math.min(Number(product.stock) || 0, STORE.maxQuantity);
        const current = existing ? existing.quantity : 0;
        const newQuantity = Math.min(current + quantity, limit);
        const added = newQuantity - current;
        if (added <= 0) return 0;

        if (existing) {
            existing.quantity = newQuantity;
            existing.price = Number(product.price);
            existing.stock = Number(product.stock);
        } else {
            items.push({
                product_id: id,
                name: product.name,
                price: Number(product.price),
                image_url: product.image_url,
                stock: Number(product.stock),
                quantity: newQuantity
            });
        }
        this.save(items);
        return added;
    },

    setQuantity(productId, quantity) {
        const items = this.items();
        const item = items.find(i => i.product_id === productId);
        if (!item) return;
        const limit = Math.min(item.stock, STORE.maxQuantity);
        item.quantity = Math.max(1, Math.min(quantity, limit));
        this.save(items);
    },

    remove(productId) {
        this.save(this.items().filter(i => i.product_id !== productId));
    },

    clear() {
        this.save([]);
    },

    count() {
        return this.items().reduce((sum, i) => sum + i.quantity, 0);
    },

    subtotal() {
        return this.items().reduce((sum, i) => sum + i.price * i.quantity, 0);
    }
};

/* Same rules as the database trigger recalculate_order_total() */
function calculateTotals(subtotal) {
    const delivery = subtotal === 0 || subtotal >= STORE.freeDeliveryFrom ? 0 : STORE.deliveryFee;
    const total = subtotal + delivery;
    const vat = Math.round((total * STORE.vatRate / (1 + STORE.vatRate)) * 100) / 100;
    return { subtotal, delivery, vat, total };
}

function totalsHtml(totals) {
    const remaining = STORE.freeDeliveryFrom - totals.subtotal;
    return `
    <dl class="totals">
        <div><dt>Subtotal</dt><dd>${formatMoney(totals.subtotal)}</dd></div>
        <div><dt>Delivery</dt><dd>${totals.delivery === 0 ? "Free" : formatMoney(totals.delivery)}</dd></div>
        <div class="totals__total"><dt>Total</dt><dd>${formatMoney(totals.total)}</dd></div>
        <div class="totals__note"><dt>Includes VAT (5%)</dt><dd>${formatMoney(totals.vat)}</dd></div>
    </dl>
    ${totals.subtotal > 0 && remaining > 0
        ? `<p class="hint">Add ${formatMoney(remaining)} more for free delivery.</p>`
        : ""}`;
}

function updateCartCount() {
    const badge = document.getElementById("cart-count");
    if (!badge) return;
    const count = Cart.count();
    badge.textContent = count;
    badge.hidden = count === 0;
}

/* "Add to cart" buttons on product cards (any page) */
document.addEventListener("click", event => {
    const button = event.target.closest("[data-add-to-cart]");
    if (!button) return;
    const product = productCache.get(Number(button.dataset.addToCart));
    if (!product) return;
    const added = Cart.add(product, 1);
    if (added > 0) {
        showToast(`${product.name} added to your cart`);
    } else {
        showToast(`No more stock available for ${product.name}`, "error");
    }
});

/* ---------- cart.html ---------- */
async function refreshCartFromDatabase() {
    const items = Cart.items();
    if (!supabaseClient || items.length === 0) return;

    // SELECT: get the latest price and stock of the products in the cart
    const { data, error } = await supabaseClient
        .from("product")
        .select("product_id, name, price, stock, image_url")
        .in("product_id", items.map(i => i.product_id));

    if (error) return;

    const latest = new Map(data.map(p => [Number(p.product_id), p]));
    const updated = [];
    items.forEach(item => {
        const product = latest.get(item.product_id);
        if (!product) return; // product no longer sold
        updated.push({
            ...item,
            name: product.name,
            price: Number(product.price),
            stock: product.stock,
            image_url: product.image_url,
            quantity: Math.min(item.quantity, Math.max(product.stock, 1))
        });
    });
    Cart.save(updated);
}

function renderCartPage() {
    const list = $("#cart-items");
    const summary = $("#cart-summary");
    const items = Cart.items();

    if (items.length === 0) {
        list.innerHTML = `
        <div class="empty-state">
            <img src="images/categories/gifts.svg" alt="" width="140">
            <h2>Your cart is empty</h2>
            <p>Find something made by hand for you or someone you love.</p>
            <a href="products.html" class="btn">Browse products</a>
        </div>`;
        summary.hidden = true;
        return;
    }

    list.innerHTML = items.map(item => {
        const soldOut = item.stock <= 0;
        return `
        <article class="cart-item" data-id="${item.product_id}">
            <a href="product-detail.html?id=${item.product_id}" class="cart-item__media" style="background:${tintFor(item.product_id)}">
                <img src="${escapeHtml(productImage(item))}" alt="">
            </a>
            <div class="cart-item__info">
                <h3><a href="product-detail.html?id=${item.product_id}">${escapeHtml(item.name)}</a></h3>
                <p class="muted">${formatMoney(item.price)} each</p>
                ${soldOut ? '<p class="text-danger">Sold out. Please remove this item.</p>'
                          : item.stock <= 5 ? `<p class="text-warn">Only ${item.stock} left</p>` : ""}
            </div>
            <div class="qty" role="group" aria-label="Quantity for ${escapeHtml(item.name)}">
                <button type="button" data-qty="-1" aria-label="Decrease quantity" ${item.quantity <= 1 ? "disabled" : ""}>&minus;</button>
                <span>${item.quantity}</span>
                <button type="button" data-qty="1" aria-label="Increase quantity" ${item.quantity >= Math.min(item.stock, STORE.maxQuantity) ? "disabled" : ""}>+</button>
            </div>
            <p class="cart-item__total">${formatMoney(item.price * item.quantity)}</p>
            <button type="button" class="link-button" data-remove aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
        </article>`;
    }).join("");

    const hasSoldOut = items.some(i => i.stock <= 0);
    summary.hidden = false;
    $("#cart-totals").innerHTML = totalsHtml(calculateTotals(Cart.subtotal()));
    const checkout = $("#checkout-btn");
    checkout.classList.toggle("is-disabled", hasSoldOut);
    checkout.setAttribute("aria-disabled", String(hasSoldOut));
}

async function initCartPage() {
    renderCartPage();
    await refreshCartFromDatabase();
    renderCartPage();

    $("#cart-items").addEventListener("click", event => {
        const row = event.target.closest(".cart-item");
        if (!row) return;
        const id = Number(row.dataset.id);
        const qtyButton = event.target.closest("[data-qty]");
        if (qtyButton) {
            const item = Cart.items().find(i => i.product_id === id);
            Cart.setQuantity(id, item.quantity + Number(qtyButton.dataset.qty));
            renderCartPage();
        }
        if (event.target.closest("[data-remove]")) {
            Cart.remove(id);
            renderCartPage();
            showToast("Item removed");
        }
    });

    $("#checkout-btn").addEventListener("click", event => {
        if (event.currentTarget.classList.contains("is-disabled")) {
            event.preventDefault();
            showToast("Remove sold-out items before checkout.", "error");
        }
    });
}

if (document.body.dataset.page === "cart") {
    initCartPage();
}
updateCartCount();
