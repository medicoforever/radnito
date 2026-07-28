import { getStoredApiKey } from './apiKeyStore';

export interface ReportTemplateItem {
  id: string;
  title: string;
  category: string;
  modality: string;
  region: string;
  content: string;
  summary_keywords: string[];
}

export interface KnowledgebaseData {
  version: string;
  source: string;
  total_templates: number;
  categories: string[];
  reports_by_category: { [category: string]: ReportTemplateItem[] };
}

const RAG_ENABLED_STORAGE_KEY = 'radnito_rag_style_matching_enabled';

let knowledgebaseCache: KnowledgebaseData | null = null;
let isFetchingKnowledgebase = false;

/**
 * Check whether RAG Style Matching is enabled by user preference
 */
export function isRAGStyleMatchingEnabled(): boolean {
  return false; // Stopped for now per user request
}

/**
 * Toggle RAG Style Matching preference
 */
export function setRAGStyleMatchingEnabled(enabled: boolean): void {
  localStorage.setItem(RAG_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

/**
 * Asynchronously fetch and cache the report_knowledgebase.json (1,066 distinct templates from NEWWWWW.zip)
 */
export async function loadReportKnowledgebase(): Promise<KnowledgebaseData | null> {
  if (knowledgebaseCache) return knowledgebaseCache;
  if (isFetchingKnowledgebase) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (knowledgebaseCache) return knowledgebaseCache;
  }

  isFetchingKnowledgebase = true;
  try {
    const baseUrl = (import.meta as any).env?.BASE_URL || './';
    const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const targetUrl = `${cleanBase}report_knowledgebase.json`;

    let res = await fetch(targetUrl);
    if (!res.ok) {
      res = await fetch('./report_knowledgebase.json');
    }
    if (!res.ok) {
      console.warn('Failed to load report_knowledgebase.json:', res.statusText);
      isFetchingKnowledgebase = false;
      return null;
    }
    const data: KnowledgebaseData = await res.json();
    knowledgebaseCache = data;
    isFetchingKnowledgebase = false;
    return data;
  } catch (err) {
    console.error('Error fetching report_knowledgebase.json:', err);
    isFetchingKnowledgebase = false;
    return null;
  }
}

/**
 * Detects modality and organ region from text to filter relevant templates from NEWWWWW.zip
 */
export function detectModalityAndRegion(text: string): { modality?: string; region?: string } {
  const t = text.toLowerCase();
  
  let modality: string | undefined;
  if (t.includes('mri') || t.includes('magnetic resonance')) modality = 'MRI';
  else if (t.includes('ct') || t.includes('computed tomography') || t.includes('c.t.') || t.includes('hrct')) modality = 'CT';
  else if (t.includes('usg') || t.includes('ultrasound') || t.includes('sonography') || t.includes('foetal') || t.includes('fetal') || t.includes('doppler')) modality = 'USG';
  else if (t.includes('x-ray') || t.includes('xray') || t.includes('radiograph') || t.includes('pa view')) modality = 'X-Ray';
  else if (t.includes('mammogram') || t.includes('mammography') || t.includes('birads')) modality = 'Mammogram';
  else if (t.includes('nuclear') || t.includes('pet') || t.includes('spect')) modality = 'Nuclear Medicine';

  let region: string | undefined;
  if (anyKeyword(t, ['brain', 'head', 'orbit', 'cranial', 'cerebral', 'stroke', 'infarct', 'pns', 'sinus', 'dacryo', 'lacrimal', 'pituitary'])) region = 'Brain & Head';
  else if (anyKeyword(t, ['chest', 'thorax', 'lung', 'pleural', 'mediastinum', 'hrct chest', 'pneumonia'])) region = 'Thorax & Chest';
  else if (anyKeyword(t, ['abdomen', 'pelvis', 'liver', 'kidney', 'spleen', 'gallbladder', 'kub', 'calculus', 'cholecystitis'])) region = 'Abdomen & Pelvis';
  else if (anyKeyword(t, ['spine', 'lumbar', 'cervical', 'dorsal', 'vertebra', 'lumbosacral', 'disc'])) region = 'Spine';
  else if (anyKeyword(t, ['knee', 'shoulder', 'joint', 'femur', 'ankle', 'hip', 'wrist', 'elbow', 'extremit', 'fracture'])) region = 'Extremities & Joints';
  else if (anyKeyword(t, ['breast', 'mammog'])) region = 'Breast';
  else if (anyKeyword(t, ['neck', 'thyroid', 'carotid'])) region = 'Neck';
  else if (anyKeyword(t, ['obstetric', 'fetal', 'foetal', 'pregnancy', 'gestation', 'anomaly'])) region = 'Obstetrics';

  return { modality, region };
}

function anyKeyword(text: string, list: string[]): boolean {
  return list.some(k => text.includes(k));
}

/**
 * Retrieves the top matching style report templates from NEWWWWW.zip dataset for a given dictation/hint
 */
export async function getRelevantStyleTemplates(
  hintContext: string,
  maxCount: number = 2
): Promise<ReportTemplateItem[]> {
  if (!isRAGStyleMatchingEnabled()) return [];
  
  const kb = await loadReportKnowledgebase();
  if (!kb || !kb.reports_by_category) return [];

  const textToAnalyze = hintContext || 'Radiology Scan';
  const { modality, region } = detectModalityAndRegion(textToAnalyze);
  
  const words = textToAnalyze.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored: Array<{ item: ReportTemplateItem; score: number }> = [];

  for (const [catName, list] of Object.entries(kb.reports_by_category)) {
    const catLower = catName.toLowerCase();
    
    // Modality & Region Scoring
    let catBoost = 0;
    if (modality) {
      if (catLower.includes(modality.toLowerCase())) catBoost += 100;
      else catBoost -= 500; // Penalize mismatched modality
    }

    if (region) {
      if (catLower.includes(region.toLowerCase())) catBoost += 100;
      else catBoost -= 500; // Penalize mismatched region
    }

    for (const item of list) {
      let score = catBoost;
      const titleLower = item.title.toLowerCase();
      const contentLower = item.content.toLowerCase();

      for (const w of words) {
        if (titleLower.includes(w)) score += 50;
        else if (contentLower.includes(w)) score += 5;
      }

      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map(s => s.item);
}

/**
 * Augment base system prompt into a FULL RAG REPORT GENERATOR MODE system prompt using matched templates from NEWWWWW.zip
 */
export function augmentPromptWithStyleTemplates(
  basePrompt: string,
  templates: ReportTemplateItem[]
): string {
  if (!templates || templates.length === 0) return basePrompt;

  const primaryTpl = templates[0];

  let ragPrompt = `You are an expert Radiologist AI assistant. RAG (Retrieval Augmented Generation) has searched our 100,000+ report dataset (from NEWWWWW.zip) and matched the exact reference radiology report template for this dictation!\n\n`;

  ragPrompt += `=== 🌟 MATCHED RAG RADIOLOGY REPORT EXEMPLAR TEMPLATE [${primaryTpl.category}: ${primaryTpl.title}] ===\n`;
  ragPrompt += `${primaryTpl.content}\n\n`;

  if (templates.length > 1) {
    ragPrompt += `=== SECONDARY REFERENCE EXEMPLAR [${templates[1].category}: ${templates[1].title}] ===\n`;
    ragPrompt += `${templates[1].content.slice(0, 1200)}\n\n`;
  }

  ragPrompt += `=== MANDATORY RAG REPORT GENERATION DIRECTIVES ===
1. **GENERATE A COMPLETE, FULLY STRUCTURED RADIOLOGY REPORT**: You MUST produce a complete, professional, line-by-line radiology report using the exact layout, section headings (Technique, Brain Parenchyma, Orbits, Spine, Impression, etc.), and clinical tone of the matched RAG exemplar template above.
2. **REPLICATE TEMPLATE LAYOUT & HEADINGS**: Retain the exact examination title, technique section, and anatomical section headings shown in the matched exemplar template.
3. **INCORPORATE DICTATED CLINICAL FINDINGS**: Listen carefully to the spoken audio dictation / input text. Populate the report with all dictated observations, measurements, anatomical sides (left/right), and specific diagnoses (e.g. dacryocystitis, lacrimal sac swelling, infarct, fracture, mass) into the appropriate section.
4. **FILL NORMAL ANATOMICAL SECTIONS**: For any anatomical structures present in the matched exemplar template that were not explicitly dictated as abnormal, keep the standard normal report statements from the template so the output is a complete, ready-to-sign radiology report.
5. **SYNTHESIZE IMPRESSION**: Include a clear, non-verb IMPRESSION section at the end summarized from the findings, formatted as "IMPRESSION:###Point 1###Point 2".
6. **FORMATTING RULES**:
   - Prefix every finding line/technique/header string in the "findings" array with \`BOLD::\`.
   - Format the impression line starting with \`IMPRESSION:###\`.
7. **OUTPUT FORMAT**: You MUST respond ONLY with a single JSON object with key "findings", containing an array of strings representing the report lines.
`;

  return ragPrompt;
}
