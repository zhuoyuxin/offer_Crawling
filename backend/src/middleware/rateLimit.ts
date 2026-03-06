import rateLimit from "express-rate-limit";
import {
  LOGIN_RATE_MAX,
  LOGIN_RATE_WINDOW_MS,
  REGISTER_RATE_MAX,
  REGISTER_RATE_WINDOW_MS,
} from "../constants";

export const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_WINDOW_MS,
  max: LOGIN_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "登录请求过于频繁，请稍后再试" },
});

export const registerLimiter = rateLimit({
  windowMs: REGISTER_RATE_WINDOW_MS,
  max: REGISTER_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "注册请求过于频繁，请稍后再试" },
});
