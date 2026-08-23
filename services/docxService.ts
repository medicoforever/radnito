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
          const cleanP = p.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
          if (cleanP) {
            paragraphXmls.push(buildParagraphXml(buildRunXml(`•  ${cleanP}`, true, false, false)));
          }
        }
      }
      continue;
    }

    if (inImpression) {
      const cleanP = raw.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
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

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'and', 'in', 'of', 'with', 'to', 'for', 'no', 'not',
  'seen', 'noted', 'shows', 'displays', 'show', 'well', 'from', 'both', 'each',
  'study', 'sections', 'studied', 'serial', 'axial', 'normal', 'abnormality', 'significant',
  'any', 'there', 'all', 'into', 'upon', 'been', 'which', 'than', 'more'
]);

function extractSignificantWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/);
  const result = new Set<string>();
  for (const w of words) {
    if (w.length > 2 && !STOP_WORDS.has(w)) {
      result.add(w);
    }
  }
  return result;
}

function computeParagraphSimilarity(fWords: Set<string>, pWords: Set<string>, fText: string, pText: string): number {
  const cleanFText = fText.replace(/^BOLD::\s*/, '').trim();
  const cleanPText = pText.replace(/^BOLD::\s*/, '').trim();

  // 1. Colon key match (highest priority, e.g. "L1-L2:", "Clinical Profile:", "Liver:")
  const fParts = cleanFText.split(':', 2);
  const pParts = cleanPText.split(':', 2);
  if (fParts.length > 1 && pParts.length > 1 && fParts[0].trim().split(/\s+/).length <= 6 && pParts[0].trim().split(/\s+/).length <= 6) {
    const fKey = fParts[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const pKey = pParts[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (fKey && pKey && fKey === pKey) {
      return 100.0;
    }
  }

  // 2. Jaccard word similarity on significant anatomical/clinical words
  if (fWords.size === 0 || pWords.size === 0) return 0.0;
  let overlap = 0;
  for (const w of fWords) {
    if (pWords.has(w)) overlap++;
  }
  const union = fWords.size + pWords.size - overlap;
  return union > 0 ? overlap / union : 0.0;
}

export async function mergeFindingsIntoDocx(
  templateBase64?: string | null,
  findings?: string[] | null,
  examTitle: string = 'Radiology Report'
): Promise<Blob> {
  if (!findings || findings.length === 0) {
    if (templateBase64 && templateBase64.trim()) {
      return new Blob([base64ToUint8Array(templateBase64)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    }
    return generateDocxFromFindings([], examTitle);
  }

  // If a native template DOCX exists, surgically replace matching paragraphs in-place preserving 100% of native styles
  if (templateBase64 && templateBase64.trim()) {
    try {
      const templateBytes = base64ToUint8Array(templateBase64);
      const zipEntries = await parseZip(templateBytes.buffer);
      const docXmlEntry = zipEntries.get('word/document.xml');
      if (docXmlEntry) {
        const xmlStr = new TextDecoder('utf-8').decode(docXmlEntry.data);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
        const bodyElem = xmlDoc.getElementsByTagName('w:body')[0];

        if (bodyElem) {
          const allP: Element[] = [];
          for (let i = 0; i < bodyElem.childNodes.length; i++) {
            const node = bodyElem.childNodes[i];
            if (node.nodeType === 1) {
              const el = node as Element;
              if (el.localName === 'p' || el.nodeName === 'w:p') {
                allP.push(el);
              }
            }
          }

          // 1. Separate findings into Body Findings and Impression Items
          const bodyFindings: string[] = [];
          const impressionItems: string[] = [];
          let isInImpression = false;

          for (const f of findings) {
            let trimmed = f.trim();
            if (!trimmed) continue;
            if (trimmed.includes('|') || trimmed.startsWith('+-') || trimmed.startsWith('|-')) continue;
            if (trimmed.toLowerCase().startsWith('title:')) {
              trimmed = trimmed.substring(trimmed.indexOf(':') + 1).trim();
              if (!trimmed) continue;
            }

            if (trimmed.toUpperCase() === 'IMPRESSION:' || trimmed.toUpperCase().startsWith('IMPRESSION:') || trimmed.toUpperCase() === 'CONCLUSION:' || trimmed.toUpperCase().startsWith('CONCLUSION:')) {
              isInImpression = true;
              if (trimmed.includes('###')) {
                const parts = trimmed.split('###').slice(1);
                for (const p of parts) {
                  const cleanP = p.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
                  if (cleanP) impressionItems.push(cleanP);
                }
              }
              continue;
            }

            if (isInImpression) {
              const cleanP = trimmed.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
              if (cleanP) impressionItems.push(cleanP);
              continue;
            }

            bodyFindings.push(trimmed);
          }

          // 2. Locate IMPRESSION Header in Template
          let impIdx = -1;
          for (let i = 0; i < allP.length; i++) {
            const tTags = allP[i].getElementsByTagName('w:t');
            let t = '';
            for (let j = 0; j < tTags.length; j++) t += tTags[j].textContent || '';
            const u = t.trim().toUpperCase();
            if (u === 'IMPRESSION:' || u.startsWith('IMPRESSION:') || u === 'CONCLUSION:' || u.startsWith('CONCLUSION:')) {
              impIdx = i;
              break;
            }
          }

          const endLimit = impIdx !== -1 ? impIdx : allP.length;
          const pTexts: string[] = [];
          const pWordsList: Set<string>[] = [];

          for (let i = 0; i < endLimit; i++) {
            const tTags = allP[i].getElementsByTagName('w:t');
            let t = '';
            for (let j = 0; j < tTags.length; j++) t += tTags[j].textContent || '';
            const cleanT = t.trim();
            pTexts.push(cleanT);
            pWordsList.push(extractSignificantWords(cleanT));
          }

          // 3. Match each Body Finding to its Best Matching Template Paragraph In-Place
          const usedParagraphIndices = new Set<number>();

          for (const finding of bodyFindings) {
            const isBold = finding.startsWith('BOLD::');
            const cleanVal = finding.replace(/^BOLD::\s*/, '').trim();
            const fWords = extractSignificantWords(cleanVal);

            let bestScore = 0.0;
            let bestIdx = -1;

            for (let i = 0; i < endLimit; i++) {
              if (usedParagraphIndices.has(i)) continue;
              const pt = pTexts[i];
              if (!pt) continue;

              const score = computeParagraphSimilarity(fWords, pWordsList[i], cleanVal, pt);
              if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
              }
            }

            // If a high-confidence match is found (colon key match or high word overlap), update paragraph in-place
            if (bestIdx !== -1 && bestScore >= 0.15) {
              usedParagraphIndices.add(bestIdx);
              const p = allP[bestIdx];
              const tTags = p.getElementsByTagName('w:t');

              if (tTags.length > 0) {
                tTags[0].textContent = cleanVal;
                tTags[0].setAttribute('xml:space', 'preserve');
                for (let k = 1; k < tTags.length; k++) tTags[k].textContent = '';
              }

              if (isBold) {
                const runs = p.getElementsByTagName('w:r');
                if (runs.length > 0) {
                  let rPr = runs[0].getElementsByTagName('w:rPr')[0];
                  if (!rPr) {
                    rPr = xmlDoc.createElementNS(W_NS, 'w:rPr');
                    runs[0].insertBefore(rPr, runs[0].firstChild);
                  }
                  let bTag = rPr.getElementsByTagName('w:b')[0];
                  if (!bTag) {
                    bTag = xmlDoc.createElementNS(W_NS, 'w:b');
                    bTag.setAttributeNS(W_NS, 'w:val', '1');
                    rPr.appendChild(bTag);
                  }
                }
              }
            }
          }

          // 4. Update Impression Bullets
          if (impIdx !== -1 && impressionItems.length > 0) {
            const postImpressionSlots: Element[] = [];
            for (let i = impIdx + 1; i < allP.length; i++) {
              const tTags = allP[i].getElementsByTagName('w:t');
              let t = '';
              for (let j = 0; j < tTags.length; j++) t += tTags[j].textContent || '';
              if (t.includes('MD') || t.includes('RADIOLOGIST') || t.includes('Page ') || t.toLowerCase().includes('consultant')) break;
              if (t.trim()) postImpressionSlots.push(allP[i]);
            }

            for (let i = 0; i < impressionItems.length; i++) {
              const bullet = impressionItems[i];
              if (i < postImpressionSlots.length) {
                const p = postImpressionSlots[i];
                const tTags = p.getElementsByTagName('w:t');
                if (tTags.length > 0) {
                  tTags[0].textContent = `•  ${bullet}`;
                  tTags[0].setAttribute('xml:space', 'preserve');
                  for (let k = 1; k < tTags.length; k++) tTags[k].textContent = '';
                }
              } else {
                const lastSlot = postImpressionSlots[postImpressionSlots.length - 1] || allP[impIdx];
                const newP = lastSlot.cloneNode(true) as Element;
                const tTags = newP.getElementsByTagName('w:t');
                if (tTags.length > 0) {
                  tTags[0].textContent = `•  ${bullet}`;
                  tTags[0].setAttribute('xml:space', 'preserve');
                  for (let k = 1; k < tTags.length; k++) tTags[k].textContent = '';
                }
                lastSlot.parentNode?.insertBefore(newP, lastSlot.nextSibling);
                postImpressionSlots.push(newP);
              }
            }

            for (let i = impressionItems.length; i < postImpressionSlots.length; i++) {
              const tTags = postImpressionSlots[i].getElementsByTagName('w:t');
              for (let k = 0; k < tTags.length; k++) tTags[k].textContent = '';
            }
          }

          // 5. Serialize modified XML back into template ZIP
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
        }
      }
    } catch (err) {
      console.warn('mergeFindingsIntoDocx universal matcher error, falling back:', err);
    }
  }

  return generateDocxFromFindings(findings, examTitle);
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
