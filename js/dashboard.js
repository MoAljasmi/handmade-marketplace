/*
 * dashboard.js - dashboard.html (administrators only)
 *   - calls the get_dashboard_stats() database function (RPC)
 *   - draws KPI cards, charts (Chart.js) and tables
 *   - UPDATE: restock a low-stock product (RLS: admins only)
 */

const CHART_COLORS = ["#B5532C", "#1F5F5B", "#C9A227", "#7A5C99", "#5B8DB8", "#A0522D", "#6B8E5A"];
const charts = {};

function kpiHtml(label, value, note = "") {
    return `
    <div class="kpi">
        <p class="kpi__label">${label}</p>
        <p class="kpi__value">${value}</p>
        ${note ? `<p class="kpi__note">${note}</p>` : ""}
    </div>`;
}

function renderKpis(s) {
    $("#kpis").innerHTML = [
        kpiHtml("Total sales", formatMoney(s.total_sales), "Excludes cancelled orders"),
        kpiHtml("Orders", s.total_orders, `${s.cancelled_orders} cancelled`),
        kpiHtml("Average order", formatMoney(s.avg_order_value)),
        kpiHtml("Products", s.total_products, `${s.total_stock_units} units in stock`),
        kpiHtml("Customers", s.total_customers),
        kpiHtml("Average rating", `${Number(s.avg_rating).toFixed(1)} &#9733;`, `${s.total_reviews} reviews`),
        kpiHtml("Low stock", s.low_stock.length, "5 units or fewer")
    ].join("");
}

function drawChart(id, config) {
    if (typeof Chart === "undefined") {
        $(`#${id}`).replaceWith(Object.assign(document.createElement("p"), {
            className: "muted",
            textContent: "Charts could not be loaded (check your internet connection)."
        }));
        return;
    }
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
}

function renderCharts(s) {
    const common = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
    };

    drawChart("chart-category", {
        type: "bar",
        data: {
            labels: s.sales_by_category.map(r => r.category),
            datasets: [{ label: "Revenue (AED)", data: s.sales_by_category.map(r => Number(r.revenue)), backgroundColor: CHART_COLORS[0], borderRadius: 6 }]
        },
        options: { ...common, scales: { y: { beginAtZero: true } } }
    });

    drawChart("chart-days", {
        type: "line",
        data: {
            labels: s.sales_last_14_days.map(r => new Date(r.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })),
            datasets: [{ label: "Revenue (AED)", data: s.sales_last_14_days.map(r => Number(r.revenue)), borderColor: CHART_COLORS[1], backgroundColor: "rgba(31,95,91,.12)", fill: true, tension: 0.3 }]
        },
        options: { ...common, scales: { y: { beginAtZero: true } } }
    });

    drawChart("chart-status", {
        type: "doughnut",
        data: {
            labels: s.orders_by_status.map(r => r.status),
            datasets: [{ data: s.orders_by_status.map(r => r.orders), backgroundColor: CHART_COLORS }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
}

function tableRows(rows, columns, empty) {
    if (!rows.length) return `<tr><td colspan="${columns.length}" class="muted">${empty}</td></tr>`;
    return rows.map(row => `<tr>${columns.map(col => `<td>${col(row)}</td>`).join("")}</tr>`).join("");
}

function renderTables(s) {
    $("#top-products").innerHTML = tableRows(s.top_products, [
        r => `<a href="product-detail.html?id=${r.product_id}">${escapeHtml(r.name)}</a>`,
        r => r.units_sold,
        r => formatMoney(r.revenue)
    ], "No sales yet.");

    $("#top-rated").innerHTML = tableRows(s.top_rated, [
        r => `<a href="product-detail.html?id=${r.product_id}">${escapeHtml(r.name)}</a>`,
        r => `${Number(r.avg_rating).toFixed(1)} &#9733;`,
        r => r.review_count
    ], "No reviews yet.");

    $("#low-stock").innerHTML = tableRows(s.low_stock, [
        r => `<a href="product-detail.html?id=${r.product_id}">${escapeHtml(r.name)}</a>`,
        r => `<span class="${r.stock === 0 ? "text-danger" : "text-warn"}">${r.stock}</span>`,
        r => `<form class="restock-form" data-product="${r.product_id}" data-stock="${r.stock}">
                 <label class="sr-only" for="restock-${r.product_id}">Units to add</label>
                 <input id="restock-${r.product_id}" type="number" min="1" max="500" value="10" required>
                 <button type="submit" class="btn btn--small">Restock</button>
              </form>`
    ], "All products have enough stock.");
}

async function restock(event) {
    const form = event.target.closest(".restock-form");
    if (!form) return;
    event.preventDefault();
    const add = Number(form.querySelector("input").value);
    if (!Number.isInteger(add) || add < 1) return;
    const newStock = Number(form.dataset.stock) + add;

    // UPDATE: only administrators pass the RLS policy on product
    const { error } = await supabaseClient
        .from("product")
        .update({ stock: newStock })
        .eq("product_id", Number(form.dataset.product));

    if (error) {
        showToast(friendlyError(error), "error");
        return;
    }
    showToast(`Stock updated to ${newStock}`);
    loadDashboard();
}

async function loadDashboard() {
    const { data, error } = await supabaseClient.rpc("get_dashboard_stats");
    if (error && error.code !== "42501") {
        showToast(friendlyError(error), "error");
        return;
    }
    if (error) {
        $("#dashboard").innerHTML = `
        <div class="empty-state empty-state--wide">
            <h2>Administrators only</h2>
            <p>This page shows business analytics, so it is limited to admin accounts.</p>
            <p class="hint">To make your account an admin, run this in the Supabase SQL Editor:<br>
            <code>update customers set is_admin = true where email = 'your-email';</code></p>
        </div>`;
        return;
    }
    $("#updated-at").textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    renderKpis(data);
    renderCharts(data);
    renderTables(data);
}

async function initDashboard() {
    const user = await requireLogin();
    if (!user) return;
    $("#low-stock").addEventListener("submit", restock);
    $("#refresh").addEventListener("click", loadDashboard);
    loadDashboard();
}

initDashboard();
