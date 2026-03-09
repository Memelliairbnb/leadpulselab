import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
        const res = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': process.env.INTERNAL_API_TOKEN ?? '',
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        return {
          id: String(data.userId),
          email: data.email,
          name: data.fullName,
          tenantId: data.tenantId,
          role: data.role,
          tenantName: data.tenantName,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = Number(user.id);
        token.tenantId = (user as any).tenantId;
        token.role = (user as any).role;
        token.tenantName = (user as any).tenantName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).userId = token.userId;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).role = token.role;
        (session.user as any).tenantName = token.tenantName;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Extend next-auth types
declare module 'next-auth' {
  interface User {
    tenantId: number;
    role: string;
    tenantName: string;
  }
  interface Session {
    user: {
      userId: number;
      tenantId: number;
      email: string;
      name: string;
      role: string;
      tenantName: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: number;
    tenantId: number;
    role: string;
    tenantName: string;
  }
}
