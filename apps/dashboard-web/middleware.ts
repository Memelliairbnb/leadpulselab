export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    /*
     * Protect dashboard routes only — match paths that start with known dashboard segments.
     * Public pages: / (landing), /login, /api/auth
     */
    '/overview/:path*',
    '/leads/:path*',
    '/discovery/:path*',
    '/campaigns/:path*',
    '/inbox/:path*',
    '/pipelines/:path*',
    '/keywords/:path*',
    '/sources/:path*',
    '/inventory/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/outreach/:path*',
    '/scans/:path*',
    '/jobs/:path*',
  ],
};
