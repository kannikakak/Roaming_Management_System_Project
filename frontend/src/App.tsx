import React, { Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AuthCallback from "./pages/AuthCallback";
import MainLayout from "./components/MainLayout";
import { getAuthToken } from "./utils/api";

// Lazy load heavy components
const CardDetail = React.lazy(() => import("./pages/CardDetail"));
const ChartPage = React.lazy(() => import("./pages/ChartPage"));
const Projects = React.lazy(() => import("./pages/Projects"));
const AuditLogViewer = React.lazy(() => import("./pages/AuditLogViewer"));
const SlideBuilderPage = React.lazy(() => import("./pages/SlideBuilderPage"));
const SchedulesPage = React.lazy(() => import("./pages/SchedulesPage"));
const AiChartsPage = React.lazy(() => import("./pages/AiChartsPage"));
const AccountSettingsPage = React.lazy(() => import("./pages/AccountSettingsPage"));
const ReportsLibraryPage = React.lazy(() => import("./pages/ReportsLibraryPage"));
const DataExplorerPage = React.lazy(() => import("./pages/DataExplorerPage"));
const DeliveryHistoryPage = React.lazy(() => import("./pages/DeliveryHistoryPage"));
const MyActivityPage = React.lazy(() => import("./pages/MyActivityPage"));
const TemplateManagerPage = React.lazy(() => import("./pages/TemplateManagerPage"));
const PartnerScorecardPage = React.lazy(() => import("./pages/PartnerScorecardPage"));
const DataSourcesPage = React.lazy(() => import("./pages/DataSourcesPage"));
const IngestionHistoryPage = React.lazy(() => import("./pages/IngestionHistoryPage"));
const UserManagementPage = React.lazy(() => import("./pages/UserManagementPage"));
const SystemHealthPage = React.lazy(() => import("./pages/SystemHealthPage"));
const SystemSecurityPage = React.lazy(() => import("./pages/SystemSecurityPage"));
const AlertCenterPage = React.lazy(() => import("./pages/AlertCenterPage"));
const BackupRestorePage = React.lazy(() => import("./pages/BackupRestorePage"));
const GlobalSearchPage = React.lazy(() => import("./pages/GlobalSearchPage"));
const DashboardAnalyticsPage = React.lazy(() => import("./pages/DashboardAnalyticsPage"));
const DataQualityPage = React.lazy(() => import("./pages/DataQualityPage"));
const ComplaintInvestigationPage = React.lazy(() => import("./pages/ComplaintInvestigationPage"));

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

const PublicEntry: React.FC = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.get("resetToken")) {
    return <ResetPassword />;
  }
  return <Login />;
};

const App: React.FC = () => (
  <Router>
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<PublicEntry />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
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
        element={<Navigate to="/dashboard" replace />}
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
      <Route
        path="/partner-scorecard"
        element={
          <RequireAuth>
            <MainLayout>
              <PartnerScorecardPage />
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
              <RequireRole roles={["admin", "analyst"]}>
                <ReportsLibraryPage />
              </RequireRole>
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
        path="/data-sources"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin", "analyst"]}>
                <DataSourcesPage />
              </RequireRole>
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/ingestion-history"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin", "analyst"]}>
                <IngestionHistoryPage />
              </RequireRole>
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
        path="/complaint-desk"
        element={
          <RequireAuth>
            <MainLayout>
              <ComplaintInvestigationPage />
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
        path="/alert-center"
        element={
          <RequireAuth>
            <MainLayout>
              <AlertCenterPage />
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
        path="/backup-restore"
        element={
          <RequireAuth>
            <MainLayout>
              <RequireRole roles={["admin"]}>
                <BackupRestorePage />
              </RequireRole>
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
