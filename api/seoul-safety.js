// api/seoul-safety.js — Seoul Open Data real-time city population/congestion proxy
//
// GET /api/seoul-safety?area=<hotspot name>
//   area must be one of the allow-listed Seoul hotspot names below.
//
// Why a proxy: the Seoul endpoint is HTTP on port 8088 (mixed-content — the
// HTTPS client can't call it directly) and the API key must stay server-side.
//
// Returns: { area, level (ko), levelEn, rank 1-4, congested, danger, message,
//            ppltnMin, ppltnMax, time, cached }
//
// Congestion levels (AREA_CONGEST_LVL): 여유 / 보통 / 약간 붐빔 / 붐빔.
// "붐빔" (Crowded) is treated as a danger trigger ("very crowded").

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

// Allow-list of Seoul hotspot area names this app uses (prevents arbitrary
// upstream calls). These are official Seoul real-time-city-data POI names.
const ALLOWED_AREAS = new Set([
  '올림픽공원',
  '잠실종합운동장',
  '잠실관광특구',
  '강남역',
  '홍대입구역(2호선)',
  '이태원역',
]);

const LEVEL_MAP = {
  '여유':      { en: 'Relaxed',       rank: 1 },
  '보통':      { en: 'Normal',        rank: 2 },
  '약간 붐빔': { en: 'A bit crowded', rank: 3 },
  '붐빔':      { en: 'Crowded',       rank: 4 },
};

export default async function handler(req, res) {
  const key = process.env.SEOUL_API_KEY_KO;
  if (!key) {
    return res.status(500).json({ error: 'config', message: 'SEOUL_API_KEY_KO is not set on the server.' });
  }

  const area = (req.query && req.query.area || '').trim();
  if (!area || !ALLOWED_AREAS.has(area)) {
    return res.status(400).json({ error: 'bad_request', message: 'Unknown or missing area.', allowed: [...ALLOWED_AREAS] });
  }

  const hit = cache.get(area);
  if (hit && (Date.now() - hit.t) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...hit.data, cached: true });
  }

  const url = `http://openapi.seoul.go.kr:8088/${key}/json/citydata_ppltn/1/5/${encodeURIComponent(area)}`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: 'seoul_upstream', status: r.status, detail: text.slice(0, 300) });
    }
    const json = await r.json();

    // Surface API-level errors (e.g. bad key, rate limit).
    const code = json?.RESULT?.['CODE'] || json?.['SeoulRtd.citydata_ppltn']?.RESULT?.CODE;
    const rows = json?.['SeoulRtd.citydata_ppltn'];
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      return res.status(502).json({ error: 'seoul_empty', code: code || 'unknown', message: 'No congestion row returned.' });
    }

    const levelKo = row.AREA_CONGEST_LVL || null;
    const mapped = LEVEL_MAP[levelKo] || { en: 'Unknown', rank: 0 };
    const data = {
      area,
      level: levelKo,
      levelEn: mapped.en,
      rank: mapped.rank,
      congested: mapped.rank >= 3,   // "약간 붐빔" or worse
      danger: mapped.rank >= 4,      // "붐빔" — very crowded
      message: row.AREA_CONGEST_MSG || null,
      ppltnMin: row.AREA_PPLTN_MIN != null ? Number(row.AREA_PPLTN_MIN) : null,
      ppltnMax: row.AREA_PPLTN_MAX != null ? Number(row.AREA_PPLTN_MAX) : null,
      time: row.PPLTN_TIME || null,
    };

    cache.set(area, { t: Date.now(), data });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...data, cached: false });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
