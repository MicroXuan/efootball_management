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
  ['LEAGUE_MANAGER', '联赛管理员'],
  ['SEASON_MANAGER', '赛季管理员'],
  ['EVENT_MANAGER', '赛事管理员'],
  ['REFEREE', '裁判'],
  ['PLATFORM_ADMIN', '平台管理员']
] as const;

const catalogPermissions = [
  ['catalog.import.create', 'Create player import batches'],
  ['catalog.import.read', 'Read player import batches'],
  ['catalog.import.publish', 'Publish player import batches']
] as const;

const competitionPermissions = [
  ['competition.create', 'Create competitions'],
  ['competition.manage', 'Manage a competition'],
  ['competition.registration.review', 'Review competition registrations'],
  ['competition.schedule.manage', 'Manage competition schedules'],
  ['competition.result.manage', 'Manage official competition results']
] as const;

const leaguePermissions = [
  ['league.create', 'Create leagues'],
  ['league.manage', 'Manage a league'],
  ['season.manage', 'Manage a league season'],
  ['season.registration.review', 'Review season entries']
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
  const eventManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'EVENT_MANAGER' }
  });
  const leagueManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'LEAGUE_MANAGER' }
  });
  const seasonManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'SEASON_MANAGER' }
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

  for (const [index, [code, name]] of competitionPermissions.entries()) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    const rolesToGrant = index === 0 ? [platformAdmin] : [platformAdmin, eventManager];

    for (const role of rolesToGrant) {
      await transaction.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  for (const [index, [code, name]] of leaguePermissions.entries()) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    const rolesToGrant = index === 0
      ? [platformAdmin]
      : index === 1
        ? [platformAdmin, leagueManager]
        : [platformAdmin, leagueManager, seasonManager];

    for (const role of rolesToGrant) {
      await transaction.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
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
