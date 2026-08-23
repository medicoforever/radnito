import { getStoredApiKeys } from './apiKeyStore';

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
  if (typeof window === 'undefined' || !window.localStorage) return false;
  return localStorage.getItem(RAG_ENABLED_STORAGE_KEY) === 'true';
}

/**
 * Toggle RAG Style Matching preference
 */
export function setRAGStyleMatchingEnabled(enabled: boolean): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(RAG_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
  }
}

/**
 * Asynchronously fetch and cache the report_knowledgebase.json (1,066 distinct templates)
 */
export async function loadReportKnowledgebase(): Promise<KnowledgebaseData | null> {
  if (knowledgebaseCache) return knowledgebaseCache;
  if (isFetchingKnowledgebase) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (knowledgebaseCache) return knowledgebaseCache;
  }

  isFetchingKnowledgebase = true;
  try {
    const baseUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || './';
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
 * Detects modality and organ region from text with high precision
 */
export function detectModalityAndRegion(text: string): { modality?: string; region?: string } {
  const t = text.toLowerCase();
  
  let modality: string | undefined;
  if (t.includes('mri') || t.includes('magnetic resonance') || t.includes('mr brain') || t.includes('mr spine') || t.includes('mrcp')) {
    modality = 'MRI';
  } else if (t.includes('hrct') || t.includes('c.t.') || t.includes('ct scan') || t.includes('computed tomography') || t.includes('cta ') || t.includes('angiography')) {
    modality = 'CT';
  } else if (t.includes('usg') || t.includes('ultrasound') || t.includes('sonography') || t.includes('foetal') || t.includes('fetal') || t.includes('doppler')) {
    modality = 'USG';
  } else if (t.includes('mammogram') || t.includes('mammography') || t.includes('birads') || t.includes('breast')) {
    modality = 'Mammogram';
  } else if (t.includes('x-ray') || t.includes('xray') || t.includes('radiograph') || t.includes('pa view')) {
    modality = 'X-Ray';
  } else if (t.includes('pet') || t.includes('nuclear') || t.includes('spect') || t.includes('renogram') || t.includes('dmsa') || t.includes('dtpa')) {
    modality = 'Nuclear Medicine';
  }

  let region: string | undefined;
  if (anyKeyword(t, ['trauma', 'whole body trauma', 'polytrauma', 'head to pelvis'])) {
    region = 'Multitrauma & Whole Body';
  } else if (anyKeyword(t, ['brain', 'head', 'orbit', 'cranial', 'cerebral', 'stroke', 'infarct', 'pns', 'sinus', 'dacryo', 'lacrimal', 'pituitary', 'temporal bone', 'mastoid'])) {
    region = 'Brain & Head';
  } else if (anyKeyword(t, ['coronary', 'cardiac', 'tavi', 'cabg', 'aorta', 'pulmonary artery', 'myocard'])) {
    region = 'Cardiovascular & Thoracic';
  } else if (anyKeyword(t, ['chest', 'thorax', 'lung', 'pleural', 'mediastinum', 'hrct chest', 'pneumonia', 'interstitial'])) {
    region = 'Thorax & Chest';
  } else if (anyKeyword(t, ['abdomen', 'pelvis', 'liver', 'kidney', 'spleen', 'gallbladder', 'pancreas', 'kub', 'calculus', 'cholecystitis', 'prostate', 'uterus', 'ovary', 'rectal', 'perianal'])) {
    region = 'Abdomen & Pelvis';
  } else if (anyKeyword(t, ['spine', 'lumbar', 'cervical', 'dorsal', 'vertebra', 'lumbosacral', 'thecal', 'disc', 'cord'])) {
    region = 'Spine';
  } else if (anyKeyword(t, ['knee', 'shoulder', 'joint', 'femur', 'ankle', 'hip', 'wrist', 'elbow', 'extremit', 'fracture', 'forearm', 'brachial plexus', 'foot', 'leg'])) {
    region = 'Extremities & Joints';
  } else if (anyKeyword(t, ['breast', 'mammog', 'nipple', 'axilla', 'fibroadenoma'])) {
    region = 'Breast';
  } else if (anyKeyword(t, ['neck', 'thyroid', 'carotid', 'parotid', 'submandibular', 'pharynx', 'larynx'])) {
    region = 'Neck';
  } else if (anyKeyword(t, ['obstetric', 'fetal', 'foetal', 'pregnancy', 'gestation', 'anomaly', 'trimester', 'placenta'])) {
    region = 'Obstetrics';
  }

  return { modality, region };
}

function anyKeyword(text: string, list: string[]): boolean {
  return list.some(k => text.includes(k));
}

/**
 * Retrieves the top matching style report templates from knowledgebase dataset for a given dictation/hint
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
    
    // Modality & Region Scoring with heavy penalty to isolate cross-template contamination
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
 * Augment base system prompt into a FULL RAG REPORT GENERATOR MODE system prompt using matched reference templates
 */
export function augmentPromptWithStyleTemplates(
  basePrompt: string,
  templates: ReportTemplateItem[]
): string {
  if (!templates || templates.length === 0) return basePrompt;

  const primaryTpl = templates[0];

  let ragPrompt = `You are an expert Radiologist AI assistant. RAG (Retrieval Augmented Generation) has matched an authoritative reference radiology report template for this dictation:\n\n`;

  ragPrompt += `=== 🌟 PRIMARY REFERENCE EXEMPLAR [${primaryTpl.category}: ${primaryTpl.title}] ===\n`;
  ragPrompt += `${primaryTpl.content}\n\n`;

  if (templates.length > 1) {
    ragPrompt += `=== SECONDARY REFERENCE EXEMPLAR [${templates[1].category}: ${templates[1].title}] ===\n`;
    ragPrompt += `${templates[1].content.slice(0, 1200)}\n\n`;
  }

  ragPrompt += `=== MANDATORY CONSULTANT STYLE & FORMATTING DIRECTIVES ===
1. **ZERO CONVERSATIONAL FILLER**: Output ONLY pure clinical report text inside the JSON schema. NEVER include greetings, preambles, introductory filler, or sign-offs.
2. **5-LAYER STRUCTURAL DNA**:
   - Layer 1: Capitalized Examination Title.
   - Layer 2: Clinical Profile formatted as '*Clinical Profile: ...*' (or '*Clinical Profile:*' if none).
   - Layer 3: Scanning Technique.
   - Layer 4: Structured Findings by anatomical subsystem. Baseline normal findings are preserved verbatim. Dictated/abnormal findings are prefixed with \`BOLD::\`.
   - Layer 5: Synthesized non-verb Impression starting with \`IMPRESSION:###\` with points delimited by \`###\`.
3. **VAGUE DICTATION TRANSLATION**: Translate colloquial radiologist speech (e.g., "fuzzy liver thing", "whited out base", "dirty fat", "blown acl") into crisp board-certified terminology.
4. **RADS CLASSIFICATION**: Standardize scoring for BI-RADS, PI-RADS v2.1, TI-RADS, LI-RADS, Lung-RADS v2022, and CAD-RADS 2.0.
5. **CONTAMINATION ISOLATION**: Strictly constrain findings to the active template's anatomical domain.
6. **OUTPUT FORMAT**: Respond ONLY with a single JSON object: { "findings": string[] }.
`;

  return ragPrompt;
}
