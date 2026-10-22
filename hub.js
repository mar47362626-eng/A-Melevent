"use strict";

const loginPanel = document.querySelector("#hub-login");
const hubShell = document.querySelector("#hub-shell");
const loginFeedback = document.querySelector("#hub-login-feedback");
const loginForm = document.querySelector("#hub-login-form");
const registerForm = document.querySelector("#hub-register-form");
const registerFeedback = document.querySelector("#hub-register-feedback");
const verifyForm = document.querySelector("#hub-verify-form");
const verifyFeedback = document.querySelector("#hub-verify-feedback");
const feedback = document.querySelector("#hub-feedback");
const orderPanel = document.querySelector("#hub-order-panel");
const searchForm = document.querySelector("#hub-search-form");
const orderNumberInput = document.querySelector("#hub-order-number");
let activeOrder = null;

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

function setHubSignedIn(isSignedIn) {
  loginPanel.hidden = isSignedIn;
  hubShell.hidden = !isSignedIn;
}

function setAuthMode(mode) {
  loginForm.hidden = mode !== "login";
  registerForm.hidden = mode !== "register";
  verifyForm.hidden = mode !== "verify";
  document.querySelector("#hub-show-register").hidden = mode !== "login";
  document.querySelector("#hub-show-login").hidden = mode === "login";
  if (mode === "login") loginForm.elements.email.focus();
  if (mode === "register") registerForm.elements.email.focus();
  if (mode === "verify") verifyForm.elements.code.focus();
}

function nextHubAction(order) {
  if (order.paymentStatus !== "Confirmed") return null;
  if (order.status === "Processing") return ["picked", "Mark order picked"];
  if (order.status === "Picked") return ["shipped", "Hand parcel to delivery"];
  if (order.status === "Shipped") return ["in_transit", "Mark in transit"];
  if (order.status === "In transit") return ["delivered", "Mark delivered"];
  return null;
}

function showOrder(order) {
  activeOrder = order;
  orderPanel.hidden = false;
  document.querySelector("#hub-order-id").textContent = order.id;
  document.querySelector("#hub-order-status").textContent = order.status;
  document.querySelector("#hub-customer-name").textContent = order.customer?.name || "Customer";
  document.querySelector("#hub-customer-email").textContent = order.customer?.email || "";
  document.querySelector("#hub-customer-phone").textContent = order.customer?.phone || "";
  document.querySelector("#hub-delivery-street").textContent = order.deliveryAddress?.street || "Address not provided";
  document.querySelector("#hub-delivery-city").textContent = [
    order.deliveryAddress?.city,
    order.deliveryAddress?.state,
  ].filter(Boolean).join(", ");
  document.querySelector("#hub-payment-status").textContent = order.paymentStatus || "Not recorded";
  document.querySelector("#hub-payment-method").textContent = order.paymentMethod || "";

  const itemsList = document.querySelector("#hub-items-list");
  itemsList.replaceChildren();
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    const quantity = document.createElement("span");
    name.textContent = item.name || "Product";
    quantity.textContent = `Quantity: ${item.quantity}`;
    row.append(name, quantity);
    itemsList.append(row);
  }

  const nextAction = nextHubAction(order);
  const nextStepCopy = document.querySelector("#hub-next-step-copy");
  const nextStepButton = document.querySelector("#hub-next-step-button");
  if (nextAction) {
    nextStepCopy.textContent = "Confirm the items are correct before moving this order to the next delivery stage.";
    nextStepButton.textContent = nextAction[1];
    nextStepButton.dataset.action = nextAction[0];
    nextStepButton.hidden = false;
    nextStepButton.disabled = false;
  } else {
    nextStepButton.hidden = true;
    nextStepButton.removeAttribute("data-action");
    nextStepCopy.textContent = order.paymentStatus !== "Confirmed"
      ? "Payment is not confirmed. Do not pick or dispatch this order; ask an admin to review it."
      : order.status === "Delivered" || order.status === "Cancelled"
        ? "This order is complete and has no further hub actions."
        : "This order is not ready for a hub action. Ask an admin to move it to Processing.";
  }
}

