// api/tmap-route.js — TMAP car route proxy (airport -> venue)
// STATUS: stub. Full implementation lands in Step 2 (TMAP API 연동).
// Reads TMAP_APPKEY from Vercel env vars; never expose the key to the client.

export default function handler(req, res) {
  res.status(501).json({
    error: 'not_implemented',
    endpoint: 'tmap-route',
    message: 'TMAP route proxy is scaffolded but not yet implemented (Step 2).'
  });
}
