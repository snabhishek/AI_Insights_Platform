import { DomainModel } from "../models/domain.types";

export interface IDomainRepository {
  getAllDomains(): Promise<DomainModel[]>;
}
