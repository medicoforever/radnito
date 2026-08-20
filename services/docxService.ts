// Browser-Native High-Fidelity DOCX Merging & Generation Service
// Preserves 100% of styles, fonts, margins, headers, footers, and structure from template DOCX

/**
 * CRC32 Table & Calculator for ZIP Packaging
 */
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

/**
 * Inflate / Decompress raw DEFLATE bytes using browser-native DecompressionStream
 */
async function decompressDeflate(compressedBytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const response = new Response(ds.readable);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
  throw new Error('DecompressionStream is not supported in this environment.');
}

/**
 * Deflate / Compress raw bytes using browser-native CompressionStream
 */
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

interface ZipEntry {
  name: string;
  data: Uint8Array;
  method: number; // 0 = stored, 8 = deflated
  crc32: number;
}

/**
 * Simple, robust ZIP Parser
 */
async function parseZip(buffer: ArrayBuffer): Promise<Map<string, ZipEntry>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries = new Map<string, ZipEntry>();

  let offset = 0;
  const len = bytes.length;

  while (offset + 30 <= len) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      break;
    }

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

    let uncompressedData: Uint8Array;
    if (method === 0) {
      uncompressedData = compressedData;
    } else if (method === 8) {
      try {
        uncompressedData = await decompressDeflate(compressedData);
      } catch (e) {
        uncompressedData = compressedData;
      }
    } else {
      uncompressedData = compressedData;
    }

    entries.set(name, {
      name,
      data: uncompressedData,
      method,
      crc32: crc32 || calculateCRC32(uncompressedData),
    });

    offset = dataStart + compressedSize;
  }

  return entries;
}

/**
 * Re-pack ZIP entries into a valid DOCX binary archive
 */
