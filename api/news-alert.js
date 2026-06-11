// api/news-alert.js — news keyword detector for protest/closure alerts
//
// Scans a Korean news RSS feed for action keywords (집회 / 시위 / 통제) that
// co-occur with a venue place name (잠실 / 고양 / 올림픽공원), writes new matches
// to Supabase `news_alerts` (status='pending'), and optionally emails the admin.
// Admin approves/rejects in /admin; only APPROVED alerts surface in the app.
//
// NOTE: No Naver Open API credentials were provided, so this uses Google News
// RSS (keyless, works server-side). To switch to Naver, set NEWS_RSS_URL or wire
// the Naver News Open API with X-Naver-Client-Id/Secret.
//
// Trigger: Vercel Cron (see vercel.json) or a manual GET.

const ACTIONS = ['집회', '시위', '통제'];
const PLACES = ['잠실', '고양', '올림픽공원'];

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgelzvzgepqkgfaeogvo.supabase.co';
// Service role bypasses RLS for inserts; falls back to anon (needs an insert policy).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnZWx6dnpnZXBxa2dmYWVvZ3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNjI0MTAsImV4cCI6MjA5NjczODQxMH0.8-F_tOOSV28WezjDANkj8WHsdSdvDwmN4eNanaVpTZA';

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
      const x = r.exec(block);
      return x ? x[1] : '';
    };
    items.push({
      title: decode(get('title')),
      link: decode(get('link')),
      desc: decode(get('description')),
      pub: decode(get('pubDate')),
      source: decode(get('source')),
    });
  }
  return items;
}

function classify(text) {
  const k = ACTIONS.find(a => text.includes(a));
  const p = PLACES.find(a => text.includes(a));
  return k && p ? { k, p } : null;
}

async function maybeEmailAdmin(rows) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_EMAIL;
  if (!apiKey || !to || !rows.length) return false;
  const list = rows.map(r => `• ${r.title}\n  ${r.link}`).join('\n\n');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'odiroga alerts <onboarding@resend.dev>',
        to: [to],
        subject: `🚨 ${rows.length} new safety alert(s) to review`,
        text: `New protest/closure news detected near venues:\n\n${list}\n\nApprove or reject at /admin.`,
      }),
    });
    return r.ok;
  } catch (e) {
    console.warn('email failed:', e?.message || e);
    return false;
  }
}

export default async function handler(req, res) {
  const query = '(집회 OR 시위 OR 통제) (잠실 OR 고양 OR 올림픽공원)';
  const rssUrl = process.env.NEWS_RSS_URL ||
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const feed = await fetch(rssUrl, { headers: { 'User-Agent': 'odiroga-newsbot/1.0' } });
    if (!feed.ok) {
      return res.status(502).json({ error: 'rss_upstream', status: feed.status });
    }
    const xml = await feed.text();
    const items = parseItems(xml);

    // Keep only items that contain BOTH an action keyword AND a place name.
    const matched = [];
    for (const it of items) {
      const hit = classify(`${it.title} ${it.desc}`);
      if (!hit || !it.link) continue;
      let pub_date = null;
      const t = Date.parse(it.pub);
      if (!Number.isNaN(t)) pub_date = new Date(t).toISOString();
      matched.push({
        title: it.title.slice(0, 500),
        link: it.link,
        source: it.source || 'Google News',
        pub_date,
        matched_keyword: hit.k,
        matched_place: hit.p,
        status: 'pending',
      });
    }

    let inserted = 0;
    if (matched.length) {
      // Insert, ignoring rows whose link already exists (unique constraint).
      const r = await fetch(`${SUPABASE_URL}/rest/v1/news_alerts`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation,resolution=ignore-duplicates',
        },
        body: JSON.stringify(matched),
      });
      if (r.ok) {
        const data = await r.json().catch(() => []);
        inserted = Array.isArray(data) ? data.length : 0;
        if (inserted > 0) await maybeEmailAdmin(data);
      } else {
        const detail = await r.text().catch(() => '');
        return res.status(502).json({ error: 'supabase_insert', status: r.status, detail: detail.slice(0, 300), scanned: items.length, matched: matched.length });
      }
    }

    return res.status(200).json({ scanned: items.length, matched: matched.length, inserted });
  } catch (e) {
    return res.status(502).json({ error: 'fetch_failed', message: String(e?.message || e) });
  }
}
