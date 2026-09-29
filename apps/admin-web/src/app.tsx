import { Button, ConfigProvider, Layout, Menu, Tag } from 'antd';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminSessionProvider, useAdminSession } from './auth/admin-session';
import { LoginPage } from './auth/login-page';
import { ProtectedRoute } from './auth/protected-route';

const { Header, Sider, Content } = Layout;

function ApplicationShell() {
  const session = useAdminSession();
  const admin = session.identity?.admin;
  return (
    <Layout className="admin-shell">
      <Sider width={256} className="admin-sider">
        <div className="shell-brand"><span>EFM</span><strong>赛事控制台</strong></div>
        <Menu
          mode="inline"
          selectedKeys={['overview']}
          items={[
            { key: 'overview', label: '控制台概览' },
            { key: 'leagues', label: '联赛工作台', disabled: true },
            { key: 'teams', label: '用户与球队', disabled: true },
            { key: 'rosters', label: '球队阵容', disabled: true }
          ]}
        />
        <div className="shell-version">ADMIN SYSTEM / 0.1</div>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div><span className="section-kicker">OPERATIONS</span><strong>管理工作台</strong></div>
          <div className="admin-identity">
            <Tag color="green">{session.identity?.platformAdmin ? '平台管理员' : '联赛管理员'}</Tag>
            <span>{admin?.displayName}</span>
            <Button type="text" onClick={() => void session.logout()}>退出登录</Button>
          </div>
        </Header>
        <Content className="admin-content">
          <section className="empty-dashboard">
            <span className="section-kicker">FOUNDATION READY</span>
            <h1>后台会话已连接</h1>
            <p>联赛、球队、阵容和工资管理页面将在下一阶段接入。</p>
          </section>
        </Content>
      </Layout>
    </Layout>
  );
}

export function App() {
  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#22c77a',
        colorInfo: '#22c77a',
        colorWarning: '#d6a437',
        colorError: '#e76f51',
        borderRadius: 6,
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
      }
    }}>
      <AdminSessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<ApplicationShell />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AdminSessionProvider>
    </ConfigProvider>
  );
}
