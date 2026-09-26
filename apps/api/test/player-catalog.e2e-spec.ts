import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('player catalog lifecycle', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const sourceCode = `e2e-catalog-${suffix}`;
  const createdOpenIds: string[] = [];
  let app: INestApplication;
  let sourceId: string;
  let editorAuthorization: string;
  let ordinaryAuthorization: string;
  let publishedCardId: string;
  let publishedPlayerId: string;
  let publishedPackId: string;

  const record = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    externalId,
    playerExternalId: `player-${externalId}`,
    playerNameEn: `E2E Player ${suffix}`,
    cardName: 'Featured',
    position: 'CMF',
    overallRating: 96,
    cardType: 'FEATURED',
    packExternalId: 'e2e-pack',
    packName: 'E2E Pack',
    skills: ['Passing'],
    attributes: { passing: 96 },
    ...overrides
  });

  async function login(label: string) {
    const identity = `${label}-${suffix}`;
    const openId = `test-openid-${identity}`;
    createdOpenIds.push(openId);
    const response = await request(app.getHttpServer())
      .post('/v1/auth/wechat')
      .send({ code: `test-code-${identity}` })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: openId } });
    return { authorization: `Bearer ${response.body.accessToken as string}`, user };
  }

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    sourceId = (await prisma.dataSource.create({ data: { code: sourceCode, name: 'E2E catalog' } })).id;
    const editor = await login('editor');
    const ordinary = await login('ordinary');
    editorAuthorization = editor.authorization;
    ordinaryAuthorization = ordinary.authorization;

    const role = await prisma.role.create({
      data: { code: `E2E_EDITOR_${suffix}`, name: 'E2E editor' }
    });
    for (const code of ['catalog.import.create', 'catalog.import.read', 'catalog.import.publish']) {
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, name: code }
      });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma.userRoleBinding.create({
      data: { userId: editor.user.id, roleId: role.id, scopeType: 'PLATFORM' }
    });
  });

  afterAll(async () => {
    const cards = await prisma.playerCard.findMany({ where: { sourceId }, select: { id: true, playerId: true } });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))];
    if (cardIds.length) await prisma.playerCardVersion.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.catalogRelease.deleteMany({ where: { batch: { sourceId } } });
    await prisma.importRecord.deleteMany({ where: { batch: { sourceId } } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.playerCardSkill.deleteMany({ where: { playerCard: { sourceId } } });
    await prisma.playerCardAttribute.deleteMany({ where: { playerCard: { sourceId } } });
    await prisma.playerCard.deleteMany({ where: { sourceId } });
    await prisma.cardPack.deleteMany({ where: { sourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.dataSource.deleteMany({ where: { id: sourceId } });
    const users = await prisma.user.findMany({
      where: { wechatOpenId: { in: createdOpenIds } }, select: { id: true }
    });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
    await prisma.userRoleBinding.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    await prisma.role.deleteMany({ where: { code: `E2E_EDITOR_${suffix}` } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('protects management endpoints from guests and ordinary users', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/player-imports/not-found')
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('AUTH_REQUIRED'));
    await request(app.getHttpServer())
      .get('/v1/admin/player-imports/not-found')
      .set('Authorization', ordinaryAuthorization)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FORBIDDEN'));
  });

  it('creates, reads, publishes, de-duplicates, and publicly searches a batch', async () => {
    const payload = {
      sourceCode,
      fileName: 'players.json',
      format: 'JSON',
      content: JSON.stringify([record('e2e-card')])
    };
    const created = await request(app.getHttpServer())
      .post('/v1/admin/player-imports')
      .set('Authorization', editorAuthorization)
      .send(payload)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/v1/admin/player-imports/${created.body.id as string}/records`)
      .set('Authorization', editorAuthorization)
      .expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));
    await request(app.getHttpServer())
      .post(`/v1/admin/player-imports/${created.body.id as string}/publish`)
      .set('Authorization', editorAuthorization)
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/admin/player-imports')
      .set('Authorization', editorAuthorization)
      .send(payload)
      .expect(200)
      .expect(({ body }) => expect(body.id).toBe(created.body.id));

    const search = await request(app.getHttpServer())
      .get(`/v1/players?keyword=${encodeURIComponent(`E2E Player ${suffix}`)}`)
      .expect(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].playerNameEn).toBe(`E2E Player ${suffix}`);
    publishedCardId = search.body.items[0].id;
    publishedPlayerId = search.body.items[0].playerId;
    publishedPackId = search.body.items[0].pack.id;
  });

  it('allows unauthenticated public catalog reads', async () => {
    await request(app.getHttpServer()).get('/v1/players').expect(200);
    await request(app.getHttpServer()).get(`/v1/players/${publishedPlayerId}`).expect(200);
    await request(app.getHttpServer()).get(`/v1/player-cards/${publishedCardId}`).expect(200);
    await request(app.getHttpServer()).get(`/v1/card-packs/${publishedPackId}`).expect(200);
  });

  it('accepts a valid JSON body above 100 KB but below 10 MB', async () => {
    const content = JSON.stringify([record('large-body', { padding: 'x'.repeat(120_000) })]);
    await request(app.getHttpServer())
      .post('/v1/admin/player-imports')
      .set('Authorization', editorAuthorization)
      .send({ sourceCode, fileName: 'large.json', format: 'JSON', content })
      .expect(201);
  });

  it('rejects request bodies above 10 MB', async () => {
    await request(app.getHttpServer())
      .post('/v1/admin/player-imports')
      .set('Authorization', editorAuthorization)
      .send({
        sourceCode,
        fileName: 'too-large.json',
        format: 'JSON',
        content: 'x'.repeat(10 * 1024 * 1024)
      })
      .expect(413);
  });

  it('returns 409 for invalid publication and never exposes it', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/admin/player-imports')
      .set('Authorization', editorAuthorization)
      .send({
        sourceCode,
        fileName: 'invalid.json',
        format: 'JSON',
        content: JSON.stringify([record('bad'), record('bad')])
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/admin/player-imports/${created.body.id as string}/publish`)
      .set('Authorization', editorAuthorization)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('IMPORT_BATCH_NOT_READY'));
    await request(app.getHttpServer()).get('/v1/players?keyword=bad').expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
  });

  it('returns 404 for unpublished player, card, and pack IDs', async () => {
    await request(app.getHttpServer()).get(`/v1/players/${randomUUID()}`).expect(404);
    await request(app.getHttpServer()).get(`/v1/player-cards/${randomUUID()}`).expect(404);
    await request(app.getHttpServer()).get(`/v1/card-packs/${randomUUID()}`).expect(404);
  });
});
