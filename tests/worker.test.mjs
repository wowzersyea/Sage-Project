import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/assessment-api.mjs';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';

const submissionId = 'test-submission-00001';
const serviceEnv = () => ({ASSESSMENT_ENDPOINT: 'https://endpoint.test', ASSESSMENT_WRITE_KEY: 'write', ASSESSMENT_ADMIN_KEY: 'read',
    SUBMISSION_LIMITER: {limit: async () => ({success: true})}});
const submission = (body = {submissionId}, headers = {}) => new Request('https://sageproject.xyz/assessment-api/submit', {
    method: 'POST', headers: {Origin: 'https://sageproject.xyz', 'Content-Type': 'application/json', ...headers},
    body: typeof body === 'string' ? body : JSON.stringify(body)
});
test('assessment proxy fails closed when unconfigured or unauthenticated', async () => {
    assert.equal((await worker.fetch(new Request('https://sageproject.xyz/assessment-api/admin'), {})).status, 503);
    const env = {ASSESSMENT_ENDPOINT: 'https://endpoint.test', ASSESSMENT_WRITE_KEY: 'write', ASSESSMENT_ADMIN_KEY: 'read', ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud'};
    assert.equal((await worker.fetch(new Request('https://sageproject.xyz/assessment-api/admin'), env)).status, 401);
    const request = new Request('https://sageproject.xyz/assessment-api/submit', {method: 'POST', body: '{}'});
    assert.equal((await worker.fetch(request, env)).status, 403);
});
test('assessment proxy supplies server credentials and propagates a failed save', async () => {
    const original = globalThis.fetch;
    const env = {ASSESSMENT_ENDPOINT: 'https://endpoint.test', ASSESSMENT_WRITE_KEY: 'write', ASSESSMENT_ADMIN_KEY: 'read', SUBMISSION_LIMITER: {limit: async () => ({success: true})}};
    try {
        globalThis.fetch = async (url, init) => {
            assert.equal(JSON.parse(init.body).writeKey, 'write');
            return Response.json({status: 'error'});
        };
        const request = submission({submissionId, writeKey: 'attacker-controlled'});
        assert.equal((await worker.fetch(request, env)).status, 502);
    } finally {globalThis.fetch = original;}
});

test('invalid, oversized and rate-limited submissions never reach the backend', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {throw new Error('Backend must not be called');};
    try {
        const env = serviceEnv();
        assert.equal((await worker.fetch(submission({}, {'Content-Type': 'text/plain'}), env)).status, 415);
        for (const body of ['{', 'null', '[]', '{}', '"string"']) {
            assert.equal((await worker.fetch(submission(body), env)).status, 400);
        }
        assert.equal((await worker.fetch(submission({submissionId, name: 'x'.repeat(200001)}), env)).status, 413);
        assert.equal((await worker.fetch(submission({submissionId, name: '\u00e9'.repeat(100001)}), env)).status, 413);
        env.SUBMISSION_LIMITER = undefined;
        assert.equal((await worker.fetch(submission(), env)).status, 503);
        env.SUBMISSION_LIMITER = {limit: async () => ({success: false})};
        assert.equal((await worker.fetch(submission(), env)).status, 429);
    } finally {globalThis.fetch = original;}
});

test('proxy returns only a matching save acknowledgment and never backend secrets', async () => {
    const original = globalThis.fetch;
    try {
        const env = serviceEnv();
        globalThis.fetch = async () => Response.json({status: 'ok', submissionId, writeKey: 'private'});
        let response = await worker.fetch(submission(), env);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.deepEqual(await response.json(), {status: 'ok', submissionId});
        globalThis.fetch = async () => Response.json({status: 'ok', submissionId: 'other-id'});
        assert.equal((await worker.fetch(submission(), env)).status, 502);
        globalThis.fetch = async () => Response.json({status: 'error', message: 'private exception and key'});
        response = await worker.fetch(submission(), env);
        assert.ok(!(await response.text()).includes('private'));
    } finally {globalThis.fetch = original;}
});

test('admin requires a signed, unexpired token for the correct issuer and application', async () => {
    const original = globalThis.fetch;
    const {privateKey, publicKey} = await generateKeyPair('RS256');
    const attacker = await generateKeyPair('RS256');
    const jwk = {...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig'};
    const env = {...serviceEnv(), ACCESS_TEAM_DOMAIN: 'https://faculty-test.cloudflareaccess.com', ACCESS_AUD: 'faculty-app'};
    let reads = 0;
    try {
        globalThis.fetch = async url => {
            if (String(url).endsWith('/cdn-cgi/access/certs')) return Response.json({keys: [jwk]});
            reads++;
            assert.equal(new URL(url).searchParams.get('key'), env.ASSESSMENT_ADMIN_KEY);
            return Response.json({status: 'ok', submissions: [], private: 'never return this'});
        };
        const claims = {iss: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, sub: 'faculty-id', email: 'faculty@example.test', exp: Math.floor(Date.now() / 1000) + 300};
        const request = token => new Request('https://sageproject.xyz/assessment-api/admin', {headers: {'Cf-Access-Jwt-Assertion': token, 'Cf-Access-Authenticated-User-Email': 'faculty@example.test'}});
        assert.equal((await worker.fetch(request(''), env)).status, 401);
        for (const changed of [{aud: 'other-app'}, {iss: 'https://attacker.test'}, {exp: 1}, {email: ''}, {sub: ''}]) {
            const token = await new SignJWT({...claims, ...changed}).setProtectedHeader({alg: 'RS256', kid: 'test-key'}).sign(privateKey);
            assert.equal((await worker.fetch(request(token), env)).status, 401);
        }
        const forged = await new SignJWT(claims).setProtectedHeader({alg: 'RS256', kid: 'test-key'}).sign(attacker.privateKey);
        assert.equal((await worker.fetch(request(forged), env)).status, 401);
        assert.equal(reads, 0);
        const valid = await new SignJWT(claims).setProtectedHeader({alg: 'RS256', kid: 'test-key'}).sign(privateKey);
        const response = await worker.fetch(request(valid), env);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {status: 'ok', submissions: [], count: 0});
        assert.equal(reads, 1);
    } finally {globalThis.fetch = original;}
});
