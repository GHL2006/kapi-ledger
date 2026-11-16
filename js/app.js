/* ============================================================
   咔皮记账 · 前端主逻辑（纯前端 + Supabase）
   数据全部存 Supabase PostgreSQL，图片存 Supabase Storage。
   ============================================================ */
/* global supabase, echarts, SUPABASE_URL, SUPABASE_ANON_KEY */

const $ = (id) => document.getElementById(id);
const TZ = "Asia/Shanghai";

const state = {
  sb: null,
  user: null,
  me: null,
  other: null,
  viewOwnerId: null,
  categories: [],
  bills: [],
  prevBills: [],
  assets: [],
  today: { amount: 0, count: 0 },
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  annualYear: new Date().getFullYear(),
  page: "bill",
  selectedCategoryId: null,
  editingBill: null,
  existingImagePath: null,
  removeExistingImage: false,
  pendingImageFile: null,
  assetType: 1,
  chart: null,
  annualCache: null,
  signedUrlCache: new Map(),
};

/* ------------------------- 小工具 ------------------------- */
const pad2 = (n) => String(n).padStart(2, "0");
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function fmtAmount(n) {
  const num = Number(n) || 0;
  const decimals = Math.abs(num % 1) > 0.0001 ? 2 : 0;
  return num.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  });
}
const money = (n) => "¥" + fmtAmount(n);

function sum(list) {
  return list.reduce((s, x) => s + Number(x.amount || 0), 0);
}

