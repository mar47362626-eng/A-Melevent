let products = [];

const pageContent = {
  All: { title: "Shop all — A&M", heading: "The good <em>stuff.</em>" },
  Wigs: { title: "Wigs — A&M", heading: "Good hair, <em>good mood.</em>" },
  Beauty: { title: "Beauty — A&M", heading: "A little more <em>glow.</em>" },
  Fragrance: { title: "Fragrance — A&M", heading: "Find your <em>signature.</em>" },
  Shoes: { title: "Shoes — A&M", heading: "Step out <em>your way.</em>" },
};
const pageCategory = pageContent[document.body.dataset.category] ? document.body.dataset.category : "All";
const state = { category: pageCategory, search: "", sort: "featured", bag: loadBag() };
const productGrid = document.querySelector("#product-grid");
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
let activeCustomer = null;
let toastTimer;
let selectedProduct = null;

async function requestApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function continueAfterAccountAccess() {
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  if (returnTo === "checkout.html") window.location.replace(returnTo);
}

const announcement = document.querySelector(".announcement");
const menuToggle = document.querySelector(".menu-toggle");
const siteHeader = menuToggle?.closest(".site-header");
const mainNavigation = siteHeader?.querySelector(".main-nav");
const chatOpen = document.querySelector("#chat-open");
const chatClose = document.querySelector("#chat-close");
const chatPanel = document.querySelector("#chat-panel");
const chatForm = document.querySelector("#chat-form");

function setChatOpen(isOpen) {
  if (!chatOpen || !chatPanel) return;
  chatPanel.hidden = !isOpen;
  chatOpen.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) document.querySelector("#chat-name")?.focus();
  else chatOpen.focus();
}

chatOpen?.addEventListener("click", () => setChatOpen(true));
chatClose?.addEventListener("click", () => setChatOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chatPanel && !chatPanel.hidden) setChatOpen(false);
});
chatForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const status = document.querySelector("#chat-form-status");
  const submit = form.querySelector('[type="submit"]');
  if (!form.reportValidity()) return;

  const whatsappText = `Hello A&M! My name is ${name}.\nMy phone number is ${phone}.\n\n${message}`;
  const whatsappUrl = `https://wa.me/2349138154963?${new URLSearchParams({ text: whatsappText })}`;
  const whatsappWindow = window.open("about:blank", "_blank");
  submit.disabled = true;
  status.textContent = "Saving your message…";
  requestApi("/api/messages", {
    method: "POST",
    body: JSON.stringify({ name, phone, message }),
  }).then(() => {
    if (whatsappWindow) {
      whatsappWindow.location.href = whatsappUrl;
      status.textContent = "Your message is saved. WhatsApp opened with your message ready to send.";
    } else {
      status.replaceChildren(document.createTextNode("Your message is saved. "));
      const link = document.createElement("a");
      link.href = whatsappUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open WhatsApp to send it.";
      status.append(link);
    }
  }).catch((error) => {
    whatsappWindow?.close();
    status.textContent = error.message;
  }).finally(() => {
    submit.disabled = false;
  });
});

function setMenuOpen(isOpen) {
  if (!menuToggle || !siteHeader) return;
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  siteHeader.classList.toggle("menu-open", isOpen);
}

menuToggle?.addEventListener("click", () => {
  setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
});
mainNavigation?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenuOpen(false));
});
document.addEventListener("click", (event) => {
  if (siteHeader && !siteHeader.contains(event.target)) setMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuOpen(false);
});
window.matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
  if (event.matches) setMenuOpen(false);
});

announcement?.querySelectorAll('.announcement-group:not([aria-hidden="true"]) a').forEach((link, index) => {
  link.style.setProperty("--slide-index", index);
});
if (announcement?.querySelector('.announcement-group:not([aria-hidden="true"]) a')) {
  announcement.classList.add("is-sliding");
}

