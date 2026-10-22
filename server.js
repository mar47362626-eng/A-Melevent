"use strict";

const http = require("node:http");
const path = require("node:path");
const { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

const scryptAsync = promisify(scrypt);
const ROOT = __dirname;
if (typeof process.loadEnvFile === "function" && fsSync.existsSync(path.join(ROOT, ".env"))) {
  process.loadEnvFile(path.join(ROOT, ".env"));
}
const DATA_DIR = path.resolve(process.env.AM_DATA_DIR || path.join(ROOT, "data"));
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 * 1024;
const DELIVERY_ORIGIN = "Ilishan-Remo, Ogun State";
const DELIVERY_FEES = { near: 4000, medium: 8000, far: 11000 };
const MEDIUM_DISTANCE_STATES = new Set(["oyo", "osun", "ondo", "ekiti"]);
const PRODUCTS_SEED_FILE = path.join(ROOT, "data", "products.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const PRODUCT_CATEGORIES = new Set(["Wigs", "Beauty", "Fragrance", "Shoes"]);
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ...["index.html", "shop-all.html", "wigs.html", "beauty.html", "fragrance.html", "shoes.html", "account.html", "checkout.html", "payment.html", "admin.html"]
    .map((name) => [`/${name}`, [name, "text/html; charset=utf-8"]]),
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/checkout.js", ["checkout.js", "text/javascript; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
]);
const ADMIN_ORDER_ACTIONS = new Set(["confirm_payment", "processing", "shipped", "in_transit", "delivered", "cancel"]);

function createStore(dataDir) {
  const pendingWrites = new Map();

  async function readDirect(name) {
    const filePath = path.join(dataDir, name);
    try {
      const contents = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(contents);
      if (!Array.isArray(data)) throw new Error(`${name} must contain a JSON array.`);
      return data;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(filePath, "[]\n", { flag: "wx" }).catch((writeError) => {
        if (writeError.code !== "EEXIST") throw writeError;
      });
      return [];
    }
  }

  async function read(name) {
    const pending = pendingWrites.get(name);
    if (pending) await pending;
    return readDirect(name);
  }

  async function write(name, data) {
    const previous = pendingWrites.get(name) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await writeDirect(name, data);
    });
    pendingWrites.set(name, next);
    try {
      await next;
    } finally {
      if (pendingWrites.get(name) === next) pendingWrites.delete(name);
    }
  }

  async function writeDirect(name, data) {
    await fs.mkdir(dataDir, { recursive: true });
    const filePath = path.join(dataDir, name);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  function update(name, callback) {
    const previous = pendingWrites.get(name) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const values = await readDirect(name);
      const result = await callback(values);
      if (result?.write !== false) await writeDirect(name, values);
      return result?.value;
    });
    pendingWrites.set(name, next);
    return next.finally(() => {
      if (pendingWrites.get(name) === next) pendingWrites.delete(name);
    });
  }

  return { read, write, update };
}

function json(response, status, data, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(data));
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      return [key, decodeURIComponent(value)];
    } catch {
      return [key, ""];
    }
  }).filter(([key]) => key));
}

function cookieOptions(isProduction) {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${isProduction ? "; Secure" : ""}`;
}

function cleanCustomer(customer) {
  const { passwordHash, passwordSalt, ...safeCustomer } = customer;
  return safeCustomer;
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

function formatCurrency(value) {
  return `₦${Number(value).toLocaleString("en-NG")}`;
}

function emailLayout({ title, greeting, content }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:24px 12px;background:#f5f1eb;color:#29251f;font-family:Arial,Helvetica,sans-serif;">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e8e0d7;">`
    + `<tr><td style="padding:25px 32px;background:#29251f;color:#fffaf4;font-family:Georgia,serif;font-size:26px;font-weight:bold;">A&amp;M<span style="color:#d8644f;">.</span></td></tr>`
    + `<tr><td style="padding:32px;">`
    + `<p style="margin:0 0 10px;color:#d8644f;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">A&amp;M customer care</p>`
    + `<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:30px;font-weight:normal;line-height:1.2;">${escapeHtml(title)}</h1>`
    + `<p style="margin:0 0 22px;color:#615b54;font-size:15px;line-height:1.7;">${escapeHtml(greeting)}</p>`
    + `${content}</td></tr>`
    + `<tr><td style="padding:18px 32px;border-top:1px solid #eee8df;color:#77716a;font-size:12px;line-height:1.6;">Thank you for shopping with A&amp;M.<br>Good things for your everyday.</td></tr>`
    + `</table></body></html>`;
}

function normalizeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function deliveryQuote(customer) {
  const city = normalizeText(customer.city, 100).toLowerCase();
  const region = normalizeText(customer.region, 100).toLowerCase().replace(/\s+state$/, "");
  if (city.includes("ibadan")) {
    return { fee: 3000, estimate: false, tier: "Ibadan special rate" };
  }
  if (region === "lagos" || city.includes("lagos")) {
    return { fee: 3200, estimate: false, tier: "Lagos rate" };
  }
  if (region === "ogun") {
    return { fee: DELIVERY_FEES.near, estimate: true, tier: "Nearby Ogun estimate" };
  }
  const mediumDistance = MEDIUM_DISTANCE_STATES.has(region);
  return mediumDistance
    ? { fee: DELIVERY_FEES.medium, estimate: true, tier: "Mid-distance estimate" }
    : { fee: DELIVERY_FEES.far, estimate: true, tier: "Long-distance estimate" };
}

function isValidProductImage(image) {
  if (typeof image !== "string") return false;
  if (/^[a-zA-Z0-9-]+$/.test(image)) return true;
  if (/^\/api\/product-images\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif|avif|bmp)$/.test(image)) return true;
  try {
    return new URL(image).protocol === "https:";
  } catch {
    return false;
  }
}

