/**
 * Netlify Function: ElevenLabs Text-to-Speech
 *
 * Converts text to speech using ElevenLabs API with the custom "Panda 101" voice.
 * Returns MP3 audio bytes.
 *
 * Environment variables required:
 * - ELEVENLABS_API_KEY: Your ElevenLabs API key
 * - ELEVENLABS_VOICE_ID: The custom voice ID (Panda 101)
 */

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
    };
  }

  // Parse request body
  let text;
  try {
    const body = JSON.parse(event.body || '{}');
    text = body.text;
  } catch (parseError) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON in request body.' }),
    };
  }

  // Validate text parameter
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing or empty "text" field in request body.' }),
    };
  }

  // Get environment variables
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    console.error('Missing environment variables (API key or voice ID not configured)');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error. TTS service unavailable.' }),
    };
  }

  // ElevenLabs TTS API endpoint
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
        speaking_rate: 0.9,
      }),
    });

    if (!response.ok) {
      // Don't log the full response which might contain sensitive info
      console.error(`ElevenLabs API error: ${response.status} ${response.statusText}`);

      let errorMessage = 'Text-to-speech generation failed.';
      if (response.status === 401) {
        errorMessage = 'TTS authentication failed.';
      } else if (response.status === 429) {
        errorMessage = 'TTS rate limit exceeded. Please try again later.';
      } else if (response.status === 400) {
        errorMessage = 'Invalid text for TTS conversion.';
      }

      return {
        statusCode: response.status >= 500 ? 502 : response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorMessage }),
      };
    }

    // Get the audio data as a buffer
    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
      body: audioBase64,
      isBase64Encoded: true,
    };
  } catch (fetchError) {
    console.error('Failed to fetch from ElevenLabs:', fetchError.message);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to connect to TTS service.' }),
    };
  }
};
