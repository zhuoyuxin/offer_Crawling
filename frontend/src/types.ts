export const STATUS_OPTIONS = [
  "未投递",
  "已投递",
  "已笔试",
  "已面试",
  "已挂",
  "面试通过",
  "暂不投递",
  "正在面试",
] as const;

export type StatusType = (typeof STATUS_OPTIONS)[number];

export type UserRole = "user" | "vip" | "admin";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface ApiErrorShape {
  code: string;
  message: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface JobListItem {
  postId: string;
  dataId: string;
  title: string;
  companyName: string;
  companyType: string;
  location: string;
  recruitmentType: string;
  targetCandidates: string;
  position: string;
  progressStatus: string;
  deadline: string;
  updateTime: string;
  detailUrl: string;
  noticeUrl: string;
  companySize: string;
  sourcePage: string;
  crawledAt: string;
  applicationId: number | null;
  applicationStatus: StatusType;
}

export interface ApplicationRecord {
  id: number;
  postId: string | null;
  companyName: string;
  position: string;
  location: string;
  detailUrl: string;
  status: StatusType;
  appliedAt: string;
  followUpAt: string | null;
  channel: string;
  contact: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationPayload {
  postId?: string;
  companyName: string;
  position: string;
  location?: string;
  detailUrl?: string;
  status: StatusType;
  appliedAt: string;
  followUpAt?: string;
  channel?: string;
  contact?: string;
  notes?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {}

export interface LoginResponse {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
}

export interface AdminUserListItem {
  id: number;
  email: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