function loadBag() {
  try {
    const saved = JSON.parse(localStorage.getItem("am-shop-bag") || "[]");
    return Array.isArray(saved) ? saved.filter((item) => Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch {
    return [];
  }
}

function getActiveCustomer() {
  return activeCustomer;
}

function updateAccountIcon() {
  const icon = document.querySelector(".account-icon");
  if (!icon) return;
  const customer = getActiveCustomer();
  icon.classList.toggle("signed-in", Boolean(customer));
  icon.setAttribute("aria-label", customer ? "My profile" : "Register or log in");
  icon.title = customer ? "My profile" : "Register or log in";
}

function addProfileCard(parent, className, title, message, date) {
  const card = document.createElement("article");
  card.className = className;
  const heading = document.createElement("strong");
  heading.textContent = title;
  card.append(heading);
  const body = document.createElement("p");
  body.textContent = message;
  card.append(body);
  if (date) {
    const time = document.createElement("time");
    time.dateTime = date;
    time.textContent = new Date(date).toLocaleString();
    card.append(time);
  }
  parent.append(card);
}

function renderCustomerProfile(customer) {
  const profile = document.querySelector("#profile-panel");
  if (!profile) return;
  document.querySelector("#profile-first-name").textContent = customer.firstName;
  document.querySelector("#profile-name").textContent = `${customer.firstName} ${customer.lastName}`;
  document.querySelector("#profile-email").textContent = customer.email;
  document.querySelector("#profile-phone").textContent = customer.phone || "Not provided";
  document.querySelector("#profile-address").textContent = [customer.address, customer.city, customer.region].filter(Boolean).join(", ") || "No delivery address saved";

  const orders = Array.isArray(customer.orders) ? customer.orders : [];
  const inbox = Array.isArray(customer.inbox) ? customer.inbox : [];
  document.querySelector("#profile-order-count").textContent = orders.length;
  document.querySelector("#profile-inbox-count").textContent = inbox.length;

  const orderList = document.querySelector("#profile-orders-list");
  orderList.replaceChildren();
  if (orders.length === 0) {
    addProfileCard(orderList, "profile-empty", "No orders yet", "Your saved order requests will appear here after checkout.");
  } else {
    orders.forEach((order) => {
      const card = document.createElement("article");
      card.className = "profile-order";
      const heading = document.createElement("div");
      heading.className = "profile-order-head";
      const orderTitle = document.createElement("strong");
      orderTitle.textContent = order.id;
      const total = document.createElement("strong");
      total.textContent = formatPrice(order.total);
      heading.append(orderTitle, total);
      const status = document.createElement("span");
      status.className = `profile-order-status${order.paymentStatus === "Confirmed" ? " is-confirmed" : " is-pending"}`;
      status.textContent = order.status || "Status unavailable";
      card.append(heading, status);

      const items = document.createElement("div");
      items.className = "profile-order-items";
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const product = products.find((entry) => entry.id === item.id);
        const imageValue = item.image || product?.image;
        const itemRow = document.createElement("div");
        itemRow.className = "profile-order-item";
        if (imageValue) {
          const image = document.createElement("img");
          image.src = productImage(imageValue, 160);
          image.alt = item.name || "Ordered product";
          image.loading = "lazy";
          itemRow.append(image);
        } else {
          const placeholder = document.createElement("span");
          placeholder.className = "profile-order-item-placeholder";
          placeholder.textContent = "A&M";
          itemRow.append(placeholder);
        }
        const itemDetails = document.createElement("span");
        itemDetails.className = "profile-order-item-details";
        const name = document.createElement("strong");
        name.textContent = item.name || "Product";
        const quantity = document.createElement("small");
        quantity.textContent = `Quantity: ${item.quantity}`;
        itemDetails.append(name, quantity);
        itemRow.append(itemDetails);
        items.append(itemRow);
      });
      card.append(items);

      const deliverySummary = order.deliveryFee == null
        ? ""
        : `Delivery ${formatPrice(order.deliveryFee)}${order.deliveryEstimate ? " (estimate)" : ""}`;
      const orderMeta = document.createElement("p");
      orderMeta.textContent = [formatOrderDate(order.date), deliverySummary].filter(Boolean).join(" · ");
      card.append(orderMeta);
      orderList.append(card);
    });
  }

  const inboxList = document.querySelector("#profile-inbox-list");
  inboxList.replaceChildren();
  if (inbox.length === 0) {
    addProfileCard(inboxList, "profile-empty", "Your inbox is clear", "Order updates and account messages will appear here.");
  } else {
    inbox.forEach((item) => addProfileCard(inboxList, "profile-message-card", item.subject, item.message, item.date));
  }
}

