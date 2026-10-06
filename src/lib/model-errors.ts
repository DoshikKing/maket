export class ModelError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function reject(status: number, message: string): never {
  throw new ModelError(status, message);
}
