# StockTaker

Zero-backend PWA for warehouse stock counts. Snap a photo, run on-device object detection (TensorFlow.js + COCO-SSD), verify quantities, and send the annotated image plus caption to WhatsApp.

## Deploy on Vercel

1. Import this GitHub repo in [Vercel](https://vercel.com/new).
2. Leave the defaults (static site, no build command).
3. Deploy. Camera and Web Share require HTTPS, which Vercel provides.

## Local

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173` on a phone on the same network, or use a phone emulator. The first vision-model load fetches TensorFlow.js from the CDN.
