declare global {
  namespace Express {
    interface Request {
      agent?: { id: string; name: string; accountId: string; trustTier?: string };
      accountId?: string;
    }
  }
}

export {};
