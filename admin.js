"use strict";

const loginPanel = document.querySelector("#admin-login");
const adminShell = document.querySelector("#admin-shell");
const adminFeedback = document.querySelector("#admin-feedback");
const loginFeedback = document.querySelector("#admin-login-feedback");
const viewDetails = {
  overview: ["Store overview", "A little snapshot of how your shop is doing."],
  orders: ["Orders", "Review payment notices and move each order through fulfilment."],
  products: ["Products", "Add new items, update product details, or remove items from your shop."],
  customers: ["Customers", "A quick look at the people who shop with A&M."],
  messages: ["Messages", "Notes and questions sent to A&M by shoppers."],
};
let dashboard = { orders: [], customers: [], messages: [], products: [], summary: {} };
let activeView = "overview";
let editingProductId = null;
let productPreviewUrl = null;
const money = new Intl.NumberFormat("en-NG");

async function requestApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatPrice(value) {
  return `₦${money.format(Number(value) || 0)}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function customerName(order) {
  return order.customer?.name || "Customer";
}

function productImageSource(image, width = 120) {
  if (typeof image !== "string") return "";
  if (/^\/api\/product-images\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif|avif|bmp)$/.test(image)) return image;
  if (/^https:\/\//i.test(image)) return image;
  return `https://images.unsplash.com/${encodeURIComponent(image)}?auto=format&fit=crop&w=${width}&q=80`;
}

function orderItems(order) {
  return (Array.isArray(order.items) ? order.items : []).map((item) => {
    const product = dashboard.products.find((entry) => entry.id === item.id);
    return { ...item, image: item.image || product?.image || "" };
  });
}

function availableOrderActions(order) {
  if (order.status === "Cancelled" || order.status === "Delivered") return [];
  if (order.paymentStatus !== "Confirmed") {
    return [["confirm_payment", "Confirm payment"], ["cancel", "Cancel order"]];
  }
  if (order.status === "Paid — processing" || order.status === "Confirmed — payment received") {
    return [["processing", "Start processing"]];
  }
  if (order.status === "Processing") return [["shipped", "Mark shipped"]];
  if (order.status === "Shipped") return [["in_transit", "Mark in transit"]];
  if (order.status === "In transit") return [["delivered", "Mark delivered"]];
  return [];
}

function orderActionControl(order) {
  const availableActions = new Set(availableOrderActions(order).map(([action]) => action));
  const allActions = [
    ["confirm_payment", "Confirm payment"],
    ["processing", "Start processing"],
    ["shipped", "Mark shipped"],
    ["in_transit", "Mark in transit"],
    ["delivered", "Mark delivered"],
    ["cancel", "Cancel order"],
  ];
  const canUpdate = availableActions.size > 0;
  return `<div class="admin-row-actions">
    <select class="admin-order-action-select" aria-label="Choose next status for order ${escapeHtml(order.id)}">
      <option value="">Choose status</option>
      ${allActions.map(([action, label]) => `<option value="${action}"${availableActions.has(action) ? "" : " disabled"}>${escapeHtml(label)}</option>`).join("")}
    </select>
    <button class="admin-action-button" type="button" data-order-update data-order-id="${escapeHtml(order.id)}"${canUpdate ? "" : " disabled"}>Update</button>
  </div>`;
}

function orderRow(order) {
  const paymentStatus = order.paymentStatus || "Not recorded";
  const statusClass = paymentStatus === "Confirmed" ? "is-confirmed" : "is-pending";
  const items = orderItems(order);
  return `<tr>
    <td><strong>${escapeHtml(order.id)}</strong><small>${items.reduce((sum, item) => sum + item.quantity, 0)} item(s)</small></td>
    <td><div class="admin-order-items">${items.map((item) => `<div class="admin-order-item">
      ${item.image ? `<img src="${escapeHtml(productImageSource(item.image))}" alt="" loading="lazy" />` : '<span class="admin-order-item-placeholder" aria-hidden="true">A&amp;M</span>'}
      <span>${escapeHtml(item.name)}<small>Qty ${escapeHtml(item.quantity)}</small></span>
    </div>`).join("")}</div></td>
    <td>${escapeHtml(customerName(order))}<small>${escapeHtml(order.customer?.phone || "")}</small></td>
    <td>${escapeHtml(formatDate(order.date))}</td>
    <td><strong>${formatPrice(order.total)}</strong><small>Delivery ${formatPrice(order.deliveryFee)}</small></td>
    <td><span class="admin-status ${statusClass}">${escapeHtml(paymentStatus)}</span></td>
    <td><span class="admin-order-status">${escapeHtml(order.status)}</span></td>
    <td>${orderActionControl(order)}</td>
  </tr>`;
}

