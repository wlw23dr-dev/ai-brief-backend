// api/brief.js — ИИ + PDF + e-mail (Resend) + fallback на прямую загрузку
const { z } = require("zod");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const { Resend } = require("resend");

const BriefSchema = z.object({
  goal: z.string().min(2),
  product: z.string().min(2),
  site: z.string().url().optional().or(z.literal("")),
  geo: z.string().optional().default(""),
  budget: z.string().optional().default(""),
  audience: z.string().optional().default(""),
  channels: z.array(z.string()).optional().default([]),
  constraints: z.string().optional().default(""),
  email: z.string().email()
});

const AiOutSchema = z.object({
  summary: z.string(),
  offers: z.array(z.string()).min(1),
  headlines: z.array(z.string()).optional().default([]),
  segments: z.array(z.string()).min(1),
  channel_plan: z.array(z.object({
    channel: z.string(),
    role: z.string(),
    budget_share: z.string()
  })).min(1),
  creatives: z.array(z.string()).min(1),
  kpi_baseline: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  next_steps: z.array(z.string()).min(1)
});

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const RESEND_KEY = process.env.RESEND_API_KEY || "";         // опционально
const RESEND_FROM = process.env.RESEND_FROM || "brief@yourdomain.com"; // опционально

const escapeHtml = (s="") => s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const escapeAttr = (s="") => s.replace(/"/g,"&quot;").trim();

function pdfHtml(input, ai){
  const li = a => (a||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>";
  const plan = (ai.channel_plan||[]).map(i=>`<tr><td><b>${escapeHtml(i.channel)}</b></td><td>${escapeHtml(i.role)}</td><td>${escapeHtml(i.budget_share)}</td></tr>`).join("");
  const now = new Date().toLocaleDateString("ru-RU");
  return `<!doctype html><html><head><meta charset="utf-8"><title>AI Brief</title>
  <style>
    *{box-sizing:border-box} body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 8px}
    p,li{font-size:12px;line-height:1.5} ul{margin:6px 0 12px}
    table{width:100%;border-collapse:collapse;margin:6px 0 12px} td,th{border:1px solid #eee;padding:6px;font-size:12px}
    .meta{color:#666;font-size:11px;margin-bottom:12px}
    .box{border:1px solid #eee;border-radius:8px;padding:12px;margin:12px 0}
    .muted{color:#666}
  </style></head><body>
    <h1>Умный бриф</h1>
    <div class="meta">Дата: ${now}</div>

    <div class="box">
      <h2>Контекст</h2>
      <ul>
        <li><b>Цель:</b> ${escapeHtml(input.goal)}</li>
        <li><b>Продукт:</b> ${escapeHtml(input.product)}</li>
        <li><b>Сайт:</b> ${input.site ? `<a href="${escapeAttr(input.site)}">${escapeHtml(input.site)}</a>` : "—"}</li>
        <li><b>Гео:</b> ${input.geo ? escapeHtml(input.geo) : "—"}</li>
        <li><b>Бюджет:</b> ${input.budget ? escapeHtml(input.budget) : "—"}</li>
        <li><b>ЦА:</b> ${input.audience ? escapeHtml(input.audience) : "—"}</li>
        <li><b>Каналы интереса:</b> ${(input.channels||[]).join(", ") || "—"}</li>
        <li><b>Ограничения:</b> ${input.constraints ? escapeHtml(input.constraints) : "—"}</li>
      </ul>
    </div>

    <div class="box">
      <h2>Краткая стратегия</h2>
      <p>${escapeHtml(ai.summary || "")}</p>
    </div>

    <div class="box">
      <h2>Офферы</h2>
      <ul>${li(ai.offers)}</ul>
      ${ai.headlines?.length ? `<h2>Заголовки</h2><ul>${li(ai.headlines)}</ul>` : ""}
    </div>

    <div class="box">
      <h2>Сегменты ЦА</h2>
      <ul>${li(ai.segments)}</ul>
    </div>

    <div class="box">
      <h2>Канальный план</h2>
      <table><thead><tr><th>Канал</th><th>Роль</th><th>Доля бюджета</th></tr></thead><tbody>${plan || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
    </div>

    <div class="box">
      <h2>Идеи креативов</h2>
      <ul>${li(ai.creatives)}</ul>
    </div>

    <div class="box">
      <h2>KPI (бейслайн) и риски</h2>
      <p><b>KPI:</b></p>
      <ul>${li(ai.kpi_baseline)}</ul>
      <p><b>Риски:</b></p>
      <ul>${li(ai.risks)}</ul>
    </div>

    <div class="box">
      <h2>Первые шаги (2 недели)</h2>
      <ul>${li(ai.next_steps)}</ul>
    </div>

    <p class="muted">Дисклеймер: черновик на основе ваших ответов и генерации ИИ; требует верификации стратегом.</p>
  </body></html>`;
}

function previewHtml(input, ai){
  const ch = (list)=> (list && list.length ? list.join(", ") : "—");
  const plan = (ai.channel_plan||[]).map(i=>`<li><b>${escapeHtml(i.channel)}:</b> ${escapeHtml(i.role)} — ${escapeHtml(i.budget_share)}</li>`).join("");
  const offers = (ai.offers||[]).map(o=>`<li>${escapeHtml(o)}</li>`).join("");
  const steps  = (ai.next_steps||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");
  const crs    = (ai.creatives||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.5; max-width:780px;">
    <h2 style="margin:0 0 8px;">Сводка по брифу</h2>
    <p style="margin:0 0 12px; color:#555;">Это превью. Полный бриф придёт на e-mail и будет доступен для скачивания.</p>

    <ul style="padding-left:18px; margin:0 16px 16px 0;">
      <li><b>Цель:</b> ${escapeHtml(input.goal)}</li>
      <li><b>Продукт:</b> ${escapeHtml(input.product)}</li>
      <li><b>Сайт:</b> ${input.site ? `<a href="${escapeAttr(input.site)}" target="_blank">${escapeHtml(input.site)}</a>` : "—"}</li>
      <li><b>Гео:</b> ${input.geo ? escapeHtml(input.geo) : "—"}</li>
      <li><b>Бюджет:</b> ${input.budget ? escapeHtml(input.budget) : "—"}</li>
      <li><b>ЦА:</b> ${input.audience ? escapeHtml(input.audience) : "—"}</li>
      <li><b>Каналы интереса:</b> ${ch(input.channels)}</li>
      <li><b>Ограничения:</b> ${input.constraints ? escapeHtml(input.constraints) : "—"}</li>
    </ul>

    <h3 style="margin:12px 0 6px;">Краткая стратегия</h3>
    <p style="margin:0 0 10px;">${escapeHtml(ai.summary || "")}</p>

    <h3 style="margin:12px 0 6px;">Офферы</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${offers || "<li>—</li>"}</ul>

    <h3 style="margin:12px 0 6px;">Канальный план</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${plan || "<li>—</li>"}</ul>

    <h3 style="margin:12px 0 6px;">Идеи креативов</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${crs || "<li>—</li>"}</ul>

    <h3 style="margin:12px 0 6px;">Ближайшие шаги</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${steps || "<li>—</li>"}</ul>

    <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
    <p style="margin:0; color:#777;">Дисклеймер: черновик; проверяется стратегом.</p>
  </div>`;
}

async function aiDraft(input){
  if (!OPENAI_KEY) return null;
  const system = [
    "Ты — Head of Strategy маркетингового агентства.",
    "Пиши кратко, структурно, без воды.",
    "Верни ТОЛЬКО JSON со схемой (см. пример ключей без лишнего текста)."
  ].join("\n");
  const user = { brief: input, note: "Если данных мало — сделай разумные допущения и пометь их." };

  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ "Authorization":`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages:[
        { role:"system", content: system },
        { role:"user", content: JSON.stringify(user) }
      ]
    })
  });
  if (!r.ok) throw new Error("LLM error "+r.status+" "+await r.text());
  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  return AiOutSchema.parse(JSON.parse(raw));
}

