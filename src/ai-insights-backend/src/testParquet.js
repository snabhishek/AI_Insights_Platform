import { ParquetReader } from '@dsnp/parquetjs';
import { resolve } from 'path';

async function test() {
  try {
    const filePath = resolve(__dirname, '../../../packages/static_schema_updated.parquet');
    console.log("Reading from:", filePath);
    let reader = await ParquetReader.openFile(filePath);
    let cursor = reader.getCursor();
    let record = null;
    console.log('Schema:', reader.schema);  
    
    let count = 0;
    while (record = await cursor.next()) {
      console.log('Row', count, record);
      count++;
      if (count > 5) break;
    }
    await reader.close();
  } catch (err) {
    console.error('Error reading parquet:', err);
  }
}

test();
