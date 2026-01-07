import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './components/Dashboard';
import CardDetail from './components/CardDetail';
import Login from './components/Login';
import Register from './components/Register';
import ChartPage from './components/ChartPage';
import MainLayout from './components/MainLayout';
import Projects from './components/Projects';

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
            <Route
                path="/card-detail"
                element={
                    <MainLayout>
                        <CardDetail />
                    </MainLayout>
                }
            />
        </Routes>
    </Router>
);

export default App;