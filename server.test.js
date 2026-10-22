"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, randomUUID, scryptSync } = require("node:crypto");
const { after, before, test } = require("node:test");
const { createServer } = require("./server");
const { SupabaseStore } = require("./supabase-store");

let server;
let baseUrl;
let dataDir;
let productsFile;
let sessionCookie;
let adminCookie;
let hubCookie;
let testOrderId;

async function post(route, body, cookie = sessionCookie) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function adminPost(route, body, cookie = adminCookie) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function hubPost(route, body, cookie = hubCookie) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "am-store-test-"));
  productsFile = path.join(dataDir, "products.json");
  await fs.copyFile(path.join(__dirname, "data", "products.json"), productsFile);
  const passwordSalt = randomBytes(16);
  await fs.writeFile(path.join(dataDir, "admin.json"), `${JSON.stringify({
    email: "owner@example.com",
    passwordSalt: passwordSalt.toString("hex"),
    passwordHash: scryptSync("test-admin-secret", passwordSalt, 64).toString("hex"),
  })}\n`);
  const hubPasswordSalt = randomBytes(16);
  await fs.writeFile(path.join(dataDir, "hub-staff.json"), `${JSON.stringify([{
    id: randomUUID(),
    email: "hub@example.com",
    passwordSalt: hubPasswordSalt.toString("hex"),
    passwordHash: scryptSync("test-hub-secret", hubPasswordSalt, 64).toString("hex"),
    verifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }])}\n`);
  server = createServer({
    dataDir,
    productsFile,
    brevoApiKey: "",
    brevoSenderEmail: "",
    hubRegistrationCode: "test-hub-invite",
    adminSmsNumbers: "",
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("checks signed-out customer sessions without returning an authorization error", async () => {
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), { customer: null });

  const profileResponse = await fetch(`${baseUrl}/api/me`);
  assert.equal(profileResponse.status, 401);
});

test("checks signed-out admin sessions without requesting the protected dashboard", async () => {
  const sessionResponse = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), { authenticated: false });

  const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(dashboardResponse.status, 401);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test("registers customers with hashed passwords and creates a session", async () => {
  const response = await post("/api/register", {
    firstName: "Amina",
    lastName: "Test",
    email: "amina@example.com",
    phone: "+234 801 234 5678",
    password: "correct-horse",
    address: "1 Test Street",
    city: "Lagos",
    region: "Lagos",
  }, null);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.customer.email, "amina@example.com");
  assert.equal("passwordHash" in result.customer, false);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=604800/i);
  sessionCookie = setCookie.split(";")[0];
  assert.match(sessionCookie, /^am_session=/);

  const users = JSON.parse(await fs.readFile(path.join(dataDir, "users.json"), "utf8"));
  assert.equal(users.length, 1);
  assert.notEqual(users[0].passwordHash, "correct-horse");
  assert.equal(users[0].passwordHash.length, 128);
  assert.equal(users[0].inbox.length, 1);
  assert.equal(users[0].passwordHash.includes("correct-horse"), false);
});

test("rejects duplicate registrations and bad credentials", async () => {
  const duplicate = await post("/api/register", {
    firstName: "Amina",
    lastName: "Test",
    email: "AMINA@example.com",
    phone: "+234 801 234 5678",
    address: "1 Test Street",
    city: "Lagos",
    region: "Lagos",
    password: "correct-horse",
  }, null);
  assert.equal(duplicate.status, 409);

  const invalidLogin = await post("/api/login", {
    email: "amina@example.com",
    password: "wrong-password",
  }, null);
  assert.equal(invalidLogin.status, 401);
});

test("requires a delivery address to register", async () => {
  const response = await post("/api/register", {
    firstName: "No",
    lastName: "Address",
    email: "no-address@example.com",
    phone: "+234 801 234 5678",
    password: "correct-horse",
    address: "1 Test Street",
    city: "Lagos",
  }, null);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /delivery street address, city, state/i);
});

test("updates delivery address for the signed-in customer", async () => {
  const response = await fetch(`${baseUrl}/api/me/address`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      address: "22 New Street",
      city: "Abuja",
      region: "FCT",
    }),
  });
  assert.equal(response.status, 200);
  const { customer } = await response.json();
  assert.equal(customer.address, "22 New Street");
  assert.equal(customer.city, "Abuja");
  assert.equal(customer.region, "FCT");
  assert.equal("passwordHash" in customer, false);

  const users = JSON.parse(await fs.readFile(path.join(dataDir, "users.json"), "utf8"));
  assert.equal(users[0].address, "22 New Street");
  assert.equal(users[0].city, "Abuja");
  assert.equal(users[0].region, "FCT");

  const quotes = [
    { city: "Ibadan", region: "Oyo", fee: 3000, estimate: false },
    { city: "Lagos", region: "Lagos State", fee: 3200, estimate: false },
    { city: "Ilishan-Remo", region: "Ogun", fee: 4000, estimate: true },
    { city: "Osogbo", region: "Osun", fee: 8000, estimate: true },
    { city: "Abuja", region: "FCT", fee: 11000, estimate: true },
  ];
  for (const quote of quotes) {
    const updateResponse = await fetch(`${baseUrl}/api/me/address`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ address: "22 New Street", city: quote.city, region: quote.region }),
    });
    assert.equal(updateResponse.status, 200);
    const quoteResponse = await fetch(`${baseUrl}/api/delivery/quote`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(quoteResponse.status, 200);
    const { delivery } = await quoteResponse.json();
    assert.equal(delivery.fee, quote.fee, `${quote.city}, ${quote.region} fee`);
    assert.equal(delivery.estimate, quote.estimate, `${quote.city}, ${quote.region} estimate flag`);
    assert.equal(delivery.origin, "Ilishan-Remo, Ogun State");
  }
});

