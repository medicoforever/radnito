// IndexedDB Storage Service for Custom User Templates, DOCX Templates, Multi-Image Screenshots, and Prompt Overrides

export interface CustomTemplate {
  id: string;
  name: string;
  textContent: string;
  text?: string;
  images: Array<{ data: string; mimeType: string }>;
  createdAt: number;
  modality?: 'CT' | 'MRI' | 'X-Ray' | 'USG' | 'Custom' | string;
  docxBase64?: string;
  customRules?: string;
}

export interface PromptOverrideRecord {
  templateId: string;
  rules: string;
  updatedAt: number;
}

export const DB_NAME = 'RadnitoCustomTemplatesDB';
export const DB_VERSION = 2;
export const STORE_TEMPLATES = 'custom_templates';
export const STORE_PROMPT_OVERRIDES = 'prompt_overrides';
export const STORE_AUDIO_CACHE = 'audio_cache';

// In-memory fallback for environments without IndexedDB (e.g. SSR, testing, private browsing blocks)
const inMemoryTemplates = new Map<string, CustomTemplate>();
const inMemoryOverrides = new Map<string, string>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise;
  }

  const currentPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
          const store = db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PROMPT_OVERRIDES)) {
          db.createObjectStore(STORE_PROMPT_OVERRIDES, { keyPath: 'templateId' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO_CACHE)) {
          db.createObjectStore(STORE_AUDIO_CACHE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch (e) {
      dbPromise = null;
      resolve(null);
    }
  });

  dbPromise = currentPromise.then((db) => {
    if (!db) {
      dbPromise = null;
    }
    return db;
  });

  return dbPromise;
}

/**
 * Saves a custom template (name, text, screenshots, and optional DOCX base64) into IndexedDB
 */
