import { describe, expect, it } from 'vitest';
import { adminManualChunk } from './manual-chunks';

describe('adminManualChunk', () => {
  it.each([
    ['/repo/node_modules/.pnpm/react@19/node_modules/react/index.js', 'framework'],
    ['/repo/node_modules/.pnpm/react-dom@19/node_modules/react-dom/client.js', 'framework'],
    ['/repo/node_modules/.pnpm/react-router-dom@7/node_modules/react-router-dom/dist/index.js', 'router'],
    ['/repo/node_modules/.pnpm/antd@6/node_modules/antd/es/button/index.js', 'antd'],
    ['/repo/node_modules/.pnpm/rc-table@7/node_modules/rc-table/es/index.js', 'antd-runtime'],
    ['/repo/node_modules/.pnpm/@ant-design+cssinjs@2/node_modules/@ant-design/cssinjs/es/index.js', 'antd-runtime'],
    ['/repo/node_modules/.pnpm/zod@4/node_modules/zod/index.js', 'schema'],
    ['/repo/node_modules/.pnpm/axios@1/node_modules/axios/index.js', 'vendor'],
  ])('puts %s in the stable %s chunk', (moduleId, expected) => {
    expect(adminManualChunk(moduleId)).toBe(expected);
  });

  it('leaves application modules to route-level code splitting', () => {
    expect(adminManualChunk('/repo/apps/admin-web/src/leagues/teams-page.tsx')).toBeUndefined();
  });
});
