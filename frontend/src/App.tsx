import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import CardDetail from "./pages/CardDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
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
import { getAuthToken } from "./utils/api";

// import TemplatesPage from "./pages/TemplatesPage";
// import ReportBuilderPage from "./pages/ReportBuilderPage";

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = getAuthToken();
  if (!token) {
    return <Navigate to="/login" replace />;
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

      {/* Protected routes with sidebar */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <MainLayout>
              <Dashboard />
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
        path="/home"
        element={
          <RequireAuth>
            <MainLayout>
              <Home />
            </MainLayout>
          </RequireAuth>
        }
      />

      <Route
        path="/chart"
        element={
          <RequireAuth>
            <MainLayout>
              <ChartPage />
            </MainLayout>
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

      <Route
        path="/ai-charts"
        element={
          <RequireAuth>
            <MainLayout>
              <AiChartsPage />
            </MainLayout>
          </RequireAuth>
        }
      />

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

      {/* If you don't need this, you can remove it.
          You already have /card/:cardId */}
      <Route
        path="/card-detail"
        element={
          <RequireAuth>
            <CardDetail />
          </RequireAuth>
        }
      />

      <Route
        path="/audit-log"
        element={
          <RequireAuth>
            <MainLayout>
              <AuditLogViewer />
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
              <UserManagementPage />
            </MainLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/system-health"
        element={
          <RequireAuth>
            <MainLayout>
              <SystemHealthPage />
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

      {/* Templates */}
      {/* <Route
        path="/templates"
        element={
          <RequireAuth>
            <MainLayout>
              <TemplatesPage />
            </MainLayout>
          </RequireAuth>
        }
      /> */}

      {/* Report Builder (IMPORTANT) */}
      {/* <Route
        path="/report-builder/:templateId"
        element={
          <RequireAuth>
            <MainLayout>
              <ReportBuilderPage />
            </MainLayout>
          </RequireAuth>
        }
      /> */}

      {/* Optional fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Router>
);

export default App;
