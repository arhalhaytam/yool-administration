const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const files = [
  String.raw`C:\Users\arhal\Downloads\Medicaments_ANAM_MAJ 28-04-2026.xlsx`,
  String.raw`C:\Users\arhal\Downloads\listes_medicaments_AMMPS.xlsx`,
  String.raw`C:\Users\arhal\Downloads\BASE IQVIA (1).xlsx`,
];

for (const filepath of files) {
  console.log('\n' + '='.repeat(100));
  console.log('FILE:', path.basename(filepath));
  const stats = fs.statSync(filepath);
  console.log('SIZE:', stats.size, 'bytes');
  console.log('='.repeat(100));

  try {
    const workbook = XLSX.readFile(filepath);
    console.log('SHEETS:', workbook.SheetNames);

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      console.log(`\n--- Sheet: '${sheetName}' ---`);
      console.log(`  Range: ${worksheet['!ref']}`);
      console.log(`  Rows: ${range.e.r - range.s.r + 1}, Cols: ${range.e.c - range.s.c + 1}`);

      // Convert to JSON to analyze
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (jsonData.length > 0) {
        console.log(`\n  HEADERS (Row 1):`);
        const headers = jsonData[0];
        headers.forEach((h, i) => {
          console.log(`    [${i}] ${h}`);
        });

        console.log(`\n  FIRST 5 DATA ROWS:`);
        for (let i = 1; i < Math.min(6, jsonData.length); i++) {
          const row = jsonData[i];
          const rowObj = {};
          headers.forEach((h, j) => {
            if (row[j] !== undefined && row[j] !== '') {
              rowObj[String(h).substring(0, 30)] = String(row[j]).substring(0, 60);
            }
          });
          console.log(`    Row ${i}:`, JSON.stringify(rowObj));
        }

        console.log(`\n  TOTAL DATA ROWS: ${jsonData.length - 1}`);

        // Column analysis
        console.log(`\n  COLUMN ANALYSIS:`);
        headers.forEach((header, colIdx) => {
          let nonEmpty = 0;
          let empty = 0;
          const uniqueVals = new Set();
          const sampleVals = [];

          for (let r = 1; r < jsonData.length; r++) {
            const val = jsonData[r][colIdx];
            if (val === undefined || val === null || String(val).trim() === '') {
              empty++;
            } else {
              nonEmpty++;
              if (sampleVals.length < 3) sampleVals.push(String(val).substring(0, 60));
              if (uniqueVals.size < 500) uniqueVals.add(String(val).substring(0, 50));
            }
          }

          const fillRate = jsonData.length > 1 ? ((nonEmpty / (jsonData.length - 1)) * 100).toFixed(1) : 0;
          console.log(`    [${colIdx}] "${header}" | Fill: ${fillRate}% (${nonEmpty}/${jsonData.length - 1}) | Unique: ~${uniqueVals.size} | Samples: ${JSON.stringify(sampleVals)}`);
        });

        // Last 3 rows
        console.log(`\n  LAST 3 ROWS:`);
        for (let i = Math.max(1, jsonData.length - 3); i < jsonData.length; i++) {
          const row = jsonData[i];
          const rowObj = {};
          headers.forEach((h, j) => {
            if (row[j] !== undefined && row[j] !== '') {
              rowObj[String(h).substring(0, 30)] = String(row[j]).substring(0, 60);
            }
          });
          console.log(`    Row ${i}:`, JSON.stringify(rowObj));
        }
      }
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}
