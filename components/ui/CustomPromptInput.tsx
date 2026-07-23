import React, { useState, useRef } from 'react';
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

  const handleSelectTemplate = (template: ReportTemplate) => {
    onPromptChange(`Use the normal ${template.name} report template. Integrate my dictation and generate a new impression.`);
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
      e.preventDefault(); // Necessary to allow drop
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

  return (
    <div className={`w-full ${className}`}>
      <TemplateSelectionModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        templates={REPORT_TEMPLATES}
        onSelectTemplate={handleSelectTemplate}
      />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-2 rounded-md bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        aria-expanded={isOpen}
        aria-controls="custom-prompt-container"
      >
        <div className="flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-yellow-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">Custom Instructions</span>
        </div>
        <ChevronDownIcon className={`w-6 h-6 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div 
            id="custom-prompt-container" 
            className={`relative mt-2 space-y-3 p-3 border-2 border-dashed rounded-lg transition-colors duration-200 ${
                isDraggingOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                : 'border-transparent'
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {isDraggingOver && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-slate-800/90 pointer-events-none rounded-lg">
                    <ImageIcon className="w-12 h-12 text-blue-500" />
                    <p className="mt-2 text-lg font-semibold text-blue-600 dark:text-blue-400">
                        Drop images here
                    </p>
                </div>
            )}
          <div>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="e.g., 'Always use metric units.' or 'Format findings for a chest CT report.'"
                className="w-full p-2 pr-12 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600 dark:placeholder-slate-400"
                rows={3}
                aria-label="Custom instructions for the AI model"
              />
              <button
                onClick={handleMicClick}
                disabled={isTranscribing}
                className={`absolute bottom-2 right-2 p-1.5 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
          
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                Provide a Template (Optional)
            </p>
            <div className="flex flex-wrap gap-4 items-start">
              {!isLiveMode && (
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Upload or drop image(s):</p>
                  <div className="flex flex-wrap gap-2">
                    {images.map((img, index) => (
                      <div key={index} className="relative w-24 h-24 border-2 border-dashed rounded-lg p-1">
                          <img
                              src={`data:${img.mimeType};base64,${img.data}`}
                              alt={`Template preview ${index + 1}`}
                              className="object-contain w-full h-full rounded"
                          />
                          <button
                              onClick={() => handleRemoveImage(index)}
                              className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700 shadow-md"
                              aria-label={`Remove image ${index + 1}`}
                          >
                              <CloseIcon className="w-4 h-4" />
                          </button>
                       </div>
                    ))}
                  </div>
                  <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageFileSelect}
                      className="hidden"
                      accept="image/*"
                      multiple
                  />
                  <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 text-sm font-medium py-1.5 px-4 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 flex items-center gap-2"
                  >
                      <ImageIcon className="w-4 h-4" />
                      Drag & Drop or Upload Image(s)
                  </button>
                </div>
              )}
              <div className={!isLiveMode ? "border-l border-slate-200 dark:border-slate-700 pl-4" : ""}>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Or select a built-in:</p>
                  <button 
                      onClick={() => setIsModalOpen(true)}
                      className="text-sm font-medium py-1.5 px-4 rounded-lg bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
                  >
                      Select Template...
                  </button>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            These instructions customize the AI's response. {!isLiveMode && "You can provide text and/or image(s). "}Selecting a built-in template will replace any text above.
          </p>
        </div>
      )}
    </div>
  );
};

export default CustomPromptInput;