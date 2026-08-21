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
import { mergeFindingsWithTemplate, modifyReportWithText, modifyReportWithAudio } from '../services/geminiService';
import { mergeFindingsIntoDocx, downloadDocxBlob } from '../services/docxService';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { getUserTemplates, UserTemplate } from '../services/templateStorage';

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

  // Sync prop changes
  useEffect(() => {
    if (selectedTemplateProp) {
      setActiveTemplate(selectedTemplateProp);
    } else if (initialTemplate && !activeTemplate) {
      setActiveTemplate(initialTemplate);
    }
  }, [selectedTemplateProp, initialTemplate]);

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
      const result = await mergeFindingsWithTemplate(
        findingsInput.trim(),
        activeTemplate,
        selectedModel,
        customNotes.trim() || undefined
      );

      setMergedFindings(result);

      if (autoDownloadDocx && result.length > 0) {
        try {
          const title = activeTemplate.name || result[0] || 'Radiology_Report';
          const cleanFileName = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`;
          const blob = await mergeFindingsIntoDocx(activeTemplate.docxBase64, result, title);
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
      setModificationError(err?.message || 'Failed to apply change.');
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

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-6 rounded-2xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-[11px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Direct Merge Mode
            </span>
            <span className="text-xs text-blue-200">104 Clean CT & MRI Formats</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            Merge Findings into Report Template
          </h2>
          <p className="text-xs sm:text-sm text-blue-100 max-w-xl">
            Have your findings as text? Select your preferred CT, MRI A, or MRI B template and let AI seamlessly slot findings into the standard report structure with automatic Word (.docx) export.
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
          </div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
            {activeTemplate ? activeTemplate.name : 'No Template Selected (Click to Choose)'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {activeTemplate
              ? `${activeTemplate.lines?.length || 0} standard normal sections • Times New Roman 12pt format`
              : 'Please choose a CT, MRI A, MRI B, or custom template to merge your findings.'}
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

          {/* Optional Instructions */}
          <div>
            <label
              htmlFor="merge-custom-notes"
              className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block"
            >
              Optional Custom Instructions for AI (e.g. 'Keep impression under 2 lines', 'Add patient age 45M'):
            </label>
            <input
              id="merge-custom-notes"
              type="text"
              value={customNotes}
              onChange={e => setCustomNotes(e.target.value)}
              placeholder="e.g. Clinical indication: headache and hypertension..."
              className="w-full p-2.5 text-xs sm:text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold rounded-xl">
              ⚠️ {error}
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
        /* Results Screen */
        <div className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl space-y-5">
          {/* Top Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
            <div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                ✓ Report Successfully Merged & Standardized
              </span>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
                {activeTemplate?.name || 'Standardized Radiology Report'}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyAll}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs transition-all flex items-center gap-1.5 shadow-sm"
              >
                <CopyIcon className="w-4 h-4" />
                <span>{isCopied ? '✓ Copied!' : 'Copy All'}</span>
              </button>

              <button
                onClick={handleDownloadDocx}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
              >
                <DownloadIcon className="w-4 h-4" />
                <span>Download Word (.docx)</span>
              </button>

              <button
                onClick={() => {
                  setMergedFindings(null);
                  setFindingsInput('');
                }}
                className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all"
                title="Start another merge"
              >
                New Merge
              </button>
            </div>
          </div>

          {/* Findings Display List */}
          <div className="space-y-2 font-sans text-xs sm:text-sm">
            {mergedFindings.map((finding, idx) => {
              const clean = finding.replace(/^BOLD::/g, '').trim();
              const isBold = finding.startsWith('BOLD::');
              const isTitle = idx === 0 && (clean.toUpperCase().includes('SCAN') || clean.toUpperCase().includes('MRI') || clean.toUpperCase().includes('C.T.') || clean.toUpperCase().includes('REPORT'));
              const isImpression = clean.startsWith('IMPRESSION:');
              const isProfile = clean.startsWith('*Clinical Profile:') || clean.startsWith('*') && clean.endsWith('*');

              if (editingIndex === idx) {
                return (
                  <div key={idx} className="p-3 bg-blue-50 dark:bg-slate-900 border border-blue-400 rounded-xl space-y-2">
                    <textarea
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      rows={3}
                      className="w-full p-2 text-xs border rounded-lg dark:bg-slate-800 dark:text-white"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="px-3 py-1 text-xs font-semibold rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveEdit(idx)}
                        className="px-3 py-1 text-xs font-bold rounded bg-blue-600 text-white"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              }

              if (isImpression) {
                const parts = clean.split('###').map(p => p.trim()).filter(Boolean);
                return (
                  <div key={idx} className="group relative p-3 bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500 rounded-r-xl space-y-1">
                    <h4 className="font-black text-amber-950 dark:text-amber-200 underline uppercase tracking-wide">
                      {parts[0]}
                    </h4>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-900 dark:text-amber-300 font-bold pl-2">
                      {parts.slice(1).map((pt, pIdx) => (
                        <li key={pIdx}>{pt}</li>
                      ))}
                    </ul>
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <button
                        onClick={() => { setEditingIndex(idx); setEditingText(finding); }}
                        className="p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-300"
                        title="Edit impression"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={`group relative p-2.5 rounded-xl border transition-all ${
                    isTitle
                      ? 'bg-blue-100/60 dark:bg-blue-900/30 border-blue-300 dark:border-blue-800 font-black text-center text-blue-950 dark:text-blue-200'
                      : isProfile
                      ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 italic text-purple-900 dark:text-purple-300'
                      : isBold
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-l-4 border-blue-600 dark:border-blue-500 font-bold text-slate-900 dark:text-white'
                      : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <p className="leading-relaxed pr-12">{clean}</p>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      onClick={() => { setEditingIndex(idx); setEditingText(finding); }}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400"
                      title="Edit this line"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteRow(idx)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
                      title="Delete this line"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dictate / Type Report Changes in Results */}
          <div className="p-4 border rounded-xl bg-slate-50 dark:bg-slate-800/80 dark:border-slate-700 shadow-sm space-y-3">
            <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
              <MicScribbleIcon className="w-7 h-7 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="flex-grow">
                <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                  Refine Merged Report (Voice or Typed Changes)
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dictate or type any modifications to update this report instantly.
                </p>
              </div>
              <div className="sm:ml-4 flex-shrink-0">
                {modificationState === 'idle' && (
                  <button
                    onClick={handleStartVoiceModification}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center gap-1"
                  >
                    <MicIcon className="w-3.5 h-3.5" />
                    <span>Dictate Changes</span>
                  </button>
                )}
                {modificationState === 'recording' && (
                  <div className="flex items-center gap-2 bg-red-100 dark:bg-red-900/30 px-3 py-1 rounded-xl">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                    <span className="text-xs font-bold text-red-700 dark:text-red-300">Listening...</span>
                    <button
                      onClick={handleStopVoiceModification}
                      className="px-2 py-0.5 bg-red-600 text-white rounded font-bold text-xs"
                    >
                      Stop
                    </button>
                  </div>
                )}
                {modificationState === 'processing' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 font-bold">
                    <Spinner className="w-3.5 h-3.5" />
                    <span>Applying...</span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <input
                type="text"
                value={modificationText}
                onChange={e => setModificationText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && modificationText.trim() && modificationState !== 'processing') {
                    e.preventDefault();
                    handleApplyTextModification();
                  }
                }}
                placeholder="Or type changes here (e.g. 'remove measurements', 'add follow-up in 3 months')..."
                className="flex-1 p-2 text-xs border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              <button
                onClick={handleApplyTextModification}
                disabled={!modificationText.trim() || modificationState === 'processing'}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1"
              >
                <SendIcon className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
            {modificationError && (
              <p className="text-red-500 text-xs font-semibold">{modificationError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MergeTemplateProcessor;
