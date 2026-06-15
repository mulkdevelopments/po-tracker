import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import LoginPage from "./pages/LoginPage";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import OrdersPage from "./pages/OrdersPage";
import ProductionPage from "./pages/ProductionPage";
import UploadPage from "./pages/UploadPage";
import ItemsPage from "./pages/ItemsPage";
import PricingPage from "./pages/PricingPage";
import MasterPage from "./pages/MasterPage";
import UsersPage from "./pages/UsersPage";

function ProtectedRoute({ children, page }: { children: React.ReactNode; page: string }) {
  const { user, loading, canPage } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50">
        <div className="text-slate-500">Loading…</div>
      </div>
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
      <div className="min-h-screen grid place-items-center bg-slate-50">
        <div className="text-slate-500">Loading…</div>
      </div>
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
        <Route
          path="production"
          element={
            <ProtectedRoute page="production">
              <ProductionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="upload"
          element={
            <ProtectedRoute page="upload">
              <UploadPage />
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