function renderOrders() {
  const search = (document.querySelector("#order-search")?.value || "").trim().toLowerCase();
  const orders = dashboard.orders.filter((order) => [
    order.id,
    customerName(order),
    order.customer?.email,
    order.status,
    order.paymentStatus,
  ].join(" ").toLowerCase().includes(search));
  const rows = orders.map(orderRow).join("");
  document.querySelector("#overview-order-rows").innerHTML = dashboard.orders.slice(0, 5).map(orderRow).join("");
  document.querySelector("#order-rows").innerHTML = rows;
  document.querySelector("#overview-orders-empty").hidden = dashboard.orders.length > 0;
  document.querySelector("#orders-empty").hidden = orders.length > 0;
}

function renderCustomers() {
  const search = (document.querySelector("#customer-search")?.value || "").trim().toLowerCase();
  const customers = dashboard.customers.filter((customer) =>
    [customer.firstName, customer.lastName, customer.email, customer.phone, customer.city, customer.region]
      .join(" ").toLowerCase().includes(search));
  document.querySelector("#customer-list").innerHTML = customers.map((customer) => `
    <article class="admin-customer-card">
      <div class="admin-customer-avatar" aria-hidden="true">${escapeHtml((customer.firstName || "A").slice(0, 1).toUpperCase())}${escapeHtml((customer.lastName || "M").slice(0, 1).toUpperCase())}</div>
      <div class="admin-customer-main"><strong>${escapeHtml(customer.firstName)} ${escapeHtml(customer.lastName)}</strong><span>${escapeHtml(customer.email)} · ${escapeHtml(customer.phone)}</span><small>${escapeHtml(customer.address)}, ${escapeHtml(customer.city)}, ${escapeHtml(customer.region)}</small></div>
      <div class="admin-customer-meta"><strong>${customer.orderCount}</strong><span>orders</span><small>Joined ${escapeHtml(formatDate(customer.createdAt))}</small></div>
    </article>
  `).join("");
  document.querySelector("#customers-empty").hidden = customers.length > 0;
}

function renderMessages() {
  document.querySelector("#message-list").innerHTML = dashboard.messages.map((message) => `
    <article class="admin-message-card">
      <div class="admin-message-head"><div><strong>${escapeHtml(message.name)}</strong><span>${escapeHtml(message.phone)}</span></div><time>${escapeHtml(formatDate(message.date))}</time></div>
      <p>${escapeHtml(message.message)}</p>
    </article>
  `).join("");
  document.querySelector("#messages-empty").hidden = dashboard.messages.length > 0;
}

function renderProducts() {
  const products = Array.isArray(dashboard.products) ? dashboard.products : [];
  document.querySelector("#admin-product-list").innerHTML = products.map((product) => `
    <article class="admin-product-card">
      <img class="admin-product-image" src="${escapeHtml(productImageSource(product.image, 240))}" alt="${escapeHtml(product.name)}" loading="lazy" />
      <div class="admin-product-card-copy">
        <span class="eyebrow">${escapeHtml(product.category)} · ${escapeHtml(product.tag)}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.detail)}</p>
        <strong>${formatPrice(product.price)}</strong>
        <div class="admin-product-actions">
          <button type="button" data-product-edit="${escapeHtml(product.id)}">Edit</button>
          <button type="button" data-product-delete="${escapeHtml(product.id)}">Delete</button>
        </div>
      </div>
    </article>
  `).join("");
  document.querySelector("#products-empty").hidden = products.length > 0;
}

