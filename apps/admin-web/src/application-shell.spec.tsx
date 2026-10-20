import { presentAdminDisplayName } from './application-shell';

it('localizes the legacy seeded administrator name without changing custom names', () => {
  expect(presentAdminDisplayName('Local Platform Administrator')).toBe('本地平台管理员');
  expect(presentAdminDisplayName('小宣')).toBe('小宣');
});