async function refreshCustomerProfile() {
  if (!activeCustomer || !document.querySelector("#profile-panel")) return;
  try {
    const { customer } = await requestApi("/api/me");
    activeCustomer = customer;
    renderCustomerProfile(customer);
    updateAccountIcon();
  } catch (error) {
    if (error.status !== 401) throw error;
    activeCustomer = null;
    updateAccountIcon();
    showAccountAccess("Your session has ended. Please log in again to view your account.");
  }
}

function showCustomerProfile(customer) {
  const panel = document.querySelector("#profile-panel");
  if (!panel) return;
  document.querySelector(".account-tabs").hidden = true;
  document.querySelector(".account-intro").hidden = true;
  document.querySelector("#register-panel").hidden = true;
  document.querySelector("#login-panel").hidden = true;
  document.querySelector("#account-demo-note").hidden = true;
  document.querySelector("#account-message").hidden = true;
  panel.hidden = false;
  renderCustomerProfile(customer);
  updateAccountIcon();
}

function showAccountAccess(message) {
  const panel = document.querySelector("#profile-panel");
  if (!panel) return;
  panel.hidden = true;
  document.querySelector(".account-tabs").hidden = false;
  document.querySelector(".account-intro").hidden = false;
  document.querySelector("#register-panel").hidden = false;
  document.querySelector("#login-panel").hidden = true;
  document.querySelector("#account-demo-note").hidden = false;
  document.querySelector("#login-tab").click();
  const accountMessage = document.querySelector("#account-message");
  accountMessage.hidden = false;
  accountMessage.textContent = message;
}

function formatPrice(price) {
  return `₦${price.toLocaleString("en-NG")}`;
}

