import { parseZip, createZip, base64ToUint8Array, ZipEntry } from './docxService';

export interface DocumentAstNode {
  id: string;
  type: 'title' | 'clinical_profile' | 'technique' | 'section_heading' | 'inline_field' | 'narrative' | 'impression_header' | 'impression_item' | 'table_cell';
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

  const ast: DocumentAstNode[] = [];
  const pMap = new Map<string, Element>();
  const cellMap = new Map<string, Element>();
  let impressionHeaderId: string | undefined;
  const impressionSlotIds: string[] = [];

  let nodeIndex = 0;
  let inImpressionSection = false;

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
        label,
        current_text: txt,
        current_val: val,
      });
      nodeIndex++;
    } else if (tag === 'tbl') {
      const tblIndex = ast.filter(x => x.type === 'table_cell').length > 0 ? 1 : 0;
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
  insertedFindings?: string[]
): Promise<Blob> {
  const ensureBoldOnRun = (run: Element, makeBold: boolean) => {
    let rPr = run.getElementsByTagName('w:rPr')[0];
    if (makeBold) {
      if (!rPr) {
        rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
        run.insertBefore(rPr, run.firstChild);
      }
      let bTag = rPr.getElementsByTagName('w:b')[0];
      if (!bTag) {
        bTag = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
        rPr.appendChild(bTag);
      }
    }
  };

  const applyTextToParagraphRuns = (p: Element, rawText: string, defaultBold?: boolean) => {
    const allRuns: Element[] = [];
    for (let i = 0; i < p.childNodes.length; i++) {
      if (p.childNodes[i].nodeName === 'w:r' || (p.childNodes[i] as Element).localName === 'r') {
        allRuns.push(p.childNodes[i] as Element);
      }
    }
    // Option B: If the table cell or paragraph is completely empty (0 runs), auto-create run inheriting parent styles!
    if (allRuns.length === 0) {
      const newRun = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
      const pPr = p.getElementsByTagName('w:pPr')[0];
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
    if (rawText.includes('BOLD::')) {
      const boldIdx = rawText.indexOf('BOLD::');
      const prefix = rawText.substring(0, boldIdx);
      const boldText = rawText.substring(boldIdx + 6);

      if (prefix) {
        ensureBoldOnRun(firstRun, !!defaultBold);
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
        ensureBoldOnRun(secondRun, true);
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
        ensureBoldOnRun(firstRun, true);
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
      ensureBoldOnRun(firstRun, !!defaultBold);
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
  // 1.5. Insert brand-new / incidental findings before the IMPRESSION: header
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

    if (headerEl && headerEl.parentNode) {
      for (const item of insertedFindings) {
        const isBold = item.startsWith('BOLD::') || item.includes('BOLD::');
        const cleanText = item.replace(/^BOLD::\s*/, '').trim();
        if (!cleanText) continue;

        const newP = (headerEl.previousElementSibling || headerEl).cloneNode(true) as Element;
        const rPrTags = newP.getElementsByTagName('w:rPr');
        for (let r_i = 0; r_i < rPrTags.length; r_i++) {
          const u = rPrTags[r_i].getElementsByTagName('w:u')[0];
          if (u) rPrTags[r_i].removeChild(u);
          if (!isBold) {
            const b = rPrTags[r_i].getElementsByTagName('w:b')[0];
            if (b) rPrTags[r_i].removeChild(b);
          }
        }

        applyTextToParagraphRuns(newP, cleanText, isBold);
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

    const slotElements = impressionSlotIds.map(id => pMap.get(id)).filter(Boolean) as Element[];

    // 1. Detect if any template slot has native bullet list formatting (numPr / ListParagraph)
    let masterNumPr: Element | null = null;
    let masterPStyle: Element | null = null;
    for (const p of slotElements) {
      const pPr = p.getElementsByTagName('w:pPr')[0];
      if (pPr) {
        const numPr = pPr.getElementsByTagName('w:numPr')[0];
        if (numPr && !masterNumPr) {
          masterNumPr = numPr;
        }
        const pStyle = pPr.getElementsByTagName('w:pStyle')[0];
        if (pStyle && !masterPStyle) {
          const val = pStyle.getAttribute('w:val') || pStyle.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val') || '';
          if (val.toLowerCase().includes('list') || val.toLowerCase().includes('bullet')) {
            masterPStyle = pStyle;
          }
        }
      }
    }

    const formatBulletParagraph = (p: Element, cleanBullet: string) => {
      let pPr = p.getElementsByTagName('w:pPr')[0];
      if (!pPr) {
        pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
        p.insertBefore(pPr, p.firstChild);
      }

      if (masterNumPr || masterPStyle) {
        // Uniform Native Word List formatting across all bullet paragraphs
        let pStyle = pPr.getElementsByTagName('w:pStyle')[0];
        if (!pStyle && masterPStyle) {
          pPr.insertBefore(masterPStyle.cloneNode(true), pPr.firstChild);
        } else if (!pStyle) {
          pStyle = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pStyle');
          pStyle.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:val', 'ListParagraph');
          pPr.insertBefore(pStyle, pPr.firstChild);
        }

        let numPr = pPr.getElementsByTagName('w:numPr')[0];
        if (!numPr && masterNumPr) {
          pPr.appendChild(masterNumPr.cloneNode(true));
        }

        // Native list renders bullet point natively; write pure text without bullet glyph
        const tTags = p.getElementsByTagName('w:t');
        if (tTags.length > 0) {
          tTags[0].textContent = cleanBullet;
          tTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
        }
      } else {
        // Uniform Manual Bullet with clean Hanging Indent (Left: 720 / Hanging: 360)
        const oldNumPr = pPr.getElementsByTagName('w:numPr')[0];
        if (oldNumPr) pPr.removeChild(oldNumPr);

        let ind = pPr.getElementsByTagName('w:ind')[0];
        if (!ind) {
          ind = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ind');
          ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:left', '720');
          ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hanging', '360');
          pPr.appendChild(ind);
        } else {
          ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:left', '720');
          ind.setAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hanging', '360');
        }

        const tTags = p.getElementsByTagName('w:t');
        if (tTags.length > 0) {
          tTags[0].textContent = `•  ${cleanBullet}`;
          tTags[0].setAttribute('xml:space', 'preserve');
          for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
        }
      }
    };

    if (slotElements.length > 0) {
      const primarySlot = (masterNumPr ? slotElements.find(p => p.getElementsByTagName('w:numPr').length > 0) : slotElements[0]) || slotElements[0];
      const lastSlot = slotElements[slotElements.length - 1];
      let lastInserted = lastSlot;

      for (let i = 0; i < impressionItems.length; i++) {
        const cleanBullet = impressionItems[i]
          .replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '')
          .replace(/[\s\|]+$/g, '')
          .trim();
        if (i < slotElements.length) {
          const p = slotElements[i];
          formatBulletParagraph(p, cleanBullet);
        } else {
          const newP = primarySlot.cloneNode(true) as Element;
          formatBulletParagraph(newP, cleanBullet);
          lastInserted.parentNode?.insertBefore(newP, lastInserted.nextSibling);
          lastInserted = newP;
        }
      }

      for (let i = impressionItems.length; i < slotElements.length; i++) {
        const p = slotElements[i];
        if (p.parentNode) {
          p.parentNode.removeChild(p);
        } else {
          const tTags = p.getElementsByTagName('w:t');
          for (let j = 0; j < tTags.length; j++) {
            tTags[j].textContent = '';
          }
        }
      }
    } else if (headerEl) {
      // Template has IMPRESSION: header but 0 pre-existing slot paragraphs
      let lastInserted: Element = headerEl;
      for (let i = 0; i < impressionItems.length; i++) {
        const cleanBullet = impressionItems[i]
          .replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '')
          .replace(/[\s\|]+$/g, '')
          .trim();
        const newP = (headerEl as Element).cloneNode(true) as Element;
        
        // Remove bold tag or underline from bullet runs if header was bold/underlined
        const rPrTags = newP.getElementsByTagName('w:rPr');
        for (let r_i = 0; r_i < rPrTags.length; r_i++) {
          const b = rPrTags[r_i].getElementsByTagName('w:b')[0];
          if (b) rPrTags[r_i].removeChild(b);
          const u = rPrTags[r_i].getElementsByTagName('w:u')[0];
          if (u) rPrTags[r_i].removeChild(u);
        }

        formatBulletParagraph(newP, cleanBullet);
        lastInserted.parentNode?.insertBefore(newP, lastInserted.nextSibling);
        lastInserted = newP;
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
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  for (let fIdx = 0; fIdx < findings.length; fIdx++) {
    const f = findings[fIdx];
    let trimmed = (f || '').trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('+-') || trimmed.startsWith('|-') || trimmed.startsWith('+=')) continue;
    if (trimmed.toLowerCase().startsWith('title:')) continue;

    const normalizedF = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Skip the document Title line from body findings
    if (fIdx === 0 && (!trimmed.includes(':') || (templateTitleNormalized && normalizedF === templateTitleNormalized))) {
      continue;
    }
    if (templateTitleNormalized && normalizedF === templateTitleNormalized) {
      continue;
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

    if (trimmed.includes('|')) {
      tableRowFindings.push(trimmed);
    } else {
      paragraphFindings.push(trimmed);
    }
  }

  const mutations: AstMutation[] = [];
  const usedNodeIds = new Set<string>();

  // A. Process Table Row Findings against table_cell nodes
  const tableCellNodes = ast.filter(n => n.type === 'table_cell');
  for (const rowStr of tableRowFindings) {
    const cols = rowStr.split('|').map(c => c.replace(/^BOLD::\s*/, '').trim());
    if (cols.length < 2) continue;
    const rowKey = cols[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!rowKey) continue;

    // Match table cells whose row_label matches rowKey
    for (const cell of tableCellNodes) {
      const cellRowLabel = (cell.row_label || cell.current_text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cellRowLabel === rowKey) {
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

  // B. Process Paragraph Findings against paragraph nodes (NEVER table cells)
  const paragraphNodes = ast.filter(n => n.type !== 'table_cell' && n.type !== 'impression_header' && n.type !== 'impression_item' && n.type !== 'title');

  // Pass 1: Exact / Colon-Key / Word Overlap Matching
  for (const finding of paragraphFindings) {
    const isBold = finding.startsWith('BOLD::') || finding.includes('BOLD::');
    const cleanFinding = finding.replace(/^BOLD::\s*/, '').trim();
    const isHeading = cleanFinding.endsWith(':');
    const fWords = new Set(cleanFinding.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));

    let bestScore = 0.0;
    let bestNodeId: string | null = null;

    const fColon = cleanFinding.includes(':') ? cleanFinding.split(':', 2)[0].trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '') : null;

    for (const node of paragraphNodes) {
      if (usedNodeIds.has(node.id)) continue;

      const nText = node.current_text.trim();
      if (!nText) continue;
      const isNodeHeading = node.type === 'section_heading' || nText.endsWith(':');

      // Do not match narrative findings onto section headings via word overlap
      if (!isHeading && isNodeHeading) continue;
      // Do not match section headings onto narrative nodes
      if (isHeading && !isNodeHeading) continue;

      // 1. Colon match (e.g. "L1-L2:", "Ventricular System:", "Clinical Profile:")
      if (fColon && nText.includes(':')) {
        const nColon = nText.split(':', 2)[0].trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
        if (fColon === nColon && fColon.length > 0) {
          bestScore = 100.0;
          bestNodeId = node.id;
          break;
        }
      }

      // 2. Exact match
      if (cleanFinding.toLowerCase() === nText.toLowerCase()) {
        bestScore = 90.0;
        bestNodeId = node.id;
        break;
      }

      // 3. Word overlap similarity
      const nWords = new Set(nText.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
      let overlap = 0;
      fWords.forEach(w => { if (nWords.has(w)) overlap++; });
      const union = fWords.size + nWords.size - overlap;
      const score = union > 0 ? overlap / union : 0;

      if (score > bestScore && score >= 0.25) {
        bestScore = score;
        bestNodeId = node.id;
      }
    }

    if (bestNodeId) {
      usedNodeIds.add(bestNodeId);
      mutations.push({
        node_id: bestNodeId,
        new_text: finding,
        bold: isBold
      });
    }
  }

  // Unmatched paragraph findings that do not correspond to any baseline template node are incidental/extra findings
  const unmatchedFindings = paragraphFindings.filter((_, idx) => {
    return !mutations.some(m => m.new_text === paragraphFindings[idx]);
  });

  const insertedFindings: string[] = [];
  for (const item of unmatchedFindings) {
    insertedFindings.push(item);
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
    insertedFindings
  );
}
