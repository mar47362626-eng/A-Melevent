# A-Melevent

A&M storefront and Node.js backend.

## Run locally

Install Node.js 20 or newer, open a terminal in this folder, and run:

```sh
npm start
```

Open `http://127.0.0.1:3000` rather than opening the HTML files directly or using the VS Code Live Server URL. The server serves the website and its same-origin API together. In local development, opening a page through `http://localhost:3000` redirects to `127.0.0.1` so browser sign-in cookies always use the same origin. After that redirect, sign in once at the redirected address; cookies from other hostnames or Live Server are separate.

## Deploy on Render

Deploy this repository as a **Web Service** so Render runs the Node.js server and serves both the website and its API. GitHub Pages only hosts static files and cannot run this backend; the login, checkout, and admin API will not work if the site is opened from the GitHub Pages URL.

In Render, create a Web Service for this repository, leave the build command empty, and set the start command to `npm start`. Add these environment variables:

- `NODE_ENV` — `production`.
- `HOST` — `0.0.0.0` (also the production default).
- `ADMIN_EMAIL` — the email used to sign in to the admin workspace.
- `ADMIN_PASSWORD` — a long, unique password; keep it private.
- `HUB_REGISTRATION_CODE` — a long, private invitation code for hub staff registration. Share it only with trusted staff.
- `AM_DATA_DIR` — `/var/data` only when using JSON storage and a persistent disk.

When using the JSON-file fallback, attach a persistent disk mounted at `/var/data` and set `AM_DATA_DIR=/var/data`; otherwise those records may be lost on restart or redeploy. When Supabase is configured, customer accounts, sessions, orders, products, contact messages, newsletter sign-ups, and uploaded product images are stored in Supabase instead, so a Render disk is not needed for that data. Do not upload the local `data/` records or `.env` file to GitHub.

