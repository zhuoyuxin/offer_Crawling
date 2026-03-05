import type { SessionPayload } from "./types";

declare global {
  namespace Express {
    interface Request {
      auth?: SessionPayload;
    }
  }
}

export {};
