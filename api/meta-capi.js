// =============================================================================
// Meta Conversion API — Server-side event tracking
// Runs as a Vercel serverless function at /api/meta-capi
//
// Required env vars in Vercel:
//   META_PIXEL_ID        - 16-digit pixel ID (can be committed as it's public)
//   META_ACCESS_TOKEN    - Sensitive access token (NEVER commit — only in Vercel env)
//
// Set these in Vercel Dashboard → Project → Settings → Environment Variables
// =============================================================================

const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '1582702526170106';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v19.0';

// SHA-256 hash (required by Meta for PII like email/phone)
function hash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Get client IP from request headers (Vercel sets x-forwarded-for)
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.headers['x-real-ip'] || '';
}

module.exports = async function handler(req, res) {
    // CORS for local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!ACCESS_TOKEN) {
        return res.status(500).json({
            error: 'META_ACCESS_TOKEN env var missing in Vercel settings'
        });
    }

    try {
        const body = req.body || {};
        const {
            event_name = 'PageView',
            event_source_url = '',
            user_agent = '',
            value,
            currency,
            content_name,
            email,
            phone
        } = body;

        const ip = getClientIp(req);

        // Build user_data (hashed where required)
        const userData = {
            client_ip_address: ip,
            client_user_agent: user_agent || req.headers['user-agent'] || ''
        };
        if (email) userData.em = hash(email);
        if (phone) userData.ph = hash(phone);

        // Build custom_data
        const customData = {};
        if (typeof value === 'number') customData.value = value;
        if (currency) customData.currency = currency;
        if (content_name) customData.content_name = content_name;

        const eventPayload = {
            event_name,
            event_time: Math.floor(Date.now() / 1000),
            event_source_url,
            action_source: 'website',
            user_data: userData,
            custom_data: customData
        };

        const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [eventPayload] })
        });

        const result = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Meta API error', details: result });
        }

        return res.status(200).json({ success: true, meta_response: result });
    } catch (err) {
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
};
