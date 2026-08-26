import { parseZip, createZip, base64ToUint8Array, ZipEntry } from './docxService';

export interface DocumentAstNode {
  id: string;
  type: 'title' | 'clinical_profile' | 'technique' | 'section_heading' | 'inline_field' | 'narrative' | 'impression_header' | 'impression_item' | 'table_cell';
  section?: string;
  label?: string;
  current_text: string;
  current_val?: string;
  row_label?: string;
  col_label?: string;
  bold?: boolean;
}

export interface AstMutation {
  node_id: string;
  action?: 'replace_text' | 'update_value' | 'set_cell';
  new_text: string;
  bold?: boolean;
}

export interface AstInsertion {
  after_node_id?: string;
  text: string;
  bold?: boolean;
}

function getElementText(el: Element): string {
  const tTags = el.getElementsByTagName('w:t');
  let txt = '';
  for (let i = 0; i < tTags.length; i++) {
    txt += tTags[i].textContent || '';
  }
  return txt;
}

function getDirectChildren(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.localName === localName || el.nodeName === `w:${localName}`) {
        result.push(el);
      }
    }
  }
  return result;
}

function cleanImpressionText(raw: string): string {
  let s = raw.replace(/^BOLD::\s*/, '');
  s = s.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\*\d\.\)\(•]+/gu, '');
  s = s.replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\*\d\.\)\(•]+/gu, '');
  s = s.replace(/^["'\s]+|["'\s]+$/g, '');
  s = s.replace(/\[(?:raw findings|user query|citation)[^\]]*\]/gi, '').replace(/\s{2,}/g, ' ');
  return s.trim();
}

/**
 * Parses a DOCX template binary into a Semantic Document AST and maps each node ID to DOM elements.
 */
export async function buildDocumentAstFromDocx(docxBase64: string): Promise<{
  ast: DocumentAstNode[];
  xmlDoc: Document;
  zipEntries: Map<string, ZipEntry>;
  pMap: Map<string, Element>;
  cellMap: Map<string, Element>;
  impressionHeaderId?: string;
  impressionSlotIds: string[];
}> {
  const templateBytes = base64ToUint8Array(docxBase64);
  const zipEntries = await parseZip(templateBytes.buffer);

  const docXmlEntry = zipEntries.get('word/document.xml');
  if (!docXmlEntry) {
    throw new Error('word/document.xml not found in DOCX file.');
  }

  const decoder = new TextDecoder('utf-8');
  const docXml = decoder.decode(docXmlEntry.data);

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, 'application/xml');

  const body = xmlDoc.getElementsByTagName('w:body')[0];
  if (!body) {
    throw new Error('w:body element not found in Word XML.');
  }

  // Normalize DOM: Split any legacy template paragraphs with conjoined section headings or embedded IMPRESSION:
  const initialParagraphs: Element[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType === 1) {
      const el = node as Element;
      const tag = el.localName || el.nodeName.replace(/^w:/, '');
      if (tag === 'p') initialParagraphs.push(el);
    }
  }

  for (const p of initialParagraphs) {
    const txt = getElementText(p).trim();
    if (!txt) continue;

    // Detect if paragraph contains embedded section heading or IMPRESSION: (e.g. "Technique: ... Bones and joints:" or "... fluid collection is seen. IMPRESSION:")
    const match = txt.match(/^(.+?)\s+(Bones and joints:|Soft tissues?:|Meniscus:|Ligaments:|Screening of [^:]+:|IMPRESSION:|CONCLUSION:)\s*(.*)$/i);
    if (match) {
      const prefix = match[1].trim();
      const heading = match[2].trim();
      const suffix = match[3].trim();

      // If prefix is just the heading itself (e.g. "Bones and joints:"), do not split
      if (prefix.toLowerCase() === heading.toLowerCase() || prefix.toLowerCase().endsWith('rest of')) continue;

      // Clean prefix runs in p
      const pPr = p.getElementsByTagName('w:pPr')[0];
      while (p.firstChild) {
        p.removeChild(p.firstChild);
      }
      if (pPr) p.appendChild(pPr);
      const prefR = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
      const prefRPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      const prefFonts = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
      prefFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ascii', 'Times New Roman');
      prefFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hAnsi', 'Times New Roman');
      prefFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:cs', 'Times New Roman');
      prefRPr.appendChild(prefFonts);
      prefR.appendChild(prefRPr);
      const prefT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
      prefT.textContent = prefix;
      prefR.appendChild(prefT);
      p.appendChild(prefR);

      // Create newHeadP for heading
      const newHeadP = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
      const headPPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
      const spacing = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:spacing');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', '120');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', '40');
      headPPr.appendChild(spacing);
      const kwn = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:keepWithNext');
      headPPr.appendChild(kwn);
      newHeadP.appendChild(headPPr);

      const newR = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
      const newRPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      const rFonts = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ascii', 'Times New Roman');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hAnsi', 'Times New Roman');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:cs', 'Times New Roman');
      newRPr.appendChild(rFonts);
      const b = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
      const u = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
      u.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', 'single');
      newRPr.appendChild(b);
      newRPr.appendChild(u);
      newR.appendChild(newRPr);
      const newT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
      newT.textContent = heading;
      newR.appendChild(newT);
      newHeadP.appendChild(newR);

      p.parentNode?.insertBefore(newHeadP, p.nextSibling);

      if (suffix) {
        const newSufP = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
        const sufR = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
        const sufT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
        sufT.textContent = suffix;
        sufR.appendChild(sufT);
        newSufP.appendChild(sufR);
        newHeadP.parentNode?.insertBefore(newSufP, newHeadP.nextSibling);
      }
    }
  }

  const ast: DocumentAstNode[] = [];
  const pMap = new Map<string, Element>();
  const cellMap = new Map<string, Element>();
  let impressionHeaderId: string | undefined;
  const impressionSlotIds: string[] = [];

  let nodeIndex = 0;
  let tableCount = 0;
  let inImpressionSection = false;
  let currentSection = 'header';

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.localName || el.nodeName.replace(/^w:/, '');

    if (tag === 'p') {
      const txt = getElementText(el).trim();
      if (!txt) continue; // Preserve blank spacer lines in DOM without exposing confusing indices to AI

      const nodeId = `node_${nodeIndex}`;
      pMap.set(nodeId, el);
      // Support legacy p_ index aliases for backward compatibility
      pMap.set(`p_${nodeIndex}`, el);

      let pType: DocumentAstNode['type'] = 'narrative';
      let label: string | undefined;
      let val: string | undefined = txt;

      const upper = txt.toUpperCase();
      if (upper === 'IMPRESSION:' || upper.startsWith('IMPRESSION:') || upper === 'CONCLUSION:' || upper.startsWith('CONCLUSION:')) {
        pType = 'impression_header';
        impressionHeaderId = nodeId;
        inImpressionSection = true;
        currentSection = 'impression';
      } else if (inImpressionSection) {
        pType = 'impression_item';
        if (txt && !txt.includes('MD') && !txt.includes('RADIOLOGIST') && !txt.includes('Page ')) {
          impressionSlotIds.push(nodeId);
        }
      } else if (upper.startsWith('*CLINICAL PROFILE') || upper.startsWith('CLINICAL PROFILE:')) {
        pType = 'clinical_profile';
      } else if (upper.startsWith('TECHNIQUE:') || upper.startsWith('SCANNING TECHNIQUE:') || upper.startsWith('PROTOCOL:')) {
        pType = 'technique';
      } else if (txt.endsWith(':') || (txt.includes(':') && txt.split(':')[0].split(/\s+/).length <= 4 && !txt.split(':')[1].trim())) {
        pType = 'section_heading';
        label = txt.split(':')[0].trim();
        currentSection = label.toLowerCase().replace(/[^a-z0-9]/g, '');
      } else if (txt.includes(':') && !upper.startsWith('FINDINGS') && !upper.startsWith('OBSERVATIONS') && !upper.startsWith('C.T.') && !upper.startsWith('MRI')) {
        pType = 'inline_field';
        const parts = txt.split(':', 2);
        label = parts[0].trim();
        val = parts[1]?.trim();
      } else if (nodeIndex === 0) {
        pType = 'title';
      }

      ast.push({
        id: nodeId,
        type: pType,
        section: currentSection,
        label,
        current_text: txt,
        current_val: val,
      });
      nodeIndex++;
    } else if (tag === 'tbl') {
      const tblIndex = tableCount++;
      const rows = getDirectChildren(el, 'tr');
      const headerLabels: string[] = [];

      if (rows.length > 0) {
        const headerCells = getDirectChildren(rows[0], 'tc');
        for (const hc of headerCells) {
          headerLabels.push(getElementText(hc).trim());
        }
      }

      for (let r_i = 0; r_i < rows.length; r_i++) {
        const cells = getDirectChildren(rows[r_i], 'tc');
        const rowLabel = cells.length > 0 ? getElementText(cells[0]).trim() : `Row_${r_i}`;

        for (let c_i = 0; c_i < cells.length; c_i++) {
          const cellId = `tbl_${tblIndex}_r_${r_i}_c_${c_i}`;
          cellMap.set(cellId, cells[c_i]);
          const cellText = getElementText(cells[c_i]).trim();

          if (r_i > 0 || rows.length === 1) {
            ast.push({
              id: cellId,
              type: 'table_cell',
              row_label: rowLabel,
              col_label: headerLabels[c_i] || '',
              current_text: cellText,
              current_val: cellText,
            });
          }
        }
      }
    }
  }

  return {
    ast,
    xmlDoc,
    zipEntries,
    pMap,
    cellMap,
    impressionHeaderId,
    impressionSlotIds,
  };
}

