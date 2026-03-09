'use client';

import { signOut, useSession } from 'next-auth/react';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-14 bg-surface-raised border-b border-border flex items-center justify-between px-6 fixed top-0 left-56 right-0 z-10">
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-secondary">
          {session?.user?.tenantName ?? 'Dashboard'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-text-secondary">
          {session?.user?.name}
        </span>
        <span className="text-xs text-text-muted px-2 py-0.5 rounded bg-surface-overlay border border-border">
          {session?.user?.role}
        </span>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
