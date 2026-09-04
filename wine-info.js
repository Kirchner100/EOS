const LS_KEY = 'eos.wineinfo.v2';
const MODEL = 'claude-sonnet-4-6';

function cache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function put(key, val) {
  try {
    const c = cache();
    c[key] = val;
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {}
}

export function wineKey(e) {
  return [e.wineName, e.producer, e.vintage].filter(Boolean).join('|').toLowerCase();
}

export function readCached(e) {
  return cache()[wineKey(e)] || null;
}

const FIELDS = `{
 "summary":"",
 "grape":"",
 "place":"",
 "vintage":"",
 "style":["",""],
 "pairing":"",
 "aging":"",
 "priceContext":""
}`;

export async function fetchInfo(entry, key, shared) {
  const k = wineKey(entry);
  const cached = readCached(entry);
  if (cached) return cached;

  // Someone else may have already paid for this one.
  if (shared && shared.get) {
    try {
      const hit = await shared.get(k);
      if (hit && hit.summary) { put(k, hit); return hit; }
    } catch {}
  }

  const desc = [
    `Wine: ${entry.wineName}`,
    entry.producer && `Producer: ${entry.producer}`,
    entry.vintage && `Vintage: ${entry.vintage}`,
    entry.grape && `Grape: ${entry.grape}`,
    entry.region && `Region: ${entry.region}`,
    entry.price && `Price paid: ${entry.currency || ''}${entry.price}`,
  ].filter(Boolean).join('\n');

  const prompt = `${desc}

Write a short primer on this bottle for someone who enjoys wine and sake but knows very little about either. Assume no jargon: if you use a wine or sake word, explain it in the same sentence.

If this is a sake rather than a wine, read the fields accordingly — "grape" will hold a classification such as Junmai Daiginjo, "region" a Japanese prefecture — and write about the classification, the rice and water, and the brewery instead.

Return ONLY this JSON object, no prose, no markdown fence:
${FIELDS}

- summary: 2-3 sentences. What this bottle is, what it tastes like, and why it exists in the form it does.
- grape: 1-2 sentences on the grape variety and what it reliably tastes like. For a sake, the classification instead — what the polishing grade means for the flavour.
- place: 1-2 sentences on the region — climate, soil, why drink from there tastes the way it does. For a sake, the prefecture and its water.
- vintage: one sentence on that growing year in that region, or what the year means for drinking it now. "" if no vintage was given, which is normal for sake.
- style: 3 to 5 very short plain-English descriptors, e.g. "light-bodied", "high acidity", "smells like sour cherry".
- pairing: one sentence — what to eat with it.
- aging: one sentence — whether to drink it now or keep it, and roughly how long. For a sake, whether it wants drinking fresh and how to serve it (chilled, room temperature, warmed).
- priceContext: one sentence on whether the price paid is low, fair or high for this kind of bottle. "" if no price was given.

Be specific and factual about the producer and region where you are confident. Where you are not confident about this exact bottle, describe the category honestly rather than inventing detail about the estate or brewery.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    throw new Error(detail || `Anthropic returned ${res.status}`);
  }

  const body = await res.json();
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No summary came back');

  let o;
  try { o = JSON.parse(text.slice(start, end + 1)); }
  catch { throw new Error('Could not read the summary'); }

  const info = {
    summary: (o.summary || '').trim(),
    grape: (o.grape || '').trim(),
    place: (o.place || '').trim(),
    vintage: (o.vintage || '').trim(),
    style: Array.isArray(o.style) ? o.style.map(s => String(s).trim()).filter(Boolean).slice(0, 5) : [],
    pairing: (o.pairing || '').trim(),
    aging: (o.aging || '').trim(),
    priceContext: (o.priceContext || '').trim(),
  };
  if (!info.summary) throw new Error('No summary came back');
  put(k, info);
  if (shared && shared.put) { try { await shared.put(k, info); } catch {} }
  return info;
}

// Merge primers written on the other phone into this device's cache.
export function mergeCache(map) {
  if (!map) return cache();
  try {
    const c = cache();
    Object.keys(map).forEach(k => { if (!c[k] && map[k]) c[k] = map[k]; });
    localStorage.setItem(LS_KEY, JSON.stringify(c));
    return c;
  } catch { return cache(); }
}
