/*
 * account.js - account.html
 *   SELECT own profile and orders, UPDATE profile, UPDATE order status
 *   (cancel a pending order; a trigger puts the items back in stock).
 */

let accountUser = null;

const PAYMENT_NAMES = {
    cash_on_delivery: "Cash on delivery",
    card_on_delivery: "Card on delivery"
};

async function loadProfile() {
    const form = $("#profile-form");
    const { data, error } = await supabaseClient
        .from("customers")
        .select("full_name, email, phone, city, address")
        .eq("customer_id", accountUser.id)
        .maybeSingle();

    if (error || !data) {
        showMessage($("#profile-message"), error ? friendlyError(error) : "Profile not found. Run database.sql again to create it.", "error");
        return;
    }
    $("#welcome-name").textContent = data.full_name.split(" ")[0];
    form.fullName.value = data.full_name;
    form.email.value = data.email;
    form.phone.value = data.phone || "";
    form.city.value = data.city || "";
    form.address.value = data.address || "";
}

async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#profile-message");
    const values = {
        full_name: form.fullName.value.trim(),
        phone: form.phone.value.trim() || null,
        city: form.city.value || null,
        address: form.address.value.trim() || null
    };

    if (values.full_name.length < 3) {
        showMessage(message, "Please enter your full name.", "error");
        return;
    }
    if (values.phone && !/^\+?[0-9\s-]{8,15}$/.test(values.phone)) {
        showMessage(message, "Please enter a valid phone number.", "error");
        return;
    }

    // UPDATE: only the columns the customer is allowed to change
    const { error } = await supabaseClient
        .from("customers")
        .update(values)
        .eq("customer_id", accountUser.id);

    if (error) {
        showMessage(message, friendlyError(error), "error");
        return;
    }
    showMessage(message, "Your details were saved.", "success");
    $("#welcome-name").textContent = values.full_name.split(" ")[0];
}

async function loadOrders() {
    const list = $("#order-list");
    const { data, error } = await supabaseClient
        .from("orders")
        .select("order_id, order_date, status, total, payment_method, shipping_city, order_items(quantity, unit_price, product(product_id, name))")
        .order("order_date", { ascending: false });

    if (error) {
        list.innerHTML = `<p class="alert alert--error">${escapeHtml(friendlyError(error))}</p>`;
        return;
    }

    if (data.length === 0) {
        list.innerHTML = `
        <div class="empty-state">
            <h3>No orders yet</h3>
            <p>When you place an order it will appear here.</p>
            <a href="products.html" class="btn">Start shopping</a>
        </div>`;
        return;
    }

    list.innerHTML = data.map(order => `
    <article class="order-card" data-order="${order.order_id}">
        <header class="order-card__head">
            <div>
                <h3>Order #${order.order_id}</h3>
                <p class="muted">${formatDate(order.order_date)} &middot; ${PAYMENT_NAMES[order.payment_method] || ""} &middot; ${escapeHtml(order.shipping_city)}</p>
            </div>
            <span class="badge badge--status badge--${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
        </header>
        <ul class="order-card__items">
            ${order.order_items.map(item => `
            <li>
                <a href="product-detail.html?id=${item.product.product_id}">${escapeHtml(item.product.name)}</a>
                <span class="muted">&times; ${item.quantity}</span>
                <span>${formatMoney(item.unit_price * item.quantity)}</span>
                ${order.status !== "cancelled"
                    ? `<a class="small-link" href="product-detail.html?id=${item.product.product_id}#reviews-section">Review</a>`
                    : ""}
            </li>`).join("")}
        </ul>
        <footer class="order-card__foot">
            <strong>Total ${formatMoney(order.total)}</strong>
            ${order.status === "pending"
                ? '<button type="button" class="btn btn--ghost btn--small btn--danger" data-cancel>Cancel order</button>'
                : ""}
        </footer>
    </article>`).join("");
}

async function cancelOrder(button) {
    if (button.dataset.confirm !== "yes") {
        button.dataset.confirm = "yes";
        button.textContent = "Click again to confirm";
        return;
    }
    const orderId = Number(button.closest("[data-order]").dataset.order);
    button.disabled = true;

    // UPDATE: RLS only allows the owner to cancel a pending order
    const { error } = await supabaseClient
        .from("orders")
        .update({ status: "cancelled" })
        .eq("order_id", orderId);

    if (error) {
        showToast(friendlyError(error), "error");
        button.disabled = false;
        return;
    }
    showToast(`Order #${orderId} was cancelled`);
    loadOrders();
}

async function initAccount() {
    accountUser = await requireLogin();
    if (!accountUser) return;

    const form = $("#profile-form");
    form.city.insertAdjacentHTML("beforeend", EMIRATES.map(e => `<option value="${e}">${e}</option>`).join(""));
    form.addEventListener("submit", saveProfile);

    $("#order-list").addEventListener("click", event => {
        const button = event.target.closest("[data-cancel]");
        if (button) cancelOrder(button);
    });

    await loadProfile();
    await loadOrders();
}

initAccount();