Add the Supabase environment variables listed in [Supabase setup](#supabase-setup) to enable database storage. Brevo email and SMS settings are optional; SMS also requires available Brevo credits. Set `PUBLIC_SITE_URL` to the public Render URL if order emails should include uploaded product images. `ALLOWED_ORIGINS` is a comma-separated list of trusted browser origins; `https://amelivated.netlify.app` is allowed by default for the Netlify proxy. After deployment, open the Render service URL (not the GitHub Pages URL) and use `/admin.html` for the admin workspace.

### Use the Netlify domain

If the storefront is published on Netlify, keep the Render Web Service running as its backend. `netlify.toml` proxies `/api/*` requests to `https://a-melevent.onrender.com`, maps `/hub.app` and `/hubapp` to the hub app page, and enables pretty URLs. Requests for `/checkout.html` (and other `.html` pages) redirect to clean URLs such as `/checkout`, while old links continue to work. Deploy the repository root as the Netlify publish directory so these settings and the site files are included. If the Render service URL changes, update the API proxy target in `netlify.toml` and redeploy Netlify.

## Admin workspace

The protected admin workspace is at `http://127.0.0.1:3000/admin.html`. Admin credentials are kept separately from customer accounts in the private, ignored `data/admin.json` file. That file contains the admin email and a salted scrypt password hash, never the plain-text password. It is not served by the website. For hosted deployments, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` as private environment variables; use a long, unique password and never commit it.

The workspace includes order, product, customer, and contact-message views. Admins can add, edit, and delete products; changes are saved to the active storage and appear in the storefront immediately. Product images can be selected from the device (JPEG, PNG, WebP, GIF, AVIF, or BMP, up to 5 MB), use an Unsplash photo ID, or use an HTTPS image URL. Uploaded images use the private data directory in JSON mode and the `product-images` Supabase Storage bucket when Supabase is enabled. Order items keep an image snapshot so their thumbnails remain available after a product is removed. The admin order controls offer the valid next step for each order: confirm payment or cancel, start processing, optionally mark picked, then mark shipped, in transit, and delivered. A transfer must be confirmed before fulfillment, and cancellation is only allowed while payment is unconfirmed. Those order updates appear in the customer's account. Keep the server on HTTPS before exposing admin access outside a trusted local network.

## Fulfillment hub

The staff-only fulfillment page is available at `/hub.html`. Set a long, private `HUB_REGISTRATION_CODE` in Render and share it only with trusted staff. Each staff member registers using their own email, a password of at least 10 characters, and the invitation code, then verifies their email using a code sent through Brevo. Hub accounts use a separate, restricted session and cannot access the admin workspace. Hub staff can look up an order by its order number, review its items and delivery details, mark it picked, then advance it through shipped, in transit, and delivered. Payment must be confirmed and the order started in the admin workspace before the hub can fulfill it. Status changes appear in the customer's existing order history. When an order is marked picked, the customer and the configured admin email (`BREVO_ADMIN_EMAIL`, default `ayomideoluniyi49@gmail.com`) both receive an email notification. Configure `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in Render for verification and order emails.

## Stored data

Without Supabase credentials, the server creates private JSON files in the configured data directory:

- `users.json` contains customer contact/address details and salted scrypt password hashes. Passwords are never saved in plain text.
- `admin.json` contains only the separate admin email, salt, and scrypt password hash. It is ignored by Git and not publicly served.
- `sessions.json` contains hashed session tokens so customers stay signed in after refreshing the page or restarting the server. Logging out invalidates the session.
- `orders.json` stores server-priced bank-transfer orders, customer delivery details, and payment status. Orders remain pending until an admin verifies the transfer and updates the record.
- `messages.json` stores contact form messages. The website also opens WhatsApp with the customer's details/message ready to send.
- `newsletter.json` stores newsletter email sign-ups.

These files are excluded by `.gitignore` and are not served by the website. Back them up securely; do not upload them to a public web folder or commit real customer data.

## Supabase setup

To use Supabase instead of JSON files:

1. In the Supabase dashboard, open **SQL Editor**, paste all of `supabase-schema.sql`, and run it. It creates/updates the tables, policies, sample catalog, sessions table, and public product-image bucket.
2. In Supabase **Project Settings → API**, copy the **Project URL**, the **anon/public (publishable) key**, and the **service_role/secret key**.
3. In Render **Environment**, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The server requires all three and uses them only on the server. Never put the service-role key in HTML/JavaScript, GitHub, or a message.
4. Run the full schema again after pulling updates so new tables and columns (including verified fulfillment hub accounts and the order picked-history timestamp) are installed, then redeploy. The server will use Supabase Auth for customer passwords and Supabase tables/storage for customer profiles, sessions, products, orders, order items, notifications, hub staff accounts, contact messages, newsletter sign-ups, and uploaded product photos. If all three Supabase variables are absent, local development continues using JSON storage.

The schema is safe to run again and seeds the example products only when their IDs are not already present. Existing accounts and order records in local JSON files are **not automatically copied** to Supabase. Since those passwords use the old app's hash format, customers will need to create new Supabase-backed accounts unless a separate migration/reset plan is arranged. Keep the local data backed up; do not upload it to GitHub.

## Brevo email and SMS notifications

The server sends a welcome email after customer registration, order confirmation emails to the customer and `ayomideoluniyi49@gmail.com`, and transactional SMS alerts to the customer's registered phone and configured admin phone numbers. When an admin changes an order's payment or delivery status, the customer receives an updated email and SMS. Order emails use a branded, mobile-friendly layout with product thumbnails when the image is publicly available. Order notices clearly distinguish pending transfers from payments confirmed by an admin. Email and SMS use Brevo's transactional APIs.

Copy `.env.example` to `.env` in the project folder, then replace its placeholder values with your Brevo settings. The server loads `.env` automatically when started with either `node server.js` or `npm start` on Node.js 20.12 or newer:

```powershell
Copy-Item .env.example .env
```

The `.env` file is ignored by Git. Set these values in it:

- `BREVO_API_KEY` — private Brevo API key.
- `BREVO_SENDER_EMAIL` — email sender verified in Brevo.
- `BREVO_SENDER_NAME` — optional sender display name; defaults to `A&M`.
- `BREVO_ADMIN_EMAIL` — admin order-email address; defaults to `ayomideoluniyi49@gmail.com`.
- `BREVO_SMS_SENDER` — sender name approved in Brevo; use up to 11 letters or digits. `AMStore` is an example and must be approved before delivery.
- `BREVO_ADMIN_SMS_NUMBERS` — admin recipient number(s) in international format, comma-separated without `+`.
- `PUBLIC_SITE_URL` — optional public HTTPS site origin (for example, `https://shop.example.com`), used to load uploaded product images in order emails. Unsplash and other HTTPS product images can be included without this setting; locally hosted images cannot be displayed to email recipients.

Brevo SMS requires available SMS credits, an approved sender name, a valid recipient number, and delivery support for the destination country. SMS alerts are sent as transactional messages and kept short to reduce the chance of being split into multiple chargeable segments. Email delivery requires the API key and a verified sender. Notification delivery errors are logged and do not undo a successful registration or order.

After filling in `.env`, start the app normally:

```powershell
npm.cmd start
```

Replace the example sender value with the sender approved in your Brevo account. Do not put the API key in browser code or commit `.env`. On a hosted deployment, configure these as private server environment variables in the hosting dashboard.

`data/products.json` is the bundled starter catalog. At runtime, the server uses `products.json` in its data directory (the same directory as private records), copying the bundled catalog there the first time if needed. The browser loads products through `GET /api/products`, and the server reads the runtime catalog when checking product IDs and calculating order prices. Manage products in the admin workspace; catalog changes are saved atomically.

Admin-uploaded product image files are stored in the private `data/product-images/` directory. The app serves only generated image filenames through its product-image route; these uploads are not publicly exposed as files or included in the catalog JSON as image data.

Login sessions use HttpOnly, SameSite cookies with a seven-day expiry. Only a hash of each session token is stored on the server. Configure HTTPS and `NODE_ENV=production` before exposing the site publicly; the production cookie is marked Secure.

Checkout shows the customer's saved delivery details, an order summary, and Wema Bank transfer instructions. Delivery is calculated on the server from the saved address: Ibadan is ₦3,000, Lagos is ₦3,200, other Ogun destinations are estimated at ₦4,000, Oyo/Osun/Ondo/Ekiti destinations (except Ibadan) are estimated at ₦8,000, and other states are estimated at ₦11,000. The estimate is clearly labeled and included in the displayed and server-calculated total; the courier's final charge may differ. Orders save the items subtotal and delivery fee separately.

Clicking “I have made the transfer” records an order as pending admin confirmation; it does not verify that money was received. Pay on delivery is not enabled. An admin must check the bank account before confirming payment in the admin workspace. Customer order history reads the server order records, so admin status updates appear in the customer's profile. Do not treat a customer-submitted payment notice as proof of payment.

Payment processing, delivery fulfilment, password recovery, and account verification are not included.

Run the backend checks with:

```sh
npm test
```
