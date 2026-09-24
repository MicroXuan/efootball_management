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

for (const [code, name] of roles) {
  await prisma.role.upsert({
    where: { code },
    update: { name },
    create: { code, name }
  });
}

await prisma.$disconnect();

