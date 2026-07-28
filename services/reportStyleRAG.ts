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
  const stored = localStorage.getItem(RAG_ENABLED_STORAGE_KEY);
  if (stored === null) return true; // Default ON
  return stored === 'true';
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
  else if (t.includes('mammogram') || t.includes('mammography') || t.includes('birads')) modality = 'Mammography';
  else if (t.includes('nuclear') || t.includes('pet') || t.includes('spect')) modality = 'Nuclear Medicine';

  let region: string | undefined;
  if (t.includes('brain') || t.includes('head') || t.includes('orbit') || t.includes('cranial') || t.includes('cerebral') || t.includes('stroke') || t.includes('infarct') || t.includes('pns') || t.includes('sinus') || t.includes('dacryo')) region = 'Brain & Head';
  else if (t.includes('chest') || t.includes('thorax') || t.includes('lung') || t.includes('pleural') || t.includes('mediastinum') || t.includes('hrct chest')) region = 'Thorax & Chest';
  else if (t.includes('abdomen') || t.includes('pelvis') || t.includes('liver') || t.includes('kidney') || t.includes('spleen') || t.includes('gallbladder') || t.includes('kub')) region = 'Abdomen & Pelvis';
  else if (t.includes('spine') || t.includes('lumbar') || t.includes('cervical') || t.includes('dorsal') || t.includes('vertebra') || t.includes('lumbosacral')) region = 'Spine';
  else if (t.includes('knee') || t.includes('shoulder') || t.includes('joint') || t.includes('femur') || t.includes('ankle') || t.includes('hip') || t.includes('extremit')) region = 'Extremities & Joints';
  else if (t.includes('breast')) region = 'Breast';
  else if (t.includes('neck') || t.includes('thyroid') || t.includes('carotid')) region = 'Neck';
  else if (t.includes('obstetric') || t.includes('fetal') || t.includes('foetal') || t.includes('pregnancy') || t.includes('gestation') || t.includes('anomaly')) region = 'Obstetrics';

  return { modality, region };
}

/**
 * Cosine similarity calculation between two float vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embeds text using Gemini Embedding API (supports gemini-embedding-2 and text-embedding-004 on free Gemini API keys)
 */
async function embedTextWithGemini2(text: string, apiKey: string): Promise<number[] | null> {
  if (!apiKey || !text || text.trim().length === 0) return null;
  
  const endpoints = [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      body: { model: 'models/text-embedding-004', content: { parts: [{ text: text.slice(0, 500) }] } }
    },
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
      body: { model: 'models/gemini-embedding-2', content: { parts: [{ text: `task: search result | query: ${text.slice(0, 500)}` }] }, output_dimensionality: 128 }
    }
  ];

  for (const ep of endpoints) {
    try {
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.embedding?.values) {
          return data.embedding.values;
        }
      }
    } catch (err) {
      // try next fallback endpoint
    }
  }
  return null;
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
  
  let candidates: ReportTemplateItem[] = [];

  // Filter candidates by matching category
  for (const [catName, list] of Object.entries(kb.reports_by_category)) {
    let matchScore = 0;
    if (modality && catName.toLowerCase().includes(modality.toLowerCase())) matchScore += 3;
    if (region && catName.toLowerCase().includes(region.toLowerCase())) matchScore += 3;

    if (matchScore > 0) {
      candidates.push(...list);
    }
  }

  // Fallback to all report templates if no direct category match
  if (candidates.length === 0) {
    Object.values(kb.reports_by_category).forEach(list => candidates.push(...list));
  }

  if (candidates.length <= maxCount) return candidates;

  // Keyword relevance scoring
  const keywords = textToAnalyze.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = candidates.map(item => {
    let score = 0;
    const itemFullText = (item.title + ' ' + item.category + ' ' + item.content).toLowerCase();
    
    // Keyword match boost
    for (const kw of keywords) {
      if (itemFullText.includes(kw)) score += 2;
      if (item.title.toLowerCase().includes(kw)) score += 4;
    }
    
    // Modality & region exact match boost
    if (modality && item.modality.toLowerCase() === modality.toLowerCase()) score += 5;
    if (region && item.region.toLowerCase() === region.toLowerCase()) score += 5;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Optional vector embedding check with Gemini Embedding 2 / text-embedding-004
  const apiKey = getStoredApiKey();
  if (apiKey) {
    try {
      const topCandidates = scored.slice(0, 15).map(s => s.item);
      const queryVec = await embedTextWithGemini2(textToAnalyze, apiKey);
      if (queryVec) {
        // If vector obtained, rank top candidates by vector similarity
        const vectorScored: Array<{ item: ReportTemplateItem; score: number }> = [];
        for (const item of topCandidates) {
          const itemText = `${item.title} ${item.content.slice(0, 300)}`;
          const itemVec = await embedTextWithGemini2(itemText, apiKey);
          if (itemVec) {
            const sim = cosineSimilarity(queryVec, itemVec);
            vectorScored.push({ item, score: sim });
          } else {
            vectorScored.push({ item, score: 0 });
          }
        }
        vectorScored.sort((a, b) => b.score - a.score);
        if (vectorScored.length > 0 && vectorScored[0].score > 0) {
          return vectorScored.slice(0, maxCount).map(s => s.item);
        }
      }
    } catch (e) {
      // Fallback to keyword scored
    }
  }

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
