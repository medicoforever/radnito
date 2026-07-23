// IndexedDB Storage Service for Custom User Templates (Text + Multi-Image Screenshots)

export interface CustomTemplate {
  id: string;
  name: string;
  textContent: string;
  images: Array<{ data: string; mimeType: string }>;
  createdAt: number;
}

const DB_NAME = 'RadnitoCustomTemplatesDB';
const STORE_TEMPLATES = 'custom_templates';
const DB_VERSION = 1;

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

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
          db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        resolve(db);
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
 * Saves a custom template (name, text, and multiple screenshot images) into browser IndexedDB
 */
export async function saveCustomTemplate(
  name: string,
  textContent: string,
  images: Array<{ data: string; mimeType: string }> = []
): Promise<CustomTemplate | null> {
  try {
    const db = await getDB();
    if (!db) return null;

    const id = `template_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const templateRecord: CustomTemplate = {
      id,
      name: name.trim() || 'Untitled Template',
      textContent: textContent || '',
      images: images || [],
      createdAt: Date.now(),
    };

    const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
    const store = tx.objectStore(STORE_TEMPLATES);
    store.put(templateRecord);

    return templateRecord;
  } catch (err) {
    console.error('Failed to save custom template to IndexedDB:', err);
    return null;
  }
}

/**
 * Retrieves all saved custom templates from browser IndexedDB
 */
export async function getAllCustomTemplates(): Promise<CustomTemplate[]> {
  try {
    const db = await getDB();
    if (!db) return [];

    const tx = db.transaction(STORE_TEMPLATES, 'readonly');
    const store = tx.objectStore(STORE_TEMPLATES);

    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const result = (req.result as CustomTemplate[]) || [];
        // Sort newest first
        result.sort((a, b) => b.createdAt - a.createdAt);
        resolve(result);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Failed to load custom templates from IndexedDB:', err);
    return [];
  }
}

/**
 * Deletes a saved custom template by ID from browser IndexedDB
 */
export async function deleteCustomTemplate(id: string): Promise<boolean> {
  try {
    const db = await getDB();
    if (!db) return false;

    const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
    const store = tx.objectStore(STORE_TEMPLATES);
    store.delete(id);
    return true;
  } catch (err) {
    console.error(`Failed to delete custom template [${id}]:`, err);
    return false;
  }
}
