// api/tmap-traffic.js — real-time traffic/congestion AROUND the venue
//
// GET /api/tmap-traffic?startX=<lng>&startY=<lat>&endX=<lng>&endY=<lat>
//   endX/endY = venue (destination). We query TMAP's dedicated traffic API
//   centered on the venue and aggregate per-road congestion within RADIUS_M,
//   so congestion reflects the area near the venue (not the long highway leg).
//
// TMAP congestion codes: 0 no-data · 1 smooth · 2 slow · 3 delayed · 4 jammed.
// Returns: { level (0-4), maxLevel, label, congested (>=3), sampledRoads,
//            worstRoad, cached }

const TMAP_TRAFFIC_URL = 'https://apis.openapi.sk.com/tmap/traffic?version=1&format=json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const RADIUS_M = 1800;      // keep roads within this distance of the venue
const ZOOM_LEVEL = 16;      // tighter area = smaller payload
const LABELS = { 1: 'Smooth', 2: 'Slow', 3: 'Delayed', 4: 'Jammed' };

const cache = new Map();

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function geoDistM(la1, lo1, la2, lo2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default async function handler(req, res) {
  const appKey = process.env.TMAP_APPKEY || 'J5KEjdFjI61ZVncCq1b2h8VWuZc507Yk3layV2e7';
  if (!appKey) {
    return res.status(500).json({ error: 'config', message: 'TMAP_APPKEY is not set on the server.' });
  }

  const q = req.query || {};
  // Center on the venue (endX/endY); fall back to start if missing.
  const cLon = num(q.endX) ?? num(q.startX);
  const cLat = num(q.endY) ?? num(q.startY);
  if (cLon === null || cLat === null) {
    return res.status(400).json({ error: 'bad_request', message: 'endX/endY (or startX/startY) are required numbers.' });
  }

  const k = `${cLon.toFixed(4)},${cLat.toFixed(4)}`;
  const hit = cache.get(k);
  if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...hit.data, cached: true });
  }

  const url = `${TMAP_TRAFFIC_URL}&reqCoordType=WGS84GEO&resCoordType=WGS84GEO` +
    `&centerLon=${cLon}&centerLat=${cLat}&trafficType=AUTO&zoomLevel=${ZOOM_LEVEL}`;

  try {
    const r = await fetch(url, { headers: { appKey } });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: 'tmap_upstream', status: r.status, detail: text.slice(0, 300) });
    }
    const json = await r.json();
    const features = Array.isArray(json?.features) ? json.features : [];

    // Aggregate congestion of roads within RADIUS_M of the venue, weighted by
    // road length, so a long jammed stretch counts more than a short one.
    let weighted = 0, totalW = 0, sampled = 0, maxCode = 0, worstRoad = null;
    for (const f of features) {
      const p = f?.properties || {};
      const code = Number(p.congestion);
      if (!code || code < 1 || code > 4) continue; // skip 0 / no-data
      const coords = f?.geometry?.coordinates;
      const pt = Array.isArray(coords) && coords.length ? coords[Math.floor(coords.length / 2)] : null;
      if (!pt) continue;
      if (geoDistM(cLat, cLon, pt[1], pt[0]) > RADIUS_M) continue; // venue vicinity only
      const w = Number(p.distance) || 1;
      weighted += code * w;
      totalW += w;
      sampled++;
      if (code > maxCode) { maxCode = code; worstRoad = p.name || p.description || null; }
    }

    let level, label;
    if (sampled === 0) { level = 0; label = 'Unknown'; }
    else {
      level = Math.round(weighted / totalW);
      if (level < 1) level = 1; if (level > 4) level = 4;
      label = LABELS[level];
    }

    const data = {
      level,
      maxLevel: maxCode || null,
      label,
      congested: level >= 3,
      sampledRoads: sampled,
      worstRoad: worstRoad ? String(worstRoad).split('/')[0] : null,
    };

    cache.set(k, { t: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...data, cached: false });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
