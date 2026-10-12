import { cookies } from 'next/headers';
import { listWorkspaces } from '@/lib/workspace-service';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Workspace, User } from '@/components/workspace';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const areas = await listWorkspaces(user.id);
  const lastId = (await cookies()).get('maket_workspace')?.value;
  const current = areas.find((a) => a.id === lastId) ?? areas[0];
  return (
    <Workspace
      initialWorkspaces={areas}
      workspaceId={current.id}
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
