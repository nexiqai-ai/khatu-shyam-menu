(() => {
  "use strict";
  const cfg = window.DHABA_CONFIG || {};
  const $ = (selector) => document.querySelector(selector);
  const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  const state = { items: [], quantities: new Map(), category: "All", busy: false };
  const grid = $("#menu-grid"), notice = $("#menu-message"), search = $("#search");

  function normalizeRows(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.menu)) return data.menu;
    if (data && Array.isArray(data.items)) return data.items;
    if (Array.isArray(data?.body)) return data.body;
    throw new Error("The menu endpoint did not return a list of menu rows.");
  }
  function normalizeItem(row, index) {
    const name = row["Item Name"] ?? row.item_name ?? row.name;
    const category = row.Category ?? row.category ?? "Other";
    const rawPrice = row.Price ?? row.price;
    const price = Number(String(rawPrice ?? "").replace(/[₹,\s]/g, ""));
    const available = row.Available ?? row.available ?? true;
    const isAvailable = ![false, 0, "0"].includes(available) && !["no", "false", "unavailable", "out of stock"].includes(String(available).trim().toLowerCase());
    if (typeof name !== "string" || !name.trim() || !Number.isFinite(price) || price < 0) return null;
    return { id: `${name.trim()}-${index}`, name: name.trim(), category: String(category), price, available: isAvailable };
  }
  async function loadMenu() {
    if (!cfg.menuUrl) {
      showMenuError("Menu connection needs setup", "Add the public n8n menu-read endpoint in config.js. It should return the existing Menu tab rows (Category, Item Name, Price, Available). No menu items or prices have been added here.");
      $("#dish-count").textContent = "Menu not connected";
      return;
    }
    try {
      const response = await fetch(cfg.menuUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Menu request failed (${response.status}).`);
      state.items = normalizeRows(await response.json()).map(normalizeItem).filter(Boolean);
      if (!state.items.length) throw new Error("No valid dishes were returned by the menu endpoint.");
      renderCategories(); renderMenu();
    } catch (error) {
      showMenuError("We couldn’t load the menu", `${error.message} Please try again in a moment or ask our team at the counter.`);
      $("#dish-count").textContent = "Menu unavailable";
    }
  }
  function showMenuError(title, detail) {
    notice.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
    notice.hidden = false;
  }
  function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function renderCategories() {
    const categories = ["All", ...new Set(state.items.map((item) => item.category))];
    $("#categories").innerHTML = categories.map((name) => `<button type="button" class="category-chip${name === state.category ? " active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
  }
  function renderMenu() {
    const term = search.value.trim().toLowerCase();
    const filtered = state.items.filter((item) => (state.category === "All" || item.category === state.category) && item.name.toLowerCase().includes(term));
    $("#dish-count").textContent = `${filtered.length} ${filtered.length === 1 ? "dish" : "dishes"}${term || state.category !== "All" ? " shown" : " on the menu"}`;
    $("#empty-results").hidden = filtered.length !== 0;
    grid.innerHTML = filtered.map((item) => {
      const quantity = state.quantities.get(item.id) || 0;
      const initial = item.name.trim().charAt(0).toUpperCase();
      return `<article class="dish-card${item.available ? "" : " unavailable"}"><div class="dish-art" aria-hidden="true"><span>${escapeHtml(initial)}</span><i></i></div><div class="dish-info"><span class="dish-category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.name)}</h3><strong class="dish-price">${money.format(item.price)}</strong>${item.available ? "" : '<small class="sold-out">Currently unavailable</small>'}</div><label class="quantity-control"><span class="sr-only">Quantity of ${escapeHtml(item.name)}</span><button type="button" data-step="-1" data-id="${escapeHtml(item.id)}" ${!quantity || !item.available ? "disabled" : ""} aria-label="Remove one ${escapeHtml(item.name)}">−</button><input type="number" min="0" max="99" step="1" inputmode="numeric" value="${quantity}" data-quantity="${escapeHtml(item.id)}" ${!item.available ? "disabled" : ""} aria-label="Quantity of ${escapeHtml(item.name)}"><button type="button" data-step="1" data-id="${escapeHtml(item.id)}" ${!item.available ? "disabled" : ""} aria-label="Add one ${escapeHtml(item.name)}">+</button></label></article>`;
    }).join("");
  }
  function updateSummary() {
    let selected = 0, totalQuantity = 0, amount = 0;
    for (const item of state.items) { const qty = state.quantities.get(item.id) || 0; if (qty > 0) selected++; totalQuantity += qty; amount += qty * item.price; }
    $("#selected-count").textContent = selected; $("#total-quantity").textContent = totalQuantity; $("#estimated-total").textContent = money.format(amount);
  }
  function changeQuantity(id, value) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !item.available) return;
    const qty = Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
    if (qty) state.quantities.set(id, qty); else state.quantities.delete(id);
    renderMenu(); updateSummary();
  }
  $("#categories").addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.category = button.dataset.category; renderCategories(); renderMenu(); });
  search.addEventListener("input", renderMenu);
  grid.addEventListener("click", (event) => { const button = event.target.closest("[data-step]"); if (button) changeQuantity(button.dataset.id, (state.quantities.get(button.dataset.id) || 0) + Number(button.dataset.step)); });
  grid.addEventListener("change", (event) => { const input = event.target.closest("[data-quantity]"); if (input) changeQuantity(input.dataset.quantity, input.value); });

  $("#order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#form-error"); error.hidden = true;
    if (state.busy) return;
    const name = $("#customer-name").value.trim(), phone = $("#phone").value.replace(/\D/g, "");
    const items = state.items.filter((item) => (state.quantities.get(item.id) || 0) > 0).map((item) => ({ item_name: item.name, quantity: state.quantities.get(item.id) }));
    if (!name) return showFormError("Please enter your name.");
    if (!/^\d{10}$/.test(phone)) return showFormError("Enter a valid 10-digit phone number.");
    if (!items.length) return showFormError("Choose at least one dish before placing your order.");
    if (!cfg.orderUrl) return showFormError("Order submission is not configured yet. Please ask the dhaba team for help.");
    setBusy(true);
    try {
      const response = await fetch(cfg.orderUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ customer_name: name, phone, items }) });
      const raw = await response.text();
      let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
      if (!response.ok) throw new Error(data.message || data.error || `Order could not be submitted (${response.status}).`);
      if (data.success === false || data.error) throw new Error(data.message || data.error || "The kitchen could not confirm your order.");
      const token = data.order_token ?? data.token ?? data.order?.order_token ?? data.order?.token;
      const amount = data.final_amount ?? data.total ?? data.total_amount ?? data.order?.final_amount ?? data.order?.total;
      if (!token) throw new Error(data.message || "We received a response but could not find an order token. Please contact the cashier before trying again.");
      $("#order-token").textContent = String(token);
      $("#final-amount").textContent = amount != null ? money.format(Number(amount)) : $("#estimated-total").textContent;
      $("#order-form").hidden = true; $("#success-panel").hidden = false;
      $(".order-card").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) { showFormError(err.message || "Something went wrong. Please try again or ask the cashier."); }
    finally { setBusy(false); }
  });
  function showFormError(message) { const el = $("#form-error"); el.textContent = message; el.hidden = false; el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function setBusy(busy) { state.busy = busy; const button = $("#submit-order"); button.disabled = busy; button.innerHTML = busy ? '<span>Sending your order…</span><span class="spinner"></span>' : '<span>Place my order</span><span aria-hidden="true">→</span>'; }
  $("#phone").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 10); });
  $("#new-order").addEventListener("click", () => { state.quantities.clear(); $("#success-panel").hidden = true; $("#order-form").hidden = false; $("#order-form").reset(); renderMenu(); updateSummary(); $("#menu").scrollIntoView({ behavior: "smooth" }); });
  updateSummary(); loadMenu();
})();
