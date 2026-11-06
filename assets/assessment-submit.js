(function () {
    'use strict';
    const KEY = 'sage.pending-assessment';
    let queue = [];
    let sending = false;
    let panel;
    function mount(host) {
        if (!panel) {
            panel = document.createElement('section');
            panel.setAttribute('aria-label', 'Submission status');
            panel.style.cssText = 'padding:16px 0;line-height:1.5;overflow-wrap:anywhere';
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn';
            retry.textContent = 'Retry Submission';
            retry.addEventListener('click', send);
            panel.append(status, retry);
        }
        (host || document.querySelector('.screen.active') || document.body).appendChild(panel);
    }
    function remember() {
        try {
            if (queue.length) sessionStorage.setItem(KEY, JSON.stringify(queue));
            else sessionStorage.removeItem(KEY);
        } catch (_) { /* Keep the in-memory queue; the status asks users to keep the tab open. */ }
    }
    async function send() {
        if (sending || !queue.length) return false;
        sending = true;
        panel.lastChild.hidden = true;
        panel.firstChild.textContent = 'Submitting answers...';
        try {
            while (queue.length) {
                const pending = queue[0];
                const response = await fetch('/assessment-api/submit', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(pending), signal: AbortSignal.timeout(25000)
                });
                const result = await response.json();
                if (!response.ok || result.status !== 'ok' || result.submissionId !== pending.submissionId) {
                    throw new Error('The server did not confirm this submission.');
                }
                queue.shift();
                remember();
            }
            panel.firstChild.textContent = 'Answers submitted successfully.';
            return true;
        } catch (_) {
            panel.firstChild.textContent = 'Answers have not been confirmed as submitted. Keep this tab open and retry.';
            panel.lastChild.hidden = false;
            return false;
        } finally { sending = false; }
    }
    window.SageSubmission = {
        submit(payload, host) {
            queue.push({...payload, submissionId: payload.submissionId || crypto.randomUUID()});
            remember();
            mount(host);
            return send();
        }
    };
    try {
        const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        queue = Array.isArray(stored) ? stored : stored ? [stored] : [];
    } catch (_) {}
    if (queue.length) {
        mount();
        panel.firstChild.textContent = 'A previous assessment is waiting to be submitted.';
    }
})();
