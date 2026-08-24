import React, { useState, useEffect } from 'react';
import Spinner from './ui/Spinner';
import SparklesIcon from './icons/SparklesIcon';
import CopyIcon from './icons/CopyIcon';
import DownloadIcon from './icons/DownloadIcon';
import TrashIcon from './icons/TrashIcon';
import PencilIcon from './icons/PencilIcon';
import MicIcon from './icons/MicIcon';
import StopIcon from './icons/StopIcon';
import SendIcon from './icons/SendIcon';
import MicScribbleIcon from './icons/MicScribbleIcon';
import TemplateSelectionModal, { SelectedTemplateData } from './ui/TemplateSelectionModal';
import CustomPromptInput from './ui/CustomPromptInput';
import { mergeFindingsWithTemplate, mergeFindingsWithAst, modifyReportWithText, modifyReportWithAudio } from '../services/geminiService';
import { mergeFindingsIntoDocx, downloadDocxBlob } from '../services/docxService';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  getUserTemplates,
  UserTemplate,
  saveUserTemplate,
  isTemplateSkillEnabled,
  setTemplateSkillEnabled,
  getTemplateCustomPrompt,
  setTemplateCustomPrompt,
  resetTemplateCustomPrompt,
} from '../services/templateStorage';

interface MergeTemplateProcessorProps {
  selectedModel: string;
  initialTemplate?: SelectedTemplateData | null;
  selectedTemplate?: SelectedTemplateData | null;
  onOpenTemplateModal?: () => void;
  onSelectTemplate?: (tmpl: SelectedTemplateData) => void;
  onBack?: () => void;
}

