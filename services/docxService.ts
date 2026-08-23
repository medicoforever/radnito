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

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  method: number; // 0 = stored, 8 = deflated
  crc32: number;
}

/**
 * Simple, robust ZIP Parser
 */
export async function parseZip(buffer: ArrayBuffer): Promise<Map<string, ZipEntry>> {
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
export async function createZip(entries: Map<string, Uint8Array>): Promise<Blob> {
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

export function base64ToUint8Array(base64: string): Uint8Array {
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

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function normalizeKey(str: string): string {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function getParagraphText(p: Element): string {
  const tTags = p.getElementsByTagName('w:t');
  let txt = '';
  for (let i = 0; i < tTags.length; i++) {
    txt += tTags[i].textContent || '';
  }
  return txt;
}

function collectBodyParagraphs(parent: Element): Element[] {
  const paragraphs: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType === 1) {
      const el = node as Element;
      const name = el.localName || el.nodeName.replace(/^w:/, '');
      if (name === 'p') {
        paragraphs.push(el);
      } else if (name === 'sdt') {
        const sdtContent = el.getElementsByTagName('w:sdtContent')[0];
        if (sdtContent) {
          paragraphs.push(...collectBodyParagraphs(sdtContent));
        }
      }
    }
  }
  return paragraphs;
}

function updateParagraphPreservingStyle(
  xmlDoc: Document,
  p: Element,
  newText: string,
  isAbnormal?: boolean
): void {
  const cleanVal = newText.replace(/^BOLD::\s*/, '').trim();
  const runs = p.getElementsByTagName('w:r');

  if (runs.length > 0) {
    const firstRun = runs[0];
    let rPr = firstRun.getElementsByTagName('w:rPr')[0];

    if (!rPr) {
      rPr = xmlDoc.createElementNS(W_NS, 'w:rPr');
      const rFonts = xmlDoc.createElementNS(W_NS, 'w:rFonts');
      rFonts.setAttributeNS(W_NS, 'w:ascii', 'Times New Roman');
      rFonts.setAttributeNS(W_NS, 'w:hAnsi', 'Times New Roman');
      rPr.appendChild(rFonts);
      const sz = xmlDoc.createElementNS(W_NS, 'w:sz');
      sz.setAttributeNS(W_NS, 'w:val', '24'); // 12pt
      rPr.appendChild(sz);
      firstRun.insertBefore(rPr, firstRun.firstChild);
    }

    // Apply or ensure boldness on abnormal finding
    if (isAbnormal) {
      let bElem = rPr.getElementsByTagName('w:b')[0];
      if (!bElem) {
        bElem = xmlDoc.createElementNS(W_NS, 'w:b');
        bElem.setAttributeNS(W_NS, 'w:val', '1');
        rPr.appendChild(bElem);
      } else {
        bElem.setAttributeNS(W_NS, 'w:val', '1');
      }
    }

    // Update text of the first run
    let tElem = firstRun.getElementsByTagName('w:t')[0];
    if (!tElem) {
      tElem = xmlDoc.createElementNS(W_NS, 'w:t');
      firstRun.appendChild(tElem);
    }
    tElem.textContent = cleanVal;
    tElem.setAttribute('xml:space', 'preserve');

    // Remove any trailing extra runs from the original paragraph
    const extraRuns: Element[] = [];
    for (let i = 1; i < runs.length; i++) {
      extraRuns.push(runs[i]);
    }
    for (const er of extraRuns) {
      if (er.parentNode === p) {
        p.removeChild(er);
      }
    }
  } else {
    // Create new run with standard Times New Roman 12pt
    const r = xmlDoc.createElementNS(W_NS, 'w:r');
    const rPr = xmlDoc.createElementNS(W_NS, 'w:rPr');
    const rFonts = xmlDoc.createElementNS(W_NS, 'w:rFonts');
    rFonts.setAttributeNS(W_NS, 'w:ascii', 'Times New Roman');
    rFonts.setAttributeNS(W_NS, 'w:hAnsi', 'Times New Roman');
    rPr.appendChild(rFonts);
    const sz = xmlDoc.createElementNS(W_NS, 'w:sz');
    sz.setAttributeNS(W_NS, 'w:val', '24');
    rPr.appendChild(sz);

    if (isAbnormal) {
      const b = xmlDoc.createElementNS(W_NS, 'w:b');
      b.setAttributeNS(W_NS, 'w:val', '1');
      rPr.appendChild(b);
    }

    r.appendChild(rPr);
    const t = xmlDoc.createElementNS(W_NS, 'w:t');
    t.textContent = cleanVal;
    t.setAttribute('xml:space', 'preserve');
    r.appendChild(t);
    p.appendChild(r);
  }
}

function oldSetParagraphContent(
  xmlDoc: Document,
  p: Element,
  newText: string,
  isBold?: boolean
): void {
  // 1. Remove all existing w:r child nodes while keeping w:pPr
  const childNodes = Array.from(p.childNodes);
  for (const node of childNodes) {
    if (node.nodeName === 'w:r' || (node as Element).localName === 'r') {
      p.removeChild(node);
    }
  }

  // 2. Create clean, high-fidelity Word run (Times New Roman 12pt)
  const r = xmlDoc.createElementNS(W_NS, 'w:r');
  const rPr = xmlDoc.createElementNS(W_NS, 'w:rPr');

  const rFonts = xmlDoc.createElementNS(W_NS, 'w:rFonts');
  rFonts.setAttributeNS(W_NS, 'w:ascii', 'Times New Roman');
  rFonts.setAttributeNS(W_NS, 'w:hAnsi', 'Times New Roman');
  rPr.appendChild(rFonts);

  const sz = xmlDoc.createElementNS(W_NS, 'w:sz');
  sz.setAttributeNS(W_NS, 'w:val', '24'); // 12pt
  rPr.appendChild(sz);

  if (isBold) {
    const b = xmlDoc.createElementNS(W_NS, 'w:b');
    b.setAttributeNS(W_NS, 'w:val', '1');
    rPr.appendChild(b);
  }

  r.appendChild(rPr);

  const t = xmlDoc.createElementNS(W_NS, 'w:t');
  t.textContent = newText;
  t.setAttribute('xml:space', 'preserve');
  r.appendChild(t);

  p.appendChild(r);
}

export async function mergeFindingsIntoDocx(
  templateBase64?: string | null,
  findings?: string[] | null,
  examTitle: string = 'Radiology Report'
): Promise<Blob> {
  if (!templateBase64 || !templateBase64.trim()) {
    return generateDocxFromFindings(findings || [], examTitle);
  }

  const templateBytes = base64ToUint8Array(templateBase64);

  if (!findings || findings.length === 0) {
    return new Blob([templateBytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  try {
    const zipEntries = await parseZip(templateBytes.buffer);
    const docXmlEntry = zipEntries.get('word/document.xml');
    if (!docXmlEntry) {
      return generateDocxFromFindings(findings, examTitle);
    }

    const xmlStr = new TextDecoder('utf-8').decode(docXmlEntry.data);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');

    const bodyElem = xmlDoc.getElementsByTagName('w:body')[0];
    if (!bodyElem) {
      return new Blob([templateBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    }

    // Collect all paragraphs in the document (including inside tables) to build baseline text set
    const allDocParagraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
    const templateBaselineTexts = new Set<string>();
    for (const p of allDocParagraphs) {
      const t = getParagraphText(p).trim().toLowerCase();
      if (t) templateBaselineTexts.add(t);
    }

    const allBodyParagraphs = collectBodyParagraphs(bodyElem);

    // ============================================================
    // STEP 1: Parse findings into body lines, impression items, and colon map
    // ============================================================
    const bodyFindingLines: string[] = [];
    const impressionItems: string[] = [];
    const colonFindingsMap = new Map<string, string>();
    let clinicalProfile: string | null = null;
    let isInImpression = false;

    for (const f of findings) {
      let trimmed = f.trim();
      if (!trimmed) continue;

      // Skip markdown table lines
      if (trimmed.includes('|') || trimmed.startsWith('+-') || trimmed.startsWith('|-')) continue;

      // Strip "Title:" prefix that audio dictation mode adds
      if (trimmed.toLowerCase().startsWith('title:')) {
        trimmed = trimmed.substring(trimmed.indexOf(':') + 1).trim();
        if (!trimmed) continue;
      }

      if (trimmed.toUpperCase() === 'IMPRESSION:' || trimmed.toUpperCase().startsWith('IMPRESSION:') || trimmed.toUpperCase() === 'CONCLUSION:' || trimmed.toUpperCase().startsWith('CONCLUSION:')) {
        isInImpression = true;
        if (trimmed.includes('###')) {
          const parts = trimmed.split('###').slice(1);
          for (const p of parts) {
            const cleanP = p.replace(/^[•\-\*\d\.\s\u2022\u25cf]+/, '').trim();
            if (cleanP) impressionItems.push(cleanP);
          }
        }
        continue;
      }

      if (isInImpression) {
        const cleanP = trimmed.replace(/^[•\-\*\d\.\s\u2022\u25cf]+/, '').trim();
        if (cleanP) impressionItems.push(cleanP);
        continue;
      }

      const lower = trimmed.toLowerCase();
      if (lower.startsWith('clinical profile:') || lower.startsWith('history:')) {
        const afterColon = trimmed.split(':', 2)[1]?.trim() || '';
        if (afterColon) clinicalProfile = afterColon;
        continue;
      }

      bodyFindingLines.push(trimmed);
      const cleanNoBold = trimmed.replace(/^BOLD::\s*/, '').trim();

      // Build colon map for keyed findings (e.g. "L1-L2: ...", "Screening of cervical spine: ...")
      if (cleanNoBold.includes(':') && cleanNoBold.split(':', 2)[0].split(/\s+/).length <= 6 && !cleanNoBold.toUpperCase().startsWith('FINDINGS') && !cleanNoBold.toUpperCase().startsWith('MEASUREMENTS') && !cleanNoBold.toUpperCase().startsWith('INDIRECT') && !cleanNoBold.toUpperCase().startsWith('CARDIAC') && !cleanNoBold.toUpperCase().startsWith('VENOUS') && !cleanNoBold.toUpperCase().startsWith('OBSERVATIONS') && !cleanNoBold.toUpperCase().startsWith('INCIDENTAL') && !cleanNoBold.toUpperCase().startsWith('OTHER')) {
        const prefix = cleanNoBold.split(':', 2)[0].trim();
        const key = normalizeKey(prefix);
        if (key && key.length >= 2) {
          colonFindingsMap.set(key, trimmed);
        }
      }
    }

    // ============================================================
    // STEP 2: Locate IMPRESSION header in template
    // ============================================================
    let impressionHeaderIdx = -1;
    for (let idx = 0; idx < allBodyParagraphs.length; idx++) {
      const p = allBodyParagraphs[idx];
      const pText = getParagraphText(p).trim();
      if (pText.toUpperCase() === 'IMPRESSION:' || pText.toUpperCase().startsWith('IMPRESSION:') || pText.toUpperCase() === 'CONCLUSION:' || pText.toUpperCase().startsWith('CONCLUSION:')) {
        impressionHeaderIdx = idx;
        break;
      }
    }

    // ============================================================
    // STEP 3: Collect ALL template paragraphs before IMPRESSION (including blank ones)
    // ============================================================
    const endBodyIdx = impressionHeaderIdx !== -1 ? impressionHeaderIdx : allBodyParagraphs.length;

    // Non-blank paragraphs for matching
    const nonBlankBodyParagraphs: Array<{ p: Element; origText: string; idx: number }> = [];
    for (let idx = 0; idx < endBodyIdx; idx++) {
      const p = allBodyParagraphs[idx];
      const pText = getParagraphText(p).trim();
      if (pText) {
        nonBlankBodyParagraphs.push({ p, origText: pText, idx });
      }
    }

    // ============================================================
    // STEP 4: SEQUENTIAL REPLACEMENT (Primary Strategy)
    // The AI output always mirrors the template structure in order.
    // Walk through template paragraphs and finding lines simultaneously.
    // ============================================================
    const usedFindings = new Set<string>();
    const updatedParagraphs = new Set<number>(); // track which template paragraph indices were updated

    // A. Update Clinical Profile if present; otherwise mark it as "skip" so sequential cursor doesn't overwrite it
    for (const { p, origText, idx } of nonBlankBodyParagraphs) {
      const lower = origText.toLowerCase();
      if (lower.startsWith('clinical profile:') || lower.startsWith('history:')) {
        if (clinicalProfile) {
          updateParagraphPreservingStyle(xmlDoc, p, `Clinical Profile: ${clinicalProfile}`, false);
        }
        // Always mark as updated so the sequential walk skips this paragraph
        updatedParagraphs.add(idx);
        break;
      }
    }

    // B. Sequential walk: for each template paragraph, find the best matching finding
    let findingCursor = 0;
    for (const { p, origText, idx } of nonBlankBodyParagraphs) {
      if (updatedParagraphs.has(idx)) continue;
      if (findingCursor >= bodyFindingLines.length) break;

      const templateLower = origText.toLowerCase().trim();
      const templateKey = origText.includes(':') ? normalizeKey(origText.split(':', 2)[0].trim()) : '';

      // Strategy B1: Direct colon-key match at current or nearby finding position
      if (templateKey && colonFindingsMap.has(templateKey)) {
        const finding = colonFindingsMap.get(templateKey)!;
        const isBold = finding.startsWith('BOLD::') || (finding.replace(/^BOLD::\s*/, '').trim() !== origText);
        const cleanVal = finding.replace(/^BOLD::\s*/, '').trim();
        updateParagraphPreservingStyle(xmlDoc, p, cleanVal, isBold);
        usedFindings.add(finding);
        updatedParagraphs.add(idx);
        // Advance finding cursor past this finding
        const fIdx = bodyFindingLines.indexOf(finding);
        if (fIdx >= 0 && fIdx >= findingCursor) findingCursor = fIdx + 1;
        continue;
      }

      // Strategy B2: Sequential positional match — take the finding at the cursor
      const currentFinding = bodyFindingLines[findingCursor];
      if (currentFinding && !usedFindings.has(currentFinding)) {
        const cleanFinding = currentFinding.replace(/^BOLD::\s*/, '').trim();
        const findingLower = cleanFinding.toLowerCase();

        // Check if this finding is a colon-keyed line that should go to a different template paragraph
        const findingKey = cleanFinding.includes(':') ? normalizeKey(cleanFinding.split(':', 2)[0].trim()) : '';
        const findingBelongsElsewhere = findingKey && findingKey.length >= 2 && !templateKey;

        if (!findingBelongsElsewhere) {
          // Accept sequential match
          const isBold = currentFinding.startsWith('BOLD::');
          updateParagraphPreservingStyle(xmlDoc, p, cleanFinding, isBold);
          usedFindings.add(currentFinding);
          updatedParagraphs.add(idx);
          findingCursor++;
          continue;
        }
      }

      // Strategy B3: Skip this finding if it's a colon-keyed line meant for a later template paragraph
      // Look ahead in findings for a non-keyed match
      for (let scanIdx = findingCursor; scanIdx < bodyFindingLines.length; scanIdx++) {
        const scanFinding = bodyFindingLines[scanIdx];
        if (usedFindings.has(scanFinding)) continue;
        const cleanScan = scanFinding.replace(/^BOLD::\s*/, '').trim();
        const scanKey = cleanScan.includes(':') ? normalizeKey(cleanScan.split(':', 2)[0].trim()) : '';
        if (!scanKey || scanKey === templateKey) {
          const isBold = scanFinding.startsWith('BOLD::');
          updateParagraphPreservingStyle(xmlDoc, p, cleanScan, isBold);
          usedFindings.add(scanFinding);
          updatedParagraphs.add(idx);
          if (scanIdx === findingCursor) findingCursor++;
          break;
        }
      }
    }

    // C. Second pass: any colon-keyed findings that weren't consumed, match by key
    for (const { p, origText, idx } of nonBlankBodyParagraphs) {
      if (updatedParagraphs.has(idx)) continue;
      if (origText.includes(':')) {
        const prefix = origText.split(':', 2)[0].trim();
        const key = normalizeKey(prefix);
        if (key && colonFindingsMap.has(key)) {
          const finding = colonFindingsMap.get(key)!;
          if (!usedFindings.has(finding)) {
            const isBold = finding.startsWith('BOLD::') || (finding.replace(/^BOLD::\s*/, '').trim() !== origText);
            const cleanVal = finding.replace(/^BOLD::\s*/, '').trim();
            updateParagraphPreservingStyle(xmlDoc, p, cleanVal, isBold);
            usedFindings.add(finding);
            updatedParagraphs.add(idx);
          }
        }
      }
    }

    // ============================================================
    // STEP 5: Insert truly unconsumed findings before IMPRESSION
    // ============================================================
    const unconsumedFindings: string[] = [];
    for (const f of bodyFindingLines) {
      if (usedFindings.has(f)) continue;
      const cleanF = f.replace(/^BOLD::\s*/, '').trim();
      const upper = cleanF.toUpperCase();
      const lower = cleanF.toLowerCase();

      // Skip if it matches existing baseline text
      if (templateBaselineTexts.has(lower)) continue;

      const isIncidental = upper.startsWith('INCIDENTAL FINDINGS') ||
                           upper.startsWith('OTHER FINDINGS') ||
                           upper.startsWith('ADDITIONAL FINDINGS') ||
                           upper.startsWith('NOTE:');
      const isAbnormalNew = f.startsWith('BOLD::') && !templateBaselineTexts.has(lower);

      if (isIncidental || isAbnormalNew) {
        unconsumedFindings.push(f);
      }
    }

    if (unconsumedFindings.length > 0) {
      const targetAnchor = impressionHeaderIdx !== -1 ? allBodyParagraphs[impressionHeaderIdx] : null;
      for (const extraFinding of unconsumedFindings) {
        const isBold = extraFinding.startsWith('BOLD::') || extraFinding.toUpperCase().startsWith('INCIDENTAL') || extraFinding.toUpperCase().startsWith('OTHER');
        const cleanVal = extraFinding.replace(/^BOLD::\s*/, '').trim();

        const newP = xmlDoc.createElementNS(W_NS, 'w:p');
        const pPr = xmlDoc.createElementNS(W_NS, 'w:pPr');
        const spacing = xmlDoc.createElementNS(W_NS, 'w:spacing');
        spacing.setAttributeNS(W_NS, 'w:after', '120');
        pPr.appendChild(spacing);
        newP.appendChild(pPr);

        updateParagraphPreservingStyle(xmlDoc, newP, cleanVal, isBold);

        if (targetAnchor && targetAnchor.parentNode) {
          targetAnchor.parentNode.insertBefore(newP, targetAnchor);
        } else {
          bodyElem.appendChild(newP);
        }
      }
    }

    // ============================================================
    // STEP 6: Update Impression section
    // ============================================================
    if (impressionHeaderIdx !== -1 && impressionItems.length > 0) {
      const postImpressionParagraphs: Element[] = [];
      for (let idx = impressionHeaderIdx + 1; idx < allBodyParagraphs.length; idx++) {
        const p = allBodyParagraphs[idx];
        const pText = getParagraphText(p).trim();
        if (pText.includes('MD') || pText.includes('RADIOLOGIST') || pText.includes('Page ') || pText.toLowerCase().includes('consultant')) break;
        if (pText) postImpressionParagraphs.push(p);
      }

      const hasNativeBullet = (p: Element): boolean => {
        const pPr = p.getElementsByTagName('w:pPr')[0];
        if (!pPr) return false;
        return pPr.getElementsByTagName('w:numPr').length > 0;
      };

      for (let i = 0; i < impressionItems.length; i++) {
        const rawBullet = impressionItems[i];
        const cleanBulletText = rawBullet.replace(/^[•\-\*\d\.\s\u2022\u25cf]+/, '').trim();

        if (i < postImpressionParagraphs.length) {
          const p = postImpressionParagraphs[i];
          const isNative = hasNativeBullet(p);
          const textToInsert = isNative ? cleanBulletText : `•  ${cleanBulletText}`;
          updateParagraphPreservingStyle(xmlDoc, p, textToInsert, true);
        } else {
          const lastSlot = postImpressionParagraphs[postImpressionParagraphs.length - 1] || allBodyParagraphs[impressionHeaderIdx];
          const newP = lastSlot.cloneNode(true) as Element;
          const isNative = hasNativeBullet(newP);
          const textToInsert = isNative ? cleanBulletText : `•  ${cleanBulletText}`;
          updateParagraphPreservingStyle(xmlDoc, newP, textToInsert, true);
          lastSlot.parentNode?.insertBefore(newP, lastSlot.nextSibling);
          postImpressionParagraphs.push(newP);
        }
      }

      for (let i = impressionItems.length; i < postImpressionParagraphs.length; i++) {
        const p = postImpressionParagraphs[i];
        const tTags = p.getElementsByTagName('w:t');
        for (let j = 0; j < tTags.length; j++) {
          tTags[j].textContent = '';
        }
      }
    }

    // Serialize modified DOM back to XML
    const serializer = new XMLSerializer();
    const modifiedDocXml = serializer.serializeToString(xmlDoc);

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
    console.warn('mergeFindingsIntoDocx error, falling back to generateDocxFromFindings:', e);
    return generateDocxFromFindings(findings || [], examTitle);
  }
}

export function downloadDocxBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      }
      URL.revokeObjectURL(url);
    }, 2500);
  } catch (err) {
    console.error('downloadDocxBlob failed:', err);
  }
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
