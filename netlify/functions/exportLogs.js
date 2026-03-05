/**
 * Netlify Function: Research Log Export  (Researcher-Only Endpoint)
 *
 * GET /.netlify/functions/exportLogs
 *   ?token=<LOG_EXPORT_TOKEN>
 *   &participantId=<numeric id>      (optional — omit to export all participants)
 *   &dateFrom=<YYYY-MM-DD>           (optional — inclusive lower bound)
 *   &dateTo=<YYYY-MM-DD>             (optional — inclusive upper bound)
 *   &format=json|jsonl               (optional — default "jsonl")
 *
 * Protected by the LOG_EXPORT_TOKEN environment variable.
 * Participants must NEVER have access to this endpoint.
 *
 * Returns:
 *   format=jsonl  → application/x-ndjson, one record per line
 *   format=json   → application/json, array of records
 *
 * Storage layout (Netlify Blobs):
 *   logs/{participantId}/{YYYY-MM-DD}.jsonl
 */

const { getStore } = require('@netlify/blobs');

function isValidParticipantId(id) {
    return typeof id === 'string' && /^[0-9]+$/.test(id) && id.length > 0;
}

// Returns true when dateStr falls within [from, to] (both optional)
function inDateRange(dateStr, from, to) {
    if (from && dateStr < from) return false;
    if (to   && dateStr > to  ) return false;
    return true;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const params = event.queryStringParameters || {};

    // --- Auth ---
    const exportToken = process.env.LOG_EXPORT_TOKEN;
    if (!exportToken) {
        console.error('[exportLogs] LOG_EXPORT_TOKEN is not set');
        return { statusCode: 500, body: 'Export is not configured on this deployment.' };
    }
    if (params.token !== exportToken) {
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const { participantId, dateFrom, dateTo, format } = params;
    const returnJsonl = format !== 'json';

    // If a participantId filter is provided it must be numeric
    if (participantId && !isValidParticipantId(participantId)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'participantId must be numeric digits only' })
        };
    }

    try {
        const store = getStore('research-logs');

        // List all blobs under the logs/ prefix
        const listResult = await store.list({ prefix: 'logs/' });
        const allBlobs = listResult.blobs || [];

        // Filter to matching keys
        // Key format: logs/{participantId}/{YYYY-MM-DD}.jsonl
        const matchingKeys = allBlobs
            .map(b => b.key)
            .filter(key => {
                const parts = key.split('/');
                if (parts.length !== 3) return false;                // parts = ["logs", participantId, "YYYY-MM-DD.jsonl"]
                const pid  = parts[1];
                const date = parts[2].replace('.jsonl', '');

                if (participantId && pid !== participantId) return false;
                if (!inDateRange(date, dateFrom || null, dateTo || null)) return false;
                return true;
            });

        if (matchingKeys.length === 0) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': returnJsonl ? 'application/x-ndjson' : 'application/json' },
                body: returnJsonl ? '' : '[]'
            };
        }

        // Read and concatenate all matching JSONL files
        const lines = [];
        for (const key of matchingKeys) {
            try {
                const content = await store.get(key);
                if (content) {
                    content
                        .trim()
                        .split('\n')
                        .forEach(line => {
                            const trimmed = line.trim();
                            if (trimmed) lines.push(trimmed);
                        });
                }
            } catch (_) {
                // Skip unreadable blob; do not abort the whole export
            }
        }

        if (returnJsonl) {
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/x-ndjson',
                    'Content-Disposition': 'attachment; filename="panda-research-logs.jsonl"'
                },
                body: lines.join('\n')
            };
        } else {
            // Parse each line and return as a JSON array
            const records = lines
                .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
                .filter(Boolean);

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Disposition': 'attachment; filename="panda-research-logs.json"'
                },
                body: JSON.stringify(records, null, 2)
            };
        }

    } catch (err) {
        console.error('[exportLogs] Error:', err.message);
        return { statusCode: 500, body: 'Export failed: ' + err.message };
    }
};
