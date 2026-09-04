// Eos data layer — Supabase with a localStorage fallback.
// Nothing here is Eos-specific UI; it only moves journal entries around.

const LS_ENTRIES = 'eos.entries.v1';
const LS_CONFIG = 'eos.supabase.v1';
const CDN = 'https://esm.sh/@supabase/supabase-js@2';
// Table name — change here if you rename the table in Supabase.
export const TABLE = 'wine_entries_v2';
// Shared cache of Claude-written wine primers, so a lookup is paid for once.
export const INFO_TABLE = 'wine_info_v1';

let client = null;

export function readConfig() {
  try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || { url: '', key: '' }; }
  catch { return { url: '', key: '' }; }
}

export function writeConfig(url, key) {
  localStorage.setItem(LS_CONFIG, JSON.stringify({ url: url.trim(), key: key.trim() }));
}

export function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_ENTRIES)) || null; }
  catch { return null; }
}

export function writeLocal(entries) {
  localStorage.setItem(LS_ENTRIES, JSON.stringify(entries));
}

const toRow = e => ({
  id: e.id && /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : undefined,
  user_name: e.user, date: e.date, wine_name: e.wineName, producer: e.producer || null,
  vintage: e.vintage || null, grape: e.grape || null, region: e.region || null,
  serving: e.serving || null, price: e.price ?? null, currency: e.currency || null,
  rating: e.rating ?? null, notes: e.notes || null, restaurant: e.restaurant || null,
  noted_from: e.notedFrom || null,
});

const fromRow = r => ({
  id: r.id, user: r.user_name, date: r.date, wineName: r.wine_name, producer: r.producer || '',
  vintage: r.vintage || '', grape: r.grape || '', region: r.region || '', serving: r.serving || '',
  price: r.price ?? 0, currency: r.currency || '', rating: r.rating, notes: r.notes || '',
  restaurant: r.restaurant || '', notedFrom: r.noted_from || '',
});

export async function connect(url, key) {
  const { createClient } = await import(CDN);
  client = createClient(url, key);
  const { error } = await client.from(TABLE).select('id').limit(1);
  if (error) { client = null; throw error; }
  return true;
}

export function isConnected() { return !!client; }

export async function fetchEntries() {
  if (!client) throw new Error('not connected');
  const { data, error } = await client.from(TABLE)
    .select('*').order('date', { ascending: false });
  if (error) throw error;
  return data.map(fromRow);
}

export async function saveEntry(entry) {
  if (!client) throw new Error('not connected');
  const { data, error } = await client.from(TABLE)
    .insert(toRow(entry)).select().single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteEntry(id) {
  if (!client) throw new Error('not connected');
  const { error } = await client.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

// Push everything held locally that isn't a server row yet (one-time migration).
export async function pushLocal(entries) {
  if (!client) throw new Error('not connected');
  const rows = entries.filter(e => !/^[0-9a-f-]{36}$/i.test(e.id)).map(toRow);
  if (!rows.length) return 0;
  const { error } = await client.from(TABLE).insert(rows);
  if (error) throw error;
  return rows.length;
}

// --- Shared wine primers ---------------------------------------------------

export async function fetchInfo(key) {
  if (!client) return null;
  const { data, error } = await client.from(INFO_TABLE)
    .select('info').eq('wine_key', key).maybeSingle();
  if (error || !data) return null;
  return data.info || null;
}

export async function fetchAllInfo() {
  if (!client) return {};
  const { data, error } = await client.from(INFO_TABLE).select('wine_key,info');
  if (error || !data) return {};
  const out = {};
  data.forEach(r => { if (r.info) out[r.wine_key] = r.info; });
  return out;
}

export async function saveInfo(key, info) {
  if (!client) return false;
  const { error } = await client.from(INFO_TABLE)
    .upsert({ wine_key: key, info }, { onConflict: 'wine_key' });
  return !error;
}

// Live updates from the other person's phone.
export function subscribe(onChange) {
  if (!client) return () => {};
  const ch = client.channel(TABLE)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onChange)
    .subscribe();
  return () => client.removeChannel(ch);
}