function formatOrderDate(value) {
  return value
    ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : "Date unavailable";
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

function productImage(id, width = 700) {
  if (typeof id === "string" && /^\/api\/product-images\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif|avif|bmp)$/.test(id)) return id;
  if (typeof id === "string" && /^https:\/\//i.test(id)) return new URL(id).href;
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;
}

function filteredProducts() {
  let items = products.filter((product) => {
    const matchesCategory = state.category === "All" || product.category === state.category;
    const query = state.search.trim().toLowerCase();
    const matchesSearch = !query || `${product.name} ${product.category} ${product.detail}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  if (state.sort === "low-high") items = items.sort((a, b) => a.price - b.price);
  if (state.sort === "high-low") items = items.sort((a, b) => b.price - a.price);
  return items;
}

async function loadProducts() {
  const result = await requestApi("/api/products");
  if (!Array.isArray(result.products)) {
    throw new Error("The product catalog is empty or invalid.");
  }
  products = result.products;
  state.bag = state.bag.filter((item) => products.some((product) => product.id === item.id));
  renderProducts();
  renderBag();
}

function renderProducts() {
  if (!productGrid) return;
  const items = filteredProducts();
  productGrid.innerHTML = items.map((product) => `
    <article class="product-card" data-product="${product.id}">
      <div class="product-image">
        <img src="${escapeHtml(productImage(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy" />
        <span class="product-tag">${escapeHtml(product.tag)}</span>
        <button class="product-view" type="button" data-view="${product.id}" aria-label="View details for ${escapeHtml(product.name)}"></button>
        <button class="quick-add" data-add="${product.id}" aria-label="Add ${escapeHtml(product.name)} to bag">Add to bag&nbsp; +</button>
      </div>
      <div class="product-info">
        <div>
          <h3><button class="product-name-button" type="button" data-view="${product.id}">${escapeHtml(product.name)}</button></h3>
          <p>${escapeHtml(product.detail)}</p>
        </div>
        <p class="product-price">${formatPrice(product.price)}</p>
      </div>
    </article>
  `).join("");
  emptyState.hidden = items.length > 0;
  productGrid.hidden = items.length === 0;
  const resultText = state.search
    ? `${items.length} ${items.length === 1 ? "find" : "finds"} for you`
    : state.category === "All"
      ? "Showing all favourites"
      : `Showing all ${state.category.toLowerCase()}`;
  document.querySelector("#results-count").textContent = resultText;
}

function createProductDialog() {
  if (!productGrid || document.querySelector("#product-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.className = "product-dialog";
  dialog.id = "product-dialog";
  dialog.setAttribute("aria-labelledby", "product-dialog-title");
  dialog.innerHTML = `
    <button class="product-dialog-close icon-button" type="button" aria-label="Close product details">×</button>
    <div class="product-dialog-layout">
      <img class="product-dialog-image" alt="" />
      <div class="product-dialog-copy">
        <span class="eyebrow product-dialog-category"></span>
        <h2 id="product-dialog-title"></h2>
        <p class="product-dialog-meta"></p>
        <p class="product-dialog-description"></p>
        <strong class="product-dialog-price"></strong>
        <button class="button button-dark product-dialog-add" type="button">Add to bag <span aria-hidden="true">+</span></button>
      </div>
    </div>
  `;
  document.body.append(dialog);
  dialog.querySelector(".product-dialog-close").addEventListener("click", () => dialog.close());
  dialog.querySelector(".product-dialog-add").addEventListener("click", () => {
    if (!selectedProduct) return;
    addToBag(selectedProduct.id);
    dialog.close();
  });
}

function openProductDialog(productId) {
  const product = products.find((item) => item.id === productId);
  const dialog = document.querySelector("#product-dialog");
  if (!product || !dialog) return;
  selectedProduct = product;
  dialog.querySelector(".product-dialog-image").src = productImage(product.image);
  dialog.querySelector(".product-dialog-image").alt = product.name;
  dialog.querySelector(".product-dialog-category").textContent = product.category;
  dialog.querySelector("#product-dialog-title").textContent = product.name;
  dialog.querySelector(".product-dialog-meta").textContent = product.detail;
  dialog.querySelector(".product-dialog-description").textContent = product.description;
  dialog.querySelector(".product-dialog-price").textContent = formatPrice(product.price);
  dialog.showModal();
}

function persistBag() {
  localStorage.setItem("am-shop-bag", JSON.stringify(state.bag));
  renderBag();
}

function addToBag(id) {
  const existing = state.bag.find((item) => item.id === id);
  if (existing) existing.quantity += 1;
  else state.bag.push({ id, quantity: 1 });
  persistBag();
  const product = products.find((item) => item.id === id);
  showToast(`${product.name} added to your bag`);
}

function renderBag() {
  const count = state.bag.reduce((total, item) => total + item.quantity, 0);
  const total = state.bag.reduce((sum, item) => sum + products.find((product) => product.id === item.id).price * item.quantity, 0);
  document.querySelector("#bag-count").textContent = count;
  const appBagCount = document.querySelector("#app-bag-count");
  if (appBagCount) appBagCount.textContent = count;
  document.querySelector("#drawer-count").textContent = `(${count})`;
  document.querySelector("#bag-subtotal").textContent = formatPrice(total);
  document.querySelector("#bag-items").innerHTML = state.bag.map((item) => {
    const product = products.find((entry) => entry.id === item.id);
    return `<article class="bag-row">
      <img src="${escapeHtml(productImage(product.image, 200))}" alt="" />
      <div><h3>${escapeHtml(product.name)}</h3><p>${formatPrice(product.price)}</p>
        <div class="quantity-controls">
          <button data-quantity="${product.id}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
          <span>${item.quantity}</span>
          <button data-quantity="${product.id}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
        </div>
      </div>
      <p class="bag-row-price">${formatPrice(product.price * item.quantity)}</p>
    </article>`;
  }).join("");
  document.querySelector("#bag-empty").hidden = count > 0;
  document.querySelector("#drawer-footer").hidden = count === 0;
  document.querySelector("#bag-items").hidden = count === 0;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function openBag() {
  document.querySelector("#drawer-backdrop").hidden = false;
  document.querySelector("#bag-drawer").classList.add("open");
  document.querySelector("#bag-drawer").setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  document.querySelector("#bag-close").focus();
}

function closeBag() {
  document.querySelector("#bag-drawer").classList.remove("open");
  document.querySelector("#bag-drawer").setAttribute("aria-hidden", "true");
  document.querySelector("#drawer-backdrop").hidden = true;
  document.body.classList.remove("drawer-open");
  document.querySelector("#bag-open").focus();
}

if (productGrid) {
  createProductDialog();
  productGrid.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add]");
    if (addButton) {
      addToBag(Number(addButton.dataset.add));
      return;
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) openProductDialog(Number(viewButton.dataset.view));
  });
}
document.querySelector("#bag-items").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity]");
  if (!button) return;
  const item = state.bag.find((entry) => entry.id === Number(button.dataset.quantity));
  item.quantity += Number(button.dataset.change);
  if (item.quantity <= 0) state.bag = state.bag.filter((entry) => entry !== item);
  persistBag();
});
document.querySelector("#search-input")?.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderProducts();
});
document.querySelector("#sort-select")?.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderProducts();
});
document.querySelector("#bag-open").addEventListener("click", openBag);
document.querySelector("[data-app-bag]")?.addEventListener("click", openBag);
document.querySelector("#bag-close").addEventListener("click", closeBag);
document.querySelector("#drawer-backdrop").addEventListener("click", closeBag);
document.querySelector("#keep-shopping").addEventListener("click", closeBag);
document.querySelector("#checkout-button").addEventListener("click", () => {
  const customer = getActiveCustomer();
  window.location.href = customer
    ? "checkout.html"
    : "account.html?mode=login&returnTo=checkout.html";
});
document.querySelector("#newsletter-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = String(new FormData(form).get("email") || "").trim();
  const status = document.querySelector("#newsletter-message");
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  requestApi("/api/newsletter", {
    method: "POST",
    body: JSON.stringify({ email }),
  }).then(() => {
    status.textContent = "You're on the list. Keep an eye on your inbox!";
    form.reset();
  }).catch((error) => {
    status.textContent = error.message;
  }).finally(() => {
    submit.disabled = false;
  });
});
document.querySelectorAll("[data-account-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const selectedTab = tab.dataset.accountTab;
    document.querySelectorAll("[data-account-tab]").forEach((candidate) => {
      const isActive = candidate === tab;
      candidate.classList.toggle("active", isActive);
      candidate.setAttribute("aria-selected", String(isActive));
    });
    document.querySelector("#register-panel").hidden = selectedTab !== "register";
    document.querySelector("#login-panel").hidden = selectedTab !== "login";
    document.querySelector("#account-message").textContent = "";
  });
});
document.querySelector("#register-panel")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#register-password");
  const confirmation = document.querySelector("#confirm-password");
  if (password.value !== confirmation.value) {
    confirmation.setCustomValidity("Passwords do not match.");
    confirmation.reportValidity();
    confirmation.addEventListener("input", () => confirmation.setCustomValidity(""), { once: true });
    return;
  }
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await requestApi("/api/register", {
      method: "POST",
      body: JSON.stringify({
          firstName: String(formData.get("given-name")).trim(),
          lastName: String(formData.get("family-name")).trim(),
          email: String(formData.get("email")).trim(),
          phone: String(formData.get("tel")).trim(),
          address: String(formData.get("street-address") || "").trim(),
          city: String(formData.get("address-level2") || "").trim(),
          region: String(formData.get("address-level1") || "").trim(),
          password: password.value,
      }),
    });
    activeCustomer = result.customer;
    form.reset();
    if (new URLSearchParams(window.location.search).get("returnTo") === "checkout.html") {
      continueAfterAccountAccess();
      return;
    }
    showCustomerProfile(activeCustomer);
  } catch (error) {
    document.querySelector("#account-message").textContent = `${error.message} No account was created.`;
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#login-panel")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await requestApi("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(formData.get("email")).trim(),
        password: String(formData.get("current-password")),
      }),
    });
    activeCustomer = result.customer;
    form.reset();
    if (new URLSearchParams(window.location.search).get("returnTo") === "checkout.html") {
      continueAfterAccountAccess();
      return;
    }
    showCustomerProfile(activeCustomer);
  } catch (error) {
    document.querySelector("#account-message").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
document.querySelector("#logout-button")?.addEventListener("click", async () => {
  try {
    await requestApi("/api/logout", { method: "POST" });
    activeCustomer = null;
    window.location.href = "account.html";
  } catch (error) {
    document.querySelector("#account-message").hidden = false;
    document.querySelector("#account-message").textContent = error.message;
  }
});
document.querySelectorAll("[data-profile-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const selected = tab.dataset.profileTab;
    document.querySelectorAll("[data-profile-tab]").forEach((candidate) => {
      const active = candidate === tab;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".profile-section").forEach((section) => {
      section.hidden = section.id !== `profile-${selected}`;
    });
    window.history.replaceState(null, "", `#${selected}`);
    if (selected === "orders" && activeCustomer) {
      refreshCustomerProfile().catch((error) => {
        document.querySelector("#account-message").hidden = false;
        document.querySelector("#account-message").textContent = `Could not refresh your orders: ${error.message}`;
      });
    }
  });
});
if (document.body.dataset.category === "Account") {
  window.setInterval(() => {
    if (document.visibilityState === "visible" && activeCustomer) {
      refreshCustomerProfile().catch((error) => {
        console.error("Could not refresh customer orders:", error);
      });
    }
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && activeCustomer) {
      refreshCustomerProfile().catch((error) => {
        console.error("Could not refresh customer orders:", error);
      });
    }
  });
}
document.querySelector("#year").textContent = new Date().getFullYear();
document.title = document.body.dataset.category === "Account"
  ? "Your account — A&M"
  : document.body.dataset.home === "true"
    ? "A&M — Your everyday, elevated"
    : pageContent[pageCategory].title;
