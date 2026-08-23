export interface ZipEntry {
  name: string;
  data: Uint8Array;
  method: number;
  crc32: number;
}

export async function parseZip(buffer: ArrayBuffer): Promise<Map<string, ZipEntry>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries = new Map<string, ZipEntry>();

  let offset = 0;
  const len = bytes.length;

  while (offset + 30 <= len) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const crc32 = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);

    const dataStart = offset + 30 + nameLen + extraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    let uncompressedData: Uint8Array = compressedData;
    if (method === 8 && typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compressedData);
        writer.close();
        const response = new Response(ds.readable);
        const buf = await response.arrayBuffer();
        uncompressedData = new Uint8Array(buf);
      } catch (e) {
        uncompressedData = compressedData;
      }
    }

    entries.set(name, {
      name,
      data: uncompressedData,
      method,
      crc32,
    });

    offset = dataStart + compressedSize;
  }

  return entries;
}

// Browser-Native High-Fidelity Word DOCX Generation Engine (Times New Roman 12pt)
// Renders the AI-generated findings array directly into a pristine, professionally formatted Word document (.docx).

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCRC32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function compressDeflate(rawBytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(rawBytes);
    writer.close();
    const response = new Response(cs.readable);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return rawBytes;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64.replace(/[\r\n\s]/g, ''));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function createZip(entries: Map<string, Uint8Array>): Promise<Blob> {
  const localFileHeaders: Uint8Array[] = [];
  const centralDirHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const [name, rawData] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc32 = calculateCRC32(rawData);
    const uncompressedSize = rawData.length;

    const compressedData = await compressDeflate(rawData);
    const compressedSize = compressedData.length;
    const method = 8; // DEFLATE

    // Local file header (30 bytes + filename length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc32, true);
    lv.setUint32(18, compressedSize, true);
    lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localFileHeaders.push(localHeader);
    localFileHeaders.push(compressedData);

    // Central directory header (46 bytes + filename length)
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc32, true);
    cv.setUint32(20, compressedSize, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);

    centralDirHeaders.push(cdHeader);
    offset += localHeader.length + compressedData.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cdh of centralDirHeaders) cdSize += cdh.length;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.size, true);
  ev.setUint16(10, entries.size, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);

  const allChunks: BlobPart[] = [...localFileHeaders, ...centralDirHeaders, eocd];
  return new Blob(allChunks, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildRunXml(text: string, bold: boolean = false, italic: boolean = false, underline: boolean = false): string {
  const bTag = bold ? '<w:b w:val="1"/>' : '';
  const iTag = italic ? '<w:i w:val="1"/>' : '';
  const uTag = underline ? '<w:u w:val="single"/>' : '';
  const cleanText = escapeXml(text);
  return `<w:r>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
      ${bTag}
      ${iTag}
      ${uTag}
    </w:rPr>
    <w:t xml:space="preserve">${cleanText}</w:t>
  </w:r>`;
}

function buildParagraphXml(runsXml: string, align?: string): string {
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  return `<w:p>
    <w:pPr>
      ${jc}
      <w:spacing w:before="0" w:after="120"/>
    </w:pPr>
    ${runsXml}
  </w:p>`;
}

export function generateDocxFromFindings(
  findings: string[],
  examTitle: string = 'Radiology Report'
): Promise<Blob> {
  const paragraphXmls: string[] = [];
  let inImpression = false;

  for (let idx = 0; idx < findings.length; idx++) {
    let raw = (findings[idx] || '').trim();
    if (!raw) continue;
    if (raw.includes('|') || raw.startsWith('+-') || raw.startsWith('|-')) continue;

    if (raw.toLowerCase().startsWith('title:')) {
      raw = raw.substring(raw.indexOf(':') + 1).trim();
      if (!raw) continue;
    }

    // Impression Header & Bullets
    if (raw.toUpperCase() === 'IMPRESSION:' || raw.toUpperCase().startsWith('IMPRESSION:') || raw.toUpperCase() === 'CONCLUSION:' || raw.toUpperCase().startsWith('CONCLUSION:')) {
      inImpression = true;
      paragraphXmls.push(buildParagraphXml(buildRunXml('IMPRESSION:', true, false, true)));
      if (raw.includes('###')) {
        const parts = raw.split('###').slice(1);
        for (const p of parts) {
          const cleanP = p.replace(/^[•\-\*\d\.\s\u2022\u25cf]+/, '').trim();
          if (cleanP) {
            paragraphXmls.push(buildParagraphXml(buildRunXml(`•  ${cleanP}`, true, false, false)));
          }
        }
      }
      continue;
    }

    if (inImpression) {
      const cleanP = raw.replace(/^[•\-\*\d\.\s\u2022\u25cf]+/, '').trim();
      if (cleanP) {
        paragraphXmls.push(buildParagraphXml(buildRunXml(`•  ${cleanP}`, true, false, false)));
      }
      continue;
    }

    // Title (Centered, Bold, Underlined)
    if (idx === 0) {
      paragraphXmls.push(buildParagraphXml(buildRunXml(raw, true, false, true), 'center'));
      continue;
    }

    // Clinical Profile (Italic)
    if (raw.toLowerCase().startsWith('clinical profile:') || raw.toLowerCase().startsWith('history:')) {
      paragraphXmls.push(buildParagraphXml(buildRunXml(raw, false, true, false)));
      continue;
    }

    // Level / Section Headings (e.g. "L1-L2:", "L3-L4:", "Screening of cervical spine:")
    const isAbnormal = raw.startsWith('BOLD::');
    const cleanRaw = raw.replace(/^BOLD::\s*/, '').trim();

    if (cleanRaw.includes(':') && cleanRaw.split(':', 2)[0].split(/\s+/).length <= 6 && !cleanRaw.toUpperCase().startsWith('FINDINGS') && !cleanRaw.toUpperCase().startsWith('OBSERVATIONS')) {
      const parts = cleanRaw.split(':', 2);
      const prefix = `${parts[0].trim()}: `;
      const rest = parts[1]?.trim() || '';

      const prefixRun = buildRunXml(prefix, isAbnormal, false, true);
      const restRun = rest ? buildRunXml(rest, isAbnormal, false, false) : '';
      paragraphXmls.push(buildParagraphXml(prefixRun + restRun));
      continue;
    }

    // Regular Narrative Sentence
    paragraphXmls.push(buildParagraphXml(buildRunXml(cleanRaw, isAbnormal, false, false)));
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphXmls.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const entries = new Map<string, Uint8Array>();
  entries.set('[Content_Types].xml', new TextEncoder().encode(contentTypesXml));
  entries.set('_rels/.rels', new TextEncoder().encode(rootRelsXml));
  entries.set('word/document.xml', new TextEncoder().encode(documentXml));

  return createZip(entries);
}

export async function mergeFindingsIntoDocx(
  templateBase64?: string | null,
  findings?: string[] | null,
  examTitle: string = 'Radiology Report'
): Promise<Blob> {
  return generateDocxFromFindings(findings || [], examTitle);
}

export function downloadDocxBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 200);
  } catch (err) {
    console.error('downloadDocxBlob failed:', err);
  }
}

