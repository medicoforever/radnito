import React, { useState, useRef, useEffect } from 'react';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import SparklesIcon from '../icons/SparklesIcon';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { transcribeAudioForPrompt } from '../../services/geminiService';
import MicIcon from '../icons/MicIcon';
import StopIcon from '../icons/StopIcon';
import Spinner from './Spinner';
import TemplateSelectionModal from './TemplateSelectionModal';
import { REPORT_TEMPLATES, ReportTemplate } from '../../constants';
import ImageIcon from '../icons/ImageIcon';
import CloseIcon from '../icons/CloseIcon';
import TrashIcon from '../icons/TrashIcon';
import { saveCustomTemplate, getAllCustomTemplates, deleteCustomTemplate, CustomTemplate } from '../../services/templateStorage';

const CustomPromptInput: React.FC<{
  prompt: string;
  onPromptChange: (prompt: string) => void;
  className?: string;
  images?: Array<{ data: string; mimeType: string }>;
  onImagesChange?: (images: Array<{ data: string; mimeType: string }>) => void;
  isLiveMode?: boolean;
}> = ({ prompt, onPromptChange, className, images = [], onImagesChange, isLiveMode = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  // Template Management States
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string>('');
  const [templateTextToSave, setTemplateTextToSave] = useState<string>('');
  const [savedTemplates, setSavedTemplates] = useState<CustomTemplate[]>([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSavedTemplatesOpen, setIsSavedTemplatesOpen] = useState<boolean>(true);

  // Load saved custom templates on mount and when opening
  const refreshSavedTemplates = async () => {
    const list = await getAllCustomTemplates();
    setSavedTemplates(list);
  };

  useEffect(() => {
    refreshSavedTemplates();
  }, []);

  const handleMicClick = async () => {
    setTranscriptionError(null);
    if (isRecording) {
      setIsTranscribing(true);
      try {
        const audioBlob = await stopRecording();
        if (audioBlob && audioBlob.size > 0) {
          const transcript = await transcribeAudioForPrompt(audioBlob);
          const newPrompt = prompt ? `${prompt} ${transcript}` : transcript;
          onPromptChange(newPrompt);
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

  const handleSelectTemplate = (template: any) => {
    setActiveTemplateId(template.id || null);
    setActiveTemplateName(template.name || 'Selected Template');
    const textLines = template.lines && Array.isArray(template.lines) && template.lines.length > 0 ? template.lines.join('\n') : '';
    const finalText = textLines || `Use the ${template.name} report template format.`;
    onPromptChange(finalText);
    setTemplateName(template.name);
    setTemplateTextToSave(textLines);
    if (onImagesChange && template.images) {
      onImagesChange(template.images);
    }
    setSaveSuccessMsg(`✓ Selected standard template "${template.name}"`);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
    setIsModalOpen(false);
  };

  const processFiles = (files: FileList | null) => {
    if (files && files.length > 0 && onImagesChange) {
      const newImagesPromises = Array.from(files).map(file => {
        return new Promise<{ data: string; mimeType: string } | null>(resolve => {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (reader.result) {
                const base64data = (reader.result as string).split(',')[1];
                resolve({ data: base64data, mimeType: file.type });
              } else {
                resolve(null);
              }
            };
            reader.readAsDataURL(file);
          } else {
            resolve(null);
          }
        });
      });

      Promise.all(newImagesPromises).then(newImages => {
        const validNewImages = newImages.filter((img): img is { data: string; mimeType: string } => img !== null);
        if (onImagesChange) {
          onImagesChange([...images, ...validNewImages]);
        }
      });
    }
  };

  const handleImageFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(event.target.files);
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    if (onImagesChange) {
      onImagesChange(images.filter((_, index) => index !== indexToRemove));
    }
  };

  const handleSaveCurrentTemplate = async () => {
    if (!templateName.trim()) {
      alert("Please enter a name for your template (e.g., 'Chest CT Standard Format').");
      return;
    }
    const finalTemplateText = templateTextToSave.trim() || prompt.trim();

    if (!finalTemplateText && images.length === 0) {
      alert("Please enter template text or upload at least one screenshot image before saving.");
      return;
    }

    const saved = await saveCustomTemplate(templateName, finalTemplateText, images);
    if (saved) {
      setActiveTemplateId(saved.id);
      setActiveTemplateName(saved.name);
      setSaveSuccessMsg(`✓ Template "${saved.name}" saved permanently in browser and activated!`);
      if (finalTemplateText && !prompt.trim()) {
        onPromptChange(finalTemplateText);
      }
      await refreshSavedTemplates();
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    }
  };

  const handleApplySavedTemplate = (tmpl: CustomTemplate) => {
    setActiveTemplateId(tmpl.id);
    setActiveTemplateName(tmpl.name);
    
    // 1. Apply Text
    const text = tmpl.textContent || '';
    onPromptChange(text);
    setTemplateName(tmpl.name);
    setTemplateTextToSave(text);

    // 2. Apply Images
    const templateImages = tmpl.images || [];
    if (onImagesChange) {
      onImagesChange(templateImages);
    }

    setSaveSuccessMsg(`✓ Loaded and activated template "${tmpl.name}" (${templateImages.length} screenshot(s) attached)`);
    setTimeout(() => setSaveSuccessMsg(null), 5000);
  };

  const handleClearActiveTemplate = () => {
    setActiveTemplateId(null);
    setActiveTemplateName(null);
    onPromptChange('');
    setTemplateName('');
    setTemplateTextToSave('');
    if (onImagesChange) {
      onImagesChange([]);
    }
    setSaveSuccessMsg('Cleared active template and screenshots.');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleDeleteSavedTemplate = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete template "${name}" from browser storage?`)) {
      if (activeTemplateId === id) {
        setActiveTemplateId(null);
        setActiveTemplateName(null);
      }
      await deleteCustomTemplate(id);
      await refreshSavedTemplates();
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (!isLiveMode) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    if (!isLiveMode) {
      processFiles(e.dataTransfer.files);
    }
  };

  const hasActiveTemplate = Boolean(activeTemplateName || prompt.trim() || images.length > 0);

  return (
    <div className={`w-full ${className}`}>
      <TemplateSelectionModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectTemplate={handleSelectTemplate}
      />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-sm"
        aria-expanded={isOpen}
        aria-controls="custom-prompt-container"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <SparklesIcon className="w-5 h-5 text-yellow-500" />
          <span className="font-bold text-slate-700 dark:text-slate-200 text-sm sm:text-base">
            Custom Instructions & Template Manager
          </span>
          {activeTemplateName && (
            <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-xs px-2 py-0.5 rounded-full font-bold border border-emerald-300 dark:border-emerald-700">
              Active: {activeTemplateName}
            </span>
          )}
          {savedTemplates.length > 0 && (
            <span className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full font-semibold">
              {savedTemplates.length} Saved
            </span>
          )}
          {images.length > 0 && (
            <span className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 text-xs px-2 py-0.5 rounded-full font-semibold">
              🖼️ {images.length} Image(s)
            </span>
          )}
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div 
          id="custom-prompt-container" 
          className={`relative mt-2 space-y-4 p-4 border-2 border-dashed rounded-xl transition-colors duration-200 bg-slate-50/50 dark:bg-slate-800/40 ${
            isDraggingOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
              : 'border-slate-200 dark:border-slate-700'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDraggingOver && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-slate-800/90 pointer-events-none rounded-xl">
              <ImageIcon className="w-12 h-12 text-blue-500" />
              <p className="mt-2 text-lg font-semibold text-blue-600 dark:text-blue-400">
                Drop screenshot images here
              </p>
            </div>
          )}

          {/* ACTIVE TEMPLATE STATUS BANNER */}
          {hasActiveTemplate && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 rounded-xl p-3 flex items-center justify-between shadow-sm flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-emerald-800 dark:text-emerald-200 font-bold text-xs sm:text-sm flex items-center gap-1.5">
                  <span>✅ Active Template:</span>
                  <span className="bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100 font-mono">
                    {activeTemplateName || 'Custom Direct Input'}
                  </span>
                </span>
                <span className="text-[11px] bg-emerald-200/80 dark:bg-emerald-800/80 text-emerald-900 dark:text-emerald-100 font-semibold px-2 py-0.5 rounded-full">
                  {images.length > 0 ? `🖼️ ${images.length} Screenshot(s) Loaded` : '📝 Text Only'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearActiveTemplate}
                className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 font-bold px-2.5 py-1 rounded bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 transition-colors"
                title="Clear current active template"
              >
                ✕ Clear Template
              </button>
            </div>
          )}

          {/* SAVED TEMPLATES LIBRARY */}
          {savedTemplates.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800/60 rounded-xl p-3 shadow-sm space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs sm:text-sm font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                  📚 <span>Saved Templates Library ({savedTemplates.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsSavedTemplatesOpen(!isSavedTemplatesOpen)}
                  className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                >
                  {isSavedTemplatesOpen ? 'Hide Library' : 'View Library'}
                </button>
              </div>

              {isSavedTemplatesOpen && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700 max-h-64 overflow-y-auto">
                  {savedTemplates.map((tmpl) => {
                    const isActive = activeTemplateId === tmpl.id || (activeTemplateName === tmpl.name);
                    const firstImage = tmpl.images && tmpl.images.length > 0 ? tmpl.images[0] : null;

                    return (
                      <div
                        key={tmpl.id}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                          isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-600 ring-2 ring-emerald-300 dark:ring-emerald-700 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 hover:border-blue-400'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0 pr-3">
                          {firstImage && (
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 flex-shrink-0 bg-white dark:bg-slate-900">
                              <img
                                src={`data:${firstImage.mimeType};base64,${firstImage.data}`}
                                alt={tmpl.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                                {tmpl.name}
                              </span>
                              {isActive && (
                                <span className="text-[10px] bg-emerald-600 text-white font-bold px-1.5 py-0.2 rounded shadow-xs">
                                  ✓ In Use
                                </span>
                              )}
                              <span className="text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 px-1.5 py-0.5 rounded font-mono">
                                {tmpl.images?.length ? `🖼️ ${tmpl.images.length} Screenshot(s)` : '📝 Text'}
                              </span>
                            </div>
                            {tmpl.textContent && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-md mt-0.5">
                                {tmpl.textContent}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplySavedTemplate(tmpl)}
                            className={`text-xs font-bold px-3.5 py-1.5 rounded-lg shadow transition-all flex items-center gap-1 ${
                              isActive
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-300'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            <span>{isActive ? '✓ Selected' : 'Use Template'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedTemplate(tmpl.id, tmpl.name)}
                            className="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 hover:bg-rose-200 p-1.5 rounded-lg transition-colors"
                            title="Delete saved template"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ACTIVE INSTRUCTIONS / TEMPLATE TEXTAREA */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Active Template Text & Custom Rules:
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Paste your standard report template text or custom rules here (e.g., 'CHEST CT REPORT\nFINDINGS:...')."
                className="w-full p-3 pr-12 border border-slate-300 rounded-xl text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600 dark:placeholder-slate-400"
                rows={4}
                aria-label="Custom instructions and template text"
              />
              <button
                type="button"
                onClick={handleMicClick}
                disabled={isTranscribing}
                className={`absolute bottom-3 right-3 p-2 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isRecording
                    ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
                aria-label={isRecording ? 'Stop dictating' : 'Dictate custom instructions'}
              >
                {isTranscribing ? (
                  <Spinner className="w-5 h-5 text-white" />
                ) : isRecording ? (
                  <StopIcon className="w-5 h-5" />
                ) : (
                  <MicIcon className="w-5 h-5" />
                )}
              </button>
            </div>
            {(recorderError || transcriptionError) && (
              <p className="text-xs text-red-500 mt-1">
                {recorderError || transcriptionError}
              </p>
            )}
          </div>
          
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
            {/* SCREENSHOT EXPLANATION NOTE */}
            <div className="p-3 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <p className="font-bold flex items-center gap-1">
                <span>💡 How to replicate your report template:</span>
              </p>
              <p>
                To replicate any report format, take screenshots of your template and attach them below. You can attach multiple screenshots to cover long reports and save them permanently!
              </p>
            </div>

            {/* SCREENSHOTS ATTACHMENT SECTION */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Attached Template Screenshot(s):
                </span>
                {images.length > 0 && (
                  <span className="text-xs text-slate-500 font-semibold">
                    {images.length} image(s) attached
                  </span>
                )}
              </div>

              {!isLiveMode && (
                <div className="space-y-2">
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-2.5 p-2 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                      {images.map((img, index) => (
                        <div key={index} className="relative w-24 h-24 border-2 border-blue-400 dark:border-blue-600 rounded-xl p-1 bg-white dark:bg-slate-800 shadow-sm group">
                          <img
                            src={`data:${img.mimeType};base64,${img.data}`}
                            alt={`Template screenshot ${index + 1}`}
                            className="object-contain w-full h-full rounded-lg"
                          />
                          <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] font-mono px-1 rounded">
                            #{index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(index)}
                            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1 hover:bg-red-700 shadow-md transition-transform hover:scale-110"
                            aria-label={`Remove image ${index + 1}`}
                          >
                            <CloseIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageFileSelect}
                    className="hidden"
                    accept="image/*"
                    multiple
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-bold py-2 px-3.5 rounded-xl bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <ImageIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Add Screenshot Image(s)
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(true)}
                      className="text-xs font-bold py-2 px-3.5 rounded-xl bg-blue-100 text-blue-900 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 transition-colors shadow-sm"
                    >
                      Select Standard Template...
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* SAVE TEMPLATE PERMANENTLY SECTION */}
            <div className="p-3.5 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/80 rounded-xl space-y-3 shadow-sm">
              <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                💾 <span>Save Current Template Permanently in Browser:</span>
              </span>

              <div className="space-y-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template Name (e.g., 'Chest CT Standard Format')"
                  className="w-full p-2.5 text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-semibold"
                />

                <textarea
                  value={templateTextToSave}
                  onChange={(e) => setTemplateTextToSave(e.target.value)}
                  placeholder="Paste or type template text structure here (Optional if using screenshots, or type custom rules to save alongside screenshots)..."
                  className="w-full p-2.5 text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  rows={3}
                />

                <div className="flex justify-between items-center pt-1 flex-wrap gap-2">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                    {images.length > 0 ? `🖼️ Includes ${images.length} screenshot image(s)` : '📷 Screenshots can be attached above'}
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveCurrentTemplate}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors shadow flex items-center gap-1"
                  >
                    <span>Save Template Permanently</span>
                  </button>
                </div>
              </div>

              {saveSuccessMsg && (
                <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-700 rounded-lg text-xs text-emerald-900 dark:text-emerald-100 font-bold animate-fade-in">
                  {saveSuccessMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomPromptInput;