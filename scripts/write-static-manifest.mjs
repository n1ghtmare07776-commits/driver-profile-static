import fs from "node:fs";
import path from "node:path";

const [, , outputPath = "dist/data/manifest.json", uploadDateArg] = process.argv;
const generatedAt = new Date().toISOString();
const uploadDate = uploadDateArg || generatedAt.slice(0, 10);

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const manifest = {
  generated_at: generatedAt,
  upload_date: uploadDate,
  window_start: addDays(uploadDate, -6),
  window_end: uploadDate,
  row_count: 0,
  contains_queryable_driver_data: true,
  package_size_limit_mb: 800,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`已写入静态站点 manifest：${outputPath}`);
console.log(`静态站点生成时间：${manifest.generated_at}`);
