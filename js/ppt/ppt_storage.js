/**
 * @file js/ppt/ppt_storage.js
 * @description
 * PPT Project Storage Layer - Uses IndexedDB to store PPT projects.
 */

const PPT_DB_NAME = 'PaperBurnerPPTDB';
const PPT_DB_VERSION = 1;
const PPT_PROJECTS_STORE = 'ppt_projects';

/**
 * Open IndexedDB database
 */
function openPPTDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PPT_DB_NAME, PPT_DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open PPT database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create PPT projects store
            if (!db.objectStoreNames.contains(PPT_PROJECTS_STORE)) {
                const store = db.createObjectStore(PPT_PROJECTS_STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
                store.createIndex('title', 'title', { unique: false });
            }

            console.log('PPT database schema created');
        };
    });
}

/**
 * Load all PPT projects from IndexedDB
 */
async function loadProjectsFromIDB() {
    const db = await openPPTDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PPT_PROJECTS_STORE, 'readonly');
        const store = transaction.objectStore(PPT_PROJECTS_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by updatedAt desc
            const projects = (request.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            resolve(projects);
        };

        request.onerror = () => {
            console.error('Failed to load projects from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * Get a single project by ID
 */
async function getProjectFromIDB(id) {
    const db = await openPPTDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PPT_PROJECTS_STORE, 'readonly');
        const store = transaction.objectStore(PPT_PROJECTS_STORE);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            console.error(`Failed to load project ${id} from IndexedDB:`, request.error);
            reject(request.error);
        };
    });
}

/**
 * Save a PPT project to IndexedDB
 */
async function saveProjectToIDB(project) {
    const db = await openPPTDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PPT_PROJECTS_STORE, 'readwrite');
        const store = transaction.objectStore(PPT_PROJECTS_STORE);

        // Ensure timestamp
        project.updatedAt = Date.now();
        if (!project.createdAt) {
            project.createdAt = Date.now();
        }

        const request = store.put(project);

        request.onsuccess = () => resolve(project);
        request.onerror = () => {
            console.error('Failed to save project to IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

/**
 * Delete a PPT project from IndexedDB
 */
async function deleteProjectFromIDB(id) {
    const db = await openPPTDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PPT_PROJECTS_STORE, 'readwrite');
        const store = transaction.objectStore(PPT_PROJECTS_STORE);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Expose to global scope
if (typeof window !== 'undefined') {
    window.pptStorage = {
        loadProjects: loadProjectsFromIDB,
        getProject: getProjectFromIDB,
        saveProject: saveProjectToIDB,
        deleteProject: deleteProjectFromIDB
    };
    console.log('[PPTStorage] Module loaded and exposed to window.pptStorage');
}