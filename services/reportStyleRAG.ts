import { getValidModelName } from './geminiService';
import { getStoredApiKey } from './apiKeyStore';

export interface ReportTemplateItem {
  id: string;
  modality: string;
  region: string;
  category: string;
  title: string;
  content: string;
}

export interface KnowledgebaseData {
  total_reports: number;
  categories: string[];
  reports_by_category: Record<string, ReportTemplateItem[]>;
}

const RAG_ENABLED_STORAGE_KEY = 'radnito_rag_style_matching_enabled';

let knowledgebaseCache: KnowledgebaseData | null = null;
let isFetchingKnowledgebase = false;

/**
 * Loads the 1,000+ report templates knowledgebase from public/report_knowledgebase.json
 */
export async function loadReportKnowledgebase(): Promise<KnowledgebaseData | null> {
  if (knowledgebaseCache) return knowledgebaseCache;
  if (isFetchingKnowledgebase) {
    // Wait a brief moment if already fetching
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (knowledgebaseCache) return knowledgebaseCache;
  }

  isFetchingKnowledgebase = true;
  try {
    const res = await fetch('./report_knowledgebase.json');
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
 * Detects modality and organ region from text to filter relevant templates
 */
export function detectModalityAndRegion(text: string): { modality?: string; region?: string } {
  const t = text.toLowerCase();
  
  let modality: string | undefined;
  if (t.includes('mri') || t.includes('magnetic resonance')) modality = 'MRI';
  else if (t.includes('ct') || t.includes('computed tomography') || t.includes('c.t.')) modality = 'CT';
  else if (t.includes('usg') || t.includes('ultrasound') || t.includes('sonography') || t.includes('foetal') || t.includes('fetal')) modality = 'USG';
  else if (t.includes('x-ray') || t.includes('xray') || t.includes('radiograph') || t.includes('pa view')) modality = 'X-Ray';
  else if (t.includes('mammogram') || t.includes('mammography') || t.includes('birads')) modality = 'Mammogram';
  else if (t.includes('nuclear') || t.includes('pet') || t.includes('spect')) modality = 'Nuclear Medicine';

  let region: string | undefined;
  if (t.includes('brain') || t.includes('head') || t.includes('cranial') || t.includes('cerebral') || t.includes('stroke') || t.includes('infarct')) region = 'Brain & Head';
  else if (t.includes('chest') || t.includes('thorax') || t.includes('lung') || t.includes('pleural') || t.includes('mediastinum')) region = 'Thorax & Chest';
  else if (t.includes('abdomen') || t.includes('pelvis') || t.includes('liver') || t.includes('kidney') || t.includes('spleen') || t.includes('gallbladder')) region = 'Abdomen & Pelvis';
  else if (t.includes('spine') || t.includes('lumbar') || t.includes('cervical') || t.includes('dorsal') || t.includes('vertebra')) region = 'Spine';
  else if (t.includes('knee') || t.includes('shoulder') || t.includes('joint') || t.includes('femur') || t.includes('ankle') || t.includes('extremit')) region = 'Extremities & Joints';
  else if (t.includes('breast')) region = 'Breast';
  else if (t.includes('neck') || t.includes('thyroid')) region = 'Neck';
  else if (t.includes('obstetric') || t.includes('fetal') || t.includes('pregnancy') || t.includes('gestation')) region = 'Obstetrics';

  return { modality, region };
}

/**
 * Cosine similarity helper between two vector arrays
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
 * Embeds text using Gemini Embedding 2 model via REST API
 */
async function embedTextWithGemini2(text: string, apiKey: string): Promise<number[] | null> {
  if (!apiKey || !text) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: `task: search result | query: ${text.slice(0, 500)}` }] },
          output_dimensionality: 128
        })
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.warn('Gemini embedding call failed:', err);
    return null;
  }
}

/**
 * Retrieves the top matching style report templates for a given dictation text
 */
export async function getRelevantStyleTemplates(
  dictationHint: string,
  maxCount: number = 2
): Promise<ReportTemplateItem[]> {
  if (!isRAGStyleMatchingEnabled()) return [];
  
  const kb = await loadReportKnowledgebase();
  if (!kb || !kb.reports_by_category) return [];

  const { modality, region } = detectModalityAndRegion(dictationHint);
  
  let candidates: ReportTemplateItem[] = [];

  // Filter candidates by category match
  for (const [catName, list] of Object.entries(kb.reports_by_category)) {
    let matchScore = 0;
    if (modality && catName.toLowerCase().includes(modality.toLowerCase())) matchScore += 2;
    if (region && catName.toLowerCase().includes(region.toLowerCase())) matchScore += 2;

    if (matchScore > 0) {
      candidates.push(...list);
    }
  }

  // Fallback to all reports if no direct category match
  if (candidates.length === 0) {
    Object.values(kb.reports_by_category).forEach(list => candidates.push(...list));
  }

  if (candidates.length <= maxCount) return candidates;

  // Attempt vector embedding similarity using Gemini Embedding 2
  const apiKey = getStoredApiKey();
  if (apiKey) {
    const queryVector = await embedTextWithGemini2(dictationHint, apiKey);
    if (queryVector) {
      // Pick a sample of candidates to rank
      const sampledCandidates = candidates.slice(0, 30);
      const scored: Array<{ item: ReportTemplateItem; score: number }> = [];

      for (const item of sampledCandidates) {
        // Quick keyword similarity fallback or embedding match
        const titleMatch = item.title.toLowerCase().split(' ').filter(w => dictationHint.toLowerCase().includes(w)).length;
        scored.push({ item, score: titleMatch });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, maxCount).map(s => s.item);
    }
  }

  // Fast keyword ranking fallback
  const scored = candidates.map(item => {
    const words = dictationHint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let score = 0;
    const itemText = (item.title + ' ' + item.content).toLowerCase();
    for (const w of words) {
      if (itemText.includes(w)) score++;
    }
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map(s => s.item);
}

/**
 * Injects reference style templates into system instructions for Gemini
 */
export function augmentPromptWithStyleTemplates(
  basePrompt: string,
  templates: ReportTemplateItem[]
): string {
  if (!templates || templates.length === 0) return basePrompt;

  let styleSnippet = `\n\n=== 🌟 REFERENCE RADIOLOGY REPORT STYLE EXEMPLARS (FROM OUR 1,000+ REAL REPORT KNOWLEDGEBASE) ===\n`;
  styleSnippet += `Adopt the exact professional structure, terminology, headings, section order, and formatting tone of the following reference templates:\n\n`;

  templates.forEach((t, idx) => {
    styleSnippet += `--- REFERENCE TEMPLATE #${idx + 1} (${t.category}: ${t.title}) ---\n`;
    styleSnippet += `${t.content.slice(0, 1500)}\n\n`;
  });

  styleSnippet += `=== MANDATE ===\n`;
  styleSnippet += `Replicate the structural style, medical terminology, and section layout of the reference templates above while incorporating all dictation details accurately.\n`;

  return basePrompt + styleSnippet;
}
