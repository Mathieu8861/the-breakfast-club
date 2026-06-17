// =============================================================================
// TEMPORARY diagnostic endpoint — verify the afternoon test payments.
//
//   GET  /api/sumup-debug   -> list recent SumUp transactions (READ-ONLY)
//   POST /api/sumup-debug   -> (re)send the SUCCESSFUL online payments found in
//                              the window to Meta, using the SAME event_id as the
//                              poller (sumup_<txid>) so Meta DEDUPLICATES — no
//                              double counting. Returns Meta's events_received.
//
// Auth: X-Cron-Secret header (same secret as the poller).
// ⚠️ TEMPORARY — remove this file once the diagnosis is done.
// =============================================================================

const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE || 'MDYF9FMT';
const CRON_SECRET = process.env.CRON_SECRET;
const META_PIXEL_ID = process.env.META_PIXEL_ID || '1582702526170106';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = 'v19.0';

const PRODUCT_AMOUNTS = {
    20: 'Séance découverte',
    95: 'Carte 10 visites',
    249: 'Carte 30 visites'
};

const HOURS_BACK = 12;

async function fetchRecentTransactions() {
    const since = new Date(Date.now() - HOURS_BACK * 60 * 60 * 1000).toISOString();
    const url = `https://api.sumup.com/v0.1/me/transactions/history?changes_since=${encodeURIComponent(since)}&limit=100`;
    const r = await fetch(url, {
        headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}`, 'Accept': 'application/json' }
    });
    if (!r.ok) {
        const body = await r.text();
        throw new Error(`SumUp API ${r.status}: ${body.substring(0, 300)}`);
    }
    const data = await r.json();
    return { items: data.items || [], since };
}

function mask(v) {
    if (!v) return null;
    const s = String(v);
    if (s.length <= 3) return s[0] + '***';
    return s.substring(0, 2) + '***' + s.substring(s.length - 1);
}

// Probe SumUp detail endpoints to see if ANY customer identifier (email/phone)
// is available for Meta matching. Returns masked previews only (no raw PII).
async function probeCustomerData(tx) {
    const id = tx.id || tx.transaction_id;
    const candidates = [
        `https://api.sumup.com/v2.1/merchants/${SUMUP_MERCHANT_CODE}/transactions/${id}`,
        `https://api.sumup.com/v0.1/me/transactions?id=${encodeURIComponent(id)}`
    ];
    const out = [];
    for (const url of candidates) {
        try {
            const r = await fetch(url, { headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}`, 'Accept': 'application/json' } });
            if (!r.ok) { out.push({ url: url.split('?')[0], ok: false, status: r.status }); continue; }
            const d = await r.json();
            const cust = d.customer || (d.checkout && d.checkout.customer) || {};
            out.push({
                url: url.split('?')[0],
                ok: true,
                top_level_keys: Object.keys(d),
                found_email: mask(d.customer_email || d.email || cust.email || (d.payment_instrument && d.payment_instrument.email)),
                found_phone: mask(d.customer_phone || d.phone || cust.phone),
                has_customer_object: !!(d.customer || (d.checkout && d.checkout.customer))
            });
        } catch (e) {
            out.push({ url: url.split('?')[0], ok: false, error: e.message });
        }
    }
    return out;
}

// Same rule as the corrected poller: successful online PAYMENT, known amount
function isTrackablePayment(tx) {
    if (tx.payment_type === 'POS') return false;
    if (tx.type && tx.type !== 'PAYMENT') return false;
    if (tx.status && tx.status !== 'SUCCESSFUL') return false;
    return !!PRODUCT_AMOUNTS[parseFloat(tx.amount)];
}

async function sendPurchaseToMeta(tx) {
    const amount = parseFloat(tx.amount);
    const eventPayload = {
        event_name: 'Purchase',
        event_time: tx.timestamp ? Math.floor(new Date(tx.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
        event_id: `sumup_${tx.id || tx.transaction_id}`, // matches poller -> Meta dedup
        event_source_url: 'https://www.thebreakfast-club.com/',
        action_source: 'website',
        user_data: { client_user_agent: 'breakfast-club-sumup-debug/1.0' },
        custom_data: {
            currency: tx.currency || 'EUR',
            value: amount,
            content_name: PRODUCT_AMOUNTS[amount],
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

module.exports = async function handler(req, res) {
    if (CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized — missing or invalid X-Cron-Secret header' });
    }
    if (!SUMUP_API_KEY) {
        return res.status(500).json({ error: 'SUMUP_API_KEY missing in Vercel env' });
    }

    try {
        const { items, since } = await fetchRecentTransactions();

        // POST -> resend successful payments to Meta and report the result
        if (req.method === 'POST') {
            if (!META_ACCESS_TOKEN) {
                return res.status(500).json({ error: 'META_ACCESS_TOKEN missing' });
            }
            const payable = items.filter(isTrackablePayment);
            const sent = [];
            for (const tx of payable) {
                const metaResp = await sendPurchaseToMeta(tx);
                sent.push({
                    id: tx.id || tx.transaction_id,
                    amount: tx.amount,
                    product: PRODUCT_AMOUNTS[parseFloat(tx.amount)],
                    event_id: `sumup_${tx.id || tx.transaction_id}`,
                    meta_events_received: metaResp && metaResp.events_received,
                    meta_response: metaResp
                });
            }
            return res.status(200).json({ action: 'resend_to_meta', count: sent.length, sent });
        }

        // GET -> list only
        const transactions = items.map(function (tx) {
            return {
                id: tx.id || tx.transaction_id,
                code: tx.transaction_code,
                amount: tx.amount,
                currency: tx.currency,
                status: tx.status,
                payment_type: tx.payment_type,
                type: tx.type,
                timestamp: tx.timestamp,
                would_track_to_meta: isTrackablePayment(tx),
                matched_product: PRODUCT_AMOUNTS[parseFloat(tx.amount)] || null
            };
        });
        // For the trackable payment(s), probe whether SumUp exposes customer email/phone
        const probes = [];
        for (const tx of items.filter(isTrackablePayment)) {
            probes.push({ id: tx.id || tx.transaction_id, customer_data: await probeCustomerData(tx) });
        }

        return res.status(200).json({
            hours_back: HOURS_BACK,
            since,
            total_found: items.length,
            raw_fields_sample: items.length ? Object.keys(items[0]) : [],
            transactions,
            customer_data_probe: probes
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
};
