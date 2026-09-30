import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAdminSession } from './admin-session';

export function ProtectedRoute() {
  const session = useAdminSession();
  const location = useLocation();
  if (session.phase === 'checking') {
    return <div className="session-loader" role="status"><Spin /> 正在恢复后台会话…</div>;
  }
  if (session.phase !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
