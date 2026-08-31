// A bottle's taste fingerprint, written by Claude the moment it is logged, so
// that every later recommendation has something concrete to compare against.
// Fingerprints are facts about a bottle, not about a person, so they are cached
// locally and shared between both phones under a 'taste:' key.

const LS_KEY = 'eos.taste.v1';
const MODEL = 'claude-sonnet-4-6';

export function tasteKey(e) {
  return [e.wineName, e.producer, e.vintage].filter(Boolean).join('|').toLowerCase();
}

export function readAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function put(k, v) {
  try { const c = readAll(); c[k] = v; localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

export function mergeCache(map) {
  if (!map) return readAll();
  try {
    const c = readAll();
    Object.keys(map).forEach(k => {
      const m = /^taste:(.*)$/.exec(k);
      if (m && !c[m[1]]) c[m[1]] = map[k];
    });
    localStorage.setItem(LS_KEY, JSON.stringify(c));
    return c;
  } catch { return readAll(); }
}

const SHAPE = `{
 "family":"",
 "body":"light"|"medium"|"full",
 "acidity":"low"|"medium"|"high",
 "tannin":"none"|"low"|"medium"|"high",
 "sweetness":"dry"|"off-dry"|"sweet",
 "oak":"none"|"subtle"|"pronounced",
 "descriptors":["",""],
 "likeIf":""
}`;

// One compact fingerprint for one bottle.
export async function fingerprint(entry, key, shared) {
  const k = tasteKey(entry);
  const have = readAll()[k];
  if (have) return have;

  if (shared && shared.get) {
    try { const hit = await shared.get('taste:' + k); if (hit && hit.family) { put(k, hit); return hit; } } catch {}
  }

  const desc = [
    `Wine or sake: ${entry.wineName}`,
    entry.producer && `Producer: ${entry.producer}`,
    entry.vintage && `Vintage: ${entry.vintage}`,
    entry.grape && `Grape or classification: ${entry.grape}`,
    entry.region && `Region: ${entry.region}`,
  ].filter(Boolean).join('\n');

  const prompt = `${desc}

Describe this bottle's taste as a compact structured fingerprint, so it can be compared against other bottles later. Judge from the grape, classification and region where the exact bottle is unknown to you — describe the category honestly rather than inventing estate detail.

Return ONLY this JSON object, no prose, no markdown fence:
${SHAPE}

- family: a short style family, e.g. "high-acid coastal white", "structured nebbiolo-type red", "aromatic junmai ginjo".
- descriptors: 3 to 5 short plain-English flavour or texture notes, e.g. "sour cherry", "saline", "grippy".
- likeIf: one short clause completing "someone who likes this also tends to like…".
For sake, read acidity and body normally, set tannin "none" and oak "none", and use the polishing grade in family.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic returned ${res.status}`);

  const body = await res.json();
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('No fingerprint came back');
  const o = JSON.parse(text.slice(a, b + 1));

  const fp = {
    family: (o.family || '').trim(),
    body: (o.body || '').trim(),
    acidity: (o.acidity || '').trim(),
    tannin: (o.tannin || '').trim(),
    sweetness: (o.sweetness || '').trim(),
    oak: (o.oak || '').trim(),
    descriptors: Array.isArray(o.descriptors) ? o.descriptors.map(String).slice(0, 5) : [],
    likeIf: (o.likeIf || '').trim(),
  };
  put(k, fp);
  if (shared && shared.put) { try { await shared.put('taste:' + k, fp); } catch {} }
  return fp;
}

// Everything Eos knows about a palate, as text for the recommender prompt.
export function brief(entries, fps, profile) {
  const mine = (entries || []).filter(e =>
    e.rating != null && (profile === 'Both' || e.user === profile || e.user === 'Both'));
  if (!mine.length) {
    return { empty: true, text: 'No bottles have been rated yet. There is no taste history to compare against.' };
  }

  const sorted = mine.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const lines = sorted.slice(0, 30).map(e => {
    const fp = (fps || {})[tasteKey(e)];
    const bits = [
      `${e.rating}/5`,
      [e.grape, e.region].filter(Boolean).join(' · ') || e.wineName,
      [e.producer, e.vintage].filter(Boolean).join(' '),
      e.date,
    ].filter(Boolean).join(' | ');
    const taste = fp
      ? ` → ${[fp.family, fp.body && fp.body + '-bodied', fp.acidity && fp.acidity + ' acidity',
          fp.tannin && fp.tannin + ' tannin', fp.oak && fp.oak + ' oak'].filter(Boolean).join(', ')}${
          fp.descriptors.length ? '; ' + fp.descriptors.join(', ') : ''}`
      : '';
    return `- ${bits}${taste}`;
  });

  // Aggregate grape × region, weighted by rating and recency.
  const now = Date.now(), bag = {};
  mine.forEach(e => {
    const label = [e.grape, e.region].filter(Boolean).join(' · ');
    if (!label) return;
    const months = Math.max(0, (now - new Date(e.date + 'T12:00:00').getTime()) / 2.63e9);
    const w = 1 / (1 + months / 18);
    const b = bag[label] || (bag[label] = { w: 0, sum: 0, n: 0 });
    b.w += w; b.sum += e.rating * w; b.n++;
  });
  const ranked = Object.keys(bag).map(l => ({ l, s: bag[l].sum / bag[l].w, n: bag[l].n }))
    .sort((a, b) => b.s - a.s);
  const fmt = a => a.map(r => `${r.l} (${r.s.toFixed(1)} over ${r.n})`).join('; ');
  const best = ranked.filter(r => r.s >= 3.5).slice(0, 6);
  const worst = ranked.filter(r => r.s <= 2.5).slice(-4);

  const text = [
    `Bottles rated: ${mine.length}.`,
    best.length ? `Best-scoring grape × region: ${fmt(best)}` : '',
    worst.length ? `Worst-scoring: ${fmt(worst)}` : '',
    '',
    'Every rated bottle, newest first:',
    ...lines,
  ].filter(Boolean).join('\n');

  return { empty: false, text };
}
