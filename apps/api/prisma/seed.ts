import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';

const url = new URL(process.env.DATABASE_URL ?? '');
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1)
});
const prisma = new PrismaClient({ adapter });

const roles = [
  ['PLAYER', '玩家'],
  ['TEAM_CAPTAIN', '战队队长'],
  ['EVENT_MANAGER', '赛事管理员'],
  ['REFEREE', '裁判'],
  ['PLATFORM_ADMIN', '平台管理员']
] as const;

const catalogPermissions = [
  ['catalog.import.create', 'Create player import batches'],
  ['catalog.import.read', 'Read player import batches'],
  ['catalog.import.publish', 'Publish player import batches']
] as const;

await prisma.$transaction(async (transaction) => {
  for (const [code, name] of roles) {
    await transaction.role.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
  }

  const platformAdmin = await transaction.role.findUniqueOrThrow({
    where: { code: 'PLATFORM_ADMIN' }
  });

  for (const [code, name] of catalogPermissions) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    await transaction.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: platformAdmin.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        roleId: platformAdmin.id,
        permissionId: permission.id
      }
    });
  }

  await transaction.dataSource.upsert({
    where: { code: 'manual' },
    update: { name: 'Manual import', isEnabled: true },
    create: { code: 'manual', name: 'Manual import', type: 'MANUAL' }
  });

  await transaction.dataSource.upsert({
    where: { code: 'pesdata' },
    update: { name: 'PESDATA authorized sync', type: 'API', isEnabled: true },
    create: { code: 'pesdata', name: 'PESDATA authorized sync', type: 'API' }
  });
});

await prisma.$disconnect();