export async function extractTextFromDocxBlob(blob: Blob): Promise<string> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const entries = await parseZip(arrayBuffer);
    const docEntry = entries.get('word/document.xml');
    if (!docEntry) return '';
    const xmlStr = new TextDecoder('utf-8').decode(docEntry.data);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const tTags = xmlDoc.getElementsByTagName('w:t');
    const textPieces: string[] = [];
    for (let i = 0; i < tTags.length; i++) {
      textPieces.push(tTags[i].textContent || '');
    }
    return textPieces.join(' ');
  } catch (e) {
    console.warn('extractTextFromDocxBlob error:', e);
    return '';
  }
}

export async function extractLinesFromDocxBlob(blob: Blob): Promise<string[]> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const entries = await parseZip(arrayBuffer);
    const docEntry = entries.get('word/document.xml');
    if (!docEntry) return [];
    const xmlStr = new TextDecoder('utf-8').decode(docEntry.data);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const pTags = xmlDoc.getElementsByTagName('w:p');
    const lines: string[] = [];
    for (let i = 0; i < pTags.length; i++) {
      const tTags = pTags[i].getElementsByTagName('w:t');
      let line = '';
      for (let j = 0; j < tTags.length; j++) {
        line += tTags[j].textContent || '';
      }
      if (line.trim()) lines.push(line.trim());
    }
    return lines;
  } catch (e) {
    console.warn('extractLinesFromDocxBlob error:', e);
    return [];
  }
}
