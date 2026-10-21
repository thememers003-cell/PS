import { NextResponse } from 'next/server';

const RENDER_BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const headers: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
    };

    const signature = req.headers.get('x-verify') || req.headers.get('authorization');
    if (signature) {
      headers['x-verify'] = signature;
    }

    // Forward incoming webhook directly to Render backend
    const res = await fetch(`${RENDER_BACKEND_URL}/api/payments/webhook`, {
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
