/*
 * checkout.js - checkout.html
 *   1. INSERT the order into the orders table
 *   2. INSERT the purchased products into order_items
 *      (a database trigger copies the real price and reduces the stock)
 *   3. Optional UPDATE of the customer's saved address
 *   4. Clear the cart and open the confirmation page
 */

let checkoutUser = null;

function renderOrderSummary() {
    const items = Cart.items();
    $("#summary-items").innerHTML = items.map(item => `
        <li>
            <span class="summary-thumb" style="background:${tintFor(item.product_id)}"><img src="${escapeHtml(productImage(item))}" alt=""></span>
            <span class="summary-name">${escapeHtml(item.name)} <span class="muted">&times; ${item.quantity}</span></span>
            <span>${formatMoney(item.price * item.quantity)}</span>
        </li>`).join("");
    $("#summary-totals").innerHTML = totalsHtml(calculateTotals(Cart.subtotal()));
}

function fillEmirates(select) {
    select.insertAdjacentHTML("beforeend", EMIRATES.map(e => `<option value="${e}">${e}</option>`).join(""));
}

async function prefillFromProfile(form) {
    // SELECT: the logged-in customer's own profile (RLS: own row only)
    const { data } = await supabaseClient
        .from("customers")
        .select("full_name, phone, city, address")
        .eq("customer_id", checkoutUser.id)
        .maybeSingle();
    if (!data) return;
    form.receiver.value = data.full_name || "";
    form.phone.value = data.phone || "";
    if (data.city) form.city.value = data.city;
    form.address.value = data.address || "";
}

function validateCheckout(values) {
    if (values.name.length < 3) return "Please enter the receiver's full name.";
    if (!/^\+?[0-9\s-]{8,15}$/.test(values.phone)) return "Please enter a valid phone number, for example 050 123 4567.";
    if (!EMIRATES.includes(values.city)) return "Please choose an emirate.";
    if (values.address.length < 10) return "Please enter a full delivery address (area, street, building).";
    if (!["cash_on_delivery", "card_on_delivery"].includes(values.payment)) return "Please choose a payment method.";
    return "";
}

async function placeOrder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#checkout-message");
    const items = Cart.items();

    if (items.length === 0) {
        showMessage(message, "Your cart is empty.", "error");
        return;
    }

    const values = {
        name: form.receiver.value.trim(),
        phone: form.phone.value.trim(),
        city: form.city.value,
        address: form.address.value.trim(),
        payment: (new FormData(form).get("payment") || ""),
        notes: form.notes.value.trim(),
        saveAddress: form.saveAddress.checked
    };
    const problem = validateCheckout(values);
    if (problem) {
        showMessage(message, problem, "error");
        return;
    }

    const button = $("#place-order");
    button.disabled = true;
    button.textContent = "Placing order...";
    showMessage(message, "");

    try {
        // 1. INSERT the order (customer_id is filled from the login token)
        const { data: order, error: orderError } = await supabaseClient
            .from("orders")
            .insert({
                shipping_name: values.name,
                shipping_phone: values.phone,
                shipping_city: values.city,
                shipping_address: values.address,
                payment_method: values.payment,
                notes: values.notes || null
            })
            .select("order_id")
            .single();
        if (orderError) throw orderError;

        // 2. INSERT all order items in one request (all succeed or all fail)
        const rows = items.map(item => ({
            order_id: order.order_id,
            product_id: item.product_id,
            quantity: item.quantity
        }));
        const { error: itemsError } = await supabaseClient.from("order_items").insert(rows);
        if (itemsError) {
            // Mark the empty order as cancelled so it does not count in sales
            await supabaseClient.from("orders").update({ status: "cancelled" }).eq("order_id", order.order_id);
            throw itemsError;
        }

        // 3. UPDATE the saved delivery details (optional)
        if (values.saveAddress) {
            await supabaseClient
                .from("customers")
                .update({ phone: values.phone, city: values.city, address: values.address })
                .eq("customer_id", checkoutUser.id);
        }

        // 4. Done
        Cart.clear();
        window.location.href = `order-confirmation.html?order=${order.order_id}`;
    } catch (error) {
        const stockProblem = (error.message || "").startsWith("Not enough stock");
        showMessage(
            message,
            stockProblem
                ? `${error.message}. Please go back to your cart and update the quantity.`
                : friendlyError(error),
            "error"
        );
        button.disabled = false;
        button.textContent = "Place order";
    }
}

async function initCheckout() {
    checkoutUser = await requireLogin();
    if (!checkoutUser) return;

    if (Cart.items().length === 0) {
        $("#checkout-layout").innerHTML = `
        <div class="empty-state empty-state--wide">
            <h2>Your cart is empty</h2>
            <p>Add some products before checking out.</p>
            <a href="products.html" class="btn">Browse products</a>
        </div>`;
        return;
    }

    const form = $("#checkout-form");
    fillEmirates(form.city);
    renderOrderSummary();
    await prefillFromProfile(form);
    form.addEventListener("submit", placeOrder);
}

initCheckout();
