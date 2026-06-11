// api/public-toilets.js — public restrooms from Korea's open data (전국공중화장실 표준데이터)
//
// GET /api/public-toilets?sigun=송파구
//   Returns public toilets in a 시군구, normalised to { name, lat, lng, floor, addr, open }.
//   KSPO DOME / Olympic Park / Jamsil are all in 송파구 (default), where OSM has none.
//
// Needs a FREE data.go.kr service key in env DATA_GO_KR_KEY (use the *Encoding* key).
// Field/param names vary across the standard dataset, so parsing is defensive.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // gov data changes rarely
const cache = new Map();

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pick(o, keys) { for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; } return null; }

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    return res.status(500).json({ error: 'config', message: 'DATA_GO_KR_KEY is not set on the server.' });
  }
  const sigun = ((req.query && req.query.sigun) || '송파구').trim();

  const hit = cache.get(sigun);
  if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ ...hit.data, cached: true });
  }

  // serviceKey is appended raw (user supplies the already-encoded "Encoding" key).
  const url = `https://api.data.go.kr/openapi/tn_pubr_public_toilet_api` +
    `?serviceKey=${key}&type=json&pageNo=1&numOfRows=700&SIGUN_NM=${encodeURIComponent(sigun)}`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ error: 'upstream', status: r.status, detail: t.slice(0, 300) });
    }
    const j = await r.json();
    const items = j?.response?.body?.items || j?.body?.items || [];
    const list = Array.isArray(items) ? items : (items.item || []);

    const toilets = list.map(it => {
      const lat = num(pick(it, ['latitude', 'la', 'refLat', 'wgs84Lat', 'LATITUDE', 'y', 'yCrtsCode']));
      const lng = num(pick(it, ['longitude', 'lo', 'refLng', 'wgs84Lon', 'LONGITUDE', 'x', 'xCrtsCode']));
      if (lat == null || lng == null) return null;
      return {
        name: pick(it, ['toiletNm', 'toiltNm', 'restroomNm', 'fcltyNm', 'name', 'PBCTLT_PLC_NM']) || 'Public restroom',
        lat, lng,
        floor: pick(it, ['flrInfo', 'floor', 'instlPlcCn', 'instlPlc']),
        addr: pick(it, ['rnAdres', 'roadNmAddr', 'lnmAdres', 'address', 'RDNMADR']),
        open: pick(it, ['openTime', 'opnTm', 'weekdayOperOpenHhmm', 'mngInstNm']),
      };
    }).filter(Boolean);

    const data = { sigun, count: toilets.length, toilets };
    cache.set(sigun, { t: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ ...data, cached: false });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
