import OpenAI from "openai";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

// Default constructor: the SDK reads OPENAI_API_KEY (and OPENAI_BASE_URL, when set) from the
// server-side Netlify environment. This keeps the key out of the browser and makes the key
// always go to the endpoint it was issued for — a project-owned OpenAI key goes to
// api.openai.com, while Netlify AI Gateway credentials go to the gateway URL. Sending a gateway
// token straight to api.openai.com is what caused the "token issuer" authentication error.
let client;
const getClient = () => (client ??= new OpenAI({ maxRetries: 1, timeout: 55_000 }));

const PROMPT = (context) => `Analyze this meal photo for a calorie tracking app. Identify visible edible food items, estimate serving mass in grams, and estimate nutrition for each item. User notes (may help identify ingredients/portion): ${context || "none"}. Do not claim exactness. Return ONLY valid JSON (no markdown, no code fences) matching this structure: {"meal_name":"short meal name","items":[{"name":"food item","estimated_grams":number,"calories_kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number}],"total":{"calories_kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number},"caveat":"brief uncertainty note"}. Use reasonable nutrition estimates for common Indian foods. If food cannot be identified, say so in the item name and give conservative estimate; if image is not food, return meal_name="Food not recognized", empty items and all totals zero. Hidden oil/ghee, recipe, and exact weight cannot be reliably inferred. Ensure totals equal item sums and values are nonnegative.`;

const NUM_KEYS = ["calories_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
};

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI response was not valid JSON.");
  }
}

function normalize(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.items)) {
    throw new Error("AI response format invalid.");
  }
  const items = result.items.map((it) => {
    const item = { name: String(it?.name || "Food item").slice(0, 120), estimated_grams: num(it?.estimated_grams) };
    for (const k of NUM_KEYS) item[k] = num(it?.[k]);
    return item;
  });
  const total = {};
  for (const k of NUM_KEYS) {
    const sum = items.reduce((s, it) => s + it[k], 0);
    total[k] = items.length ? Math.round(sum * 10) / 10 : num(result.total?.[k]);
  }
  return {
    meal_name: String(result.meal_name || "Meal").slice(0, 120),
    items,
    total,
    caveat: String(result.caveat || "Approximate visual estimate; verify portion and ingredients.").slice(0, 400),
  };
}

function providerErrorMessage(err) {
  const status = err?.status;
  const code = err?.code || err?.error?.code;
  if (code === "insufficient_quota" || /no credits|quota/i.test(err?.message || "")) {
    return { status: 503, error: "AI provider account has no credits/quota remaining. Add billing credits for the configured OpenAI key, or remove the custom OPENAI_API_KEY so Netlify AI Gateway is used." };
  }
  if (status === 401 || status === 403) {
    return { status: 503, error: "AI provider rejected the server API key. Check the OPENAI_API_KEY environment variable in Netlify." };
  }
  if (status === 429) return { status: 429, error: "AI service is busy (rate limit). Please try again in a minute." };
  if (status === 404 || code === "model_not_found") {
    return { status: 502, error: "Configured AI model is not available. Check the OPENAI_MODEL environment variable." };
  }
  if (err instanceof OpenAI.APIConnectionError) return { status: 504, error: "Could not reach the AI service. Please try again." };
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const imageData = body?.imageData;
  const context = typeof body?.context === "string" ? body.context.slice(0, 500) : "";
  if (typeof imageData !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(imageData)) {
    return json({ error: "Please upload a JPG, PNG or WEBP food image." }, 400);
  }
  if (imageData.length > 5_000_000) return json({ error: "Image too large. Try a smaller photo." }, 413);

  try {
    const response = await getClient().responses.create({
      model: process.env.OPENAI_MODEL || "gpt-6.2-astra",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: PROMPT(context) },
            { type: "input_image", image_url: imageData, detail: "high" },
          ],
        },
      ],
      max_output_tokens: 4000,
    });

    const text = response.output_text;
    if (!text) {
      const reason = response.incomplete_details?.reason;
      throw new Error(reason ? `AI response incomplete (${reason}).` : "AI returned no nutrition estimate.");
    }
    return json(normalize(parseModelJson(text)));
  } catch (err) {
    const mapped = providerErrorMessage(err);
    if (mapped) {
      console.error("analyze-food provider error:", err?.status, err?.code || "", err?.message);
      return json({ error: mapped.error }, mapped.status);
    }
    console.error("analyze-food error:", err);
    return json({ error: err?.message || "Could not analyze photo." }, 500);
  }
};
