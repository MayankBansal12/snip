/** Only explicit origins are trusted; forwarded headers never set policy. */
export function parsePublicOrigin(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('SNIP_PUBLIC_URL must be an absolute HTTPS origin.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('SNIP_PUBLIC_URL must be an HTTPS origin without a path, credentials, query, or fragment (HTTP is allowed only on loopback).');
  return url.origin;
}
export function acceptsRequest(headers, localOrigin, publicOrigin, websocket = false) {
  // A tunnel may preserve public Host or rewrite it to the loopback upstream.
  const hosts = new Set([new URL(localOrigin).host, new URL(publicOrigin || localOrigin).host]);
  if (!hosts.has(headers.host)) return false;
  // bb connect rewrites a matching share Origin to its loopback upstream,
  // leaving foreign origins unchanged. Accept that exact Host/Origin pair too.
  const matches = headers.origin === (publicOrigin || localOrigin)
    || (headers.host === new URL(localOrigin).host && headers.origin === localOrigin);
  return websocket ? matches : headers.origin === undefined || matches;
}
