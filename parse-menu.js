// Menu photo → structured wine list, via the Anthropic Messages API called
// directly from the browser with a user-supplied key.

const LS_KEY = 'eos.anthropic.v1';
const MODEL = 'claude-sonnet-4-6';

export function readKey() { return localStorage.getItem(LS_KEY) || ''; }
export function writeKey(k) { localStorage.setItem(LS_KEY, (k || '').trim()); }

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Could not read that photo'));
    fr.readAsDataURL(file);
  });
}

const SYSTEM = `You are a sommelier's assistant reading a restaurant drinks list from photographs taken at the table. The photos are often poorly lit, shot at an angle, partly in shadow, and the list may be in Greek, Italian, French, Spanish, German or Japanese. Your only job is to transcribe what is printed into structured data. You transcribe; you do not embellish, translate, correct or invent.`;

const PROMPT = `These photos are consecutive pages of ONE restaurant wine or sake list. Read every wine and every sake on every page.

Work in this order before you answer:
1. Identify the page structure — section headings, sub-headings, and which column holds prices. Lists are usually grouped by colour (white/red/rosé/sparkling/dessert), then by country, region or grape. Sake lists group by classification or prefecture.
2. Note any by-the-glass section or glass-price column.
3. Then transcribe each wine row.

Return ONLY a JSON array, no prose, no markdown fence. One object per wine:
{"name":"","producer":"","vintage":"","grape":"","region":"","serving":"Bottle"|"Glass","price":"","currency":""}

FIELDS
- name — the wine as printed, but transliterated into the Latin alphabet if the list is in another script (see LANGUAGE AND SCRIPT). Do not append the producer or the vintage to it.
- producer — the estate, domaine, winery or grower, when printed separately from the wine name. If the row is just "Ktima Gerovassiliou Malagousia", producer is "Ktima Gerovassiliou" and name is "Malagousia". If you cannot tell which part is the producer, put the whole row in name and leave producer "".
- vintage — a 4-digit year, or "NV" for non-vintage (common on sparkling), else "".
- grape — only if printed or inheritable from a heading. Do not deduce it from your own knowledge of the wine: a Chablis under a "Burgundy" heading has grape "" unless "Chardonnay" appears on the page.
- region — the most specific printed place: appellation, then region, then country. "Chablis 1er Cru" under a "France · Burgundy" heading gives region "Chablis".
- serving — "Glass" if the wine sits in a by-the-glass section, or has a price in a glass column, else "Bottle".
- price — printed digits only, no symbol, no thousands separator ("58", "120", "9.5").
- currency — the symbol or code as printed ("€", "$", "£", "CHF"). If prices are bare numbers with no symbol anywhere on the page, use "".

LANGUAGE AND SCRIPT
- The finished JSON must be readable by an English speaker. Every value goes out in the Latin alphabet — never Greek, Cyrillic, Japanese, Chinese, Korean, Hebrew or Arabic script.
- name and producer are TRANSLITERATED, not translated: write the sound of the printed name in Latin letters, using the estate's own established romanisation where you know it. "Κτῆμα Γεροβασίλειου" becomes "Ktima Gerovassiliou", not "Gerovassiliou Estate". Keep a descriptive word that is part of the name in transliteration too.
- grape and region are TRANSLATED to their standard English names: "Ασύρτικο" becomes "Assyrtiko", "Νεμέα" becomes "Nemea", "Αγιωργίτικο" becomes "Agiorgitiko". Use the name the wine is known by in English where one exists.
- Headings you read for inheritance are translated the same way before you use them.
- Digits printed in another numeral system are converted to Arabic numerals.

INHERITANCE
- A wine inherits grape and region from the nearest heading above it, and from any heading above that one. Under "GREECE" → "Santorini" → "Assyrtiko", a wine gets region "Santorini" and grape "Assyrtiko".
- Inheritance stops at the next heading of the same level, and does not cross a colour change (a "REDS" heading resets the whites above it).
- A heading continued on the next page still applies to the wines beneath it.

SPLITS AND DUPLICATES
- One wine offered in two formats (glass and bottle, or 375ml and 750ml) becomes TWO objects: one "Glass" with the glass price, one "Bottle" with the bottle price.
- One wine listed in two vintages becomes two objects.
- If the same wine appears twice because a page overlaps with the next photo, output it once.
- Keep the printed order, page by page.

EXCLUDE
- Anything that is not wine or sake: beer, cider, cocktails, spirits, digestifs, soft drinks, water, coffee.
- Section headings, prices-by-the-carafe notes, service-charge lines, food items, and any marketing prose.
- Include fortified wine (port, sherry, madeira, vin santo, mavrodaphne) and sake. Exclude shochu, umeshu and other spirits.

SAKE
- Sake belongs in the list. Map its fields as follows: name is the sake's name as printed (romaji or Japanese script, as printed); producer is the brewery or kura; vintage is "" unless a year is printed; grape is the classification when printed — Junmai, Junmai Ginjo, Junmai Daiginjo, Ginjo, Daiginjo, Honjozo, Nigori, Namazake; region is the prefecture when printed (Niigata, Hyogo, Yamagata).
- Sake is often sold in 180ml (ichigo), 300ml, 720ml and 1.8L formats. Treat 180ml and 300ml as "Glass" and 720ml and larger as "Bottle", and split a sake offered in both into two objects as with wine.

WHEN THE PHOTO IS BAD
- Transcribe what you can read and leave unreadable fields as "". A wine with only a name and a price is a useful row; a wine with a guessed producer is not.
- Never invent a vintage, a price, or a producer to fill a gap. "" is the correct answer.
- If a character is ambiguous (0/O, 1/7, 5/6) and the field is a price or vintage, prefer the reading that is plausible for a wine list, and if both are plausible, leave it "".
- If a photo contains no drinks list at all, contribute nothing from it. If none of the photos do, return [].`;

export async function parsePhotos(dataUrls, key) {
  const images = dataUrls.map(u => {
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(u);
    if (!m) throw new Error('Unsupported image format');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });

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
      max_tokens: 8000,
      system: SYSTEM,
      messages: [
        { role: 'user', content: [...images, { type: 'text', text: PROMPT }] },
      ],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    throw new Error(detail || `Anthropic returned ${res.status}`);
  }

  const body = await res.json();
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('The model did not return a wine list');

  let rows;
  try { rows = JSON.parse(text.slice(start, end + 1)); }
  catch { throw new Error('Could not read the parsed list'); }

  return rows.filter(r => r && r.name).map(r => ({
    name: String(r.name).trim(),
    producer: (r.producer || '').trim(),
    vintage: (r.vintage || '').toString().trim(),
    grape: (r.grape || '').trim(),
    region: (r.region || '').trim(),
    serving: r.serving === 'Glass' ? 'Glass' : 'Bottle',
    price: r.price ? `${(r.currency || '').trim()}${String(r.price).trim()}` : '',
  }));
}
