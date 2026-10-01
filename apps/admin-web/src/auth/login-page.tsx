import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAdminSession } from './admin-session';

type LoginFields = { username: string; password: string };

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.code === 'ADMIN_CREDENTIALS_INVALID') return '账号或密码不正确';
    if (error.status >= 500) return `后台服务暂时不可用${error.requestId ? `（请求 ${error.requestId}）` : ''}`;
  }
  return '登录失败，请检查网络后重试';
};

export function LoginPage() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    if (session.phase === 'authenticated') navigate(from, { replace: true });
  }, [from, navigate, session.phase]);

  const submit = async (values: LoginFields) => {
    setError(null);
    setSubmitting(true);
    try {
      await session.login(values);
      navigate(from, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-stage">
      <section className="login-field" aria-hidden="true">
        <span className="pitch-line pitch-line--half" />
        <span className="pitch-circle" />
        <div className="brand-lockup">
          <span className="brand-kicker">联赛运营中枢</span>
          <strong>非概念实况</strong>
          <span>赛事规则、球队阵容与财务流水，在同一块战术板上。</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-index">安全登录 · 01</div>
          <h1>赛事管理后台</h1>
          <p>使用平台管理员或已授权的联赛管理员账号登录。</p>
          {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
          <Form<LoginFields> layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item label="管理员账号" name="username" rules={[{ required: true, message: '请输入管理员账号' }]}>
              <Input autoComplete="username" placeholder="例如 manager01" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" placeholder="输入后台密码" />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={submitting}>登录后台</Button>
          </Form>
          <div className="login-note">账号由平台管理员分配 · 第一版不提供自助注册与找回密码</div>
        </div>
      </section>
    </main>
  );
}
