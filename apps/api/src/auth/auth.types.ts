import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
  authToken?: string;
}

export interface SessionResult {
  user: AuthenticatedUser;
  token: string;
  sessionId: string;
}
