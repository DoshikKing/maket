import { AsyncLocalStorage } from 'node:async_hooks';
// Request-local selection: concurrent requests and browser tabs never change one another's model.
export const workspaceScope = new AsyncLocalStorage<string | undefined>();
export const requestedWorkspaceId = () => workspaceScope.getStore();
