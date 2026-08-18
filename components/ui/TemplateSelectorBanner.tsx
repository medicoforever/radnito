import React from 'react';
import SparklesIcon from '../icons/SparklesIcon';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import CloseIcon from '../icons/CloseIcon';
import { SelectedTemplateData } from './TemplateSelectionModal';

interface TemplateSelectorBannerProps {
  selectedTemplate: SelectedTemplateData | null;
  onOpenModal: () => void;
  onClearTemplate: () => void;
  autoDownloadDocx: boolean;
  onToggleAutoDownloadDocx: () => void;
}

const TemplateSelectorBanner: React.FC<TemplateSelectorBannerProps> = ({
  selectedTemplate,
  onOpenModal,
  onClearTemplate,
  autoDownloadDocx,
  onToggleAutoDownloadDocx,
}) => {
  return (
    <div className="w-full mb-6 p-4 rounded-2xl bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-purple-50/90 dark:from-slate-800/90 dark:via-indigo-950/30 dark:to-slate-800/90 border border-blue-200/80 dark:border-slate-700/80 shadow-sm backdrop-blur-sm transition-all">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-sm flex-shrink-0">
            <SparklesIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Word (.docx) Report Template
              </span>
              {selectedTemplate && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
                  {selectedTemplate.modality}
                </span>
              )}
            </div>
            {selectedTemplate ? (
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate mt-0.5">
                {selectedTemplate.name}
              </h3>
            ) : (
              <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                No template chosen (Standard dictation mode active)
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
                onChange={onToggleAutoDownloadDocx}
                className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
              />
              <span>Auto-Download .docx</span>
            </label>
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
            <span>{selectedTemplate ? 'Change Template' : '⚡ Choose from 600+ Templates'}</span>
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
    </div>
  );
};

export default TemplateSelectorBanner;
