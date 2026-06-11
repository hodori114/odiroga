// api/tmap-traffic.js — real-time traffic/congestion near the venue
//
// GET /api/tmap-traffic?startX=<lng>&startY=<lat>&endX=<lng>&endY=<lat>
//   Same origin/destination as /api/tmap-route. We request the route WITH
//   traffic info (trafficInfo=Y) and aggregate the per-segment congestion
//   codes over the stretch closest to the venue (destination).
//
// We reuse the confirmed /tmap/routes endpoint instead of an unconfirmed
// standalone traffic endpoint, so this always works against the same quota.
//
// TMAP congestion codes per segment: 1 smooth · 2 slow · 3 delayed · 4 jammed.
// Returns: { level (1-4), label, congested (level>=3), sampledSegments, cached }

const TMAP_ROUTES_URL = 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const LABELS = { 1: 'Smooth', 2: 'Slow', 3: 'Delayed', 4: 'Jammed' };

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
        searchOption: '0',
        trafficInfo: 'Y',
        carType: '4',
      }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: 'tmap_upstream', status: r.status, detail: text.slice(0, 300) });
    }

    const json = await r.json();
    const features = Array.isArray(json?.features) ? json.features : [];

    // Collect congestion codes from LineString segments that carry them.
    // Weight each segment by its distance so a long jammed stretch counts more.
    let weighted = 0, totalW = 0, sampled = 0, maxCode = 0;
    for (const f of features) {
      const p = f?.properties || {};
      const code = Number(p.congestion);
      if (!code || code < 1 || code > 4) continue;
      const w = Number(p.distance) || 1;
      weighted += code * w;
      totalW += w;
      sampled++;
      if (code > maxCode) maxCode = code;
    }

    let level, label;
    if (sampled === 0) {
      level = 0;
      label = 'Unknown';
    } else {
      level = Math.round(weighted / totalW);
      if (level < 1) level = 1;
      if (level > 4) level = 4;
      label = LABELS[level];
    }

    const data = {
      level,                       // 0 unknown, else 1-4 average
      maxLevel: maxCode || null,   // worst single segment on the route
      label,
      congested: level >= 3,       // delayed or worse -> warn
      sampledSegments: sampled,
    };

    cache.set(k, { t: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...data, cached: false });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
