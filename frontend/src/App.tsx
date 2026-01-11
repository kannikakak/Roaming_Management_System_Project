import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home";
import Dashboard from "./components/Dashboard";
import CardDetail from "./components/CardDetail";
import Login from "./components/Login";
import Register from "./components/Register";
import ChartPage from "./components/ChartPage";
import MainLayout from "./components/MainLayout";
import Projects from "./components/Projects";
import AuditLogViewer from "./components/AuditLogViewer";
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
