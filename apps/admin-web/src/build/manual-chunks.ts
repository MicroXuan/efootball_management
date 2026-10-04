const packagePath = (moduleId: string, packageName: string) =>
  moduleId.includes(`/node_modules/${packageName}/`);

export function adminManualChunk(moduleId: string): string | undefined {
  const id = moduleId.replaceAll('\\', '/');
  if (!id.includes('/node_modules/')) return undefined;

  if (['react', 'react-dom', 'scheduler'].some((name) => packagePath(id, name))) return 'framework';
  if (['react-router', 'react-router-dom'].some((name) => packagePath(id, name))) return 'router';
  if (packagePath(id, 'antd')) return 'antd';
  if (
    id.includes('/node_modules/rc-')
    || id.includes('/node_modules/@rc-component/')
    || id.includes('/node_modules/@ant-design/')
    || packagePath(id, 'dayjs')
  ) return 'antd-runtime';
  if (packagePath(id, 'zod')) return 'schema';
  return 'vendor';
}
