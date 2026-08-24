import rawTemplatesData from './templatesData.json';

export interface RadiologyDocxTemplate {
  id: string;
  name: string;
  title?: string;
  category: string;
  modality: string;
  code?: string;
  lines: string[];
  docxBase64: string;
  source?: string;
  sourceType?: 'mri_proto' | 'ris' | 'procedure' | 'custom' | 'doppler';
  fileName?: string;
  relPath?: string;
  skillPrompt?: string;
  content?: string;
}

export let RADIOLOGY_TEMPLATES_CATALOG: RadiologyDocxTemplate[] = (rawTemplatesData as RadiologyDocxTemplate[]) || [];

export const TEMPLATE_MODALITIES = ['ALL', 'CT', 'MRI'] as const;
export type TemplateModalityFilter = typeof TEMPLATE_MODALITIES[number];

export async function initializeTemplateCatalog(): Promise<RadiologyDocxTemplate[]> {
  if (Array.isArray(RADIOLOGY_TEMPLATES_CATALOG) && RADIOLOGY_TEMPLATES_CATALOG.length >= 70) {
    return RADIOLOGY_TEMPLATES_CATALOG;
  }
  try {
    const res = await fetch('/templatesData.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length >= 70) {
        RADIOLOGY_TEMPLATES_CATALOG = data;
        return data;
      }
    }
  } catch (e) {}

  try {
    const ghRes = await fetch('https://raw.githubusercontent.com/medicoforever/radnito/main/public/templatesData.json');
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      if (Array.isArray(ghData) && ghData.length >= 70) {
        RADIOLOGY_TEMPLATES_CATALOG = ghData;
        return ghData;
      }
    }
  } catch (err) {}

  return RADIOLOGY_TEMPLATES_CATALOG;
}

if (typeof window !== 'undefined') {
  initializeTemplateCatalog().catch(() => {});
}

export function filterTemplates(query: string, modalityFilter: string = 'ALL'): RadiologyDocxTemplate[] {
  let list = RADIOLOGY_TEMPLATES_CATALOG;
  if (modalityFilter && modalityFilter !== 'ALL') {
    list = list.filter(t => t.category?.toLowerCase() === modalityFilter.toLowerCase() || t.modality?.toLowerCase() === modalityFilter.toLowerCase());
  }
  if (!query || !query.trim()) return list;
  const q = query.toLowerCase().trim();
  return list.filter(t =>
    t.name?.toLowerCase().includes(q) ||
    (t.title && t.title.toLowerCase().includes(q)) ||
    (t.code && t.code.toLowerCase().includes(q)) ||
    t.category?.toLowerCase().includes(q) ||
    t.modality?.toLowerCase().includes(q) ||
    (t.lines && t.lines.some(l => l.toLowerCase().includes(q)))
  );
}

export function getTemplateById(id: string): RadiologyDocxTemplate | undefined {
  return RADIOLOGY_TEMPLATES_CATALOG.find(t => t.id === id);
}

export function findCrossModalitySkills(findingsText: string, currentTemplateId?: string): Array<{ name: string; category?: string; skillPrompt?: string }> {
  if (!findingsText || typeof findingsText !== 'string') return [];
  const text = findingsText.toLowerCase();
  
  return RADIOLOGY_TEMPLATES_CATALOG.filter(tmpl => {
    if (tmpl.id === currentTemplateId) return false;
    if (!tmpl.skillPrompt) return false;
    
    const nameKeywords = (tmpl.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !['scan', 'plain', 'routine', 'with', 'view'].includes(w));
    return nameKeywords.some(kw => text.includes(kw));
  }).map(tmpl => ({
    name: tmpl.name,
    category: tmpl.category,
    skillPrompt: tmpl.skillPrompt,
  })).slice(0, 3);
}

export default {
  RADIOLOGY_TEMPLATES_CATALOG,
  initializeTemplateCatalog,
  filterTemplates,
  getTemplateById,
  findCrossModalitySkills,
};
