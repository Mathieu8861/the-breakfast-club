// =============================================================================
// TEMPORARY diagnostic endpoint — lists recent SumUp transactions so we can
// verify whether the afternoon test payments completed, their amounts, and
// whether the poller filter would track them.
//
// Auth: X-Cron-Secret header (same secret as the poller). READ-ONLY:
// it does NOT send anything to Meta.
//
// ⚠️ TEMPORARY — remove this file once the diagnosis is done.
// =============================================================================

const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Same product/amount filter as the poller (sumup-poll.js)
const PRODUCT_AMOUNTS = {
    20: 'Séance découverte',
    95: 'Carte 10 visites',
    249: 'Carte 30 visites'
};

module.exports = async function handler(req, res) {
    if (CRON_SECRET && req.headers['x-cron-secret'] !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized — missing or invalid X-Cron-Secret header' });
    }
    if (!SUMUP_API_KEY) {
        return res.status(500).json({ error: 'SUMUP_API_KEY missing in Vercel env' });
    }

    // Look back 12 hours (covers a ~16h payment when called late evening)
    const HOURS_BACK = 12;
    const since = new Date(Date.now() - HOURS_BACK * 60 * 60 * 1000).toISOString();
    const url = `https://api.sumup.com/v0.1/me/transactions/history?changes_since=${encodeURIComponent(since)}&limit=100`;

    try {
        const r = await fetch(url, {
            headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}`, 'Accept': 'application/json' }
        });

        if (!r.ok) {
            const body = await r.text();
            return res.status(r.status).json({ error: `SumUp API ${r.status}`, body: body.substring(0, 300) });
        }

        const data = await r.json();
        const items = data.items || [];

        const transactions = items.map(function (tx) {
            const amount = parseFloat(tx.amount);
            const isPos = tx.payment_type === 'POS';
            return {
                id: tx.id || tx.transaction_id,
                code: tx.transaction_code,
                amount: tx.amount,
                currency: tx.currency,
                status: tx.status,
                payment_type: tx.payment_type,
                type: tx.type,
                timestamp: tx.timestamp,
                // Would the poller send this one to Meta?
                would_track_to_meta: !isPos && !!PRODUCT_AMOUNTS[amount],
                matched_product: PRODUCT_AMOUNTS[amount] || null
            };
        });

        return res.status(200).json({
            hours_back: HOURS_BACK,
            since,
            total_found: items.length,
            // field names of the raw object (helps if a mapping is null) — no PII values
            raw_fields_sample: items.length ? Object.keys(items[0]) : [],
            transactions
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
};