function hexToSoft(hex, alpha = 0.12) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return `rgba(164,176,190,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const categoryMap = () => new Map(state.categories.map((c) => [Number(c.id), c]));
function categoryOf(id) {
  return categoryMap().get(Number(id)) || { name: "未分类", icon: "📦", color: "#A4B0BE" };
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ------------------------- 日期处理 ------------------------- */
function monthRange(year, month) {
  const start = `${year}-${pad2(month)}-01T00:00:00+08:00`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return { start, end: `${ny}-${pad2(nm)}-01T00:00:00+08:00` };
}

function dateKey(iso) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(iso));
}

function nextDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function todayRange() {
  const key = dateKey(new Date().toISOString());
  return {
    start: `${key}T00:00:00+08:00`,
    end: `${nextDateKey(key)}T00:00:00+08:00`,
  };
}

function timeText(iso) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

function weekdayText(iso) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, weekday: "short" }).format(
    new Date(iso)
  );
}

function toLocalInput(value) {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/* ------------------------- Supabase 初始化 ------------------------- */
function configured() {
  return (
    SUPABASE_URL &&
    !SUPABASE_URL.includes("YOUR_") &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes("YOUR_")
  );
}

function initSupabase() {
  if (!configured()) return false;
  state.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function getSession() {
  const { data } = await state.sb.auth.getSession();
  return data.session;
}

function showLogin() {
  $("appScreen").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("loginError").classList.add("hidden");
}

async function boot() {
  const ok = initSupabase();
  if (!ok) {
    $("configWarning").classList.remove("hidden");
    showLogin();
    return;
  }
  const session = await getSession().catch(() => null);
  if (session && session.user) {
    await enterApp(session.user);
  } else {
    showLogin();
  }
  state.sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLogin();
  });
}

/* ------------------------- 登录 / 初始化数据 ------------------------- */
async function enterApp(user) {
  state.user = user;
  state.me = { id: user.id, email: user.email, display_name: user.email?.split("@")[0] || "我" };
  $("loginScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");

  await loadProfiles();
  await loadCategories();

  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  state.annualYear = state.year;
  state.viewOwnerId = state.me.id;

  renderMonthPicker();
  renderYearPicker();
  await loadAll();
  switchPage("bill");
  toast("登录成功");
}

async function loadProfiles() {
  const { data, error } = await state.sb.from("profiles").select("*");
  if (error) {
    console.warn("读取 profiles 失败：", error.message);
    return;
  }
  const rows = data || [];
  const me = rows.find((p) => p.id === state.user.id);
  state.me = me || state.me;
  state.other = rows.find((p) => p.id !== state.user.id) || null;
}

async function loadCategories() {
  const { data, error } = await state.sb
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    toast("分类加载失败：" + error.message);
    return;
  }
  state.categories = data || [];
}

function isMyLedger() {
  return state.viewOwnerId === state.user.id;
}

function ledgerName() {
  if (isMyLedger()) return "我的账本";
  return `${state.other?.display_name || "朋友"}的账本`;
}

/* ------------------------- 数据加载 ------------------------- */
async function loadAll() {
  if (!state.user || !state.viewOwnerId) return;
  const { year, month } = state;
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const curRange = monthRange(year, month);
  const prevRange = monthRange(prev.y, prev.m);
  const today = todayRange();

  const queryBills = (range) =>
    state.sb
      .from("bills")
      .select("*")
      .eq("owner_id", state.viewOwnerId)
      .gte("consume_time", range.start)
      .lt("consume_time", range.end)
      .order("consume_time", { ascending: false });

  const [curRes, prevRes, todayRes, assetRes] = await Promise.all([
    queryBills(curRange),
    queryBills(prevRange),
    state.sb
      .from("bills")
      .select("amount")
      .eq("owner_id", state.viewOwnerId)
      .gte("consume_time", today.start)
      .lt("consume_time", today.end),
    state.sb
      .from("assets")
      .select("*")
      .eq("owner_id", state.viewOwnerId)
      .order("created_at", { ascending: false }),
  ]);

  const firstError = [curRes, prevRes, todayRes, assetRes].find((r) => r.error)?.error;
  if (firstError) {
    toast("加载失败：" + firstError.message);
    return;
  }

  state.bills = curRes.data || [];
  state.prevBills = prevRes.data || [];
  state.assets = assetRes.data || [];
  const todayRows = todayRes.data || [];
  state.today = { amount: sum(todayRows), count: todayRows.length };
  state.annualCache = null;

  renderAll();
}

function renderAll() {
  renderHeader();
  renderTimeline();
  renderAssets();
  renderProfile();
  if (state.page === "stats") {
    renderStats();
    loadAnnual();
  }
}

/* ------------------------- 顶部 / 账本切换 ------------------------- */
function renderHeader() {
  const mine = isMyLedger();
  $("ledgerTitle").textContent = ledgerName();
  $("readOnlyBadge").classList.toggle("hidden", mine);
  $("fab").classList.toggle("hidden", !mine || state.page !== "bill");
  $("addAssetBtn").classList.toggle("hidden", !mine);
  $("todayAmount").textContent = fmtAmount(state.today.amount);
  $("todayCount").textContent = state.today.count;
  $("monthPicker").value = `${state.year}-${pad2(state.month)}`;
  $("billOwner").value = state.me.display_name || "";
}

function renderMonthPicker() {
  $("monthPicker").value = `${state.year}-${pad2(state.month)}`;
}

function renderYearPicker() {
  const sel = $("yearPicker");
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 5; y--) years.push(y);
  sel.innerHTML = years.map((y) => `<option value="${y}">${y} 年</option>`).join("");
  sel.value = String(state.annualYear);
}

function openLedgerModal() {
  const options = [
    {
      id: state.me.id,
      title: "我的账本",
      sub: `${state.me.display_name || state.me.email} · 可编辑`,
      readOnly: false,
    },
  ];
  if (state.other) {
    options.push({
      id: state.other.id,
      title: `${state.other.display_name || "朋友"}的账本`,
      sub: "只读 · 可以查看，不能修改",
      readOnly: true,
    });
  }
  $("ledgerList").innerHTML = options
    .map(
      (o) => `
      <button type="button" class="ledger-option ${o.id === state.viewOwnerId ? "active" : ""}"
        data-ledger="${o.id}">
        <span>${esc(o.title)}<small>${esc(o.sub)}</small></span>
        <span>${o.id === state.viewOwnerId ? "✓" : "›"}</span>
      </button>`
    )
    .join("");
  showModal("ledgerModal");
}

async function switchLedger(ownerId) {
  if (ownerId === state.viewOwnerId) {
    closeModal("ledgerModal");
    return;
  }
  state.viewOwnerId = ownerId;
  closeModal("ledgerModal");
  await loadAll();
  toast(isMyLedger() ? "已切换到我的账本" : `正在查看${ledgerName()}（只读）`);
}

/* ------------------------- 账单时间轴 ------------------------- */
function renderTimeline() {
  const timeline = $("timeline");
  const empty = $("emptyBills");
  if (!state.bills.length) {
    timeline.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const groups = new Map();
  state.bills.forEach((b) => {
    const key = dateKey(b.consume_time);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  const mine = isMyLedger();
  let html = "";
  for (const [key, list] of groups) {
    const first = list[0];
    const day = String(Number(key.slice(8, 10)));
    const week = weekdayText(first.consume_time);
    html += `
      <div class="timeline-day">
        <div class="date-col">
          <div class="date-day">${day}</div>
          <div class="date-week">${week}</div>
        </div>
        <div class="rail"><div class="rail-dot"></div></div>
        <div class="day-bills">
          ${list.map((b) => billRow(b, mine)).join("")}
        </div>
      </div>`;
  }
  timeline.innerHTML = html;
  hydrateImages();
}

function billRow(bill, mine) {
  const cat = categoryOf(bill.category_id);
  const amount = fmtAmount(bill.amount);
  const thumb = bill.image_path
    ? `<div class="bill-thumb" data-img="${esc(bill.image_path)}">${esc(cat.icon || "📦")}</div>`
    : `<div class="bill-thumb" style="background:${hexToSoft(cat.color, 0.14)}">${esc(
        cat.icon || "📦"
      )}</div>`;
  const actions = mine
    ? `<div class="bill-actions">
         <button type="button" data-edit="${bill.id}">编辑</button>
         <button type="button" data-del="${bill.id}">删除</button>
       </div>`
    : "";
  return `
    <div class="bill-row">
      ${thumb}
      <div class="bill-ring"></div>
      <div class="bill-card" ${mine ? `data-edit-card="${bill.id}"` : ""}>
        <div class="bill-card-top">
          <span class="bill-category">${esc(cat.name)}</span>
          <span class="bill-time">${timeText(bill.consume_time)}</span>
        </div>
        <div class="bill-divider"></div>
        <div class="bill-amount"><span class="yen">¥</span>${amount}</div>
        <div class="bill-bottom">
          <span class="bill-remark">${esc(bill.remark || "")}</span>
          <span class="bill-tag" style="background:${hexToSoft(cat.color, 0.14)};color:${esc(
            cat.color
          )}">${esc(cat.name)}</span>
          ${actions}
        </div>
      </div>
    </div>`;
}

async function signedUrl(path) {
  if (!path) return null;
  if (!state.signedUrlCache.has(path)) {
    const promise = state.sb.storage
      .from("bill-images")
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => (error ? null : data?.signedUrl || null))
      .catch(() => null);
    state.signedUrlCache.set(path, promise);
  }
  return state.signedUrlCache.get(path);
}

async function hydrateImages() {
  document.querySelectorAll("[data-img]").forEach(async (el) => {
    const url = await signedUrl(el.getAttribute("data-img"));
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  });
}

/* ------------------------- 资产页 ------------------------- */
function renderAssets() {
  const mine = isMyLedger();
  const totalAsset = state.assets.filter((a) => Number(a.type) === 1).reduce((s, a) => s + Number(a.amount), 0);
  const totalLiability = state.assets.filter((a) => Number(a.type) === 2).reduce((s, a) => s + Number(a.amount), 0);
  $("assetTotal").textContent = fmtAmount(totalAsset);
  $("liabilityTotal").textContent = fmtAmount(totalLiability);
  $("netTotal").textContent = fmtAmount(totalAsset - totalLiability);
  $("addAssetBtn").classList.toggle("hidden", !mine);

  const list = $("assetList");
  const empty = $("emptyAssets");
  if (!state.assets.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = state.assets
    .map((a) => {
      const isAsset = Number(a.type) === 1;
      const del = mine ? `<button class="asset-del" data-asset-del="${a.id}">删除</button>` : "";
      return `
        <div class="asset-item">
          <div class="asset-icon">${isAsset ? "🏦" : "💳"}</div>
          <div class="asset-main">
            <div class="asset-name">${esc(a.name)}</div>
            <div class="asset-sub">${isAsset ? "资产" : "负债"}${a.remark ? " · " + esc(a.remark) : ""}</div>
          </div>
          <div class="asset-amount" style="color:${isAsset ? "#18a058" : "#e5484d"}">
            ${isAsset ? "" : "-"}¥${fmtAmount(a.amount)}
          </div>
          ${del}
        </div>`;
    })
    .join("");
}

/* ------------------------- 统计 / 月报 / 年总账 ------------------------- */
function renderStats() {
  const total = sum(state.bills);
  const count = state.bills.length;
  const prevTotal = sum(state.prevBills);
  const mine = isMyLedger();
  const who = mine ? "你" : state.other?.display_name || "朋友";

  let compareText = "上月没有记录，暂时无法比较";
  let compareClass = "";
  if (prevTotal > 0) {
    const diff = total - prevTotal;
    const percent = (diff / prevTotal) * 100;
    const up = diff >= 0;
    compareClass = up ? "report-up" : "report-down";
    compareText = `较上月${up ? "增加" : "减少"} ${money(Math.abs(diff))}（${
      up ? "+" : ""
    }${percent.toFixed(1)}%）`;
  }

  const catMap = categoryMap();
  const byCat = new Map();
  state.categories.forEach((c) => byCat.set(Number(c.id), { cur: 0, prev: 0, cat: c }));
  state.bills.forEach((b) => {
    const item = byCat.get(Number(b.category_id));
    if (item) item.cur += Number(b.amount);
  });
  state.prevBills.forEach((b) => {
    const item = byCat.get(Number(b.category_id));
    if (item) item.prev += Number(b.amount);
  });
  const rows = [...byCat.values()]
    .filter((r) => r.cur > 0 || r.prev > 0)
    .sort((a, b) => b.cur - a.cur);

  const top = rows
    .filter((r) => r.cur > 0)
    .slice(0, 2)
    .map((r) => `<b>${esc(r.cat.name)}</b> ${money(r.cur)}（${total ? ((r.cur / total) * 100).toFixed(1) : "0.0"}%）`)
    .join("、");

  $("reportCard").innerHTML = `
    <p>${state.year} 年 ${state.month} 月，${who}的账本共消费
      <span class="report-total">${money(total)}</span>，共 <b>${count}</b> 笔，
      <span class="${compareClass}">${compareText}</span>。</p>
    ${
      top
        ? `<p>支出最多的是 ${top}。</p>`
        : `<p>这个月还没有支出记录。</p>`
    }
  `;

  // 饼图（ECharts 按需加载，减少首屏体积）
  const pieData = rows
    .filter((r) => r.cur > 0)
    .map((r) => ({ name: r.cat.name, value: Number(r.cur.toFixed(2)), itemStyle: { color: r.cat.color } }));
  $("pieEmpty").classList.toggle("hidden", pieData.length > 0);
  state.pieData = pieData;
  renderPieChart();

  // 分类表格
  if (!rows.length) {
    $("categoryTable").innerHTML = `<div class="empty"><div class="empty-title">本月还没有分类数据</div></div>`;
  } else {
    const html = rows
      .map((r) => {
        const percent = total ? (r.cur / total) * 100 : 0;
        let mom = "—";
        if (r.prev > 0) {
          const d = ((r.cur - r.prev) / r.prev) * 100;
          mom = `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
        } else if (r.cur > 0) {
          mom = "新增";
        }
        return `<tr>
          <td><span class="cat-dot" style="background:${esc(r.cat.color)}"></span>${esc(r.cat.name)}</td>
          <td>${money(r.cur)}</td>
          <td>${percent.toFixed(1)}%</td>
          <td>${money(r.prev)}</td>
          <td>${mom}</td>
        </tr>`;
      })
      .join("");
    $("categoryTable").innerHTML = `
      <div class="table-wrap">
        <table class="report-table">
          <thead><tr><th>分类</th><th>本月</th><th>占比</th><th>上月</th><th>环比</th></tr></thead>
          <tbody>${html}</tbody>
        </table>
      </div>`;
  }

  loadAnnual();
}

