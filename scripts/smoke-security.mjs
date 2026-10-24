// Read-only post-deployment checks. Never print backend responses or credentials.
const origin = 'https://sageproject.xyz';
let failed = false;
async function check(name, run) {
  try { if (!await run()) throw new Error(); console.log(`PASS ${name}`); }
  catch { failed = true; console.log(`FAIL ${name}`); }
}
const request = (url, options={}) => fetch(url, {...options, signal:AbortSignal.timeout(15000)});
for (const path of ['/', '/admin/', '/morning-report/']) {
  await check(`HTTPS route ${path}`, async () => {
    const r = await request(origin+path,{method:'HEAD',redirect:'manual'});
    return r.ok || (r.status >= 300 && r.status < 400 && new URL(r.headers.get('location'),origin).protocol === 'https:');
  });
  await check(`HTTP redirects to HTTPS ${path}`, async () => {
    const r = await request('http://sageproject.xyz'+path,{method:'HEAD',redirect:'manual'});
    const next = new URL(r.headers.get('location') || '',origin);
    return [301,302,307,308].includes(r.status) && next.protocol === 'https:' && next.hostname === 'sageproject.xyz' && next.pathname === path;
  });
}
await check('anonymous faculty API is protected', async () => {
  const r = await request(origin+'/assessment-api/admin',{redirect:'manual'});
  if ([401,403].includes(r.status)) return true;
  const location = r.headers.get('location') || '';
  return [302,303].includes(r.status) && /\/cdn-cgi\/access\/|\.cloudflareaccess\.com\//.test(location);
});
for (const [name, variable, denied] of [
  ['Morning Report','SAGE_MR_ENDPOINT','denied'],
  ['assessment collector','SAGE_ASSESSMENT_ENDPOINT','unauthorized'],
]) {
  const endpoint = process.env[variable];
  if (!endpoint) { console.log(`SKIP direct ${name}: set ${variable} locally`); continue; }
  await check(`direct ${name} denies anonymous access`, async () => {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    url.search = '';
    const r = await request(url);
    return r.ok && (await r.json()).status === denied;
  });
}
process.exitCode = failed ? 1 : 0;
