// /database.js
// Gère la base de données IndexedDB pour stocker les GPX et leurs métadonnées

let db;

// --- MODIFICATION : Version 3 pour supporter les nouveaux champs ---
function initDB() {
    return new Promise((resolve, reject) => {
        // Passage en version 3 pour la migration si nécessaire
        const request = indexedDB.open('GpxLibraryDB', 3);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Si le store n'existe pas, on le crée
            if (!db.objectStoreNames.contains('gpxFiles')) {
                const store = db.createObjectStore('gpxFiles', { keyPath: 'id', autoIncrement: true });
                // On crée des index pour rechercher rapidement par type
                store.createIndex('type', 'type', { unique: false });
            } else {
                // Migration depuis v2 : on ajoute l'index 'type' si absent
                const store = request.transaction.objectStore('gpxFiles');
                if (!store.indexNames.contains('type')) {
                    store.createIndex('type', 'type', { unique: false });
                }
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("BDD initialisée (v3).");
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("Erreur IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Sauvegarde un fichier (GPX ou JSON) avec son type et ses métadonnées.
 * @param {string} type - 'course', 'activity', 'simulation', 'comparison'
 */
function saveFileToDB(type, fileName, dataContent, stats, extraMetadata = {}) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");

        const transaction = db.transaction(['gpxFiles'], 'readwrite');
        const store = transaction.objectStore('gpxFiles');

        let previewData = null;
        // MODIFICATION: Vérification plus robuste pour générer l'aperçu
        if (type === 'course' && stats && stats.points && Array.isArray(stats.points) && stats.points.length > 1) {
            previewData = simplifyPointsForPreview(stats.points);
        }
        
        // CORRECTION: Fusion correcte de toutes les métadonnées
        const entry = {
            type: type,
            name: fileName,
            data: dataContent,
            added: new Date(),
            dist: stats ? stats.totalDistance : 0,
            elev: stats ? stats.totalElevGain : 0,
            avgPower: stats ? stats.avgPower : 0,
            avgSpeed: stats ? stats.avgSpeed : 0,
            avgHr: stats ? stats.avgHr : 0,
            preview: previewData, // CORRECTION: 'preview' pas 'previex'
            // CORRECTION: Fusion explicite de toutes les métadonnées supplémentaires
            ...(stats || {}),  // Inclut toutes les propriétés de stats
            ...extraMetadata   // Inclut les métadonnées supplémentaires
        };

        // CORRECTION: Nettoyage des propriétés undefined
        Object.keys(entry).forEach(key => {
            if (entry[key] === undefined) {
                delete entry[key];
            }
        });

        const request = store.add(entry);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}
// --- ANCIENNE FONCTION (gardée pour compatibilité si besoin, mais redirige vers saveFileToDB) ---
function saveGpxToDB(fileName, gpxText, stats) {
    // Par défaut, si on utilise l'ancienne fonction, on considère que c'est un 'course' (Lib 1)
    return saveFileToDB('course', fileName, gpxText, stats);
}

/**
 * Récupère tous les fichiers d'un certain type.
 * @param {string|null} typeFilter - Si null, renvoie tout (pour migration éventuelle).
 */
// /database.js - CORRECTION dans getAllFromDB()

function getAllFromDB(typeFilter = null) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");
        const transaction = db.transaction(['gpxFiles'], 'readonly');
        const store = transaction.objectStore('gpxFiles');

        let request;
        if (typeFilter) {
            const index = store.index('type');
            request = index.getAll(typeFilter);
        } else {
            request = store.getAll();
        }

        request.onsuccess = () => {
            // MODIFICATION: On garde TOUTES les métadonnées, on exclut seulement le gros champ 'data'
            const results = request.result.map(item => {
                // Si l'item n'a pas de type (vieux items), on le considère comme 'course' par défaut pour l'affichage
                if (!item.type) item.type = 'course'; 
                
                // CORRECTION: On ne renvoie PAS le gros champ 'data' mais on garde TOUTES les autres métadonnées
                const { data, ...metadata } = item; 
                return metadata;
            });
            
            // Si on filtrait par type null (tout récupérer), on filtre manuellement les vieux items qui n'auraient pas le bon type si besoin
             if (typeFilter) {
                 resolve(results.filter(r => r.type === typeFilter));
             } else {
                 resolve(results);
             }
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

// --- MODIFICATION : Renommé pour plus de clarté, mais garde la même logique ---
function getFileDataFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");
        const transaction = db.transaction(['gpxFiles'], 'readonly');
        const store = transaction.objectStore('gpxFiles');
        const request = store.get(id);
        request.onsuccess = () => {
            request.result ? resolve(request.result) : reject("Fichier introuvable");
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

// Garder l'alias pour compatibilité existante si tu veux, ou remplacer les appels dans main.js
function getGpxTextFromDB(id) {
    return getFileDataFromDB(id).then(res => res.data);
}

// ... (clearAllGpxFromDB et deleteGpxFromDB restent identiques, ils travaillent sur les ID)
function clearAllGpxFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");
        const transaction = db.transaction(['gpxFiles'], 'readwrite');
        const store = transaction.objectStore('gpxFiles');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

function deleteByTypeFromDB(type) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");
        
        const transaction = db.transaction(['gpxFiles'], 'readwrite');
        const store = transaction.objectStore('gpxFiles');
        const index = store.index('type');
        const request = index.openCursor(IDBKeyRange.only(type));

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        transaction.oncomplete = () => {
            console.log(`Tous les fichiers de type '${type}' ont été supprimés.`);
            resolve();
        };

        transaction.onerror = (event) => {
            console.error("Erreur suppression par type:", event.target.error);
            reject(event.target.error);
        };
    });
}

function deleteGpxFromDB(id) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée.");
        const transaction = db.transaction(['gpxFiles'], 'readwrite');
        const store = transaction.objectStore('gpxFiles');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}


function simplifyPointsForPreview(points, maxPoints = 2500) { 
    if (!points || !Array.isArray(points) || points.length === 0) {
        // console.warn("simplifyPointsForPreview: Pas de points valides reçus"); // Optionnel: moins de logs
        return null;
    }
    if (points.length <= maxPoints) return points;
    
    const simplified = [];
    // Utilisation de Math.floor pour éviter de dépasser l'index si flottant imprécis
    const step = (points.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
        simplified.push(points[Math.floor(i * step)]);
    }
    return simplified;
}