test("keeps the customer session after a server restart and saves a server-priced order", async () => {
  const productsResponse = await fetch(`${baseUrl}/api/products`);
  assert.equal(productsResponse.status, 200);
  const { products } = await productsResponse.json();
  assert.equal(products.length, 8);
  assert.equal(products.find((product) => product.id === 1).name, "The Everyday Curl");
  const expectedSubtotal = products.find((product) => product.id === 1).price * 2
    + products.find((product) => product.id === 2).price;

  const profileResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).customer.firstName, "Amina");

  const updateAddress = await fetch(`${baseUrl}/api/me/address`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ address: "22 New Street", city: "Abuja", region: "FCT" }),
  });
  assert.equal(updateAddress.status, 200);

  const orderResponse = await post("/api/orders", {
    items: [{ id: 1, quantity: 2, price: 1 }, { id: 2, quantity: 1 }],
  });
  assert.equal(orderResponse.status, 201);
  const { order } = await orderResponse.json();
  testOrderId = order.id;
  assert.equal(order.subtotal, expectedSubtotal);
  assert.equal(order.deliveryFee, 11000);
  assert.equal(order.deliveryEstimate, true);
  assert.equal(order.total, expectedSubtotal + 11000);
  assert.equal(order.items[0].price, products.find((product) => product.id === 1).price);
  assert.equal(order.items[0].image, products.find((product) => product.id === 1).image);
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[1].image, products.find((product) => product.id === 2).image);
  assert.equal(order.items[1].quantity, 1);
  assert.match(order.status, /pending.*admin confirmation/i);
  assert.equal(order.paymentMethod, "Bank transfer");
  assert.equal(order.paymentStatus, "Pending admin confirmation");
  assert.deepEqual(order.deliveryAddress, { street: "22 New Street", city: "Abuja", state: "FCT" });

  const users = JSON.parse(await fs.readFile(path.join(dataDir, "users.json"), "utf8"));
  const orders = JSON.parse(await fs.readFile(path.join(dataDir, "orders.json"), "utf8"));
  assert.equal(users[0].orders[0].id, order.id);
  assert.equal(users[0].inbox[0].subject, `Order ${order.id} received`);
  assert.equal(orders[0].customerId, users[0].id);
  assert.equal(orders[0].paymentStatus, "Pending admin confirmation");

  const updatedProfile = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
  assert.equal((await updatedProfile.json()).customer.orders[0].paymentStatus, "Pending admin confirmation");

  await new Promise((resolve) => server.close(resolve));
  server = createServer({
    dataDir,
    productsFile,
    brevoApiKey: "",
    brevoSenderEmail: "",
    hubRegistrationCode: "test-hub-invite",
    adminSmsNumbers: "",
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const afterRestart = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).customer.email, "amina@example.com");
  const restoredSession = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: sessionCookie } });
  assert.equal(restoredSession.status, 200);
  assert.equal((await restoredSession.json()).customer.email, "amina@example.com");
});