export async function saveCustomTemplate(
  name: string,
  textContent: string,
  images: Array<{ data: string; mimeType: string }> = [],
  docxBase64?: string,
  modality?: string,
  customRules?: string,
  existingId?: string
): Promise<CustomTemplate | null> {
  const id = existingId || `template_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const templateRecord: CustomTemplate = {
    id,
    name: name.trim() || 'Untitled Template',
    textContent: textContent || '',
    text: textContent || '',
    images: images || [],
    createdAt: Date.now(),
    modality: modality || 'Custom',
    docxBase64: docxBase64 || undefined,
    customRules: customRules || undefined,
  };

  try {
    const db = await getDB();
    if (!db) {
      inMemoryTemplates.set(id, templateRecord);
      return templateRecord;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
      const store = tx.objectStore(STORE_TEMPLATES);
      const req = store.put(templateRecord);
      req.onsuccess = () => resolve(templateRecord);
      req.onerror = () => {
        inMemoryTemplates.set(id, templateRecord);
        resolve(templateRecord);
      };
    });
  } catch (err) {
    console.error('Failed to save custom template to IndexedDB:', err);
    inMemoryTemplates.set(id, templateRecord);
    return templateRecord;
  }
}

/**
 * Retrieves all saved custom templates from IndexedDB
 */
export async function getAllCustomTemplates(): Promise<CustomTemplate[]> {
  try {
    const db = await getDB();
    if (!db) {
      return Array.from(inMemoryTemplates.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    const tx = db.transaction(STORE_TEMPLATES, 'readonly');
    const store = tx.objectStore(STORE_TEMPLATES);

    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const result = (req.result as CustomTemplate[]) || [];
        // Merge with any in-memory templates
        const combined = [...result];
        inMemoryTemplates.forEach((t) => {
          if (!combined.some(c => c.id === t.id)) {
            combined.push(t);
          }
        });
        combined.sort((a, b) => b.createdAt - a.createdAt);
        resolve(combined);
      };
      req.onerror = () => {
        resolve(Array.from(inMemoryTemplates.values()).sort((a, b) => b.createdAt - a.createdAt));
      };
    });
  } catch (err) {
    console.error('Failed to load custom templates from IndexedDB:', err);
    return Array.from(inMemoryTemplates.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}

/**
 * Retrieves a single custom template by ID
 */
export async function getCustomTemplateById(id: string): Promise<CustomTemplate | null> {
  try {
    const db = await getDB();
    if (!db) {
      return inMemoryTemplates.get(id) || null;
    }

    const tx = db.transaction(STORE_TEMPLATES, 'readonly');
    const store = tx.objectStore(STORE_TEMPLATES);

    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as CustomTemplate) || inMemoryTemplates.get(id) || null);
      req.onerror = () => resolve(inMemoryTemplates.get(id) || null);
    });
  } catch (err) {
    console.error(`Failed to get custom template [${id}]:`, err);
    return inMemoryTemplates.get(id) || null;
  }
}

/**
 * Deletes a saved custom template by ID
 */
export async function deleteCustomTemplate(id: string): Promise<boolean> {
  inMemoryTemplates.delete(id);
  try {
    const db = await getDB();
    if (!db) return true;

    const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
    const store = tx.objectStore(STORE_TEMPLATES);
    store.delete(id);
    return true;
  } catch (err) {
    console.error(`Failed to delete custom template [${id}]:`, err);
    return true;
  }
}

/**
 * Persists prompt overrides for a specific template
 */
export async function savePromptOverride(templateId: string, rules: string): Promise<boolean> {
  const record: PromptOverrideRecord = {
    templateId,
    rules: rules.trim(),
    updatedAt: Date.now(),
  };
  inMemoryOverrides.set(templateId, rules);

  try {
    const db = await getDB();
    if (!db) return true;

    const tx = db.transaction(STORE_PROMPT_OVERRIDES, 'readwrite');
    const store = tx.objectStore(STORE_PROMPT_OVERRIDES);
    store.put(record);
    return true;
  } catch (err) {
    console.error(`Failed to save prompt override for [${templateId}]:`, err);
    return true;
  }
}

/**
 * Retrieves prompt override rules for a specific template
 */
export async function getPromptOverride(templateId: string): Promise<string | null> {
  if (inMemoryOverrides.has(templateId)) {
    return inMemoryOverrides.get(templateId) || null;
  }

  try {
    const db = await getDB();
    if (!db) return inMemoryOverrides.get(templateId) || null;

    const tx = db.transaction(STORE_PROMPT_OVERRIDES, 'readonly');
    const store = tx.objectStore(STORE_PROMPT_OVERRIDES);

    return new Promise((resolve) => {
      const req = store.get(templateId);
      req.onsuccess = () => {
        const res = req.result as PromptOverrideRecord | undefined;
        resolve(res ? res.rules : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Removes prompt override for a specific template
 */
export async function deletePromptOverride(templateId: string): Promise<boolean> {
  inMemoryOverrides.delete(templateId);
  try {
    const db = await getDB();
    if (!db) return true;

    const tx = db.transaction(STORE_PROMPT_OVERRIDES, 'readwrite');
    const store = tx.objectStore(STORE_PROMPT_OVERRIDES);
    store.delete(templateId);
    return true;
  } catch {
    return true;
  }
}

// Aliases for compatibility across components
export type UserTemplate = CustomTemplate & { text?: string; docxBase64?: string; modality?: string };

export async function saveUserTemplate(template: any): Promise<any> {
  const text = template.textContent || template.text || '';
  return saveCustomTemplate(
    template.name || 'Untitled Template',
    text,
    template.images || [],
    template.docxBase64,
    template.modality,
    template.customRules,
    template.id
  );
}

export async function getUserTemplates(): Promise<UserTemplate[]> {
  const list = await getAllCustomTemplates();
  return list.map(item => ({
    ...item,
    text: item.textContent || item.text || '',
  }));
}

export async function deleteUserTemplate(id: string): Promise<boolean> {
  return deleteCustomTemplate(id);
}

// ==========================================
// Consultant Skill Prompt Storage & Toggles
// ==========================================
const TEMPLATE_SKILL_ENABLED_KEY = 'radiology_template_skill_enabled';
const TEMPLATE_CUSTOM_PROMPTS_KEY = 'radiology_template_custom_prompts';

export function isTemplateSkillEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const val = localStorage.getItem(TEMPLATE_SKILL_ENABLED_KEY);
  return val === null ? true : val === 'true';
}

export function setTemplateSkillEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TEMPLATE_SKILL_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getTemplateCustomPrompt(templateId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TEMPLATE_CUSTOM_PROMPTS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[templateId] || null;
  } catch {
    return null;
  }
}

export function setTemplateCustomPrompt(templateId: string, prompt: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(TEMPLATE_CUSTOM_PROMPTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[templateId] = prompt.trim();
    localStorage.setItem(TEMPLATE_CUSTOM_PROMPTS_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save template custom prompt:', e);
  }
}

export function resetTemplateCustomPrompt(templateId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(TEMPLATE_CUSTOM_PROMPTS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    delete map[templateId];
    localStorage.setItem(TEMPLATE_CUSTOM_PROMPTS_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to reset template custom prompt:', e);
  }
}
