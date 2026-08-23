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

  let pIndex = 0;
  let inImpressionSection = false;

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.localName || el.nodeName.replace(/^w:/, '');

    if (tag === 'p') {
      const txt = getElementText(el).trim();
      const nodeId = `p_${pIndex}`;
      pMap.set(nodeId, el);

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
      } else if (pIndex === 0) {
        pType = 'title';
      }

      if (txt) {
        ast.push({
          id: nodeId,
          type: pType,
          label,
          current_text: txt,
          current_val: val,
        });
      }
      pIndex++;
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
  impressionSlotIds: string[] = []
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
    if (allRuns.length === 0) return;

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

  // 1. Apply Paragraph and Table Cell mutations
  for (const mut of mutations) {
    const nid = mut.node_id;
    const cleanText = (mut.new_text || '').trim();

    if (pMap.has(nid)) {
      const p = pMap.get(nid)!;
      if (!cleanText) {
        // Clear paragraph text cleanly
        const tTags = p.getElementsByTagName('w:t');
        for (let k = 0; k < tTags.length; k++) tTags[k].textContent = '';
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

  // 2. Apply Impression Bullets
  if (impressionItems && impressionItems.length > 0 && impressionSlotIds.length > 0) {
    const slotElements = impressionSlotIds.map(id => pMap.get(id)).filter(Boolean) as Element[];
    if (slotElements.length > 0) {
      const lastSlot = slotElements[slotElements.length - 1];
      let lastInserted = lastSlot;

      const hasNativeBullet = (p: Element): boolean => {
        const pPr = p.getElementsByTagName('w:pPr')[0];
        if (!pPr) return false;
        const numPr = pPr.getElementsByTagName('w:numPr')[0];
        return !!numPr;
      };

      for (let i = 0; i < impressionItems.length; i++) {
        const cleanBullet = impressionItems[i].replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
        if (i < slotElements.length) {
          const p = slotElements[i];
          const isNative = hasNativeBullet(p);
          const bulletText = isNative ? cleanBullet : `• ${cleanBullet}`;
          const tTags = p.getElementsByTagName('w:t');
          if (tTags.length > 0) {
            tTags[0].textContent = bulletText;
            tTags[0].setAttribute('xml:space', 'preserve');
            for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
          }
        } else {
          const newP = lastSlot.cloneNode(true) as Element;
          const isNative = hasNativeBullet(newP);
          const bulletText = isNative ? cleanBullet : `• ${cleanBullet}`;
          const tTags = newP.getElementsByTagName('w:t');
          if (tTags.length > 0) {
            tTags[0].textContent = bulletText;
            tTags[0].setAttribute('xml:space', 'preserve');
            for (let j = 1; j < tTags.length; j++) tTags[j].textContent = '';
          }
          lastInserted.parentNode?.insertBefore(newP, lastInserted.nextSibling);
          lastInserted = newP;
        }
      }

      for (let i = impressionItems.length; i < slotElements.length; i++) {
        const p = slotElements[i];
        const tTags = p.getElementsByTagName('w:t');
        for (let j = 0; j < tTags.length; j++) {
          tTags[j].textContent = '';
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