export const MergeTemplateProcessor: React.FC<MergeTemplateProcessorProps> = ({
  selectedModel,
  initialTemplate,
  selectedTemplate: selectedTemplateProp,
  onOpenTemplateModal,
  onSelectTemplate,
  onBack,
}) => {
  const [activeTemplate, setActiveTemplate] = useState<SelectedTemplateData | null>(
    selectedTemplateProp || initialTemplate || null
  );
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
  const [customTemplates, setCustomTemplates] = useState<UserTemplate[]>([]);

  const [findingsInput, setFindingsInput] = useState<string>('');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [mergedFindings, setMergedFindings] = useState<string[] | null>(null);
  const [autoDownloadDocx, setAutoDownloadDocx] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Skill System States
  const [isSkillEnabled, setIsSkillEnabled] = useState<boolean>(() => isTemplateSkillEnabled());
  const [isSkillExpanded, setIsSkillExpanded] = useState<boolean>(true);
  const [customSkillPrompt, setCustomSkillPrompt] = useState<string>('');
  const [skillNotice, setSkillNotice] = useState<string | null>(null);
  const [isSavingCustomModalOpen, setIsSavingCustomModalOpen] = useState<boolean>(false);
  const [customTemplateSaveName, setCustomTemplateSaveName] = useState<string>('');

  // Sync prop changes
  useEffect(() => {
    if (selectedTemplateProp) {
      setActiveTemplate(selectedTemplateProp);
    } else if (initialTemplate && !activeTemplate) {
      setActiveTemplate(initialTemplate);
    }
  }, [selectedTemplateProp, initialTemplate]);

  // Sync active template skill prompt
  useEffect(() => {
    if (activeTemplate?.id) {
      const storedOverride = getTemplateCustomPrompt(activeTemplate.id);
      setCustomSkillPrompt(storedOverride || activeTemplate.skillPrompt || '');
      setCustomTemplateSaveName(`${activeTemplate.name} (Custom Skill)`);
    } else {
      setCustomSkillPrompt('');
    }
  }, [activeTemplate?.id, activeTemplate?.skillPrompt]);

  // Load custom templates
  useEffect(() => {
    getUserTemplates().then(list => setCustomTemplates(list)).catch(() => {});
  }, []);

  const refreshCustomTemplates = async () => {
    try {
      const list = await getUserTemplates();
      setCustomTemplates(list);
    } catch {}
  };

  const handleOpenModal = () => {
    if (onOpenTemplateModal) {
      onOpenTemplateModal();
    }
    setIsTemplateModalOpen(true);
  };

  const handleTemplateChosen = (tmpl: SelectedTemplateData) => {
    setActiveTemplate(tmpl);
    if (onSelectTemplate) {
      onSelectTemplate(tmpl);
    }
    setIsTemplateModalOpen(false);
    setError(null);
  };

  const handleToggleSkill = (enabled: boolean) => {
    setIsSkillEnabled(enabled);
    setTemplateSkillEnabled(enabled);
  };

  const handleResetSkillToDefault = () => {
    if (!activeTemplate?.id) return;
    resetTemplateCustomPrompt(activeTemplate.id);
    setCustomSkillPrompt(activeTemplate.skillPrompt || '');
    setSkillNotice('Reset to archive default consultant directives.');
    setTimeout(() => setSkillNotice(null), 3000);
  };

  const handleSaveAsCustomTemplate = async () => {
    if (!activeTemplate) return;
    const saveName = customTemplateSaveName.trim() || `${activeTemplate.name} (Custom)`;
    try {
      const newCustom: UserTemplate = {
        id: `custom_skill_${Date.now()}`,
        name: saveName,
        text: activeTemplate.lines?.join('\n') || activeTemplate.name,
        images: [],
        createdAt: Date.now(),
        customRules: customSkillPrompt.trim() || undefined,
        ...({ docxBase64: activeTemplate.docxBase64, modality: activeTemplate.modality || activeTemplate.category } as any),
      };

      await saveUserTemplate(newCustom);
      await refreshCustomTemplates();

      const newActive: SelectedTemplateData = {
        id: newCustom.id,
        name: newCustom.name,
        category: 'My Uploaded Templates',
        modality: (newCustom as any).modality || activeTemplate.modality,
        lines: activeTemplate.lines || [],
        docxBase64: activeTemplate.docxBase64,
        isCustom: true,
        skillPrompt: customSkillPrompt.trim() || undefined,
      };

      setActiveTemplate(newActive);
      setIsSavingCustomModalOpen(false);
      setSkillNotice(`✓ Saved as custom template "${saveName}" in your library!`);
      setTimeout(() => setSkillNotice(null), 4000);
    } catch (err: any) {
      setSkillNotice(`Failed to save template: ${err.message || err}`);
    }
  };

  // Edit / Refine state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [modificationText, setModificationText] = useState<string>('');
  const [modificationState, setModificationState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [modificationError, setModificationError] = useState<string | null>(null);
  const modificationRecorder = useAudioRecorder();

  const handleMerge = async () => {
    if (!activeTemplate) {
      setError('Please select a report template first.');
      setIsTemplateModalOpen(true);
      return;
    }
    if (!findingsInput.trim()) {
      setError('Please enter or paste your radiology findings.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const { findings: result, docxBlob } = await mergeFindingsWithAst(
        findingsInput.trim(),
        activeTemplate,
        selectedModel,
        customNotes.trim() || undefined,
        null,
        isSkillEnabled,
        customSkillPrompt.trim() || undefined
      );

      setMergedFindings(result);

      if (autoDownloadDocx && result.length > 0) {
        try {
          const title = activeTemplate.name || result[0] || 'Radiology_Report';
          const cleanFileName = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`;
          const blob = docxBlob || await mergeFindingsIntoDocx(activeTemplate.docxBase64, result, title);
          downloadDocxBlob(blob, cleanFileName);
          setDownloadSuccess(`Auto-downloaded "${cleanFileName}"`);
          setTimeout(() => setDownloadSuccess(null), 4000);
        } catch (docxErr) {
          console.warn('Auto DOCX download failed:', docxErr);
        }
      }
    } catch (err: any) {
      console.error('Merge error:', err);
      setError(err?.message || 'Failed to merge findings into template.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadDocx = async () => {
    if (!mergedFindings || mergedFindings.length === 0) return;
    try {
      const title = activeTemplate?.name || mergedFindings[0] || 'Radiology_Report';
      const cleanFileName = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`;
      const blob = await mergeFindingsIntoDocx(activeTemplate?.docxBase64, mergedFindings, title);
      downloadDocxBlob(blob, cleanFileName);
      setDownloadSuccess(`Downloaded "${cleanFileName}"`);
      setTimeout(() => setDownloadSuccess(null), 4000);
    } catch (err: any) {
      setError('Failed to download Word document.');
    }
  };

  const handleCopyAll = async () => {
    if (!mergedFindings || mergedFindings.length === 0) return;
    const text = mergedFindings
      .map(f => {
        const clean = f.replace(/BOLD::/g, '');
        if (clean.startsWith('IMPRESSION:')) {
          const parts = clean.split('###').map(p => p.trim()).filter(Boolean);
          return `${parts[0]}\n${parts.slice(1).map(p => `• ${p}`).join('\n')}`;
        }
        return clean;
      })
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (e) {
      console.error('Clipboard copy failed:', e);
    }
  };

  const handleApplyTextModification = async () => {
    if (!modificationText.trim() || !mergedFindings) return;
    setModificationState('processing');
    setModificationError(null);
    try {
      const updated = await modifyReportWithText(
        mergedFindings,
        modificationText.trim(),
        selectedModel,
        customNotes
      );
      setMergedFindings(updated);
      setModificationText('');
      setModificationState('idle');
    } catch (err: any) {
      setModificationError(err?.message || 'Failed to apply text change.');
      setModificationState('idle');
    }
  };

  const handleStartVoiceModification = async () => {
    setModificationError(null);
    try {
      await modificationRecorder.startRecording();
      setModificationState('recording');
    } catch (e: any) {
      setModificationError('Microphone access denied or unavailable.');
    }
  };

  const handleStopVoiceModification = async () => {
    const audioBlob = await modificationRecorder.stopRecording();
    if (audioBlob && audioBlob.size > 0 && mergedFindings) {
      setModificationState('processing');
      try {
        const updated = await modifyReportWithAudio(
          mergedFindings,
          audioBlob,
          selectedModel,
          customNotes
        );
        setMergedFindings(updated);
        setModificationState('idle');
      } catch (err: any) {
        setModificationError(err?.message || 'Failed to apply audio change.');
        setModificationState('idle');
      }
    } else {
      setModificationState('idle');
    }
  };

  const handleSaveEdit = (idx: number) => {
    if (!mergedFindings) return;
    const updated = [...mergedFindings];
    updated[idx] = editingText;
    setMergedFindings(updated);
    setEditingIndex(null);
  };

  const handleDeleteRow = (idx: number) => {
    if (!mergedFindings) return;
    setMergedFindings(mergedFindings.filter((_, i) => i !== idx));
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Template Selection Modal */}
      <TemplateSelectionModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={handleTemplateChosen}
        selectedTemplateId={activeTemplate?.id}
        customTemplates={customTemplates}
        onRefreshCustomTemplates={refreshCustomTemplates}
      />

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

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-6 rounded-2xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-[11px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Direct Merge Mode
            </span>
            <span className="text-xs text-blue-200">72 Curated CT & MRI Formats with Consultant Skills</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Merge Findings into Report Template
          </h2>
          <p className="text-xs sm:text-sm text-blue-100 max-w-xl">
            Select any standard CT/MRI template or your custom DOCX. The AI applies specialized consultant directives, translates vague dictation, and generates your Word report.
          </p>
        </div>

        {onBack && (
          <button
            onClick={onBack}
            className="text-xs font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3.5 py-2 rounded-xl transition-all"
          >
            &larr; Back to Workspace
          </button>
        )}
      </div>

      {/* Selected Template Card */}
      <div 
        onClick={handleOpenModal}
        className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition-all"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              Active Template:
            </span>
            {activeTemplate && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                {activeTemplate.category || activeTemplate.modality}
              </span>
            )}
            {activeTemplate?.skillPrompt && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                ⚡ Consultant Skill Attached
              </span>
            )}
          </div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
            {activeTemplate ? activeTemplate.name : 'No Template Selected (Click to Choose)'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {activeTemplate
              ? `${activeTemplate.lines?.length || 0} standard normal sections • Native DOCX format`
              : 'Please choose a CT, MRI, or custom DOCX template to merge your findings.'}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenModal();
          }}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5 flex-shrink-0"
        >
          <SparklesIcon className="w-4 h-4" />
          <span>{activeTemplate ? 'Change Template' : 'Select Template'}</span>
        </button>
      </div>

      {/* DEDICATED CONSULTANT SKILL VIEWER & INLINE CUSTOMIZER */}
      {activeTemplate && (
        <div className="bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
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
                    {isSkillEnabled ? 'Zero-Filler • AST Replacement • Archive-Derived' : 'Standard Baseline'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isSkillEnabled
                    ? 'Applies specialized consultant directives, vague dictation translation, and RADS scoring for this template.'
                    : 'Standard template merge without specialized consultant skill prompt.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsSkillExpanded(!isSkillExpanded)}
              className="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>{isSkillExpanded ? '▲ Hide Skill Prompt' : '⚙️ View / Edit Skill Prompt'}</span>
            </button>
          </div>

          {/* In-Line Skill Prompt Editor */}
          {isSkillExpanded && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Active Consultant Directives for <span className="text-blue-600 dark:text-blue-400">{activeTemplate.name}</span>:
                </span>
                {skillNotice && (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-pulse">
                    {skillNotice}
                  </span>
                )}
              </div>

              <textarea
                rows={7}
                value={customSkillPrompt}
                onChange={e => setCustomSkillPrompt(e.target.value)}
                placeholder="Enter or modify consultant instructions, line replacements, and scoring rules for this template..."
                className="w-full p-3 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none leading-relaxed"
              />

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs pt-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  💡 <em>Changes here apply immediately to your current dictation session.</em>
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
          )}
        </div>
      )}

      {downloadSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 font-bold flex items-center gap-2 animate-fade-in">
          <span>✓</span>
          <span>{downloadSuccess}</span>
        </div>
      )}

      {/* Main Input or Results Section */}
      {!mergedFindings ? (
        <div className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label
                htmlFor="merge-findings-input"
                className="text-sm font-bold text-slate-800 dark:text-slate-200"
              >
                Paste or Type Your Findings / Clinical Notes:
              </label>
              <span className="text-xs text-slate-400">
                Type raw notes, voice transcript, or bullet points
              </span>
            </div>
            <textarea
              id="merge-findings-input"
              rows={8}
              value={findingsInput}
              onChange={e => setFindingsInput(e.target.value)}
              placeholder="e.g. Brain: Normal ventricles and sulci. Small acute lacunar infarct in left internal capsule posterior limb showing diffusion restriction. No acute intracranial hemorrhage or midline shift. Impression: Acute lacunar infarct in left internal capsule."
              className="w-full p-3.5 text-xs sm:text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none font-sans leading-relaxed"
            />
          </div>

          {/* Quick Presets / Shortcuts */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-slate-400 dark:text-slate-500">Quick Text:</span>
            {[
              { label: 'Normal Study', text: 'Scan is completely normal. No acute focal abnormality.' },
              { label: 'Mild Spondylosis', text: 'Spine: Mild degenerative disc dessication with minor diffuse bulge. No significant canal or neural foraminal stenosis.' },
              { label: 'Acute Infarct', text: 'Brain: Acute non-hemorrhagic infarct with diffusion restriction. No mass effect or midline shift.' },
              { label: 'Sinusitis', text: 'PNS: Mucosal thickening noted in bilateral maxillary sinuses. Normal ostiomeatal complexes.' },
            ].map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setFindingsInput(prev => prev ? `${prev}\n${preset.text}` : preset.text)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 font-semibold transition-colors"
              >
                + {preset.label}
              </button>
            ))}
          </div>

          {/* Global Custom Instructions & Doctor Preferences */}
          <div className="pt-2">
            <CustomPromptInput
              prompt={customNotes}
              onPromptChange={setCustomNotes}
            />
          </div>

          {/* Auto Download DOCX Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={autoDownloadDocx}
                onChange={e => setAutoDownloadDocx(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span>Auto-download Word (.docx) report upon generation</span>
            </label>

            <span className="text-[11px] text-slate-400">
              Times New Roman 12pt • High-Fidelity
            </span>
          </div>

          {error && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <span>⚠️ {error}</span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                  Your findings are preserved. You can click Try Again or pick a different model to retry.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={isProcessing}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shadow transition-all whitespace-nowrap"
                >
                  ↻ Try Again
                </button>
              </div>
            </div>
          )}

          <button
            onClick={handleMerge}
            disabled={isProcessing || !findingsInput.trim()}
            className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-sm sm:text-base shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Spinner className="w-5 h-5 text-white" />
                <span>Integrating findings into {activeTemplate?.name || 'template'}...</span>
              </>
            ) : (
              <>
                <SparklesIcon className="w-5 h-5" />
                <span>Merge Findings into Template & Generate DOCX</span>
              </>
            )}
          </button>
        </div>
      ) : (
        /* Results Section */
        <div className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-700">
            <div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                ✓ Report Generated Successfully
              </span>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {activeTemplate?.name || 'Radiology Report'}
              </h3>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleCopyAll}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              >
                <CopyIcon className="w-4 h-4" />
                <span>{isCopied ? 'Copied!' : 'Copy Report'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadDocx}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md"
              >
                <DownloadIcon className="w-4 h-4" />
                <span>Download Word (.docx)</span>
              </button>
              <button
                type="button"
                onClick={() => setMergedFindings(null)}
                className="px-3.5 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all"
              >
                New Dictation
              </button>
            </div>
          </div>

          {/* Render Findings */}
          <div className="space-y-2 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 font-sans text-xs sm:text-sm">
            {mergedFindings.map((line, idx) => {
              const isBold = line.startsWith('BOLD::');
              const clean = line.replace('BOLD::', '');
              const isImpression = clean.startsWith('IMPRESSION:');

              if (isImpression) {
                const parts = clean.split('###').map(p => p.trim()).filter(Boolean);
                return (
                  <div key={idx} className="p-3 bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-500 rounded-r-lg font-bold text-amber-950 dark:text-amber-200 mt-4 space-y-1">
                    <div className="text-xs uppercase tracking-wider">{parts[0]}</div>
                    <ul className="list-disc list-inside space-y-0.5 text-xs font-normal">
                      {parts.slice(1).map((p, pIdx) => (
                        <li key={pIdx} className="font-semibold">{p}</li>
                      ))}
                    </ul>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`p-2 rounded-lg transition-all flex justify-between items-start gap-2 ${
                    isBold
                      ? 'bg-blue-50 dark:bg-blue-950/50 border-l-4 border-blue-600 font-bold text-slate-900 dark:text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700/60'
                  }`}
                >
                  {editingIndex === idx ? (
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        className="flex-1 p-1 text-xs border border-blue-400 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(idx)}
                        className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-bold"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <span className="flex-1 leading-relaxed">{clean}</span>
                  )}
                  <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIndex(idx);
                        setEditingText(clean);
                      }}
                      className="p-1 text-slate-400 hover:text-blue-600"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(idx)}
                      className="p-1 text-slate-400 hover:text-red-600"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Modification by voice or text */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Refine or Correct this Report (Voice or Text):
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={modificationText}
                onChange={e => setModificationText(e.target.value)}
                placeholder="e.g. 'Change right MCA to left MCA' or 'Add mild sinus disease'..."
                className="flex-1 p-2.5 text-xs border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleApplyTextModification}
                disabled={modificationState === 'processing' || !modificationText.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow transition-all flex items-center gap-1"
              >
                {modificationState === 'processing' ? <Spinner className="w-4 h-4" /> : <SendIcon className="w-4 h-4" />}
                <span>Apply</span>
              </button>
              <button
                type="button"
                onClick={modificationState === 'recording' ? handleStopVoiceModification : handleStartVoiceModification}
                className={`p-2.5 rounded-xl text-white font-bold transition-all shadow ${
                  modificationState === 'recording' ? 'bg-red-600 animate-pulse' : 'bg-slate-700 hover:bg-slate-800'
                }`}
                title={modificationState === 'recording' ? 'Stop Recording' : 'Voice Modification'}
              >
                {modificationState === 'recording' ? <StopIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
              </button>
            </div>
            {modificationError && (
              <p className="text-xs text-red-500 font-semibold">{modificationError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MergeTemplateProcessor;
