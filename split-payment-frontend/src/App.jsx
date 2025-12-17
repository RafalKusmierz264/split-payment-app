import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api";
import LoginPage from "./pages/LoginPage";
import GroupsPage from "./pages/GroupsPage";
import GroupDetailsPage from "./pages/GroupDetailsPage";

function RequireAuth({ children }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const hasToken = !!getToken();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={hasToken ? "/groups" : "/login"} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/groups"
          element={
            <RequireAuth>
              <GroupsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/groups/:groupId"
          element={
            <RequireAuth>
              <GroupDetailsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
