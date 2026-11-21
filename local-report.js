// Only the JSON data block of an exported HTML report is read.
function readArchiveFile(source) {
  const text = source.trim();
  if (!text.startsWith("<")) return JSON.parse(text);
  const scripts = /<script\b([^>]*)>/gi;
  for (const tag of text.matchAll(scripts)) {
    const attrs = tag[1];
    if (
      !/(?:^|\s)id\s*=\s*(["'])archive\1(?:\s|$)/i.test(attrs) ||
      !/(?:^|\s)type\s*=\s*(["'])application\/json\1(?:\s|$)/i.test(attrs)
    )
      continue;
    const start = tag.index + tag[0].length;
    const closing = /<\/script\s*>/gi;
    closing.lastIndex = start;
    const end = closing.exec(text);
    if (end) return JSON.parse(text.slice(start, end.index));
    break;
  }
  throw new Error(
    "此 HTML 没有可读取的经营报表，请选择经营助手导出的整份看板。",
  );
}

function validateArchive(data) {
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const numberOrNull = (value) =>
    value === null ||
    ((typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
      Number.isFinite(Number(value)));
  const date = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const milliseconds = Date.parse(value + "T00:00:00Z");
    return (
      Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString().slice(0, 10) === value
    );
  };
  const metrics = (value) =>
    object(value) && Object.values(value).every(numberOrNull);
  const validPeriod = (period, length) => {
    if (
      !object(period) ||
      !date(period.start) ||
      !date(period.end) ||
      period.start > period.end
    )
      return false;
    return (
      (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1 ===
      Number(length)
    );
  };
  function requireValid(condition, label) {
    if (!condition)
      throw new Error("无法读取报表中的" + label + "，请重新导出完整报表。");
  }
  requireValid(
    object(data) &&
      typeof data.name === "string" &&
      data.name.trim() &&
      date(data.end),
    "店铺或统计日期",
  );
  if (
    data.format !== undefined &&
    (data.format !== "shop-report" || data.version !== 1)
  )
    throw new Error("当前页面暂不支持这个报表版本。");
  requireValid(
    Array.isArray(data.fields) &&
      data.fields.includes("visitors") &&
      data.fields.every((v) => typeof v === "string") &&
      new Set(data.fields).size === data.fields.length,
    "商品指标",
  );
  requireValid(
    object(data.shop) &&
      object(data.products) &&
      (Object.keys(data.shop).length || Object.keys(data.products).length),
    "报表期间",
  );
  requireValid(
    data.pin === undefined || typeof data.pin === "string",
    "归档版本",
  );
  for (const [key, period] of Object.entries(data.shop)) {
    requireValid(
      ["1", "7", "30"].includes(key) &&
        validPeriod(period, key) &&
        metrics(period.values) &&
        metrics(period.previous),
      "店铺指标",
    );
    const hasBase = period.baseStart != null || period.baseEnd != null;
    requireValid(
      !hasBase ||
        (date(period.baseStart) &&
          date(period.baseEnd) &&
          period.baseStart <= period.baseEnd),
      "对照日期",
    );
  }
  for (const [key, period] of Object.entries(data.products)) {
    requireValid(
      ["1", "7", "30"].includes(key) &&
        validPeriod(period, key) &&
        Array.isArray(period.rows),
      "商品期间",
    );
    const ids = new Set();
    for (const row of period.rows) {
      requireValid(
        Array.isArray(row) &&
          row.length === data.fields.length + 2 &&
          typeof row[0] === "string" &&
          row[0] &&
          !ids.has(row[0]) &&
          typeof row[1] === "string" &&
          row.slice(2).every(numberOrNull),
        "商品明细",
      );
      ids.add(row[0]);
    }
  }
  requireValid(
    object(data.days) &&
      Object.entries(data.days).every(
        ([key, value]) => date(key) && metrics(value),
      ),
    "店铺日报",
  );
  requireValid(
    object(data.productDays) &&
      Object.entries(data.productDays).every(
        ([key, rows]) =>
          date(key) &&
          object(rows) &&
          Object.values(rows).every(
            (values) =>
              Array.isArray(values) &&
              values.length === data.fields.length &&
              values.every(numberOrNull),
          ),
      ),
    "商品日趋势",
  );
  if (data.files !== undefined) {
    requireValid(object(data.files), "下载附件");
    for (const [key, encoded] of Object.entries(data.files)) {
      requireValid(
        Object.hasOwn(data.shop, key) &&
          typeof encoded === "string" &&
          encoded.startsWith("UEs") &&
          encoded.length % 4 === 0 &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
        "Excel 附件",
      );
    }
  }
  return data;
}

const input = document.getElementById("report-file");
const statusLine = document.getElementById("load-status");
let lastSelection = 0;

for (const id of ["open-report", "change-report"]) {
  document.getElementById(id).addEventListener("click", () => input.click());
}

input.addEventListener("change", async () => {
  const file = input.files[0];
  if (!file) return;
  const selection = ++lastSelection;
  input.value = "";
  statusLine.textContent = "正在本机读取报表…";
  try {
    const report = validateArchive(readArchiveFile(await file.text()));
    if (selection !== lastSelection) return;
    displayArchive(report);
    statusLine.textContent = "";
    document.getElementById("change-report").focus({ preventScroll: true });
  } catch (error) {
    if (selection !== lastSelection) return;
    statusLine.textContent =
      error instanceof SyntaxError
        ? "文件内容不是有效的经营报表。请选择导出的 HTML 或 JSON 文件。"
        : error.message;
    statusLine.scrollIntoView({ block: "nearest" });
  }
});
