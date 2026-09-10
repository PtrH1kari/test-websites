/**
 * Прокси для страницы практики английского.
 *
 * Зачем: браузер не даёт статичной странице обращаться к api.anthropic.com
 * (нет заголовка Access-Control-Allow-Origin). Воркер стоит посередине:
 * добавляет CORS, держит ключ у себя и не пускает лишние запросы.
 *
 * Установка (Cloudflare, бесплатный план):
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy worker.js --name english-practice
 *   3. wrangler secret put ANTHROPIC_API_KEY --name english-practice
 *   4. Адрес вида https://english-practice.<аккаунт>.workers.dev
 *      вставьте в поле «Адрес прокси» на странице.
 */

const ALLOWED_ORIGINS = [
  "https://ptrh1kari.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

const MODEL = "claude-haiku-4-5";   // быстрый и дешёвый; для более тонких правок — "claude-sonnet-5"
const MAX_TOKENS = 1000;
const MAX_TURNS = 40;               // сколько последних реплик пропускать
const MAX_CHARS = 4000;             // на одну реплику

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return reply({ error: { message: "Only POST" } }, 405, cors);
    }
    if (!allowed) {
      return reply({ error: { message: "Origin not allowed" } }, 403, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return reply({ error: { message: "ANTHROPIC_API_KEY is not set on the worker" } }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ error: { message: "Bad JSON" } }, 400, cors);
    }

    // Собираем запрос сами: клиент не выбирает модель и не задаёт лимиты.
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, MAX_CHARS)
      }))
      .filter(m => m.content.length > 0);

    if (!messages.length) {
      return reply({ error: { message: "No messages" } }, 400, cors);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: String(body.system ?? "").slice(0, 8000),
        messages
      })
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};

function reply(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
