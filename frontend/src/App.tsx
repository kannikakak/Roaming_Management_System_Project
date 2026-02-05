import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import CardDetail from "./pages/CardDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AuthCallback from "./pages/AuthCallback";
import ChartPage from "./pages/ChartPage";
import MainLayout from "./components/MainLayout";
import Projects from "./pages/Projects";
import AuditLogViewer from "./pages/AuditLogViewer";
import SlideBuilderPage from "./pages/SlideBuilderPage";
import SchedulesPage from "./pages/SchedulesPage";
import AiChartsPage from "./pages/AiChartsPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import ReportsLibraryPage from "./pages/ReportsLibraryPage";
import DataExplorerPage from "./pages/DataExplorerPage";
import DeliveryHistoryPage from "./pages/DeliveryHistoryPage";
import MyActivityPage from "./pages/MyActivityPage";
import TemplateManagerPage from "./pages/TemplateManagerPage";
import UserManagementPage from "./pages/UserManagementPage";
import SystemHealthPage from "./pages/SystemHealthPage";
import SystemSecurityPage from "./pages/SystemSecurityPage";
import { getAuthToken } from "./utils/api";
import GlobalSearchPage from "./pages/GlobalSearchPage";
import DashboardAnalyticsPage from "./pages/DashboardAnalyticsPage";
import OperationsCenterPage from "./pages/OperationsCenterPage";
import DataQualityPage from "./pages/DataQualityPage";

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = getAuthToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const getStoredUser = () => {
  const raw = localStorage.getItem("authUser");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const hasRole = (user: any, roles: string[]) => {
  if (!user) return false;
  const roleList = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean);
  return roleList.some((role: string) => roles.includes(role));
};

const RequireRole: React.FC<{ roles: string[]; children: React.ReactNode }> = ({ roles, children }) => {
  const token = getAuthToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  const user = getStoredUser();
  if (!hasRole(user, roles)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => (
  <Router>
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/auth/microsoft/callback" element={<AuthCallback />} />

      {/* Protected routes with sidebar */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <MainLayout>
              <DashboardAnalyticsPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/operations"
        element={
          <RequireAuth>
            <MainLayout>
              <OperationsCenterPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/data-quality"
        element={
          <RequireAuth>
            <MainLayout>
              <DataQualityPage />
            </MainLayout>
          </RequireAuth>
        }
      />

      <Route
        path="/card/:cardId"
        element={
          <RequireAuth>
            <CardDetail />
          </RequireAuth>
        }
      />

      <Route
        path="/charts"
        element={
          <RequireAuth>
            <MainLayout>
              <ChartPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route path="/chart" element={<Navigate to="/charts" replace />} />

      <Route
        path="/ai-studio"
        element={
          <RequireAuth>
            <MainLayout>
              <AiChartsPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route path="/ai-charts" element={<Navigate to="/ai-studio" replace />} />
      <Route path="/insights" element={<Navigate to="/ai-studio" replace />} />

      <Route
        path="/projects"
        element={
          <RequireAuth>
            <MainLayout>
            <Projects />
            </MainLayout>
          </RequireAuth>

        }
      />

      <Route
        path="/audit-log"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin"]}>
                <AuditLogViewer />
              </RequireRole>
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/schedules"
        element={
          <RequireAuth>
            <MainLayout>
              <SchedulesPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/slide-builder"
        element={
          <RequireAuth>
            <MainLayout>
              <SlideBuilderPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/reports-library"
        element={
          <RequireAuth>
            <MainLayout>
              <ReportsLibraryPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/data-explorer"
        element={
          <RequireAuth>
            <MainLayout>
              <DataExplorerPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/search"
        element={
          <RequireAuth>
            <MainLayout>
              <GlobalSearchPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/delivery-history"
        element={
          <RequireAuth>
            <MainLayout>
              <DeliveryHistoryPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/my-activity"
        element={
          <RequireAuth>
            <MainLayout>
              <MyActivityPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <MainLayout>
              <TemplateManagerPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin"]}>
                <UserManagementPage />
              </RequireRole>
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/system-health"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin"]}>
                <SystemHealthPage />
              </RequireRole>
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/security-center"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin"]}>
                <SystemSecurityPage />
              </RequireRole>
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <MainLayout>
              <AccountSettingsPage />
            </MainLayout>
          </RequireAuth>
        }
      />

      {/* Fallback route */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Router>
);

export default App;