function validateProduct(product, { idRequired = true } = {}) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return false;
  if (idRequired && (!Number.isSafeInteger(product.id) || product.id < 1)) return false;
  return typeof product.name === "string"
    && Boolean(product.name.trim())
    && product.name.trim().length <= 120
    && PRODUCT_CATEGORIES.has(product.category)
    && typeof product.detail === "string"
    && Boolean(product.detail.trim())
    && product.detail.trim().length <= 180
    && typeof product.description === "string"
    && Boolean(product.description.trim())
    && product.description.trim().length <= 2000
    && Number.isSafeInteger(product.price)
    && product.price >= 0
    && typeof product.tag === "string"
    && Boolean(product.tag.trim())
    && product.tag.trim().length <= 60
    && isValidProductImage(product.image);
}

function detectImageType(image) {
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return "jpg";
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (image.length >= 6 && ["GIF87a", "GIF89a"].includes(image.toString("ascii", 0, 6))) return "gif";
  if (image.length >= 26 && image.toString("ascii", 0, 2) === "BM") return "bmp";
  if (image.length >= 12 && image.toString("ascii", 4, 8) === "ftyp") {
    const brands = image.toString("ascii", 8, Math.min(image.length, 32));
    if (/\bavif\b|\bavis\b/.test(brands)) return "avif";
  }
  return null;
}

function productImageContentType(extension) {
  return ({
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
  })[extension];
}

function normalizedProductFields(body) {
  return {
    name: normalizeText(body.name, 120),
    category: normalizeText(body.category, 30),
    detail: normalizeText(body.detail, 180),
    description: normalizeText(body.description, 2000),
    price: body.price,
    tag: normalizeText(body.tag, 60),
    image: normalizeText(body.image, 1000),
  };
}

