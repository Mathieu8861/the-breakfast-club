// =============================================================================
// Create a SumUp Checkout — server-side
// Endpoint: POST /api/create-checkout   body: { product: 'decouverte'|'10visites'|'30visites' }
//
// Returns { checkout_id, reference, amount, product_name } so the front-end can
// mount the SumUp Card Widget (gateway.sumup.com/gateway/ecom/card/v2/sdk.js).
//
// The amount is decided SERVER-SIDE from the product (never trust the client).
//
// Required Vercel env vars:
//   SUMUP_API_KEY        - sup_sk_... (must have the payments/checkouts scope)
//   SUMUP_MERCHANT_CODE  - merchant code (e.g. MDYF9FMT)
// =============================================================================

const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE || 'MDYF9FMT';

// Source of truth for prices — the client only sends the product key
const PRODUCTS = {
    'decouverte': { amount: 20, name: 'Séance découverte' },
    '10visites':  { amount: 95, name: 'Carte 10 visites' },
    '30visites':  { amount: 249, name: 'Carte 30 visites' }
};

module.exports = async function handler(req, res) {
    // Health check — confirms env wiring without creating anything
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            endpoint: 'create-checkout',
            configured: { api_key: !!SUMUP_API_KEY, merchant_code: !!SUMUP_MERCHANT_CODE }
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!SUMUP_API_KEY) {
        return res.status(500).json({ error: 'SUMUP_API_KEY missing in Vercel env' });
    }

    const body = req.body || {};
    const product = PRODUCTS[body.product];
    if (!product) {
        return res.status(400).json({ error: 'Unknown product', allowed: Object.keys(PRODUCTS) });
    }

    // Unique reference so we can identify this payment attempt later
    const reference = `tbc_${body.product}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const checkoutBody = {
        checkout_reference: reference,
        amount: product.amount,
        currency: 'EUR',
        merchant_code: SUMUP_MERCHANT_CODE,
        description: `The Breakfast Club — ${product.name}`
    };

    try {
        const r = await fetch('https://api.sumup.com/v0.1/checkouts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUMUP_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(checkoutBody)
        });

        const data = await r.json();

        if (!r.ok) {
            // Surface SumUp's error so we know if it's a scope/permission issue
            return res.status(r.status).json({ error: 'SumUp checkout creation failed', sumup: data });
        }

        return res.status(200).json({
            checkout_id: data.id,
            reference: reference,
            amount: product.amount,
            currency: 'EUR',
            product_name: product.name
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
};
