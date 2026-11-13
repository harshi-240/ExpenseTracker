const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr = n => "₹" + Number(n).toLocaleString("en-IN", {maximumFractionDigits: 2});
const today = () => new Date().toLocaleDateString("en-CA");
const COL = ["#0e6ba8","#c8432b","#1e7f5c","#c99a2e","#6b5ca5","#2b8a99","#a24e7b","#7a7f87"];
let token = localStorage.getItem("et_token"), cats = [], editing = null, registering = false;

async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {method, headers: {"Content-Type": "application/json", ...(token ? {Authorization: "Bearer " + token} : {})}, body: body ? JSON.stringify(body) : undefined});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && token) logout(); throw new Error(d.error || "Something went wrong"); }
  return d;
}

/* ---------- authentication ---------- */
function setMode(reg) {
  registering = reg; $("#a-name").hidden = !reg; $("#a-submit").textContent = reg ? "Create account" : "Log in";
  $("#a-toggle").textContent = reg ? "Have an account? Log in" : "New here? Create an account"; $("#a-err").textContent = "";
}
$("#a-toggle").onclick = () => setMode(!registering);
$("#authform").onsubmit = async e => {
  e.preventDefault();
  try {
    const d = await api(registering ? "/register" : "/login", "POST", {name: $("#a-name").value, email: $("#a-email").value, password: $("#a-pw").value});
    token = d.token; localStorage.setItem("et_token", token); start(d.user.name);
  } catch (err) { $("#a-err").textContent = err.message; }
};
function logout() { if (token) api("/logout", "POST").catch(() => {}); token = null; localStorage.removeItem("et_token"); $("#app").hidden = true; $("#auth").hidden = false; setMode(false); }
$("#logout").onclick = logout;

async function start(name) {
  if (!name) { try { name = (await api("/profile")).name; } catch { return; } }
  $("#who").textContent = name; $("#auth").hidden = true; $("#app").hidden = false; route();
}

/* ---------- routing ---------- */
const views = {dashboard, add: openForm, history: loadHistory, reports: loadReports, profile: loadProfile};
function route() {
  let v = location.hash.slice(1); if (!views[v]) v = "dashboard";
  if (v !== "add" && editing) { editing = null; }
  $$("main > section").forEach(s => s.hidden = s.id !== "v-" + v);
  $$("nav a").forEach(a => a.classList.toggle("on", a.hash === "#" + v));
  views[v]().catch(e => console.error(e));
}
window.onhashchange = () => !$("#app").hidden && route();

/* ---------- shared bits ---------- */
function rows(list, actions) {
  if (!list.length) return `<tr><td class="empty">No transactions yet. Use Add transaction to record your first one.</td></tr>`;
  return list.map(t => `<tr><td class="mute">${esc(t.date)}</td><td>${esc(t.category)}<br><span class="mute">${esc(t.description)}</span></td>
  <td class="amt ${t.type}">${t.type === "income" ? "+" : "−"}${inr(t.amount)}${actions ? `<br><button class="ghost sm" data-edit="${t.id}">Edit</button><button class="ghost sm del" data-del="${t.id}">Delete</button>` : ""}</td></tr>`).join("");
}
let listCache = [];
document.addEventListener("click", async e => {
  const ed = e.target.dataset.edit, de = e.target.dataset.del;
  if (ed) { editing = listCache.find(t => t.id == ed); if (location.hash === "#add") route(); else location.hash = "#add"; }
  if (de && confirm("Delete this transaction? This cannot be undone.")) { await api("/transactions/" + de, "DELETE"); loadHistory(); }
});

/* ---------- dashboard ---------- */
async function dashboard() {
  const [s, t] = await Promise.all([api("/summary"), api("/transactions?limit=6")]);
  $("#d-balance").textContent = inr(s.balance); $("#d-income").textContent = inr(s.income); $("#d-expense").textContent = inr(s.expense);
  const a = $("#d-alert"), pct = s.limit > 0 ? Math.round(s.month_spent / s.limit * 100) : 0;
  a.hidden = !(s.limit > 0 && pct >= 80);
  a.textContent = pct > 100 ? `You have spent ${inr(s.month_spent)} this month, over your limit of ${inr(s.limit)}.` : `You have used ${pct}% of your ${inr(s.limit)} monthly limit.`;
  $("#d-recent").innerHTML = rows(t, false);
}

