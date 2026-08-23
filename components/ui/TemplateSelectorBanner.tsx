import React, { useState, useEffect } from 'react';
import SparklesIcon from '../icons/SparklesIcon';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import CloseIcon from '../icons/CloseIcon';
import { SelectedTemplateData } from './TemplateSelectionModal';
import {
  isTemplateSkillEnabled,
  setTemplateSkillEnabled,
  getTemplateCustomPrompt,
  setTemplateCustomPrompt,
  resetTemplateCustomPrompt,
  saveUserTemplate,
  UserTemplate,
} from '../../services/templateStorage';

interface TemplateSelectorBannerProps {
  selectedTemplate: SelectedTemplateData | null;
  onOpenModal: () => void;
  onClearTemplate: () => void;
  autoDownloadDocx?: boolean;
  onToggleAutoDownloadDocx?: () => void;
  onToggleAutoDownload?: (val: boolean | ((prev: boolean) => boolean)) => void;
  onSelectTemplate?: (tmpl: SelectedTemplateData) => void;
  className?: string;
}

const TemplateSelectorBanner: React.FC<TemplateSelectorBannerProps> = ({
  selectedTemplate,
  onOpenModal,
  onClearTemplate,
  autoDownloadDocx = true,
  onToggleAutoDownloadDocx,
  onToggleAutoDownload,
  onSelectTemplate,
  className = '',
}) => {
  const [isSkillEnabled, setIsSkillEnabled] = useState<boolean>(() => isTemplateSkillEnabled());
  const [isSkillExpanded, setIsSkillExpanded] = useState<boolean>(false);
  const [customSkillPrompt, setCustomSkillPrompt] = useState<string>('');
  const [skillNotice, setSkillNotice] = useState<string | null>(null);
  const [isSavingCustomModalOpen, setIsSavingCustomModalOpen] = useState<boolean>(false);
  const [customTemplateSaveName, setCustomTemplateSaveName] = useState<string>('');

  useEffect(() => {
    if (selectedTemplate?.id) {
      const storedOverride = getTemplateCustomPrompt(selectedTemplate.id);
      setCustomSkillPrompt(storedOverride || selectedTemplate.skillPrompt || '');
      setCustomTemplateSaveName(`${selectedTemplate.name} (Custom Skill)`);
    } else {
      setCustomSkillPrompt('');
    }
  }, [selectedTemplate?.id, selectedTemplate?.skillPrompt]);

  const handleToggleAutoDownload = () => {
    if (onToggleAutoDownloadDocx) {
      onToggleAutoDownloadDocx();
    } else if (onToggleAutoDownload) {
      onToggleAutoDownload(prev => !prev);
    }
  };

  const handleToggleSkill = (enabled: boolean) => {
    setIsSkillEnabled(enabled);
    setTemplateSkillEnabled(enabled);
  };

  const handleResetSkillToDefault = () => {
    if (!selectedTemplate?.id) return;
    resetTemplateCustomPrompt(selectedTemplate.id);
    setCustomSkillPrompt(selectedTemplate.skillPrompt || '');
    setSkillNotice('Reset to archive baseline consultant directives.');
    setTimeout(() => setSkillNotice(null), 3000);
  };

  const handleSaveAsCustomTemplate = async () => {
    if (!selectedTemplate) return;
    const saveName = customTemplateSaveName.trim() || `${selectedTemplate.name} (Custom)`;
    try {
      const newCustom: UserTemplate = {
        id: `custom_skill_${Date.now()}`,
        name: saveName,
        text: selectedTemplate.lines?.join('\n') || selectedTemplate.name,
        images: [],
        createdAt: Date.now(),
        customRules: customSkillPrompt.trim() || undefined,
        ...({ docxBase64: selectedTemplate.docxBase64, modality: selectedTemplate.modality || selectedTemplate.category } as any),
      };

      await saveUserTemplate(newCustom);

      const newActive: SelectedTemplateData = {
        id: newCustom.id,
        name: newCustom.name,
        category: 'My Uploaded Templates',
        modality: (newCustom as any).modality || selectedTemplate.modality,
        lines: selectedTemplate.lines || [],
        docxBase64: selectedTemplate.docxBase64,
        isCustom: true,
        skillPrompt: customSkillPrompt.trim() || undefined,
      };

      if (onSelectTemplate) {
        onSelectTemplate(newActive);
      }
      setIsSavingCustomModalOpen(false);
      setSkillNotice(`✓ Saved as custom template "${saveName}" in your library!`);
      setTimeout(() => setSkillNotice(null), 4000);
    } catch (err: any) {
      setSkillNotice(`Failed to save template: ${err.message || err}`);
    }
  };

  return (
    <div className={`w-full mb-6 rounded-2xl bg-white dark:bg-slate-800 border border-blue-200/80 dark:border-slate-700/80 shadow-sm transition-all overflow-hidden ${className}`}>
      {/* Save as Custom Template Sub-Modal */}
      {isSavingCustomModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>💾 Save Modified Skill as New Custom Template</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This will save this template structure (.docx) along with your customized consultant skill prompt permanently to your personal template library.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Custom Template Name:
              </label>
              <input
                type="text"
                value={customTemplateSaveName}
                onChange={e => setCustomTemplateSaveName(e.target.value)}
                placeholder="e.g. Brain CT - Institutional Format"
                className="w-full p-2.5 text-xs font-semibold border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsSavingCustomModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAsCustomTemplate}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
              >
                Save to My Templates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Bar */}
      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-purple-50/90 dark:from-slate-800/90 dark:via-indigo-950/30 dark:to-slate-800/90">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-sm flex-shrink-0">
            <SparklesIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Active Report Template
              </span>
              {selectedTemplate && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  {selectedTemplate.modality || selectedTemplate.category || 'General'}
                </span>
              )}
              {selectedTemplate?.skillPrompt && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                  ⚡ Consultant Skill Attached
                </span>
              )}
            </div>
            {selectedTemplate ? (
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate mt-0.5">
                {selectedTemplate.name || 'Untitled Template'}
              </h3>
            ) : (
              <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                No template selected (Standard general dictation mode active)
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
          {selectedTemplate && (
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white transition-all shadow-sm">
              <input
                type="checkbox"
                checked={autoDownloadDocx}
                onChange={handleToggleAutoDownload}
                className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
              />
              <span>Auto .docx</span>
            </label>
          )}

          {selectedTemplate && (
            <button
              type="button"
              onClick={() => setIsSkillExpanded(!isSkillExpanded)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 hover:bg-white transition-all flex items-center gap-1"
            >
              <span>{isSkillExpanded ? '▲ Hide Skill' : '⚡ View / Edit Skill'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenModal}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ${
              selectedTemplate
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-white dark:bg-slate-900 hover:bg-blue-50 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700'
            }`}
          >
            <span>{selectedTemplate ? 'Change Template' : '⚡ Choose Report Template (72 KBs)'}</span>
            <ChevronDownIcon className="w-3.5 h-3.5" />
          </button>

          {selectedTemplate && (
            <button
              type="button"
              onClick={onClearTemplate}
              title="Clear template"
              className="p-1.5 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-slate-200 dark:border-slate-700 transition-all"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Skill Editor & Toggle in Main Dictation Mode */}
      {selectedTemplate && isSkillExpanded && (
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 space-y-3 animate-fade-in">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSkillEnabled}
                  onChange={e => handleToggleSkill(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                    isSkillEnabled 
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                  }`}>
                    {isSkillEnabled ? '⚡ Consultant Skill Active' : 'Consultant Skill Disabled'}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {isSkillEnabled ? 'Archive-Derived Directives & RADS Scoring' : 'Standard Baseline'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isSkillEnabled
                    ? 'AI enforces zero-filler consultant reporting, AST line replacement, and RADS scoring for audio dictation.'
                    : 'Audio transcribed and merged into template without specialized consultant skill directives.'}
                </p>
              </div>
            </div>

            {skillNotice && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-pulse">
                {skillNotice}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Authoritative Skill Directives for <span className="text-blue-600 dark:text-blue-400">{selectedTemplate.name}</span>:
              </span>
              <span className="text-[11px] text-slate-400">
                Editable for this session
              </span>
            </div>

            <textarea
              rows={8}
              value={customSkillPrompt}
              onChange={e => setCustomSkillPrompt(e.target.value)}
              placeholder="Enter or modify consultant instructions, line replacements, and scoring rules for this template..."
              className="w-full p-3 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none leading-relaxed"
            />

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs pt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                💡 <em>Edits apply immediately to your audio dictations. Click 'Save as Custom Template' to store permanently.</em>
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleResetSkillToDefault}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold"
                >
                  ↺ Reset to Default
                </button>
                <button
                  type="button"
                  onClick={() => setIsSavingCustomModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all flex items-center gap-1"
                >
                  <span>💾 Save as Custom Template</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateSelectorBanner;
