import React, { useState, useEffect } from 'react';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import SparklesIcon from '../icons/SparklesIcon';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { transcribeAudioForPrompt } from '../../services/geminiService';
import MicIcon from '../icons/MicIcon';
import StopIcon from '../icons/StopIcon';
import Spinner from './Spinner';
import TemplateSelectionModal, { SelectedTemplateData } from './TemplateSelectionModal';
import CloseIcon from '../icons/CloseIcon';
import TrashIcon from '../icons/TrashIcon';
import {
  saveCustomTemplate,
  getAllCustomTemplates,
  deleteCustomTemplate,
  CustomTemplate,
} from '../../services/templateStorage';

export interface StyleToggles {
  telegraphic: boolean;
  boldAbnormalities: boolean;
  radsAutoCompute: boolean;
  compactImpression: boolean;
}

export interface CustomPromptInputProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  className?: string;
  isLiveMode?: boolean;
  styleToggles?: StyleToggles;
  onStyleTogglesChange?: (toggles: StyleToggles) => void;
}

const MAX_CUSTOM_RULES_LENGTH = 5000;

export function sanitizeRuleInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<img[^>]*onerror=[^>]*>/gi, '')
    .replace(/<svg[^>]*onload=[^>]*>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CustomPromptInput: React.FC<CustomPromptInputProps> = ({
  prompt,
  onPromptChange,
  className = '',
  isLiveMode = false,
  styleToggles = {
    telegraphic: true,
    boldAbnormalities: true,
    radsAutoCompute: true,
    compactImpression: true,
  },
  onStyleTogglesChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  // Template Management States
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string>('');
  const [templateTextToSave, setTemplateTextToSave] = useState<string>('');
  const [savedTemplates, setSavedTemplates] = useState<CustomTemplate[]>([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSavedTemplatesOpen, setIsSavedTemplatesOpen] = useState<boolean>(true);

  // Local style toggles state
  const [localToggles, setLocalToggles] = useState<StyleToggles>(styleToggles);

  // Load saved custom templates on mount
  const refreshSavedTemplates = async () => {
    const list = await getAllCustomTemplates();
    setSavedTemplates(list);
  };

  useEffect(() => {
    refreshSavedTemplates();
  }, []);

  useEffect(() => {
    setLocalToggles(styleToggles);
  }, [styleToggles]);

  const handleToggleChange = (key: keyof StyleToggles) => {
    const updated = {
      ...localToggles,
      [key]: !localToggles[key],
    };
    setLocalToggles(updated);
    if (onStyleTogglesChange) {
      onStyleTogglesChange(updated);
    }
  };

  const handleMicClick = async () => {
    setTranscriptionError(null);
    if (isRecording) {
      setIsTranscribing(true);
      try {
        const audioBlob = await stopRecording();
        if (audioBlob && audioBlob.size > 0) {
          const transcript = await transcribeAudioForPrompt(audioBlob);
          const newPrompt = prompt ? `${prompt} ${transcript}` : transcript;
          onPromptChange(newPrompt.slice(0, MAX_CUSTOM_RULES_LENGTH));
        }
      } catch (err) {
        setTranscriptionError(err instanceof Error ? err.message : 'An unknown error occurred during transcription.');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      await startRecording();
    }
  };

  const handleSelectTemplate = (template: SelectedTemplateData | any) => {
    setActiveTemplateId(template.id || null);
    setActiveTemplateName(template.name || 'Selected Template');
    const textLines = template.lines && Array.isArray(template.lines) && template.lines.length > 0 ? template.lines.join('\n') : '';
    const finalText = textLines || `Use the ${template.name} report template format.`;
    onPromptChange(finalText.slice(0, MAX_CUSTOM_RULES_LENGTH));
    setTemplateName(template.name);
    setTemplateTextToSave(textLines);
    setSaveSuccessMsg(`✓ Selected template "${template.name}"`);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
    setIsModalOpen(false);
  };

  const handleSaveCurrentTemplate = async () => {
    if (!templateName.trim()) {
      setSaveSuccessMsg('⚠️ Please provide a name for this template before saving.');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      return;
    }

    const textToStore = templateTextToSave.trim() || prompt.trim();
    if (!textToStore) {
      setSaveSuccessMsg('⚠️ Please enter template text or rules to save.');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      return;
    }

    try {
      const saved = await saveCustomTemplate(
        templateName.trim(),
        textToStore,
        [],
        undefined,
        'Custom'
      );

      if (saved) {
        await refreshSavedTemplates();
        setActiveTemplateId(saved.id);
        setActiveTemplateName(saved.name);
        setSaveSuccessMsg(`✓ Saved custom template "${saved.name}"!`);
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err) {
      setSaveSuccessMsg('⚠️ Failed to save template to browser storage.');
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    }
  };

  const handleDeleteSavedTemplate = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}" from your saved templates?`)) {
      await deleteCustomTemplate(id);
      await refreshSavedTemplates();
      if (activeTemplateId === id) {
        setActiveTemplateId(null);
        setActiveTemplateName(null);
      }
    }
  };

  const handleApplySavedTemplate = (tmpl: CustomTemplate) => {
    setActiveTemplateId(tmpl.id);
    setActiveTemplateName(tmpl.name);
    const content = tmpl.textContent || tmpl.text || '';
    if (content) {
      onPromptChange(content.slice(0, MAX_CUSTOM_RULES_LENGTH));
    }
    setSaveSuccessMsg(`✓ Applied template "${tmpl.name}"`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Template Selection Modal */}
      <TemplateSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectTemplate={handleSelectTemplate}
        selectedTemplateId={activeTemplateId}
        customTemplates={savedTemplates as any}
        onRefreshCustomTemplates={refreshSavedTemplates}
      />

      {/* Main Header / Trigger Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden transition-all">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <SparklesIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Report Template & Style Rules
                </h3>
                {activeTemplateName && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300">
                    {activeTemplateName}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {prompt ? `${prompt.length} chars active` : 'Select from 72 standard CT/MRI templates or upload custom DOCX'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsModalOpen(true);
              }}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
            >
              Select Template (72 KBs)...
            </button>
            <ChevronDownIcon
              className={`w-5 h-5 text-slate-400 transition-transform ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </div>

        {/* Collapsible Content */}
        {isOpen && (
          <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 space-y-4 animate-fade-in">
            {/* Style Toggles Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                { key: 'boldAbnormalities' as const, label: 'Bold Abnormalities', desc: 'Prefix with BOLD::' },
                { key: 'radsAutoCompute' as const, label: 'Standard RADS', desc: 'BI/PI/TI/Lung-RADS' },
                { key: 'telegraphic' as const, label: 'Concise Tone', desc: 'Consultant shorthand' },
                { key: 'compactImpression' as const, label: 'Numbered Impression', desc: 'Prioritized hierarchy' },
              ].map(item => (
                <label
                  key={item.key}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    localToggles[item.key]
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={localToggles[item.key]}
                    onChange={() => handleToggleChange(item.key)}
                    className="w-3.5 h-3.5 mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[10px] text-slate-400">{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {/* Custom Rules Textarea */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Active Instructions / Custom Rules:
                </label>
                <span className="text-[10px] text-slate-400">
                  {prompt.length} / {MAX_CUSTOM_RULES_LENGTH} chars
                </span>
              </div>
              <div className="relative">
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={e => onPromptChange(e.target.value.slice(0, MAX_CUSTOM_RULES_LENGTH))}
                  placeholder="Type or paste custom reporting instructions, terminology rules, or template text..."
                  className="w-full p-3 pr-12 text-xs font-mono border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={isTranscribing}
                  className={`absolute bottom-3 right-3 p-2 rounded-full text-white transition-colors disabled:opacity-50 ${
                    isRecording ? 'bg-red-600 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  title={isRecording ? 'Stop Recording' : 'Dictate instructions'}
                >
                  {isTranscribing ? (
                    <Spinner className="w-4 h-4 text-white" />
                  ) : isRecording ? (
                    <StopIcon className="w-4 h-4" />
                  ) : (
                    <MicIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
              {(recorderError || transcriptionError) && (
                <p className="text-xs text-red-500 mt-1">{recorderError || transcriptionError}</p>
              )}
            </div>

            {/* Permanent Save in Browser Box */}
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl space-y-2.5">
              <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                💾 Save as Permanent Custom Template:
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="Template Name (e.g., 'Spine MRI - My Format')"
                  className="flex-1 p-2 text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-semibold"
                />
                <button
                  type="button"
                  onClick={handleSaveCurrentTemplate}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow transition-all whitespace-nowrap"
                >
                  Save Template
                </button>
              </div>
              {saveSuccessMsg && (
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 animate-fade-in">
                  {saveSuccessMsg}
                </div>
              )}
            </div>

            {/* Saved Custom Templates List */}
            {savedTemplates.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Your Saved Custom Templates ({savedTemplates.length}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {savedTemplates.map(tmpl => {
                    const isActive = activeTemplateId === tmpl.id;
                    return (
                      <div
                        key={tmpl.id}
                        className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                          isActive
                            ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <h5 className="font-bold text-slate-900 dark:text-white truncate">
                            {tmpl.name}
                          </h5>
                          <p className="text-[10px] text-slate-400 truncate">
                            {tmpl.textContent || tmpl.text || 'DOCX Template'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleApplySavedTemplate(tmpl)}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                              isActive
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {isActive ? 'Active' : 'Use'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedTemplate(tmpl.id, tmpl.name)}
                            className="p-1 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950 rounded"
                            title="Delete"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomPromptInput;
