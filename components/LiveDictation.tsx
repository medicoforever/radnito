import React, { useState, useCallback } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import WaveformIcon from './icons/WaveformIcon';
import ResultsDisplay from './ResultsDisplay';
import CustomPromptInput from './ui/CustomPromptInput';
import { GEMINI_FLASH_LITE_MODEL } from '../constants';

interface LiveDictationProps {
    onComplete: (transcript: string, audioBlob: Blob | null) => void;
    onBack: () => void;
}

const LiveDictation: React.FC<LiveDictationProps> = ({ onComplete, onBack }) => {
    const [findings, setFindings] = useState<string[]>([]);
    const [customPrompt, setCustomPrompt] = useState('');

    const {
        status,
        error,
        isSessionActive,
        startSession,
        stopSession,
        pauseSession,
        resumeSession,
    } = useLiveSession();

    const handleStart = useCallback(() => {
        startSession(setFindings, customPrompt);
    }, [startSession, customPrompt]);

    const handleStop = useCallback(() => {
        const { transcript, audioBlob } = stopSession();
        onComplete(transcript, audioBlob);
    }, [stopSession, onComplete]);

    const handleUpdateFinding = (index: number, newText: string) => {
        const newFindings = [...findings];
        if (newFindings[index] !== undefined) {
            newFindings[index] = newText;
        }
        setFindings(newFindings);
    };

    if (!isSessionActive) {
        return (
            <div className="flex flex-col items-center justify-center p-4">
                <div className="relative mb-6">
                    <div className="relative w-24 h-24 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center">
                        <WaveformIcon className="w-10 h-10 text-green-600 dark:text-green-400 animate-pulse" />
                    </div>
                </div>
                <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 mb-2 text-center">
                    Live Dictation
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-center max-w-lg text-sm sm:text-base">
                    Dictate radiology findings live. Spoken audio is processed continuously into clean, structured report lines.
                </p>

                {/* Exclusive Model Badge */}
                <div className="w-full max-w-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 p-3.5 rounded-xl mb-6 shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 block">
                            Active Model
                        </span>
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            Gemini 3.5 Flash-Lite
                        </span>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-800/50 dark:text-emerald-200">
                        ⚡ Ultra Low-Latency
                    </span>
                </div>

                {/* Voice Commands Guide */}
                <div className="w-full max-w-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 p-4 rounded-xl mb-6 text-xs text-blue-900 dark:text-blue-200 space-y-1.5">
                    <p className="font-semibold text-sm mb-1 text-blue-950 dark:text-blue-100">💡 Natural Language Voice Commands:</p>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Say <strong>"move to next line"</strong> or <strong>"next line"</strong> to create a line break.</li>
                        <li>Say <strong>"new finding"</strong> or <strong>"next finding"</strong> to start a new formatted finding on a new line.</li>
                        <li>Say <strong>"full stop"</strong> for periods, <strong>"comma"</strong> for commas, <strong>"colon"</strong> for colons.</li>
                        <li>Say <strong>"impression section"</strong> to start an IMPRESSION block.</li>
                    </ul>
                </div>

                <div className="w-full max-w-md mb-6">
                   <CustomPromptInput 
                        prompt={customPrompt} 
                        onPromptChange={setCustomPrompt}
                        isLiveMode={true}
                    />
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-full hover:bg-slate-300 transition-colors dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                        &larr; Back
                    </button>
                    <button
                        onClick={handleStart}
                        className="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                        aria-label="Start Live Session"
                    >
                        <WaveformIcon className="w-6 h-6" />
                        Start Live Dictation
                    </button>
                </div>
                <div className="mt-6 text-center text-sm min-h-[20px]">
                    {error ? <span className="text-red-500 font-medium">{error}</span> : <span className="text-slate-500 dark:text-slate-400">{status}</span>}
                </div>
            </div>
        );
    }

    return (
        <ResultsDisplay
            isLive={true}
            onStopLive={handleStop}
            liveStatus={status}
            liveError={error}
            findings={findings}
            onUpdateFinding={handleUpdateFinding}
            onAllFindingsUpdate={setFindings}
            onPauseLive={pauseSession}
            onResumeLive={resumeSession}
            customPrompt={customPrompt}
            onCustomPromptChange={setCustomPrompt}
            onReset={onBack}
            audioBlob={null}
            chatHistory={[]}
            isChatting={false}
            onSendMessage={() => {}}
            onSwitchToBatch={() => {}}
            selectedModel={GEMINI_FLASH_LITE_MODEL}
            onModelChange={() => {}}
            onReprocess={() => {}}
            onContinueDictation={async () => {}}
            customImages={[]}
            onCustomImagesChange={() => {}}
            identifiedErrors={[]}
            errorCheckStatus={'idle'}
        />
    );
};

export default LiveDictation;