/* ------------------------- 饼图（按需加载 ECharts） ------------------------- */
let echartsLoading = null;

function ensureEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!echartsLoading) {
    echartsLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/echarts.min.js";
      script.onload = () => resolve(window.echarts);
      script.onerror = () => reject(new Error("图表库加载失败"));
      document.body.appendChild(script);
    });
  }
  return echartsLoading;
}

function drawPie(pieData) {
  if (!state.chart) return;
  if (!pieData || !pieData.length) {
    state.chart.clear();
    return;
  }
  state.chart.setOption(
    {
      tooltip: {
        trigger: "item",
        formatter: (p) => `${p.name}<br/>¥${fmtAmount(p.value)}（${p.percent}%）`,
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          center: ["50%", "52%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { formatter: "{b}\n{d}%", fontSize: 10, color: "#666" },
          data: pieData,
        },
      ],
    },
    true
  );
}

function renderPieChart() {
  const pieData = state.pieData || [];
  if (state.chart) {
    drawPie(pieData);
    return;
  }
  ensureEcharts()
    .then(() => {
      if (!state.chart) {
        state.chart = echarts.init($("pieChart"));
        window.addEventListener("resize", () => state.chart && state.chart.resize());
      }
      drawPie(state.pieData || []);
    })
    .catch(() => {
      /* 图表加载失败不影响报表文字和表格 */
    });
}

