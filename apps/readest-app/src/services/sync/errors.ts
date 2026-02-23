export class WebDAVUnavailableError extends Error {
  constructor(message = 'WebDAV sync unavailable') {
    super(message);
    this.name = 'WebDAVUnavailableError';
  }
}

export const isWebDAVUnavailableError = (error: unknown): boolean => {
  return error instanceof WebDAVUnavailableError;
};

