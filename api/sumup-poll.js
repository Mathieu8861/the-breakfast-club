// =============================================================================
// SumUp Polling — periodically checks for new online payments
// and forwards them to Meta Conversion API as Purchase events.
//
// Triggered by an external cron (cron-job.org) every 5 min.
//
// Required Vercel env vars:
//   SUMUP_API_KEY        - sup_sk_... (private API key)
//   SUMUP_MERCHANT_CODE  - merchant code (e.g. MDYF9FMT)
//   META_PIXEL_ID        - Meta Pixel ID
//   META_ACCESS_TOKEN    - Meta Conversion API token
//   CRON_SECRET          - shared secret to authenticate cron calls
//
// Endpoint behavior:
//   GET  /api/sumup-poll                        -> health check
//   POST /api/sumup-poll  (header X-Cron-Secret) -> run poll cycle
// =============================================================================

const crypto = require('crypto');

const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE || 'MDYF9FMT';
const META_PIXEL_ID = process.env.META_PIXEL_ID || '1582702526170106';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

const META_API_VERSION = 'v19.0';
const POLL_WINDOW_MINUTES = 15; // overlap window for safety (cron runs every 5 min)

// Map amount in EUR -> product name
const PRODUCT_AMOUNTS = {
    20: 'Séance découverte',
    95: 'Carte 10 visites',
    249: 'Carte 30 visites'
};

function hash(value) {
    if (!value) return null;
    return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function fetchRecentTransactions() {
    const since = new Date(Date.now() - POLL_WINDOW_MINUTES * 60 * 1000).toISOString();
    const url = `https://api.sumup.com/v0.1/me/transactions/history?changes_since=${encodeURIComponent(since)}&limit=50`;

    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${SUMUP_API_KEY}`,
            'Accept': 'application/json'
        }
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`SumUp API error ${res.status}: ${errBody.substring(0, 200)}`);
    }

    const data = await res.json();
    return data.items || [];
}

async function fetchTransactionDetails(transactionId) {
    if (!transactionId) return null;
    try {
        const url = `https://api.sumup.com/v2.1/merchants/${SUMUP_MERCHANT_CODE}/transactions/${transactionId}`;
        const res = await fetch(url, {
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

async function sendPurchaseToMeta(tx, productName, enrichment) {
    if (!META_ACCESS_TOKEN) {
        return { error: 'META_ACCESS_TOKEN missing' };
    }

    const userData = {
        client_user_agent: 'breakfast-club-sumup-poller/1.0'
    };

    // Try to enrich user_data with customer email/phone if available
    if (enrichment) {
        if (enrichment.customer_email) userData.em = hash(enrichment.customer_email);
        if (enrichment.customer_phone) userData.ph = hash(enrichment.customer_phone);
    }

    const eventTime = tx.timestamp
        ? Math.floor(new Date(tx.timestamp).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

    const eventPayload = {
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: `sumup_${tx.id || tx.transaction_id}`, // dedup with browser-side Pixel
        event_source_url: 'https://the-breakfast-club.vercel.app/',
        action_source: 'website',
        user_data: userData,
        custom_data: {
            currency: tx.currency || 'EUR',
            value: parseFloat(tx.amount),
            content_name: productName,
            content_type: 'product',
            order_id: tx.transaction_code || tx.id
        }
    };

    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventPayload] })
    });

    return await res.json();
}

function isOnlinePayment(tx) {
    // POS = card terminal (in-shop) — skip these
    if (tx.payment_type === 'POS') return false;

    // Online payments come from Payment Links / ECOM / CHECKOUT
    // Match amounts to known products as a safety filter
    const amount = parseFloat(tx.amount);
    if (!PRODUCT_AMOUNTS[amount]) return false;

    return true;
}

module.exports = async function handler(req, res) {
    // Health check
    if (req.method === 'GET' && !req.headers['x-cron-secret']) {
        return res.status(200).json({
            status: 'ok',
            endpoint: 'sumup-poll',
            window_minutes: POLL_WINDOW_MINUTES,
            configured: {
                api_key: !!SUMUP_API_KEY,
                merchant_code: !!SUMUP_MERCHANT_CODE,
                meta_token: !!META_ACCESS_TOKEN,
                cron_secret: !!CRON_SECRET
            }
        });
    }

    // Authenticate cron call
    if (CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized — missing or invalid X-Cron-Secret header' });
    }

    if (!SUMUP_API_KEY || !META_ACCESS_TOKEN) {
        return res.status(500).json({
            error: 'Missing env vars',
            need: ['SUMUP_API_KEY', 'META_ACCESS_TOKEN']
        });
    }

    try {
        const transactions = await fetchRecentTransactions();
        const onlineTxs = transactions.filter(isOnlinePayment);
        const results = [];

        for (const tx of onlineTxs) {
            // Try to fetch enriched data (customer email/phone if available)
            const details = await fetchTransactionDetails(tx.id || tx.transaction_id);
            const enrichment = details
                ? {
                    customer_email: details.customer_email || (details.customer && details.customer.email),
                    customer_phone: details.customer && details.customer.phone
                }
                : null;

            const productName = PRODUCT_AMOUNTS[parseFloat(tx.amount)];
            const metaResp = await sendPurchaseToMeta(tx, productName, enrichment);

            results.push({
                transaction_id: tx.id || tx.transaction_id,
                amount: tx.amount,
                product: productName,
                timestamp: tx.timestamp,
                meta_status: metaResp && metaResp.events_received ? 'sent' : 'error',
                meta_response: metaResp
            });
        }

        return res.status(200).json({
            status: 'ok',
            window_minutes: POLL_WINDOW_MINUTES,
            scanned: transactions.length,
            online_filtered: onlineTxs.length,
            tracked: results.length,
            results
        });
    } catch (err) {
        console.error('SumUp poll error:', err);
        return res.status(500).json({ error: err.message });
    }
};
