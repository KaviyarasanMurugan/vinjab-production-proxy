/**
 * Stage 1 compatibility transport.
 *
 * Vercel serves the frontend. This endpoint keeps the existing
 * Google Apps Script business logic in place while the frontend moves.
 */
const ALLOWED_FUNCTIONS = new Set([
  'getInitialHomeData',
  'getAllProperties',
  'getPropertiesByDestination',
  'searchProperties',
  'getPropertyById',
  'getFeaturedProperties',
  'getPropertySuggestions',
  'sendOtp',
  'verifyOtp',
  'submitBooking',
  'submitPlacementLead',
  'submitBpoLead',
  'submitContactMessage'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed.'
    });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;

  if (!appsScriptUrl) {
    return res.status(500).json({
      success: false,
      message: 'APPS_SCRIPT_URL is not configured.'
    });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body || {});

    const fnName = body.fnName;
    const args = Array.isArray(body.args) ? body.args : [];

    if (!ALLOWED_FUNCTIONS.has(fnName)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported backend function.'
      });
    }

    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fnName,
        args
      }),
      redirect: 'follow'
    });

    const text = await response.text();

    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch (e) {
      return res.status(502).json({
        success: false,
        message: 'Apps Script returned a non-JSON response.'
      });
    }

    return res.status(response.ok ? 200 : 502).json(result);
  } catch (error) {
    console.error('Apps Script proxy error:', error);

    return res.status(500).json({
      success: false,
      message: error && error.message
        ? error.message
        : 'Unable to reach the existing backend.'
    });
  }
}