test("protects admin dashboard and supports verified order fulfillment actions", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(unauthorized.status, 401);

  const customerAccess = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(customerAccess.status, 401);

  const badLogin = await adminPost("/api/admin/login", {
    email: "owner@example.com",
    password: "wrong",
  }, null);
  assert.equal(badLogin.status, 401);

  const login = await adminPost("/api/admin/login", {
    email: "OWNER@example.com",
    password: "test-admin-secret",
  }, null);
  assert.equal(login.status, 200);
  const adminSetCookie = login.headers.get("set-cookie");
  assert.match(adminSetCookie, /Path=\//i);
  assert.match(adminSetCookie, /HttpOnly/i);
  assert.match(adminSetCookie, /SameSite=Lax/i);
  assert.match(adminSetCookie, /Max-Age=604800/i);
  adminCookie = adminSetCookie.split(";")[0];

  const unauthorizedProduct = await fetch(`${baseUrl}/api/admin/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorizedProduct.status, 401);
  const customerProductAccess = await fetch(`${baseUrl}/api/admin/products/1`, {
    method: "DELETE",
    headers: { Cookie: sessionCookie },
  });
  assert.equal(customerProductAccess.status, 401);
  const unauthorizedImageUpload = await adminPost("/api/admin/product-images", {
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S1sAAAAASUVORK5CYII=",
  }, null);
  assert.equal(unauthorizedImageUpload.status, 401);

  const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(dashboardResponse.status, 200);
  const unauthorizedHubOrder = await fetch(`${baseUrl}/api/hub/orders/${encodeURIComponent(testOrderId)}`);
  assert.equal(unauthorizedHubOrder.status, 401);
  const adminCookieHubAccess = await fetch(`${baseUrl}/api/hub/orders/${encodeURIComponent(testOrderId)}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminCookieHubAccess.status, 401);
  const badHubLogin = await hubPost("/api/hub/login", {
    email: "hub@example.com",
    password: "wrong",
  }, null);
  assert.equal(badHubLogin.status, 401);
  const hubLogin = await hubPost("/api/hub/login", {
    email: "HUB@example.com",
    password: "test-hub-secret",
  }, null);
  assert.equal(hubLogin.status, 200);
  assert.match(hubLogin.headers.get("set-cookie"), /am_hub_session=/);
  hubCookie = hubLogin.headers.get("set-cookie").split(";")[0];
  const hubDashboardAccess = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: hubCookie },
  });
  assert.equal(hubDashboardAccess.status, 401);
  const hubOrderAccess = await fetch(`${baseUrl}/api/hub/orders/${encodeURIComponent(testOrderId)}`, {
    headers: { Cookie: hubCookie },
  });
  assert.equal(hubOrderAccess.status, 200);
  const hubOrder = (await hubOrderAccess.json()).order;
  assert.equal(hubOrder.id, testOrderId);
  assert.equal(hubOrder.items[0].image, "photo-1534528741775-53994a69daeb");
  const authenticatedSession = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: adminCookie },
  });
  assert.deepEqual(await authenticatedSession.json(), { authenticated: true });
  await new Promise((resolve) => server.close(resolve));
  server = createServer({
    dataDir,
    productsFile,
    brevoApiKey: "",
    brevoSenderEmail: "",
    hubRegistrationCode: "test-hub-invite",
    adminSmsNumbers: "",
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const restoredAdminSession = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: adminCookie },
  });
  assert.deepEqual(await restoredAdminSession.json(), { authenticated: true });
  const restoredDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(restoredDashboard.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.pendingPayments, 1);
  assert.equal(dashboard.orders[0].id, testOrderId);
  assert.equal(dashboard.orders[0].items[0].image, "photo-1534528741775-53994a69daeb");
  assert.equal(dashboard.orders[0].items[1].image, "photo-1608248543803-ba4f8c70ae0b");
  assert.equal(dashboard.products.length, 8);
  assert.equal(dashboard.customers[0].email, "amina@example.com");
  assert.equal("passwordHash" in dashboard.customers[0], false);

  const newProduct = {
    name: "Test Satin Bonnet",
    category: "Beauty",
    detail: "Adjustable satin sleep bonnet",
    description: "A soft bonnet for protecting your hair overnight.",
    price: 8500,
    tag: "New",
    image: "photo-1529139574466-a303027c1d8b",
  };
  const invalidImageUpload = await adminPost("/api/admin/product-images", { data: "data:image/png;base64,SGVsbG8=" });
  assert.equal(invalidImageUpload.status, 400);
  const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S1sAAAAASUVORK5CYII=";
  const imageUpload = await adminPost("/api/admin/product-images", { data: imageData });
  assert.equal(imageUpload.status, 201);
  newProduct.image = (await imageUpload.json()).image;
  const storedImage = await fetch(`${baseUrl}${newProduct.image}`);
  assert.equal(storedImage.status, 200);
  assert.equal(storedImage.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await storedImage.arrayBuffer()).toString("base64"), imageData.split(",")[1]);

  const invalidProduct = await adminPost("/api/admin/products", { ...newProduct, image: "javascript:alert(1)" });
  assert.equal(invalidProduct.status, 400);
  const createProduct = await adminPost("/api/admin/products", newProduct);
  assert.equal(createProduct.status, 201);
  const created = (await createProduct.json()).product;
  assert.equal(created.id, 9);

  const updateProduct = await fetch(`${baseUrl}/api/admin/products/${created.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ ...newProduct, name: "Updated Satin Bonnet", price: 9000 }),
  });
  assert.equal(updateProduct.status, 200);
  assert.equal((await updateProduct.json()).product.price, 9000);

  const publicCatalog = await fetch(`${baseUrl}/api/products`);
  assert.equal((await publicCatalog.json()).products.find((product) => product.id === created.id).name, "Updated Satin Bonnet");
  const deleteProduct = await fetch(`${baseUrl}/api/admin/products/${created.id}`, {
    method: "DELETE",
    headers: { Cookie: adminCookie },
  });
  assert.equal(deleteProduct.status, 200);
  const catalogAfterDelete = await fetch(`${baseUrl}/api/products`);
  assert.equal((await catalogAfterDelete.json()).products.some((product) => product.id === created.id), false);
  const persistedProducts = JSON.parse(await fs.readFile(productsFile, "utf8"));
  assert.equal(persistedProducts.some((product) => product.id === created.id), false);
  const savedOrders = JSON.parse(await fs.readFile(path.join(dataDir, "orders.json"), "utf8"));
  assert.equal(savedOrders[0].items[0].image, "photo-1534528741775-53994a69daeb");

  const confirmPayment = await adminPost(`/api/admin/orders/${testOrderId}/action`, { action: "confirm_payment" });
  assert.equal(confirmPayment.status, 200);
  assert.equal((await confirmPayment.json()).order.paymentStatus, "Confirmed");

  const processing = await adminPost(`/api/admin/orders/${testOrderId}/action`, { action: "processing" });
  assert.equal(processing.status, 200);
  assert.equal((await processing.json()).order.status, "Processing");

  const picked = await hubPost(`/api/hub/orders/${testOrderId}/action`, { action: "picked" });
  assert.equal(picked.status, 200);
  assert.equal((await picked.json()).order.status, "Picked");
  const invalidHubAction = await hubPost(`/api/hub/orders/${testOrderId}/action`, { action: "confirm_payment" });
  assert.equal(invalidHubAction.status, 400);

  const shipped = await hubPost(`/api/hub/orders/${testOrderId}/action`, { action: "shipped" });
  assert.equal(shipped.status, 200);
  assert.equal((await shipped.json()).order.status, "Shipped");

  const inTransit = await hubPost(`/api/hub/orders/${testOrderId}/action`, { action: "in_transit" });
  assert.equal(inTransit.status, 200);
  assert.equal((await inTransit.json()).order.status, "In transit");

  const delivered = await hubPost(`/api/hub/orders/${testOrderId}/action`, { action: "delivered" });
  assert.equal(delivered.status, 200);
  assert.equal((await delivered.json()).order.status, "Delivered");

  const invalidCancel = await adminPost(`/api/admin/orders/${testOrderId}/action`, { action: "cancel" });
  assert.equal(invalidCancel.status, 409);

  const profileResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
  const { customer } = await profileResponse.json();
  assert.equal(customer.orders[0].status, "Delivered");
  assert.equal(customer.orders[0].items[0].image, "photo-1534528741775-53994a69daeb");
  assert.equal(customer.orders[0].items[0].quantity, 2);
  assert.equal(customer.orders[0].items[1].image, "photo-1608248543803-ba4f8c70ae0b");
  assert.match(customer.inbox[0].message, /Delivered/);
  assert.ok(customer.inbox.some((message) => /Picked/.test(message.message)));

  const customerLogin = await post("/api/login", {
    email: "amina@example.com",
    password: "correct-horse",
  }, null);
  assert.equal(customerLogin.status, 200);
  assert.equal((await customerLogin.json()).customer.orders[0].status, "Delivered");

  const hubLogout = await hubPost("/api/hub/logout", {}, hubCookie);
  assert.equal(hubLogout.status, 200);
  const hubAfterLogout = await fetch(`${baseUrl}/api/hub/orders/${encodeURIComponent(testOrderId)}`, {
    headers: { Cookie: hubCookie },
  });
  assert.equal(hubAfterLogout.status, 401);

  const logout = await adminPost("/api/admin/logout", {});
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(afterLogout.status, 401);
});

test("logs out and invalidates the server-side session", async () => {
  const response = await post("/api/logout", {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);

  const profileResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(profileResponse.status, 401);
});

test("persists contact messages and newsletter sign-ups", async () => {
  const messageResponse = await post("/api/messages", {
    name: "Amina Test",
    phone: "+234 801 234 5678",
    message: "Do you have this wig in another length?",
  }, null);
  assert.equal(messageResponse.status, 201);
  const messages = JSON.parse(await fs.readFile(path.join(dataDir, "messages.json"), "utf8"));
  assert.equal(messages[0].name, "Amina Test");

  const newsletterResponse = await post("/api/newsletter", { email: "news@example.com" }, null);
  assert.equal(newsletterResponse.status, 201);
  const subscribers = JSON.parse(await fs.readFile(path.join(dataDir, "newsletter.json"), "utf8"));
  assert.equal(subscribers[0].email, "news@example.com");
});

test("verifies hub staff email and sends customer/admin pickup notifications", async () => {
  const notificationDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "am-brevo-test-"));
  const notificationProductsFile = path.join(notificationDataDir, "products.json");
  await fs.copyFile(path.join(__dirname, "data", "products.json"), notificationProductsFile);
  const brevoRequests = [];
  const notificationServer = createServer({
    dataDir: notificationDataDir,
    productsFile: notificationProductsFile,
    brevoApiKey: "test-brevo-key",
    brevoSenderEmail: "store@example.com",
    hubRegistrationCode: "test-hub-invite",
    notificationAdminEmail: "ayomideoluniyi49@gmail.com",
    brevoSmsSender: "AMStore",
    adminSmsNumbers: "2348000000001, 2348000000002",
    publicSiteUrl: "https://shop.example.com",
    fetchImpl: async (url, options) => {
      brevoRequests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 201 };
    },
  });
  await new Promise((resolve, reject) => {
    notificationServer.once("error", reject);
    notificationServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const notificationBaseUrl = `http://127.0.0.1:${notificationServer.address().port}`;
    const registerResponse = await fetch(`${notificationBaseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "<Amina>",
        lastName: "Test",
        email: "brevo-customer@example.com",
        phone: "+234 809 000 0001",
        password: "correct-horse",
        address: "1 Test Street",
        city: "Lagos",
        region: "Lagos",
      }),
    });
    assert.equal(registerResponse.status, 201);
    assert.equal(brevoRequests.length, 1);
    assert.equal(brevoRequests[0].url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(brevoRequests[0].body.to[0].email, "brevo-customer@example.com");
    assert.match(brevoRequests[0].body.htmlContent, /&lt;Amina&gt;/);
    assert.match(brevoRequests[0].body.htmlContent, /A little something for you/);
    assert.match(brevoRequests[0].body.htmlContent, /background:#fbf4ef/);

    const sessionCookie = registerResponse.headers.get("set-cookie").split(";")[0];
    const orderResponse = await fetch(`${notificationBaseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ items: [{ id: 2, quantity: 1 }] }),
    });
    assert.equal(orderResponse.status, 201);
    const order = (await orderResponse.json()).order;
    assert.equal(brevoRequests.length, 6);

    const orderEmails = brevoRequests.slice(1, 3).map((request) => request.body);
    assert.deepEqual(orderEmails.map((email) => email.to[0].email).sort(), [
      "ayomideoluniyi49@gmail.com",
      "brevo-customer@example.com",
    ]);
    assert.ok(orderEmails.every((email) => email.textContent.includes(order.id)));
    assert.ok(orderEmails.every((email) => /pending admin confirmation/i.test(email.textContent)));
    assert.ok(orderEmails.every((email) => /<img\b/i.test(email.htmlContent)));
    assert.ok(orderEmails.every((email) => /width="84" height="84" alt="Dew Drop Face Cream product photo"/i.test(email.htmlContent)));
    assert.ok(orderEmails.every((email) => email.htmlContent.includes("https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b")));
    assert.ok(orderEmails.every((email) => email.htmlContent.includes("background:#29251f")));

    const smsRequests = brevoRequests.slice(3);
    assert.ok(smsRequests.every((request) => request.url === "https://api.brevo.com/v3/transactionalSMS/sms"));
    assert.ok(smsRequests.every((request) => request.body.sender === "AMStore"));
    assert.ok(smsRequests.every((request) => request.body.type === "transactional"));
    assert.ok(smsRequests.every((request) => request.body.content.includes(order.id)));
    assert.ok(smsRequests.every((request) => request.body.content.includes("pending")));
    assert.deepEqual(smsRequests.map((request) => request.body.recipient).sort(), [
      "+2348000000001",
      "+2348000000002",
      "+2348090000001",
    ]);
    assert.ok(smsRequests.every((request) => request.options.headers["api-key"] === "test-brevo-key"));

    const adminSalt = randomBytes(16);
    await fs.writeFile(path.join(notificationDataDir, "admin.json"), `${JSON.stringify({
      email: "owner@example.com",
      passwordSalt: adminSalt.toString("hex"),
      passwordHash: scryptSync("test-admin-secret", adminSalt, 64).toString("hex"),
    })}\n`);
    const adminLogin = await fetch(`${notificationBaseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "test-admin-secret" }),
    });
    assert.equal(adminLogin.status, 200);
    const adminSessionCookie = adminLogin.headers.get("set-cookie").split(";")[0];
    const statusResponse = await fetch(`${notificationBaseUrl}/api/admin/orders/${encodeURIComponent(order.id)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminSessionCookie },
      body: JSON.stringify({ action: "confirm_payment" }),
    });
    assert.equal(statusResponse.status, 200);
    assert.equal(brevoRequests.length, 8);
    const statusEmail = brevoRequests.find((request) => request.url.endsWith("/smtp/email") && request.body.subject.includes("Paid"));
    assert.ok(statusEmail);
    assert.equal(statusEmail.body.to[0].email, "brevo-customer@example.com");
    assert.match(statusEmail.body.textContent, /confirmed your bank transfer/i);
    assert.match(statusEmail.body.htmlContent, /An update on your order/);
    assert.match(statusEmail.body.htmlContent, /Payment: Confirmed/);
    const statusSms = brevoRequests.find((request) => request.url.endsWith("/transactionalSMS/sms") && /confirmed your bank transfer/i.test(request.body.content));
    assert.ok(statusSms);
    assert.equal(statusSms.body.recipient, "+2348090000001");

    const processingResponse = await fetch(`${notificationBaseUrl}/api/admin/orders/${encodeURIComponent(order.id)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminSessionCookie },
      body: JSON.stringify({ action: "processing" }),
    });
    assert.equal(processingResponse.status, 200);
    const pickedResponse = await fetch(`${notificationBaseUrl}/api/admin/orders/${encodeURIComponent(order.id)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminSessionCookie },
      body: JSON.stringify({ action: "picked" }),
    });
    assert.equal(pickedResponse.status, 200);
    const pickedEmail = brevoRequests.find((request) => request.url.endsWith("/smtp/email") && request.body.subject.includes("Picked"));
    assert.ok(pickedEmail);
    assert.equal(pickedEmail.body.to[0].email, "brevo-customer@example.com");
    assert.match(pickedEmail.body.textContent, /picked at our hub/i);
    const pickedAdminEmail = brevoRequests.find((request) => request.url.endsWith("/smtp/email") && request.body.subject.includes("picked at the hub"));
    assert.ok(pickedAdminEmail);
    assert.equal(pickedAdminEmail.body.to[0].email, "ayomideoluniyi49@gmail.com");
    assert.match(pickedAdminEmail.body.textContent, new RegExp(order.id));

    const hubRegistrationResponse = await fetch(`${notificationBaseUrl}/api/hub/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "hub-staff@example.com",
        password: "a-long-test-password",
        inviteCode: "test-hub-invite",
      }),
    });
    assert.equal(hubRegistrationResponse.status, 201);
    assert.deepEqual(await hubRegistrationResponse.json(), {
      ok: true,
      verificationRequired: true,
      message: "We sent a verification code to your email. Enter it to activate your hub account.",
    });
    const verificationEmail = brevoRequests.find((request) =>
      request.url.endsWith("/smtp/email") && request.body.to[0].email === "hub-staff@example.com");
    assert.ok(verificationEmail);
    assert.match(verificationEmail.body.subject, /verify/i);
    const verificationCode = verificationEmail.body.textContent.match(/code is (\d{6})/)[1];
    const unverifiedLogin = await fetch(`${notificationBaseUrl}/api/hub/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hub-staff@example.com", password: "a-long-test-password" }),
    });
    assert.equal(unverifiedLogin.status, 401);
    const invalidInvite = await fetch(`${notificationBaseUrl}/api/hub/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "intruder@example.com",
        password: "a-long-test-password",
        inviteCode: "wrong-code",
      }),
    });
    assert.equal(invalidInvite.status, 400);
    const verifyResponse = await fetch(`${notificationBaseUrl}/api/hub/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hub-staff@example.com", code: verificationCode }),
    });
    assert.equal(verifyResponse.status, 200);
    const verifiedLogin = await fetch(`${notificationBaseUrl}/api/hub/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hub-staff@example.com", password: "a-long-test-password" }),
    });
    assert.equal(verifiedLogin.status, 200);
    assert.match(verifiedLogin.headers.get("set-cookie"), /am_hub_session=/);
  } finally {
    await new Promise((resolve) => notificationServer.close(resolve));
    await fs.rm(notificationDataDir, { recursive: true, force: true });
  }
});

test("keeps private data files inaccessible and rejects foreign origins", async () => {
  const localAdminResponse = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/admin.html",
      headers: { Host: `localhost:${server.address().port}` },
    }, resolve);
    request.once("error", reject);
    request.end();
  });

  assert.equal(localAdminResponse.statusCode, 308);
  assert.equal(localAdminResponse.headers.location, `${baseUrl}/admin.html`);

  const checkoutPageResponse = await fetch(`${baseUrl}/checkout.html`);
  assert.equal(checkoutPageResponse.status, 200);
  const paymentPageResponse = await fetch(`${baseUrl}/payment.html`);
  assert.equal(paymentPageResponse.status, 200);
  const adminPageResponse = await fetch(`${baseUrl}/admin.html`);
  assert.equal(adminPageResponse.status, 200);
  const userAppResponse = await fetch(`${baseUrl}/user.app.html`);
  assert.equal(userAppResponse.status, 200);
  const userAppPage = await userAppResponse.text();
  assert.match(userAppPage, /A&M Shop/);
  assert.match(userAppPage, /id="product-grid"/);
  assert.match(userAppPage, /data-app-bag/);
  const shortUserAppResponse = await fetch(`${baseUrl}/app`);
  assert.equal(shortUserAppResponse.status, 200);
  const extensionlessUserAppResponse = await fetch(`${baseUrl}/user.app`);
  assert.equal(extensionlessUserAppResponse.status, 200);
  assert.match(await extensionlessUserAppResponse.text(), /id="product-grid"/);
  const hubPageResponse = await fetch(`${baseUrl}/hub.html`);
  assert.equal(hubPageResponse.status, 200);
  const hubPage = await hubPageResponse.text();
  assert.match(hubPage, /A&M Fulfillment Hub/);
  assert.match(hubPage, /id="hub-fullscreen"/);
  assert.doesNotMatch(hubPage, /Admin workspace/);
  const shortHubPageResponse = await fetch(`${baseUrl}/hub`);
  assert.equal(shortHubPageResponse.status, 200);
  const hubAppResponse = await fetch(`${baseUrl}/hubapp.html`);
  assert.equal(hubAppResponse.status, 200);
  const hubAppPage = await hubAppResponse.text();
  assert.match(hubAppPage, /A&amp;M Hub App/);
  assert.match(hubAppPage, /id="hub-items-list"/);
  assert.match(hubAppPage, /Match the photo and quantity/);
  const shortHubAppResponse = await fetch(`${baseUrl}/hubapp`);
  assert.equal(shortHubAppResponse.status, 200);
  assert.match(await shortHubAppResponse.text(), /id="hub-order-number"/);
  const dottedHubAppResponse = await fetch(`${baseUrl}/hub.app`);
  assert.equal(dottedHubAppResponse.status, 200);
  assert.match(await dottedHubAppResponse.text(), /id="hub-order-number"/);
  const shortAdminPageResponse = await fetch(`${baseUrl}/admin`);
  assert.equal(shortAdminPageResponse.status, 200);
  assert.match(await shortAdminPageResponse.text(), /A&M Admin/);

  const privateAdminResponse = await fetch(`${baseUrl}/data/admin.json`);
  assert.equal(privateAdminResponse.status, 404);

  const privateFileResponse = await fetch(`${baseUrl}/data/users.json`);
  assert.equal(privateFileResponse.status, 404);
  const privateSessionsResponse = await fetch(`${baseUrl}/data/sessions.json`);
  assert.equal(privateSessionsResponse.status, 404);

  const foreignOriginResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(foreignOriginResponse.status, 403);
});

test("uses Supabase Auth and service-role credentials only in server-side requests", async () => {
  const requests = [];
  const store = new SupabaseStore({
    url: "https://project.example",
    anonKey: "test-anon-key",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "test-token", user: { id: "customer-uuid" } }),
      };
    },
  });

  await store.createAuthUser({
    email: "customer@example.com",
    password: "private-password",
    firstName: "Customer",
    lastName: "Test",
  });
  await store.signIn("customer@example.com", "private-password");

  assert.equal(requests[0].url, "https://project.example/auth/v1/admin/users");
  assert.equal(requests[0].options.headers.apikey, "test-service-role-key");
  assert.equal(JSON.parse(requests[0].options.body).email_confirm, true);
  assert.equal(requests[1].url, "https://project.example/auth/v1/token?grant_type=password");
  assert.equal(requests[1].options.headers.apikey, "test-anon-key");
  assert.equal(JSON.parse(requests[1].options.body).password, "private-password");
});

test("stores hub staff credentials and verification state in Supabase", async () => {
  const requests = [];
  let savedAccount;
  const store = new SupabaseStore({
    url: "https://project.example",
    anonKey: "test-anon-key",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === "GET") {
        return { ok: true, status: 200, text: async () => JSON.stringify(savedAccount ? [savedAccount] : []) };
      }
      savedAccount = JSON.parse(options.body);
      return { ok: true, status: 201, text: async () => "" };
    },
  });

  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = randomBytes(64).toString("hex");
  await store.update("hub-staff.json", (accounts) => {
    accounts.push({
      id: randomUUID(),
      email: "hub@example.com",
      passwordSalt,
      passwordHash,
      verificationTokenHash: "a".repeat(64),
      verificationExpires: Date.now() + 60_000,
      verifiedAt: null,
      createdAt: new Date().toISOString(),
    });
  });
  const accounts = await store.read("hub-staff.json");
  assert.equal(accounts[0].id, savedAccount.id);
  assert.equal(accounts[0].email, "hub@example.com");
  assert.equal(accounts[0].passwordSalt, passwordSalt);
  assert.equal(accounts[0].passwordHash, passwordHash);
  assert.equal(accounts[0].verificationTokenHash, "a".repeat(64));
  assert.ok(savedAccount.id);
  assert.ok(requests.some((request) => request.url.endsWith("/rest/v1/hub_staff_accounts")));
  assert.ok(requests.every((request) => request.options.headers.apikey === "test-service-role-key"));
});

test("registers and reloads a customer profile through Supabase", async () => {
  const authUserId = "a320aa2b-2cc4-471d-9a9a-d3381bb2d4cb";
  let savedSession = null;
  const requests = [];
  const supabaseServer = createServer({
    dataDir: path.join(os.tmpdir(), `am-supabase-route-${randomUUID()}`),
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "test-anon-key",
    supabaseServiceRoleKey: "test-service-role-key",
    brevoApiKey: "",
    brevoSenderEmail: "",
    adminSmsNumbers: "",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/auth/v1/admin/users")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: authUserId }) };
      }
      if (url.includes("/rest/v1/customer_profiles?select=*&order=created_at.desc")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{
            id: authUserId,
            first_name: "Amina",
            last_name: "Test",
            email: "supabase-customer@example.com",
            phone: "+2348000000000",
            address: "1 Test Street",
            city: "Lagos",
            region: "Lagos",
            created_at: "2026-10-22T09:00:00.000Z",
          }]),
        };
      }
      if (url.includes("/rest/v1/app_sessions?select=*")) {
        return { ok: true, status: 200, text: async () => JSON.stringify(savedSession ? [savedSession] : []) };
      }
      if (url.includes("/rest/v1/orders?select=") || url.includes("/rest/v1/customer_notifications?select=")) {
        return { ok: true, status: 200, text: async () => "[]" };
      }
      if (url.includes("/rest/v1/app_sessions?on_conflict=token_hash")) {
        savedSession = JSON.parse(options.body);
        return { ok: true, status: 201, text: async () => "" };
      }
      if (url.includes("/rest/v1/customer_profiles?on_conflict=id")
        || url.includes("/rest/v1/customer_notifications")) {
        return { ok: true, status: 201, text: async () => "" };
      }
      throw new Error(`Unexpected Supabase test request: ${url}`);
    },
  });
  await new Promise((resolve, reject) => {
    supabaseServer.once("error", reject);
    supabaseServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const response = await fetch(`http://127.0.0.1:${supabaseServer.address().port}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Amina",
        lastName: "Test",
        email: "supabase-customer@example.com",
        phone: "+234 800 000 0000",
        password: "a-strong-password",
        address: "1 Test Street",
        city: "Lagos",
        region: "Lagos",
      }),
    });
    assert.equal(response.status, 201);
    const { customer } = await response.json();
    assert.equal(customer.id, authUserId);
    assert.equal(customer.email, "supabase-customer@example.com");
    assert.equal("passwordHash" in customer, false);
    assert.equal(savedSession.customer_id, authUserId);
    assert.ok(requests.some((request) => request.url.endsWith("/auth/v1/admin/users")));
    assert.ok(requests.every((request) => request.options.headers.apikey !== undefined));
  } finally {
    await new Promise((resolve) => supabaseServer.close(resolve));
  }
});

