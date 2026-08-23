import React, { useState, useEffect } from 'react';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import SparklesIcon from '../icons/SparklesIcon';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { transcribeAudioForPrompt } from '../../services/geminiService';
import MicIcon from '../icons/MicIcon';
import StopIcon from '../icons/StopIcon';
import Spinner from './Spinner';

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
  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  // Local style toggles state
  const [localToggles, setLocalToggles] = useState<StyleToggles>(styleToggles);

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

  return (
    <div className={`w-full ${className}`}>
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
                  Global Custom Instructions & Doctor Preferences
                </h3>
                {prompt && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                    Active ({prompt.length} chars)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {prompt ? `${prompt.slice(0, 70)}...` : 'Add optional doctor phrasing rules, specific measurements, or custom style instructions'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
                  Doctor Preferences & Phrasing Instructions:
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
                  placeholder="e.g. 'Always report measurements in mm', 'Include clinical correlation note in impression', 'Use bulleted points for pelvic findings'..."
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
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomPromptInput;
