import { AuthScreen } from '@/components/auth-screen';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <AuthScreen
      mode="login"
      recoveryAvailable={process.env.NODE_ENV !== 'production' || !!process.env.MAIL_WEBHOOK_URL}
    />
  );
}
