
import React, { useRef } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { AppStatus } from '../types';
import MicIcon from './icons/MicIcon';
import StopIcon from './icons/StopIcon';
import PauseIcon from './icons/PauseIcon';
import ResumeIcon from './icons/ResumeIcon';
import UploadIcon from './icons/UploadIcon';
import DownloadIcon from './icons/DownloadIcon';
import WarningIcon from './icons/WarningIcon';

interface AudioRecorderProps {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;
  onRecordingComplete: (audioBlob: Blob) => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ status, setStatus, onRecordingComplete }) => {
  const {
    isRecording,
    isPaused,
    isRequestingMic,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    error,
    unsavedSession,
    getUnsavedSessionBlob,
    recoverUnsavedSession,
    discardUnsavedSession,
  } = useAudioRecorder();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isStarting, setIsStarting] = React.useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
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
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i)) {
        onRecordingComplete(file);
      }
    }
  };

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await startRecording();
      setStatus(AppStatus.Recording);
    } catch (err) {
      console.warn("Start recording failed or permission denied:", err);
    } finally {
      setIsStarting(false);
    }
  };
  
  const handleStop = async () => {
    setStatus(AppStatus.Processing);
    try {
      const audioBlob = await stopRecording();
      onRecordingComplete(audioBlob);
    } catch (e) {
      console.error("Stop recording failed:", e);
    }
  };

  const handleRecover = async () => {
    const recoveredBlob = await recoverUnsavedSession();
    if (recoveredBlob && recoveredBlob.size > 0) {
      onRecordingComplete(recoveredBlob);
    }
  };

  const handleDownloadRecovered = () => {
    const recoveredBlob = getUnsavedSessionBlob();
    if (recoveredBlob) {
      const url = URL.createObjectURL(recoveredBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recovered_dictation_${new Date().toISOString().slice(0, 10)}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handlePauseToggle = () => {
    if (isPaused) {
      resumeRecording();
    } else {
      pauseRecording();
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onRecordingComplete(file);
    }
    if(event.target) {
      event.target.value = "";
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const recordingText = isPaused ? 'Recording Paused' : 'Recording in Progress...';
  const recordingSubtext = isPaused ? 'Click the resume button to continue.' : 'Click the stop button when you are finished.';

  const formattedTime = unsavedSession
    ? new Date(unsavedSession.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  const formattedSize = unsavedSession
    ? `${(unsavedSession.totalBytes / 1024).toFixed(1)} KB`
    : '';

  return (
    <div 
      className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed transition-colors duration-200 ${
        isDragging 
          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-900/40' 
          : 'border-transparent'
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-blue-50/95 dark:bg-slate-800/95 rounded-2xl border-2 border-dashed border-blue-500 p-6 pointer-events-none shadow-xl">
          <UploadIcon className="w-16 h-16 text-blue-600 dark:text-blue-400 animate-bounce mb-3" />
          <p className="text-xl font-bold text-blue-700 dark:text-blue-300">
            Drop Audio File Here
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            Release to upload and begin transcription
          </p>
        </div>
      )}

      {unsavedSession && !isRecording && (
        <div className="w-full max-w-xl mb-6 p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700/60 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200">
            <WarningIcon className="w-6 h-6 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold text-sm sm:text-base">
                Interrupted Audio Recording Detected
              </p>
              <p className="text-xs sm:text-sm text-amber-700 dark:text-amber-300">
                Found audio chunks auto-saved at {formattedTime} ({formattedSize}). Restore it to avoid losing your dictation.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-200 dark:border-amber-800/50 justify-end">
            <button
              onClick={discardUnsavedSession}
              className="px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-800/40 rounded-lg transition-colors"
            >
              Discard Backup
            </button>
            <button
              onClick={handleDownloadRecovered}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm font-medium text-amber-800 dark:text-amber-200 bg-amber-200/60 dark:bg-amber-800/60 hover:bg-amber-200 rounded-lg transition-colors"
            >
              <DownloadIcon className="w-4 h-4" />
              Save File
            </button>
            <button
              onClick={handleRecover}
              className="px-4 py-1.5 text-xs sm:text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 rounded-lg shadow transition-colors"
            >
              Restore & Transcribe
            </button>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
        accept="audio/*"
        aria-hidden="true"
      />
      <div className="relative mb-6">
        <div
          className={`absolute inset-0 rounded-full bg-blue-500 transition-transform duration-1000 ${
            isRecording && !isPaused ? 'animate-ping' : ''
          }`}
        ></div>
        <div className="relative w-24 h-24 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center">
            {isRecording ? <div className={`w-10 h-10 ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'} rounded-full`}></div> : <MicIcon />}
        </div>
      </div>
      <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 mb-2">
        {isRecording ? recordingText : 'Ready to Record'}
      </h2>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-center">
        {isRecording ? recordingSubtext : 'Click below to start recording, or drag & drop / select an audio file to upload.'}
      </p>
      
      {error && <p className="text-red-500 mb-4">{error}</p>}
      
      {!isRecording ? (
        <div className="flex flex-col items-center gap-3 w-full max-w-lg">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
              <button
                onClick={handleStart}
                disabled={status === AppStatus.Recording || isStarting || isRequestingMic}
                className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-8 rounded-full hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg disabled:opacity-75 disabled:hover:scale-100 disabled:cursor-wait"
                aria-label="Start Recording"
              >
                {(isStarting || isRequestingMic) ? (
                  <>
                    <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Accessing Mic...
                  </>
                ) : (
                  <>
                    <MicIcon className="w-6 h-6"/>
                    Start Recording
                  </>
                )}
              </button>
              <span className="text-slate-500 dark:text-slate-400 my-1 sm:my-0 font-medium">or</span>
              <button
                onClick={triggerFileSelect}
                className="flex items-center justify-center gap-2 bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-full hover:bg-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:focus:ring-slate-500"
                aria-label="Upload Audio File"
              >
                <UploadIcon className="w-6 h-6"/>
                Upload Audio
              </button>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-1">
            <UploadIcon className="w-3.5 h-3.5 inline" /> You can also drag & drop an audio file anywhere in this box
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            onClick={handlePauseToggle}
            className={`flex items-center justify-center gap-2 font-bold py-3 px-8 rounded-full focus:outline-none focus:ring-4 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg ${
              isPaused 
                ? 'bg-green-500 text-white hover:bg-green-600 focus:ring-green-300' 
                : 'bg-yellow-500 text-white hover:bg-yellow-600 focus:ring-yellow-300'
            }`}
            aria-label={isPaused ? "Resume Recording" : "Pause Recording"}
          >
            {isPaused ? <ResumeIcon className="w-6 h-6"/> : <PauseIcon className="w-6 h-6"/>}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleStop}
            disabled={!isRecording}
            className="flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-3 px-8 rounded-full hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg"
            aria-label="Stop Recording"
          >
            <StopIcon className="w-6 h-6"/>
            Stop Recording
          </button>
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;