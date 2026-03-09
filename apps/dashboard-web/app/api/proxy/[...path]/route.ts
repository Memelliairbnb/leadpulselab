import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
const API_TOKEN = process.env.INTERNAL_API_TOKEN ?? '';

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;
  const targetPath = path.join('/');
  const url = new URL(targetPath, API_URL);

  // Forward query params
  const searchParams = req.nextUrl.searchParams;
  searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Token': API_TOKEN,
    'X-User-Id': String(session.user.userId),
    'X-Tenant-Id': String(session.user.tenantId),
    'X-User-Role': session.user.role,
  };

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    if (body) fetchOptions.body = body;
  }

  try {
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => null);

    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    console.error('Proxy error:', err);
    return NextResponse.json(
      { error: 'Internal proxy error' },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const PUT = proxyRequest;
