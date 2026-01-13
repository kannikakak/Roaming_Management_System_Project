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

// import TemplatesPage from "./pages/TemplatesPage";
// import ReportBuilderPage from "./pages/ReportBuilderPage";

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
          <MainLayout>
            <Dashboard />
          </MainLayout>
        }
      />

      <Route
        path="/card/:cardId"
        element={
          <MainLayout>
            <CardDetail />
          </MainLayout>
        }
      />

      <Route
        path="/home"
        element={
          <MainLayout>
            <Home />
          </MainLayout>
        }
      />

      <Route
        path="/chart"
        element={
          <MainLayout>
            <ChartPage />
          </MainLayout>
        }
      />

      <Route
        path="/charts"
        element={
          <MainLayout>
            <ChartPage />
          </MainLayout>
        }
      />

      <Route
        path="/projects"
        element={
          <MainLayout>
            <Projects />
          </MainLayout>
        }
      />

      {/* If you don't need this, you can remove it.
          You already have /card/:cardId */}
      <Route
        path="/card-detail"
        element={
          <MainLayout>
            <CardDetail />
          </MainLayout>
        }
      />

      <Route
        path="/audit-log"
        element={
          <MainLayout>
            <AuditLogViewer />
          </MainLayout>
        }
      />
      <Route
  path="/slide-builder"
  element={
    <MainLayout>
      <SlideBuilderPage />
    </MainLayout>
  }
/>

      {/* Templates */}
      {/* <Route
        path="/templates"
        element={
          <MainLayout>
            <TemplatesPage />
          </MainLayout>
        }
      /> */}

      {/* Report Builder (IMPORTANT) */}
      {/* <Route
        path="/report-builder/:templateId"
        element={
          <MainLayout>
            <ReportBuilderPage />
          </MainLayout>
        }
      /> */}

      {/* Optional fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Router>
);

export default App;
