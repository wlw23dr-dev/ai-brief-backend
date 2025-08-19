// api/brief.js — версия с ИИ (JSON → превью)
const { z } = require("zod");

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

// что ждём от ИИ
const AiOutSchema = z.object({
  summary: z.string(),
  offers: z.array(z.string()).min(3).max(8),
  headlines: z.array(z.string()).optional().default([]),
  segments: z.array(z.string()).min(2).max(8),
  channel_plan: z.array(z.object({
    channel: z.string(),
    role: z.string(),
    budget_share: z.string()
  })).min(3).max(10),
  creatives: z.array(z.string()).min(3).max(8),
  kpi_baseline: z.array(z.string()).min(2).max(8),
  risks: z.array(z.string()).min(1).max(8),
  next_steps: z.array(z.string()).min(3).max(8)
});

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const escapeHtml = (s="") => s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const escapeAttr = (s="") => s.replace(/"/g,"&quot;").trim();

function buildPreviewHTML(input, ai){
  const ch = (list)=> (list && list.length ? list.join(", ") : "—");
  const plan = (ai.channel_plan||[]).map(i=>`<li><b>${escapeHtml(i.channel)}:</b> ${escapeHtml(i.role)} — ${escapeHtml(i.budget_share)}</li>`).join("");
  const offers = (ai.offers||[]).map(o=>`<li>${escapeHtml(o)}</li>`).join("");
  const steps  = (ai.next_steps||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");
  const crs    = (ai.creatives||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.5; max-width:780px;">
    <h2 style="margin:0 0 8px;">Сводка по брифу</h2>
    <p style="margin:0 0 12px; color:#555;">Это превью. Полный бриф (PDF) придёт на e-mail.</p>

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

    <h3 style="margin:12px 0 6px;">Идеи креатива</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${crs || "<li>—</li>"}</ul>

    <h3 style="margin:12px 0 6px;">Ближайшие шаги (2 недели)</h3>
    <ul style="padding-left:18px; margin:0 0 10px;">${steps || "<li>—</li>"}</ul>

    <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
    <p style="margin:0; color:#777;">Дисклеймер: черновик на основе ваших ответов и генерации ИИ; требует верификации стратегом.</p>
  </div>`;
}

async function aiDraft(input){
  if (!OPENAI_KEY) return null; // нет ключа — вернём null → превью без ИИ

  const system = [
    "Ты — Head of Strategy маркетингового агентства.",
    "Пиши кратко и по делу, без воды и канцелярита.",
    "Верни ТОЛЬКО JSON со строго такой схемой:",
    JSON.stringify(AiOutSchema.shape ? {
      summary: "string",
      offers: ["string"],
      headlines: ["string"],
      segments: ["string"],
      channel_plan: [{ channel:"string", role:"string", budget_share:"string" }],
      creatives: ["string"],
      kpi_baseline: ["string"],
      risks: ["string"],
      next_steps: ["string"]
    } : {})
  ].join("\n");

  const user = {
    brief: {
      goal: input.goal, product: input.product, site: input.site,
      geo: input.geo, budget: input.budget, audience: input.audience,
      channels: input.channels, constraints: input.constraints
    },
    rules: [
      "Не обещай гарантированный результат.",
      "Учти, что бюджет может быть вилкой.",
      "Если информации мало — делай разумные допущения и помечай их."
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    })
  });

  if (!r.ok) {
    const text = await r.text().catch(()=> "");
    throw new Error("LLM error: " + r.status + " " + text);
  }
  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  return AiOutSchema.parse(parsed);
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

    // 1) зовём ИИ (если есть ключ), 2) собираем превью
    let ai = null;
    try { ai = await aiDraft(input); } catch (e) { console.error(e); }
    const previewHtml = buildPreviewHTML(input, ai || {
      summary: "Черновая стратегия будет в полном PDF.",
      offers: [],
      headlines: [],
      segments: [],
      channel_plan: [],
      creatives: [],
      kpi_baseline: [],
      risks: [],
      next_steps: []
    });

    console.log("BRIEF_INCOMING", { email: input.email, goal: input.goal, product: input.product, ai: !!ai });
    return res.status(200).json({ ok: true, previewHtml, pdfUrl: null });
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Validation error", detail: err?.issues ?? String(err) });
  }
};
