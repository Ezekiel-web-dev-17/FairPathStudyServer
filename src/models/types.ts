/**
 * Shared type definitions and custom interfaces
 * for request/response payloads across the FairPath API.
 */

// ── Pagination ──
export interface PaginationMeta {
  total: number;
  pages: number;
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// ── Auth Payloads ──
export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    profileCompletionPercent: number;
  };
}

// ── Profile Update ──
export interface ProfileUpdatePayload {
  academicData?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  countryOfOrigin?: string;
  targetDestinations?: string[];
  firstName?: string;
  lastName?: string;
}

// ── Dashboard ──
export interface DashboardSummary {
  completionPercent: number;
  activeAppsCount: number;
  deadlineAlerts: {
    id: string;
    title: string;
    deadline: Date;
    type: 'APPLICATION' | 'SCHOLARSHIP';
  }[];
}

// ── Favourites ──
export interface AddFavouritePayload {
  matchType: 'UNIVERSITY' | 'SCHOLARSHIP';
  matchId: string;
}

// ── Admin Analytics ──
export interface AdminAnalytics {
  totalUsers: number;
  activeApps: number;
  featuredPartners: number;
}
