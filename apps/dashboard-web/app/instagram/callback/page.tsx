'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackHandler() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      const msg = errorDescription || error || 'Instagram authorization was denied';
      setStatus('error');
      setErrorMsg(msg);
      // Send error back to parent window
      if (window.opener) {
        window.opener.postMessage(
          { type: 'instagram-oauth-callback', error: msg },
          window.location.origin
        );
        setTimeout(() => window.close(), 2000);
      }
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('No authorization code received');
      return;
    }

    // Exchange code for token via our API
    exchangeCode(code);
  }, [searchParams]);

  async function exchangeCode(code: string) {
    try {
      const res = await fetch('/api/proxy/instagram/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: `${window.location.origin}/instagram/callback`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to connect Instagram account');
      }

      setStatus('success');

      // Send account data back to parent window (the connect page)
      if (window.opener) {
        window.opener.postMessage(
          { type: 'instagram-oauth-callback', account: data.account },
          window.location.origin
        );
        setTimeout(() => window.close(), 1500);
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message);
      if (window.opener) {
        window.opener.postMessage(
          { type: 'instagram-oauth-callback', error: err.message },
          window.location.origin
        );
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="text-center space-y-4 max-w-md px-6">
        {status === 'processing' && (
          <>
            <div className="w-12 h-12 mx-auto rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <p className="text-white text-sm">Connecting your Instagram account...</p>
            <p className="text-gray-500 text-xs">This window will close automatically</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white text-sm">Instagram connected successfully!</p>
            <p className="text-gray-500 text-xs">This window will close automatically</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-white text-sm">Connection failed</p>
            <p className="text-red-400 text-xs">{errorMsg}</p>
            <button
              onClick={() => window.close()}
              className="mt-2 px-4 py-2 bg-gray-800 text-gray-300 text-xs rounded-md hover:bg-gray-700"
            >
              Close window
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function InstagramCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-950">
          <div className="w-12 h-12 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
