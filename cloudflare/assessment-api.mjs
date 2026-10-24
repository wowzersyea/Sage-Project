import { createRemoteJWKSet, jwtVerify } from 'jose';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}
});
let jwks, issuer;

async function readSubmission(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200000) {
        await reader.cancel();
        throw new RangeError('Submission too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.ASSESSMENT_ENDPOINT || !env.ASSESSMENT_WRITE_KEY || !env.ASSESSMENT_ADMIN_KEY) {
      return json({status: 'error', message: 'Assessment service is not configured.'}, 503);
    }
    try {
      if (url.pathname === '/assessment-api/admin' && request.method === 'GET') {
        if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return json({status: 'unauthorized'}, 503);
        if (issuer !== env.ACCESS_TEAM_DOMAIN) {
          issuer = env.ACCESS_TEAM_DOMAIN;
          jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
        }
        try {
          const {payload} = await jwtVerify(request.headers.get('Cf-Access-Jwt-Assertion') || '', jwks,
            {issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'email', 'sub']});
          if (typeof payload.email !== 'string' || !payload.email || typeof payload.sub !== 'string' || !payload.sub) return json({status: 'unauthorized'}, 401);
        } catch { return json({status: 'unauthorized'}, 401); }
        const target = new URL(env.ASSESSMENT_ENDPOINT);
        target.searchParams.set('key', env.ASSESSMENT_ADMIN_KEY);
        const response = await fetch(target, {signal: AbortSignal.timeout(20000)});
        const body = await response.json();
        const ok = response.ok && body?.status === 'ok' && Array.isArray(body.submissions);
        console.info(JSON.stringify({event: 'assessment_admin_read', outcome: ok ? 'ok' : 'upstream_failed'}));
        return ok ? json({status: 'ok', submissions: body.submissions, count: body.submissions.length}) :
          json({status: 'error', message: 'Assessment results are unavailable.'}, 502);
      }
      if (url.pathname !== '/assessment-api/submit' || request.method !== 'POST') return json({status: 'error'}, 405);
      if (request.headers.get('Origin') !== url.origin) return json({status: 'error'}, 403);
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({status: 'error'}, 415);
      if (!env.SUBMISSION_LIMITER) return json({status: 'error', message: 'Submission limits are not configured.'}, 503);
      const limit = await env.SUBMISSION_LIMITER.limit({key: request.headers.get('CF-Connecting-IP') || 'unknown'});
      if (!limit.success) return json({status: 'error', message: 'Too many submissions. Please try again later.'}, 429);
      if (Number(request.headers.get('Content-Length')) > 200000) return json({status: 'error'}, 413);
      let data;
      try { data = await readSubmission(request); }
      catch (error) { return json({status: 'error', message: 'Invalid submission JSON or size.'}, error instanceof RangeError ? 413 : 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json({status: 'error'}, 400);
      if (typeof data.submissionId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(data.submissionId)) return json({status: 'error'}, 400);
      const response = await fetch(env.ASSESSMENT_ENDPOINT, {
        method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({...data, writeKey: env.ASSESSMENT_WRITE_KEY}), signal: AbortSignal.timeout(20000)
      });
      const body = await response.json();
      const ok = response.ok && body?.status === 'ok' && body.submissionId === data.submissionId;
      console.info(JSON.stringify({event: 'assessment_submission', outcome: ok ? 'ok' : 'upstream_failed'}));
      return ok ? json({status: 'ok', submissionId: data.submissionId}) :
        json({status: 'error', message: 'The assessment service could not confirm your submission.'}, 502);
    } catch {
      return json({status: 'error', message: 'The assessment service could not confirm your submission.'}, 502);
    }
  }
};