async function loadProducts(productsFile = PRODUCTS_FILE) {
  let contents;
  try {
    contents = await fs.readFile(productsFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT"
      || path.resolve(productsFile) !== path.resolve(PRODUCTS_FILE)
      || path.resolve(productsFile) === path.resolve(PRODUCTS_SEED_FILE)) {
      throw error;
    }
    await fs.mkdir(path.dirname(productsFile), { recursive: true });
    await fs.copyFile(PRODUCTS_SEED_FILE, productsFile, fsSync.constants.COPYFILE_EXCL).catch((copyError) => {
      if (copyError.code !== "EEXIST") throw copyError;
    });
    contents = await fs.readFile(productsFile, "utf8");
  }
  const products = JSON.parse(contents);
  if (!Array.isArray(products)) {
    throw new Error("data/products.json must contain a product array.");
  }

  const ids = new Set();
  for (const product of products) {
    if (!validateProduct(product) || ids.has(product.id)) {
      throw new Error(`Product catalog has an invalid product (id ${product.id ?? "unknown"}).`);
    }
    ids.add(product.id);
  }
  return products;
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    const error = new Error("Send this request as JSON.");
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be a JSON object.");
    error.status = 400;
    throw error;
  }
  return body;
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function createServer({
  dataDir = DATA_DIR,
  productsFile = PRODUCTS_FILE,
  production = process.env.NODE_ENV === "production",
  adminEmail = process.env.ADMIN_EMAIL || "",
  adminPassword = process.env.ADMIN_PASSWORD || "",
  brevoApiKey = process.env.BREVO_API_KEY || "",
  brevoSenderEmail = process.env.BREVO_SENDER_EMAIL || "",
  brevoSenderName = process.env.BREVO_SENDER_NAME || "A&M",
  notificationAdminEmail = process.env.BREVO_ADMIN_EMAIL || "ayomideoluniyi49@gmail.com",
  brevoSmsSender = process.env.BREVO_SMS_SENDER || "AMStore",
  adminSmsNumbers = process.env.BREVO_ADMIN_SMS_NUMBERS || "",
  publicSiteUrl = process.env.PUBLIC_SITE_URL || "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const store = createStore(dataDir);
  const attempts = new Map();
  let pendingProductWrite = Promise.resolve();

  async function sendBrevoRequest(endpoint, payload) {
    const response = await fetchImpl(`https://api.brevo.com/v3/${endpoint}`, {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Brevo ${endpoint} request failed (${response.status}): ${details.slice(0, 500)}`);
    }
  }

  async function sendBrevoEmail({ to, subject, textContent, htmlContent }) {
    if (!brevoApiKey || !brevoSenderEmail) {
      throw new Error("Brevo email is not configured; set BREVO_API_KEY and BREVO_SENDER_EMAIL.");
    }
    await sendBrevoRequest("smtp/email", {
      sender: { name: brevoSenderName, email: brevoSenderEmail },
      to: [{ email: to }],
      subject,
      textContent,
      htmlContent,
    });
  }

  function getEmailImageUrl(image) {
    if (typeof image !== "string") return "";
    if (/^https:\/\//i.test(image)) {
      try {
        const url = new URL(image);
        return url.protocol === "https:" ? url.href : "";
      } catch {
        return "";
      }
    }
    if (/^photo-[a-zA-Z0-9-]+$/.test(image)) {
      return `https://images.unsplash.com/${encodeURIComponent(image)}?auto=format&fit=crop&w=160&h=160&q=75`;
    }
    if (publicSiteUrl && /^\/api\/product-images\/[a-f0-9-]{36}\.(?:jpg|png|webp|gif|avif|bmp)$/.test(image)) {
      try {
        const baseUrl = new URL(publicSiteUrl);
        if (baseUrl.protocol === "https:") return new URL(image, baseUrl).href;
      } catch {
        return "";
      }
    }
    return "";
  }

  function orderItemsHtml(items) {
    const rows = items.map((item) => {
      const imageUrl = getEmailImageUrl(item.image);
      const image = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" width="84" height="84" alt="${escapeHtml(item.name)} product photo" style="display:block;width:84px;height:84px;object-fit:cover;border-radius:6px;background:#f0ebe4;">`
        : `<span role="img" aria-label="${escapeHtml(item.name)} product photo unavailable" style="display:block;width:84px;height:84px;border-radius:6px;background:#f0ebe4;"></span>`;
      return `<tr><td style="width:96px;padding:12px 8px 12px 0;vertical-align:middle;">${image}</td>`
        + `<td style="padding:12px 8px;vertical-align:middle;color:#29251f;font-size:14px;line-height:1.5;">`
        + `<strong>${escapeHtml(item.name)}</strong><br><span style="color:#77716a;">Qty ${Number(item.quantity)} · ${escapeHtml(formatCurrency(item.price))} each</span></td>`
        + `<td style="padding:12px 0 12px 8px;text-align:right;vertical-align:middle;color:#29251f;font-size:14px;white-space:nowrap;">${escapeHtml(formatCurrency(item.price * item.quantity))}</td></tr>`;
    }).join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #eee8df;border-bottom:1px solid #eee8df;">${rows}</table>`;
  }

  function orderSummaryHtml(order) {
    return `<p style="margin:0 0 8px;color:#77716a;font-size:13px;">Order <strong style="color:#29251f;">${escapeHtml(order.id)}</strong></p>`
      + `${orderItemsHtml(order.items)}`
      + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;color:#615b54;font-size:14px;">`
      + `<tr><td style="padding:5px 0;">Subtotal</td><td style="padding:5px 0;text-align:right;">${escapeHtml(formatCurrency(order.subtotal))}</td></tr>`
      + `<tr><td style="padding:5px 0;">Delivery${order.deliveryEstimate ? " (estimate)" : ""}</td><td style="padding:5px 0;text-align:right;">${escapeHtml(formatCurrency(order.deliveryFee))}</td></tr>`
      + `<tr><td style="padding:12px 0;border-top:1px solid #e8e0d7;color:#29251f;font-size:16px;font-weight:bold;">Total</td>`
      + `<td style="padding:12px 0;border-top:1px solid #e8e0d7;text-align:right;color:#29251f;font-size:16px;font-weight:bold;">${escapeHtml(formatCurrency(order.total))}</td></tr></table>`;
  }

  function normalizeSmsNumber(value) {
    let number = value.trim().replace(/\D/g, "");
    if (/^0\d{8,13}$/.test(number)) number = `234${number.slice(1)}`;
    if (!/^[1-9]\d{7,14}$/.test(number)) {
      throw new Error("SMS recipient numbers must be valid international numbers with country code.");
    }
    return `+${number}`;
  }

  async function sendBrevoSms(recipient, content) {
    if (!brevoApiKey || !adminSmsNumbers || !brevoSmsSender) {
      throw new Error("Brevo SMS is not configured; set BREVO_API_KEY, BREVO_SMS_SENDER, and BREVO_ADMIN_SMS_NUMBERS.");
    }
    if (!/^[a-z0-9]{1,11}$/i.test(brevoSmsSender)) {
      throw new Error("BREVO_SMS_SENDER must be an approved sender name of up to 11 letters or digits.");
    }
    await sendBrevoRequest("transactionalSMS/sms", {
      sender: brevoSmsSender,
      recipient: normalizeSmsNumber(recipient),
      content: content.slice(0, 150),
      type: "transactional",
      tag: "am-store-order",
      unicodeEnabled: false,
    });
  }

  async function sendOrderSms(order) {
    const itemList = order.items.map((item) => `${item.name} x${item.quantity}`).join(", ");
    const items = itemList.length > 42 ? `${itemList.slice(0, 39)}...` : itemList;
    const customerContent = `A&M: Order ${order.id} received. Total NGN ${Number(order.total).toLocaleString("en-NG")}. Items: ${items}. Payment pending confirmation.`;
    const adminContent = `A&M ORDER ${order.id}: ${order.customer.name}, ${order.customer.phone}. Total NGN ${Number(order.total).toLocaleString("en-NG")}. Items: ${items}. Payment pending.`;
    const adminRecipients = adminSmsNumbers.split(",").map((number) => number.trim()).filter(Boolean);
    await Promise.all([
      notify("Brevo customer order SMS", () => sendBrevoSms(order.customer.phone, customerContent)),
      ...adminRecipients.map((recipient) => notify(
        `Brevo admin order SMS to ${recipient}`,
        () => sendBrevoSms(recipient, adminContent),
      )),
    ]);
  }

  async function notify(label, send) {
    try {
      await send();
    } catch (error) {
      console.error(`${label} notification could not be sent:`, error.message);
    }
  }

  async function sendWelcomeEmail(customer) {
    const welcomeCard = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 22px;border-left:3px solid #d8644f;background:#fbf4ef;">`
      + `<tr><td style="padding:18px 20px;">`
      + `<p style="margin:0 0 8px;color:#d8644f;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">A little something for you</p>`
      + `<p style="margin:0;color:#29251f;font-family:Georgia,serif;font-size:20px;line-height:1.45;">Feel good in your hair, skin, scent, and style.</p>`
      + `</td></tr></table>`
      + `<p style="margin:0;color:#615b54;font-size:14px;line-height:1.7;">Your A&amp;M account is ready. Whenever you’re ready, explore the collection and find something that feels like you.</p>`;
    await notify("Brevo welcome email", () => sendBrevoEmail({
      to: customer.email,
      subject: "Welcome to A&M",
      textContent: `Hi ${customer.firstName}, welcome to A&M! Your account is ready. We’re happy you’re here.`,
      htmlContent: emailLayout({
        title: "Welcome to A&M",
        greeting: `Hi ${customer.firstName}, your account is ready. We’re so happy you’re here.`,
        content: welcomeCard,
      }),
    }));
  }

  async function sendOrderNotifications(order) {
    const itemLines = order.items.map((item) => `${item.name} x${item.quantity} — ${formatCurrency(item.price * item.quantity)}`);
    const itemText = itemLines.join("\n");
    const pendingNotice = "Payment is pending admin confirmation; this notice does not mean payment has been received.";
    const detailsText = [
      `Order: ${order.id}`,
      `Customer: ${order.customer.name}`,
      `Email: ${order.customer.email}`,
      `Phone: ${order.customer.phone}`,
      `Items:\n${itemText}`,
      `Subtotal: ${formatCurrency(order.subtotal)}`,
      `Delivery: ${formatCurrency(order.deliveryFee)}`,
      `Total: ${formatCurrency(order.total)}`,
      pendingNotice,
    ].join("\n\n");
    const summaryHtml = orderSummaryHtml(order);
    const pendingHtml = `<p style="margin:20px 0 0;padding:14px 16px;border-left:3px solid #d8644f;background:#fbf4ef;color:#615b54;font-size:13px;line-height:1.6;">${escapeHtml(pendingNotice)}</p>`;
    const adminDetailsHtml = `<p style="margin:0 0 18px;color:#615b54;font-size:14px;line-height:1.7;"><strong>Customer:</strong> ${escapeHtml(order.customer.name)}<br>${escapeHtml(order.customer.email)}<br>${escapeHtml(order.customer.phone)}</p>`;

    const customerText = `Hi ${order.customer.name}, we received your order ${order.id}.\n\n${detailsText}`;
    const adminText = `A new order was placed.\n\n${detailsText}`;
    const customerHtml = emailLayout({
      title: "Your order is in",
      greeting: `Hi ${order.customer.name}, thank you for your order. We’ve received it and will update you as it moves along.`,
      content: `${summaryHtml}${pendingHtml}`,
    });
    const adminHtml = emailLayout({
      title: "A new order has arrived",
      greeting: "A customer has placed an order. The payment is still awaiting confirmation.",
      content: `${adminDetailsHtml}${summaryHtml}${pendingHtml}`,
    });
    await Promise.all([
      notify("Brevo customer order email", () => sendBrevoEmail({
        to: order.customer.email,
        subject: `We received your A&M order ${order.id}`,
        textContent: customerText,
        htmlContent: customerHtml,
      })),
      notify("Brevo admin order email", () => sendBrevoEmail({
        to: notificationAdminEmail,
        subject: `New A&M order ${order.id}`,
        textContent: adminText,
        htmlContent: adminHtml,
      })),
      sendOrderSms(order),
    ]);
  }

  async function sendOrderStatusNotifications(order, action) {
    const statusMessages = {
      confirm_payment: "We’ve confirmed your bank transfer and are preparing your order.",
      processing: "Your order is being prepared.",
      shipped: "Your order has been shipped.",
      in_transit: "Your order is on its way.",
      delivered: "Your order has been delivered. We hope you love it!",
      cancel: "Your order has been cancelled. If you have questions, please contact A&M.",
    };
    const statusMessage = statusMessages[action] || `Your order status is now ${order.status}.`;
    const textContent = `Hi ${order.customer.name},\n\n${statusMessage}\n\nOrder: ${order.id}\nStatus: ${order.status}\nPayment: ${order.paymentStatus}`;
    const statusCallout = `<p style="margin:0 0 18px;padding:16px;border-left:3px solid #d8644f;background:#fbf4ef;color:#29251f;font-size:15px;line-height:1.7;">${escapeHtml(statusMessage)}</p>`
      + `<p style="margin:0 0 18px;color:#615b54;font-size:14px;line-height:1.7;">Order <strong>${escapeHtml(order.id)}</strong><br>`
      + `Current status: <strong>${escapeHtml(order.status)}</strong><br>`
      + `Payment: ${escapeHtml(order.paymentStatus)}</p>`;
    await Promise.all([
      notify("Brevo order status email", () => sendBrevoEmail({
        to: order.customer.email,
        subject: `A&M order ${order.id}: ${order.status}`,
        textContent,
        htmlContent: emailLayout({
          title: "An update on your order",
          greeting: `Hi ${order.customer.name}, there’s an update about your A&M order.`,
          content: `${statusCallout}${orderSummaryHtml(order)}`,
        }),
      })),
      notify("Brevo order status SMS", () => sendBrevoSms(
        order.customer.phone,
        `A&M: ${order.id} - ${statusMessage}`.slice(0, 150),
      )),
    ]);
  }

  function updateProducts(callback) {
    const update = pendingProductWrite.catch(() => {}).then(async () => {
      const products = await loadProducts(productsFile);
      const result = await callback(products);
      const temporaryPath = `${productsFile}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(productsFile), { recursive: true });
        await fs.writeFile(temporaryPath, `${JSON.stringify(products, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await fs.rename(temporaryPath, productsFile);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
      return result;
    });
    pendingProductWrite = update;
    return update;
  }

  function rateLimit(request, bucket, maxAttempts = 20) {
    const key = `${bucket}:${request.socket.remoteAddress || "unknown"}`;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < 60_000);
    if (recent.length >= maxAttempts) return false;
    recent.push(now);
    attempts.set(key, recent);
    return true;
  }

  async function createSession(response, sessionData) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expires = Date.now() + SESSION_TTL_MS;
    await store.update("sessions.json", (sessions) => {
      const activeSessions = sessions.filter((session) => session.expires > Date.now());
      activeSessions.push({ tokenHash, ...sessionData, expires });
      sessions.splice(0, sessions.length, ...activeSessions);
    });
    response.setHeader("Set-Cookie", `am_session=${encodeURIComponent(token)}; ${cookieOptions(production)}`);
  }

  async function getSession(request) {
    const token = parseCookies(request.headers.cookie).am_session;
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const sessions = await store.read("sessions.json");
    const session = sessions.find((entry) => entry.tokenHash === tokenHash && entry.expires > Date.now());
    return session ? { tokenHash, role: session.role || "customer", customerId: session.customerId } : null;
  }

  async function customerForSession(request) {
    const session = await getSession(request);
    if (!session || session.role !== "customer") return null;
    const users = await store.read("users.json");
    const customer = users.find((user) => user.id === session.customerId);
    if (!customer) return null;
    return customerWithCurrentOrders(customer);
  }

  async function customerWithCurrentOrders(customer) {
    const orders = await store.read("orders.json");
    return { ...customer, orders: orders.filter((order) => order.customerId === customer.id) };
  }

  async function adminForSession(request) {
    const session = await getSession(request);
    return session?.role === "admin" ? session : null;
  }

  async function adminDashboardData() {
    const [orders, users, messages] = await Promise.all([
    store.read("orders.json"),
    store.read("users.json"),
    store.read("messages.json"),
    ]);
    const sortedOrders = [...orders].sort((a, b) => new Date(b.date) - new Date(a.date));
    return {
    orders: sortedOrders,
    customers: users.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      address: user.address,
      city: user.city,
      region: user.region,
      createdAt: user.createdAt,
      orderCount: orders.filter((order) => order.customerId === user.id).length,
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    messages: [...messages].sort((a, b) => new Date(b.date) - new Date(a.date)),
    products: await loadProducts(productsFile),
    summary: {
      orders: orders.length,
      customers: users.length,
      messages: messages.length,
      pendingPayments: orders.filter((order) => order.paymentStatus !== "Confirmed" && order.status !== "Cancelled").length,
      confirmedRevenue: orders
        .filter((order) => order.paymentStatus === "Confirmed" && order.status !== "Cancelled")
        .reduce((total, order) => total + order.total, 0),
    },
    };
  }

  async function handleApi(request, response, url) {
    if (!isAllowedOrigin(request)) {
      json(response, 403, { error: "Requests from another website are not allowed." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      if (!rateLimit(request, "admin-login", 6)) {
        json(response, 429, { error: "Too many admin sign-in attempts. Please wait and try again." });
        return;
      }
      let credentials;
      try {
        if (adminEmail && adminPassword) {
          const passwordSalt = randomBytes(16);
          credentials = {
            email: adminEmail,
            passwordSalt: passwordSalt.toString("hex"),
            passwordHash: (await scryptAsync(adminPassword, passwordSalt, 64)).toString("hex"),
          };
        } else {
          credentials = JSON.parse(await fs.readFile(path.join(dataDir, "admin.json"), "utf8"));
        }
      } catch (error) {
        if (error.code === "ENOENT") {
          json(response, 503, { error: "Admin credentials are missing. Add the private data/admin.json file." });
          return;
        }
        console.error("Could not read admin credentials:", error);
        json(response, 503, { error: "Admin credentials could not be loaded." });
        return;
      }
      if (
        typeof credentials.email !== "string"
        || !credentials.email.trim()
        || typeof credentials.passwordSalt !== "string"
        || !/^[a-f0-9]{32}$/i.test(credentials.passwordSalt)
        || typeof credentials.passwordHash !== "string"
        || !/^[a-f0-9]{128}$/i.test(credentials.passwordHash)
      ) {
        json(response, 503, { error: "Admin credentials in data/admin.json are invalid." });
        return;
      }
      const body = await readJsonBody(request);
      const email = normalizeText(body.email, 254).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const suppliedEmailHash = createHash("sha256").update(email).digest();
      const expectedEmailHash = createHash("sha256").update(credentials.email.trim().toLowerCase()).digest();
      if (
        password.length > 128
        || !timingSafeEqual(suppliedEmailHash, expectedEmailHash)
      ) {
        json(response, 401, { error: "Admin email or password is incorrect." });
        return;
      }
      const suppliedPasswordHash = await scryptAsync(password, Buffer.from(credentials.passwordSalt, "hex"), 64);
      const expectedPasswordHash = Buffer.from(credentials.passwordHash, "hex");
      if (!timingSafeEqual(suppliedPasswordHash, expectedPasswordHash)) {
        json(response, 401, { error: "Admin email or password is incorrect." });
        return;
      }
      await createSession(response, { role: "admin" });
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      const session = await adminForSession(request);
      if (session) {
        await store.update("sessions.json", (sessions) => {
          const index = sessions.findIndex((entry) => entry.tokenHash === session.tokenHash);
          if (index !== -1) sessions.splice(index, 1);
        });
      }
      response.setHeader("Set-Cookie", `am_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`);
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/product-images") {
      if (!await adminForSession(request)) {
        json(response, 401, { error: "Please sign in as an admin." });
        return;
      }
      const body = await readJsonBody(request, MAX_IMAGE_BODY_BYTES);
      if (typeof body.data !== "string" || !/^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/.test(body.data)) {
        json(response, 400, { error: "Choose a valid JPEG, PNG, WebP, GIF, AVIF, or BMP image." });
        return;
      }
      const image = Buffer.from(body.data.slice(body.data.indexOf(",") + 1), "base64");
      const extension = detectImageType(image);
      if (!extension) {
        json(response, 400, { error: "The selected file is not a supported image. Choose a JPEG, PNG, WebP, GIF, AVIF, or BMP file." });
        return;
      }
      if (image.length > MAX_IMAGE_BYTES) {
        json(response, 413, { error: "Images must be 5 MB or smaller." });
        return;
      }
      const filename = `${randomUUID()}.${extension}`;
      const imageDirectory = path.join(dataDir, "product-images");
      await fs.mkdir(imageDirectory, { recursive: true });
      await fs.writeFile(path.join(imageDirectory, filename), image, { flag: "wx", mode: 0o600 });
      json(response, 201, { image: `/api/product-images/${filename}` });
      return;
    }

    const productImageRoute = url.pathname.match(/^\/api\/product-images\/([a-f0-9-]{36})\.(jpg|png|webp|gif|avif|bmp)$/);
    if (request.method === "GET" && productImageRoute) {
      const filename = `${productImageRoute[1]}.${productImageRoute[2]}`;
      try {
        const image = await fs.readFile(path.join(dataDir, "product-images", filename));
        response.writeHead(200, {
          "Content-Type": productImageContentType(productImageRoute[2]),
          "Content-Length": image.length,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(image);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        json(response, 404, { error: "Product image not found." });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
      if (!await adminForSession(request)) {
        json(response, 401, { error: "Please sign in as an admin." });
        return;
      }
      json(response, 200, await adminDashboardData());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/session") {
      json(response, 200, { authenticated: Boolean(await adminForSession(request)) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/products") {
      if (!await adminForSession(request)) {
        json(response, 401, { error: "Please sign in as an admin." });
        return;
      }
      const productFields = normalizedProductFields(await readJsonBody(request));
      if (!validateProduct(productFields, { idRequired: false })) {
        json(response, 400, { error: "Enter a product name, category, detail, description, valid price, tag, and HTTPS image URL or Unsplash image ID." });
        return;
      }
      try {
        const product = await updateProducts(async (products) => {
          const orders = await store.read("orders.json");
          const highestUsedId = orders.reduce((maximum, order) => (
            order.items || []
          ).reduce((itemMaximum, item) => Math.max(itemMaximum, Number(item.id) || 0), maximum), 0);
          const id = Math.max(highestUsedId, ...products.map((item) => item.id)) + 1;
          if (!Number.isSafeInteger(id)) {
            const error = new Error("No more product IDs are available.");
            error.status = 409;
            throw error;
          }
          const created = { id, ...productFields };
          products.push(created);
          return created;
        });
        json(response, 201, { product });
      } catch (error) {
        if (error.status) {
          json(response, error.status, { error: error.message });
          return;
        }
        console.error("Could not add product:", error);
        json(response, 500, { error: "We couldn't add this product. Please try again." });
      }
      return;
    }

    const adminProductRoute = url.pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (adminProductRoute && (request.method === "PUT" || request.method === "DELETE")) {
      if (!await adminForSession(request)) {
        json(response, 401, { error: "Please sign in as an admin." });
        return;
      }
      const productId = Number(adminProductRoute[1]);
      try {
        const product = await updateProducts(async (products) => {
          const index = products.findIndex((entry) => entry.id === productId);
          if (index < 0) {
            const error = new Error("Product not found.");
            error.status = 404;
            throw error;
          }
          if (request.method === "DELETE") {
            const [removed] = products.splice(index, 1);
            return removed;
          }
          const fields = normalizedProductFields(await readJsonBody(request));
          if (!validateProduct(fields, { idRequired: false })) {
            const error = new Error("Enter a product name, category, detail, description, valid price, tag, and HTTPS image URL or Unsplash image ID.");
            error.status = 400;
            throw error;
          }
          const updated = { id: productId, ...fields };
          products[index] = updated;
          return updated;
        });
        json(response, 200, { product });
      } catch (error) {
        if (error.status) {
          json(response, error.status, { error: error.message });
          return;
        }
        console.error(`Could not ${request.method === "DELETE" ? "delete" : "update"} product:`, error);
        json(response, 500, { error: "We couldn't save this product change. Please try again." });
      }
      return;
    }

    const adminOrderAction = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/action$/);
    if (request.method === "POST" && adminOrderAction) {
      if (!await adminForSession(request)) {
        json(response, 401, { error: "Please sign in as an admin." });
        return;
      }
      const orderId = decodeURIComponent(adminOrderAction[1]);
      const body = await readJsonBody(request);
      if (!ADMIN_ORDER_ACTIONS.has(body.action)) {
        json(response, 400, { error: "Choose a valid order action." });
        return;
      }
      let updatedOrder;
      try {
        await store.update("orders.json", (orders) => {
          const order = orders.find((entry) => entry.id === orderId);
          if (!order) {
            const error = new Error("Order not found.");
            error.status = 404;
            throw error;
          }
          if (body.action === "confirm_payment") {
            if (order.paymentStatus === "Confirmed" || order.status === "Cancelled") {
              const error = new Error("This order cannot be payment-confirmed in its current state.");
              error.status = 409;
              throw error;
            }
            order.paymentStatus = "Confirmed";
            order.status = "Paid — processing";
            order.paymentConfirmedAt = new Date().toISOString();
          } else if (body.action === "cancel") {
            if (order.paymentStatus === "Confirmed" || order.status === "Delivered" || order.status === "Cancelled") {
              const error = new Error("Only an order with unconfirmed payment can be cancelled here.");
              error.status = 409;
              throw error;
            }
            order.status = "Cancelled";
          } else {
            const allowedTransitions = {
              processing: { from: ["Paid — processing", "Confirmed — payment received"], to: "Processing" },
              shipped: { from: "Processing", to: "Shipped" },
              in_transit: { from: "Shipped", to: "In transit" },
              delivered: { from: "In transit", to: "Delivered" },
            };
            const transition = allowedTransitions[body.action];
            if (!transition || !transition.from.includes(order.status) || order.paymentStatus !== "Confirmed") {
              const error = new Error("This order must have confirmed payment and be in the previous delivery stage.");
              error.status = 409;
              throw error;
            }
            order.status = transition.to;
          }
          order.updatedAt = new Date().toISOString();
          updatedOrder = { ...order };
        });
        const customerMessage = body.action === "confirm_payment"
          ? "Your bank transfer has been confirmed. A&M is preparing your order."
          : `Your order status is now: ${updatedOrder.status}.`;
        await store.update("users.json", (users) => {
          const customer = users.find((user) => user.id === updatedOrder.customerId);
          if (customer) {
            customer.inbox.unshift({
              id: randomUUID(),
              subject: `Order ${updatedOrder.id} update`,
              message: customerMessage,
              date: updatedOrder.updatedAt,
            });
          }
        });
      } catch (error) {
        if (error.status) {
          json(response, error.status, { error: error.message });
          return;
        }
        console.error("Could not update admin order:", error);
        json(response, 500, { error: "We couldn't update the order. Please try again." });
        return;
      }
      await sendOrderStatusNotifications(updatedOrder, body.action);
      json(response, 200, { order: updatedOrder });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/products") {
      const products = await loadProducts(productsFile);
      json(response, 200, { products });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/register") {
      if (!rateLimit(request, "register", 8)) {
        json(response, 429, { error: "Too many registration attempts. Please wait and try again." });
        return;
      }
      const body = await readJsonBody(request);
      const firstName = normalizeText(body.firstName, 80);
      const lastName = normalizeText(body.lastName, 80);
      const email = normalizeText(body.email, 254).toLowerCase();
      const phone = normalizeText(body.phone, 40);
      const password = typeof body.password === "string" ? body.password : "";
      const address = normalizeText(body.address, 200);
      const city = normalizeText(body.city, 100);
      const region = normalizeText(body.region, 100);
      if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !address || !city || !region || password.length < 8 || password.length > 128) {
        json(response, 400, { error: "Please provide your name, valid email, phone number, delivery street address, city, state, and a password between 8 and 128 characters." });
        return;
      }
      const salt = randomBytes(16);
      const passwordHash = await scryptAsync(password, salt, 64);
      const customer = {
        id: randomUUID(),
        firstName,
        lastName,
        email,
        phone,
        address,
        city,
        region,
        passwordSalt: salt.toString("hex"),
        passwordHash: passwordHash.toString("hex"),
        createdAt: new Date().toISOString(),
        orders: [],
        inbox: [{ id: randomUUID(), subject: "Welcome to A&M", message: "Your A&M account is ready. We’re happy you’re here.", date: new Date().toISOString() }],
      };
      try {
        await store.update("users.json", (users) => {
          if (users.some((user) => user.email === email)) {
            const error = new Error("An account with this email already exists. Please log in instead.");
            error.status = 409;
            throw error;
          }
          users.push(customer);
        });
      } catch (error) {
        if (error.status) throw error;
        console.error("Could not save a registered customer:", error);
        json(response, 500, { error: "We couldn't save your account. Please try again." });
        return;
      }
      await createSession(response, { role: "customer", customerId: customer.id });
      await sendWelcomeEmail(customer);
      json(response, 201, { customer: cleanCustomer(await customerWithCurrentOrders(customer)) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      if (!rateLimit(request, "login", 12)) {
        json(response, 429, { error: "Too many login attempts. Please wait and try again." });
        return;
      }
      const body = await readJsonBody(request);
      const email = normalizeText(body.email, 254).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const users = await store.read("users.json");
      const customer = users.find((user) => user.email === email);
      if (!customer || password.length > 128) {
        json(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      const attemptedHash = await scryptAsync(password, Buffer.from(customer.passwordSalt, "hex"), 64);
      const expectedHash = Buffer.from(customer.passwordHash, "hex");
      if (expectedHash.length !== attemptedHash.length || !timingSafeEqual(expectedHash, attemptedHash)) {
        json(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      await createSession(response, { role: "customer", customerId: customer.id });
      json(response, 200, { customer: cleanCustomer(await customerWithCurrentOrders(customer)) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const customer = await customerForSession(request);
      if (!customer) {
        json(response, 401, { error: "Please log in to view your account." });
        return;
      }
      json(response, 200, { customer: cleanCustomer(customer) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      const customer = await customerForSession(request);
      json(response, 200, { customer: customer ? cleanCustomer(customer) : null });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/delivery/quote") {
      const customer = await customerForSession(request);
      if (!customer) {
        json(response, 401, { error: "Please log in to calculate delivery." });
        return;
      }
      json(response, 200, {
        delivery: { ...deliveryQuote(customer), origin: DELIVERY_ORIGIN },
      });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/me/address") {
      const customer = await customerForSession(request);
      if (!customer) {
        json(response, 401, { error: "Please log in to update your delivery address." });
        return;
      }
      const body = await readJsonBody(request);
      const address = normalizeText(body.address, 200);
      const city = normalizeText(body.city, 100);
      const region = normalizeText(body.region, 100);
      if (!address || !city || !region) {
        json(response, 400, { error: "Enter your street address, city, and state." });
        return;
      }

      try {
        await store.update("users.json", (users) => {
          const user = users.find((entry) => entry.id === customer.id);
          if (!user) {
            const error = new Error("Customer account was not found.");
            error.status = 404;
            throw error;
          }
          user.address = address;
          user.city = city;
          user.region = region;
        });
      } catch (error) {
        if (error.status) {
          json(response, error.status, { error: error.message });
          return;
        }
        console.error("Could not update delivery address:", error);
        json(response, 500, { error: "We couldn't update your delivery address. Please try again." });
        return;
      }
      const updatedCustomer = await customerForSession(request);
      json(response, 200, { customer: cleanCustomer(updatedCustomer) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const session = await getSession(request);
      if (session) {
        await store.update("sessions.json", (sessions) => {
          const index = sessions.findIndex((entry) => entry.tokenHash === session.tokenHash);
          if (index !== -1) sessions.splice(index, 1);
        });
      }
      response.setHeader("Set-Cookie", `am_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`);
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/orders") {
      const customer = await customerForSession(request);
      if (!customer) {
        json(response, 401, { error: "Please log in before placing an order." });
        return;
      }
      const body = await readJsonBody(request);
      if (!Array.isArray(body.items) || body.items.length < 1) {
        json(response, 400, { error: "Your bag must contain valid products." });
        return;
      }
      const products = await loadProducts(productsFile);
      const productsById = new Map(products.map((product) => [product.id, product]));
      if (body.items.length > products.length) {
        json(response, 400, { error: "Your bag contains too many different products." });
        return;
      }
      const orderItems = [];
      for (const entry of body.items) {
        const productId = Number(entry?.id);
        const quantity = Number(entry?.quantity);
        const product = productsById.get(productId);
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50 || orderItems.some((item) => item.id === productId)) {
          json(response, 400, { error: "Your bag contains an invalid item or quantity." });
          return;
        }
        orderItems.push({ id: productId, name: product.name, image: product.image, quantity, price: product.price });
      }
      const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const delivery = deliveryQuote(customer);
      const total = subtotal + delivery.fee;
      const order = {
        id: `AM-${randomBytes(4).toString("hex").toUpperCase()}`,
        customerId: customer.id,
        date: new Date().toISOString(),
        status: "Pending — awaiting admin confirmation of bank transfer",
        paymentMethod: "Bank transfer",
        paymentStatus: "Pending admin confirmation",
        subtotal,
        deliveryFee: delivery.fee,
        deliveryEstimate: delivery.estimate,
        deliveryTier: delivery.tier,
        deliveryOrigin: DELIVERY_ORIGIN,
        customer: {
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: customer.phone,
        },
        deliveryAddress: {
          street: customer.address,
          city: customer.city,
          state: customer.region,
        },
        items: orderItems,
        total,
      };
      try {
        await store.update("orders.json", (orders) => orders.unshift(order));
        await store.update("users.json", (users) => {
          const user = users.find((entry) => entry.id === customer.id);
          if (!user) {
            const error = new Error("Customer account was not found.");
            error.status = 404;
            throw error;
          }
          user.orders.unshift(order);
          user.inbox.unshift({
            id: randomUUID(),
            subject: `Order ${order.id} received`,
            message: `Your order for ₦${total.toLocaleString("en-NG")} (including ₦${delivery.fee.toLocaleString("en-NG")} delivery) is pending admin payment confirmation. We will update you after checking the transfer.`,
            date: order.date,
          });
        });
      } catch (error) {
        console.error("Could not save order:", error);
        json(response, error.status || 500, { error: error.status ? error.message : "We couldn't save your order. Please try again." });
        return;
      }
      await sendOrderNotifications(order);
      json(response, 201, { order });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/messages") {
      if (!rateLimit(request, "message", 8)) {
        json(response, 429, { error: "Too many messages. Please wait and try again." });
        return;
      }
      const body = await readJsonBody(request);
      const name = normalizeText(body.name, 120);
      const phone = normalizeText(body.phone, 40);
      const message = normalizeText(body.message, 2000);
      if (!name || !phone || !message) {
        json(response, 400, { error: "Please enter your name, phone number, and message." });
        return;
      }
      const contact = {
        id: randomUUID(),
        name,
        phone,
        message,
        date: new Date().toISOString(),
      };
      try {
        await store.update("messages.json", (messages) => messages.unshift(contact));
      } catch (error) {
        console.error("Could not save contact message:", error);
        json(response, 500, { error: "We couldn't save your message. Please try again." });
        return;
      }
      json(response, 201, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/newsletter") {
      if (!rateLimit(request, "newsletter", 8)) {
        json(response, 429, { error: "Too many sign-up attempts. Please try again later." });
        return;
      }
      const body = await readJsonBody(request);
      const email = normalizeText(body.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        json(response, 400, { error: "Please enter a valid email address." });
        return;
      }
      try {
        await store.update("newsletter.json", (subscribers) => {
          if (!subscribers.some((entry) => entry.email === email)) {
            subscribers.unshift({ email, subscribedAt: new Date().toISOString() });
          }
        });
      } catch (error) {
        console.error("Could not save newsletter subscription:", error);
        json(response, 500, { error: "We couldn't save your sign-up. Please try again." });
        return;
      }
      json(response, 201, { ok: true });
      return;
    }

    json(response, 404, { error: "API route not found." });
  }

  return http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.hostname === "localhost" && (request.method === "GET" || request.method === "HEAD")) {
        const canonicalPath = `${url.pathname}${url.search}`;
        const canonicalUrl = `http://127.0.0.1${url.port ? `:${url.port}` : ""}${canonicalPath}`;
        response.writeHead(308, { Location: canonicalUrl, "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
        return;
      }
      const entry = STATIC_FILES.get(decodeURIComponent(url.pathname));
      if (!entry) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("Not found");
        return;
      }
      const [filename, contentType] = entry;
      const filePath = path.join(ROOT, filename);
      const contents = await fs.readFile(filePath);
      response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (error.status) {
        json(response, error.status, { error: error.message });
      } else {
        console.error("Request failed:", error);
        if (!response.headersSent) json(response, 500, { error: "An unexpected server error occurred." });
        else response.destroy();
      }
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`A&M backend ready at http://${HOST}:${PORT}`);
    console.log(`Private customer data will be stored in ${DATA_DIR}`);
  });
}

module.exports = { createServer };
