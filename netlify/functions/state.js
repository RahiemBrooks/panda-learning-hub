/**
 * Netlify Function: Cross-Device State Sync
 *
 * Provides GET and POST endpoints for syncing participant state across devices.
 * Uses Netlify Blobs for persistent key-value storage.
 *
 * GET /.netlify/functions/state?participantId=XXXXX
 *   - Returns stored state for the given participant ID
 *   - Returns { success: true, state: <persistentState>, updatedAt: <ISO> } if found
 *   - Returns { success: true, state: null } if not found (not an error)
 *
 * POST /.netlify/functions/state
 *   - Expects JSON body: { participantId: string, state: <persistentState>, updatedAt: string }
 *   - Stores/overwrites the state for the given participant ID
 *   - Returns { success: true } on success
 */

const { getStore } = require('@netlify/blobs');

// Validate participant ID matches the 5-digit rule: starts at 12000, increments by 8
function validateParticipantId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Participant ID is required' };
  }

  // Must be exactly 5 digits
  if (!/^\d{5}$/.test(id)) {
    return { valid: false, error: 'Participant ID must be exactly 5 digits' };
  }

  const numericId = parseInt(id, 10);

  // Valid range check: 12000 to 812000
  if (numericId < 12000 || numericId > 812000) {
    return { valid: false, error: 'Participant ID out of valid range' };
  }

  // Must follow the pattern: starts at 12000, increments by 8
  if ((numericId - 12000) % 8 !== 0) {
    return { valid: false, error: 'Invalid participant ID format' };
  }

  return { valid: true };
}

// Validate the state object has the expected shape
function validateStateShape(state) {
  if (!state || typeof state !== 'object') {
    return { valid: false, error: 'State must be an object' };
  }

  // Check for required fields (they can be empty arrays/objects)
  const hasChildren = 'children' in state;
  const hasLearningData = 'learningData' in state;
  const hasJournalEntries = 'journalEntries' in state;
  const hasRepeatMasteries = 'repeatMasteries' in state;

  if (!hasChildren || !hasLearningData || !hasJournalEntries || !hasRepeatMasteries) {
    return {
      valid: false,
      error: 'State must contain children, learningData, journalEntries, and repeatMasteries'
    };
  }

  // Basic type checks
  if (!Array.isArray(state.children)) {
    return { valid: false, error: 'children must be an array' };
  }
  if (typeof state.learningData !== 'object' || state.learningData === null) {
    return { valid: false, error: 'learningData must be an object' };
  }
  if (!Array.isArray(state.journalEntries)) {
    return { valid: false, error: 'journalEntries must be an array' };
  }
  if (typeof state.repeatMasteries !== 'object' || state.repeatMasteries === null) {
    return { valid: false, error: 'repeatMasteries must be an object' };
  }

  return { valid: true };
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  // Initialize blob store
  const store = getStore('panda-participant-state');

  // Handle GET request
  if (event.httpMethod === 'GET') {
    const participantId = event.queryStringParameters?.participantId;

    // Validate participant ID
    const validation = validateParticipantId(participantId);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: validation.error }),
      };
    }

    try {
      // Look up stored state by participant ID
      const storedData = await store.get(participantId, { type: 'json' });

      if (storedData) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            state: storedData.state,
            updatedAt: storedData.updatedAt,
          }),
        };
      } else {
        // Not found is not an error - return null state
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, state: null }),
        };
      }
    } catch (error) {
      console.error('Error fetching state:', error);
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Failed to retrieve state' }),
      };
    }
  }

  // Handle POST request
  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid JSON in request body' }),
      };
    }

    const { participantId, state, updatedAt } = body;

    // Validate participant ID
    const idValidation = validateParticipantId(participantId);
    if (!idValidation.valid) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: idValidation.error }),
      };
    }

    // Validate state shape
    const stateValidation = validateStateShape(state);
    if (!stateValidation.valid) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: stateValidation.error }),
      };
    }

    try {
      // Store the state with server-side timestamp
      const serverUpdatedAt = new Date().toISOString();
      const dataToStore = {
        state: state,
        updatedAt: serverUpdatedAt,
        clientUpdatedAt: updatedAt || null,
      };

      await store.setJSON(participantId, dataToStore);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, updatedAt: serverUpdatedAt }),
      };
    } catch (error) {
      console.error('Error storing state:', error);
      return {
        statusCode: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Failed to store state' }),
      };
    }
  }

  // Method not allowed
  return {
    statusCode: 405,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: false, error: 'Method not allowed. Use GET or POST.' }),
  };
};