function resetProductForm() {
  editingProductId = null;
  if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
  productPreviewUrl = null;
  document.querySelector("#product-form").reset();
  document.querySelector("#product-image-preview").hidden = true;
  document.querySelector("#product-image-preview").removeAttribute("src");
  document.querySelector("#product-form-title").textContent = "Add a product";
  document.querySelector("#product-save-button").textContent = "Add product";
  document.querySelector("#product-cancel-edit").hidden = true;
  document.querySelector("#product-form-panel").hidden = true;
  document.querySelector("#admin-add-product").setAttribute("aria-expanded", "false");
}

function editProduct(product) {
  const form = document.querySelector("#product-form");
  resetProductForm();
  editingProductId = product.id;
  document.querySelector("#product-form-panel").hidden = false;
  document.querySelector("#admin-add-product").setAttribute("aria-expanded", "true");
  for (const [name, value] of Object.entries(product)) {
    const input = form.elements.namedItem(name);
    if (input) input.value = value;
  }
  const preview = document.querySelector("#product-image-preview");
  preview.src = productImageSource(product.image, 240);
  preview.hidden = !product.image;
  document.querySelector("#product-form-title").textContent = `Edit ${product.name}`;
  document.querySelector("#product-save-button").textContent = "Save changes";
  document.querySelector("#product-cancel-edit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSummary() {
  document.querySelector("#stat-orders").textContent = dashboard.summary.orders || 0;
  document.querySelector("#stat-pending").textContent = dashboard.summary.pendingPayments || 0;
  document.querySelector("#stat-customers").textContent = dashboard.summary.customers || 0;
  document.querySelector("#stat-revenue").textContent = formatPrice(dashboard.summary.confirmedRevenue);
  document.querySelector("#admin-pending-count").textContent = dashboard.summary.pendingPayments || 0;
}

async function loadDashboard() {
  const result = await requestApi("/api/admin/dashboard");
  dashboard = result;
  renderSummary();
  renderOrders();
  renderCustomers();
  renderMessages();
  renderProducts();
  loginPanel.hidden = true;
  adminShell.hidden = false;
}

function setView(view) {
  if (!viewDetails[view]) return;
  activeView = view;
  document.querySelectorAll(".admin-view").forEach((element) => {
    element.hidden = element.id !== `admin-view-${view}`;
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    const isActive = button.dataset.adminView === view;
    button.classList.toggle("active", isActive);
    if (button.matches("nav button")) button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  document.querySelector("#admin-view-title").textContent = viewDetails[view][0];
  document.querySelector("#admin-view-description").textContent = viewDetails[view][1];
}

document.querySelector("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  loginFeedback.textContent = "Signing in…";
  try {
    await requestApi("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      }),
    });
    form.reset();
    await loadDashboard();
  } catch (error) {
    loginFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-admin-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.adminView));
});
document.querySelector("#admin-refresh").addEventListener("click", async () => {
  const button = document.querySelector("#admin-refresh");
  button.disabled = true;
  try {
    await loadDashboard();
    setView(activeView);
    adminFeedback.textContent = "Store data refreshed.";
  } catch (error) {
    adminFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#order-search").addEventListener("input", renderOrders);
document.querySelector("#customer-search").addEventListener("input", renderCustomers);
document.querySelector("#product-cancel-edit").addEventListener("click", resetProductForm);
document.querySelector("#admin-add-product").addEventListener("click", () => {
  const panel = document.querySelector("#product-form-panel");
  if (!panel.hidden) {
    resetProductForm();
    return;
  }
  resetProductForm();
  panel.hidden = false;
  document.querySelector("#admin-add-product").setAttribute("aria-expanded", "true");
  document.querySelector("#product-form").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#product-form").elements.imageFile.addEventListener("change", (event) => {
  const [file] = event.currentTarget.files;
  const preview = document.querySelector("#product-image-preview");
  if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
  productPreviewUrl = null;
  if (!file) {
    const image = document.querySelector("#product-form").elements.image.value.trim();
    preview.src = productImageSource(image, 240);
    preview.hidden = !image;
    return;
  }
  productPreviewUrl = URL.createObjectURL(file);
  preview.src = productPreviewUrl;
  preview.hidden = false;
});
document.querySelector("#product-form").elements.image.addEventListener("input", (event) => {
  if (document.querySelector("#product-form").elements.imageFile.files.length) return;
  const preview = document.querySelector("#product-image-preview");
  preview.src = productImageSource(event.currentTarget.value.trim(), 240);
  preview.hidden = !event.currentTarget.value.trim();
});
document.querySelector("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#product-save-button");
  const fields = Object.fromEntries(new FormData(form));
  const imageFile = fields.imageFile;
  delete fields.imageFile;
  fields.price = Number(fields.price);
  button.disabled = true;
  adminFeedback.textContent = "";
  try {
    if (imageFile.size > 5 * 1024 * 1024) throw new Error("Images must be 5 MB or smaller.");
    if (imageFile.size > 0) {
      const bytes = new Uint8Array(await imageFile.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const uploaded = await requestApi("/api/admin/product-images", {
        method: "POST",
        body: JSON.stringify({ data: `data:${imageFile.type || "application/octet-stream"};base64,${btoa(binary)}` }),
      });
      fields.image = uploaded.image;
    }
    if (!String(fields.image || "").trim()) {
      throw new Error("Choose an image from your device or enter an image ID or HTTPS image URL.");
    }
    await requestApi(editingProductId === null
      ? "/api/admin/products"
      : `/api/admin/products/${encodeURIComponent(editingProductId)}`, {
      method: editingProductId === null ? "POST" : "PUT",
      body: JSON.stringify(fields),
    });
    resetProductForm();
    await loadDashboard();
    setView("products");
    adminFeedback.textContent = "Product saved and the storefront catalog is updated.";
  } catch (error) {
    adminFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.querySelector(".admin-content").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-product-edit]");
  if (editButton) {
    const product = dashboard.products.find((entry) => entry.id === Number(editButton.dataset.productEdit));
    if (product) editProduct(product);
    return;
  }
  const deleteButton = event.target.closest("[data-product-delete]");
  if (deleteButton) {
    const product = dashboard.products.find((entry) => entry.id === Number(deleteButton.dataset.productDelete));
    if (!product || !window.confirm(`Delete "${product.name}" from the storefront? Existing orders will keep their item details.`)) return;
    deleteButton.disabled = true;
    adminFeedback.textContent = "";
    try {
      await requestApi(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      if (editingProductId === product.id) resetProductForm();
      await loadDashboard();
      setView("products");
      adminFeedback.textContent = "Product deleted from the storefront catalog.";
    } catch (error) {
      adminFeedback.textContent = error.message;
      deleteButton.disabled = false;
    }
    return;
  }
  const button = event.target.closest("[data-order-update]");
  if (!button) return;
  const orderId = button.dataset.orderId;
  if (!orderId) {
    adminFeedback.textContent = "This order is missing its ID. Refresh the orders list and try again.";
    return;
  }
  const actionSelect = button.parentElement.querySelector(".admin-order-action-select");
  if (!actionSelect.value) {
    adminFeedback.textContent = "Choose an order status before updating it.";
    return;
  }
  button.disabled = true;
  adminFeedback.textContent = "";
  try {
    await requestApi(`/api/admin/orders/${encodeURIComponent(orderId)}/action`, {
      method: "POST",
      body: JSON.stringify({ action: actionSelect.value }),
    });
    await loadDashboard();
    setView(activeView);
    adminFeedback.textContent = "Order updated. The customer can see the new status in their account.";
  } catch (error) {
    adminFeedback.textContent = error.message;
    button.disabled = false;
  }
});
document.querySelector("#admin-logout").addEventListener("click", async () => {
  try {
    await requestApi("/api/admin/logout", { method: "POST" });
    adminShell.hidden = true;
    loginPanel.hidden = false;
    loginFeedback.textContent = "You are signed out.";
  } catch (error) {
    adminFeedback.textContent = error.message;
  }
});
document.querySelector("#admin-date-label").textContent = new Date().toLocaleDateString("en-NG", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

async function initializeAdmin() {
  try {
    const { authenticated } = await requestApi("/api/admin/session");
    if (authenticated) {
      await loadDashboard();
      return;
    }
    loginPanel.hidden = false;
    adminShell.hidden = true;
  } catch (error) {
    loginPanel.hidden = false;
    loginFeedback.textContent = error.message;
  }
}

initializeAdmin();
