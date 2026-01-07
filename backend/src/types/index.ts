export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface DashboardData {
    totalUsers: number;
    activeSessions: number;
    roamingCharges: number;
}

export interface FetchDashboardDataRequest {
    userId: string;
}

export interface FetchDashboardDataResponse extends ApiResponse<DashboardData> {}