async function loadAnnual() {  if (!state.user) return;
  const year = state.annualYear || state.year;
  const key = `${state.viewOwnerId}-${year}`;
  if (state.annualCache && state.annualCache.key === key) {
    renderAnnual(state.annualCache.months);
    return;
  }
  const { start } = monthRange(year, 1);
  const { end } = monthRange(year, 12);
  const { data, error } = await state.sb
    .from("bills")
    .select("amount, consume_time")
    .eq("owner_id", state.viewOwnerId)
    .gte("consume_time", start)
    .lt("consume_time", end);
  if (error) {
    console.warn("年总账加载失败：", error.message);
    return;
  }
  const months = Array.from({ length: 12 }, () => ({ amount: 0, count: 0 }));
  (data || []).forEach((b) => {
    const m = Number(dateKey(b.consume_time).slice(5, 7));
    if (m >= 1 && m <= 12) {
      months[m - 1].amount += Number(b.amount);
      months[m - 1].count += 1;
    }
  });
  state.annualCache = { key, months };
  renderAnnual(months);
}

function renderAnnual(months) {
  const total = months.reduce((s, m) => s + m.amount, 0);
  const count = months.reduce((s, m) => s + m.count, 0);
  const rows = months
    .map(
      (m, i) => `<tr>
        <td>${i + 1} 月</td>
        <td>${m.count ? money(m.amount) : "—"}</td>
        <td>${m.count || "—"}</td>
      </tr>`
    )
    .join("");
  $("annualTable").innerHTML = `
    <div class="table-wrap">
      <table class="report-table">
        <thead><tr><th>月份</th><th>消费总额</th><th>笔数</th></tr></thead>
        <tbody>
          ${rows}
          <tr><td><b>全年</b></td><td><b>${money(total)}</b></td><td><b>${count}</b></td></tr>
        </tbody>
      </table>
    </div>`;
}