test("maps Supabase orders and item snapshots to the storefront order shape", async () => {
  const store = new SupabaseStore({
    url: "https://project.example",
    anonKey: "test-anon-key",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        id: "AM-12345678",
        customer_id: "customer-uuid",
        status: "Pending",
        payment_method: "Bank transfer",
        payment_status: "Pending admin confirmation",
        subtotal: "68000.00",
        delivery_fee: "3000.00",
        delivery_estimate: false,
        delivery_tier: "Ibadan special rate",
        delivery_origin: "Ilishan-Remo, Ogun State",
        customer_name: "Customer Test",
        customer_email: "customer@example.com",
        customer_phone: "+2348000000000",
        delivery_street: "1 Test Street",
        delivery_city: "Ibadan",
        delivery_state: "Oyo",
        total: "71000.00",
        created_at: "2026-10-22T09:00:00.000Z",
        updated_at: "2026-10-22T09:00:00.000Z",
        order_items: [{
          product_id: 1,
          product_name: "The Everyday Curl",
          image: "photo-example",
          quantity: 1,
          unit_price: "68000.00",
        }],
      }]),
    }),
  });

  const [order] = await store.read("orders.json");
  assert.equal(order.customerId, "customer-uuid");
  assert.equal(order.customer.name, "Customer Test");
  assert.equal(order.items[0].name, "The Everyday Curl");
  assert.equal(order.items[0].price, 68000);
  assert.equal(order.total, 71000);
});

