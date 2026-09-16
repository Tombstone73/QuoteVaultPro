import { crc32 } from 'node:zlib';

type Cell = string | number | null | undefined;

const xml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value, 0); return b; };
const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0, 0); return b; };

function zip(files: Array<{ name: string; data: string }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.data, 'utf8');
    const crc = crc32(data) >>> 0;
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]);
}

function columnName(index: number) { let value = index + 1; let name = ''; while (value) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); } return name; }

export function buildSimpleXlsx(input: { sheetName: string; title: string; generatedAt: string; filterSummary: string; headers: string[]; rows: Cell[][]; totals?: Cell[] }): Buffer {
  const rowXml = (values: Cell[], row: number, style = 0) => `<row r="${row}">${values.map((value, col) => value === null || value === undefined ? '' : typeof value === 'number' ? `<c r="${columnName(col)}${row}" s="${style === 3 && col >= values.length - 3 ? 3 : style}" t="n"><v>${value}</v></c>` : `<c r="${columnName(col)}${row}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`;
  const rows = [rowXml([input.title], 1, 2), rowXml([`Generated: ${input.generatedAt}`], 2), rowXml([`Filters: ${input.filterSummary}`], 3), rowXml([], 4), rowXml(input.headers, 5, 1), ...input.rows.map((row, index) => rowXml(row, index + 6, 0))];
  if (input.totals) rows.push(rowXml(input.totals, input.rows.length + 6, 3));
  const lastRow = Math.max(5, input.rows.length + 5);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${input.headers.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(32, Math.max(12, header.length + 3))}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A5:${columnName(input.headers.length - 1)}${lastRow}"/></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(input.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}