/* ------------------------- 我的页 ------------------------- */
function renderProfile() {
  const name = state.me.display_name || state.me.email || "我";
  $("profileAvatar").textContent = String(name).slice(0, 1);
  $("profileName").textContent = `${name} · ${isMyLedger() ? "我的账本" : "只读查看"}`;
  $("profileEmail").textContent = state.me.email || "";
}

function exportCsv() {
  if (!state.bills.length) {
    toast("本月没有可导出的账单");
    return;
  }
  const header = ["日期", "时间", "分类", "金额", "备注", "图片路径", "归属"];
  const lines = [header.join(",")];
  state.bills.forEach((b) => {
    const cat = categoryOf(b.category_id);
    const row = [
      dateKey(b.consume_time),
      timeText(b.consume_time),
      cat.name,
      Number(b.amount).toFixed(2),
      b.remark || "",
      b.image_path || "",
      isMyLedger() ? state.me.display_name : state.other?.display_name || "朋友",
    ];
    lines.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `咔皮记账_${state.year}${pad2(state.month)}_${ledgerName()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("CSV 已导出");
}

async function openImageList() {
  const withImg = state.bills.filter((b) => b.image_path);
  const grid = $("imageGrid");
  const empty = $("imageEmpty");
  if (!withImg.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    showModal("imageModal");
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = withImg
    .map((b) => `<a data-signed="${esc(b.image_path)}" target="_blank" rel="noopener">
      <div style="width:100%;height:100%;background:#f3f3f5"></div>
    </a>`)
    .join("");
  showModal("imageModal");
  grid.querySelectorAll("[data-signed]").forEach(async (a) => {
    const url = await signedUrl(a.getAttribute("data-signed"));
    if (url) {
      a.href = url;
      a.innerHTML = `<img src="${url}" alt="">`;
    }
  });
}

/* ------------------------- 账单弹窗 ------------------------- */
function renderCategoryGrid() {
  $("categoryGrid").innerHTML = state.categories
    .map(
      (c) => `<button type="button" class="category-chip ${
        Number(c.id) === Number(state.selectedCategoryId) ? "selected" : ""
      }" data-cat="${c.id}">
        <span class="cat-icon">${esc(c.icon || "📦")}</span>${esc(c.name)}
      </button>`
    )
    .join("");
}

async function openBillModal(bill = null) {
  if (!isMyLedger()) {
    toast("当前是朋友的账本，只能查看不能修改");
    return;
  }
  state.editingBill = bill;
  state.selectedCategoryId = bill ? Number(bill.category_id) : Number(state.categories[0]?.id || 0);
  state.existingImagePath = bill?.image_path || null;
  state.removeExistingImage = false;
  state.pendingImageFile = null;
  $("billId").value = bill ? bill.id : "";
  $("billModalTitle").textContent = bill ? "编辑账单" : "记一笔";
  $("billAmount").value = bill ? Number(bill.amount) : "";
  $("billTime").value = toLocalInput(bill?.consume_time || new Date());
  $("billRemark").value = bill?.remark || "";
  $("billImage").value = "";
  renderCategoryGrid();

  const wrap = $("imagePreviewWrap");
  if (bill?.image_path) {
    const url = await signedUrl(bill.image_path);
    if (url) {
      $("imagePreview").src = url;
      wrap.classList.remove("hidden");
    } else {
      wrap.classList.add("hidden");
    }
  } else {
    wrap.classList.add("hidden");
  }
  showModal("billModal");
  setTimeout(() => $("billAmount").focus(), 250);
}

function resetImagePreview() {
  $("imagePreview").src = "";
  $("imagePreviewWrap").classList.add("hidden");
  $("billImage").value = "";
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) resolve(blob);
          else reject(new Error("图片压缩失败"));
        },
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片读取失败，请换一张试试"));
    };
    img.src = objectUrl;
  });
}

async function uploadBillImage(file) {
  const blob = await compressImage(file);
  const path = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await state.sb.storage
    .from("bill-images")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

async function saveBill(event) {
  event.preventDefault();
  if (!isMyLedger()) return;
  const amount = Number($("billAmount").value);
  if (!amount || amount <= 0) {
    toast("请输入大于 0 的金额");
    $("billAmount").focus();
    return;
  }
  if (!state.selectedCategoryId) {
    toast("请选择消费分类");
    return;
  }
  const timeValue = $("billTime").value;
  if (!timeValue) {
    toast("请选择消费时间");
    return;
  }

  const btn = $("billForm").querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "保存中...";
  let uploadedPath = null;

  try {
    let imagePath = state.removeExistingImage ? null : state.existingImagePath;
    if (state.pendingImageFile) {
      uploadedPath = await uploadBillImage(state.pendingImageFile);
      imagePath = uploadedPath;
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      category_id: Number(state.selectedCategoryId),
      consume_time: new Date(timeValue).toISOString(),
      image_path: imagePath,
      remark: $("billRemark").value.trim() || null,
      owner_id: state.user.id,
    };

    let error;
    if (state.editingBill) {
      ({ error } = await state.sb
        .from("bills")
        .update(payload)
        .eq("id", state.editingBill.id)
        .eq("owner_id", state.user.id));
    } else {
      ({ error } = await state.sb.from("bills").insert(payload));
    }
    if (error) throw error;

    // 替换/删除旧图片
    if (
      state.existingImagePath &&
      state.existingImagePath !== imagePath &&
      (uploadedPath || state.removeExistingImage)
    ) {
      await state.sb.storage.from("bill-images").remove([state.existingImagePath]);
    }

    state.signedUrlCache.clear();
    closeModal("billModal");
    toast(state.editingBill ? "账单已更新" : "记好了");
    await loadAll();
  } catch (err) {
    toast("保存失败：" + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
}

async function deleteBill(id) {
  if (!isMyLedger()) return;
  if (!confirm("确定删除这条账单吗？删除后不可恢复。")) return;
  const bill = state.bills.find((b) => Number(b.id) === Number(id));
  const { error } = await state.sb
    .from("bills")
    .delete()
    .eq("id", id)
    .eq("owner_id", state.user.id);
  if (error) {
    toast("删除失败：" + error.message);
    return;
  }
  if (bill?.image_path) {
    await state.sb.storage.from("bill-images").remove([bill.image_path]);
  }
  toast("已删除");
  await loadAll();
}

/* ------------------------- 分类 / 资产弹窗 ------------------------- */
async function saveCategory(event) {
  event.preventDefault();
  const name = $("categoryName").value.trim();
  if (!name) {
    toast("请输入分类名称");
    return;
  }
  const icon = $("categoryIcon").value.trim() || "📦";
  const color = $("categoryColor").value || "#A4B0BE";
  const { data, error } = await state.sb
    .from("categories")
    .insert({ name, icon, color, owner_id: state.user.id, sort_order: 99 })
    .select()
    .single();
  if (error) {
    toast("新增分类失败：" + error.message);
    return;
  }
  await loadCategories();
  state.selectedCategoryId = Number(data.id);
  closeModal("categoryModal");
  renderCategoryGrid();
  toast("分类已添加");
}

function openAssetModal(asset = null) {
  if (!isMyLedger()) {
    toast("当前是朋友的账本，只能查看不能修改");
    return;
  }
  $("assetId").value = asset ? asset.id : "";
  $("assetModalTitle").textContent = asset ? "编辑资产 / 负债" : "记资产 / 负债";
  $("assetName").value = asset?.name || "";
  $("assetAmount").value = asset ? Number(asset.amount) : "";
  $("assetRemark").value = asset?.remark || "";
  state.assetType = asset ? Number(asset.type) : 1;
  updateAssetTypeButtons();
  showModal("assetModal");
}

function updateAssetTypeButtons() {
  document.querySelectorAll("#assetForm .segment").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.type) === state.assetType);
  });
}

async function saveAsset(event) {
  event.preventDefault();
  const name = $("assetName").value.trim();
  const amount = Number($("assetAmount").value);
  if (!name) {
    toast("请输入名称");
    return;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    toast("请输入正确的金额");
    return;
  }
  const id = $("assetId").value;
  const payload = {
    type: state.assetType,
    name,
    amount: Number(amount.toFixed(2)),
    remark: $("assetRemark").value.trim() || null,
    owner_id: state.user.id,
  };
  let error;
  if (id) {
    ({ error } = await state.sb
      .from("assets")
      .update(payload)
      .eq("id", id)
      .eq("owner_id", state.user.id));
  } else {
    ({ error } = await state.sb.from("assets").insert(payload));
  }
  if (error) {
    toast("保存失败：" + error.message);
    return;
  }
  closeModal("assetModal");
  toast("已保存");
  await loadAll();
}

async function deleteAsset(id) {
  if (!isMyLedger()) return;
  if (!confirm("确定删除这条记录吗？")) return;
  const { error } = await state.sb
    .from("assets")
    .delete()
    .eq("id", id)
    .eq("owner_id", state.user.id);
  if (error) {
    toast("删除失败：" + error.message);
    return;
  }
  toast("已删除");
  await loadAll();
}

/* ------------------------- 页面切换 / 弹窗 ------------------------- */
function switchPage(page) {
  state.page = page;
  document.querySelectorAll(".tab-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  ["bill", "asset", "stats", "profile"].forEach((p) => {
    $("page-" + p).classList.toggle("hidden", p !== page);
  });
  // 悬浮加号只在“账单页 + 自己的账本”显示，避免挡住表格
  $("fab").classList.toggle("hidden", page !== "bill" || !isMyLedger());
  if (page === "asset") renderAssets();
  if (page === "stats") {
    renderStats();
    loadAnnual();
  }
  if (page === "profile") renderProfile();
}

function showModal(id) {
  $(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(id).classList.add("hidden");
  if (!document.querySelector(".modal:not(.hidden)")) document.body.style.overflow = "";
}

/* ------------------------- 事件绑定 ------------------------- */
function bindEvents() {
  // 登录
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("loginError");
    errEl.classList.add("hidden");
    if (!state.sb) {
      errEl.textContent = "请先在 js/config.js 填写 Supabase URL 和 anon key";
      errEl.classList.remove("hidden");
      return;
    }
    const pin = $("password").value.trim();
    if (!pin) {
      errEl.textContent = "请输入密码";
      errEl.classList.remove("hidden");
      return;
    }
    const btn = $("loginForm").querySelector("button[type='submit']");
    btn.disabled = true;
    btn.textContent = "验证中...";

    // 两个固定账号：用户只输入密码，依次尝试两个账号
    const accounts = [
      { email: "me@example.com", password: pin },
      { email: "friend@example.com", password: pin },
    ];
    let user = null;
    let lastError = null;
    for (const account of accounts) {
      const { data, error } = await state.sb.auth.signInWithPassword(account);
      if (!error && data && data.user) {
        user = data.user;
        break;
      }
      lastError = error;
    }
    btn.disabled = false;
    btn.textContent = "登录";

    if (!user) {
      const msg = (lastError && lastError.message) || "";
      errEl.textContent = msg.includes("Failed to fetch")
        ? "连不上 Supabase：检查网络和 config.js 里的 URL"
        : "密码不正确";
      errEl.classList.remove("hidden");
      return;
    }
    await enterApp(user);
  });

  // Tab
  document.querySelectorAll(".tab-item").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.dataset.page));
  });

  // 顶部账本
  $("ledgerBtn").addEventListener("click", openLedgerModal);
  $("ledgerList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ledger]");
    if (btn) switchLedger(btn.dataset.ledger);
  });

  // 月份 / 年份
  $("monthPicker").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    const [y, m] = e.target.value.split("-").map(Number);
    state.year = y;
    state.month = m;
    state.annualYear = y;
    $("yearPicker").value = String(y);
    await loadAll();
    if (state.page === "stats") {
      renderStats();
      loadAnnual();
    }
  });
  $("yearPicker").addEventListener("change", () => {
    state.annualYear = Number($("yearPicker").value);
    loadAnnual();
  });

  // 新增账单
  $("fab").addEventListener("click", () => openBillModal());
  $("billForm").addEventListener("submit", saveBill);
  $("categoryGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    state.selectedCategoryId = Number(btn.dataset.cat);
    renderCategoryGrid();
  });

  // 图片
  $("pickImageBtn").addEventListener("click", () => $("billImage").click());
  $("billImage").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.pendingImageFile = file;
    state.removeExistingImage = false;
    $("imagePreview").src = URL.createObjectURL(file);
    $("imagePreviewWrap").classList.remove("hidden");
  });
  $("removeImageBtn").addEventListener("click", () => {
    state.pendingImageFile = null;
    state.removeExistingImage = true;
    resetImagePreview();
  });

  // 分类弹窗
  $("openCategoryBtn").addEventListener("click", () => {
    $("categoryName").value = "";
    $("categoryIcon").value = "🐱";
    $("categoryColor").value = "#FF9F43";
    showModal("categoryModal");
  });
  $("categoryForm").addEventListener("submit", saveCategory);

  // 资产
  $("addAssetBtn").addEventListener("click", () => openAssetModal());
  $("assetForm").addEventListener("submit", saveAsset);
  document.querySelectorAll("#assetForm .segment").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.assetType = Number(btn.dataset.type);
      updateAssetTypeButtons();
    });
  });

  // 时间轴 / 资产事件委托
  $("timeline").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    const card = e.target.closest("[data-edit-card]");
    if (editBtn || card) {
      const id = editBtn ? editBtn.dataset.edit : card.dataset.editCard;
      const bill = state.bills.find((b) => Number(b.id) === Number(id));
      if (bill) openBillModal(bill);
      return;
    }
    if (delBtn) deleteBill(delBtn.dataset.del);
  });
  $("assetList").addEventListener("click", (e) => {
    const del = e.target.closest("[data-asset-del]");
    if (del) deleteAsset(del.dataset.assetDel);
  });

  // 我的页
  $("switchLedgerBtn").addEventListener("click", openLedgerModal);
  $("exportBtn").addEventListener("click", exportCsv);
  $("imageListBtn").addEventListener("click", openImageList);
  $("refreshBtn").addEventListener("click", async () => {
    await loadAll();
    toast("已刷新");
  });
  $("logoutBtn").addEventListener("click", async () => {
    await state.sb.auth.signOut();
  });

  // 弹窗关闭
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => closeModal(el.getAttribute("data-close")));
  });
}

/* ------------------------- 启动 ------------------------- */
bindEvents();
// 页面脚本加载完成后再允许提交登录，避免用户提前点击导致表单原样刷新
const loginSubmitBtn = $("loginForm").querySelector("button[type='submit']");
if (loginSubmitBtn) loginSubmitBtn.disabled = false;
boot().catch((e) => {
  console.error(e);
  showLogin();
  $("loginError").textContent = "初始化失败：" + (e.message || e);
  $("loginError").classList.remove("hidden");
});