document.querySelector("#hub-show-register").addEventListener("click", () => {
  loginFeedback.textContent = "";
  registerFeedback.textContent = "";
  setAuthMode("register");
});

document.querySelector("#hub-show-login").addEventListener("click", () => {
  verifyFeedback.textContent = "";
  registerFeedback.textContent = "";
  setAuthMode("login");
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  registerFeedback.textContent = "Creating account and sending your verification email…";
  try {
    const result = await requestApi("/api/hub/register", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
        inviteCode: String(data.get("inviteCode")),
      }),
    });
    const registeredEmail = String(data.get("email")).trim();
    verifyForm.elements.email.value = registeredEmail;
    verifyForm.elements.inviteCode.value = String(data.get("inviteCode"));
    form.reset();
    verifyFeedback.textContent = result.message;
    setAuthMode("verify");
  } catch (error) {
    registerFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  verifyFeedback.textContent = "Verifying your email…";
  try {
    const result = await requestApi("/api/hub/verify", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")).trim(),
        code: String(data.get("code")).trim(),
      }),
    });
    const verifiedEmail = String(data.get("email")).trim();
    verifyForm.reset();
    loginForm.elements.email.value = verifiedEmail;
    loginFeedback.textContent = result.message;
    setAuthMode("login");
  } catch (error) {
    verifyFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#hub-resend-code").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const data = new FormData(verifyForm);
  button.disabled = true;
  verifyFeedback.textContent = "Requesting a new verification code…";
  try {
    const result = await requestApi("/api/hub/resend-verification", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")).trim(),
        inviteCode: String(data.get("inviteCode")),
      }),
    });
    verifyFeedback.textContent = result.message;
  } catch (error) {
    verifyFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  loginFeedback.textContent = "Signing in…";
  try {
    await requestApi("/api/hub/login", {
      method: "POST",
      body: JSON.stringify({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      }),
    });
    form.reset();
    setHubSignedIn(true);
    orderNumberInput.focus();
  } catch (error) {
    loginFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const orderNumber = orderNumberInput.value.trim();
  if (!orderNumber) return;
  const button = searchForm.querySelector('[type="submit"]');
  button.disabled = true;
  feedback.textContent = "Looking up order…";
  orderPanel.hidden = true;
  try {
    const result = await requestApi(`/api/hub/orders/${encodeURIComponent(orderNumber)}`);
    showOrder(result.order);
    feedback.textContent = "";
  } catch (error) {
    activeOrder = null;
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#hub-next-step-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!activeOrder || !button.dataset.action) return;
  button.disabled = true;
  feedback.textContent = "Saving order update…";
  try {
    const result = await requestApi(`/api/hub/orders/${encodeURIComponent(activeOrder.id)}/action`, {
      method: "POST",
      body: JSON.stringify({ action: button.dataset.action }),
    });
    showOrder(result.order);
    feedback.textContent = "Order updated. Email notifications were attempted for the customer and store admin.";
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("#hub-logout").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await requestApi("/api/hub/logout", { method: "POST" });
    activeOrder = null;
    orderPanel.hidden = true;
    feedback.textContent = "";
    setHubSignedIn(false);
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

requestApi("/api/hub/session")
  .then(({ authenticated }) => {
    setHubSignedIn(authenticated);
    if (!authenticated) setAuthMode("login");
  })
  .catch((error) => {
    setHubSignedIn(false);
    loginFeedback.textContent = error.status === 404
      ? "The hub API is not available at this address. Open https://a-melevent.onrender.com/hub.html, or run the backend and use http://127.0.0.1:3000/hub.html. VS Code Live Server cannot run the hub API."
      : error.message;
  });
