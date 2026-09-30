import * as dotenv from 'dotenv';
dotenv.config();
import { extractDatasetDateRange } from '../agents/tools/helpers/datasetDateRangeHelper';

async function main() {
  const res = await extractDatasetDateRange('FileStorage_Testing', 'Demand_Forecasting', '20260924-011230');
  console.log('EXTRACTED RANGE:', JSON.stringify(res, null, 2));
}

main().catch(console.error);
