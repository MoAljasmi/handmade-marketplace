/*
 * confirmation.js - order-confirmation.html
 *   SELECT the new order together with its items (RLS: own orders only)
 */

const PAYMENT_LABELS = {
    cash_on_delivery: "Cash on delivery",
    card_on_delivery: "Card on delivery"
};

async function loadConfirmation() {
    const box = $("#confirmation");
    const user = await requireLogin();
    if (!user) return;

    const orderId = Number(getParam("order"));
    if (!Number.isInteger(orderId) || orderId <= 0) {
        box.innerHTML = '<p class="alert alert--error">Order not found.</p>';
        return;
    }

    const { data: order, error } = await supabaseClient
        .from("orders")
        .select("order_id, order_date, status, shipping_name, shipping_phone, shipping_city, shipping_address, payment_method, subtotal, delivery_fee, vat, total, order_items(quantity, unit_price, product(product_id, name, image_url))")
        .eq("order_id", orderId)
        .maybeSingle();

    if (error || !order) {
        box.innerHTML = `<p class="alert alert--error">${error ? escapeHtml(friendlyError(error)) : "Order not found."}</p>`;
        return;
    }

    box.innerHTML = `
    <div class="confirmation__head">
        <div class="check-circle" aria-hidden="true">&#10003;</div>
        <h1>Thank you for your order!</h1>
        <p>Order <strong>#${order.order_id}</strong> was placed on ${formatDate(order.order_date)}.
           The makers are preparing your items.</p>
    </div>

    <div class="confirmation__grid">
        <section class="card">
            <h2>Items</h2>
            <ul class="summary-list">
                ${order.order_items.map(item => `
                <li>
                    <span class="summary-thumb" style="background:${tintFor(item.product.product_id)}"><img src="${escapeHtml(productImage(item.product))}" alt=""></span>
                    <span class="summary-name">${escapeHtml(item.product.name)} <span class="muted">&times; ${item.quantity}</span></span>
                    <span>${formatMoney(item.unit_price * item.quantity)}</span>
                </li>`).join("")}
            </ul>
            ${totalsHtml({ subtotal: Number(order.subtotal), delivery: Number(order.delivery_fee), vat: Number(order.vat), total: Number(order.total) })
                .replace(/<p class="hint">[\s\S]*<\/p>/, "")}
        </section>
        <section class="card">
            <h2>Delivery</h2>
            <p><strong>${escapeHtml(order.shipping_name)}</strong><br>
               ${escapeHtml(order.shipping_address)}<br>
               ${escapeHtml(order.shipping_city)}, UAE<br>
               ${escapeHtml(order.shipping_phone)}</p>
            <h2>Payment</h2>
            <p>${PAYMENT_LABELS[order.payment_method] || escapeHtml(order.payment_method)}.
               Please have ${formatMoney(order.total)} ready when the courier arrives.</p>
            <p><span class="badge badge--status badge--${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></p>
        </section>
    </div>

    <div class="form-actions form-actions--center">
        <a href="account.html#orders" class="btn">View my orders</a>
        <a href="products.html" class="btn btn--ghost">Continue shopping</a>
    </div>`;
}

loadConfirmation();
