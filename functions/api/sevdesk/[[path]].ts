// Server-side Proxy zur sevDesk-API. Hält den SEVDESK_TOKEN geheim
// (würde im Frontend leaken). Erlaubte Endpunkte: Contact-Anlage,
// Order-Anlage/-Update, Order/Factory/saveOrder, OrderPos. Methoden:
// GET / POST / PUT. Andere Pfade/Methoden werden mit 403 abgewiesen.

export interface Env {
  SEVDESK_TOKEN?: string;
}

const SEVDESK_BASE = 'https://my.sevdesk.de/api/v1';

// Pfad-Allowlist (das, was die App tatsächlich braucht)
const ALLOWED_PREFIXES = [
  'Contact',
  'ContactAddress',
  'Order',
  'OrderPos',
  'Part',
  'Unity',
];

function isAllowed(path: string): boolean {
  return ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'),
  );
}

type Ctx = { request: Request; env: Env; params: { path?: string | string[] } };
export const onRequest = async ({ request, params, env }: Ctx) => {
  if (!env.SEVDESK_TOKEN) {
    return new Response(JSON.stringify({ error: 'SEVDESK_TOKEN missing in env' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const raw = params.path;
  const pathArr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = pathArr.join('/');
  if (!isAllowed(path)) {
    return new Response(JSON.stringify({ error: 'path not allowed: ' + path }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
  }
  const incomingUrl = new URL(request.url);
  const upstream = SEVDESK_BASE + '/' + path + incomingUrl.search;

  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return new Response('method not allowed', { status: 405 });
  }

  const headers: Record<string, string> = {
    Authorization: env.SEVDESK_TOKEN,
    Accept: 'application/json',
  };
  let body: BodyInit | undefined;
  if (method !== 'GET') {
    body = await request.text();
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  const resp = await fetch(upstream, { method, headers, body });
  const respBody = await resp.text();
  return new Response(respBody, {
    status: resp.status,
    headers: {
      'content-type': resp.headers.get('content-type') ?? 'application/json',
    },
  });
};
