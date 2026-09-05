# StockTaker

PWA for warehouse stock counts. Snap a photo, identify the product and unit count, verify, and send the photo plus caption to WhatsApp.

Product name and count use Gemini vision (`/api/identify`). If that is not configured, the app falls back to barcode lookup and on-device label OCR.

## Deploy on Vercel

1. Import this GitHub repo in [Vercel](https://vercel.com/new).
2. Add environment variable `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).
3. Deploy. Camera and Web Share require HTTPS.

## Local

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. The vision API only runs on Vercel (or another host that serves `/api/identify`).
