import { query } from "../db";
import { IDomainRepository } from "./domain.repository.interface";
import { DomainModel } from "../models/domain.types";

export class PostgresDomainRepository implements IDomainRepository {
  async getAllDomains(): Promise<DomainModel[]> {
    const res = await query("SELECT * FROM domains ORDER BY domain ASC");
    return res.rows.map((row: any) => ({
      id: row.id,
      domain: row.domain,
      subDomains: Array.isArray(row.sub_domains)
        ? row.sub_domains
        : typeof row.sub_domains === "string"
        ? JSON.parse(row.sub_domains)
        : [],
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    }));
  }
}
