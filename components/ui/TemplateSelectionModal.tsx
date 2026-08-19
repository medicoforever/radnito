import React, { useState, useEffect, useMemo, useRef } from 'react';
import SearchIcon from '../icons/SearchIcon';
import CloseIcon from '../icons/CloseIcon';
import SparklesIcon from '../icons/SparklesIcon';
import UploadIcon from '../icons/UploadIcon';
import Spinner from './Spinner';
import {
  RADIOLOGY_TEMPLATES_CATALOG,
  RadiologyDocxTemplate,
} from '../../services/templateCatalog';
import { saveUserTemplate, UserTemplate } from '../../services/templateStorage';
import { extractLinesFromDocxBlob, mergeFindingsIntoDocx } from '../../services/docxService';

export interface SelectedTemplateData {
  id: string;
  name: string;
  category: string;
  modality: string;
  code?: string;
  lines: string[];
  docxBase64?: string;
  isCustom?: boolean;
}

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: SelectedTemplateData) => void;
  selectedTemplateId?: string | null;
  customTemplates?: UserTemplate[];
  onRefreshCustomTemplates?: () => void;
}

const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  selectedTemplateId,
  customTemplates = [],
  onRefreshCustomTemplates,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [previewTemplate, setPreviewTemplate] = useState<SelectedTemplateData | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setUploadError(null);
      setUploadSuccess(null);
    } else {
      if (selectedTemplateId) {
        const found = RADIOLOGY_TEMPLATES_CATALOG.find(t => t.id === selectedTemplateId);
        if (found) {
          setPreviewTemplate(found);
          return;
        }
      }
      if (RADIOLOGY_TEMPLATES_CATALOG.length > 0) {
        setPreviewTemplate(RADIOLOGY_TEMPLATES_CATALOG[0]);
      }
    }
  }, [isOpen, selectedTemplateId]);

  const allTemplatesList: SelectedTemplateData[] = useMemo(() => {
    const list: SelectedTemplateData[] = RADIOLOGY_TEMPLATES_CATALOG.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      modality: t.modality,
      code: t.code,
      lines: t.lines,
      docxBase64: t.docxBase64,
      isCustom: false,
    }));

    if (customTemplates && customTemplates.length > 0) {
      customTemplates.forEach(ct => {
        list.unshift({
          id: ct.id,
          name: ct.name,
          category: 'My Uploaded Templates',
          modality: (ct as any).modality || 'Custom',
          lines: ct.text ? ct.text.split('\n').filter(Boolean) : [],
          docxBase64: (ct as any).docxBase64 || RADIOLOGY_TEMPLATES_CATALOG[0]?.docxBase64,
          isCustom: true,
        });
      });
    }

    return list;
  }, [customTemplates]);

  const filteredTemplates = useMemo(() => {
    let list = allTemplatesList;

    if (activeTab === 'MRI') {
      list = list.filter(t => t.modality === 'MRI' || t.category?.includes('MRI'));
    } else if (activeTab === 'CT') {
      list = list.filter(t => t.modality === 'CT');
    } else if (activeTab === 'USG') {
      list = list.filter(t => t.modality === 'USG' && !t.category?.includes('Doppler'));
    } else if (activeTab === 'Vascular Doppler') {
      list = list.filter(t => t.category?.includes('Doppler') || t.name?.toUpperCase().includes('DOPPLER'));
    } else if (activeTab === 'X-Ray') {
      list = list.filter(t => t.modality === 'X-Ray');
    } else if (activeTab === 'Fluoroscopy') {
      list = list.filter(t => t.modality === 'Fluoroscopy');
    } else if (activeTab === 'Mammography') {
      list = list.filter(t => t.modality === 'Mammography');
    } else if (activeTab === 'Custom') {
      list = list.filter(t => t.isCustom);
    }

    if (!searchQuery || !searchQuery.trim()) {
      return list;
    }

    const q = searchQuery.toLowerCase().trim();
    return list.filter(t => {
      const nameMatch = t.name && typeof t.name === 'string' && t.name.toLowerCase().includes(q);
      const codeMatch = t.code && typeof t.code === 'string' && t.code.toLowerCase().includes(q);
      const catMatch = t.category && typeof t.category === 'string' && t.category.toLowerCase().includes(q);
      const modMatch = t.modality && typeof t.modality === 'string' && t.modality.toLowerCase().includes(q);
      const linesMatch = Array.isArray(t.lines) && t.lines.some(line => line && typeof line === 'string' && line.toLowerCase().includes(q));
      return Boolean(nameMatch || codeMatch || catMatch || modMatch || linesMatch);
    });
  }, [allTemplatesList, activeTab, searchQuery]);

  useEffect(() => {
    if (filteredTemplates && filteredTemplates.length > 0) {
      if (!previewTemplate || !filteredTemplates.some(t => t.id === previewTemplate.id)) {
        setPreviewTemplate(filteredTemplates[0]);
      }
    } else {
      setPreviewTemplate(null);
    }
  }, [filteredTemplates]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const fileName = file.name;
      const isDocx = fileName.toLowerCase().endsWith('.docx');

      if (isDocx) {
        const { lines, docxBase64 } = await extractLinesFromDocxBlob(file);
        if (lines.length === 0) {
          throw new Error('Could not extract text lines from this Word document.');
        }

        const templateName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ');
        const newTemplate: UserTemplate = {
          id: `custom_docx_${Date.now()}`,
          name: templateName,
          text: lines.join('\n'),
          images: [],
          createdAt: Date.now(),
          ...({ docxBase64, modality: 'Custom' } as any),
        };

        await saveUserTemplate(newTemplate);
        if (onRefreshCustomTemplates) onRefreshCustomTemplates();

        const customSelected: SelectedTemplateData = {
          id: newTemplate.id,
          name: newTemplate.name,
          category: 'My Uploaded Templates',
          modality: 'Custom',
          lines: lines,
          docxBase64: docxBase64,
          isCustom: true,
        };

        setPreviewTemplate(customSelected);
        setActiveTab('Custom');
        setUploadSuccess(`Successfully uploaded Word template: "${templateName}"!`);
      } else {
        throw new Error('Please upload a .docx Word document file.');
      }
    } catch (err: any) {
      console.error('Template upload error:', err);
      setUploadError(err.message || 'Failed to process template file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelect = (tmpl: SelectedTemplateData) => {
    onSelectTemplate(tmpl);
    onClose();
  };

  const getModalityBadgeColor = (mod: string) => {
    switch (mod.toUpperCase()) {
      case 'MRI':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'CT':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'USG':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'X-RAY':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      case 'MAMMOGRAPHY':
        return 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300 border-pink-200 dark:border-pink-800';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh] border border-slate-200 dark:border-slate-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="p-4 px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <SparklesIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 id="template-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Select Radiology Report Template
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                600+ Standard Formats (MRI Protocols, Vascular Doppler, CT & RIS Normal Formats)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".docx"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow flex items-center gap-1.5 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Spinner className="w-3.5 h-3.5" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <UploadIcon className="w-3.5 h-3.5" />
                  <span>Upload Template (.docx)</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
              aria-label="Close template selection"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        {uploadSuccess && (
          <div className="p-2.5 px-6 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 font-semibold flex justify-between items-center">
            <span>✓ {uploadSuccess}</span>
            <button onClick={() => setUploadSuccess(null)} className="text-emerald-600 dark:text-emerald-400 font-bold ml-2">×</button>
          </div>
        )}
        {uploadError && (
          <div className="p-2.5 px-6 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300 font-semibold flex justify-between items-center">
            <span>⚠ {uploadError}</span>
            <button onClick={() => setUploadError(null)} className="text-red-600 dark:text-red-400 font-bold ml-2">×</button>
          </div>
        )}

        {/* Search & Tabs */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search across all templates (e.g. Brain, CT Brain Plain, Stroke, Spine, Knee, Doppler, Abdomen, Chest)..."
              className="w-full p-2.5 pl-10 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-950 dark:text-white text-sm"
              aria-label="Search templates"
              autoFocus
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <SearchIcon className="w-4 h-4 text-slate-400" />
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-semibold">
            {[
              { id: 'ALL', label: `All (${allTemplatesList.length})` },
              { id: 'CT', label: `CT Scan (${allTemplatesList.filter(t => t.modality === 'CT').length})` },
              { id: 'MRI', label: `MRI (${allTemplatesList.filter(t => t.modality === 'MRI' || t.category?.includes('MRI')).length})` },
              { id: 'USG', label: `Ultrasound (${allTemplatesList.filter(t => t.modality === 'USG' && !t.category?.includes('Doppler')).length})` },
              { id: 'Vascular Doppler', label: `Vascular Doppler (${allTemplatesList.filter(t => t.category?.includes('Doppler') || t.name?.toUpperCase().includes('DOPPLER')).length})` },
              { id: 'X-Ray', label: `X-Ray (${allTemplatesList.filter(t => t.modality === 'X-Ray').length})` },
              { id: 'Fluoroscopy', label: `Fluoroscopy (${allTemplatesList.filter(t => t.modality === 'Fluoroscopy').length})` },
              { id: 'Mammography', label: `Mammography (${allTemplatesList.filter(t => t.modality === 'Mammography').length})` },
              ...(allTemplatesList.some(t => t.isCustom)
                ? [{ id: 'Custom', label: `My Custom (${allTemplatesList.filter(t => t.isCustom).length})` }]
                : []),
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Split View */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Column: Template List */}
          <div className="md:col-span-6 lg:col-span-5 border-r border-slate-200 dark:border-slate-800 overflow-y-auto p-3 space-y-1.5 max-h-[55vh] md:max-h-[60vh]">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-2 py-0.5">
              Showing {filteredTemplates.length} template{filteredTemplates.length === 1 ? '' : 's'}
            </div>

            {filteredTemplates.length > 0 ? (
              filteredTemplates.map(template => {
                const isSelected = selectedTemplateId === template.id;
                const isPreviewing = previewTemplate?.id === template.id;

                return (
                  <div
                    key={template.id}
                    onClick={() => setPreviewTemplate(template)}
                    onDoubleClick={() => handleSelect(template)}
                    className={`p-3 rounded-xl cursor-pointer transition-all border ${
                      isPreviewing
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600 shadow-sm'
                        : isSelected
                        ? 'bg-green-50/60 dark:bg-green-950/30 border-green-300 dark:border-green-700'
                        : 'bg-white dark:bg-slate-900 border-slate-150 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getModalityBadgeColor(
                            template.modality
                          )}`}
                        >
                          {template.modality}
                        </span>
                        {template.code && (
                          <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            {template.code}
                          </span>
                        )}
                        {isSelected && (
                          <span className="text-[10px] font-bold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">
                        {template.category}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1.5 leading-snug">
                      {template.name}
                    </h4>

                    <div className="flex justify-between items-center mt-2">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {template.lines.length} lines / sections
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleSelect(template);
                        }}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
                No templates matched your search query.
              </div>
            )}
          </div>

          {/* Right Column: Template Preview Pane */}
          <div className="md:col-span-6 lg:col-span-7 bg-slate-50/70 dark:bg-slate-950/50 p-4 flex flex-col justify-between overflow-hidden max-h-[55vh] md:max-h-[60vh]">
            {previewTemplate ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0 flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getModalityBadgeColor(
                          previewTemplate.modality
                        )}`}
                      >
                        {previewTemplate.modality}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {previewTemplate.category}
                      </span>
                    </div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white mt-1">
                      {previewTemplate.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelect(previewTemplate)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all transform hover:scale-105 flex-shrink-0"
                  >
                    ✓ Use This Template
                  </button>
                </div>

                {/* Preview Body */}
                <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 font-sans text-xs">
                  {previewTemplate && Array.isArray(previewTemplate.lines) && previewTemplate.lines.length > 0 ? (
                    previewTemplate.lines.map((line, idx) => {
                      if (!line || typeof line !== 'string') return null;
                      const upper = line.toUpperCase();
                      const lower = line.toLowerCase();
                      const isTitle = idx === 0 && (upper.includes('SCAN') || upper.includes('MRI') || upper.includes('C.T.') || upper.includes('ULTRASOUND') || upper.includes('X-RAY') || upper.includes('REPORT'));
                      const isImpression = upper.startsWith('IMPRESSION:');
                      const isProfile = lower.startsWith('clinical profile:');
                      const isTechnique = lower.startsWith('technique:') || lower.startsWith('mri technique:');

                      return (
                        <div
                          key={idx}
                          className={`p-2 rounded-lg ${
                            isTitle
                              ? 'bg-blue-100/60 dark:bg-blue-900/30 font-bold text-center text-blue-950 dark:text-blue-200 border border-blue-200 dark:border-blue-800'
                              : isImpression
                              ? 'bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500 font-bold text-amber-950 dark:text-amber-200'
                              : isProfile
                              ? 'italic text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-1.5'
                              : isTechnique
                              ? 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-1.5 font-medium'
                              : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-800/80 leading-relaxed'
                          }`}
                        >
                          {line}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-slate-400 italic">No text content available.</p>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-500 flex-shrink-0">
                  <span>📄 Native Word DOCX Format</span>
                  <span>✨ Automatically merges findings & preserves font styles</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                Select a template from the list to preview its report format.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="p-3 px-6 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center flex-shrink-0 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Selected: <strong className="text-slate-800 dark:text-slate-200">{previewTemplate?.name || 'None'}</strong>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            {previewTemplate && (
              <button
                type="button"
                onClick={() => handleSelect(previewTemplate)}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-colors shadow-md"
              >
                Use Selected Template
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TemplateSelectionModal;