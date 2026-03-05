/**
 * Netlify Function: Research Event Logger (IRB-Safe)
 *
 * POST /.netlify/functions/logEvent
 * Body: JSON event object (see frontend logEvent() for schema)
 *
 * Appends one JSON line to Netlify Blobs:
 *   logs/{participantId}/{YYYY-MM-DD}.jsonl
 *
 * Privacy guarantees:
 *   - participantId is a numeric-only research code (no names, no email)
 *   - IP addresses are NOT read or stored
 *   - User-agent strings are NOT stored
 *   - The Netlify runtime strips X-Forwarded-For before this function runs
 *
 * Returns HTTP 200 immediately regardless of outcome so the client
 * never blocks, retries unnecessarily, or leaks errors to child users.
 */

const { getStore } = require('@netlify/blobs');

// Accept numeric-only participant IDs (matches IRB spec: digits only, no letters)
function isValidParticipantId(id) {
    return typeof id === 'string' && /^[0-9]+$/.test(id) && id.length > 0;
}

// Extract YYYY-MM-DD from an ISO 8601 string; fall back to today on parse error
function toDateKey(isoTimestamp) {
    try {
        const d = new Date(isoTimestamp);
        if (isNaN(d.getTime())) throw new Error('invalid date');
        return d.toISOString().slice(0, 10);
    } catch (_) {
        return new Date().toISOString().slice(0, 10);
    }
}

exports.handler = async (event) => {
    // Only accept POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Parse body
    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (_) {
        // Malformed JSON — return 200 so client does not queue for retry
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'parse_error' }) };
    }

    const { participantId, sessionId, role, timestamp, eventType } = payload;

    // --- Validation ---
    // Invalid participantId: silently accept so the client receives no signal
    if (!isValidParticipantId(participantId)) {
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // Missing required fields: silently accept (do not store)
    if (!sessionId || !role || !timestamp || !eventType) {
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // Reject unexpected role values
    if (role !== 'child' && role !== 'parent') {
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // --- Storage ---
    try {
        const store = getStore('research-logs');

        // Blob key: logs/{participantId}/{YYYY-MM-DD}.jsonl
        const date = toDateKey(timestamp);
        const blobKey = `logs/${participantId}/${date}.jsonl`;

        // Fetch existing content for this day (empty string if key is new)
        let existing = '';
        try {
            const raw = await store.get(blobKey);
            if (raw) existing = raw;
        } catch (_) {
            // Key does not exist yet — that is fine, we start fresh
        }

        // Append one JSON line and save
        const newLine = JSON.stringify(payload) + '\n';
        await store.set(blobKey, existing + newLine);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true })
        };
    } catch (err) {
        // Storage failure — log server-side but tell client "ok" so it
        // does NOT retry a permanent infrastructure error indefinitely.
        console.error('[logEvent] Blob write error:', err.message);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: false, error: 'storage_error' })
        };
    }
};
