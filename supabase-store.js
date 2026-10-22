"use strict";

const { randomUUID } = require("node:crypto");

class SupabaseStore {
  constructor({ url, anonKey, serviceRoleKey, fetchImpl = globalThis.fetch }) {
    this.url = url.replace(/\/+$/, "");
    this.anonKey = anonKey;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
    this.pendingUpdates = new Map();
    this.pendingProductUpdate = Promise.resolve();
  }

  async request(path, { method = "GET", body, prefer, apiKey = this.serviceRoleKey, allowNoContent = false } = {}) {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let result = null;
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }
    }
    if (!response.ok && !(allowNoContent && response.status === 404)) {
      const detail = typeof result === "object" && result
        ? result.message || result.msg || result.error_description || result.error || "Request rejected."
        : String(result || "Request rejected.");
      const error = new Error(`Supabase request failed (${response.status}): ${detail}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async readProducts() {
    const rows = await this.request("/rest/v1/products?select=*&is_active=eq.true&order=id.asc");
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      category: row.category,
      detail: row.detail,
      description: row.description,
      price: Number(row.price),
      tag: row.tag,
      image: row.image,
    }));
  }

  async updateProducts(callback) {
    const update = this.pendingProductUpdate.catch(() => {}).then(async () => {
      const before = await this.readProducts();
      const after = structuredClone(before);
      const result = await callback(after);
      const beforeById = new Map(before.map((product) => [product.id, product]));
      const afterById = new Map(after.map((product) => [product.id, product]));
      for (const [id, product] of afterById) {
        const previous = beforeById.get(id);
        if (previous && JSON.stringify(previous) === JSON.stringify(product)) continue;
        const row = productToRow(product);
        await this.request(`/rest/v1/products?id=eq.${id}`, {
          method: previous ? "PATCH" : "POST",
          body: previous ? row : { ...row, is_active: true },
          prefer: "return=representation",
        });
      }
      for (const id of beforeById.keys()) {
        if (!afterById.has(id)) {
          await this.request(`/rest/v1/products?id=eq.${id}`, { method: "DELETE" });
        }
      }
      return result;
    });
    this.pendingProductUpdate = update;
    return update;
  }

  async createAuthUser({ email, password, firstName, lastName }) {
    return this.request("/auth/v1/admin/users", {
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName },
      },
    });
  }

  async deleteAuthUser(id) {
    await this.request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async signIn(email, password) {
    return this.request("/auth/v1/token?grant_type=password", {
      method: "POST",
      apiKey: this.anonKey,
      body: { email, password },
    });
  }

  async upsertCustomerProfile(profile) {
    const row = {
      id: profile.id,
      first_name: profile.firstName,
      last_name: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      region: profile.region,
      ...(profile.createdAt ? { created_at: profile.createdAt } : {}),
    };
    await this.request("/rest/v1/customer_profiles?on_conflict=id", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  async getCustomerProfile(id) {
    const rows = await this.request(`/rest/v1/customer_profiles?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? profileFromRow(rows[0]) : null;
  }

  async createCustomerNotification(customerId, notification) {
    await this.request("/rest/v1/customer_notifications", {
      method: "POST",
      body: {
        id: notification.id || randomUUID(),
        customer_id: customerId,
        subject: notification.subject,
        message: notification.message,
        created_at: notification.date || new Date().toISOString(),
      },
      prefer: "return=minimal",
    });
  }

  async read(name) {
    switch (name) {
      case "sessions.json": {
        const rows = await this.request("/rest/v1/app_sessions?select=*");
        return rows.map((row) => ({
          tokenHash: row.token_hash,
          role: row.role,
          customerId: row.customer_id,
          expires: new Date(row.expires_at).getTime(),
        }));
      }
      case "users.json": {
        const [profiles, notifications] = await Promise.all([
          this.request("/rest/v1/customer_profiles?select=*&order=created_at.desc"),
          this.request("/rest/v1/customer_notifications?select=*&order=created_at.desc"),
        ]);
        const inboxByCustomer = new Map();
        for (const row of notifications) {
          const inbox = inboxByCustomer.get(row.customer_id) || [];
          inbox.push({
            id: row.id,
            subject: row.subject,
            message: row.message,
            date: row.created_at,
            readAt: row.read_at,
          });
          inboxByCustomer.set(row.customer_id, inbox);
        }
        return profiles.map((row) => ({
          ...profileFromRow(row),
          orders: [],
          inbox: inboxByCustomer.get(row.id) || [],
        }));
      }
      case "orders.json": {
        const rows = await this.request("/rest/v1/orders?select=*,order_items(*)&order=created_at.desc");
        return rows.map(orderFromRow);
      }
      case "messages.json": {
        const rows = await this.request("/rest/v1/contact_messages?select=*&order=created_at.desc");
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          message: row.message,
          date: row.created_at,
          isRead: row.is_read,
        }));
      }
      case "newsletter.json": {
        const rows = await this.request("/rest/v1/newsletter_subscribers?select=*&order=subscribed_at.desc");
        return rows.map((row) => ({ email: row.email, subscribedAt: row.subscribed_at }));
      }
      case "hub-staff.json": {
        const rows = await this.request("/rest/v1/hub_staff_accounts?select=*&order=created_at.asc");
        return rows.map((row) => ({
          id: row.id,
          email: row.email,
          passwordSalt: row.password_salt,
          passwordHash: row.password_hash,
          verificationTokenHash: row.verification_token_hash,
          verificationExpires: row.verification_expires_at ? new Date(row.verification_expires_at).getTime() : null,
          verifiedAt: row.verified_at,
          createdAt: row.created_at,
        }));
      }
      default:
        throw new Error(`Supabase storage does not support ${name}.`);
    }
  }

  async update(name, callback) {
    const previous = this.pendingUpdates.get(name) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const before = await this.read(name);
      const after = structuredClone(before);
      const result = await callback(after);
      await this.persistChanges(name, before, after);
      return result?.value;
    });
    this.pendingUpdates.set(name, next);
    return next.finally(() => {
      if (this.pendingUpdates.get(name) === next) this.pendingUpdates.delete(name);
    });
  }

  async persistChanges(name, before, after) {
    switch (name) {
      case "sessions.json":
        return this.syncRows(before, after, (row) => row.tokenHash, async (row, previous) => {
          const record = {
            token_hash: row.tokenHash,
            role: row.role || "customer",
            customer_id: row.customerId || null,
            expires_at: new Date(row.expires).toISOString(),
          };
          await this.request(`/rest/v1/app_sessions?on_conflict=token_hash`, {
            method: "POST",
            body: record,
            prefer: "resolution=merge-duplicates,return=minimal",
          });
        }, async (row) => this.request(`/rest/v1/app_sessions?token_hash=eq.${encodeURIComponent(row.tokenHash)}`, { method: "DELETE" }));
      case "users.json":
        return this.syncRows(before, after, (row) => row.id, async (row, previous) => {
          if (!previous) throw new Error("Customer accounts must be created through Supabase Auth.");
          if (row.firstName !== previous.firstName
            || row.lastName !== previous.lastName
            || row.email !== previous.email
            || row.phone !== previous.phone
            || row.address !== previous.address
            || row.city !== previous.city
            || row.region !== previous.region) {
            await this.upsertCustomerProfile(row);
          }
          const oldInbox = new Map((previous.inbox || []).map((item) => [item.id, item]));
          const newInbox = new Map((row.inbox || []).map((item) => [item.id, item]));
          for (const [id, item] of newInbox) {
            if (oldInbox.has(id)) continue;
            await this.request("/rest/v1/customer_notifications", {
              method: "POST",
              body: {
                id: item.id || randomUUID(),
                customer_id: row.id,
                subject: item.subject,
                message: item.message,
                created_at: item.date || new Date().toISOString(),
                read_at: item.readAt || null,
              },
              prefer: "return=minimal",
            });
          }
        }, async (row) => {
          await this.request(`/rest/v1/customer_profiles?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" });
        });
      case "orders.json":
        return this.syncRows(before, after, (row) => row.id, async (row, previous) => {
          const record = orderToRow(row);
          if (previous) {
            await this.request(`/rest/v1/orders?id=eq.${encodeURIComponent(row.id)}`, {
              method: "PATCH",
              body: record,
              prefer: "return=minimal",
            });
            return;
          }
          await this.request("/rest/v1/orders", { method: "POST", body: record, prefer: "return=minimal" });
          try {
            await this.request("/rest/v1/order_items", {
              method: "POST",
              body: row.items.map((item) => ({
                order_id: row.id,
                product_id: item.id,
                product_name: item.name,
                image: item.image,
                quantity: item.quantity,
                unit_price: item.price,
              })),
              prefer: "return=minimal",
            });
          } catch (error) {
            await this.request(`/rest/v1/orders?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" }).catch(() => {});
            throw error;
          }
        }, async (row) => this.request(`/rest/v1/orders?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" }));
      case "messages.json":
        return this.syncRows(before, after, (row) => row.id, async (row, previous) => {
          const record = {
            name: row.name,
            phone: row.phone,
            message: row.message,
            created_at: row.date,
            is_read: Boolean(row.isRead),
          };
          await this.request(previous
            ? `/rest/v1/contact_messages?id=eq.${encodeURIComponent(row.id)}`
            : "/rest/v1/contact_messages", {
            method: previous ? "PATCH" : "POST",
            body: previous ? { is_read: record.is_read } : { ...record, id: row.id },
            prefer: "return=minimal",
          });
        }, async (row) => this.request(`/rest/v1/contact_messages?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE" }));
      case "newsletter.json":
        return this.syncRows(before, after, (row) => row.email, async (row, previous) => {
          if (previous) return;
          await this.request("/rest/v1/newsletter_subscribers?on_conflict=email", {
            method: "POST",
            body: { email: row.email, subscribed_at: row.subscribedAt },
            prefer: "resolution=ignore-duplicates,return=minimal",
          });
        }, async (row) => this.request(`/rest/v1/newsletter_subscribers?email=eq.${encodeURIComponent(row.email)}`, { method: "DELETE" }));
      case "hub-staff.json":
        return this.syncRows(before, after, (row) => row.email, async (row, previous) => {
          const record = {
            email: row.email,
            password_salt: row.passwordSalt,
            password_hash: row.passwordHash,
            verification_token_hash: row.verificationTokenHash || null,
            verification_expires_at: row.verificationExpires ? new Date(row.verificationExpires).toISOString() : null,
            verified_at: row.verifiedAt || null,
            created_at: row.createdAt,
          };
          await this.request(previous
            ? `/rest/v1/hub_staff_accounts?email=eq.${encodeURIComponent(row.email)}`
            : "/rest/v1/hub_staff_accounts", {
            method: previous ? "PATCH" : "POST",
            body: record,
            prefer: "return=minimal",
          });
        }, async (row) => this.request(`/rest/v1/hub_staff_accounts?email=eq.${encodeURIComponent(row.email)}`, { method: "DELETE" }));
      default:
        throw new Error(`Supabase storage does not support ${name}.`);
    }
  }

  async syncRows(before, after, getKey, writeRow, deleteRow) {
    const previousRows = new Map(before.map((row) => [getKey(row), row]));
    const nextRows = new Map(after.map((row) => [getKey(row), row]));
    for (const [key, row] of nextRows) {
      const previous = previousRows.get(key);
      if (previous && JSON.stringify(previous) === JSON.stringify(row)) continue;
      await writeRow(row, previous);
    }
    for (const [key, row] of previousRows) {
      if (!nextRows.has(key)) await deleteRow(row);
    }
  }

  async uploadProductImage(filename, image, contentType) {
    const response = await this.fetchImpl(`${this.url}/storage/v1/object/product-images/${filename}`, {
      method: "POST",
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body: image,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase image upload failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return `${this.url}/storage/v1/object/public/product-images/${encodeURIComponent(filename)}`;
  }
}

function profileFromRow(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    region: row.region,
    createdAt: row.created_at,
  };
}

function productToRow(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    detail: product.detail,
    description: product.description,
    price: product.price,
    tag: product.tag,
    image: product.image,
    is_active: true,
  };
}

function orderToRow(order) {
  return {
    id: order.id,
    customer_id: order.customerId,
    status: order.status,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    subtotal: order.subtotal,
    delivery_fee: order.deliveryFee,
    delivery_estimate: order.deliveryEstimate,
    delivery_tier: order.deliveryTier,
    delivery_origin: order.deliveryOrigin,
    customer_name: order.customer.name,
    customer_email: order.customer.email,
    customer_phone: order.customer.phone,
    delivery_street: order.deliveryAddress.street,
    delivery_city: order.deliveryAddress.city,
    delivery_state: order.deliveryAddress.state,
    total: order.total,
    payment_confirmed_at: order.paymentConfirmedAt || null,
    created_at: order.date,
    updated_at: order.updatedAt || order.date,
  };
}

function orderFromRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    date: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    deliveryEstimate: row.delivery_estimate,
    deliveryTier: row.delivery_tier,
    deliveryOrigin: row.delivery_origin,
    customer: {
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    deliveryAddress: {
      street: row.delivery_street,
      city: row.delivery_city,
      state: row.delivery_state,
    },
    items: (row.order_items || []).map((item) => ({
      id: Number(item.product_id),
      name: item.product_name,
      image: item.image,
      quantity: item.quantity,
      price: Number(item.unit_price),
    })),
    total: Number(row.total),
  };
}

module.exports = { SupabaseStore };
