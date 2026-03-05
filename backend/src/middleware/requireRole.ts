import type { NextFunction, Request, Response } from "express";
import { ERROR_CODES, type UserRole } from "../constants";
import { sendError } from "../http";

export function requireRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      sendError(res, 401, ERROR_CODES.UNAUTHORIZED, "请先登录");
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      sendError(res, 403, ERROR_CODES.FORBIDDEN, "权限不足");
      return;
    }
    next();
  };
}
