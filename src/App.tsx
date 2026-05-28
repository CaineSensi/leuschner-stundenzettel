import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./routes/Login";
import Home from "./routes/Home";
import Entry from "./routes/Entry";
import Onboarding from "./routes/Onboarding";
import Day from "./routes/Day";
import Admin from "./routes/Admin";
import AdminLogin from "./routes/AdminLogin";
import Plan from "./routes/Plan";
import Sites from "./routes/Sites";
import SiteDetail from "./routes/SiteDetail";
import Hours from "./routes/Hours";
import Zeiterfassung from "./routes/Zeiterfassung";
import StundenPrint from "./routes/StundenPrint";
import Angebote from "./routes/Angebote";
import Anfragen from "./routes/Anfragen";
import AnfrageNeu from "./routes/AnfrageNeu";
import AngebotNeu from "./routes/AngebotNeu";
import AuthCallback from "./routes/AuthCallback";
import OfflineIndicator from "./components/OfflineIndicator";
import InstallPrompt from "./components/InstallPrompt";
import UpdatePrompt from "./components/UpdatePrompt";
import AdminPushBanner from "./components/AdminPushBanner";
import { currentUser, isOnboarded, syncWorkerFromSession } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { syncPending } from "./lib/sync";

function ProtectedRoute({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  if (!isOnboarded()) return <Navigate to={adminOnly ? "/buero" : "/onboarding"} replace />;
  const user = currentUser();
  if (!user) return <Navigate to={adminOnly ? "/buero" : "/login"} replace />;
  if (adminOnly && !user.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RoleRoot() {
  const user = currentUser();
  if (!user) return <Navigate to="/login" replace />;
  // Admin landet beim ersten Login auf /admin, kann aber via Link auch /home öffnen
  return <Home />;
}

export default function App() {
  useEffect(() => {
    if (!supabase) return;
    // Bei App-Start: prüfe ob Supabase-Session existiert und synce Worker
    syncWorkerFromSession();
    // Plus: ggf. wartende Einträge nachträglich hochladen
    syncPending();
    // Auth-State-Changes (z.B. nach Magic Link Klick)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session) await syncWorkerFromSession();
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="grain min-h-full">
      <div className="print:hidden">
        <AdminPushBanner />
        <OfflineIndicator />
        <InstallPrompt />
        <UpdatePrompt />
      </div>
      <Routes>
        <Route path="/onboarding"    element={<Onboarding />} />
        <Route path="/login"         element={<Login />} />
        <Route path="/buero"         element={<AdminLogin />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/"              element={<ProtectedRoute><RoleRoot /></ProtectedRoute>} />
        <Route path="/admin"         element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
        <Route path="/admin/zeiterfassung" element={<ProtectedRoute adminOnly><Zeiterfassung /></ProtectedRoute>} />
        <Route path="/admin/plan"    element={<ProtectedRoute adminOnly><Plan /></ProtectedRoute>} />
        <Route path="/admin/sites"     element={<ProtectedRoute adminOnly><Sites /></ProtectedRoute>} />
        <Route path="/admin/sites/:id" element={<ProtectedRoute adminOnly><SiteDetail /></ProtectedRoute>} />
        <Route path="/admin/stunden"   element={<ProtectedRoute adminOnly><Hours /></ProtectedRoute>} />
        <Route path="/admin/stunden-print" element={<ProtectedRoute adminOnly><StundenPrint /></ProtectedRoute>} />
        <Route path="/admin/angebote"     element={<ProtectedRoute adminOnly><Angebote /></ProtectedRoute>} />
        <Route path="/admin/anfragen"     element={<ProtectedRoute adminOnly><Anfragen /></ProtectedRoute>} />
        <Route path="/admin/anfrage-neu"  element={<ProtectedRoute adminOnly><AnfrageNeu /></ProtectedRoute>} />
        <Route path="/admin/angebot-neu/:cardId" element={<ProtectedRoute adminOnly><AngebotNeu /></ProtectedRoute>} />
        <Route path="/entry"         element={<ProtectedRoute><Entry /></ProtectedRoute>} />
        <Route path="/day/:date"     element={<ProtectedRoute><Day /></ProtectedRoute>} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
