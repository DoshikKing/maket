import { AuthScreen } from '@/components/auth-screen';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AuthScreen mode="verify" token={token} />;
}
