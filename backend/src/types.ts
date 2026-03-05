import type { ApplicationStatus, ErrorCode, UserRole, UserStatus } from "./constants";

export interface JobListItem {
  postId: string;
  dataId: string;
  title: string;
  companyName: string;
  location: string;
  recruitmentType: string;
  targetCandidates: string;
  position: string;
  progressStatus: string;
  deadline: string;
  updateTime: string;
  detailUrl: string;
  sourcePage: string;
  crawledAt: string;
  applicationId: number | null;
  applicationStatus: ApplicationStatus;
}

export interface ApplicationRecord {
  id: number;
  postId: string | null;
  companyName: string;
  position: string;
  location: string;
  detailUrl: string;
  status: ApplicationStatus;
  appliedAt: string;
  followUpAt: string | null;
  channel: string;
  contact: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface SessionPayload {
  sessionId: number;
  tokenHash: string;
  fingerprintHash: string;
  expiresAt: string;
  user: AuthUser;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface AdminUserListItem {
  id: number;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
