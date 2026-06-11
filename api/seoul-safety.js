// api/seoul-safety.js — Seoul Open Data real-time city data proxy (congestion -> danger zones)
// STATUS: stub. Full implementation lands in Step 6 (서울시 실시간 도시데이터 연동).
// Reads SEOUL_API_KEY_KO / SEOUL_API_KEY_EN from Vercel env vars.

export default function handler(req, res) {
  res.status(501).json({
    error: 'not_implemented',
    endpoint: 'seoul-safety',
    message: 'Seoul city-data proxy is scaffolded but not yet implemented (Step 6).'
  });
}
