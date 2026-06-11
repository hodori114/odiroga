// api/news-alert.js — Naver News RSS keyword detector (protest/closure alerts)
// STATUS: stub. Full implementation lands in Step 7 (네이버 뉴스 RSS 키워드 감지).
// Keywords: 집회 / 시위 / 통제 + place names (잠실, 고양, 올림픽공원).

export default function handler(req, res) {
  res.status(501).json({
    error: 'not_implemented',
    endpoint: 'news-alert',
    message: 'Naver news RSS detector is scaffolded but not yet implemented (Step 7).'
  });
}
