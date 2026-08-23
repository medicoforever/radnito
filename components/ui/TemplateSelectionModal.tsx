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
import { saveUserTemplate, UserTemplate, isTemplateSkillEnabled, setTemplateSkillEnabled } from '../../services/templateStorage';
import { extractLinesFromDocxBlob } from '../../services/docxService';

export interface SelectedTemplateData {
  id: string;
  name: string;
  category: string;
  modality: string;
  code?: string;
  lines: string[];
  docxBase64?: string;
  isCustom?: boolean;
  skillPrompt?: string;
}

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: SelectedTemplateData) => void;
  selectedTemplateId?: string | null;
  customTemplates?: UserTemplate[];
  onRefreshCustomTemplates?: () => void;
}

const ORGAN_TAGS = [
  { label: '🧠 Brain & Head', query: 'brain|head|orbit|temporal' },
  { label: '🦴 Spine', query: 'spine|cervical|dorsal|lumbar' },
  { label: '⚡ Stroke', query: 'stroke' },
  { label: '🫁 Chest & Thorax', query: 'thorax|lung|chest|coronary|aorta|cardiac' },
  { label: '🩺 Abdomen & Pelvis', query: 'abdomen|pelvis|mrcp|kub|liver' },
  { label: '🦵 MSK & Extremities', query: 'knee|shoulder|foot|wrist|hip|forearm|leg|brachial' },
];

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
  const [previewPaneTab, setPreviewPaneTab] = useState<'LINES' | 'SKILL'>('LINES');
  const [isSkillEnabled, setIsSkillEnabled] = useState<boolean>(() => isTemplateSkillEnabled());

  // Custom DOCX Upload state with optional skill prompt
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [pendingDocx, setPendingDocx] = useState<{ name: string; lines: string[]; docxBase64: string } | null>(null);
  const [customDocxSkillPrompt, setCustomDocxSkillPrompt] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setUploadError(null);
      setUploadSuccess(null);
      setPendingDocx(null);
      setCustomDocxSkillPrompt('');
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
      skillPrompt: (t as any).skillPrompt || '',
    }));

    if (customTemplates && customTemplates.length > 0) {
      customTemplates.forEach(ct => {
        const textLines = ct.text ? ct.text.split('\n').filter(Boolean) : [];
        list.unshift({
          id: ct.id,
          name: ct.name,
          category: 'My Uploaded Templates',
          modality: (ct as any).modality || 'Custom',
          lines: textLines.length > 0 ? textLines : [],
          docxBase64: (ct as any).docxBase64 || RADIOLOGY_TEMPLATES_CATALOG[0]?.docxBase64,
          isCustom: true,
          skillPrompt: ct.customRules || (ct as any).skillPrompt || '',
        });
      });
    }

    return list;
  }, [customTemplates]);

  const filteredTemplates = useMemo(() => {
    let list = allTemplatesList;

    if (activeTab === 'CT') {
      list = list.filter(t => t.category === 'CT' || t.modality === 'CT');
    } else if (activeTab === 'MRI') {
      list = list.filter(t => t.category === 'MRI' || t.modality === 'MRI');
    } else if (activeTab === 'Custom') {
      list = list.filter(t => t.isCustom);
    }

    if (!searchQuery || !searchQuery.trim()) {
      return list;
    }

    const q = searchQuery.toLowerCase().trim();
    const queryParts = q.split('|').map(s => s.trim()).filter(Boolean);

    return list.filter(t => {
      const nameStr = (t.name || '').toLowerCase();
      const codeStr = (t.code || '').toLowerCase();
      const catStr = (t.category || '').toLowerCase();
      const modStr = (t.modality || '').toLowerCase();
      const linesStr = Array.isArray(t.lines) ? t.lines.join(' ').toLowerCase() : '';
      const skillStr = (t.skillPrompt || '').toLowerCase();

      const fullHaystack = `${nameStr} ${codeStr} ${catStr} ${modStr} ${linesStr} ${skillStr}`;

      return queryParts.some(part => fullHaystack.includes(part));
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

  const handleFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const fileName = file.name;
      const isDocx = fileName.toLowerCase().endsWith('.docx');

      if (!isDocx) {
        throw new Error('Please select a valid Word (.docx) file.');
      }

      const { lines, docxBase64 } = await extractLinesFromDocxBlob(file);
      if (lines.length === 0) {
        throw new Error('Could not extract text sections from this Word document.');
      }

      const templateName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ');
      setPendingDocx({
        name: templateName,
        lines,
        docxBase64: docxBase64 || '',
      });
      setCustomDocxSkillPrompt('');
    } catch (err: any) {
      console.error('Template upload error:', err);
      setUploadError(err.message || 'Failed to parse .docx file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSavePendingDocx = async () => {
    if (!pendingDocx) return;
    try {
      const newTemplate: UserTemplate = {
        id: `custom_docx_${Date.now()}`,
        name: pendingDocx.name,
        text: pendingDocx.lines.join('\n'),
        images: [],
        createdAt: Date.now(),
        customRules: customDocxSkillPrompt.trim() || undefined,
        ...({ docxBase64: pendingDocx.docxBase64, modality: 'Custom' } as any),
      };

      await saveUserTemplate(newTemplate);
      if (onRefreshCustomTemplates) onRefreshCustomTemplates();

      const customSelected: SelectedTemplateData = {
        id: newTemplate.id,
        name: newTemplate.name,
        category: 'My Uploaded Templates',
        modality: 'Custom',
        lines: pendingDocx.lines,
        docxBase64: pendingDocx.docxBase64,
        isCustom: true,
        skillPrompt: customDocxSkillPrompt.trim() || undefined,
      };

      setPreviewTemplate(customSelected);
      setActiveTab('Custom');
      setPendingDocx(null);
      setUploadSuccess(`Successfully uploaded and configured Word template: "${pendingDocx.name}"!`);
    } catch (err: any) {
      setUploadError('Failed to save custom template.');
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
      default:
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
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
                {allTemplatesList.length} Verified Standard Report Formats (CT & MRI) with Consultant Skills
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChosen}
              accept=".docx"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            >
              <UploadIcon className="w-3.5 h-3.5" />
              {isUploading ? 'Parsing DOCX...' : '+ Upload Custom DOCX'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Modal-level Pending DOCX Configuration Drawer */}
        {pendingDocx && (
          <div className="p-4 px-6 bg-blue-50/90 dark:bg-blue-950/60 border-b border-blue-200 dark:border-blue-800 space-y-3 animate-fade-in flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-950 dark:text-blue-200 flex items-center gap-2">
                <span>📄 Configure Uploaded Word Template:</span>
                <span className="bg-blue-200 dark:bg-blue-900 text-blue-900 dark:text-blue-100 px-2 py-0.5 rounded font-mono text-[11px]">
                  {pendingDocx.name}.docx ({pendingDocx.lines.length} sections)
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPendingDocx(null)}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                ✕ Cancel
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Optional: Add Specialized Consultant Skill / Reporting Rules for this DOCX:
              </label>
              <textarea
                rows={3}
                value={customDocxSkillPrompt}
                onChange={e => setCustomDocxSkillPrompt(e.target.value)}
                placeholder="Optional: Enter specific line replacement rules, terminology preferences, or scoring criteria for this template. (Leave blank to use default consultant mirror rules)..."
                className="w-full p-2.5 text-xs font-mono border border-blue-300 dark:border-blue-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDocx(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSavePendingDocx}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
              >
                Save DOCX Template to Library
              </button>
            </div>
          </div>
        )}

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

        <div className="p-4 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-3 flex-shrink-0">
          <div className="relative">
            <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by organ, procedure, modality, or keywords (e.g. Brain, Abdomen, PE, Spine)..."
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mr-1 flex items-center gap-1">
              <SparklesIcon className="w-3 h-3 text-amber-500" />
              Quick:
            </span>
            {ORGAN_TAGS.map(tag => (
              <button
                key={tag.label}
                type="button"
                onClick={() => setSearchQuery(searchQuery === tag.query ? '' : tag.query)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  searchQuery === tag.query
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                {tag.label}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-semibold">
            {[
              { id: 'ALL', label: `All (${allTemplatesList.length})` },
              { id: 'CT', label: `CT (${allTemplatesList.filter(t => t.category === 'CT' || t.modality === 'CT').length})` },
              { id: 'MRI', label: `MRI (${allTemplatesList.filter(t => t.category === 'MRI' || t.modality === 'MRI').length})` },
              ...(allTemplatesList.some(t => t.isCustom)
                ? [{ id: 'Custom', label: `My Custom DOCX (${allTemplatesList.filter(t => t.isCustom).length})` }]
                : []),
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-xl transition-all ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Modal Split Content: Left List, Right Preview */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-[360px]">
          {/* Templates List */}
          <div className="md:col-span-5 border-r border-slate-200 dark:border-slate-800 overflow-y-auto p-2 space-y-1 bg-slate-50/50 dark:bg-slate-950/30">
            {filteredTemplates.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No report templates found matching "{searchQuery}".
              </div>
            ) : (
              filteredTemplates.map(tmpl => {
                const isSelected = previewTemplate?.id === tmpl.id;
                return (
                  <div
                    key={tmpl.id}
                    onClick={() => setPreviewTemplate(tmpl)}
                    className={`p-3 rounded-xl cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${getModalityBadgeColor(
                              tmpl.modality
                            )}`}
                          >
                            {tmpl.modality}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                            {tmpl.category}
                          </span>
                          {tmpl.skillPrompt && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                              ⚡ Skill
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {tmpl.name}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                          {tmpl.lines?.length || 0} normal sections • {tmpl.code || tmpl.id}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Preview Pane */}
          <div className="md:col-span-7 bg-white dark:bg-slate-900 p-4 overflow-hidden flex flex-col">
            {previewTemplate ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header info */}
                <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start gap-2 flex-shrink-0">
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
                      {previewTemplate.skillPrompt && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          ⚡ Consultant Skill Active
                        </span>
                      )}
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

                {/* Switcher Tabs for Preview Pane: Baseline Lines vs Consultant Skill */}
                <div className="flex gap-2 pt-2.5 pb-2 border-b border-slate-100 dark:border-slate-800 flex-shrink-0 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setPreviewPaneTab('LINES')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      previewPaneTab === 'LINES'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    📄 Baseline Report Lines ({previewTemplate.lines?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewPaneTab('SKILL')}
                    className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                      previewPaneTab === 'SKILL'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    <span>⚡ Consultant Skill Directives</span>
                  </button>
                </div>

                {/* Preview Body */}
                <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 font-sans text-xs">
                  {previewPaneTab === 'SKILL' ? (
                    <div className="p-3.5 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 font-sans text-xs">
                          Authoritative Consultant Mirror Rules (From Archive):
                        </span>
                        <span className="text-[10px] text-slate-400 font-sans">
                          Zero-Filler • AST Replacement
                        </span>
                      </div>
                      {previewTemplate.skillPrompt ? (
                        previewTemplate.skillPrompt
                      ) : (
                        <p className="font-sans italic text-slate-400">
                          Standard baseline consultant merging directives will be applied.
                        </p>
                      )}
                    </div>
                  ) : (
                    previewTemplate && Array.isArray(previewTemplate.lines) && previewTemplate.lines.length > 0 ? (
                      previewTemplate.lines.map((line, idx) => {
                        if (!line || typeof line !== 'string') return null;
                        const upper = line.toUpperCase();
                        const isTitle = idx === 0 && (upper.includes('SCAN') || upper.includes('MRI') || upper.includes('C.T.') || upper.includes('REPORT'));
                        const isImpression = upper.startsWith('IMPRESSION');
                        const isHeading = line.endsWith(':') && line.length <= 40;

                        return (
                          <div
                            key={idx}
                            className={`p-2 rounded-lg ${
                              isTitle
                                ? 'bg-blue-100/60 dark:bg-blue-900/30 font-bold text-center text-blue-950 dark:text-blue-200 border border-blue-200 dark:border-blue-800'
                                : isImpression
                                ? 'bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500 font-bold text-amber-950 dark:text-amber-200 mt-2'
                                : isHeading
                                ? 'font-bold text-slate-900 dark:text-slate-100 bg-slate-100/80 dark:bg-slate-800/60 border-l-2 border-blue-500 px-2.5 py-1'
                                : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-800/80 leading-relaxed'
                            }`}
                          >
                            {line}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-slate-400 italic">No text content available.</p>
                    )
                  )}
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-500 flex-shrink-0">
                  <span>📄 Native Word DOCX Format</span>
                  <span>✨ Consultant Skill Integrated</span>
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
        <footer className="p-3 px-6 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3 flex-shrink-0 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-500 dark:text-slate-400">
              Selected: <strong className="text-slate-800 dark:text-slate-200">{previewTemplate?.name || 'None'}</strong>
            </span>
            <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <input
                type="checkbox"
                checked={isSkillEnabled}
                onChange={e => {
                  const val = e.target.checked;
                  setIsSkillEnabled(val);
                  setTemplateSkillEnabled(val);
                }}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <span className={`font-bold ${isSkillEnabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>
                {isSkillEnabled ? '⚡ Consultant Skill Enabled' : 'Consultant Skill Disabled'}
              </span>
            </label>
          </div>
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
