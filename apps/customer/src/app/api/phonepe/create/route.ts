import { NextResponse } from 'next/server';

const PHONEPE_CONFIG = {
  merchantId: process.env.PHONEPE_MERCHANT_ID || 'M236NFVVSAXD2',
  clientId: process.env.PHONEPE_CLIENT_ID || 'SU2610191744120003675634',
  clientSecret: process.env.PHONEPE_CLIENT_SECRET || '51d26195-be6f-47ee-949a-297591229cce',
  clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
  env: process.env.PHONEPE_ENV || 'PROD',
};

export async function POST(req: Request) {
  try {
    const { jobId, amount, displayId, redirectUrl: customRedirect } = await req.json();
    if (!jobId || !amount) {
      return NextResponse.json({ success: false, error: 'jobId and amount required' }, { status: 400 });
    }

    // 1. Obtain OAuth Token
    const tokenUrl = PHONEPE_CONFIG.env === 'PROD'
      ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

    const params = new URLSearchParams();
    params.append('client_id', PHONEPE_CONFIG.clientId);
    params.append('client_secret', PHONEPE_CONFIG.clientSecret);
    params.append('client_version', PHONEPE_CONFIG.clientVersion);
    params.append('grant_type', 'client_credentials');

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('PhonePe OAuth error:', errText);
      return NextResponse.json({ success: false, error: 'Failed to authenticate with PhonePe' }, { status: 502 });
    }

    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // 2. Create Checkout Session
    const checkoutEndpoint = PHONEPE_CONFIG.env === 'PROD'
      ? 'https://api.phonepe.com/apis/pg/checkout/v2/pay'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay';

    const amountInPaise = Math.max(100, Math.round(Number(amount) * 100));
    const orderId = `PP_${Date.now()}_${String(jobId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;

    // Use registered PhonePe merchant domain (riseupsolutions.in) for whitelisting compliance
    let origin = 'https://riseupsolutions.in';
    const originHeader = req.headers.get('origin') || req.headers.get('referer');
    if (originHeader && (originHeader.includes('riseupsolutions.in') || originHeader.includes('localhost'))) {
      try {
        const u = new URL(originHeader);
        origin = u.origin;
      } catch {}
    }

    const redirectUrl = customRedirect
      ? (customRedirect.includes('orderId=') ? customRedirect : `${customRedirect}&orderId=${orderId}`)
      : `${origin}/code?jobId=${jobId}&displayId=${displayId || ''}&orderId=${orderId}`;

    const payload = {
      merchantOrderId: orderId,
      amount: amountInPaise,
      expireAfter: 1200,
      paymentFlow: {
        type: 'PG_CHECKOUT',
        merchantUrls: {
          redirectUrl,
        },
      },
    };

    const checkoutRes = await fetch(checkoutEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `O-Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const checkoutData = await checkoutRes.json();
    if (checkoutRes.ok && checkoutData.redirectUrl) {
      // Sync orderId with Render database so verification knows about this PhonePe session
      try {
        const renderApi = process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';
        await fetch(`${renderApi}/api/payments/sync-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            orderId,
            provider: 'phonepe',
            amount: Number(amount),
          }),
        });
      } catch (e) {
        console.warn('Could not sync order to Render API:', e);
      }

      return NextResponse.json({
        success: true,
        data: {
          orderId: orderId, // merchantOrderId is required for PhonePe status API checks
          phonepeOrderId: checkoutData.orderId,
          checkoutUrl: checkoutData.redirectUrl,
          redirectUrl: checkoutData.redirectUrl,
          amount: Number(amount),
        },
      });
    }

    console.error('PhonePe checkout failed:', checkoutData);
    return NextResponse.json({
      success: false,
      error: checkoutData?.message || 'Failed to create PhonePe checkout',
    }, { status: 502 });
  } catch (err: any) {
    console.error('PhonePe API Route Exception:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
