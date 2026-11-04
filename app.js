(() => {
  "use strict";

  const config = window.DHABA_CONFIG || {};
  const $ = (selector) => document.querySelector(selector);
  const money = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
  const state = {
    items: [],
    quantities: new Map(),
    category: "All",
    busy: false,
    uncertainSubmission: false,
    pendingIdempotencyKey: "",
  };
  const ORDER_ATTEMPT_STORAGE_KEY = "ksvd-pending-order-v1";
  const grid = $("#menu-grid");
  const notice = $("#menu-message");
  const search = $("#search");

  function normalizeRows(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.menu)) return data.menu;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.body)) return data.body;
    throw new Error("The menu service returned an unexpected response.");
  }

  function normalizeItem(row, index) {
    if (!row || typeof row !== "object") return null;
    const name = row["Item Name"] ?? row.item_name ?? row.name;
    const category = row.Category ?? row.category ?? "Other";
    const rawPrice = row.Price ?? row.price;
    const price = Number(String(rawPrice ?? "").replace(/[₹,\s]/g, ""));
    const available = row.Available ?? row.available ?? true;
    const isAvailable = ![false, 0, "0"].includes(available)
      && !["no", "false", "unavailable", "out of stock"].includes(String(available).trim().toLowerCase());

    if (typeof name !== "string" || !name.trim() || !Number.isFinite(price) || price < 0) return null;
    return {
      id: `${name.trim()}-${index}`,
      name: name.trim(),
      category: String(category),
      price,
      available: isAvailable,
    };
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadMenu() {
    notice.hidden = true;
    if (!config.menuUrl) {
      showMenuError("Menu unavailable", "Please ask our team at the counter for today’s menu.", false);
      $("#dish-count").textContent = "Menu unavailable";
      return;
    }

    $("#dish-count").textContent = "Loading the menu…";
    try {
      const response = await fetchWithTimeout(config.menuUrl, {
        headers: { Accept: "application/json" },
      }, 20000);
      if (!response.ok) throw new Error("The menu service is unavailable.");
      const rows = normalizeRows(await response.json());
      state.items = rows.map(normalizeItem).filter(Boolean);
      if (!state.items.length) {
        showMenuError("The menu is empty right now", "Please ask our team at the counter for help.", true);
        $("#dish-count").textContent = "No dishes available";
        return;
      }
      state.category = "All";
      renderCategories();
      renderMenu();
      updateSummary();
    } catch {
      showMenuError("We couldn’t load the menu", "Check your connection and try again, or ask our team at the counter.", true);
      $("#dish-count").textContent = "Menu unavailable";
    }
  }

  function showMenuError(title, detail, retry) {
    notice.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>${retry ? '<button class="menu-retry" type="button" data-retry-menu>Try again</button>' : ""}`;
    notice.hidden = false;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  async function getOrderIdempotencyKey(name, phone, items) {
    const payload = JSON.stringify({ name, phone, items });
    const bytes = new TextEncoder().encode(payload);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
      const saved = JSON.parse(window.localStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY) || "null");
      if (saved?.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(saved.key || "")) {
        return saved.key;
      }
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
    const key = window.crypto.randomUUID();
    try {
      window.localStorage.setItem(ORDER_ATTEMPT_STORAGE_KEY, JSON.stringify({ key, fingerprint }));
    } catch {
      // The in-memory key still protects retries while this page remains open.
    }
    return key;
  }

  function renderCategories() {
    const categories = ["All", ...new Set(state.items.map((item) => item.category))];
    $("#categories").innerHTML = categories.map((name) => `
      <button type="button" class="category-chip${name === state.category ? " active" : ""}" data-category="${escapeHtml(name)}">
        ${escapeHtml(name)}
      </button>`).join("");
  }

  function renderMenu() {
    const term = search.value.trim().toLocaleLowerCase();
    const filtered = state.items.filter((item) => (
      (state.category === "All" || item.category === state.category)
      && item.name.toLocaleLowerCase().includes(term)
    ));

    $("#dish-count").textContent = `${filtered.length} ${filtered.length === 1 ? "dish" : "dishes"}${term || state.category !== "All" ? " shown" : " on the menu"}`;
    $("#empty-results").hidden = filtered.length !== 0;
    grid.innerHTML = filtered.map((item) => {
      const quantity = state.quantities.get(item.id) || 0;
      const initial = item.name.trim().charAt(0).toUpperCase();
      return `
        <article class="dish-card${item.available ? "" : " unavailable"}">
          <div class="dish-art" aria-hidden="true"><span>${escapeHtml(initial)}</span><i></i></div>
          <div class="dish-info">
            <span class="dish-category">${escapeHtml(item.category)}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <strong class="dish-price">${money.format(item.price)}</strong>
            ${item.available ? "" : '<small class="sold-out">Currently unavailable</small>'}
          </div>
          <label class="quantity-control">
            <span class="sr-only">Quantity of ${escapeHtml(item.name)}</span>
            <button type="button" data-step="-1" data-id="${escapeHtml(item.id)}" ${!quantity || !item.available ? "disabled" : ""} aria-label="Remove one ${escapeHtml(item.name)}">−</button>
            <input type="number" min="0" max="99" step="1" inputmode="numeric" value="${quantity}" data-quantity="${escapeHtml(item.id)}" ${!item.available ? "disabled" : ""} aria-label="Quantity of ${escapeHtml(item.name)}">
            <button type="button" data-step="1" data-id="${escapeHtml(item.id)}" ${!item.available ? "disabled" : ""} aria-label="Add one ${escapeHtml(item.name)}">+</button>
          </label>
        </article>`;
    }).join("");
  }

  function updateSummary() {
    let selected = 0;
    let totalQuantity = 0;
    let total = 0;
    const cart = [];

    for (const item of state.items) {
      const quantity = state.quantities.get(item.id) || 0;
      if (!quantity) continue;
      selected += 1;
      totalQuantity += quantity;
      total += quantity * item.price;
      cart.push({ item, quantity });
    }

    $("#selected-count").textContent = String(selected);
    $("#total-quantity").textContent = String(totalQuantity);
    $("#estimated-total").textContent = money.format(total);
    $("#cart-empty").hidden = cart.length > 0;
    $("#cart-items").innerHTML = cart.map(({ item, quantity }) => `
      <li class="cart-row">
        <span class="cart-item-name">${escapeHtml(item.name)}<small>${quantity} × ${money.format(item.price)}</small></span>
        <span class="cart-line-total">${money.format(quantity * item.price)}</span>
        <span class="cart-quantity-control" aria-label="Change quantity for ${escapeHtml(item.name)}">
          <button type="button" data-cart-step="-1" data-id="${escapeHtml(item.id)}" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
          <span>${quantity}</span>
          <button type="button" data-cart-step="1" data-id="${escapeHtml(item.id)}" aria-label="Add one ${escapeHtml(item.name)}">+</button>
        </span>
      </li>`).join("");
  }

  function changeQuantity(id, value) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !item.available) return;
    const quantity = Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
    if (quantity) state.quantities.set(id, quantity);
    else state.quantities.delete(id);
    renderMenu();
    updateSummary();
  }

  $("#categories").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    renderCategories();
    renderMenu();
  });
  search.addEventListener("input", renderMenu);
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (button) changeQuantity(button.dataset.id, (state.quantities.get(button.dataset.id) || 0) + Number(button.dataset.step));
  });
  grid.addEventListener("change", (event) => {
    const input = event.target.closest("[data-quantity]");
    if (input) changeQuantity(input.dataset.quantity, input.value);
  });
  $("#cart-items").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-step]");
    if (button) changeQuantity(button.dataset.id, (state.quantities.get(button.dataset.id) || 0) + Number(button.dataset.cartStep));
  });
  notice.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-menu]")) loadMenu();
  });

  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#form-error");
    const status = $("#submit-status");
    error.hidden = true;
    status.hidden = true;
    if (state.busy || state.uncertainSubmission) return;

    const name = $("#customer-name").value.trim();
    const phone = $("#phone").value.replace(/\D/g, "");
    const items = state.items
      .filter((item) => (state.quantities.get(item.id) || 0) > 0)
      .map((item) => ({ item_name: item.name, quantity: state.quantities.get(item.id) }));

    if (!name) return showFormError("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone)) return showFormError("Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.");
    if (!items.length) return showFormError("Add at least one dish to your order.");
    if (!config.orderUrl) return showFormError("Online ordering is temporarily unavailable. Please place your order at the counter.");

    let idempotencyKey;
    // Lock synchronously before hashing or touching storage. Otherwise two fast
    // submit events can both pass the busy check and generate different keys.
    setBusy(true);
    try {
      idempotencyKey = state.pendingIdempotencyKey || await getOrderIdempotencyKey(name, phone, items);
      state.pendingIdempotencyKey = idempotencyKey;
    } catch {
      setBusy(false);
      return showFormError("This browser cannot create a safe order reference. Please place the order with our staff.");
    }

    const slowMessageTimer = window.setTimeout(() => {
      status.textContent = "Your order is taking a little longer than usual. Please keep this page open.";
      status.hidden = false;
    }, 10000);

    try {
      const response = await fetchWithTimeout(config.orderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ customer_name: name, phone, idempotency_key: idempotencyKey, items }),
      }, 60000);

      let data;
      try {
        data = await response.json();
      } catch {
        markUncertain("We didn’t receive a valid order confirmation. Please check with the cashier before trying again.");
        return;
      }

      if (!response.ok) {
        markUncertain("We couldn’t confirm your order. Please check with the cashier before trying again.");
        return;
      }
      if (data?.success !== true) {
        markUncertain("We didn’t receive a valid order confirmation. Please check with the cashier before trying again.");
        return;
      }

      const token = typeof data.order_token === "string" ? data.order_token.trim() : "";
      const amount = data.total_amount;
      const paymentStatus = typeof data.payment_status === "string" ? data.payment_status.trim() : "";
      if (!token || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !paymentStatus) {
        markUncertain("We didn’t receive the order number and final amount. Please check with the cashier before trying again.");
        return;
      }

      $("#order-token").textContent = token;
      $("#final-amount").textContent = money.format(amount);
      $("#payment-status").textContent = paymentStatus;
      state.pendingIdempotencyKey = "";
      try { window.localStorage.removeItem(ORDER_ATTEMPT_STORAGE_KEY); } catch { /* Ignore storage cleanup failures. */ }
      $("#confirmation-items").innerHTML = items.map((item) => (
        `<li><span>${escapeHtml(item.item_name)}</span><strong>× ${item.quantity}</strong></li>`
      )).join("");
      $("#order-form").hidden = true;
      $("#success-panel").hidden = false;
      $(".order-card").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (requestError) {
      markUncertain(requestError.name === "AbortError"
        ? "We couldn’t confirm the order before the request timed out. It may still have reached the dhaba. Please check with the cashier before placing it again."
        : "We lost the connection before receiving confirmation. Your order may still have reached the dhaba. Please check with the cashier before placing it again.");
    } finally {
      window.clearTimeout(slowMessageTimer);
      status.hidden = true;
      setBusy(false);
    }
  });

  function showFormError(message) {
    const error = $("#form-error");
    error.textContent = message;
    error.hidden = false;
    error.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function markUncertain(message) {
    state.uncertainSubmission = true;
    showFormError(message);
  }

  function setBusy(busy) {
    state.busy = busy;
    const button = $("#submit-order");
    button.disabled = busy || state.uncertainSubmission;
    button.innerHTML = busy
      ? '<span>Sending your order…</span><span class="spinner" aria-hidden="true"></span>'
      : state.uncertainSubmission
        ? '<span>Check with the cashier</span><span aria-hidden="true">!</span>'
        : '<span>Place my order</span><span aria-hidden="true">→</span>';
  }

  $("#phone").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 10);
  });
  $("#new-order").addEventListener("click", () => {
    state.quantities.clear();
    $("#success-panel").hidden = true;
    $("#order-form").hidden = false;
    $("#order-form").reset();
    state.uncertainSubmission = false;
    state.pendingIdempotencyKey = "";
    try { window.localStorage.removeItem(ORDER_ATTEMPT_STORAGE_KEY); } catch { /* Ignore storage cleanup failures. */ }
    renderMenu();
    updateSummary();
    $("#menu").scrollIntoView({ behavior: "smooth" });
  });

  updateSummary();
  loadMenu();
})();
