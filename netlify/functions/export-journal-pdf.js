/**
 * Netlify Function: Export Journal as PDF
 *
 * Generates a formatted PDF from journal entries data.
 *
 * POST /.netlify/functions/export-journal-pdf
 *   - Expects JSON body: { participantId: string, entries: array, childName?: string }
 *   - Returns a PDF file with proper Content-Type and Content-Disposition headers
 */

const PDFDocument = require('pdfkit');

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

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Format date for display
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Format time for display
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Calculate date range from entries
function getDateRange(entries) {
  if (!entries || entries.length === 0) {
    return 'No entries';
  }

  const timestamps = entries.map(e => new Date(e.timestamp).getTime());
  const minDate = new Date(Math.min(...timestamps));
  const maxDate = new Date(Math.max(...timestamps));

  const formatShort = (date) => date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  if (minDate.toDateString() === maxDate.toDateString()) {
    return formatShort(minDate);
  }

  return `${formatShort(minDate)} - ${formatShort(maxDate)}`;
}

// Generate PDF from journal entries
async function generatePDF(participantId, entries, childName) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document with US Letter size and proper margins
      const doc = new PDFDocument({
        size: 'letter',
        margins: {
          top: 72,    // 1 inch
          bottom: 72,
          left: 72,
          right: 72
        },
        info: {
          Title: `PANDA Learning Journal - ${childName || participantId}`,
          Author: 'PANDA Learning Hub',
          Subject: 'Learning Journal Export',
          Creator: 'PANDA Learning Hub'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const exportDate = new Date();
      const dateRange = getDateRange(entries);

      // Header section
      doc.fontSize(24)
         .font('Helvetica-Bold')
         .fillColor('#1a1a1a')
         .text('PANDA Learning Journal', { align: 'center' });

      doc.moveDown(0.5);

      // Child/Participant info
      doc.fontSize(14)
         .font('Helvetica')
         .fillColor('#4a4a4a');

      if (childName) {
        doc.text(`Child: ${childName}`, { align: 'center' });
      }
      doc.text(`Participant ID: ${participantId}`, { align: 'center' });

      doc.moveDown(0.3);

      // Date range and export timestamp
      doc.fontSize(11)
         .fillColor('#666666')
         .text(`Date Range: ${dateRange}`, { align: 'center' })
         .text(`Exported: ${formatDate(exportDate.toISOString())} at ${formatTime(exportDate.toISOString())}`, { align: 'center' });

      doc.moveDown(0.5);

      // Divider line
      doc.strokeColor('#e0e0e0')
         .lineWidth(1)
         .moveTo(72, doc.y)
         .lineTo(540, doc.y)
         .stroke();

      doc.moveDown(1);

      // Entry count summary
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .fillColor('#1a1a1a')
         .text(`Total Entries: ${entries.length}`, { align: 'left' });

      doc.moveDown(1);

      // Sort entries by timestamp (newest first)
      const sortedEntries = [...entries].sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
      );

      // Render each journal entry
      sortedEntries.forEach((entry, index) => {
        // Check if we need a new page (leave room for at least the header + some text)
        if (doc.y > 650) {
          doc.addPage();
        }

        // Entry header with day number and date/time
        doc.fontSize(12)
           .font('Helvetica-Bold')
           .fillColor('#2563eb')
           .text(`Day ${entry.day}`, { continued: true });

        doc.font('Helvetica')
           .fillColor('#666666')
           .text(`  |  ${formatDate(entry.timestamp)} at ${formatTime(entry.timestamp)}`);

        // Tag if present
        if (entry.tag) {
          doc.fontSize(10)
             .fillColor('#7c3aed')
             .text(`Tag: ${entry.tag}`);
        }

        doc.moveDown(0.3);

        // Entry content
        doc.fontSize(11)
           .font('Helvetica')
           .fillColor('#1a1a1a')
           .text(entry.text || entry.content || '', {
             align: 'left',
             lineGap: 3
           });

        doc.moveDown(0.8);

        // Light separator between entries (except for last one)
        if (index < sortedEntries.length - 1) {
          doc.strokeColor('#e8e8e8')
             .lineWidth(0.5)
             .moveTo(72, doc.y)
             .lineTo(540, doc.y)
             .stroke();
          doc.moveDown(0.8);
        }
      });

      // Footer on last page
      doc.moveDown(2);
      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('#999999')
         .text('Generated by PANDA Learning Hub', { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }),
    };
  }

  // Parse request body
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

  const { participantId, entries, childName } = body;

  // Validate participant ID
  const idValidation = validateParticipantId(participantId);
  if (!idValidation.valid) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: idValidation.error }),
    };
  }

  // Validate entries array
  if (!Array.isArray(entries)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'entries must be an array' }),
    };
  }

  try {
    // Generate the PDF
    const pdfBuffer = await generatePDF(participantId, entries, childName);

    // Create filename with child name or participant ID and current date
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const safeName = (childName || participantId).replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `notes-${safeName}-${dateStr}.pdf`;

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Error generating PDF:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Failed to generate PDF' }),
    };
  }
};