/**
 * Applies targeted AST mutations surgically in-place to the XML DOM without altering any style properties.
 */
export async function applyAstMutationsToDocx(
  xmlDoc: Document,
  zipEntries: Map<string, ZipEntry>,
  pMap: Map<string, Element>,
  cellMap: Map<string, Element>,
  mutations: AstMutation[],
  impressionItems?: string[],
  impressionSlotIds: string[] = [],
  impressionHeaderId?: string,
  insertedFindings?: (string | AstInsertion)[]
): Promise<Blob> {
  const ensureRunFormatting = (run: Element, makeBold: boolean, isHeading?: boolean) => {
    let rPr = run.getElementsByTagName('w:rPr')[0];
    if (!rPr) {
      rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      run.insertBefore(rPr, run.firstChild);
    }
    let rFonts = rPr.getElementsByTagName('w:rFonts')[0];
    if (!rFonts) {
      rFonts = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
      rPr.appendChild(rFonts);
    }
    rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ascii', 'Times New Roman');
    rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hAnsi', 'Times New Roman');
    rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:cs', 'Times New Roman');

    let sz = rPr.getElementsByTagName('w:sz')[0];
    if (!sz) {
      sz = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:sz');
      rPr.appendChild(sz);
    }
    sz.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');
    let szCs = rPr.getElementsByTagName('w:szCs')[0];
    if (!szCs) {
      szCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:szCs');
      rPr.appendChild(szCs);
    }
    szCs.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');

    if (makeBold || isHeading) {
      let bTag = rPr.getElementsByTagName('w:b')[0];
      if (!bTag) {
        bTag = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
        rPr.appendChild(bTag);
      }
      let bCsTag = rPr.getElementsByTagName('w:bCs')[0];
      if (!bCsTag) {
        bCsTag = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:bCs');
        rPr.appendChild(bCsTag);
      }
    }

    if (isHeading) {
      let uTag = rPr.getElementsByTagName('w:u')[0];
      if (!uTag) {
        uTag = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
        uTag.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', 'single');
        rPr.appendChild(uTag);
      }
    }
  };

  const applyTextToParagraphRuns = (p: Element, rawText: string, defaultBold?: boolean) => {
    const isHeading = rawText.endsWith(':') && rawText.length < 55;
    let pPr = p.getElementsByTagName('w:pPr')[0];
    if (!pPr) {
      pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
      p.insertBefore(pPr, p.firstChild);
    }

    let spacing = pPr.getElementsByTagName('w:spacing')[0];
    if (!spacing) {
      spacing = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:spacing');
      pPr.appendChild(spacing);
    }
    if (isHeading) {
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', '120');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', '40');
      let kwn = pPr.getElementsByTagName('w:keepWithNext')[0];
      if (!kwn) {
        kwn = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:keepWithNext');
        pPr.appendChild(kwn);
      }
    } else {
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', '0');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', '60');
    }
    spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:line', '240');
    spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:lineRule', 'auto');

    const allRuns: Element[] = [];
    for (let i = 0; i < p.childNodes.length; i++) {
      if (p.childNodes[i].nodeName === 'w:r' || (p.childNodes[i] as Element).localName === 'r') {
        allRuns.push(p.childNodes[i] as Element);
      }
    }
    if (allRuns.length === 0) {
      const newRun = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
      const pRPr = pPr?.getElementsByTagName('w:rPr')[0];
      if (pRPr) {
        newRun.appendChild(pRPr.cloneNode(true));
      }
      const newT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
      newRun.appendChild(newT);
      p.appendChild(newRun);
      allRuns.push(newRun);
    }

    const firstRun = allRuns[0];

    const colonMatch = rawText.match(/^((?:Clinical profile|Clinical history|Technique|Scanning technique|Protocol):)\s*(.*)$/i);
    if (colonMatch) {
      const labelText = colonMatch[1] + ' ';
      const valText = colonMatch[2];

      ensureRunFormatting(firstRun, true, true);
      const tTags = firstRun.getElementsByTagName('w:t');
      if (tTags.length > 0) {
        tTags[0].textContent = labelText;
        tTags[0].setAttribute('xml:space', 'preserve');
        for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
      }

      if (valText) {
        let secondRun: Element;
        if (allRuns.length > 1) {
          secondRun = allRuns[1];
        } else {
          secondRun = firstRun.cloneNode(true) as Element;
          firstRun.parentNode?.insertBefore(secondRun, firstRun.nextSibling);
        }
        ensureRunFormatting(secondRun, false, false);
        const secondTTags = secondRun.getElementsByTagName('w:t');
        if (secondTTags.length > 0) {
          secondTTags[0].textContent = valText;
          secondTTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < secondTTags.length; j++) secondTTags[j].textContent = '';
        }
        for (let j = 2; j < allRuns.length; j++) {
          const laterTags = allRuns[j].getElementsByTagName('w:t');
          for (let k = 0; k < laterTags.length; k++) laterTags[k].textContent = '';
        }
      }
      return;
    }

    if (rawText.includes('BOLD::')) {
      const boldIdx = rawText.indexOf('BOLD::');
      const prefix = rawText.substring(0, boldIdx);
      const boldText = rawText.substring(boldIdx + 6);

      if (prefix) {
        ensureRunFormatting(firstRun, !!defaultBold, isHeading);
        const tTags = firstRun.getElementsByTagName('w:t');
        if (tTags.length > 0) {
          tTags[0].textContent = prefix;
          tTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
        }

        let secondRun: Element;
        if (allRuns.length > 1) {
          secondRun = allRuns[1];
        } else {
          secondRun = firstRun.cloneNode(true) as Element;
          firstRun.parentNode?.insertBefore(secondRun, firstRun.nextSibling);
        }
        ensureRunFormatting(secondRun, true, isHeading);
        const secondTTags = secondRun.getElementsByTagName('w:t');
        if (secondTTags.length > 0) {
          secondTTags[0].textContent = boldText;
          secondTTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < secondTTags.length; j++) secondTTags[j].textContent = '';
        }

        for (let j = 2; j < allRuns.length; j++) {
          const laterTags = allRuns[j].getElementsByTagName('w:t');
          for (let k = 0; k < laterTags.length; k++) laterTags[k].textContent = '';
        }
      } else {
        ensureRunFormatting(firstRun, true, isHeading);
        const tTags = firstRun.getElementsByTagName('w:t');
        if (tTags.length > 0) {
          tTags[0].textContent = boldText;
          tTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
        }
        for (let j = 1; j < allRuns.length; j++) {
          const laterTags = allRuns[j].getElementsByTagName('w:t');
          for (let k = 0; k < laterTags.length; k++) laterTags[k].textContent = '';
        }
      }
    } else {
      ensureRunFormatting(firstRun, !!defaultBold, isHeading);
      const tTags = firstRun.getElementsByTagName('w:t');
      if (tTags.length > 0) {
        tTags[0].textContent = rawText;
        tTags[0].setAttribute('xml:space', 'preserve');
        for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
      }
      for (let j = 1; j < allRuns.length; j++) {
        const laterTags = allRuns[j].getElementsByTagName('w:t');
        for (let k = 0; k < laterTags.length; k++) laterTags[k].textContent = '';
      }
    }
  };

  // 1. Apply Paragraph and Table Cell mutations with clean DOM node removal for cleared paragraphs
  for (const mut of mutations) {
    const nid = mut.node_id;
    const cleanText = (mut.new_text || '').trim();

    if (pMap.has(nid)) {
      const p = pMap.get(nid)!;
      if (!cleanText) {
        // Remove the superseded/contradicted paragraph element cleanly from DOM (no leftover empty blank lines)
        if (p.parentNode) {
          p.parentNode.removeChild(p);
        } else {
          const tTags = p.getElementsByTagName('w:t');
          for (let k = 0; k < tTags.length; k++) tTags[k].textContent = '';
        }
      } else {
        applyTextToParagraphRuns(p, cleanText, mut.bold);
      }
    } else if (cellMap.has(nid)) {
      const tc = cellMap.get(nid)!;
      const p = tc.getElementsByTagName('w:p')[0];
      if (p) {
        if (!cleanText) {
          const tTags = p.getElementsByTagName('w:t');
          for (let k = 0; k < tTags.length; k++) tTags[k].textContent = '';
        } else {
          applyTextToParagraphRuns(p, cleanText, mut.bold);
        }
      }
    }
  }

  // 1.5. Clean-Run Paragraph Insertion for Incidental / Non-Template Findings
  if (insertedFindings && insertedFindings.length > 0) {
    let headerEl: Element | null = null;
    if (impressionHeaderId && pMap.has(impressionHeaderId)) {
      headerEl = pMap.get(impressionHeaderId)!;
    }
    if (!headerEl) {
      pMap.forEach((el) => {
        if (!headerEl) {
          const t = getElementText(el).trim().toUpperCase();
          if (t === 'IMPRESSION:' || t.startsWith('IMPRESSION:') || t === 'CONCLUSION:' || t.startsWith('CONCLUSION:')) {
            headerEl = el;
          }
        }
      });
    }

    const createCleanBodyParagraph = (rawText: string, isBold: boolean): Element => {
      const isHeading = rawText.endsWith(':') && rawText.length < 55;
      const p = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
      const pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
      const spacing = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:spacing');
      if (isHeading) {
        spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', '120');
        spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', '40');
        const kwn = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:keepWithNext');
        pPr.appendChild(kwn);
      } else {
        spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', '0');
        spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', '60');
      }
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:line', '240');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:lineRule', 'auto');
      pPr.appendChild(spacing);

      const rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
      const rFonts = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ascii', 'Times New Roman');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hAnsi', 'Times New Roman');
      rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:cs', 'Times New Roman');
      rPr.appendChild(rFonts);

      const sz = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:sz');
      sz.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');
      rPr.appendChild(sz);
      const szCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:szCs');
      szCs.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');
      rPr.appendChild(szCs);

      if (isBold || isHeading) {
        const b = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
        rPr.appendChild(b);
        const bCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:bCs');
        rPr.appendChild(bCs);
      }

      if (isHeading) {
        const u = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
        u.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', 'single');
        rPr.appendChild(u);
      }

      pPr.appendChild(rPr);
      p.appendChild(pPr);

      const r = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
      r.appendChild(rPr.cloneNode(true));
      const t = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
      t.textContent = rawText;
      t.setAttribute('xml:space', 'preserve');
      r.appendChild(t);
      p.appendChild(r);

      return p;
    };

    for (const item of insertedFindings) {
      let rawText = '';
      let isBold = false;
      let afterNodeId: string | undefined;

      if (typeof item === 'string') {
        isBold = item.startsWith('BOLD::') || item.includes('BOLD::');
        rawText = item.replace(/^BOLD::\s*/, '').trim();
      } else if (item && typeof item === 'object') {
        rawText = (item.text || '').replace(/^BOLD::\s*/, '').trim();
        isBold = !!(item.bold || (item.text && item.text.startsWith('BOLD::')));
        afterNodeId = item.after_node_id;
      }

      if (!rawText) continue;

      const newP = createCleanBodyParagraph(rawText, isBold);

      let anchorEl: Element | null = null;
      if (afterNodeId && pMap.has(afterNodeId)) {
        anchorEl = pMap.get(afterNodeId)!;
      }

      if (anchorEl && anchorEl.parentNode) {
        anchorEl.parentNode.insertBefore(newP, anchorEl.nextSibling);
      } else if (headerEl && headerEl.parentNode) {
        headerEl.parentNode.insertBefore(newP, headerEl);
      }
    }
  }

  // 2. Apply Impression Bullets
  if (impressionItems && impressionItems.length > 0) {
    let headerEl: Element | null = null;
    if (impressionHeaderId && pMap.has(impressionHeaderId)) {
      headerEl = pMap.get(impressionHeaderId)!;
    }
    if (!headerEl) {
      // Find IMPRESSION: or CONCLUSION: paragraph in DOM
      pMap.forEach((el) => {
        if (!headerEl) {
          const t = getElementText(el).trim().toUpperCase();
          if (t === 'IMPRESSION:' || t.startsWith('IMPRESSION:') || t === 'CONCLUSION:' || t.startsWith('CONCLUSION:')) {
            headerEl = el;
          }
        }
      });
    }

    const formatBulletParagraph = (p: Element, rawBullet: string) => {
      const cleanBullet = cleanImpressionText(rawBullet);

      // Clean existing pPr completely
      let oldPPr = p.getElementsByTagName('w:pPr')[0];
      if (oldPPr) p.removeChild(oldPPr);

      const pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
      p.insertBefore(pPr, p.firstChild);

      const isRecommendation = /\b(suggested|advised|clinical correlation|please correlate)\b/i.test(cleanBullet);

      // 1. keepLines
      const keepLines = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:keepLines');
      pPr.appendChild(keepLines);

      // 2. spacing
      const spacing = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:spacing');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:before', isRecommendation ? '120' : '0');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:after', isRecommendation ? '0' : '40');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:line', '240');
      spacing.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:lineRule', 'auto');
      pPr.appendChild(spacing);

      // 3. ind (for bullets only)
      if (!isRecommendation) {
        const ind = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ind');
        ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:left', '360');
        ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hanging', '360');
        pPr.appendChild(ind);
      }

      // Format all runs in strict CT_RPr order: rFonts -> b -> bCs -> sz -> szCs
      const rTags = p.getElementsByTagName('w:r');
      for (let r_i = 0; r_i < rTags.length; r_i++) {
        const r = rTags[r_i];
        let oldRPr = r.getElementsByTagName('w:rPr')[0];
        if (oldRPr) r.removeChild(oldRPr);

        const rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
        r.insertBefore(rPr, r.firstChild);

        // 1. rFonts
        const rFonts = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rFonts');
        rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ascii', 'Times New Roman');
        rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hAnsi', 'Times New Roman');
        rFonts.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:cs', 'Times New Roman');
        rPr.appendChild(rFonts);

        // 2. b & bCs (bullets bold, recommendation normal)
        if (!isRecommendation) {
          const b = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
          rPr.appendChild(b);
          const bCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:bCs');
          rPr.appendChild(bCs);
        }

        // 3. sz & szCs
        const sz = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:sz');
        sz.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');
        rPr.appendChild(sz);
        const szCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:szCs');
        szCs.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', '24');
        rPr.appendChild(szCs);
      }

      const tTags = p.getElementsByTagName('w:t');
      if (tTags.length > 0) {
        tTags[0].textContent = isRecommendation ? cleanBullet : `•  ${cleanBullet}`;
        tTags[0].setAttribute('xml:space', 'preserve');
        for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
      }
    };

    // Clean up old slot elements and any existing paragraphs after headerEl
    if (headerEl && headerEl.parentNode) {
      const parent = headerEl.parentNode;

      // Keep IMPRESSION: header with the first bullet point (prevents orphan headers)
      let headPPr = headerEl.getElementsByTagName('w:pPr')[0];
      if (!headPPr) {
        headPPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
        headerEl.insertBefore(headPPr, headerEl.firstChild);
      }
      let kwn = headPPr.getElementsByTagName('w:keepWithNext')[0] || headPPr.getElementsByTagName('w:keepNext')[0];
      if (!kwn) {
        kwn = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:keepNext');
        headPPr.insertBefore(kwn, headPPr.firstChild);
      }
      const toRemove: Element[] = [];
      let sib = headerEl.nextSibling;
      while (sib) {
        if (sib.nodeType === 1) {
          const el = sib as Element;
          if (el.localName === 'p' || el.nodeName === 'w:p') {
            toRemove.push(el);
          }
        }
        sib = sib.nextSibling;
      }
      for (const el of toRemove) {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }

      let lastInserted: Element = headerEl;
      for (let i = 0; i < impressionItems.length; i++) {
        const rawItem = impressionItems[i];
        const cleanBullet = cleanImpressionText(rawItem);
        if (!cleanBullet) continue;
        const u = cleanBullet.toUpperCase();
        if (u === 'IMPRESSION:' || u === 'CONCLUSION:' || u === 'IMPRESSION' || u === 'CONCLUSION') continue;

        const newP = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
        const newR = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
        const newT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
        newR.appendChild(newT);
        newP.appendChild(newR);

        formatBulletParagraph(newP, cleanBullet);
        parent.insertBefore(newP, lastInserted.nextSibling);
        lastInserted = newP;
      }
    }
  } else {
      // If neither slot nor header exists, append IMPRESSION: header and bullets to w:body
      const body = xmlDoc.getElementsByTagName('w:body')[0];
      if (body) {
        const sectPr = body.getElementsByTagName('w:sectPr')[0];
        
        const headP = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
        const headR = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
        const headRPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
        const headB = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
        const headU = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
        headU.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', 'single');
        headRPr.appendChild(headB);
        headRPr.appendChild(headU);
        headR.appendChild(headRPr);
        const headT = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
        headT.textContent = 'IMPRESSION:';
        headR.appendChild(headT);
        headP.appendChild(headR);

        if (sectPr) {
          body.insertBefore(headP, sectPr);
        } else {
          body.appendChild(headP);
        }

        let lastInserted: Element = headP;
        for (let i = 0; i < impressionItems.length; i++) {
          const cleanBullet = impressionItems[i].replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
          const p = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p');
          const r = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
          const t = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
          t.textContent = cleanBullet;
          t.setAttribute('xml:space', 'preserve');
          r.appendChild(t);
          p.appendChild(r);

          formatBulletParagraph(p, cleanBullet);

          if (sectPr) {
            body.insertBefore(p, sectPr);
          } else {
            body.appendChild(p);
          }
          lastInserted = p;
        }
      }
    }


  // 3. Serialize modified DOM back into DOCX zip
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

