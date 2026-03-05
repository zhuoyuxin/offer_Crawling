import type { Response } from "express";
import type { ErrorCode } from "./constants";
import type { ApiError } from "./types";

export function sendError(res: Response, status: number, code: ErrorCode, message: string): Response<ApiError> {
  return res.status(status).json({ code, message });
}
