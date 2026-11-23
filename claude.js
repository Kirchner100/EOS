// One door to the Anthropic Messages API.
// With the user's own key: straight to Anthropic from the browser.
// With SHARED: through the Eos edge function, which holds the key and checks the
// caller's invite allows it.

export const SHARED = 'shared';
let proxy = null;

// { url, anon, token: async () => accessToken }
export function setProxy(p) { proxy = p; }

export async function claudeFetch(key, init) {
  if (key === SHARED) {
    if (!proxy) throw new Error('Sign in again to use the shared key.');
    const token = await proxy.token();
    return fetch(proxy.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, apikey: proxy.anon },
      body: init.body,
    });
  }
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: init.body,
  });
}
