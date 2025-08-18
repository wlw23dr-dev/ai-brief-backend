// api/brief.js
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

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const escapeHtml = (s="") => s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const escapeAttr = (s="") => s.replace(/"/g,"&quot;").trim();

function buildPreviewHTML(input){
  const ch = (list)=> (list && list.length ? list.join(", ") : "—");
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; line-height:1.5; max-width:720px;">
    <h2 style="margin:0 0 8px;">Сводка по брифу</h2>
    <p style="margin:0 0 12px; color:#555;">Это превью. Полный бриф (PDF) придёт на e-mail после подтверждения.</p>
    <ul style="padding-left:18px; margin:0 0 12px;">
      <li><b>Цель:</b> ${escapeHtml(input.goal)}</li>
      <li><b>Продукт:</b> ${escapeHtml(input.product)}</li>
      <li><b>Сайт:</b> ${input.site ? `<a href="${escapeAttr(input.site)}" target="_blank">${escapeHtml(input.site)}</a>` : "—"}</li>
      <li><b>Гео:</b> ${input.geo ? escapeHtml(input.geo) : "—"}</li>
      <li><b>Бюджет:</b> ${input.budget ? escapeHtml(input.budget) : "—"}</li>
      <li><b>ЦА:</b> ${input.audience ? escapeHtml(input.audience) : "—"}</li>
      <li><b>Каналы интереса:</b> ${ch(input.channels)}</li>
      <li><b>Ограничения:</b> ${input.constraints ? escapeHtml(input.constraints) : "—"}</li>
    </ul>
    <hr style="border:none;border-top:1px solid #eee; margin:12px 0;">
    <p style="margin:0; color:#777;">Дисклеймер: превью сгенерировано автоматически по вашим ответам. Полная версия будет проверена стратегом.</p>
  </div>`;
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
    const previewHtml = buildPreviewHTML(input);
    console.log("BRIEF_INCOMING", { email: input.email, goal: input.goal, product: input.product });
    return res.status(200).json({ ok: true, previewHtml, pdfUrl: null });
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Validation error", detail: err?.issues ?? String(err) });
  }
};
