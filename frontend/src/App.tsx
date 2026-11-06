import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import LoginPage from "./pages/LoginPage";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import OrdersPage from "./pages/OrdersPage";
import UploadPage from "./pages/UploadPage";
import CynergyFormsPage from "./pages/CynergyFormsPage";
import ItemsPage from "./pages/ItemsPage";
import PricingPage from "./pages/PricingPage";
import MasterPage from "./pages/MasterPage";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import { AppBootSkeleton } from "./components/Skeleton";

function ProtectedRoute({ children, page }: { children: React.ReactNode; page: string }) {
  const { user, loading, canPage } = useAuth();
  if (loading) {
    return (
      <AppBootSkeleton />
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!canPage(page)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <AppBootSkeleton />
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={user ? <Layout /> : <Navigate to="/login" replace />}
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute page="dashboard">
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="orders"
          element={
            <ProtectedRoute page="orders">
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route path="production" element={<Navigate to="/orders" replace />} />
        <Route
          path="upload"
          element={
            <ProtectedRoute page="upload">
              <UploadPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="cynergy-forms"
          element={
            <ProtectedRoute page="cynergy-forms">
              <CynergyFormsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="items"
          element={
            <ProtectedRoute page="items">
              <ItemsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="pricing"
          element={
            <ProtectedRoute page="pricing">
              <PricingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="master"
          element={
            <ProtectedRoute page="master">
              <MasterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute page="users">
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
