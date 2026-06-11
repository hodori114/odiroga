// api/tmap-route.js — TMAP car-route proxy (airport -> venue)
//
// GET /api/tmap-route?startX=<lng>&startY=<lat>&endX=<lng>&endY=<lat>
//   startX/startY = origin (airport)  longitude/latitude  (WGS84)
//   endX/endY     = destination (venue) longitude/latitude (WGS84)
//
// Returns: { totalTime (sec), totalDistance (m), taxiFare (KRW), tollFare (KRW), cached }
//
// TMAP_APPKEY is read from the Vercel env var and never sent to the client.
// Same route is cached 5 min (module memory + CDN s-maxage) to protect the
// free-tier 1,000 req/day limit.

const TMAP_ROUTES_URL = 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json';
const CACHE_TTL_MS = 5 * 60 * 1000;

// Warm-instance memory cache. Survives between invocations on a warm Lambda.
const cache = new Map();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  const appKey = process.env.TMAP_APPKEY || 'J5KEjdFjI61ZVncCq1b2h8VWuZc507Yk3layV2e7';
  if (!appKey) {
    return res.status(500).json({ error: 'config', message: 'TMAP_APPKEY is not set on the server.' });
  }

  const q = req.query || {};
  const startX = num(q.startX), startY = num(q.startY);
  const endX = num(q.endX), endY = num(q.endY);
  if (startX === null || startY === null || endX === null || endY === null) {
    return res.status(400).json({ error: 'bad_request', message: 'startX, startY, endX, endY are required numbers.' });
  }

  // Cache key rounded to ~10m precision so near-identical requests share a hit.
  const k = [startX, startY, endX, endY].map(n => n.toFixed(4)).join(',');
  const hit = cache.get(k);
  if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...hit.data, cached: true });
  }

  try {
    const r = await fetch(TMAP_ROUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', appKey },
      body: JSON.stringify({
        startX, startY, endX, endY,
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        searchOption: '0',   // 0 = recommended (time-optimal)
        trafficInfo: 'N',
        carType: '4',        // mid-size car for fare estimate
      }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: 'tmap_upstream', status: r.status, detail: text.slice(0, 300) });
    }

    const json = await r.json();
    const props = json?.features?.[0]?.properties;
    if (!props) {
      return res.status(502).json({ error: 'tmap_empty', message: 'No route found between the given coordinates.' });
    }

    const data = {
      totalTime: props.totalTime ?? null,        // seconds
      totalDistance: props.totalDistance ?? null, // meters
      taxiFare: props.taxiFare ?? null,           // KRW (estimated)
      tollFare: props.totalFare ?? null,          // KRW (toll)
    };

    cache.set(k, { t: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...data, cached: false });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