/* ---------- add / edit ---------- */
const kind = () => document.querySelector("input[name=type]:checked").value;
function fillCats(sel) {
  $("#f-cat").innerHTML = cats.filter(c => c.kind === kind()).map(c => `<option>${esc(c.name)}</option>`).join("");
  if (sel) $("#f-cat").value = sel;
}
$$("input[name=type]").forEach(r => r.onchange = () => fillCats());
async function openForm() {
  cats = await api("/categories"); const t = editing;
  $("#f-title").textContent = t ? "Edit transaction" : "Add transaction"; $("#f-cancel").hidden = !t; $("#f-err").textContent = "";
  document.querySelector(`input[name=type][value=${t ? t.type : "expense"}]`).checked = true; fillCats(t && t.category);
  $("#f-amount").value = t ? t.amount : ""; $("#f-date").value = t ? t.date : today(); $("#f-desc").value = t ? t.description : "";
}
$("#f-cancel").onclick = () => { editing = null; location.hash = "#history"; };
$("#f-addcat").onclick = async () => {
  try { cats = await api("/categories", "POST", {kind: kind(), name: $("#f-newcat").value}); fillCats($("#f-newcat").value.trim()); $("#f-newcat").value = ""; $("#f-err").textContent = ""; }
  catch (err) { $("#f-err").textContent = err.message; }
};
$("#txform").onsubmit = async e => {
  e.preventDefault();
  const body = {type: kind(), amount: $("#f-amount").value, date: $("#f-date").value, category: $("#f-cat").value, description: $("#f-desc").value};
  try { await api(editing ? "/transactions/" + editing.id : "/transactions", editing ? "PUT" : "POST", body); editing = null; location.hash = "#history"; }
  catch (err) { $("#f-err").textContent = err.message; }
};

/* ---------- history ---------- */
const hq = () => new URLSearchParams(Object.entries({q: $("#h-q").value, type: $("#h-type").value, category: $("#h-cat").value, from: $("#h-from").value, to: $("#h-to").value}).filter(([, v]) => v)).toString();
async function loadHistory() {
  if (!$("#h-cat").options.length) {
    cats = await api("/categories"); const names = [...new Set(cats.map(c => c.name))];
    $("#h-cat").innerHTML = `<option value="">All categories</option>` + names.map(n => `<option>${esc(n)}</option>`).join("");
  }
  listCache = await api("/transactions?" + hq()); $("#h-rows").innerHTML = rows(listCache, true);
}
["#h-q", "#h-type", "#h-cat", "#h-from", "#h-to"].forEach(s => $(s).oninput = loadHistory);
$("#h-export").onclick = async () => {
  const r = await fetch("/api/export?" + hq(), {headers: {Authorization: "Bearer " + token}});
  const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "transactions.csv"; a.click();
};

/* ---------- reports ---------- */
function donut(items) {
  const tot = items.reduce((a, i) => a + i.total, 0); if (!tot) return `<p class="empty">No expenses in this period.</p>`;
  const R = 70, C = 2 * Math.PI * R; let off = 0;
  const arcs = items.map((i, k) => { const len = i.total / tot * C, s = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${COL[k % 8]}" stroke-width="28" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`; off += len; return s; }).join("");
  const leg = items.map((i, k) => `<li><i style="background:${COL[k % 8]}"></i>${esc(i.category)} <b>${inr(i.total)}</b> <span>${Math.round(i.total / tot * 100)}%</span></li>`).join("");
  return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Spending by category">${arcs}</svg><ul>${leg}</ul></div>`;
}
function bars(ms) {
  if (!ms.length) return `<p class="empty">No transactions in this period.</p>`;
  const max = Math.max(...ms.flatMap(m => [m.income, m.expense]), 1), w = 80;
  const g = ms.map((m, i) => { const x = 20 + i * w, hi = m.income / max * 140, he = m.expense / max * 140;
    return `<rect x="${x}" y="${160 - hi}" width="26" height="${hi}" fill="#1e7f5c"><title>Income ${inr(m.income)}</title></rect><rect x="${x + 28}" y="${160 - he}" width="26" height="${he}" fill="#c8432b"><title>Expenses ${inr(m.expense)}</title></rect><text x="${x + 27}" y="178" text-anchor="middle">${m.month}</text>`; }).join("");
  return `<svg class="bars" viewBox="0 0 ${ms.length * w + 30} 190" role="img" aria-label="Monthly income and expenses">${g}</svg><p class="mute"><span class="in">Green: income</span> · <span class="out">Red: expenses</span></p>`;
}
async function loadReports() {
  const p = new URLSearchParams(Object.entries({from: $("#r-from").value, to: $("#r-to").value}).filter(([, v]) => v));
  const s = await api("/summary?" + p);
  $("#r-income").textContent = inr(s.income); $("#r-expense").textContent = inr(s.expense);
  $("#r-cat").innerHTML = donut(s.by_category); $("#r-month").innerHTML = bars(s.by_month);
}
["#r-from", "#r-to"].forEach(s => $(s).oninput = loadReports);
$("#r-all").onclick = () => { $("#r-from").value = $("#r-to").value = ""; loadReports(); };

/* ---------- profile ---------- */
async function loadProfile() { const p = await api("/profile"); $("#p-name").value = p.name; $("#p-email").value = p.email; $("#p-limit").value = p.monthly_limit; $("#p-err").textContent = ""; }
$("#pform").onsubmit = async e => {
  e.preventDefault();
  try { const p = await api("/profile", "PUT", {name: $("#p-name").value, monthly_limit: $("#p-limit").value}); $("#who").textContent = p.name; $("#p-err").textContent = "Profile saved."; }
  catch (err) { $("#p-err").textContent = err.message; }
};

setMode(false);
token ? start() : ($("#auth").hidden = false);
