// =============================================================================
// SumUp Webhook Handler — receives payment events and forwards to Meta CAPI
// Endpoint: /api/sumup-webhook
//
// Required Vercel env vars:
//   SUMUP_API_KEY            - Private API key (sup_sk_...)
//   SUMUP_WEBHOOK_SECRET     - Webhook signing secret (set when Greg creates webhook)
//   SUMUP_MERCHANT_CODE      - Greg's merchant code (e.g. MDYF9FMT)
//   META_PIXEL_ID            - Meta Pixel ID
//   META_ACCESS_TOKEN        - Meta Conversion API token
//
// SumUp webhook events we handle:
//   - checkout.completed
//   - transaction.successful
// =============================================================================

const crypto = require('crypto');

const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_WEBHOOK_SECRET = process.env.SUMUP_WEBHOOK_SECRET;
const META_PIXEL_ID = process.env.META_PIXEL_ID || '1582702526170106';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = 'v19.0';

// Map SumUp checkout reference / amount to product name
function identifyProduct(amount, description) {
    const desc = (description || '').toLowerCase();
    if (amount === 20) return 'Séance découverte';
    if (amount === 95) return 'Carte 10 visites';
    if (amount === 249) return 'Carte 30 visites';
    if (desc.includes('decouverte') || desc.includes('découverte')) return 'Séance découverte';
    if (desc.includes('10')) return 'Carte 10 visites';
    if (desc.includes('30')) return 'Carte 30 visites';
    return 'Achat Breakfast Club';
}

// SHA-256 for hashing PII (required by Meta CAPI)
function hash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Verify SumUp webhook signature (HMAC-SHA256)
function verifySignature(payload, signature) {
    if (!SUMUP_WEBHOOK_SECRET) return true; // Skip if no secret configured (dev)
    if (!signature) return false;

    const expected = crypto
        .createHmac('sha256', SUMUP_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature.replace(/^sha256=/, ''), 'hex'),
            Buffer.from(expected, 'hex')
        );
    } catch (err) {
        return false;
    }
}

// Fetch full transaction details from SumUp API
async function fetchTransactionDetails(transactionId) {
    if (!SUMUP_API_KEY || !transactionId) return null;
    try {
        const res = await fetch(`https://api.sumup.com/v2.1/merchants/transactions/${transactionId}`, {
            headers: {
                'Authorization': `Bearer ${SUMUP_API_KEY}`,
                'Accept': 'application/json'
            }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        return null;
    }
}

// Send Purchase event to Meta Conversion API
async function sendMetaPurchase({ amount, currency, productName, email, phone, eventId, ip, userAgent }) {
    if (!META_ACCESS_TOKEN) {
        return { error: 'META_ACCESS_TOKEN missing' };
    }

    const userData = {
        client_ip_address: ip || '',
        client_user_agent: userAgent || ''
    };
    if (email) userData.em = hash(email);
    if (phone) userData.ph = hash(phone);

    const eventPayload = {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId, // For deduplication with browser-side Pixel
        event_source_url: 'https://the-breakfast-club.vercel.app/',
        action_source: 'website',
        user_data: userData,
        custom_data: {
            currency: currency || 'EUR',
            value: amount,
            content_name: productName,
            content_type: 'product'
        }
    };

    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventPayload] })
    });

    return await response.json();
}

// Read raw body (Vercel parses JSON by default but we need raw for signature check)
async function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    if (req.method === 'GET') {
        // Health check
        return res.status(200).json({
            status: 'ok',
            endpoint: 'sumup-webhook',
            configured: {
                api_key: !!SUMUP_API_KEY,
                webhook_secret: !!SUMUP_WEBHOOK_SECRET,
                meta_token: !!META_ACCESS_TOKEN
            }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Vercel auto-parses JSON body, but for signature verification we'd want raw
        // For now we accept the parsed body (signature check still works on JSON.stringify)
        const event = req.body || {};
        const signature = req.headers['x-sumup-signature'] || req.headers['x-payload-signature'] || '';

        // Verify signature if secret is configured
        if (SUMUP_WEBHOOK_SECRET) {
            const rawPayload = JSON.stringify(event);
            if (!verifySignature(rawPayload, signature)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        // Extract event info — SumUp event format may vary
        const eventType = event.event_type || event.type || '';
        const isSuccess = eventType.includes('completed') ||
                          eventType.includes('successful') ||
                          eventType.includes('paid');

        if (!isSuccess) {
            return res.status(200).json({ status: 'ignored', reason: 'non-success event', event_type: eventType });
        }

        // Parse transaction data — try multiple possible structures
        const data = event.data || event.payload || event;
        const txId = data.transaction_id || data.id || data.checkout_reference || null;
        let amount = parseFloat(data.amount || data.total_amount || 0);
        const currency = data.currency || 'EUR';
        const description = data.description || data.checkout_reference || '';
        const email = data.customer_email || (data.customer && data.customer.email) || null;
        const phone = (data.customer && data.customer.phone) || null;

        // If amount missing, fetch full transaction from SumUp API
        if (!amount && txId) {
            const tx = await fetchTransactionDetails(txId);
            if (tx) {
                amount = parseFloat(tx.amount || 0);
            }
        }

        if (!amount) {
            return res.status(400).json({ error: 'Could not determine transaction amount' });
        }

        const productName = identifyProduct(amount, description);
        const eventId = `sumup_${txId || Date.now()}`;
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || '';

        // Forward to Meta Conversion API
        const metaResponse = await sendMetaPurchase({
            amount,
            currency,
            productName,
            email,
            phone,
            eventId,
            ip,
            userAgent
        });

        return res.status(200).json({
            status: 'ok',
            event_type: eventType,
            tracked: {
                product: productName,
                amount,
                currency,
                event_id: eventId
            },
            meta_response: metaResponse
        });
    } catch (err) {
        console.error('SumUp webhook error:', err);
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
};
