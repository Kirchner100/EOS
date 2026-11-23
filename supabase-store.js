// Eos data layer — Supabase Auth + per-account tables, with a localStorage cache.
// Row-level security in the database decides what each account can see; this file
// never filters by user itself, so linking accounts into a household later is a
// policy change, not a code change.

const LS_ENTRIES = 'eos.entries.v1';
const LS_OWNER = 'eos.entries.owner';
const LS_CONFIG = 'eos.supabase.v1';
const PERSONAL = [LS_ENTRIES, LS_OWNER, 'eos.anthropic.v1', 'eos.notes.v1', 'eos.wineinfo.v2', 'eos.taste.v1'];
const CDN = 'https://esm.sh/@supabase/supabase-js@2';

export const TABLE = 'wine_entries_v2';
export const INFO_TABLE = 'wine_info_v2';
const DEFAULT_URL = 'https://hfzgnfdoyehoheiuimac.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmemduZmRveWVob2hlaXVpbWFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMDI4ODUsImV4cCI6MjEwMzY3ODg4NX0.LqZSkb2NCTTi1wRn2lgN0mx44gG5zM8-yyHULtUa5DE';

let client = null;
let user = null;

export function config() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CONFIG));
    if (c && c.url && c.key) return c;
  } catch {}
  return { url: DEFAULT_URL, key: DEFAULT_KEY };
}

// Local cache is stamped with its owner so one account never inherits another's.
export function readLocal(uid) {
  try {
    const owner = localStorage.getItem(LS_OWNER);
    if (owner && uid && owner !== uid) return null;
    return JSON.parse(localStorage.getItem(LS_ENTRIES)) || null;
  } catch { return null; }
}

export function writeLocal(entries) {
  localStorage.setItem(LS_ENTRIES, JSON.stringify(entries));
  if (user) localStorage.setItem(LS_OWNER, user.id);
}

export function clearLocal() {
  PERSONAL.forEach(k => { try { localStorage.removeItem(k); } catch {} });
}

const isUuid = x => /^[0-9a-f-]{36}$/i.test(x || '');

const toRow = e => ({
  id: isUuid(e.id) ? e.id : undefined,
  owner_id: user ? user.id : undefined,
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

// Supabase's messages, in plain English.
function friendly(err) {
  const m = (err && err.message) || '';
  if (/database error saving new user/i.test(m)) return new Error('That invite code is not valid, or it has already been used.');
  if (/invalid login credentials/i.test(m)) return new Error('That email and password do not match an account.');
  if (/email not confirmed/i.test(m)) return new Error('Confirm your email first. The link is in your inbox.');
  if (/already registered/i.test(m)) return new Error('That email already has an account. Sign in instead.');
  if (/rate limit/i.test(m)) return new Error('Too many emails sent just now. Wait a few minutes and try again.');
  return new Error(m || 'Something went wrong. Try again.');
}

// --- Auth ------------------------------------------------------------------

export async function init() {
  if (client) return client;
  const { url, key } = config();
  const { createClient } = await import(CDN);
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export async function currentSession() {
  await init();
  const { data } = await client.auth.getSession();
  user = data.session ? data.session.user : null;
  return data.session;
}

export function onAuth(cb) {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((ev, session) => {
    user = session ? session.user : null;
    cb(ev, session);
  });
  return () => data.subscription.unsubscribe();
}

const here = () => location.origin + location.pathname;

export async function signIn(email, password) {
  await init();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw friendly(error);
  user = data.user;
  return data;
}

// The invite code travels in user metadata; a database trigger checks it and
// refuses the signup if it is wrong or used up.
export async function signUp({ email, password, name, invite }) {
  await init();
  const { data, error } = await client.auth.signUp({
    email, password, options: { data: { name, invite }, emailRedirectTo: here() },
  });
  if (error) throw friendly(error);
  if (data.session) user = data.user;
  return { confirm: !data.session };
}

export async function resetPassword(email) {
  await init();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: here() });
  if (error) throw friendly(error);
}

export async function setPassword(password) {
  const { data, error } = await client.auth.updateUser({ password });
  if (error) throw friendly(error);
  user = data.user;
}

export async function signOut() {
  if (client) await client.auth.signOut();
  user = null;
}

export async function accessToken() {
  const { data } = await client.auth.getSession();
  return data.session ? data.session.access_token : '';
}

export function me() { return user; }
export function isConnected() { return !!(client && user); }

export async function fetchProfile() {
  if (!user) return null;
  const { data, error } = await client.from('profiles')
    .select('id,display_name,household_id,shared_key').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

// --- Entries ---------------------------------------------------------------

export async function fetchEntries() {
  if (!isConnected()) throw new Error('not signed in');
  const { data, error } = await client.from(TABLE)
    .select('*').order('date', { ascending: false });
  if (error) throw error;
  return data.map(fromRow);
}

export async function saveEntry(entry) {
  if (!isConnected()) throw new Error('not signed in');
  const { data, error } = await client.from(TABLE)
    .insert(toRow(entry)).select().single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateEntry(entry) {
  if (!isConnected()) throw new Error('not signed in');
  const row = toRow(entry); delete row.id; delete row.owner_id;
  const { data, error } = await client.from(TABLE)
    .update(row).eq('id', entry.id).select().single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteEntry(id) {
  if (!isConnected()) throw new Error('not signed in');
  const { error } = await client.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

// Entries made on this phone while offline, sent up once signed in.
export async function pushLocal(entries) {
  if (!isConnected()) throw new Error('not signed in');
  const rows = entries.filter(e => !isUuid(e.id)).map(toRow);
  if (!rows.length) return 0;
  const { error } = await client.from(TABLE).insert(rows);
  if (error) throw error;
  return rows.length;
}

// --- Primers, reviews, fingerprints (private per account) -------------------

export async function fetchInfo(key) {
  if (!isConnected()) return null;
  const { data, error } = await client.from(INFO_TABLE)
    .select('info').eq('wine_key', key).maybeSingle();
  if (error || !data) return null;
  return data.info || null;
}

export async function fetchAllInfo() {
  if (!isConnected()) return {};
  const { data, error } = await client.from(INFO_TABLE).select('wine_key,info');
  if (error || !data) return {};
  const out = {};
  data.forEach(r => { if (r.info) out[r.wine_key] = r.info; });
  return out;
}

export async function saveInfo(key, info) {
  if (!isConnected()) return false;
  const { error } = await client.from(INFO_TABLE)
    .upsert({ owner_id: user.id, wine_key: key, info }, { onConflict: 'owner_id,wine_key' });
  return !error;
}

// Live updates from this account's other devices.
export function subscribe(onChange) {
  if (!isConnected()) return () => {};
  const ch = client.channel(TABLE + ':' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'owner_id=eq.' + user.id }, onChange)
    .subscribe();
  return () => client.removeChannel(ch);
}
