import path from "path";
import * as xlsx from "xlsx";
import fs from "fs";

function inspectExcel() {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const filePath = path.join(uploadsDir, "carrier_forecast_dataset.xls");
  console.log("File exists:", fs.existsSync(filePath));

  if (fs.existsSync(filePath)) {
    const workbook = xlsx.readFile(filePath);
    console.log("Sheet names:", workbook.SheetNames);
    for (const sheet of workbook.SheetNames) {
      const ws = workbook.Sheets[sheet];
      const rows: any[] = xlsx.utils.sheet_to_json(ws, { header: 1 });
      console.log(`Sheet "${sheet}" total rows:`, rows.length);
      console.log(`Row 0 (headers):`, rows[0]?.slice(0, 10));
      console.log(`Row 1 (first data row):`, rows[1]?.slice(0, 10));
    }
  }
}

inspectExcel();