/**
 * Surgically merges a structured findings array into a template DOCX using the Semantic AST engine.
 * 100% deterministic, 0 API calls, 100% style/font/spacing preservation identical to AST auto-download.
 */
export async function mergeFindingsIntoDocxWithAstEngine(
  templateBase64: string,
  findings: string[]
): Promise<Blob> {
  const { ast, xmlDoc, zipEntries, pMap, cellMap, impressionHeaderId, impressionSlotIds } = await buildDocumentAstFromDocx(templateBase64);

  // 1. Separate findings into Table Rows, Body Paragraphs, and Impression Items
  const tableRowFindings: string[] = [];
  const paragraphFindings: string[] = [];
  const impressionItems: string[] = [];
  let isInImpression = false;

  const titleNode = ast.find(n => n.type === 'title');
  const templateTitleNormalized = (titleNode?.current_text || ast[0]?.current_text || '')
  // Flatten and expand findings (in case lines are conjoined or pasted in one item)
  const expandedRawLines: string[] = [];
  for (const item of findings) {
    if (!item) continue;
    const lines = item.split(/\r?\n/);
    for (const l of lines) {
      if (l.trim()) expandedRawLines.push(l.trim());
    }
  }

  let inImpressionSection = false;
  let rawImpressionAccumulator = '';

  const isTitleHeader = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    if (t.endsWith(':') || t.toLowerCase().includes('clinical profile') || t.toLowerCase().includes('technique')) return false;

    const cleanT = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (templateTitleNormalized && (cleanT === templateTitleNormalized || cleanT.includes(templateTitleNormalized) || templateTitleNormalized.includes(cleanT))) {
      return true;
    }

    if (/^(?:MRI|CT|X-?RAY|USG|ULTRASOUND|PET-?CT|DEXA|MRA|MRV|HRCT|NCCT|CECT)\b/i.test(t) &&
        !/\b(?:is seen|are seen|noted|reveals|show|shows|effusion|fracture|edema|tear|lesion|infarct|mass|normal|abnormal)\b/i.test(t)) {
      return true;
    }
    return false;
  };

  for (let fIdx = 0; fIdx < expandedRawLines.length; fIdx++) {
    const rawLine = expandedRawLines[fIdx];
    let trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('+-') || trimmed.startsWith('|-') || trimmed.startsWith('+=')) continue;
    if (trimmed.toLowerCase().startsWith('title:')) continue;

    // Check if line contains IMPRESSION or CONCLUSION
    const normLine = trimmed.replace(/^[\s\.\*\-\u2022\"'\u00a0\u200b]+/, '');
    if (normLine.toUpperCase() === 'IMPRESSION:' || normLine.toUpperCase().startsWith('IMPRESSION:') || normLine.toUpperCase() === 'CONCLUSION:' || normLine.toUpperCase().startsWith('CONCLUSION:')) {
      inImpressionSection = true;
      rawImpressionAccumulator += '\n' + trimmed;
      continue;
    }

    if (inImpressionSection) {
      rawImpressionAccumulator += '\n' + trimmed;
      continue;
    }

    // Split conjoined headings if present (e.g. "MRI SCAN OF RIGHT KNEE JOINTClinical profile: C/o...")
    const conjoinedParts = trimmed.split(/(?=(?:Clinical profile:|Technique:|Bones and joints:|Meniscus:|Ligaments:|Rest of soft tissues:|IMPRESSION:|CONCLUSION:))/i);
    for (const cp of conjoinedParts) {
      const cleanSub = cp.trim().replace(/^[\s\.\*\-\u2022\u00a0\u200b]+/, '').trim();
      if (!cleanSub) continue;

      if (isTitleHeader(cleanSub)) {
        continue;
      }

      if (cleanSub.includes('|')) {
        tableRowFindings.push(cleanSub);
        continue;
      }

      const knownHeadings = ['Bones and joints:', 'Meniscus:', 'Ligaments:', 'Rest of soft tissues:', 'Clinical profile:', 'Technique:'];
      let matchedH: string | null = null;
      for (const kh of knownHeadings) {
        if (cleanSub.toLowerCase().startsWith(kh.toLowerCase())) {
          matchedH = kh;
          break;
        }
      }

      if (matchedH && cleanSub.length > matchedH.length) {
        const afterH = cleanSub.substring(matchedH.length).trim();
        paragraphFindings.push(matchedH);
        if (afterH) {
          paragraphFindings.push(afterH);
        }
      } else {
        paragraphFindings.push(cleanSub);
      }
    }
  }

  // Parse all accumulated impression text into discrete clean bullet points
  if (rawImpressionAccumulator) {
    let cleanedImp = rawImpressionAccumulator.replace(/\[(?:raw findings|user query|citation)[^\]]*\]/gi, '');
    cleanedImp = cleanedImp.replace(/(?<=\.)\s+(?=(?:Suggested|Advised|Clinical correlation|Please correlate)\b)/gi, '\n');
    const rawParts = cleanedImp.split(/(?:###|""|"\s*"\s*|(?:\.|\))\s*"|[\r\n]+|(?<=[a-z0-9\.\)])\s*•\s*)/);
    for (const part of rawParts) {
      let p = cleanImpressionText(part);
      if (!p) continue;
      const u = p.toUpperCase().replace(/[^A-Z]/g, '');
      if (u === 'IMPRESSION' || u === 'CONCLUSION' || u === 'IMPRESSIONS' || u === 'CONCLUSIONS') {
        continue;
      }
      if (p.toUpperCase().startsWith('IMPRESSION:') || p.toUpperCase().startsWith('CONCLUSION:')) {
        const colonIdx = p.indexOf(':');
        if (colonIdx !== -1) {
          let after = cleanImpressionText(p.substring(colonIdx + 1));
          const afterU = after.toUpperCase().replace(/[^A-Z]/g, '');
          if (after.length > 3 && afterU !== 'IMPRESSION' && afterU !== 'CONCLUSION') {
            impressionItems.push(after.endsWith('.') ? after : `${after}.`);
          }
        }
        continue;
      }
      if (p.length > 3) {
        impressionItems.push(p.endsWith('.') ? p : `${p}.`);
      }
    }
  }

  const mutations: AstMutation[] = [];
  const usedNodeIds = new Set<string>();

  // A. Process Table Row Findings against table_cell nodes
  const tableCellNodes = ast.filter(n => n.type === 'table_cell');
  
  const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

  const rowAliases: Record<string, string[]> = {
    mpa: ['mainpulmonaryartery', 'mainpulmonarytrunk', 'pulmonarytrunk', 'mpa'],
    rpa: ['rightpulmonaryartery', 'rightmainpulmonaryartery', 'rpa'],
    lpa: ['leftpulmonaryartery', 'leftmainpulmonaryartery', 'lpa'],
    mpaaortaratio: ['mpatoaortaratio', 'mpaaortaratio', 'pulmonaryarterytoaortaratio'],
    apicalra1: ['apicalra1', 'ra1', 'apicalsegment', 'rulapical', 'apical'],
    anteriorra2: ['anteriorra2', 'ra2', 'anteriorsegment', 'rulanterior'],
    posteriorra3: ['posteriorra3', 'ra3', 'posteriorsegment', 'rulposterior'],
    lateralra4: ['lateralra4', 'ra4', 'lateralsegment', 'rmllateral'],
    medialra5: ['medialra5', 'ra5', 'medialsegment', 'rmlmedial'],
    superiorra6: ['superiorra6', 'ra6', 'superiorsegment', 'rllsuperior'],
    medialra7: ['medialra7', 'ra7', 'medialbasal', 'rllmedial'],
    anteriorra8: ['anteriorra8', 'ra8', 'anteriorbasal', 'rllanterior'],
    lateralra9: ['lateralra9', 'ra9', 'lateralbasal', 'rlllateral'],
    posteriorra10: ['posteriorra10', 'ra10', 'posteriorbasal', 'rllposterior'],
    apicopostla13: ['apicopostla13', 'apicoposterior', 'la13', 'la1', 'la3', 'lulapicopost'],
    anteriorla2: ['anteriorla2', 'la2', 'lulanterior'],
    suplingulala4: ['suplingulala4', 'superiorlingula', 'la4', 'lingulasuperior'],
    inflingulala5: ['inflingulala5', 'inferiorlingula', 'la5', 'lingulainferior'],
    superiorla6: ['superiorla6', 'la6', 'lllsuperior'],
    antmedialla78: ['antmedialla78', 'anteromedial', 'la78', 'la7', 'la8', 'lllanteromedial'],
    lateralla9: ['lateralla9', 'la9', 'llllateral'],
    posteriorla10: ['posteriorla10', 'la10', 'lllposterior'],
  };

  const matchesRow = (targetKey: string, cellKey: string): boolean => {
    if (!targetKey || !cellKey) return false;
    if (targetKey === cellKey) return true;
    
    // Check canonical aliases
    for (const [canonical, aliases] of Object.entries(rowAliases)) {
      const allKeys = [canonical, ...aliases];
      const targetMatches = allKeys.includes(targetKey);
      const cellMatches = allKeys.includes(cellKey);
      if (targetMatches && cellMatches) return true;
    }

    // Substring match only if both are >= 6 chars and neither is a compound ratio
    if (targetKey.length >= 6 && cellKey.length >= 6 && !targetKey.includes('ratio') && !cellKey.includes('ratio')) {
      if (targetKey.startsWith(cellKey) || cellKey.startsWith(targetKey)) {
        return true;
      }
    }
    return false;
  };

  for (const rowStr of tableRowFindings) {
    const cols = rowStr.split('|').map(c => c.replace(/^BOLD::\s*/, '').trim());
    if (cols.length < 2) continue;
    const rowKey = normalizeKey(cols[0]);
    if (!rowKey) continue;

    // Match table cells whose row_label matches rowKey
    for (const cell of tableCellNodes) {
      const cellRowLabel = normalizeKey(cell.row_label || cell.current_text || '');
      if (matchesRow(rowKey, cellRowLabel)) {
        // e.g. cell.id is 'tbl_0_r_1_c_1' -> get column index from cell.id
        const cMatch = cell.id.match(/_c_(\d+)$/);
        if (cMatch) {
          const colIdx = parseInt(cMatch[1], 10);
          if (colIdx >= 1 && colIdx < cols.length) {
            const targetVal = cols[colIdx];
            if (targetVal !== undefined && targetVal !== '') {
              usedNodeIds.add(cell.id);
              mutations.push({
                node_id: cell.id,
                new_text: targetVal,
                bold: rowStr.includes('BOLD::')
              });
            }
          }
        }
      }
    }
  }

  // A.2. Narrative Fallback for Table Cells (Extract dimensions / findings from narrative paragraphs)
  for (const pStr of paragraphFindings) {
    const cleanP = pStr.replace(/^BOLD::\s*/, '').trim();
    if (!cleanP) continue;
    const isBoldP = pStr.startsWith('BOLD::');
    const pKey = normalizeKey(cleanP);

    for (const cell of tableCellNodes) {
      if (usedNodeIds.has(cell.id)) continue;
      const cellRowKey = normalizeKey(cell.row_label || '');
      if (!cellRowKey) continue;

      if (matchesRow(pKey, cellRowKey)) {
        const cMatch = cell.id.match(/_c_(\d+)$/);
        if (cMatch && parseInt(cMatch[1], 10) >= 1) {
          const dimMatch = cleanP.match(/\b(\d+(?:\.\d+)?\s*(?:cm|mm|%|HU)?)\b/i);
          if (dimMatch) {
            usedNodeIds.add(cell.id);
            mutations.push({
              node_id: cell.id,
              new_text: dimMatch[1].trim(),
              bold: isBoldP
            });
          }
        }
      }
    }
  }

  // B. Process Paragraph Findings against paragraph nodes (NEVER table cells)
  const paragraphNodes = ast.filter(n => n.type !== 'table_cell' && n.type !== 'impression_header' && n.type !== 'impression_item' && n.type !== 'title');
  let lastMatchedNodeId: string | undefined;
  const insertions: AstInsertion[] = [];

function extractMedicalKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'and', 'the', 'for', 'with', 'are', 'is', 'not', 'any', 'been', 'seen',
    'from', 'both', 'show', 'shows', 'appear', 'appears', 'within', 'limits',
    'rest', 'other', 'normal', 'abnormality', 'signal', 'intensity', 'characteristics',
    'features', 'study', 'noted', 'no', 'of', 'in', 'at'
  ]);
  let t = text.toLowerCase();
  t = t.replace(/\bsacroiliac\b/g, 'si');
  t = t.replace(/\bsacro-iliac\b/g, 'si');
  t = t.replace(/\blumbosacral\b/g, 'lumbar');
  t = t.replace(/\bventricles\b/g, 'ventricular');
  t = t.replace(/\bhydrocephalus\b/g, 'ventricular');
  t = t.replace(/\binfarction\b/g, 'infarct');
  t = t.replace(/\bischemia\b/g, 'infarct');
  t = t.replace(/\bjoints\b/g, 'joint');
  t = t.replace(/\bbones\b/g, 'bone');
  t = t.replace(/\bmuscles\b/g, 'muscle');
  t = t.replace(/\btendons\b/g, 'tendon');
  t = t.replace(/\borgans\b/g, 'organ');

  const rawWords = t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
  return new Set(rawWords);
}

  let activeReportSection = 'header';
  const processedFindingsText: string[] = [];

  // Pass 1: Exact / Colon-Key / Section / Word Overlap Matching
  for (const finding of paragraphFindings) {
    const isBold = finding.startsWith('BOLD::') || finding.includes('BOLD::');
    const cleanFinding = finding.replace(/^BOLD::\s*/, '').trim();
    if (!cleanFinding) continue;

    const isHeading = cleanFinding.endsWith(':');
    if (isHeading) {
      let sKey = cleanFinding.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sKey.includes('softtissue')) sKey = 'softtissue';
      activeReportSection = sKey;
    }
    const fWords = extractMedicalKeywords(cleanFinding);

    let bestScore = 0.0;
    let bestNodeId: string | null = null;

    const fColon = cleanFinding.includes(':') ? cleanFinding.split(':', 2)[0].trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '') : null;

    // 1. Specialized Header Matching for Clinical Profile & Technique (FIRST PRIORITY)
    const isClinicalFinding = cleanFinding.toLowerCase().startsWith('clinical profile') ||
      cleanFinding.toLowerCase().startsWith('clinical history') ||
      cleanFinding.toLowerCase().startsWith('c/o') ||
      cleanFinding.toLowerCase().startsWith('h/o') ||
      cleanFinding.toLowerCase().startsWith('k/c/o') ||
      cleanFinding.toLowerCase().startsWith('indication:');

    if (isClinicalFinding) {
      const cpNode = paragraphNodes.find(n => n.type === 'clinical_profile' || n.current_text.toLowerCase().startsWith('clinical profile') || n.current_text.toLowerCase().startsWith('clinical history') || n.current_text.toLowerCase().startsWith('indication:'));
      if (cpNode && !usedNodeIds.has(cpNode.id)) {
        bestScore = 100.0;
        bestNodeId = cpNode.id;
      }
    }

    const isTechFinding = cleanFinding.toLowerCase().startsWith('technique:') ||
      cleanFinding.toLowerCase().startsWith('scanning technique:') ||
      cleanFinding.toLowerCase().startsWith('protocol:');

    if (isTechFinding && !bestNodeId) {
      const techNode = paragraphNodes.find(n => n.type === 'technique' || n.current_text.toLowerCase().startsWith('technique:') || n.current_text.toLowerCase().startsWith('scanning technique:') || n.current_text.toLowerCase().startsWith('protocol:'));
      if (techNode && !usedNodeIds.has(techNode.id)) {
        bestScore = 100.0;
        bestNodeId = techNode.id;
      }
    }

    if (!bestNodeId) {
      for (const node of paragraphNodes) {
        if (usedNodeIds.has(node.id)) continue;

        const nText = node.current_text.trim();
        if (!nText) continue;
        const isNodeHeading = node.type === 'section_heading' || nText.endsWith(':');

        // Section Heading Matching
        if (isHeading && isNodeHeading) {
          let nKey = nText.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (nKey.includes('softtissue')) nKey = 'softtissue';
          let fKey = cleanFinding.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (fKey.includes('softtissue')) fKey = 'softtissue';
          if (nKey === fKey || nKey.includes(fKey) || fKey.includes(nKey)) {
            bestScore = 100.0;
            bestNodeId = node.id;
            break;
          }
        }

        // Do not match narrative findings onto section headings or header nodes
        if (!isHeading && isNodeHeading && node.type !== 'clinical_profile' && node.type !== 'technique') continue;
        // Do not match section headings onto narrative nodes
        if (isHeading && !isNodeHeading) continue;
        if (node.type === 'clinical_profile' || node.type === 'technique') continue;

      // 3. Colon match (e.g. "L1-L2:", "Ventricular System:", "Clinical Profile:")
      if (fColon && nText.includes(':')) {
        const nColon = nText.split(':', 2)[0].trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        if (fColon === nColon && fColon.length > 0) {
          bestScore = 100.0;
          bestNodeId = node.id;
          break;
        }
      }

      // 3. Exact match
      if (cleanFinding.toLowerCase() === nText.toLowerCase()) {
        bestScore = 90.0;
        bestNodeId = node.id;
        break;
      }

      // 4. Domain / Pathology Keyword Matching (e.g. PE filling defect, vascular thrombosis, disc protrusion, fracture)
      if (fWords.has('filling') && fWords.has('defect') && nText.toLowerCase().includes('filling defect')) {
        bestScore = 95.0;
        bestNodeId = node.id;
        break;
      }
      if (fWords.has('thrombus') && nText.toLowerCase().includes('filling defect')) {
        bestScore = 95.0;
        bestNodeId = node.id;
        break;
      }
      if (fWords.has('embolism') && (nText.toLowerCase().includes('filling defect') || nText.toLowerCase().includes('thromboembolism'))) {
        bestScore = 95.0;
        bestNodeId = node.id;
        break;
      }

      // 5. Section Isolation with smart cross-section allowance
      const nodeSectionNorm = (node.section || '').replace(/[^a-z0-9]/g, '');
      const activeSectionNorm = activeReportSection.replace(/[^a-z0-9]/g, '');
      if (activeSectionNorm !== 'header' && nodeSectionNorm && nodeSectionNorm !== 'header' && nodeSectionNorm !== activeSectionNorm) {
        // Allow cross-section match if keyword coverage is substantial (>= 0.25 or overlap >= 2)
        const nWords = extractMedicalKeywords(nText);
        let overlap = 0;
        fWords.forEach(w => { if (nWords.has(w)) overlap++; });
        if (nWords.size > 0 && overlap > 0) {
          const coverage = overlap / nWords.size;
          if ((coverage >= 0.25 || overlap >= 2) && coverage > bestScore) {
            bestScore = coverage;
            bestNodeId = node.id;
          }
        }
        continue;
      }

      // 5. Medical Keyword Coverage match within section
      const nWords = extractMedicalKeywords(nText);
      let overlap = 0;
      fWords.forEach(w => { if (nWords.has(w)) overlap++; });
      if (nWords.size > 0 && overlap > 0) {
        const coverage = overlap / nWords.size;
        if ((coverage >= 0.35 || overlap >= 2) && coverage > bestScore) {
          bestScore = coverage;
          bestNodeId = node.id;
        }
      }

      // 6. Word overlap similarity (strict threshold to avoid cross-concept collisions)
      const union = fWords.size + nWords.size - overlap;
      const score = union > 0 && overlap > 0 ? overlap / union : 0;

      if (score > bestScore && score >= 0.35) {
        bestScore = score;
        bestNodeId = node.id;
      }
    }

    // Section baseline normal node overwrite (prevents contradictory normal sentence from remaining in template)
    if (!bestNodeId && activeReportSection !== 'header') {
      const sectionNormalNode = paragraphNodes.find(n => {
        if (usedNodeIds.has(n.id)) return false;
        const nSec = (n.section || '').replace(/[^a-z0-9]/g, '');
        if (nSec !== activeReportSection) return false;
        const nTxt = n.current_text.toLowerCase();
        return nTxt.includes('normal') || nTxt.includes('unremarkable') || nTxt.includes('no significant') || nTxt.includes('no abnormality') || nTxt.includes('within normal limits');
      });
      if (sectionNormalNode) {
        bestScore = 80.0;
        bestNodeId = sectionNormalNode.id;
      }
    }
  }

    if (bestNodeId) {
      usedNodeIds.add(bestNodeId);
      lastMatchedNodeId = bestNodeId;
      processedFindingsText.push(cleanFinding);
      mutations.push({
        node_id: bestNodeId,
        new_text: finding,
        bold: isBold
      });
    } else {
      // Suppress near-duplicate findings if already covered by an earlier finding in report
      let isDuplicate = false;
      for (const pf of processedFindingsText) {
        const pfWords = extractMedicalKeywords(pf);
        let overlap = 0;
        fWords.forEach(w => { if (pfWords.has(w)) overlap++; });
        if (fWords.size > 0 && (overlap / fWords.size) >= 0.70) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        processedFindingsText.push(cleanFinding);
        // Clean incidental finding insertion at its exact sequential position in report
        insertions.push({
          after_node_id: lastMatchedNodeId,
          text: finding,
          bold: isBold
        });
      }
    }
  }

  // Post-processing Contradiction Removal:
  // If an abnormal finding was processed (e.g. PE thrombus, disc herniation, fracture, effusion),
  // identify any unused baseline normal nodes that contradict the finding (e.g. "No evidence of filling defect...", "No disc bulge...")
  // and clear them so they are not left behind as contradictory statements.
  const allFindingTexts = [...paragraphFindings, ...tableRowFindings].join(' ').toLowerCase();
  const hasPeFinding = allFindingTexts.includes('thrombus') || allFindingTexts.includes('filling defect') || allFindingTexts.includes('embolism') || allFindingTexts.includes('embolus') || allFindingTexts.includes('pe ');

  if (hasPeFinding) {
    for (const node of paragraphNodes) {
      if (usedNodeIds.has(node.id)) continue;
      const txt = node.current_text.toLowerCase();
      if (txt.includes('no evidence of filling defect') || txt.includes('no filling defect')) {
        usedNodeIds.add(node.id);
        mutations.push({
          node_id: node.id,
          new_text: '',
          bold: false
        });
      }
    }
  }

  return applyAstMutationsToDocx(
    xmlDoc,
    zipEntries,
    pMap,
    cellMap,
    mutations,
    impressionItems,
    impressionSlotIds,
    impressionHeaderId,
    insertions
  );
}
