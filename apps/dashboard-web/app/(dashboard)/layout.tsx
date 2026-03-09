import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { SessionWrapper } from './session-wrapper';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <SessionWrapper>
      <div className="min-h-screen bg-surface">
        <Sidebar />
        <Header />
        <main className="ml-56 pt-14">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </SessionWrapper>
  );
}
