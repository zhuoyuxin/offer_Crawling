export const APPLICATION_STATUSES = [
  "未投递",
  "已投递",
  "已笔试",
  "已面试",
  "已挂",
  "面试通过",
  "暂不投递",
  "正在面试",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
