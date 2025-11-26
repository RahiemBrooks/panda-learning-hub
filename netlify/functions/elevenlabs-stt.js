/**
 * Netlify Function: ElevenLabs Speech-to-Text
 *
 * Transcribes short audio recordings using the ElevenLabs Speech-to-Text API.
 * Designed for toddler voice interactions (short yes/no and option responses).
 *
 * Environment variables required:
 * - ELEVENLABS_API_KEY: Your ElevenLabs API key
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

  // Get the API key from environment variables
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY environment variable');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error. STT service unavailable.' }),
    };
  }

  try {
    // Parse the request body - expecting base64-encoded audio
    let audioBase64;
    let contentType = 'audio/webm'; // Default content type

    try {
      const body = JSON.parse(event.body || '{}');
      audioBase64 = body.audio;
      if (body.contentType) {
        contentType = body.contentType;
      }
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body.' }),
      };
    }

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing or invalid "audio" field. Expected base64-encoded audio.' }),
      };
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    // Validate audio size (max 10MB for safety, but we expect very short clips)
    if (audioBuffer.length > 10 * 1024 * 1024) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Audio file too large. Maximum size is 10MB.' }),
      };
    }

    // Determine file extension based on content type
    let fileExtension = 'webm';
    if (contentType.includes('wav')) {
      fileExtension = 'wav';
    } else if (contentType.includes('mp3') || contentType.includes('mpeg')) {
      fileExtension = 'mp3';
    } else if (contentType.includes('ogg')) {
      fileExtension = 'ogg';
    } else if (contentType.includes('mp4') || contentType.includes('m4a')) {
      fileExtension = 'mp4';
    }

    // Create FormData for multipart request to ElevenLabs
    // ElevenLabs STT API expects multipart/form-data
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    // Build multipart form data manually
    const formDataParts = [];

    // Add the audio file
    formDataParts.push(
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="audio.${fileExtension}"\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`
    );

    // Add model parameter (scribe_v1 is the standard model)
    const modelPart = [
      `\r\n--${boundary}\r\n`,
      `Content-Disposition: form-data; name="model_id"\r\n\r\n`,
      `scribe_v1`
    ].join('');

    // Build the complete body
    const prefix = Buffer.from(formDataParts.join(''));
    const suffix = Buffer.from(modelPart + `\r\n--${boundary}--\r\n`);
    const formBody = Buffer.concat([prefix, audioBuffer, suffix]);

    // Call ElevenLabs Speech-to-Text API
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
    });

    if (!response.ok) {
      console.error(`ElevenLabs STT API error: ${response.status} ${response.statusText}`);

      let errorMessage = 'Speech-to-text transcription failed.';
      if (response.status === 401) {
        errorMessage = 'STT authentication failed.';
      } else if (response.status === 429) {
        errorMessage = 'STT rate limit exceeded. Please try again later.';
      } else if (response.status === 400) {
        errorMessage = 'Invalid audio for STT conversion.';
      }

      return {
        statusCode: response.status >= 500 ? 502 : response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorMessage }),
      };
    }

    // Parse the response
    const result = await response.json();

    // ElevenLabs returns { text: "transcribed text" }
    const transcript = result.text || '';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache', // Don't cache STT responses
      },
      body: JSON.stringify({ transcript: transcript.trim() }),
    };

  } catch (fetchError) {
    console.error('Failed to process STT request:', fetchError.message);
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to connect to STT service.' }),
    };
  }
};