test("persists server-created orders and customer sessions to Supabase", async () => {
  const requests = [];
  const store = new SupabaseStore({
    url: "https://project.example",
    anonKey: "test-anon-key",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => (options.method === "GET" ? "[]" : ""),
      };
    },
  });

  await store.update("orders.json", (orders) => orders.unshift({
    id: "AM-12345678",
    customerId: "customer-uuid",
    date: "2026-10-22T09:00:00.000Z",
    status: "Pending",
    paymentMethod: "Bank transfer",
    paymentStatus: "Pending admin confirmation",
    subtotal: 68000,
    deliveryFee: 3000,
    deliveryEstimate: false,
    deliveryTier: "Ibadan special rate",
    deliveryOrigin: "Ilishan-Remo, Ogun State",
    customer: { name: "Customer Test", email: "customer@example.com", phone: "+2348000000000" },
    deliveryAddress: { street: "1 Test Street", city: "Ibadan", state: "Oyo" },
    items: [{ id: 1, name: "The Everyday Curl", image: "photo-example", quantity: 1, price: 68000 }],
    total: 71000,
  }));
  await store.update("sessions.json", (sessions) => sessions.push({
    tokenHash: "a".repeat(64),
    role: "customer",
    customerId: "customer-uuid",
    expires: Date.parse("2026-10-29T09:00:00.000Z"),
  }));

  const orderInsert = requests.find((request) => request.url.endsWith("/rest/v1/orders"));
  const itemInsert = requests.find((request) => request.url.endsWith("/rest/v1/order_items"));
  const sessionInsert = requests.find((request) => request.url.includes("/rest/v1/app_sessions") && request.options.method === "POST");
  assert.equal(JSON.parse(orderInsert.options.body).customer_id, "customer-uuid");
  assert.equal(JSON.parse(orderInsert.options.body).total, 71000);
  assert.equal(JSON.parse(itemInsert.options.body)[0].product_name, "The Everyday Curl");
  assert.equal(JSON.parse(sessionInsert.options.body).token_hash, "a".repeat(64));
  assert.equal(sessionInsert.options.headers.apikey, "test-service-role-key");
});

test("rejects partial Supabase configuration instead of silently using local storage", () => {
  assert.throws(
    () => createServer({ supabaseUrl: "https://project.example" }),
    /SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY together/,
  );
});
