import { NextResponse } from 'next/server';

const RENDER_BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';

export async function GET(
  _req: Request,
  { params }: { params: { token: string[] } }
) {
  const tokenPath = Array.isArray(params?.token) ? params.token.join('/') : (params?.token || '');
  return NextResponse.json({
    success: true,
    message: 'Webhook token endpoint verified and active',
    webhookId: '427796ad-2a0d-47ba-bae2-b30112dafb9a',
    tokenPath,
  });
}

export async function POST(
  req: Request,
  { params }: { params: { token: string[] } }
) {
  try {
    const tokenPath = Array.isArray(params?.token) ? params.token.join('/') : (params?.token || '');
    const rawBody = await req.text();
    const headers: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
    };

    const signature = req.headers.get('x-verify') || req.headers.get('authorization') || req.headers.get('x-webhook-signature');
    if (signature) {
      headers['x-verify'] = signature;
    }

    // Forward incoming webhook directly to Render backend with token path
    const targetUrl = `${RENDER_BACKEND_URL}/api/payments/webhook/${tokenPath}`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: rawBody,
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    });
  } catch (err: any) {
    console.error('Webhook proxy error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Proxy error' }, { status: 500 });
  }
}
