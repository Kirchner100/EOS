// Picks tonight's bottles from a parsed list, judged against the taste history
// Eos has accumulated. With no history yet it says so and picks on merit.

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are a sommelier who knows two regular guests well and has their full drinking record in front of you. You recommend from the list actually in front of them, never from wines that are not on it. You are candid: if the list is weak, or nothing on it matches what they like, you say so.`;

export async function pickWines({ wines, palate, note, budget, occasion, profile, count = 3 }, key) {
  const list = wines.map((w, i) => {
    const bits = [w.name, w.producer, w.vintage, w.grape, w.region, w.serving, w.price]
      .filter(Boolean).join(' | ');
    return `${i}. ${bits}`;
  }).join('\n');

  const who = profile === 'Both' ? 'the two of them together' : profile;

  const prompt = `THE LIST IN FRONT OF THEM (index. name | producer | vintage | grape | region | serving | price)
${list}

WHO IS DRINKING: ${who}

WHAT THEY HAVE DRUNK AND HOW THEY RATED IT
${palate.text}
${note ? `\nTHEIR OWN STANDING INSTRUCTIONS (these override your judgement)\n${note}` : ''}
${budget ? `\nBUDGET: ${budget}` : ''}${occasion ? `\nOCCASION: ${occasion}` : ''}

Task, in this order:
1. Read the list and work out which bottles are genuinely good — quality, typicity, and value for the price asked.
2. Compare those against the drinking record above: which grapes, regions and styles have scored well, which have scored badly.
3. Choose ${count} bottles. Rank them best first. Vary them: do not pick three near-identical wines.

Return ONLY a JSON array of ${count} objects, no prose, no markdown fence:
[{"index":0,"match":"","kind":"loved"|"new"|"crowd"|"wish","reason":""}]

- index: the number of the wine from the list above. Never invent an index.
- match: a 2-4 word label for why it is here, e.g. "Straight down the line", "One step sideways", "Best value here".
- kind: "loved" if it closely matches a style they have rated 4+; "new" if it is a deliberate stretch into something unrated; "crowd" if it is the safe choice for mixed company; "wish" if it is the most interesting bottle on the list regardless of their record.
- reason: 1-2 sentences. Name the specific past bottle or grape × region and its score when you are leaning on their record — "you gave Assyrtiko from Santorini a 4.8 last March, and this is the same grape from the same island". ${palate.empty ? 'THERE IS NO RECORD YET: say plainly that this is a first pick with nothing to go on, and justify it on the wine itself. Never imply you know their preferences.' : 'Do not invent a rating or a bottle that is not in the record above.'}
- If the whole list is poor for them, still return ${count} bottles but say so honestly in the reasons.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000, system: SYSTEM,
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
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a === -1 || b === -1) throw new Error('No recommendation came back');

  let rows;
  try { rows = JSON.parse(text.slice(a, b + 1)); }
  catch { throw new Error('Could not read the recommendation'); }

  return rows
    .filter(r => r && wines[r.index])
    .map(r => ({
      wine: wines[r.index],
      index: r.index,
      match: (r.match || 'Tonight\u2019s pick').trim(),
      kind: ['loved', 'new', 'crowd', 'wish'].includes(r.kind) ? r.kind : 'new',
      reason: (r.reason || '').trim(),
    }))
    .slice(0, count);
}

// Used when there is no key, or the call fails: rank by what the record already
// says, with no invented reasoning.
export function localPicks(wines, taste, count = 3) {
  const score = w => {
    const label = [w.grape, w.region].filter(Boolean).join(' · ');
    const hit = taste.find(t => t.label === label)
      || taste.find(t => w.grape && t.label.startsWith(w.grape));
    return hit ? +hit.score : 0;
  };
  return wines.map((w, i) => ({ w, i, s: score(w) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map(({ w, i, s }) => ({
      wine: w, index: i,
      match: s ? 'Matches your record' : 'Worth a look',
      kind: s >= 4 ? 'loved' : 'new',
      reason: s
        ? `${[w.grape, w.region].filter(Boolean).join(' from ')} has averaged ${s.toFixed(1)} in your history.`
        : 'Nothing in your record covers this one \u2014 picked on the list itself.',
    }));
}
