function parseItems(raw) {
  const text = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed.items) ? parsed.items : [];
  return rows
    .map((row) => ({
      name: String(row.name || "").trim(),
      count: Math.max(1, Math.round(Number(row.count) || 1)),
    }))
    .filter((row) => row.name);
}

async function identifyWithGemini(apiKey, model, base64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `You are counting sellable inventory in a photo for warehouse stock-taking.
Rules:
- Read the product name from packaging (brand + product). Example: "M&M's Milk Chocolate".
- Count distinct physical units (jars, boxes, bags, bottles, packs). Two identical jars = count 2.
- Do not count artwork, logos, or people. Ignore the floor and background.
- Never invent generic object classes like toilet, bottle, or person.
Return JSON only: {"items":[{"name":"string","count":number}]}`,
            },
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini ${response.status}`);
  }

  const raw = (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("");
  return { items: parseItems(raw) };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "missing_key" });
    return;
  }

  try {
    const image = req.body?.image;
    if (!image || typeof image !== "string") {
      res.status(400).json({ error: "missing_image" });
      return;
    }

    const base64 = image.replace(/^data:image\/\w+;base64,/, "");
    if (base64.length < 100 || base64.length > 5_000_000) {
      res.status(413).json({ error: "invalid_image" });
      return;
    }

    const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
    let lastError = "";
    for (const model of models) {
      try {
        const result = await identifyWithGemini(apiKey, model, base64);
        if (result.items.length) {
          res.status(200).json(result);
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    res.status(502).json({ error: "identify_failed", detail: lastError });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
}
