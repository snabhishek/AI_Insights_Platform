import { Pool } from "pg";

export interface SparrowIntent {
  code: string;
  description: string;
  allowsInference: boolean;
  conversational: boolean;
}
export interface ISparrowIntentRepository {
  getActiveIntents(): Promise<SparrowIntent[]>;
}
export class PostgresSparrowIntentRepository implements ISparrowIntentRepository {
  constructor(private readonly pool: Pool) {}
  async getActiveIntents(): Promise<SparrowIntent[]> {
    const result = await this.pool.query<SparrowIntent>(
      `SELECT code, description, allows_inference AS "allowsInference", conversational
       FROM sparrow_intents WHERE is_active = TRUE ORDER BY code`
    );
    if (!result.rows.length) throw new Error("Sparrow has no active intent definitions.");
    return result.rows;
  }
}
