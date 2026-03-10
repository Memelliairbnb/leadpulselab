import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
const API_TOKEN = process.env.INTERNAL_API_TOKEN ?? '';

/**
 * Multipart upload proxy — forwards FormData to the backend API.
 * Usage: POST /api/proxy/upload?target=video/process
 * The `target` query param specifies the backend API path (under /api/).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const target = req.nextUrl.searchParams.get('target');
  if (!target) {
    return NextResponse.json({ error: 'Missing target parameter' }, { status: 400 });
  }

  const url = new URL(`/api/${target}`, API_URL);

  try {
    // Read the raw body as-is and forward with its original content-type
    const contentType = req.headers.get('content-type') ?? '';
    const body = await req.arrayBuffer();

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${API_TOKEN}`,
        'X-User-Id': String(session.user.userId),
        'X-Tenant-Id': String(session.user.tenantId),
        'X-User-Role': session.user.role,
      },
      body,
    });

    const data = await response.json().catch(() => null);
    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    console.error('Upload proxy error:', err);
    return NextResponse.json(
      { error: 'Internal proxy error' },
      { status: 502 }
    );
  }
}
