import { IDomainRepository } from "../../repositories/domain.repository.interface";
import { DomainModel } from "../../models/domain.types";

export class DomainService {
  constructor(private domainRepo: IDomainRepository) {}

  async getDomains(): Promise<DomainModel[]> {
    return this.domainRepo.getAllDomains();
  }
}
