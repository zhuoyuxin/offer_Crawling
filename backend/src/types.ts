import type { ApplicationStatus } from "./constants";

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
