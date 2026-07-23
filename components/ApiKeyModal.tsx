import React, { useState, useEffect } from 'react';
import { getStoredApiKeys, addApiKey, removeApiKey, clearAllApiKeys, validateApiKey } from '../services/apiKeyStore';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyChange?: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeyChange }) => {
  const [keysList, setKeysList] = useState<string[]>([]);
  const [inputKey, setInputKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const refreshKeys = () => {
    const list = getStoredApiKeys();
    setKeysList(list);
  };

  useEffect(() => {
    if (isOpen) {
      refreshKeys();
      setStatusMsg(null);
      setInputKey('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddKey = async () => {
    const cleanKey = inputKey.trim();
    if (!cleanKey) {
      setStatusMsg({ type: 'error', text: 'Please enter a Gemini API Key.' });
      return;
    }
    setTesting(true);
    setStatusMsg({ type: 'info', text: 'Validating API key with Google...' });

    const isValid = await validateApiKey(cleanKey);
    setTesting(false);

    if (isValid) {
      const added = addApiKey(cleanKey);
      if (added) {
        setStatusMsg({ type: 'success', text: '✅ API Key added & verified successfully!' });
        setInputKey('');
        refreshKeys();
        if (onKeyChange) onKeyChange();
      } else {
        setStatusMsg({ type: 'info', text: 'This API key is already in your saved list.' });
      }
    } else {
      setStatusMsg({ type: 'error', text: '❌ Invalid API key. Please check your key from Google AI Studio and try again.' });
    }
  };

  const handleRemoveOne = (keyToRemove: string) => {
    removeApiKey(keyToRemove);
    refreshKeys();
    setStatusMsg({ type: 'info', text: 'API Key removed.' });
    if (onKeyChange) onKeyChange();
  };

  const handleClearAll = () => {
    clearAllApiKeys();
    refreshKeys();
    setStatusMsg({ type: 'info', text: 'All saved API keys have been removed.' });
    if (onKeyChange) onKeyChange();
  };

  const maskKey = (key: string) => {
    if (key.length <= 10) return '••••••••';
    return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold p-1 rounded-lg transition-colors"
          aria-label="Close modal"
        >
          ✕
        </button>

        <div className="flex items-center space-x-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl font-bold">
            🔑
          </div>
          <div>
            <h3 className="text-xl font-extrabold">RADNITO API Key Manager</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Stored 100% locally in your browser</p>
          </div>
        </div>

        {/* Why Add Multiple Keys Explanation */}
        <div className="bg-blue-50/80 dark:bg-slate-900/80 p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/60 mb-4 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
          <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center space-x-1">
            <span>💡 Why add 2 or 3 API keys?</span>
          </p>
          <ul className="list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-400">
            <li>
              <strong>Quota Load Balancing:</strong> RADNITO randomly picks one of your saved keys for each dictation request so you don't exhaust one key.
            </li>
            <li>
              <strong>Automatic Failover:</strong> If one key encounters a daily rate limit or error, RADNITO automatically retries using your next key seamlessly!
            </li>
          </ul>
        </div>

        {/* Add Key Section */}
        <div className="space-y-3 mb-5">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Add New Gemini API Key
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="Paste AIzaSy... key from Google AI Studio"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
            />
            <button
              onClick={handleAddKey}
              disabled={testing}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap shadow-sm"
            >
              {testing ? 'Testing...' : '+ Add Key'}
            </button>
          </div>

          {statusMsg && (
            <div
              className={`p-2.5 rounded-lg text-xs font-medium ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : statusMsg.type === 'error'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* Saved Keys List */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Active Saved Keys ({keysList.length})
            </span>
            {keysList.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-semibold"
              >
                Clear All Keys
              </button>
            )}
          </div>

          {keysList.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700">
              No API keys configured yet. Please add a key above or follow our Free API Key Guide.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {keysList.map((keyStr, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-xs font-mono"
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center text-[10px] font-bold">
                      #{idx + 1}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200">{maskKey(keyStr)}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveOne(keyStr)}
                    className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 font-bold text-xs p-1"
                    title="Remove key"
                  >
                    🗑️ Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Link */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-center">
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center space-x-1 font-semibold"
          >
            <span>Need more free keys? Get them at Google AI Studio</span>
            <span>↗</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
