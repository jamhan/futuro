import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/client';
import { Account, AccountId, Position } from '../domain/account';

export class AccountRepository {
  private prisma = getPrismaClient();

  async create(account: Omit<Account, 'id' | 'createdAt'>): Promise<Account> {
    const created = await this.prisma.account.create({
      data: {
        balance: new Prisma.Decimal(account.balance.toString()),
      },
    });

    return this.toDomain(created);
  }

  async findById(id: AccountId): Promise<Account | null> {
    const found = await this.prisma.account.findUnique({
      where: { id },
    });

    return found ? this.toDomain(found) : null;
  }

  async updateBalance(id: AccountId, balance: Decimal): Promise<Account> {
    const updated = await this.prisma.account.update({
      where: { id },
      data: {
        balance: new Prisma.Decimal(balance.toString()),
      },
    });

    return this.toDomain(updated);
  }

  async getPosition(
    accountId: AccountId,
    marketId: string
  ): Promise<Position | null> {
    const position = await this.prisma.position.findUnique({
      where: {
        accountId_marketId: {
          accountId,
          marketId,
        },
      },
    });

    return position ? this.toDomainPosition(position) : null;
  }

  async findPositionsByMarket(marketId: string): Promise<Position[]> {
    const positions = await this.prisma.position.findMany({
      where: { marketId },
    });
    return positions.map((p) => this.toDomainPosition(p));
  }

  async updatePosition(position: Position): Promise<Position> {
    const updated = await this.prisma.position.upsert({
      where: {
        accountId_marketId: {
          accountId: position.accountId,
          marketId: position.marketId,
        },
      },
      create: {
        accountId: position.accountId,
        marketId: position.marketId,
        yesShares: new Prisma.Decimal(position.yesShares.toString()),
        noShares: new Prisma.Decimal(position.noShares.toString()),
        quantity: position.quantity != null ? new Prisma.Decimal(position.quantity.toString()) : null,
      },
      update: {
        yesShares: new Prisma.Decimal(position.yesShares.toString()),
        noShares: new Prisma.Decimal(position.noShares.toString()),
        ...(position.quantity !== undefined && {
          quantity: position.quantity != null ? new Prisma.Decimal(position.quantity.toString()) : null,
        }),
      },
    });

    return this.toDomainPosition(updated);
  }

  private toDomain(dbAccount: {
    id: string;
    balance: any;
    isPaper?: boolean;
    createdAt: Date;
  }): Account {
    return {
      id: dbAccount.id,
      balance: new Decimal(dbAccount.balance.toString()),
      isPaper: dbAccount.isPaper ?? false,
      createdAt: dbAccount.createdAt,
    };
  }

  private toDomainPosition(dbPosition: {
    accountId: string;
    marketId: string;
    yesShares: any;
    noShares: any;
    quantity?: any;
  }): Position {
    return {
      accountId: dbPosition.accountId,
      marketId: dbPosition.marketId,
      yesShares: new Decimal(dbPosition.yesShares.toString()),
      noShares: new Decimal(dbPosition.noShares.toString()),
      quantity:
        dbPosition.quantity != null
          ? new Decimal(dbPosition.quantity.toString())
          : null,
    };
  }
}

