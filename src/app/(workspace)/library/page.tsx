import { redirect } from 'next/navigation';
export default function Page() {
  redirect('/solutions?view=diagrams');
}
