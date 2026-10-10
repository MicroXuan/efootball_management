import { Button, Layout, Menu, Tag } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAdminSession } from './auth/admin-session';
import { AdminIcon } from './design-system/icons';

const { Header, Sider, Content } = Layout;

export function ApplicationShell() {
  const session = useAdminSession();
  const location = useLocation();
  const admin = session.identity?.admin;
  const platformItems = session.identity?.platformAdmin ? [
    { key: '/platform/leagues', icon: <AdminIcon name="league" />, label: <Link aria-current={location.pathname === '/platform/leagues' ? 'page' : undefined} to="/platform/leagues">联赛管理</Link> },
    { key: '/platform/presentation', icon: <AdminIcon name="league" />, label: <Link aria-current={location.pathname === '/platform/presentation' ? 'page' : undefined} to="/platform/presentation">前台展示</Link> },
    { key: '/platform/data-sync', icon: <AdminIcon name="sync" />, label: <Link aria-current={location.pathname === '/platform/data-sync' ? 'page' : undefined} to="/platform/data-sync">数据同步</Link> },
    { key: '/platform/wechat-bot', icon: <AdminIcon name="bot" />, label: <Link aria-current={location.pathname === '/platform/wechat-bot' ? 'page' : undefined} to="/platform/wechat-bot">群机器人</Link> },
    { key: '/platform/admins', icon: <AdminIcon name="administrators" />, label: <Link aria-current={location.pathname === '/platform/admins' ? 'page' : undefined} to="/platform/admins">账号管理</Link> },
    { key: '/platform/audit', icon: <AdminIcon name="audit" />, label: <Link aria-current={location.pathname === '/platform/audit' ? 'page' : undefined} to="/platform/audit">审计日志</Link> }
  ] : [];
  const leagueItems = (session.identity?.leagueGrants ?? []).map((grant) => ({
    key: `/leagues/${grant.leagueId}`,
    icon: <AdminIcon name="league" />,
    label: <Link aria-current={location.pathname.startsWith(`/leagues/${grant.leagueId}`) ? 'page' : undefined} to={`/leagues/${grant.leagueId}/teams`}>{grant.leagueName}</Link>
  }));
  const selectedKey = leagueItems.find((item) => location.pathname.startsWith(item.key))?.key ?? location.pathname;

  return (
    <Layout className="admin-shell">
      <Sider width={272} className="admin-sider">
        <div className="shell-brand"><span>球</span><strong>赛事控制台</strong></div>
        <nav aria-label="后台主导航"><Menu mode="inline" selectedKeys={[selectedKey]} items={[
          ...(platformItems.length ? [{ type: 'group' as const, label: '平台管理', children: platformItems }] : []),
          ...(leagueItems.length ? [{ type: 'group' as const, label: '我的联赛', children: leagueItems }] : [])
        ]} /></nav>
        <div className="shell-version">管理系统 · 0.2</div>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div><span className="section-kicker">赛事运营</span><strong>管理工作台</strong></div>
          <div className="admin-identity">
            <Tag color="success">{session.identity?.platformAdmin ? '平台管理员' : '联赛管理员'}</Tag>
            <span>{admin?.displayName}</span>
            <Button type="text" onClick={() => void session.logout()}>退出登录</Button>
          </div>
        </Header>
        <Content className="admin-content"><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
