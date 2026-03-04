declare global {
  namespace Express {
    interface Request {
      agent?: { id: string; name: string; accountId: string };
      accountId?: string;
    }
  }
}

export {};
