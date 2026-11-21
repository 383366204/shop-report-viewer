"use strict";
const $ = (id) => document.getElementById(id);
let db = null;
const MISSING = "—";
let positions = {};
const defaults = {
  shop: "7",
  window: "14",
  products: "1",
  mix: "products",
  sort: "visitors",
  desc: true,
  page: 1,
  search: "",
  item: null,
};
const state = { ...defaults };
const fieldNames = {
  visitors: "访客数",
  views: "浏览量",
  favorite_users: "商品收藏人数",
  cart_users: "加购人数",
  cart_items: "加购件数",
  pay_buyers: "支付买家数",
  pay_items: "支付件数",
  pay_amount: "支付金额",
  conversion: "支付转化率",
  stay_seconds: "平均停留时长",
  bounce_rate: "详情页跳出率",
};
const defaultCols = [
  "visitors",
  "cart_users",
  "pay_buyers",
  "pay_amount",
  "conversion",
];
const columnOrder = [
  "visitors",
  "views",
  "favorite_users",
  "cart_users",
  "cart_items",
  "pay_buyers",
  "pay_items",
  "pay_amount",
  "conversion",
  "stay_seconds",
  "bounce_rate",
];
const columns = new Set(defaultCols);
const money = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const palette = ["#f57b37", "#3675cf", "#4d9d85", "#8972bc", "#dbac4a"];
const kpiList = [
  ["pay_amount", "支付金额", "money"],
  ["pay_orders", "支付子订单数", "count"],
  ["avg_order_value", "客单价", "money"],
  ["refund_amount", "退款金额（完结时间）", "money"],
  ["amount_refund_rate", "金额退款率", "percent"],
  ["conversion", "全店支付转化率", "percent"],
];
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function numeric(v) {
  return v === null || v === undefined || v === "" ? null : Number(v);
}
function format(value, kind) {
  const n = numeric(value);
  if (n === null || !Number.isFinite(n)) return MISSING;
  if (kind === "money") return "¥" + money.format(n);
  if (kind === "percent") return (n * 100).toFixed(2) + "%";
  return num.format(n);
}
function displayMetric(k, v) {
  return format(
    v,
    k === "pay_amount"
      ? "money"
      : k === "conversion" || k === "bounce_rate"
        ? "percent"
        : "count",
  );
}
function dateLabel(s) {
  return s.slice(5).replace("-", "/");
}
function datesText(start, end) {
  return start === end ? end : start + " 至 " + end;
}
function dateSteps(end, n) {
  const endMs = Date.parse(end + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) =>
    new Date(endMs - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
  );
}
function group(id, initial, onChange) {
  const node = $(id);
  function mark(val) {
    for (const b of node.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b.dataset.value === val));
  }
  mark(initial);
  node.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b || b.getAttribute("aria-pressed") === "true") return;
    mark(b.dataset.value);
    onChange(b.dataset.value);
  });
}
function stats() {
  const period = db.shop[state.shop];
  $("shop-download").disabled = !db.files?.[state.shop];
  $("shop-dates").textContent = datesText(period.start, period.end);
  const nodes = kpiList.map(([key, label, kind]) => {
    const card = el("article", "kpi"),
      v = numeric(period.values[key]),
      b = numeric(period.previous[key]);
    card.dataset.metric = key;
    card.append(el("div", "k", label), el("div", "num", format(v, kind)));
    const sub = el("div", "sub");
    if (v === null) sub.textContent = "本期来源未提供";
    else if (b === null) sub.textContent = "对照期未提供";
    else {
      const difference = v - b,
        prefix = difference > 0 ? "+" : difference < 0 ? "−" : "";
      const absolute =
        kind === "percent"
          ? (Math.abs(difference) * 100).toFixed(2) + " 个百分点"
          : format(Math.abs(difference), kind);
      sub.append(
        el(
          "span",
          difference > 0 ? "plus" : difference < 0 ? "minus" : "zero",
          difference === 0 ? "持平" : prefix + absolute,
        ),
      );
    }
    card.append(sub);
    return card;
  });
  $("kpis").replaceChildren(...nodes);
  const info = $("shop-context");
  const visitor = el("span", null, "访客数 "),
    buyer = el("span", null, "支付买家 ");
  visitor.append(
    el("b", null, format(period.values.visitors, "count") + " 人"),
  );
  buyer.append(
    el("b", null, format(period.values.pay_buyers, "count") + " 人"),
  );
  const comparison =
    period.baseStart && period.baseEnd
      ? "卡片变化对比 " + datesText(period.baseStart, period.baseEnd)
      : "暂无同口径对照期";
  info.replaceChildren(visitor, buyer, el("span", "note", comparison));
}
function svgNode(tag, attrs, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, val] of Object.entries(attrs))
    n.setAttribute(key, String(val));
  if (text !== undefined) n.textContent = text;
  return n;
}
function axisMax(values) {
  const maximum = Math.max(0, ...values.filter((x) => x !== null));
  if (!maximum) return 4;
  const rough = maximum / 4,
    magnitude = 10 ** Math.floor(Math.log10(rough));
  return (
    4 *
    magnitude *
    ([1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
      (t) => t >= rough / magnitude,
    ) || 10)
  );
}
function hideTip() {
  $("tooltip").hidden = true;
}
function showTip(text, x, y) {
  const tip = $("tooltip");
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left =
    Math.max(5, Math.min(window.innerWidth - tip.offsetWidth - 6, x + 12)) +
    "px";
  tip.style.top =
    Math.max(
      5,
      Math.min(
        window.innerHeight - tip.offsetHeight - 6,
        y - tip.offsetHeight - 8,
      ),
    ) + "px";
}
function plot(container, observations, kind) {
  const width = Math.floor(container.clientWidth);
  if (!width || !observations.length) return;
  const dual = kind === "dual",
    bar = kind === "bar",
    height = dual ? 207 : 198;
  const left = width < 450 ? 42 : 52,
    right = dual ? (width < 450 ? 44 : 55) : 18,
    top = 25,
    bottom = 35;
  const avail = width - left - right,
    base = height - bottom,
    hh = base - top;
  const first = observations.map((o) => o.a),
    second = observations.map((o) => o.b);
  const maxA = axisMax(first),
    maxB = dual ? axisMax(second) : 0;
  const desc = bar
    ? "逐日支付金额，单位元"
    : dual
      ? "逐日店铺访客和支付转化率"
      : "逐日商品访客，空缺表示当日报表未收录";
  const svg = svgNode("svg", {
    height,
    viewBox: "0 0 " + width + " " + height,
    role: "img",
    "aria-label": desc,
  });
  svg.append(svgNode("title", {}, desc));
  const step = avail / observations.length,
    x = (i) => left + step * (i + 0.5),
    y = (v, max) => base - (hh * v) / max;
  const label = (xx, yy, tx, align = "middle") =>
    svgNode(
      "text",
      { x: xx, y: yy, class: "axis-label", "text-anchor": align },
      tx,
    );
  svg.append(label(left, 14, bar ? "元" : "人", "start"));
  if (dual) svg.append(label(width - 4, 14, "%", "end"));
  for (let i = 0; i <= 4; i++) {
    const yy = base - (hh * i) / 4;
    svg.append(
      svgNode("line", {
        x1: left,
        y1: yy,
        x2: width - right,
        y2: yy,
        class: "grid-line",
      }),
      label(left - 6, yy + 4, num.format((maxA * i) / 4), "end"),
    );
    if (dual)
      svg.append(
        label(
          width - right + 7,
          yy + 4,
          num.format((maxB * i) / 4) + "%",
          "start",
        ),
      );
  }
  const slots = Math.max(2, Math.floor(avail / 55));
  const labels = new Set(
    Array.from({ length: Math.min(slots, observations.length) }, (_, i) =>
      Math.round(
        (i * (observations.length - 1)) /
          (Math.min(slots, observations.length) - 1),
      ),
    ),
  );
  observations.forEach((o, i) => {
    if (labels.has(i)) svg.append(label(x(i), height - 10, dateLabel(o.day)));
  });
  function line(series, max, color, dashed) {
    let path = "",
      connected = false;
    series.forEach((v, i) => {
      if (v === null) {
        connected = false;
        return;
      }
      path += (connected ? " L " : " M ") + x(i) + " " + y(v, max);
      connected = true;
    });
    if (path)
      svg.append(
        svgNode("path", {
          d: path,
          stroke: color,
          "stroke-width": 2.35,
          "stroke-dasharray": dashed ? "5 4" : "none",
          fill: "none",
          "stroke-linejoin": "round",
        }),
      );
    series.forEach((v, i) => {
      if (v !== null)
        svg.append(
          svgNode("circle", {
            cx: x(i),
            cy: y(v, max),
            r: observations.length > 15 ? 2.2 : 3.3,
            fill: color,
            stroke: "#fff",
            "stroke-width": 0.8,
          }),
        );
    });
  }
  if (bar) {
    const bw = Math.max(2, Math.min(30, step * 0.59));
    first.forEach((v, i) => {
      if (v !== null && v > 0)
        svg.append(
          svgNode("rect", {
            x: x(i) - bw / 2,
            y: y(v, maxA),
            width: bw,
            height: base - y(v, maxA),
            rx: 2.4,
            fill: "#f5803a",
          }),
        );
    });
  } else {
    line(first, maxA, "#2667c4", false);
    if (dual) line(second, maxB, "#15846b", true);
  }
  observations.forEach((o, i) => {
    const t =
      o.day +
      "\n" +
      (bar
        ? "支付金额 " + format(o.a, "money")
        : "访客数 " +
          (o.a === null ? "当日报表未收录" : format(o.a, "count") + " 人")) +
      (dual
        ? "\n支付转化率 " + (o.b === null ? MISSING : o.b.toFixed(2) + "%")
        : "");
    const box = svgNode("rect", {
      x: left + step * i,
      y: top,
      width: step,
      height: hh + 7,
      class: "chart-hit",
      tabindex: 0,
      "aria-label": t.replaceAll("\n", "，"),
    });
    box.addEventListener("pointermove", (e) =>
      showTip(t, e.clientX, e.clientY),
    );
    box.addEventListener("pointerleave", hideTip);
    box.addEventListener("focus", () => {
      const b = box.getBoundingClientRect();
      showTip(t, b.x + b.width / 2, b.y + b.height / 2);
    });
    box.addEventListener("blur", hideTip);
    box.addEventListener("click", (e) => showTip(t, e.clientX, e.clientY));
    svg.append(box);
  });
  container.replaceChildren(svg);
}
function shopCharts() {
  if (!db || !Object.keys(db.days).length) return;
  const days = dateSteps(db.end, Number(state.window));
  $("chart-dates").textContent =
    dateLabel(days[0]) + "–" + dateLabel(days.at(-1));
  const amounts = days.map((day) => ({
    day,
    a: numeric(db.days[day]?.pay_amount),
  }));
  const traffic = days.map((day) => {
    const v = numeric(db.days[day]?.conversion);
    return {
      day,
      a: numeric(db.days[day]?.visitors),
      b: v === null ? null : v * 100,
    };
  });
  plot($("pay-plot"), amounts, "bar");
  plot($("traffic-plot"), traffic, "dual");
}
function field(row, code) {
  return row[2 + positions[code]];
}
function report() {
  return db.products[state.products];
}
function ring() {
  if (!state.products) return;
  const target = $("ring"),
    current = report();
  $("mix-title").textContent =
    state.mix === "platforms" ? "销售平台支付占比" : "商品支付构成";
  $("mix-dates").textContent =
    state.mix === "platforms"
      ? ""
      : current.start === current.end
        ? dateLabel(current.end)
        : dateLabel(current.start) + "–" + dateLabel(current.end);
  if (state.mix === "platforms") {
    target.replaceChildren(
      el(
        "p",
        "empty",
        "当前归档没有按销售平台和类目拆分的销售报表，暂无可核算的平台占比。",
      ),
    );
    $("ring-source").textContent = "数据范围 · " + db.name;
    return;
  }
  const slices = current.rows
    .map((r) => ({
      name: r[1].slice(0, 12),
      full: r[1],
      id: r[0],
      cents: Math.round((numeric(field(r, "pay_amount")) ?? 0) * 100),
    }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
  const total = slices.reduce((s, r) => s + r.cents, 0);
  $("ring-source").textContent =
    "商品报表 " +
    datesText(current.start, current.end) +
    " · 按已收录商品的支付金额计算";
  if (!total) {
    target.replaceChildren(el("p", "empty", "该商品报表没有正数支付金额。"));
    return;
  }
  const items = slices.slice(0, 4);
  if (slices.length > 4)
    items.push({
      name: "其余 " + (slices.length - 4) + " 件",
      full: "其余有支付金额的商品",
      cents: slices.slice(4).reduce((s, r) => s + r.cents, 0),
    });
  const donut = el("div", "donut"),
    hole = el("div", "hole"),
    list = el("ul", "ringlist");
  donut.setAttribute("role", "img");
  donut.setAttribute(
    "aria-label",
    "已收录商品支付金额合计 " + money.format(total / 100) + " 元",
  );
  hole.append(
    el("span", null, "已收录合计"),
    el("b", null, format(total / 100, "money")),
  );
  donut.append(hole);
  let sum = 0;
  const stops = items.map((r, i) => {
    const start = (sum / total) * 100;
    sum += r.cents;
    const li = el("li"),
      dot = el("span", "dot"),
      name = el("span", "name", r.name),
      pct = el("span", "share", ((r.cents / total) * 100).toFixed(1) + "%");
    dot.style.background = palette[i];
    li.title = r.full + " · " + format(r.cents / 100, "money");
    li.append(dot, name, pct);
    list.append(li);
    return palette[i] + " " + start + "% " + (sum / total) * 100 + "%";
  });
  donut.style.background = "conic-gradient(" + stops.join(",") + ")";
  target.replaceChildren(donut, list);
}
function ranked() {
  const query = state.search.trim().toLowerCase();
  return report()
    .rows.filter(
      (r) =>
        !query || r[0].includes(query) || r[1].toLowerCase().includes(query),
    )
    .sort((a, b) => {
      const av = numeric(field(a, state.sort)),
        bv = numeric(field(b, state.sort));
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av !== bv) return state.desc ? bv - av : av - bv;
      return a[0].localeCompare(b[0], "en");
    });
}
function toggleColumn(code) {
  if (columns.has(code)) columns.delete(code);
  else columns.add(code);
  if (!columns.has(state.sort)) {
    state.sort = "visitors";
    state.desc = true;
  }
  state.page = 1;
  productTable();
}
function configureColumns() {
  const controls = $("columns");
  controls.replaceChildren();
  for (const code of columnOrder) {
    const l = el("label"),
      c = el("input");
    c.type = "checkbox";
    c.checked = columns.has(code);
    c.disabled = code === "visitors";
    c.addEventListener("change", () => toggleColumn(code));
    l.append(c, document.createTextNode(fieldNames[code]));
    controls.append(l);
  }
}
function productTable() {
  if (!state.products) return;
  const selected = columnOrder.filter((c) => columns.has(c)),
    rows = ranked(),
    pages = Math.max(1, Math.ceil(rows.length / 10));
  state.page = Math.max(1, Math.min(pages, state.page));
  const head = $("product-head"),
    body = $("product-rows");
  head.replaceChildren(el("th", "rank", "#"), el("th", "name", "商品"));
  for (const k of selected) {
    const th = el("th"),
      active = k === state.sort;
    th.setAttribute(
      "aria-sort",
      active ? (state.desc ? "descending" : "ascending") : "none",
    );
    const button = el(
      "button",
      null,
      fieldNames[k] + (active ? (state.desc ? " ↓" : " ↑") : ""),
    );
    button.type = "button";
    button.addEventListener("click", () => {
      state.desc = state.sort === k ? !state.desc : true;
      state.sort = k;
      state.page = 1;
      productTable();
    });
    th.append(button);
    head.append(th);
  }
  head.append(el("th", null, "明细"));
  body.replaceChildren();
  const start = (state.page - 1) * 10;
  for (const [offset, row] of rows.slice(start, start + 10).entries()) {
    const tr = el("tr");
    tr.dataset.item = row[0];
    const title = el("td", "name"),
      open = el("button", null, row[1]);
    open.type = "button";
    open.title = row[1];
    open.addEventListener("click", () => drawer(row));
    title.append(open, el("small", null, row[0]));
    tr.append(el("td", "rank", String(start + offset + 1)), title);
    for (const k of selected) {
      const cell = el(
        "td",
        k === "pay_amount" ? "amount" : "",
        displayMetric(k, field(row, k)),
      );
      cell.dataset.field = k;
      tr.append(cell);
    }
    const cell = el("td"),
      more = el("button", "linkbtn", "七日趋势");
    more.type = "button";
    more.setAttribute("aria-label", row[1] + "，七日趋势");
    more.addEventListener("click", () => drawer(row));
    cell.append(more);
    tr.append(cell);
    body.append(tr);
  }
  if (!rows.length) {
    const tr = el("tr"),
      td = el("td", "name", "没有匹配商品");
    td.colSpan = selected.length + 3;
    tr.append(td);
    body.append(tr);
  }
  $("prod-period").textContent =
    datesText(report().start, report().end) +
    " · " +
    report().rows.length +
    " 件商品";
  $("count").textContent =
    "筛选 " +
    rows.length +
    " / " +
    report().rows.length +
    " 件 · 同值按商品 ID 升序";
  $("page").textContent = state.page + " / " + pages;
  $("next").disabled = state.page === pages;
  $("prev").disabled = state.page === 1;
}
function dailyDetails(row) {
  return dateSteps(report().end, 7).map((day) => ({
    day,
    values: db.productDays[day]?.[row[0]] || null,
  }));
}
function drawerChart() {
  if (!state.item || !$("drawer").open) return;
  const data = dailyDetails(state.item).map((p) => ({
    day: p.day,
    a: numeric(p.values?.[positions.visitors]),
  }));
  plot($("item-plot"), data, "item");
}
function drawer(row) {
  state.item = row;
  const daily = dailyDetails(row);
  $("drawer-title").textContent = row[1];
  $("drawer-id").textContent =
    "商品 " + row[0] + " · " + datesText(report().start, report().end);
  $("drawer-stats").replaceChildren(
    ...["visitors", "pay_buyers", "pay_amount"].map((code) => {
      const b = el("div");
      b.append(
        el("span", null, "所选期" + fieldNames[code]),
        el("b", null, displayMetric(code, field(row, code))),
      );
      return b;
    }),
  );
  $("drawer-rows").replaceChildren(
    ...daily.map((p) => {
      const tr = el("tr");
      tr.append(el("td", null, p.day));
      for (const k of ["visitors", "pay_buyers", "pay_amount", "conversion"])
        tr.append(el("td", null, displayMetric(k, p.values?.[positions[k]])));
      return tr;
    }),
  );
  const observed = daily.filter(
    (p) => p.values?.[positions.visitors] != null,
  ).length;
  $("drawer-missing").textContent =
    "访客有记录 " +
    observed +
    " / 7 天 · 横线表示当日报表未收录商品或该指标缺失。";
  if (!$("drawer").open) $("drawer").showModal();
  $("drawer").scrollTop = 0;
  drawerChart();
}
function download(blob, name) {
  const a = el("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function downloadShop() {
  const bytes = Uint8Array.from(atob(db.files[state.shop]), (c) =>
      c.charCodeAt(0),
    ),
    p = db.shop[state.shop];
  download(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    db.name + "-店铺经营-" + p.start + "至" + p.end + ".xlsx",
  );
}
function exportProducts() {
  const selected = columnOrder.filter((c) => columns.has(c));
  function quote(v, isText = false) {
    let s = v == null ? "" : String(v);
    if (isText && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }
  const p = report();
  const data = [
    [
      "商品ID",
      "商品名称",
      "统计开始",
      "统计截止",
      ...selected.map((k) => fieldNames[k]),
    ]
      .map((v) => quote(v))
      .join(","),
  ];
  for (const row of ranked()) {
    const values = selected.map((k) => {
      const val = field(row, k);
      if (val == null) return "";
      return k === "conversion" || k === "bounce_rate"
        ? format(val, "percent")
        : val;
    });
    data.push(
      [
        quote(row[0], true),
        quote(row[1], true),
        quote(p.start),
        quote(p.end),
        ...values.map((v) => quote(v)),
      ].join(","),
    );
  }
  download(
    new Blob(["\uFEFF" + data.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
    db.name + "-商品筛选-" + p.start + "至" + p.end + ".csv",
  );
}
group("shop-range", state.shop, (v) => {
  state.shop = v;
  stats();
});
group("chart-range", state.window, (v) => {
  state.window = v;
  hideTip();
  shopCharts();
});
group("mix-range", state.mix, (v) => {
  state.mix = v;
  ring();
});
$("prod-range").addEventListener("change", (e) => {
  state.products = e.target.value;
  state.page = 1;
  state.search = "";
  $("search").value = "";
  productTable();
  ring();
});
$("search").addEventListener("input", (e) => {
  state.search = e.target.value;
  state.page = 1;
  productTable();
});
$("next").addEventListener("click", () => {
  state.page++;
  productTable();
});
$("prev").addEventListener("click", () => {
  state.page--;
  productTable();
});
$("shop-download").addEventListener("click", downloadShop);
$("product-export").addEventListener("click", exportProducts);
$("close-drawer").addEventListener("click", () => $("drawer").close());
$("drawer").addEventListener("click", (e) => {
  if (
    e.target === $("drawer") &&
    e.clientX < $("drawer").getBoundingClientRect().left
  )
    $("drawer").close();
});
$("drawer").addEventListener("close", () => {
  state.item = null;
  hideTip();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#column-menu")) $("column-menu").open = false;
});
window.addEventListener("scroll", hideTip, { passive: true });
document
  .querySelector('a[href="#definitions"]')
  .addEventListener("click", () => {
    $("definitions").open = true;
  });
const sectionLinks = [...document.querySelectorAll(".top nav a")];
function navLocation() {
  if (!db) return;
  const nearBottom =
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 3;
  const current =
    nearBottom && $("definitions").open
      ? "#definitions"
      : $("products").getBoundingClientRect().top < 100
        ? "#products"
        : "#overview";
  for (const a of sectionLinks) {
    if (a.hash === current) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
  }
}
let navFrame = 0;
window.addEventListener(
  "scroll",
  () => {
    if (!navFrame)
      navFrame = requestAnimationFrame(() => {
        navFrame = 0;
        navLocation();
      });
  },
  { passive: true },
);
const sizeObserver = new ResizeObserver((entries) => {
  if (!db) return;
  if (
    entries.some(
      (e) => e.target.id === "pay-plot" || e.target.id === "traffic-plot",
    )
  )
    shopCharts();
  if (entries.some((e) => e.target.id === "item-plot")) drawerChart();
});
for (const id of ["pay-plot", "traffic-plot", "item-plot"])
  sizeObserver.observe($(id));
function displayArchive(archive) {
  db = archive;
  positions = Object.fromEntries(db.fields.map((code, i) => [code, i]));
  Object.assign(state, defaults);
  const shopSpans = Object.keys(db.shop),
    productSpans = Object.keys(db.products);
  state.shop = db.shop["7"] ? "7" : shopSpans[0];
  state.products = db.products["1"] ? "1" : productSpans[0];
  columns.clear();
  for (const key of defaultCols) columns.add(key);
  if ($("drawer").open) $("drawer").close();
  hideTip();
  $("column-menu").open = false;
  $("definitions").open = false;
  $("search").value = "";
  const hasShop = shopSpans.length > 0,
    hasProducts = productSpans.length > 0,
    hasDays = Object.keys(db.days).length > 0;
  $("overview").hidden = !hasShop;
  $("products").hidden = !hasProducts;
  $("pay-plot").closest("article").hidden = !hasDays;
  $("traffic-plot").closest("article").hidden = !hasDays;
  $("ring").closest("article").hidden = !hasProducts;
  document.querySelector('[aria-labelledby="chart-heading"]').hidden =
    !hasDays && !hasProducts;
  $("chart-range").hidden = !hasDays;
  $("chart-dates").textContent = "";
  document.querySelector('a[href="#overview"]').hidden = !hasShop;
  document.querySelector('a[href="#products"]').hidden = !hasProducts;
  $("store-meta").textContent = db.name + " · 店铺统计截至 " + db.end;
  $("report-origin").textContent =
    db.name + " · 本机报表" + (db.pin ? " · 版本 " + db.pin : "");
  document.querySelector(".brand").textContent = db.name + " · 经营分析";
  const labels = { 1: "单日", 7: "原生近 7 天", 30: "原生近 30 天" };
  $("prod-range").replaceChildren(
    ...productSpans.map(
      (span) =>
        new Option(
          labels[span] + " · 截至 " + dateLabel(db.products[span].end),
          span,
        ),
    ),
  );
  $("prod-range").value = state.products;
  for (const [groupId, value] of [
    ["shop-range", state.shop],
    ["chart-range", state.window],
    ["mix-range", state.mix],
  ]) {
    for (const button of $(groupId).querySelectorAll("button")) {
      if (groupId === "shop-range")
        button.disabled = !shopSpans.includes(button.dataset.value);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.value === value),
      );
    }
  }
  $("report-content").hidden = false;
  $("board-nav").hidden = false;
  $("change-report").hidden = false;
  $("welcome").hidden = true;
  configureColumns();
  if (hasShop) stats();
  ring();
  productTable();
  shopCharts();
  navLocation();
}