const shopTitle = document.querySelector("#shop-title");
if (shopTitle) shopTitle.innerHTML = pageContent[pageCategory].heading;

const pageLinks = {
  All: "shop-all.html",
  Wigs: "wigs.html",
  Beauty: "beauty.html",
  Fragrance: "fragrance.html",
  Shoes: "shoes.html",
};
document.querySelectorAll(".main-nav a, .category-links a").forEach((link) => {
  const isCurrentPage = link.getAttribute("href") === pageLinks[pageCategory];
  if (isCurrentPage) {
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
  } else {
    link.classList.remove("active");
    link.removeAttribute("aria-current");
  }
});

loadProducts().catch((error) => {
  console.error("Could not load product catalog:", error);
  if (productGrid) {
    productGrid.hidden = true;
    emptyState.hidden = false;
    emptyState.querySelector("h3").textContent = "Products could not be loaded.";
    emptyState.querySelector("p").textContent = `${error.message} Check that the A&M server is running, then reload this page.`;
  }
  document.querySelector("#bag-count").textContent = "0";
  const appBagCount = document.querySelector("#app-bag-count");
  if (appBagCount) appBagCount.textContent = "0";
  document.querySelector("#drawer-count").textContent = "(0)";
  document.querySelector("#bag-subtotal").textContent = formatPrice(0);
  document.querySelector("#bag-empty").hidden = false;
  document.querySelector("#drawer-footer").hidden = true;
  document.querySelector("#bag-items").hidden = true;
});

const accountPage = document.body.dataset.category === "Account";
requestApi("/api/session").then(({ customer }) => {
  activeCustomer = customer;
  updateAccountIcon();
  if (!customer) {
    if (accountPage && new URLSearchParams(window.location.search).get("mode") === "login") {
      document.querySelector("#login-tab").click();
    }
    return;
  }
  if (accountPage && new URLSearchParams(window.location.search).get("returnTo") === "checkout.html") {
    continueAfterAccountAccess();
    return;
  }
  if (accountPage) {
    showCustomerProfile(customer);
    const initialProfileTab = window.location.hash.slice(1);
    const tab = document.querySelector(`[data-profile-tab="${initialProfileTab}"]`);
    if (tab) tab.click();
  }
}).catch((error) => {
  activeCustomer = null;
  updateAccountIcon();
  if (!accountPage) {
    console.error("Could not check the customer session:", error);
    return;
  }
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  if (requestedMode === "login") document.querySelector("#login-tab").click();
  if (error.message !== "Please log in to view your account.") {
    document.querySelector("#account-message").textContent = `${error.message} Start the A&M server, then reload this page.`;
  }
});
