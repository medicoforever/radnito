import rawTemplatesData from './templatesData.json';

export interface RadiologyDocxTemplate {
  id: string;
  name: string;
  category: string;
  modality: string;
  code?: string;
  lines: string[];
  docxBase64: string;
  source?: string;
  sourceType?: 'mri_proto' | 'ris' | 'procedure' | 'custom' | 'doppler';
  fileName?: string;
  relPath?: string;
}

export const RADIOLOGY_TEMPLATES_CATALOG: RadiologyDocxTemplate[] = rawTemplatesData as RadiologyDocxTemplate[];

export const TEMPLATE_MODALITIES = [
  'ALL',
  'MRI',
  'CT',
  'USG',
  'X-Ray',
  'Comprehensive MRI',
  'Vascular Doppler',
  'Hospital Standard RIS',
  'Fluoroscopy',
  'Mammography',
  'Procedures',
] as const;

export type TemplateModalityFilter = typeof TEMPLATE_MODALITIES[number];

/**
 * Filter templates by modality or search query
 */
export function filterTemplates(
  query: string,
  modalityFilter: string = 'ALL'
): RadiologyDocxTemplate[] {
  let list = RADIOLOGY_TEMPLATES_CATALOG;

  if (modalityFilter && modalityFilter !== 'ALL') {
    if (modalityFilter === 'Comprehensive MRI') {
      list = list.filter(t => t.id.startsWith('mri_proto_') || t.id.startsWith('user_'));
    } else if (modalityFilter === 'Vascular Doppler') {
      list = list.filter(t => t.id.startsWith('usg_dop_'));
    } else if (modalityFilter === 'Hospital Standard RIS') {
      list = list.filter(t => t.id.startsWith('ris_'));
    } else if (modalityFilter === 'Procedures') {
      list = list.filter(t => t.id.startsWith('proc_'));
    } else {
      list = list.filter(t => t.modality.toLowerCase() === modalityFilter.toLowerCase());
    }
  }

  if (!query || !query.trim()) {
    return list;
  }

  const q = query.toLowerCase().trim();
  return list.filter(t => 
    t.name.toLowerCase().includes(q) ||
    (t.code && t.code.toLowerCase().includes(q)) ||
    t.category.toLowerCase().includes(q) ||
    t.modality.toLowerCase().includes(q) ||
    t.lines.some(l => l.toLowerCase().includes(q))
  );
}

export function getTemplateById(id: string): RadiologyDocxTemplate | undefined {
  return RADIOLOGY_TEMPLATES_CATALOG.find(t => t.id === id);
}

export default {
  RADIOLOGY_TEMPLATES_CATALOG,
  filterTemplates,
  getTemplateById,
};
