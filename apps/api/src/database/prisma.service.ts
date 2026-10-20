import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';

type DatabaseConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function parseDatabaseUrl(value: string | undefined): DatabaseConnection {
  if (!value) throw new Error('DATABASE_URL is required');

  const url = new URL(value);
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql://');

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1)
  };
}

export const PRISMA_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000
} as const;

export function prismaClientOptions(databaseUrl: string | undefined) {
  return {
    adapter: new PrismaMariaDb(parseDatabaseUrl(databaseUrl)),
    transactionOptions: PRISMA_TRANSACTION_OPTIONS
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(prismaClientOptions(process.env.DATABASE_URL));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
