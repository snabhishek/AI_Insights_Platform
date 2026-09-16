import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asc } from "drizzle-orm";
import { IDomainRepository } from "./domain.repository.interface";
import { DomainModel } from "../models/domain.types";
import * as schema from "../db/connectors";

export class PostgresDomainRepository implements IDomainRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async getAllDomains(): Promise<DomainModel[]> {
    const rows = await this.db.select().from(schema.domains).orderBy(asc(schema.domains.domain));
    return rows.map((row: typeof schema.domains.$inferSelect) => ({
      id: row.id,
      domain: row.domain,
      subDomains: row.subDomains ?? [],
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }
}
