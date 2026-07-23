import { useState, useRef, useCallback, useEffect } from 'react';
import {
  saveActiveSession,
  clearActiveSession,
  saveCompletedRecording,
  getUnsavedActiveSession,
  UnsavedSession,
} from '../services/audioStorage';

type AudioRecorderResult = {
  isRecording: boolean;
  isPaused: boolean;
  isRequestingMic: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  error: string | null;
  unsavedSession: UnsavedSession | null;
  recoverUnsavedSession: () => Promise<Blob | null>;
  discardUnsavedSession: () => Promise<void>;
};

export const useAudioRecorder = (): AudioRecorderResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsavedSession, setUnsavedSession] = useState<UnsavedSession | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');
  const streamRef = useRef<MediaStream | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());

  // Check for unsaved session on hook load
  const checkUnsavedSession = useCallback(async () => {
    try {
      let session = await getUnsavedActiveSession();
      if (!session && typeof window !== 'undefined' && localStorage.getItem('has_unsaved_session')) {
        // Retry once after brief pause if IndexedDB was delayed
        await new Promise(r => setTimeout(r, 300));
        session = await getUnsavedActiveSession();
      }
      if (session && session.chunks.length > 0 && session.totalBytes > 0) {
        setUnsavedSession(session);
      } else {
        setUnsavedSession(null);
      }
    } catch (err) {
      console.warn('Error checking unsaved audio session:', err);
    }
  }, []);

  useEffect(() => {
    checkUnsavedSession();
  }, [checkUnsavedSession]);

  // Warn user before refreshing/closing tab while recording
  useEffect(() => {
    if (!isRecording) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'An audio dictation is currently recording. Leaving will stop the recording.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRecording]);

  const startRecording = useCallback(async () => {
    setError(null);
    setIsRequestingMic(true);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.warn("Recording is already in progress.");
      setIsRequestingMic(false);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = "Audio recording is not supported in this browser environment.";
        setError(msg);
        setIsRequestingMic(false);
        throw new Error(msg);
    }

    // Stop any stale tracks before requesting mic stream to avoid hardware lock/busy errors
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(track => track.stop());
      } catch (e) {}
      streamRef.current = null;
    }

    try {
      // Clear previous unsaved session in background (non-blocking)
      clearActiveSession().catch(e => console.warn('Failed to clear active session:', e));
      setUnsavedSession(null);

      sessionStartTimeRef.current = Date.now();

      // Acquire audio stream with fallback retry if advanced constraints fail or hardware is busy
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
      } catch (firstErr) {
        console.warn("Advanced audio constraint getUserMedia failed, retrying basic constraint:", firstErr);
        await new Promise(r => setTimeout(r, 150));
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      audioChunksRef.current = [];
      
      const MimeTypes = [
          'audio/webm; codecs=opus',
          'audio/ogg; codecs=opus',
          'audio/webm',
          'audio/ogg',
          'audio/mp4',
          'audio/aac',
      ];
      const supportedMimeType = MimeTypes.find(type => MediaRecorder.isTypeSupported(type));

      if (!supportedMimeType) {
          console.warn("None of the preferred MIME types are supported. Using browser default.");
      }
      
      const options = supportedMimeType ? { mimeType: supportedMimeType } : undefined;
      mimeTypeRef.current = options?.mimeType || 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // Continuously save session chunks to IndexedDB every second
          saveActiveSession(audioChunksRef.current, mimeTypeRef.current, sessionStartTimeRef.current).catch((e) =>
            console.warn('Failed to auto-save active recording session:', e)
          );
        }
      });

      // Start recording with 1000ms timeslice to ensure dataavailable fires continuously
      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setIsRequestingMic(false);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setIsRequestingMic(false);
      setIsRecording(false);

      let errorMessage = "Could not access the microphone. Please check your microphone connection.";
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = "Microphone permission denied. Please allow microphone access in your browser settings (look for the lock/mic icon in the address bar).";
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = "No microphone detected. Please check if your microphone is securely plugged in.";
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = "Microphone is busy or in use by another tab/app. Please close other audio apps or refresh the page.";
        } else if (err.message) {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            const recorder = mediaRecorderRef.current;

            const cleanupAndSetState = async () => {
                streamRef.current?.getTracks().forEach(track => track.stop());
                streamRef.current = null;
                mediaRecorderRef.current = null;
                setIsRecording(false);
                setIsPaused(false);
            };
            
            recorder.addEventListener("stop", async () => {
                const newAudioBlob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
                await cleanupAndSetState();
                // Save complete recording & clear active session chunks
                await saveCompletedRecording(newAudioBlob, mimeTypeRef.current);
                await clearActiveSession();
                setUnsavedSession(null);
                resolve(newAudioBlob);
            }, { once: true });

            recorder.addEventListener("error", async (event) => {
                console.error("MediaRecorder error:", event);
                await cleanupAndSetState();
                reject(new Error("An error occurred during recording."));
            }, { once: true });

            recorder.stop();
        } else {
            resolve(new Blob([], { type: mimeTypeRef.current }));
        }
    });
  }, []);

  const getUnsavedSessionBlob = useCallback((): Blob | null => {
    if (!unsavedSession || unsavedSession.chunks.length === 0) return null;
    return new Blob(unsavedSession.chunks, { type: unsavedSession.mimeType || 'audio/webm' });
  }, [unsavedSession]);

  const recoverUnsavedSession = useCallback(async (): Promise<Blob | null> => {
    if (!unsavedSession || unsavedSession.chunks.length === 0) return null;
    const recoveredBlob = new Blob(unsavedSession.chunks, { type: unsavedSession.mimeType || 'audio/webm' });
    await saveCompletedRecording(recoveredBlob, unsavedSession.mimeType);
    await clearActiveSession();
    setUnsavedSession(null);
    return recoveredBlob;
  }, [unsavedSession]);

  const discardUnsavedSession = useCallback(async () => {
    await clearActiveSession();
    setUnsavedSession(null);
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return {
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
  };
};
