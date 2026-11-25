const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export default async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not set in Netlify environment variables." }), { status: 503, headers });
  try {
    const body = await req.json();
    const imageData = body.imageData;
    const context = typeof body.context === "string" ? body.context.slice(0, 500) : "";
    if (typeof imageData !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(imageData)) {
      return new Response(JSON.stringify({ error: "Please upload a JPG, PNG or WEBP food image." }), { status: 400, headers });
    }
    if (imageData.length > 5_000_000) return new Response(JSON.stringify({ error: "Image too large. Try a smaller photo." }), { status: 413, headers });

    const prompt = `Analyze this meal photo for a calorie tracking app. Identify visible edible food items, estimate serving mass in grams, and estimate nutrition for each item. User notes (may help identify ingredients/portion): ${context || "none"}. Do not claim exactness. Return ONLY valid JSON matching this structure: {"meal_name":"short meal name","items":[{"name":"food item","estimated_grams":number,"calories_kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number}],"total":{"calories_kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number},"caveat":"brief uncertainty note"}. Use reasonable nutrition estimates for common Indian foods. If food cannot be identified, say so in the item name and give conservative estimate; if image is not food, return meal_name="Food not recognized", empty items and all totals zero. Hidden oil/ghee, recipe, and exact weight cannot be reliably inferred. Ensure totals equal item sums and values are nonnegative.`;

    const model = process.env.OPENAI_MODEL || "gpt-6.2-astra";
    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageData, detail: "high" }] }],
        max_output_tokens: 900
      })
    });
    const apiJson = await apiRes.json();
    if (!apiRes.ok) return new Response(JSON.stringify({ error: apiJson.error?.message || "AI provider request failed." }), { status: 502, headers });
    let text = apiJson.output_text;
    if (!text && Array.isArray(apiJson.output)) {
      text = apiJson.output.flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("\n");
    }
    if (!text) throw new Error("AI returned no structured nutrition text.");
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const result = JSON.parse(text);
    if (!result.total || !Array.isArray(result.items)) throw new Error("AI response format invalid.");
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Could not analyze photo." }), { status: 500, headers });
  }
};
