import { handleApi } from '@/lib/api-handler';
export const runtime = 'nodejs';
export {
  handleApi as GET,
  handleApi as POST,
  handleApi as PUT,
  handleApi as PATCH,
  handleApi as DELETE,
};
