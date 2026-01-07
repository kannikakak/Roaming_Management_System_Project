export interface DashboardData {
    id: number;
    name: string;
    value: number;
    timestamp: string;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export interface ErrorResponse {
    success: false;
    message: string;
}