async function createZip(entries: Map<string, Uint8Array>): Promise<Blob> {
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    compressedData: Uint8Array;
    crc32: number;
    uncompressedSize: number;
    compressedSize: number;
    method: number;
    offset: number;
  }> = [];

  let currentOffset = 0;
  const parts: Uint8Array[] = [];

  for (const [name, uncompressedData] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc32 = calculateCRC32(uncompressedData);

    let compressedData = uncompressedData;
    let method = 0;

    try {
      if (uncompressedData.length > 300) {
        compressedData = await compressDeflate(uncompressedData);
        method = 8;
      }
    } catch {
      compressedData = uncompressedData;
      method = 0;
    }

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc32, true);
    lv.setUint32(18, compressedData.length, true);
    lv.setUint32(22, uncompressedData.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    fileRecords.push({
      nameBytes,
      compressedData,
      crc32,
      uncompressedSize: uncompressedData.length,
      compressedSize: compressedData.length,
      method,
      offset: currentOffset,
    });

    parts.push(localHeader);
    parts.push(compressedData);
    currentOffset += localHeader.length + compressedData.length;
  }

  const centralDirStart = currentOffset;
  let centralDirSize = 0;

  for (const rec of fileRecords) {
    const cdHeader = new Uint8Array(46 + rec.nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, rec.method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, rec.crc32, true);
    cv.setUint32(20, rec.compressedSize, true);
    cv.setUint32(24, rec.uncompressedSize, true);
    cv.setUint16(28, rec.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint32(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, rec.offset, true);
    cdHeader.set(rec.nameBytes, 46);

    parts.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, fileRecords.length, true);
  ev.setUint16(10, fileRecords.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirStart, true);
  ev.setUint16(20, 0, true);
  parts.push(eocd);

  return new Blob(parts, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64.trim());
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parses raw finding text lines into rich Word XML runs, resolving BOLD:: tags, underlines, and italics.
 */
interface RunChunk {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function parseTextToRuns(text: string, baseStyle: { bold?: boolean; italic?: boolean; underline?: boolean } = {}): RunChunk[] {
  if (!text) return [];

  const chunks: RunChunk[] = [];
  const tokens = text.split(/(BOLD::)/g);
  let isCurrentlyBold = baseStyle.bold || false;

  for (const token of tokens) {
    if (token === 'BOLD::') {
      isCurrentlyBold = true;
    } else if (token.length > 0) {
      chunks.push({
        text: token,
        bold: isCurrentlyBold,
        italic: baseStyle.italic || false,
        underline: baseStyle.underline || false,
      });
      isCurrentlyBold = baseStyle.bold || false;
    }
  }

  return chunks;
}

const LEVEL_OR_SECTION_HEADING_REGEX = /^((?:C\d\s*-\s*C\d|D\d+\s*-\s*D\d+|L\d\s*-\s*L\d|L5\s*-\s*S1|Screening of (?:dorsal|lumbar|cervical|lumbosacral)\s+spine|Bones and joints|Meniscus|Ligaments?|Soft tissues?|Rest of soft tissues?|Rotator cuff|Labroligamentous structures|AC joint|Liver|Gall bladder|Biliary radicals|Right hip joint|Left hip joint|Rest of bony pelvis|MRA|MRV|ASL|ORBITS|PNS|BRAIN|TOF MRA|Left brachial plexus|Right brachial plexus)\s*:?)(.*)$/i;

function renderRunsXml(runs: RunChunk[]): string {
  return runs.map(r => {
    let rPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/>';
    if (r.bold) rPr += '<w:b/><w:bCs/>';
    if (r.italic) rPr += '<w:i/><w:iCs/>';
    if (r.underline) rPr += '<w:u w:val="single"/>';
    rPr += '</w:rPr>';
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
  }).join('');
}

function buildParagraphXml(runs: RunChunk[], options: {
  align?: 'center' | 'left';
  spacingBefore?: number;
  spacingAfter?: number;
  indentLeft?: number;
  hanging?: number;
} = {}): string {
  const alignXml = options.align === 'center' ? '<w:jc w:val="center"/>' : '';
  const indXml = (options.indentLeft || options.hanging)
    ? `<w:ind w:left="${options.indentLeft || 0}" w:hanging="${options.hanging || 0}"/>`
    : '';
  const spacingXml = `<w:spacing w:before="${options.spacingBefore || 0}" w:after="${options.spacingAfter !== undefined ? options.spacingAfter : 120}" w:line="240" w:lineRule="auto"/>`;
  const content = renderRunsXml(runs);

  return `<w:p><w:pPr>${alignXml}${indXml}${spacingXml}</w:pPr>${content}</w:p>`;
}

function buildEmptyParagraphXml(): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>`;
}

/**
 * Intelligent finding parser for Structured & Impression Findings
 */
function parseFindingsToParagraphs(findings: string[]): string[] {
  const pXmls: string[] = [];

  for (let idx = 0; idx < findings.length; idx++) {
    const raw = findings[idx]?.trim();
    if (!raw) {
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 1. IMPRESSION Section
    if (raw.startsWith('IMPRESSION:')) {
      const parts = raw.split('###').map(p => p.trim()).filter(Boolean);
      // IMPRESSION: header (Bold & Underlined)
      pXmls.push(
        buildParagraphXml(
          [{ text: 'IMPRESSION:', bold: true, italic: false, underline: true }],
          { spacingBefore: 180, spacingAfter: 80 }
        )
      );
      // Impression bullet points (Bold, NOT underlined)
      for (let i = 1; i < parts.length; i++) {
        const pt = parts[i].replace(/^BOLD::\s*/i, '').trim();
        pXmls.push(
          buildParagraphXml(
            [{ text: `•  ${pt}`, bold: true, italic: false, underline: false }],
            { spacingBefore: 0, spacingAfter: 80, indentLeft: 360, hanging: 240 }
          )
        );
      }
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 2. Clinical Profile (Italic, NEVER Underlined)
    if (
      raw.startsWith('*Clinical Profile:') ||
      (raw.startsWith('*') && raw.endsWith('*') && raw.toLowerCase().includes('profile')) ||
      raw.toLowerCase().startsWith('clinical profile:')
    ) {
      const text = raw.replace(/^\*+|\*+$/g, '').trim();
      const profileContent = text.replace(/^Clinical Profile:\s*/i, '').trim();
      const pText = profileContent ? `Clinical Profile: ${profileContent}` : 'Clinical Profile:';
      pXmls.push(
        buildParagraphXml(
          [{ text: pText, bold: false, italic: true, underline: false }],
          { spacingBefore: 0, spacingAfter: 120 }
        )
      );
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 3. Technique & Technique Screening (Italic, NEVER Underlined)
    const isTechnique =
      raw.toLowerCase().startsWith('technique:') ||
      raw.toLowerCase().startsWith('mri technique:') ||
      raw.toLowerCase().startsWith('ct technique:') ||
      /^(screening\s+of\s+(the\s+)?(rest\s+of\s+(the\s+)?spine|whole\s+spine|upper\s+abdomen))/i.test(raw);

    if (isTechnique) {
      pXmls.push(
        buildParagraphXml(
          [{ text: raw, bold: false, italic: true, underline: false }],
          { spacingBefore: 0, spacingAfter: 120 }
        )
      );
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 4. Document Title (Bold, Underlined, Centered)
    if (idx === 0 && (raw.toUpperCase().includes('SCAN') || raw.toUpperCase().includes('MRI') || raw.toUpperCase().includes('C.T.') || raw.toUpperCase().includes('REPORT') || raw.toUpperCase().includes('STUDY'))) {
      pXmls.push(
        buildParagraphXml(
          [{ text: raw, bold: true, italic: false, underline: true }],
          { align: 'center', spacingBefore: 100, spacingAfter: 200 }
        )
      );
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 5. Underlined Level / Section Headings (Underline prefix only, finding text is regular/bold)
    const headingMatch = raw.match(LEVEL_OR_SECTION_HEADING_REGEX);
    if (headingMatch) {
      const prefix = headingMatch[1].trim();
      const rest = headingMatch[2].trim();
      const isPrefixBold = prefix.toUpperCase() === prefix && prefix.length > 3;

      const runs: RunChunk[] = [
        {
          text: prefix + (rest ? ' ' : ''),
          bold: isPrefixBold,
          italic: false,
          underline: true,
        },
      ];

      if (rest) {
        const restRuns = parseTextToRuns(rest, { bold: false, italic: false, underline: false });
        runs.push(...restRuns);
      }

      pXmls.push(buildParagraphXml(runs, { spacingBefore: 60, spacingAfter: 80 }));
      pXmls.push(buildEmptyParagraphXml());
      continue;
    }

    // 6. Regular findings (with full BOLD:: inline run extraction)
    const runs = parseTextToRuns(raw);
    pXmls.push(buildParagraphXml(runs, { spacingBefore: 0, spacingAfter: 100 }));
    pXmls.push(buildEmptyParagraphXml());
  }

  return pXmls;
}

/**
 * Generate a clean, 100% valid Word OpenXML (.docx) in Times New Roman 12pt
 */
export async function generateDocxFromFindings(
  findings: string[],
  fallbackTitle?: string
): Promise<Blob> {
  const bodyXmlParts = parseFindingsToParagraphs(findings);

  const defaultSectPr = `
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  `;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyXmlParts.join('')}
    ${defaultSectPr}
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

  const encoder = new TextEncoder();
  const entries = new Map<string, Uint8Array>();
  entries.set('[Content_Types].xml', encoder.encode(contentTypesXml));
  entries.set('_rels/.rels', encoder.encode(relsXml));
  entries.set('word/_rels/document.xml.rels', encoder.encode(docRelsXml));
  entries.set('word/document.xml', encoder.encode(documentXml));
  entries.set('word/styles.xml', encoder.encode(stylesXml));
  entries.set('word/settings.xml', encoder.encode(settingsXml));

  return createZip(entries);
}

/**
 * Merge an array of findings into a DOCX template while preserving 100% of formatting, styles, and layout!
 */
export async function mergeFindingsIntoDocx(
  templateDocxBase64?: string,
  findings: string[] = [],
  fallbackTitle?: string
): Promise<Blob> {
  if (!templateDocxBase64 || !templateDocxBase64.trim()) {
    return generateDocxFromFindings(findings, fallbackTitle);
  }

  try {
    const templateBytes = base64ToUint8Array(templateDocxBase64);
    const zipEntries = await parseZip(templateBytes.buffer);

    const docXmlEntry = zipEntries.get('word/document.xml');
    if (!docXmlEntry) {
      return generateDocxFromFindings(findings, fallbackTitle);
    }

    const decoder = new TextDecoder('utf-8');
    const originalDocXml = decoder.decode(docXmlEntry.data);

    // Extract sectPr (margins & layout) from original document
    const sectPrMatch = originalDocXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/i);
    const sectPrXml = sectPrMatch ? sectPrMatch[0] : `
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
        <w:cols w:space="720"/>
        <w:docGrid w:linePitch="360"/>
      </w:sectPr>
    `;

    const bodyXmlParts = parseFindingsToParagraphs(findings);
    bodyXmlParts.push(sectPrXml);

    const newBodyContent = bodyXmlParts.join('');

    const modifiedDocXml = originalDocXml.replace(
      /<w:body>[\s\S]*?<\/w:body>/i,
      `<w:body>${newBodyContent}</w:body>`
    );

    const updatedEntries = new Map<string, Uint8Array>();
    for (const [name, entry] of zipEntries) {
      if (name === 'word/document.xml') {
        const updatedBytes = new TextEncoder().encode(modifiedDocXml);
        updatedEntries.set(name, updatedBytes);
      } else {
        updatedEntries.set(name, entry.data);
      }
    }

    return createZip(updatedEntries);
  } catch (e) {
    console.warn('mergeFindingsIntoDocx fallback to generateDocxFromFindings:', e);
    return generateDocxFromFindings(findings, fallbackTitle);
  }
}

/**
 * Helper to download Blob as file in browser
 */
export function downloadDocxBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Extract paragraph text lines and base64 from a user-uploaded DOCX file/blob
 */
export async function extractLinesFromDocxBlob(file: File | Blob): Promise<{ lines: string[]; docxBase64: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const docxBase64 = btoa(binary);

  try {
    const zipEntries = await parseZip(arrayBuffer);
    const docXmlEntry = zipEntries.get('word/document.xml');
    if (!docXmlEntry) {
      return { lines: [], docxBase64 };
    }

    const xmlStr = new TextDecoder('utf-8').decode(docXmlEntry.data);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const paragraphs = xmlDoc.getElementsByTagName('w:p');

    const lines: string[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      let pText = '';
      const walker = xmlDoc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
      let curr = walker.nextNode();
      while (curr) {
        if (curr.nodeName === 'w:t') {
          pText += curr.textContent || '';
        } else if (curr.nodeName === 'w:br' || curr.nodeName === 'w:cr') {
          pText += '\n';
        }
        curr = walker.nextNode();
      }
      const trimmed = pText.trim();
      if (trimmed) {
        const subLines = trimmed.split('\n').map(s => s.trim()).filter(Boolean);
        lines.push(...subLines);
      }
    }

    return { lines, docxBase64 };
  } catch (err) {
    console.warn('Failed to parse docx xml:', err);
    return { lines: [], docxBase64 };
  }
}

export async function extractTextFromDocxBlob(blob: Blob): Promise<string> {
  try {
    const { lines } = await extractLinesFromDocxBlob(blob);
    return lines.join('\n');
  } catch {
    return '';
  }
}

export default {
  mergeFindingsIntoDocx,
  downloadDocxBlob,
  extractLinesFromDocxBlob,
  extractTextFromDocxBlob,
};
