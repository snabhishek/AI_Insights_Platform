import * as xlsx from "xlsx";
import * as fs from "fs";

export interface WorkerTask {
  type: "excel" | "csv" | "tsv";
  filePath: string;
}

export default async function parseFileWorker(task: WorkerTask) {
  const { type, filePath } = task;
  
  if (type === "excel") {
    const workbook = xlsx.readFile(filePath);
    const tablesList = workbook.SheetNames.map((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      const ref = sheet["!ref"] || "A1:A1";
      const range = xlsx.utils.decode_range(ref);
      const rowCount = range.e.r - range.s.r;
      return {
        id: sheetName,
        name: sheetName,
        type: "Table",
        rows: Math.max(0, rowCount),
      };
    });
    return { success: true, type: "file", tables: tablesList };
  }
  
  if (type === "csv" || type === "tsv") {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const rowCount = lines.length - 1;
    const fileName = filePath.split(/[/\\]/).pop() || "file_data";
    return {
      success: true,
      type: "file",
      tables: [
        { id: fileName, name: fileName, type: "Table", rows: Math.max(0, rowCount) }
      ]
    };
  }
  
  throw new Error(`Unsupported file type: ${type}`);
}
