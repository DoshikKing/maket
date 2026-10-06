import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Workspace, User } from '@/components/workspace';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <Workspace
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        settings: user.settings as User['settings'],
      }}
    >
      {children}
    </Workspace>
  );
}