async function renderPdf(html){
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", right: "14mm", bottom: "20mm", left: "14mm" }
  });
  await browser.close();
  return pdf;
}

async function sendEmail(to, pdfBuffer){
  if (!RESEND_KEY) return false;
  const resend = new Resend(RESEND_KEY);
  await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject: "Ваш AI-бриф",
    html: `<p>Привет! Прикрепили PDF с брифом. Если что-то уточнить — ответьте на это письмо.</p>`,
    attachments: [{
      filename: `ai-brief-${Date.now()}.pdf`,
      content: pdfBuffer.toString("base64"),
      type: "application/pdf"
    }]
  });
  return true;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    let body = req.body ?? {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
    const input = BriefSchema.parse(body);

    // ИИ
    let ai = null;
    try { ai = await aiDraft(input); } catch(e){ console.error(e); }

    const aiSafe = ai || {
      summary: "Черновая стратегия будет приложена в полном PDF.",
      offers: [], headlines: [], segments: [], channel_plan: [],
      creatives: [], kpi_baseline: [], risks: [], next_steps: []
    };

    // HTML превью (для сайта) и HTML для PDF
    const preview = previewHtml(input, aiSafe);
    const pdfPageHtml = pdfHtml(input, aiSafe);

    // PDF
    let pdfBuffer = null;
    try { pdfBuffer = await renderPdf(pdfPageHtml); } catch(e){ console.error("PDF error", e); }

    // Письмо (если настроен Resend), иначе — вернём dataURL для скачивания
    let emailed = false, pdfDataUrl = null;
    if (pdfBuffer) {
      try { emailed = await sendEmail(input.email, pdfBuffer); } catch(e){ console.error("Email error", e); }
      if (!emailed) {
        pdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
      }
    }

    console.log("BRIEF_DONE", { email: input.email, ai: !!ai, emailed });
    return res.status(200).json({ ok: true, previewHtml: preview, pdfUrl: emailed ? null : pdfDataUrl });
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Validation error", detail: err?.issues ?? String(err) });
  }
};
