"use strict";

const BAG_KEY = "am-shop-bag";
const feedback = document.querySelector("#checkout-feedback");
const content = document.querySelector("#checkout-content");
const formatter = new Intl.NumberFormat("en-NG");
let bag = readBag();
let products = [];
let currentDeliveryQuote = null;

function readBag() {
  try {
    const items = JSON.parse(localStorage.getItem(BAG_KEY) || "[]");
    return Array.isArray(items)
      ? items.filter((item) => Number.isSafeInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 50)
      : [];
  } catch {
    return [];
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatPrice(price) {
  return `₦${formatter.format(price)}`;
}

async function requestApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function showError(message) {
  feedback.textContent = message;
  feedback.hidden = false;
}

function renderItems(totalElementIds, delivery) {
  currentDeliveryQuote = delivery;
  const items = bag.map((entry) => {
    const product = products.find((item) => item.id === entry.id);
    return product ? { ...product, quantity: entry.quantity } : null;
  }).filter(Boolean);
  if (items.length !== bag.length || items.length === 0) {
    showError("Your shopping bag is empty or has an unavailable item. Return to the shop and update your bag.");
    return false;
  }
  bag = items.map(({ id, quantity }) => ({ id, quantity }));
  localStorage.setItem(BAG_KEY, JSON.stringify(bag));
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  document.querySelector("#checkout-items").innerHTML = items.map((item) => `
    <article class="checkout-item">
      <img src="https://images.unsplash.com/${encodeURIComponent(item.image)}?auto=format&fit=crop&w=160&q=80" alt="" />
      <div><h3>${escapeHtml(item.name)}</h3><p>Qty ${item.quantity} · ${formatPrice(item.price)}</p></div>
      <strong>${formatPrice(item.price * item.quantity)}</strong>
    </article>
  `).join("");
  const grandTotal = total + delivery.fee;
  for (const id of totalElementIds) {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = formatPrice(grandTotal);
  }
  document.querySelectorAll("[data-items-subtotal]").forEach((element) => {
    element.textContent = formatPrice(total);
  });
  document.querySelectorAll("[data-delivery-fee]").forEach((element) => {
    element.textContent = formatPrice(delivery.fee);
  });
  document.querySelectorAll("[data-delivery-note]").forEach((element) => {
    element.textContent = delivery.estimate
      ? `Estimated delivery from ${delivery.origin} · ${delivery.tier.toLowerCase()}. The courier's final charge may differ.`
      : `Delivery from ${delivery.origin} · ${delivery.tier.toLowerCase()}.`;
  });
  return true;
}

function renderDeliveryAddress(customer) {
  document.querySelector("#checkout-customer-name").textContent = `${customer.firstName} ${customer.lastName}`;
  document.querySelector("#checkout-address").textContent = `${customer.address}, ${customer.city}, ${customer.region}`;
  document.querySelector("#checkout-contact").textContent = `${customer.email} · ${customer.phone}`;
  const form = document.querySelector("#delivery-address-form");
  form.elements.address.value = customer.address;
  form.elements.city.value = customer.city;
  form.elements.region.value = customer.region;
}

async function initializeReview() {
  try {
    const [productResult, profileResult, quoteResult] = await Promise.all([
      requestApi("/api/products"),
      requestApi("/api/me"),
      requestApi("/api/delivery/quote"),
    ]);
    products = productResult.products;
    if (!renderItems(["checkout-total"], quoteResult.delivery)) return;
    renderDeliveryAddress(profileResult.customer);
    content.hidden = false;
  } catch (error) {
    if (error.message.includes("log in")) {
      window.location.replace("account.html?mode=login&returnTo=checkout.html");
      return;
    }
    showError(error.message);
  }
}

document.querySelector("#edit-address-toggle")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const form = document.querySelector("#delivery-address-form");
  const isOpen = form.hidden;
  form.hidden = !isOpen;
  button.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) form.elements.address.focus();
});

document.querySelector("#delivery-address-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const message = document.querySelector("#address-form-message");
  if (!form.reportValidity()) return;
  submit.disabled = true;
  message.textContent = "Saving your delivery details…";
  try {
    const { customer } = await requestApi("/api/me/address", {
      method: "PUT",
      body: JSON.stringify({
        address: form.elements.address.value.trim(),
        city: form.elements.city.value.trim(),
        region: form.elements.region.value.trim(),
      }),
    });
    const { delivery } = await requestApi("/api/delivery/quote");
    renderDeliveryAddress(customer);
    if (renderItems(["checkout-total"], delivery)) {
      message.textContent = "Delivery details saved. Your delivery estimate and total have been updated.";
    }
    document.querySelector("#edit-address-toggle").focus();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

async function initializePayment() {
  try {
    const [productResult, quoteResult] = await Promise.all([
      requestApi("/api/products"),
      requestApi("/api/delivery/quote"),
    ]);
    products = productResult.products;
    if (!renderItems(["checkout-total", "checkout-total-summary"], quoteResult.delivery)) return;
    content.hidden = false;
    document.querySelector("#checkout-confirm-payment").addEventListener("click", submitOrder);
  } catch (error) {
    if (error.message.includes("log in")) {
      window.location.replace("account.html?mode=login&returnTo=checkout.html");
      return;
    }
    showError(error.message);
  }
}

async function submitOrder(event) {
  const button = event.currentTarget;
  button.disabled = true;
  feedback.hidden = true;
  try {
    const { delivery } = await requestApi("/api/delivery/quote");
    if (delivery.fee !== currentDeliveryQuote?.fee) {
      renderItems(["checkout-total", "checkout-total-summary"], delivery);
      showError(`Your delivery estimate changed. The updated total is ${document.querySelector("#checkout-total").textContent}. Please transfer this amount before submitting your payment notice.`);
      button.disabled = false;
      return;
    }
    await requestApi("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: bag }),
    });
    localStorage.removeItem(BAG_KEY);
    window.location.replace("index.html");
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
}

if (document.body.dataset.checkoutStep === "review") {
  initializeReview().then(() => {
    document.querySelector("#checkout-continue").addEventListener("click", () => {
      window.location.href = "payment.html";
    });
  });
} else {
  initializePayment();
}
