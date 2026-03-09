export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login (auth page)
     * - /api/auth (NextAuth endpoints)
     * - /_next (Next.js internals)
     * - /favicon.ico, /images, etc.
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|images|manifest\\.json).*)',
  ],
};
