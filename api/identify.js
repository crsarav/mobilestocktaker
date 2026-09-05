export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

function parseItems(raw) {
  const text = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : text);
  const rows = Array.isArray(parsed.items) ? parsed.items : [];
  const merged = new Map();
  rows.forEach((row) => {
    const name = String(row.name || "")
      .replace(/\s+/g, " ")
      .trim();
    const count = Math.max(1, Math.round(Number(row.count) || 1));
    if (!name || name.length < 3) return;
    const key = name.toLowerCase();
    const current = merged.get(key);
    if (current) current.count += count;
    else merged.set(key, { name, count });
  });
  return Array.from(merged.values());
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
              text: `This is a warehouse/stock-take photo. It may be messy: mixed products on the floor, stacked cases, partial boxes.

Task: list EVERY distinct product you can read from packaging.

Rules:
- Use brand + product as printed, e.g. "Cottonelle Flushable Wipes", "Famous Amos Chocolate Chip Cookies", "Munchies Snack Mix", "Sun Chips".
- Count physical sellable units: boxes, bags, jars, cases. Stacked Cottonelle boxes count as 2 if two boxes are visible.
- Include partly visible products if the brand is readable.
- Do not invent items. Do not return generic classes like toilet or bottle.
- Do not OCR fragments like "FLUSHABLE WIPES" without the brand if the brand is visible.
- Ignore people, carpet, and price stickers.

Return JSON only:
{"items":[{"name":"Cottonelle Flushable Wipes","count":2},{"name":"Cheetos","count":1}]}`,
            },
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
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
  const configured = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({ configured });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!configured) {
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

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
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
