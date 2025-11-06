let map, gpxLayer;
let allPoints = [];
let allSegments = [];
let allClimbs = [];
let myPenteChart = null;
let altitudeChart = null;
let speedTimeChart = null;
let colDetailChart = null;
let stageProfileChart = null;
let activeSegmentIndex = null;
let currentFileName = "parcours";
let numsimu = 0;
let libraryMode = 'main';
let currentLibraryTab = 'course';
let lastSimulationJSON = null;
let lastLoadedGPXText = "";
let zoneChart = null;
const ETA_TRANSMISSION = 0.97;
let userParams = {
    poids: 68,
    puissance: 250,
    poids_velo: 8,
    Crr: 0.0045,
    CdA: 0.39,
    eta_muscle: 0.24,
    targetSpeed: 30,
    simMode: 'power',
    pacingStrategy: 'constant',
    colthresolddetection: 3,
    colcontinuedetection: 2,
    maxreplatdistance: 3000,
    minclimbdistance: 5000,
    slopeThreshold: 3,
    minSegmentLength: 500,
    slopeSmoothingWindow: 3,
    CP: 260,
    W_prime_max: 20000,
    tau_rec: 500,
};
let indicatorMarker = null;

document.addEventListener("DOMContentLoaded", () => {
    map = L.map('map').setView([45.9, 6.1], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15 }).addTo(map);
    if (window['chartjs-plugin-annotation']) Chart.register(window['chartjs-plugin-annotation']);
    initDB().catch(e => console.error("DB Init Error:", e));

    indicatorMarker = L.marker([0, 0], {
        icon: L.divIcon({
            className: 'custom-indicator-icon',
            html: '<div style="background-color: #00d0ff; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [15, 15]
        }), opacity: 0.8
    });

    const libModal = document.getElementById('gpxLibraryModal');
    const comparePage = document.getElementById('comparisonPage');
    const importBtn = document.getElementById('importGpxBtn');
    const importInput = document.getElementById('gpxImportInput');

    // Gestion des boutons d'ouverture de la bibliothèque
    const openLibBtn = document.getElementById('openLibraryBtn');
    const openLibFromCompareBtn = document.getElementById('openLibFromCompareBtn');

    if (openLibBtn && libModal) {
        openLibBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            libraryMode = 'main';
            libModal.classList.add('visible');
            loadLibraryDashboard();
        };
    }

    const dashboardBtn = document.getElementById('openDashboardBtn');
    if (dashboardBtn && libModal) {
        dashboardBtn.onclick = (e) => {
            e.preventDefault();
            libraryMode = 'main'; // Ou 'dashboard' si on veut un mode spécifique plus tard
            currentLibraryTab = 'activity'; // On force l'onglet Activités
            
            // Mise à jour visuelle des onglets
            document.querySelectorAll('.lib-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.lib-tab-btn[data-target="lib-activities"]')?.classList.add('active');
            
            libModal.classList.add('visible');
            loadLibraryDashboard();
        };
    }

    if (openLibFromCompareBtn && libModal) {
        openLibFromCompareBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            libraryMode = 'compare';
            libModal.classList.add('visible');
            loadLibraryDashboard();
        };
    }

   // --- NOUVEAU GESTIONNAIRE D'IMPORT INTELLIGENT ---
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
            // Si on est dans l'onglet simulation ou comparaison, on pourrait vouloir importer du JSON
            if (currentLibraryTab === 'simulation' || currentLibraryTab === 'comparison') {
                console.log("Simulation data chargée:", fullFile.data);
                alert("Simulation chargée en mémoire ! (Restauration complète de l'interface à venir...)");
                // Simplifions : on ouvre toujours le même, et on détecte le contenu.
                importInput.click(); 
            } else {
                importInput.click();
            }
        });

       importInput.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                try {
                    const text = await file.text();
                    
                    // --- 1. DÉTECTION JSON (Simulation / Comparaison) ---
                    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                        try {
                            const json = JSON.parse(text);
                            if (json.informations_parcours && json.resultats_simulation) {
                                await saveFileToDB('simulation', file.name, json, null);
                            } else if (json.realEffortId && json.simulationId) {
                                await saveFileToDB('comparison', file.name, json, null);
                            } else {
                                alert("Type JSON inconnu.");
                            }
                        } catch (jsonErr) {
                            console.error(jsonErr); alert("Fichier JSON invalide.");
                        }

                    } else {
                        // --- 2. GESTION GPX (Parcours / Activité) ---
                        const parser = new DOMParser();
                        const xml = parser.parseFromString(text, "application/xml");
                        
                        // A) Détection du type
                        let hasTimeData = false;
                        const trkpts = xml.getElementsByTagName('trkpt');
                        if (trkpts.length > 0) {
                            for(let i=0; i < Math.min(10, trkpts.length); i++) {
                                if(trkpts[i].getElementsByTagName('time').length > 0) {
                                    hasTimeData = true; break;
                                }
                            }
                        }
                        // Force 'course' si on est sur l'onglet parcours, sinon auto-détection
                        let typeToSave = (currentLibraryTab === 'course') ? 'course' : (hasTimeData ? 'activity' : 'course');

                        // B) Parsing des points
                        const pts = parseGPX(xml);
                        
                        // C) Initialisation de l'objet de sauvegarde (statsToSave)
                        // On inclut 'points' immédiatement pour que l'aperçu puisse être généré par la DB
                        let statsToSave = { 
                            totalDistance: 0, 
                            totalElevGain: 0, 
                            points: pts, 
                            avgPower: 0,
                            avgSpeed: 0,
                            avgHr: 0
                        };

                        if (pts.length > 0 && typeof calculateTrackStats === 'function') {
                             const calc = calculateTrackStats(pts);
                             statsToSave.totalDistance = calc.totalDistance;
                             statsToSave.totalElevGain = calc.totalElevGain;

                             // D) Calcul des moyennes SI c'est une activité
                             if (typeToSave === 'activity') {
                                 let totalPower = 0, powerCount = 0;
                                 let totalHr = 0, hrCount = 0;
                                 let movingTimeSec = 0; // Temps de déplacement

                                 for(let i=1; i < pts.length; i++) {
                                     const pPrev = pts[i-1];
                                     const pCurr = pts[i];
                                     
                                     // Calcul des moyennes Power/HR (inchangé)
                                     if (pCurr.power) { totalPower += pCurr.power; powerCount++; }
                                     if (pCurr.hr) { totalHr += pCurr.hr; hrCount++; }

                                     // Calcul du temps de déplacement
                                     if (pPrev.time && pCurr.time) {
                                         const distDiff = pCurr.dist - pPrev.dist; // en mètres
                                         const timeDiff = (pCurr.time - pPrev.time) / 1000; // en secondes
                                         
                                         if (timeDiff > 0) {
                                             const speed = (distDiff / timeDiff) * 3.6; // km/h
                                             // On considère qu'on bouge si la vitesse est > 1 km/h
                                             // ET que la pause n'est pas absurdement longue pour une petite distance (ex: arrêt GPS)
                                             if (speed > 1.0 && speed < 150) { 
                                                 movingTimeSec += timeDiff;
                                             }
                                         }
                                     }
                                 }

                                 // Vitesse moyenne sur le temps de DÉPLACEMENT
                                 if (movingTimeSec > 0) {
                                     statsToSave.avgSpeed = (statsToSave.totalDistance / 1000) / (movingTimeSec / 3600);
                                 } else {
                                     // Fallback si pas de temps détecté (ex: vieux GPX sans time)
                                     statsToSave.avgSpeed = 0;
                                 }

                                 if (powerCount > 0) statsToSave.avgPower = Math.round(totalPower / powerCount);
                                 if (hrCount > 0) statsToSave.avgHr = Math.round(totalHr / hrCount);
                             }
                        }

                        // Sauvegarde en DB avec le bon objet
                        await saveFileToDB(typeToSave, file.name, text, statsToSave);
                    }

                } catch (err) {
                    console.error("Erreur import:", err);
                    alert("Erreur lors de l'import de " + file.name + " (Voir console)");
                }
            }
            // Rechargement de l'interface
            if (document.getElementById('gpxLibraryModal')?.classList.contains('visible')) {
                loadLibraryDashboard(document.getElementById('searchGpxInput')?.value || "");
            }
            importInput.value = '';
        });
    }

   const deleteAllBtn = document.getElementById('deleteAllGpxBtn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async () => {
            // On récupère le nom lisible de l'onglet courant pour le message de confirmation
            let typeLabel = "";
            switch(currentLibraryTab) {
                case 'course': typeLabel = "les PARCOURS"; break;
                case 'activity': typeLabel = "les ACTIVITÉS RÉELLES"; break;
                case 'simulation': typeLabel = "les SIMULATIONS"; break;
                case 'comparison': typeLabel = "les COMPARAISONS"; break;
            }

            if (confirm(`⚠️ ATTENTION : Vous allez supprimer TOUS ${typeLabel}.\n\nCette action est irréversible.\n\nVoulez-vous vraiment continuer ?`)) {
                try {
                    // Utilisation de la nouvelle fonction ciblée
                    await deleteByTypeFromDB(currentLibraryTab);
                    // Rechargement de la vue courante
                    loadLibraryDashboard(document.getElementById('searchGpxInput')?.value || "");
                } catch (err) {
                    console.error("Erreur lors de la suppression par type:", err);
                    alert("Erreur technique lors de la suppression.");
                }
            }
        });
    }

    document.querySelectorAll('.lib-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 1. Visuel actif
            document.querySelectorAll('.lib-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 2. Mise à jour de l'état interne
            const target = btn.getAttribute('data-target');
            switch(target) {
                case 'lib-courses': currentLibraryTab = 'course'; break;
                case 'lib-activities': currentLibraryTab = 'activity'; break;
                case 'lib-simulations': currentLibraryTab = 'simulation'; break;
                case 'lib-comparisons': currentLibraryTab = 'comparison'; break;
            }

            const deleteBtn = document.getElementById('deleteAllGpxBtn');
            if (deleteBtn) {
                let label = "Tout supprimer";
                switch(currentLibraryTab) {
                    case 'course': label = "🗑️ Suppr. Parcours"; break;
                    case 'activity': label = "🗑️ Suppr. Activités"; break;
                    case 'simulation': label = "🗑️ Suppr. Simulations"; break;
                    case 'comparison': label = "🗑️ Suppr. Comparaisons"; break;
                }
                deleteBtn.textContent = label;
            }

            // 3. Recharger le dashboard avec le bon filtre
            loadLibraryDashboard(document.getElementById('searchGpxInput')?.value || "");
        });
    });

    const searchInput = document.getElementById('searchGpxInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value;
            loadLibraryDashboard(term);
        });
    }

    const sortSelect = document.getElementById('sortGpxSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            const currentSearch = document.getElementById('searchGpxInput')?.value || "";
            loadLibraryDashboard(currentSearch);
        });
    }

    const btnCompare = document.getElementById('compareBtn');
    if (btnCompare) {
        btnCompare.addEventListener('click', (e) => {
            e.preventDefault();
            if (!lastSimulationJSON) {
                alert("Veuillez d'abord simuler un parcours avant de le comparer.");
                return;
            }
            if (comparePage) {
                comparePage.style.display = 'flex';
                if (typeof initializeComparisonPage === 'function') {
                    initializeComparisonPage(lastSimulationJSON, allPoints, lastLoadedGPXText);
                }
            }
        });
    }

    const closeCompareBtn = document.getElementById('closeComparePage');
    if (closeCompareBtn && comparePage) {
        closeCompareBtn.addEventListener('click', () => {
            comparePage.style.display = 'none';
        });
    }

    const graphModal = document.getElementById('graphModal');
    document.getElementById('GraphesBtn').onclick = () => {
        graphModal.classList.add('visible');
        drawSpeedTimeChart(allSegments);
        if (allPoints.length > 0) {
            drawZoneChart(allPoints);
        }
    };
    document.getElementById('closeGraphModal').onclick = () => graphModal.classList.remove('visible');
    graphModal.onclick = (e) => { if (e.target === graphModal) graphModal.classList.remove('visible'); };

    const stageModal = document.getElementById('stageProfileModal');
    document.getElementById('profilTDF').onclick = () => showStageProfileModal();
    document.getElementById('closeStageProfileModal').onclick = () => stageModal.classList.remove('visible');
    stageModal.onclick = (e) => { if (e.target === stageModal) stageModal.classList.remove('visible'); };

    const colModal = document.getElementById('colDetailModal');
    if (colModal) {
        document.getElementById('closeColDetailModal').onclick = () => colModal.classList.remove('visible');
        colModal.onclick = (e) => { if (e.target === colModal) colModal.classList.remove('visible'); };
    }

    document.getElementById('simulateBtn').addEventListener('click', async () => {
            try {
                await runSimulation();
                numsimu++;
            } catch (e) {
                // Error already logged or alerted in runSimulation if needed
            }
        });    
    document.getElementById('saveSimBtn')?.addEventListener('click', saveCurrentSimulation); 
    document.getElementById('ResetSegmentation').addEventListener('click', resetsegmentation);
    document.getElementById('btnExport').addEventListener('click', exportSegmentsToJSON);
    document.getElementById('btnExportZWO')?.addEventListener('click', exportToZWO);
    document.getElementById('poids').oninput = updatePoids;
    document.getElementById('puissance').oninput = updatePuissance;
    document.getElementById('poidsvelo').oninput = updatePoidsVelo;
    document.getElementById('cda').oninput = updatecda;
    document.getElementById('rm').oninput = updaterm;
    document.getElementById('colThreshold').oninput = updatecolthresolddetection;
    document.getElementById('colContinue').oninput = updatecolcontinuedetection;
    document.getElementById('maxReplatDistance').oninput = updatemaxreplatdistance;
    document.getElementById('minClimbDistance').oninput = updateminclimbdistance;
    document.getElementById('slopeThreshold').oninput = updateslopeThreshold;
    document.getElementById('minLength').oninput = updateminSegmentLength;
    document.getElementById('lissagepente').oninput = updateslopeSmoothingWindow;
    document.getElementById('speed').oninput = updateSpeed;
    document.getElementById('simMode').onchange = updateSimMode;

    const colorMode = document.getElementById('colorMode');
    if (colorMode) {
        document.body.className = colorMode.value;
        colorMode.onchange = () => {
            document.body.className = colorMode.value;
            if (allSegments.length) { drawSegmentsOnMap(allSegments); rerenderSegmentListAfterSim(allSegments); }
        };
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") {
            deselectAllSegments();
            if (libModal && libModal.classList.contains('visible')) {
                libModal.classList.remove('visible');
            } else if (comparePage && comparePage.style.display === 'flex') {
                comparePage.style.display = 'none';
            } else {
                [graphModal, colModal, stageModal].forEach(m => m?.classList.remove('visible'));
            }
        }
    });

    map.on('click', deselectAllSegments);

    const chartCont = document.getElementById('altitudeChartContainer');
    if (chartCont) {
        chartCont.onmousemove = handleChartMouseMove;
        chartCont.onmouseout = handleChartMouseOut;
    }

    const resCard = document.getElementById('results-card');
    if (resCard) resCard.onclick = () => resCard.classList.toggle('toggled');

    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'closeLibraryModalBtn') {
            libModal?.classList.remove('visible');
        }
        if (e.target && e.target.id === 'gpxLibraryModal') {
            e.target.classList.remove('visible');
        }
    });
});


function drawPreviewOnCanvas(canvas, points) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Nettoyage
    ctx.clearRect(0, 0, width, height);

    if (!points || !Array.isArray(points) || points.length < 2) {
        // Fallback si pas assez de points
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("Aperçu indisponible", width / 2, height / 2);
        return;
    }

    // 1. Trouver les limites du tracé (Bounding Box)
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    }

    const latRange = maxLat - minLat;
    const lonRange = maxLon - minLon;

    // Évite la division par zéro si tous les points sont identiques
    if (latRange === 0 && lonRange === 0) return;

    // 2. Calcul de l'échelle pour tout faire rentrer avec une marge
    const padding = 12; // Marge en pixels
    const availWidth = width - 2 * padding;
    const availHeight = height - 2 * padding;

    // Facteur de correction pour la longitude selon la latitude moyenne (projection simple)
    const midLatRad = (minLat + maxLat) / 2 * Math.PI / 180;
    const lonCorrection = Math.cos(midLatRad);

    // On calcule l'échelle pour faire rentrer le plus grand côté
    const scaleX = availWidth / (lonRange * lonCorrection);
    const scaleY = availHeight / latRange;
    const scale = Math.min(scaleX, scaleY);

    // 3. Fonction de projection (Lat/Lon -> Pixels X/Y)
    // On centre le tracé dans le canvas
    const offsetX = (width - lonRange * lonCorrection * scale) / 2;
    const offsetY = (height - latRange * scale) / 2;

    const project = (lat, lon) => ({
        x: offsetX + (lon - minLon) * lonCorrection * scale,
        y: height - (offsetY + (lat - minLat) * scale) // Inversion de Y car canvas 0 est en haut
    });

    // 4. Dessin du tracé
    ctx.beginPath();
    ctx.strokeStyle = '#ff9100'; // Couleur orange
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const start = project(points[0].lat, points[0].lon);
    ctx.moveTo(start.x, start.y);

    for (let i = 1; i < points.length; i++) {
        const p = project(points[i].lat, points[i].lon);
        ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
}


async function loadLibraryDashboard(searchTerm = "") {
    const grid = document.getElementById('gpxLibraryGrid');
    const statsBar = document.getElementById('library-stats');
    
    if (!grid) return;

    // Feedback visuel immédiat
    grid.innerHTML = '<p style="color:#888; grid-column: 1/-1; text-align:center;">Chargement...</p>';

    try {
        // 1. Récupérer les fichiers DU BON TYPE depuis la DB
        // getAllFromDB est la nouvelle fonction dans database.js qui accepte un filtre
        let files = await getAllFromDB(currentLibraryTab); 

        // 2. Filtrage par recherche
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            files = files.filter(f => f.name.toLowerCase().includes(term));
        }

        // 3. Tri (on garde la logique existante)
        const sortMode = document.getElementById('sortGpxSelect')?.value || 'date_desc';
        files.sort((a, b) => {
            switch (sortMode) {
                case 'date_desc': return new Date(b.added) - new Date(a.added);
                case 'date_asc':  return new Date(a.added) - new Date(b.added);
                case 'dist_desc': return (b.dist || 0) - (a.dist || 0);
                case 'dist_asc':  return (a.dist || 0) - (b.dist || 0);
                case 'name_asc':  return (a.name || "").localeCompare(b.name || "");
                default: return new Date(b.added) - new Date(a.added);
            }
        });

        // 4. Mise à jour de la barre de stats
        if (statsBar) {
            let typeLabel = "";
            switch(currentLibraryTab) {
                case 'course': typeLabel = "parcours"; break;
                case 'activity': typeLabel = "activités réelles"; break;
                case 'simulation': typeLabel = "simulations sauvegardées"; break;
                case 'comparison': typeLabel = "rapports de comparaison"; break;
            }
            statsBar.textContent = `${files.length} ${typeLabel}`;
        }

        // 5. Affichage si vide
        if (files.length === 0) {
             grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">
                <h3>📭 Aucune donnée</h3>
                <p>Rien dans la catégorie "${currentLibraryTab}" pour l'instant.</p>
             </div>`;
             return;
        }

        // 6. Génération des cartes
        grid.innerHTML = '';
        for (const file of files) {
            const card = document.createElement('div');
            card.className = 'gpx-card';
            
            // Couleurs de bordure
            if (file.type === 'activity') card.style.borderLeft = '4px solid #00d0ff';
            else if (file.type === 'simulation') card.style.borderLeft = '4px solid #ff9100';
            else if (file.type === 'comparison') card.style.borderLeft = '4px solid #4CAF50';

            const dateStr = new Date(file.added).toLocaleDateString();
            let contentHtml = '';

            // --- BLOC COMMUN POUR PARCOURS ET ACTIVITÉS ---
            if (file.type === 'course') {
                const dist = ((file.dist || 0) / 1000).toFixed(1);
                const elev = Math.round(file.elev || 0);
                
                contentHtml += `
                    <div class="gpx-stat-row"><span>Dist:</span><span class="stat-value stat-dist">${dist} km</span></div>
                    <div class="gpx-stat-row"><span>D+:</span><span class="stat-value stat-elev">${elev} m</span></div>
                `;
                
               if (file.preview && file.preview.length > 0) {
    const canvasId = `preview-canvas-${file.id}`;
    contentHtml += `
        <div class="preview-container">
            <canvas id="${canvasId}" width="250" height="80"></canvas>
        </div>`;
    setTimeout(() => {
        const canvas = document.getElementById(canvasId);
        if (canvas) drawPreviewOnCanvas(canvas, file.preview);
    }, 0);
} else {
                     contentHtml += `<div style="height:80px; background:#222; margin-top:10px; display:flex; align-items:center; justify-content:center; color:#555; font-size:0.8em; border-radius:6px; border: 1px solid #333;">(Pas d'aperçu)</div>`;
                }

            // --- BLOC ACTIVITÉ RÉELLE (Stats) ---
            } else if (file.type === 'activity') {
                const dist = ((file.dist || 0) / 1000).toFixed(1);
                const elev = Math.round(file.elev || 0);
                const avgPwr = file.avgPower ? `${Math.round(file.avgPower)} W` : '-';
                const avgSpd = file.avgSpeed ? `${file.avgSpeed.toFixed(1)} km/h` : '-';
                const avgHr = file.avgHr ? `${Math.round(file.avgHr)} bpm` : '-';

                contentHtml += `
                    <div class="gpx-stat-row"><span>Dist:</span><span class="stat-value stat-dist">${dist} km</span></div>
                    <div class="gpx-stat-row"><span>D+:</span><span class="stat-value stat-elev">${elev} m</span></div>
                    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #333;">
                        <div class="gpx-stat-row"><span>Vit. Moy:</span><span class="stat-value" style="color:#00d0ff">${avgSpd}</span></div>
                        <div class="gpx-stat-row"><span>Puis. Moy:</span><span class="stat-value" style="color:#ff9100">${avgPwr}</span></div>
                        <div class="gpx-stat-row"><span>FC Moy:</span><span class="stat-value" style="color:#E91E63">${avgHr}</span></div>
                    </div>
                `;

            } 
            
            else if (file.type === 'simulation') {

                        const timeStr = file.sim_time_str || "--:--";
                        const pwr = Math.round(file.sim_avg_power || 0);
                        const spd = (file.sim_avg_speed || 0).toFixed(1);
                        const kcal = Math.round(file.sim_kcal || 0);
                        const dist = ((file.dist || 0) / 1000).toFixed(1);
                        const elev = Math.round(file.elev || 0);

                        console.log("Stats extraites:", { timeStr, pwr, spd, kcal, dist, elev });

                        contentHtml = `
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9em;">
                                <div class="gpx-stat-row"><span>⏱️ Temps:</span><span class="stat-value">${timeStr}</span></div>
                                <div class="gpx-stat-row"><span>🔥 Kcal:</span><span class="stat-value">${kcal}</span></div>
                                <div class="gpx-stat-row"><span>⚡ Puis.:</span><span class="stat-value" style="color:#ff9100">${pwr} W</span></div>
                                <div class="gpx-stat-row"><span>🚴 Vit.:</span><span class="stat-value" style="color:#00d0ff">${spd} km/h</span></div>
                                <div class="gpx-stat-row"><span>📏 Dist:</span><span class="stat-value stat-dist">${dist} km</span></div>
                                <div class="gpx-stat-row"><span>🏔️ D+:</span><span class="stat-value stat-elev">${elev} m</span></div>
                                <button class="btn-zwo-export" data-id="${file.id}" style="background: #E91E63; margin-top: 15px; width: 100%; font-size: 0.9em; padding: 6px;">
                        📤 Export Zwift (.zwo)
                    </button>
                            </div>
                            <div style="margin-top:10px; font-size:0.8em; color:#888; text-align:center; border-top:1px solid #333; padding-top:5px;">
                                (Cliquez sur "Charger" pour restaurer)
                            </div>
                        `;
} else if (file.type === 'comparison') {
                // Affichage des stats de comparaison
                const score = file.globalScore || 0;
                let scoreColor = '#F44336'; // Rouge
                if (score >= 90) scoreColor = '#4CAF50'; // Vert
                else if (score >= 60) scoreColor = '#FFC107'; // Jaune

                contentHtml = `
                    <div style="text-align:center; padding: 10px 0;">
                        <div style="font-size: 0.9em; color: #ccc; margin-bottom: 5px;">Simu : ${file.simName || '?'}</div>
                        <div style="font-size: 2.5em; font-weight: bold; color: ${scoreColor};">
                            ${score}/100
                        </div>
                        <div style="font-size: 0.8em; color: #888;">Note Globale</div>
                    </div>
                `;
            }

            // Assemblage de la carte
           card.innerHTML = `
    <div class="gpx-card-header" title="${file.name}">${file.name}</div>
    <div class="gpx-card-body">
        <div class="gpx-card-content">
            ${contentHtml}
        </div>
    </div>
    <div class="gpx-card-footer">
        <span class="gpx-date">${dateStr}</span>
        <div class="footer-buttons">
            <button class="btn-delete" data-id="${file.id}">Suppr.</button>
            <button class="btn-load" data-id="${file.id}">Charger</button>
        </div>
    </div>`;

    const zwoBtn = card.querySelector('.btn-zwo-export');
            if (zwoBtn) {
                zwoBtn.onclick = async (e) => {
                    e.stopPropagation();
                    // On charge les données complètes de la simulation depuis la DB
                    const simFile = await getFileDataFromDB(file.id);
                    // On lance l'export avec CES données
                    exportToZWO(simFile.data, simFile.name);
                };
            }

            // ... (suite logique des boutons load/delete inchangée)
            // Assure-toi juste de bien remettre la logique des boutons après ce bloc innerHTML
            // (Je te la remets ci-dessous pour être sûr que tu as tout le bloc complet)

            const loadBtn = card.querySelector('.btn-load');
            loadBtn.onclick = async () => {
                try {
                    const fullFile = await getFileDataFromDB(file.id);
                    if (currentLibraryTab === 'course') {
                        document.getElementById('gpxLibraryModal').classList.remove('visible');
                        processGpxText(fullFile.data, fullFile.name.replace(/\.gpx$/i, ''));
                    } else if (currentLibraryTab === 'activity') {
    if (libraryMode === 'compare') {
        // MODE 1 : Comparaison (inchangé)
        document.getElementById('gpxLibraryModal').classList.remove('visible');
        const realStatus = document.getElementById('real-activity-status');
        if (realStatus) {
            realStatus.textContent = file.name;
            realStatus.style.color = "#4CAF50";
        }
        document.getElementById('runComparisonBtn').disabled = false;
        if (typeof runComparison === 'function') {
            runComparison(fullFile.data);
        }
    } else {
        // MODE 2 : ANALYSE APPROFONDIE (Nouveau !)
        // On ferme la bibliothèque
        document.getElementById('gpxLibraryModal').classList.remove('visible');
        
        // On appelle la nouvelle fonction d'analyse
        // Assure-toi que analysis.js est bien inclus dans index.html
        if (typeof openAnalysisPage === 'function') {
            openAnalysisPage(fullFile.data, file.name);
        } else {
            console.error("openAnalysisPage non trouvée. Avez-vous inclus analysis.js ?");
            // Fallback sur l'ancienne méthode si le fichier JS manque
            analyzeActivity(fullFile.data, file.name); 
        }
    }
}
                    else if (currentLibraryTab === 'simulation') {
                        // Charger une simulation sauvegardée
                        
                        // 1. Fermer la bibliothèque
                        document.getElementById('gpxLibraryModal').classList.remove('visible');
                        
                        // 2. Restaurer la simulation
                        // fullFile.data contient tout le JSON sauvegardé
                        restoreSimulation(fullFile.data);
                    }
                    
                    else if (currentLibraryTab === 'comparison') {
                        // NOUVEAU : Chargement d'une comparaison
                        
                        // 1. Fermer la bibliothèque
                        document.getElementById('gpxLibraryModal').classList.remove('visible');
                        
                        // 2. Ouvrir la page de comparaison
                        const comparePage = document.getElementById('comparisonPage');
                        if (comparePage) {
                            comparePage.style.display = 'flex';
                            
                            // 3. Initialiser avec les données sauvegardées
                            // fullFile.data contient l'objet { simData, simPoints, realGpx } qu'on a sauvegardé
                            if (typeof initializeComparisonPage === 'function') {
                                initializeComparisonPage(
                                    fullFile.data.simData, 
                                    fullFile.data.simPoints, 
                                    fullFile.data.realGpx
                                );
                            }
                        }
                    }
                    
                    
                    
                    else {
                         alert("Chargement de ce type pas encore dispo.");
                    }
                } catch (e) { console.error(e); alert("Erreur chargement."); }
            };

            card.querySelector('.btn-delete').onclick = async (e) => {
                e.stopPropagation();
                if (confirm("Supprimer ce fichier ?")) {
                    await deleteGpxFromDB(file.id);
                    loadLibraryDashboard(document.getElementById('searchGpxInput')?.value || "");
                }
            };
            grid.appendChild(card);
        } // end for

    } catch (err) {
        console.error("Erreur dashboard:", err);
        grid.innerHTML = `<p style="color:#F44336;">Erreur technique: ${err.message}</p>`;
    }
}

function findPointIndexByDistance(targetDist) {
    if (allPoints.length === 0) return -1;
    let minDiff = Infinity;
    let closestIndex = -1;
    for (let i = 0; i < allPoints.length; i++) {
        const diff = Math.abs(allPoints[i].dist - targetDist);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }
    return closestIndex;
}

function drawIndicatorOnMap(xPixel, distKm) {
    if (allPoints.length === 0) return;
    const targetDist = distKm * 1000;
    const closestIndex = findPointIndexByDistance(targetDist);
    if (closestIndex >= 0) {
        const lat = allPoints[closestIndex].lat;
        const lon = allPoints[closestIndex].lon;
        if (!map.hasLayer(indicatorMarker)) {
            indicatorMarker.addTo(map);
        }
        indicatorMarker.setLatLng([lat, lon]);
        const container = document.getElementById('altitudeChartContainer');
        const indicator = document.getElementById('chart-indicator');
        const chartCanvas = document.getElementById('altitudeChart');
        if (chartCanvas && altitudeChart) {
            const xCoord = altitudeChart.scales.x.getPixelForValue(distKm);
            const rect = chartCanvas.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const relativeX = xCoord - (rect.left - containerRect.left);
            indicator.style.transform = `translateX(${relativeX}px)`;
            indicator.style.display = 'block';
        }
    }
}

function handleChartMouseMove(e) {
    if (!altitudeChart || allPoints.length === 0) return;
    const canvasRect = altitudeChart.canvas.getBoundingClientRect();
    if (e.offsetX >= altitudeChart.scales.x.left &&
        e.offsetX <= altitudeChart.scales.x.right &&
        e.offsetY >= altitudeChart.scales.y_altitude.top &&
        e.offsetY <= altitudeChart.scales.y_altitude.bottom) {
        const clickedKm = altitudeChart.scales.x.getValueForPixel(e.offsetX);
        drawIndicatorOnMap(e.offsetX, clickedKm);
    } else {
        handleChartMouseOut();
    }
}

function handleChartMouseOut() {
    const indicator = document.getElementById('chart-indicator');
    if (indicator) indicator.style.display = 'none';
    if (indicatorMarker && map.hasLayer(indicatorMarker)) {
        indicatorMarker.remove();
    }
}

function updatePoids(e) {
    userParams.poids = parseFloat(e.target.value);
    document.getElementById('poidsVal').textContent = userParams.poids + ' kg';
    drawActiveSegmentProfile();
}

function updatePuissance(e) {
    userParams.puissance = parseFloat(e.target.value);
    document.getElementById('puissanceVal').textContent = userParams.puissance + ' W';
    drawActiveSegmentProfile();
}

function updatePoidsVelo(e) {
    userParams.poids_velo = parseFloat(e.target.value);
    document.getElementById('poidsveloVal').textContent = userParams.poids_velo + ' kg';
    drawActiveSegmentProfile();
}

function updatecda(e) {
    userParams.CdA = parseFloat(e.target.value);
    document.getElementById('cdaVal').textContent = userParams.CdA;
    drawActiveSegmentProfile();
}

function updaterm(e) {
    userParams.eta_muscle = parseFloat(e.target.value/100).toFixed(2);
    document.getElementById('rmVal').textContent = (userParams.eta_muscle * 100) + '%';
}

function updatecolthresolddetection(e) {
    userParams.colthresolddetection = parseFloat(e.target.value);
    document.getElementById('colThresholdVal').textContent = userParams.colthresolddetection + '%';
    if (allPoints.length > 0) {
        allClimbs = detectClimbs(allPoints);
        document.getElementById('climbCount').textContent = allClimbs.length;
        drawAltitudeProfile(allPoints, allClimbs);
    }
}

function updatecolcontinuedetection(e) {
    userParams.colcontinuedetection = parseFloat(e.target.value);
    document.getElementById('colContinueVal').textContent = userParams.colcontinuedetection + '%';
    if (allPoints.length > 0) {
        allClimbs = detectClimbs(allPoints);
        document.getElementById('climbCount').textContent = allClimbs.length;
        drawAltitudeProfile(allPoints, allClimbs);
    }
}

function updatemaxreplatdistance(e) {
    userParams.maxreplatdistance = parseInt(e.target.value);
    document.getElementById('maxReplatDistanceVal').textContent = userParams.maxreplatdistance + ' m';
    if (allPoints.length > 0) {
        allClimbs = detectClimbs(allPoints);
        document.getElementById('climbCount').textContent = allClimbs.length;
        drawAltitudeProfile(allPoints, allClimbs);
    }
}

function updateminclimbdistance(e) {
    userParams.minclimbdistance = parseInt(e.target.value);
    document.getElementById('minClimbDistanceVal').textContent = userParams.minclimbdistance + ' m';
    if (allPoints.length > 0) {
        allClimbs = detectClimbs(allPoints);
        document.getElementById('climbCount').textContent = allClimbs.length;
        drawAltitudeProfile(allPoints, allClimbs);
    }
}

function updateslopeThreshold(e) {
    userParams.slopeThreshold = parseFloat(e.target.value);
    document.getElementById('slopeThresholdVal').textContent = userParams.slopeThreshold + '%';
    if (allPoints.length > 0) {
        allSegments = segmentTrackBySlope(allPoints, userParams.slopeThreshold, userParams.minSegmentLength);
        drawSegmentsOnMap(allSegments);
        document.getElementById('segmentCount').textContent = allSegments.length;
        rerenderSegmentListAfterSim(allSegments);
        if (numsimu > 0) {
            runSimulation();
            drawActiveSegmentProfile();
        }
    }
}

function updateminSegmentLength(e) {
    userParams.minSegmentLength = parseInt(e.target.value);
    document.getElementById('minLengthVal').textContent = userParams.minSegmentLength + ' m';
    if (allPoints.length > 0) {
        allSegments = segmentTrackBySlope(allPoints, userParams.slopeThreshold, userParams.minSegmentLength);
        drawSegmentsOnMap(allSegments);
        document.getElementById('segmentCount').textContent = allSegments.length;
        rerenderSegmentListAfterSim(allSegments);
         if (numsimu > 0) {
            runSimulation();
            drawActiveSegmentProfile();
        }
    }
}

function updateslopeSmoothingWindow(e) {
    userParams.slopeSmoothingWindow = parseFloat(e.target.value);
    document.getElementById('lissagepenteVal').textContent = userParams.slopeSmoothingWindow + '%';
    if (allPoints.length > 0) {
        smoothSlopes(allPoints, userParams.slopeSmoothingWindow);
        updateGlobalStats(allPoints);
        drawAltitudeProfile(allPoints, allClimbs);
        allSegments = segmentTrackBySlope(allPoints, userParams.slopeThreshold, userParams.minSegmentLength);
        drawSegmentsOnMap(allSegments);
        document.getElementById('segmentCount').textContent = allSegments.length;
        rerenderSegmentListAfterSim(allSegments);
         if (numsimu > 0) {
            runSimulation();
            drawActiveSegmentProfile();
        }
    }
}

function resetsegmentation() {
    userParams.slopeThreshold = 3;
    document.getElementById('slopeThreshold').value = 3;
    document.getElementById('slopeThresholdVal').textContent = '3%';
    userParams.minSegmentLength = 200;
    document.getElementById('minLength').value = 200;
    document.getElementById('minLengthVal').textContent = '200 m';
    userParams.slopeSmoothingWindow = 3;
    document.getElementById('lissagepente').value = 3;
    document.getElementById('lissagepenteVal').textContent = '3%';
    runSimulation();
}

function updateSpeed(e) {
    userParams.targetSpeed = parseFloat(e.target.value);
    document.getElementById('speedVal').textContent = userParams.targetSpeed + ' km/h';
}

function updateSimMode(e) {
    userParams.simMode = e.target.value;
    const powerDiv = document.getElementById('powerInputContainer');
    const speedDiv = document.getElementById('speedInputContainer');
    if (userParams.simMode === 'power') {
        powerDiv.style.display = 'block';
        speedDiv.style.display = 'none';
    } else {
        powerDiv.style.display = 'none';
        speedDiv.style.display = 'block';
    }
}

function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    currentFileName = file.name.replace(/\.gpx$/i, '');
    const reader = new FileReader();
    reader.onload = function(ev) {
        lastLoadedGPXText = ev.target.result;
        processGpxText(lastLoadedGPXText, currentFileName);
    };
    reader.readAsText(file);
}

function processGpxText(gpxText, fileName) {
   if (gpxLayer) {
        gpxLayer.clearLayers();
        if (map.hasLayer(gpxLayer)) {
            map.removeLayer(gpxLayer);
        }
        gpxLayer = null;
    }

    // 2. Nettoyage complet des anciens segments
    if (allSegments && allSegments.length > 0) {
        allSegments.forEach(seg => {
            if (seg.layer_fill && map.hasLayer(seg.layer_fill)) {
                map.removeLayer(seg.layer_fill);
            }
            if (seg.layer_outline && map.hasLayer(seg.layer_outline)) {
                map.removeLayer(seg.layer_outline);
            }
        });
    }
    
    // 3. Nettoyage de l'indicateur de position (au cas où)
    if (indicatorMarker && map.hasLayer(indicatorMarker)) {
        indicatorMarker.remove();
    }

    // Réinitialisation des tableaux
    allSegments = [];
    allClimbs = [];
    currentFileName = fileName;
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "application/xml");
    allPoints = parseGPX(xml);
    if (allPoints.length < 2) {
        alert("Impossible de lire les points de ce GPX.");
        return;
    }
    smoothSlopes(allPoints, 10);
    updateGlobalStats(allPoints);
    allClimbs = detectClimbs(allPoints);
    document.getElementById('climbCount').textContent = allClimbs.length;
    drawAltitudeProfile(allPoints, allClimbs);
    allSegments = segmentTrackBySlope(allPoints, 3, 500);
    document.getElementById('segmentCount').textContent = allSegments.length;
    drawSegmentsOnMap(allSegments);
    rerenderSegmentListAfterSim(allSegments);
    lastLoadedGPXText = gpxText;
}

function parseGPX(xml) {
    const points = [];
    const trkpts = xml.getElementsByTagName('trkpt');
    if (!trkpts.length) return [];
    
    let dist = 0;
    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        
        const eleNode = pt.getElementsByTagName('ele')[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

        // --- NOUVEAU : Extraction du Temps, Puissance, HR ---
        let time = null;
        const timeNode = pt.getElementsByTagName('time')[0];
        if (timeNode) {
            time = new Date(timeNode.textContent);
        }

        let power = null;
        let hr = null;
        // On cherche dans les extensions communes (Garmin, Strava, etc.)
        const extensions = pt.getElementsByTagName('extensions')[0];
        if (extensions) {
             // Essai 1 : format standard ou simple
             const powerNode = extensions.getElementsByTagName('power')[0];
             if (powerNode) power = parseFloat(powerNode.textContent);

             // Essai 2 : TrackPointExtension (souvent pour HR et Cadence)
             const tpx = extensions.getElementsByTagName('gpxtpx:TrackPointExtension')[0] || 
                         extensions.getElementsByTagName('TrackPointExtension')[0];
             if (tpx) {
                 const hrNode = tpx.getElementsByTagName('gpxtpx:hr')[0] || tpx.getElementsByTagName('hr')[0];
                 if (hrNode) hr = parseFloat(hrNode.textContent);
             }
        }
        // ----------------------------------------------------

        if (i > 0) {
            const prev = points[i-1];
            dist += distance(lat, lon, prev.lat, prev.lon);
        }
        
        points.push({
            lat: lat, lon: lon, ele: ele, dist: dist,
            time: time, power: power, hr: hr, // On stocke les nouvelles infos
            localSlope: 0, smoothedSlope: 0
        });
    }
    return points;
}

function drawSegmentsOnMap(segmentsToDraw) {
    if (gpxLayer) gpxLayer.remove();
    allSegments.forEach(seg => {
        if (seg.layer_fill) seg.layer_fill.remove();
        if (seg.layer_outline) seg.layer_outline.remove();
    });
    segmentsToDraw.forEach((segment, index) => {
        const latlngs = segment.points.map(p => [p.lat, p.lon]);
        const pentePercent = segment.avgGrade * 100;
        const color = getMainMapSegmentColor(pentePercent);
        const outlineLayer = L.polyline(latlngs, {
            color: '#FF0000', weight: 9, opacity: 0
        });
        const fillLayer = L.polyline(latlngs, {
            color: color, weight: 5, opacity: 0.8
        });
        fillLayer.on('click', (e) => {
            L.DomEvent.stop(e);
            highlightSegment(index);
        });
        outlineLayer.on('click', (e) => {
            L.DomEvent.stop(e);
            highlightSegment(index);
        });
        segment.layer_fill = fillLayer;
        segment.layer_outline = outlineLayer;
        outlineLayer.addTo(map);
        fillLayer.addTo(map);
    });
    const allLayers = segmentsToDraw.map(s => s.layer_fill);
    if (allLayers.length > 0) {
        gpxLayer = L.featureGroup(allLayers);
        map.fitBounds(gpxLayer.getBounds());
    }
}

function updateGlobalStats(points) {
    const { totalDistance, totalElevGain } = calculateTrackStats(points);
    let tabgraph = Array(20).fill(0);
    let tabdplus = Array(20).fill(0);
    let sumUpDist = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dist = distance(a.lat, a.lon, b.lat, b.lon);
        if (dist < 0.1) continue;
        const elevDiff = b.ele - a.ele;
        const pente = (elevDiff / dist) * 100;
        if (pente > 0) {
            sumUpDist += dist;
            let index = Math.floor(pente);
            if (index >= 20) index = 19;
            tabgraph[index] += dist;
        }
    }
    for (let i = 0; i < tabgraph.length; i++) {
        tabgraph[i] = Math.round(tabgraph[i]);
    }
    let dplus2 = 0;
    for (let i = 0; i < tabdplus.length; i++) {
        tabdplus[i] = Math.round(tabgraph[i] * (i + 1) / 100);
        dplus2 += tabdplus[i];
    }
    document.getElementById('distance').textContent = `🚴‍♂️ ${(totalDistance / 1000).toFixed(2)} km`;
    document.getElementById('dplus').textContent = `🏔️ ${totalElevGain.toFixed(0)} m`;
    const monteesEl = document.getElementById('montées');
    if (monteesEl) {
        monteesEl.innerHTML = `🏔️ <b>${(sumUpDist / 1000).toFixed(2)} km</b> (${((sumUpDist-tabgraph[0]-tabgraph[1])/1000).toFixed(2)}km)`;
    }
    const graphDplusEl = document.getElementById('graphDplusTotal');
    if (graphDplusEl) {
        graphDplusEl.textContent = totalElevGain.toFixed(0);
    }
    drawPenteGraph(tabgraph, tabdplus);
}

function generateSimulationJSON() {
    const parseStat = (elementId) => {
         const text = document.getElementById(elementId)?.textContent || "";
         const match = text.match(/[\d\.]+/);
         return match ? parseFloat(match[0]) : 0;
    };
    const segmentsData = allSegments.map((seg, index) => {
        return {
            segment_index: index + 1,
            start_dist_m: seg.start.dist.toFixed(2),
            end_dist_m: seg.end.dist.toFixed(2),
            distance_m: seg.distance.toFixed(2),
            pente_moyenne_pct: (seg.avgGrade * 100).toFixed(2),
            dplus_m: seg.elevGain.toFixed(2),
            puissance_w: (seg.power || 0).toFixed(1),
            vitesse_kmh: ((seg.speed * 3.6) || 0).toFixed(2),
            temps_sec: (seg.time || 0).toFixed(1),
            kcal: (seg.kcal || 0).toFixed(2),
            start_lat: seg.start.lat,
            start_lon: seg.start.lon
        };
    });
    const coldatas = allClimbs.map((col, index) => {
        return {
            col_index: index + 1,
            col_distance_m: col.distance.toFixed(2),
            col_dplus_m: col.elevGain.toFixed(2),
            col_pente_moyenne_pct: (col.avgGrade).toFixed(1),
            col_nom: col.name,
            col_start_lat: col.startPoint.lat,
            col_start_lon: col.startPoint.lon,
            col_start_dist_m: col.startPoint.dist.toFixed(2),
            col_end_dist_m: col.endPoint.dist.toFixed(2)
        };
     });
    const informations_parcours = {
        nom_fichier: currentFileName,
        date_export: new Date().toISOString(),
        distance_totale_km: parseStat('distance'),
        denivele_positif_m: parseStat('dplus')
    };
    const parametres_simulation = {
        mode_simulation: userParams.simMode,
        puissance_cible_w: userParams.puissance,
        vitesse_cible_kmh: userParams.targetSpeed,
        poids_cycliste_kg: userParams.poids,
        poids_velo_kg: userParams.poids_velo,
        cda_m2: userParams.CdA,
        rendement_muscle: userParams.eta_muscle,

        seuil_col_pente: userParams.colthresolddetection,
        seuil_col_continue: userParams.colcontinuedetection,
        max_replat_dist: userParams.maxreplatdistance,
        min_col_dist: userParams.minclimbdistance,
        seuil_segment_pente: userParams.slopeThreshold,
        min_segment_len: userParams.minSegmentLength,
        lissage_pente: userParams.slopeSmoothingWindow
    };
    const resultats_simulation = {
        temps_total_str: document.getElementById('temps').textContent.replace('⏱️','').trim(),
        vitesse_moyenne_kmh: parseStat('vitesse'),
        puissance_moyenne_w: parseStat('puissance_reelle'),
        kcal_total: parseStat('energie')
    };
    return {
        informations_parcours: informations_parcours,
        parametres_simulation: parametres_simulation,
        resultats_simulation: resultats_simulation,
        col_datas: coldatas,
        segments: segmentsData
    };
}

function runSimulation() {
    return new Promise((resolve, reject) => {
    if (allSegments.length === 0) {
        alert("Veuillez d'abord charger un fichier GPX.");
        return;
    }
    const simButton = document.getElementById('simulateBtn');
    simButton.textContent = "Calcul en cours...";
    simButton.disabled = true;
    const m_total = userParams.poids + userParams.poids_velo;
    const Crr = userParams.Crr;
    const CdA = userParams.CdA;
    const targetPower = userParams.puissance;
    const targetSpeed_kmh = userParams.targetSpeed;
    const targetSpeed_ms = targetSpeed_kmh / 3.6;
    const physicsParams = {
        mass: m_total,
        cda: CdA,
        crr: Crr,
        rho: RHO_PHYSICS,
        wind: 0,
        vmax: (100 / 3.6)
    };
    setTimeout(() => {
        try{
        if (userParams.simMode === 'power') {
            const uphillFactor = 0.18;
            const downhillFactor = 0.25;
            allSegments.forEach(s => {
                const sPerc = Math.max(Math.min(s.avgGrade * 100, 20), -20);
                let f = 1.0;
                if (sPerc > 0) f = 1 + uphillFactor * (sPerc / 5);
                else f = 1 + (sPerc / 5) * downhillFactor;
                f = Math.max(0.4, f);
                if (sPerc < -8.0) f = 30 / targetPower;
                s.power = Math.max(1, targetPower * f);
            });
            for (let iter = 0; iter < 12; iter++) {
                let totalTime = 0;
                let weightedPowerTime = 0;
                allSegments.forEach(s => {
                    const P_roue = s.power * ETA_TRANSMISSION;
                    const v = solveVitesse(P_roue, m_total, s.avgGrade, Crr, CdA);
                    s.speed = Math.min(v, physicsParams.vmax);
                    s.time = (s.speed > 0.1) ? s.distance / s.speed : 0;
                    totalTime += s.time;
                    weightedPowerTime += s.power * s.time;
                });
                const actualAvg = weightedPowerTime / Math.max(1e-6, totalTime);
                const scale = targetPower / actualAvg;
                const damping = 0.8;
                allSegments.forEach(s => {
                    s.power = Math.max(1, s.power * (1 + (scale - 1) * damping));
                });
                if (Math.abs(actualAvg - targetPower) / targetPower < 1e-3) break;
            }
        } else {
            allSegments.forEach(s => {
                const slope = s.avgGrade * 100;
                let g = 1;
                if (slope > 0) g = 1 - 0.12 * (slope / 5);
                else g = 1 + 0.2 * (Math.abs(slope) / 5);
                g = Math.max(0.45, Math.min(1.8, g));
                s.speed = Math.max(0.5, targetSpeed_ms * g);
            });
            for (let iter = 0; iter < 12; iter++) {
                let totalDist = 0;
                let weightedSpeedDist = 0;
                allSegments.forEach(s => {
                    const vCand = Math.min(s.speed, physicsParams.vmax);
                    s.speed = vCand;
                    totalDist += s.distance;
                    weightedSpeedDist += s.speed * s.distance;
                });
                const actualAvgV = weightedSpeedDist / Math.max(1e-6, totalDist);
                const scale = targetSpeed_ms / actualAvgV;
                const damp = 0.8;
                allSegments.forEach(s => {
                    s.speed = Math.max(0.5, s.speed * (1 + (scale - 1) * damp));
                });
                if (Math.abs(actualAvgV - targetSpeed_ms) / targetSpeed_ms < 1e-3) break;
            }
            allSegments.forEach(s => {
                const P_roue = powerFromSpeed(s.speed, s.avgGrade, physicsParams);
                s.power = Math.max(0, P_roue / ETA_TRANSMISSION);
                s.time = (s.speed > 0.1) ? s.distance / s.speed : 0;
            });
        }
        let totalTime = 0;
        let totalKcal = 0;
        let totalDist = 0;
        let totalPowerWatts = 0;
        let totalPowerTimeSec = 0;
        let W_prime = userParams.W_prime_max;
        let speed_history = [];
        let cumTime = 0;
        let cumDistance = 0;
        let maxSpeedEstimate = 0;
        const HISTORY_STEP_TIME = 60;
        let nextHistoryTime = HISTORY_STEP_TIME;
        allSegments.forEach(segment => {
            const P_segment = segment.power;
            const v = segment.speed;
            const t = segment.time;
            const d_seg = segment.distance;
            segment.W_prime_start = W_prime;
            const kcal_segment = calculateKcal(P_segment, t, userParams.eta_muscle);
            W_prime = calculateWPrime(P_segment, t, W_prime, userParams.CP, userParams.W_prime_max, userParams.tau_rec);
            segment.points.forEach((point, p_idx) => {
                if (p_idx === 0) return;
                const p_prev = segment.points[p_idx - 1];
                const sub_d = point.dist - p_prev.dist;
                const sub_t = (v > 0.1) ? (sub_d / v) : 0;
                cumTime += sub_t;
                cumDistance += sub_d;
                if (cumTime >= nextHistoryTime || p_idx === segment.points.length - 1) {
                    const avgSpeedCumul = cumTime > 0 ? (cumDistance / cumTime) * 3.6 : 0;
                    if (avgSpeedCumul > maxSpeedEstimate) maxSpeedEstimate = avgSpeedCumul;
                    speed_history.push({
                        time_start_sec: cumTime - sub_t,
                        time_end_sec: cumTime,
                        speed_kmh: avgSpeedCumul,
                        altitude_m: point.ele
                    });
                    nextHistoryTime = Math.ceil(cumTime / HISTORY_STEP_TIME) * HISTORY_STEP_TIME;
                }
            });
            if (P_segment > 0 && t > 0) {
                totalPowerWatts += P_segment * t;
                totalPowerTimeSec += t;
            }
            segment.kcal = kcal_segment;
            segment.W_prime_end = W_prime;
            totalTime += t;
            totalDist += d_seg;
            totalKcal += kcal_segment;
        });
        rerenderSegmentListAfterSim(allSegments);
        const realAvgPower = totalPowerTimeSec > 0 ? totalPowerWatts / totalPowerTimeSec : 0;
        const vitesseMoy_kmh = (totalDist / totalTime) * 3.6;
        document.getElementById('vitesse').textContent = `🚴 ${vitesseMoy_kmh.toFixed(1)} km/h`;
        document.getElementById('puissance_reelle').textContent = `⚡ ${realAvgPower.toFixed(0)} W`;
        document.getElementById('energie').textContent = `🔥 ${totalKcal.toFixed(0)} kcal`;
        document.getElementById('temps').textContent = `⏱️ ${secondsToHHMMSS(totalTime)}`;
        simButton.textContent = "Simuler";
        simButton.disabled = false;
        drawActiveSegmentProfile();
        allSegments.speed_history = speed_history;
        allSegments.maxSpeedEstimate = maxSpeedEstimate;
        lastSimulationJSON = generateSimulationJSON();
        resolve(lastSimulationJSON);}
        catch(error){
            console.error("Simulation error:", error);
            simButton.textContent = "Simuler";
            simButton.disabled = false;
            reject(error);

        }
    }, 50);
});
}

function secondsToHHMMSS(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const m = String(minutes).padStart(2, '0');
    const s = String(seconds).padStart(2, '0');
    return `${hours}:${m}:${s}`;
}

function drawAltitudeProfile(pointsData, climbs = [], speedData = null, minSpeed = null, maxSpeed = null) {
    const canvas = document.getElementById('altitudeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error("Impossible d'obtenir le contexte 2D pour altitudeChart.");
        return;
    }
    const indicator = document.getElementById('chart-indicator');
    if (!indicator) {
        const newIndicator = document.createElement('div');
        newIndicator.id = 'chart-indicator';
        document.getElementById('altitudeChartContainer').appendChild(newIndicator);
    }
    canvas.style.opacity = 0;
    setTimeout(() => {
        if (altitudeChart) {
            altitudeChart.destroy();
        }
        const labels = pointsData.map(p => p.dist / 1000);
        const data = pointsData.map(p => p.ele);
        const climbAnnotations = climbs.map((col, index) => {
            return {
                type: 'box',
                xMin: col.startPoint.dist / 1000,
                xMax: col.endPoint.dist / 1000,
                backgroundColor: 'rgba(255, 145, 0, 0.25)',
                borderColor: 'rgba(255, 145, 0, 0.6)',
                borderWidth: 1,
                id: `col-${index}`,
                click: function(context) {
                    showColDetail(index);
                }
            };
        });
        const datasets = [
            {
                label: 'Altitude (m)',
                data: data,
                borderColor: '#ff9100',
                borderWidth: 2,
                fill: true,
                backgroundColor: 'rgba(255, 145, 0, 0.2)',
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y_altitude'
            }
        ];
        if (speedData) {
            datasets.push({
                label: 'Vitesse Estimée (km/h)',
                data: speedData,
                borderColor: '#00d0ff',
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y_speed'
            });
        }
        altitudeChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Distance (km)', color: '#ccc' },
                        ticks: { color: '#ccc' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    y_altitude: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Altitude (m)', color: '#ff9100' },
                        ticks: { color: '#ff9100' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    y_speed: (speedData && minSpeed !== null && maxSpeed !== null) ? {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Vitesse (km/h)', color: '#00d0ff' },
                        ticks: { color: '#00d0ff' },
                        grid: { drawOnChartArea: false },
                        min: Math.max(0, Math.floor(minSpeed - 2)),
                        max: Math.ceil(maxSpeed + 2)
                    } : { display: false }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#ccc' }
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: (tooltipItems) => {
                                const dist = tooltipItems[0].parsed.x;
                                return `Km ${dist.toFixed(2)}`;
                            }
                        }
                    },
                    annotation: {
                        annotations: climbAnnotations
                    }
                }
            }
        });
        canvas.style.opacity = 1;
    }, 250);
}

const smoothData = (data, windowSize = 5) => {
    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(data.length - 1, i + Math.ceil(windowSize / 2) - 1);
        let sum = 0;
        let count = 0;
        for (let j = start; j <= end; j++) {
            sum += data[j].y;
            count++;
        }
        smoothed.push({ x: data[i].x, y: sum / count });
    }
    return smoothed;
};

function drawSpeedTimeChart(segments) {
    const canvas = document.getElementById('powerTimeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const speedHistory = segments.speed_history || [];
    if (speedTimeChart) {
        speedTimeChart.destroy();
    }
    const speedDataPoints = [];
    const altitudeDataPoints = [];
    let minAltitude = Infinity;
    let maxAltitude = -Infinity;
    if (allPoints.length > 0) {
        const startAltitude = allPoints[0].ele;
        minAltitude = Math.min(minAltitude, startAltitude);
        maxAltitude = Math.max(maxAltitude, startAltitude);
        const startSpeed = speedHistory.length > 0 ? speedHistory[0].speed_kmh : 0;
        speedDataPoints.push({x: 0, y: startSpeed});
        altitudeDataPoints.push({x: 0, y: startAltitude});
    }
    for (const item of speedHistory) {
        const time_end_h = item.time_end_sec / 3600;
        speedDataPoints.push({ x: time_end_h, y: item.speed_kmh });
        altitudeDataPoints.push({ x: time_end_h, y: item.altitude_m });
        minAltitude = Math.min(minAltitude, item.altitude_m);
        maxAltitude = Math.max(maxAltitude, item.altitude_m);
    }
    const smoothedSpeedDataPoints = smoothData(speedDataPoints, 5);
    const maxTimeH = speedHistory.length > 0 ? speedHistory[speedHistory.length - 1].time_end_sec / 3600 : 1;
    const maxSpeedEstimate = segments.maxSpeedEstimate || 30;
    const altMin = (minAltitude !== Infinity) ? Math.floor(minAltitude / 50) * 50 : 0;
    const altMax = (maxAltitude !== -Infinity) ? Math.ceil(maxAltitude / 50) * 50 : 500;
    speedTimeChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Vitesse Moyenne Estimée (km/h)',
                    data: smoothedSpeedDataPoints,
                    backgroundColor: 'rgba(0, 208, 255, 0.6)',
                    borderColor: '#00d0ff',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.2,
                    stepped: false,
                    fill: false,
                    yAxisID: 'y_speed'
                },
                {
                    label: 'Altitude (m)',
                    data: altitudeDataPoints,
                    backgroundColor: 'rgba(255, 145, 0, 0.2)',
                    borderColor: '#ff9100',
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.4,
                    fill: 'origin',
                    yAxisID: 'y_alt'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y_speed: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Vitesse Moyenne Cumulée (km/h)', color: '#00d0ff' },
                    ticks: { color: '#00d0ff' },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    min: 0,
                    max: Math.ceil(maxSpeedEstimate + 5),
                    beginAtZero: true
                },
                y_alt: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Altitude (m)', color: '#ff9100' },
                    ticks: { color: '#ff9100' },
                    grid: { drawOnChartArea: false },
                    min: altMin,
                    max: altMax,
                },
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Temps de Selle (heures)', color: '#ccc' },
                    ticks: {
                        color: '#ccc',
                        callback: function(value, index, values) {
                            if (value === 0) return 'Départ';
                            const totalSeconds = value * 3600;
                            const hours = Math.floor(totalSeconds / 3600);
                            const minutes = Math.floor((totalSeconds % 3600) / 60);
                            if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
                            return `${minutes}m`;
                        }
                    },
                    min: 0,
                    max: maxTimeH,
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: { display: true, labels: { color: '#ccc' } },
                title: {
                    display: true,
                    color: '#f2f2f2',
                    font: { size: 16 }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                if (context.dataset.yAxisID === 'y_speed') {
                                     label += context.parsed.y.toFixed(2) + ' km/h';
                                } else {
                                     label += context.parsed.y.toFixed(0) + ' m';
                                }
                            }
                            return label;
                        },
                        title: function(context) {
                            const timeH = context[0].parsed.x;
                            const totalSeconds = timeH * 3600;
                            return `Temps Cumulé: ${secondsToHHMMSS(totalSeconds)}`;
                        }
                    }
                }
            }
        }
    });
}

function showColDetail(colIndex) {
    if (colIndex < 0 || colIndex >= allClimbs.length) return;
    const col = allClimbs[colIndex];
    const segmentLength = 100;
    const segmentedData = segmentColForProfile(col.points, segmentLength);
    document.getElementById('colDetailModal').classList.add('visible');
    setTimeout(() => {
        drawColDetailProfile(segmentedData, col.name, col.avgGrade, col.distance, col.elevGain);
    }, 50);
}

function segmentColForProfile(points, segmentLength = 1000) {
    if (!points || points.length < 2) return { distLabels: [], slopeLabels: [], altitudeData: [], rawSlopes: [] };
    const distLabels = [];
    const slopeLabels = [];
    const altitudeData = [];
    const rawSlopes = [];
    const startDist = points[0].dist;
    let nextMarker = segmentLength;
    let segmentStartPoint = points[0];
    distLabels.push(0);
    slopeLabels.push('Départ');
    altitudeData.push(points[0].ele);
    rawSlopes.push(0);
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        const distInClimb = point.dist - startDist;
        if (distInClimb >= nextMarker || i === points.length - 1) {
            const d = point.dist - segmentStartPoint.dist;
            const e = point.ele - segmentStartPoint.ele;
            const avgGrade = (d > 0) ? (e / d) * 100 : 0;
            distLabels.push((distInClimb / 1000).toFixed(1));
            slopeLabels.push(`${avgGrade.toFixed(1)}%`);
            altitudeData.push(point.ele);
            rawSlopes.push(avgGrade);
            nextMarker += segmentLength;
            segmentStartPoint = point;
        }
    }
    return { distLabels, slopeLabels, altitudeData, rawSlopes };
}

function drawColDetailProfile(data, colName, avgGrade, totalDist, totalElev) {
    const canvas = document.getElementById('colDetailChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    document.getElementById('colDetailTitle').textContent =
        `${colName}: ${(totalDist/1000).toFixed(1)} km à ${avgGrade.toFixed(1)}% (${totalElev.toFixed(0)}m D+)`;
    if (colDetailChart) {
        colDetailChart.destroy();
    }
    const validAltitudes = data.altitudeData.filter(a => a !== null);
    const minAltitude = validAltitudes.length > 0 ? Math.min(...validAltitudes) : 0;
    const maxAltitude = validAltitudes.length > 0 ? Math.max(...validAltitudes) : 0;
    const baseAltitude = minAltitude - (maxAltitude - minAltitude) * 0.1;
    colDetailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.distLabels,
            datasets: [{
                label: 'Altitude (m)',
                data: data.altitudeData,
                borderColor: '#333',
                borderWidth: 2,
                fill: 'start',
                tension: 0.1,
                pointRadius: 0,
                segment: {
                    backgroundColor: (ctx) => {
                        const index = ctx.p0DataIndex;
                        if (data.rawSlopes && index < data.rawSlopes.length) {
                            const slope = data.rawSlopes[index];
                            return getClimbProfileSlopeColor(slope);
                        }
                        return 'rgba(150, 150, 150, 0.1)';
                    }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    title: { display: true, text: 'Altitude (m)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    min: baseAltitude,
                    max: maxAltitude + (maxAltitude - minAltitude) * 0.05
                },
                x: {
                    title: { display: true, text: 'Distance (km)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        footer: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            if (data.rawSlopes && index < data.rawSlopes.length) {
                                const slope = data.rawSlopes[index];
                                return `Pente: ${slope.toFixed(1)}%`;
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

function deselectAllSegments() {
    if (activeSegmentIndex === null) return;
    activeSegmentIndex = null;
    document.querySelectorAll('#segmentTableBody tr').forEach(row => {
        row.classList.remove('highlighted');
    });
    allSegments.forEach(seg => {
        if (seg.layer_outline) {
            seg.layer_outline.setStyle({ opacity: 0 });
        }
    });
    drawAltitudeProfile(allPoints, allClimbs);
    if (gpxLayer) {
        map.fitBounds(gpxLayer.getBounds());
    }
}

function drawPenteGraph(tabgraphData, tabgraphdplus) {
    const canvas = document.getElementById('penteGraph');
    if (!canvas) {
        console.error("Erreur : Impossible de trouver l'élément canvas #penteGraph.");
        return;
    }
    const ctx = canvas.getContext('2d');
    const labels = [];
    for (let i = 0; i < 19; i++) {
        labels.push(`${i+1}%`);
    }
    labels.push('19%+');
    if (myPenteChart) {
        myPenteChart.destroy();
    }
    myPenteChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Distance en Montée (m)',
                    data: tabgraphData,
                    backgroundColor: '#ff6a00',
                    yAxisID: 'y_dist'
                },
                {
                    label: 'Dénivelé Positif (m)',
                    data: tabgraphdplus,
                    backgroundColor: '#007bff',
                    yAxisID: 'y_dplus'
                }
            ]
        },
        options: {
            scales: {
                y_dist: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Distance (m)', color: '#ccc' },
                    ticks: { callback: function(value) { return value.toFixed(0); }, color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                y_dplus: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Dénivelé (m)', color: '#ccc' },
                    grid: { drawOnChartArea: false },
                    ticks: { callback: function(value) { return value.toFixed(0); }, color: '#ccc' }
                },
                x: {
                    title: { display: true, text: 'Pente (%)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#ccc' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(0);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function highlightSegment(segmentIndex) {
    if (segmentIndex === activeSegmentIndex) {
        deselectAllSegments();
        return;
    }
    activeSegmentIndex = segmentIndex;
    document.querySelectorAll('#segmentTableBody tr').forEach((row, idx) => {
        row.classList.toggle('highlighted', idx === segmentIndex);
        if (idx === segmentIndex) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    allSegments.forEach((seg, idx) => {
        if (seg.layer_fill && seg.layer_outline) {
            if (idx === segmentIndex) {
                seg.layer_outline.setStyle({ opacity: 0.8 });
                seg.layer_outline.bringToFront();
                seg.layer_fill.bringToFront();
                map.fitBounds(seg.layer_fill.getBounds(), { maxZoom: 16, padding: [20, 20] });
            } else {
                seg.layer_outline.setStyle({ opacity: 0 });
            }
        }
    });
    drawActiveSegmentProfile();
}

function drawActiveSegmentProfile() {
    if (activeSegmentIndex === null || activeSegmentIndex >= allSegments.length) return;
    let segmentPoints = allSegments[activeSegmentIndex].points;
    const MIN_POINTS_FOR_GRAPH = 30;
    if (segmentPoints.length > 1 && segmentPoints.length < MIN_POINTS_FOR_GRAPH) {
        segmentPoints = interpolateSegmentPoints(segmentPoints, MIN_POINTS_FOR_GRAPH);
    }
    const m_total = userParams.poids + userParams.poids_velo;
    const W_prime_start = allSegments[activeSegmentIndex].W_prime_start || userParams.W_prime_max;
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    const speedData = segmentPoints.map(p => {
        const pente_decimal = p.smoothedSlope / 100;
        let P_to_calc = userParams.puissance;
        if (userParams.simMode === 'power') {
             const pseudoSegment = { avgGrade: pente_decimal, distance: 100 };
             P_to_calc = userParams.puissance;
        }
        if (userParams.simMode === 'speed') {
            P_to_calc = userParams.puissance;
        }
        const P_roue = P_to_calc * ETA_TRANSMISSION;
        const v_ms = solveVitesse(P_roue, m_total, pente_decimal, userParams.Crr, userParams.CdA);
        const v_kmh = v_ms * 3.6;
        if (v_kmh < minSpeed) minSpeed = v_kmh;
        if (v_kmh > maxSpeed) maxSpeed = v_kmh;
        return v_kmh;
    });
    drawAltitudeProfile(segmentPoints, [], speedData, minSpeed, maxSpeed);
}

function interpolateSegmentPoints(points, targetPointCount) {
    if (points.length < 2) return points;
    const interpolatedPoints = [];
    const totalDistance = points[points.length - 1].dist - points[0].dist;
    const stepDistance = (totalDistance > 0 && targetPointCount > 1) ? totalDistance / (targetPointCount - 1) : 0;
    let currentDist = points[0].dist;
    let pointIndex = 1;
    interpolatedPoints.push(points[0]);
    for (let i = 1; i < targetPointCount - 1; i++) {
        currentDist += stepDistance;
        while (pointIndex < points.length - 1 && points[pointIndex].dist < currentDist) {
            pointIndex++;
        }
        const p1 = points[pointIndex - 1];
        const p2 = points[pointIndex];
        const distBetweenPoints = p2.dist - p1.dist;
        if (distBetweenPoints < 0.01) {
            interpolatedPoints.push({...p1, dist: currentDist});
            continue;
        }
        const t = (currentDist - p1.dist) / distBetweenPoints;
        const interp_lat = p1.lat + (p2.lat - p1.lat) * t;
        const interp_lon = p1.lon + (p2.lon - p1.lon) * t;
        const interp_ele = p1.ele + (p2.ele - p1.ele) * t;
        const interp_smoothed_slope = p1.smoothedSlope + (p2.smoothedSlope - p1.smoothedSlope) * t;
        const interp_local_slope = p1.localSlope + (p2.localSlope - p1.localSlope) * t;
        interpolatedPoints.push({
            lat: interp_lat,
            lon: interp_lon,
            ele: interp_ele,
            dist: currentDist,
            smoothedSlope: interp_smoothed_slope,
            localSlope: interp_local_slope
        });
    }
    interpolatedPoints.push(points[points.length - 1]);
    return interpolatedPoints;
}

function exportSegmentsToJSON() {
    if (numsimu === 0) {
        alert("Veuillez d'abord 'Simuler' pour générer des données à exporter.");
        return;
    }
    const dataToExport = lastSimulationJSON;
    const jsonData = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName}_efforts.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}

function rerenderSegmentListAfterSim(segmentsToDraw) {
    const tableBody = document.getElementById('segmentTableBody');
    tableBody.innerHTML = '';
    segmentsToDraw.forEach((segment, index) => {
        const tr = document.createElement('tr');
        const distKm = (segment.distance / 1000).toFixed(2);
        const pentePct = (segment.avgGrade * 100);
        const dplus = segment.elevGain.toFixed(0);
        const power = (segment.power || 0).toFixed(0);
        const speedKmh = (segment.speed * 3.6 || 0).toFixed(1);
        const timeSec = (segment.time || 0).toFixed(0);
        const kcal = (segment.kcal || 0).toFixed(0);
        let slopeClass = '';
        if (pentePct > 10) slopeClass = 'pente-z6';
        else if (pentePct > 8)  slopeClass = 'pente-z5';
        else if (pentePct > 5)  slopeClass = 'pente-z4';
        else if (pentePct > 3)  slopeClass = 'pente-z3';
        else if (pentePct > 1)  slopeClass = 'pente-z2';
        else if (pentePct > -1) slopeClass = 'pente-z1';
        else if (pentePct > -4) slopeClass = 'pente-d1';
        else slopeClass = 'pente-d2';
        tr.className = slopeClass;
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${distKm} km</td>
            <td>${pentePct.toFixed(1)} %</td>
            <td>${dplus} m</td>
            <td>${power} W</td>
            <td>${speedKmh} km/h</td>
            <td>${timeSec} s</td> <td>${kcal} kcal</td>
        `;
        tr.addEventListener('click', () => {
            highlightSegment(index);
        });
        tableBody.appendChild(tr);
    });
}

function getMainMapSegmentColor(slope) {
    const mode = document.getElementById('colorMode').value;
    switch (mode) {
        case 'mode1':
            if (slope > 12) return '#ff00ff';
            if (slope > 9)  return '#660066';
            if (slope > 6)  return '#993366';
            if (slope > 3)  return '#996633';
            if (slope > 0)  return '#999933';
            if (slope > -3) return '#339966';
            if (slope > -6) return '#336699';
            return '#001966';
        case 'mode2':
            if (slope > 12) return '#4c0000';
            if (slope > 9)  return '#660000';
            if (slope > 6)  return '#991919';
            if (slope > 3)  return '#993333';
            if (slope > 0)  return '#994c4c';
            if (slope > -3) return '#996666';
            if (slope > -6) return '#997373';
            return '#997979';
        case 'mode3':
            if (slope > 12) return '#003300';
            if (slope > 9)  return '#004c00';
            if (slope > 6)  return '#196619';
            if (slope > 3)  return '#339933';
            if (slope > 0)  return '#4c994c';
            if (slope > -3) return '#66cc66';
            if (slope > -6) return '#73e673';
            return '#79f279';
        case 'mode4':
            if (slope > 12) return '#00004c';
            if (slope > 9)  return '#000066';
            if (slope > 6)  return '#1919cc';
            if (slope > 3)  return '#3333cc';
            if (slope > 0)  return '#4c4ccc';
            if (slope > -3) return '#6666cc';
            if (slope > -6) return '#7373e6';
            return '#7979f2';
        case 'mode5':
            if (slope > 12) return '#000000';
            if (slope > 9)  return '#191919';
            if (slope > 6)  return '#333333';
            if (slope > 3)  return '#4c4c4c';
            if (slope > 0)  return '#666666';
            if (slope > -3) return '#737373';
            if (slope > -6) return '#797979';
            return '#cccccc';
    }
}

function getClimbProfileSlopeColor(slope) {
    if (slope > 10) return '#b71c1c';
    if (slope > 8)  return '#e53935';
    if (slope > 6)  return '#fb8c00';
    if (slope > 4)  return '#fdd835';
    if (slope > 2)  return '#7cb342';
    if (slope > 0)  return '#43a047';
    return '#2e7d32';
}

function showStageProfileModal() {
    if (allPoints.length < 2) {
        alert("Veuillez d'abord charger un fichier GPX.");
        return;
    }
    document.getElementById('stageProfileModal').classList.add('visible');
    setTimeout(() => {
        drawStageProfileChart(allPoints, allClimbs);
    }, 50);
}

function drawStageProfileChart(points, climbs) {
    const canvas = document.getElementById('stageProfileChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const sliderYMin = document.getElementById('stageYMin');
    const sliderYMax = document.getElementById('stageYMax');
    const labelYMin = document.getElementById('stageYMinVal');
    const labelYMax = document.getElementById('stageYMaxVal');
    const resetZoomBtn = document.getElementById('resetStageZoomBtn');
    if (stageProfileChart) stageProfileChart.destroy();
    const profileData = points.map(p => ({ x: p.dist / 1000, y: p.ele }));
    const allElevations = profileData.map(p => p.y);
    const minEle = Math.min(...allElevations);
    const maxEle = Math.max(...allElevations);
    const eleRange = maxEle - minEle;
    const initialYMin = Math.max(0, Math.floor(minEle - Math.max(20, eleRange * 0.1)));
    const initialYMax = Math.ceil(maxEle + Math.max(20, eleRange * 0.1));
    const sliderMin_Min = 0;
    const sliderMin_Max = Math.ceil(maxEle);
    const sliderMax_Min = Math.floor(minEle);
    const sliderMax_Max = Math.ceil(maxEle + Math.max(100, eleRange * 1.0));
    let yStepSize = 500;
    if (eleRange <= 2000) yStepSize = 250;
    if (eleRange <= 1000) yStepSize = 100;
    if (eleRange <= 200) yStepSize = 50;
    if (eleRange <= 50) yStepSize = 10;
    const minorStep = Math.max(2, yStepSize / 5);
    const climbAnnotations = {};
    const usedY = [];
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#fff0e7');
    gradient.addColorStop(1, '#FFD100');
    climbs.forEach((col, index) => {
        const startKm = col.startPoint.dist / 1000;
        const startEle = col.startPoint.ele;
        const endKm = col.endPoint.dist / 1000;
        const summitEle = col.endPoint.ele;
        const labelText = [
            `⛰️ ${col.name.toUpperCase()}`,
            `${summitEle.toFixed(0)} m`,
            `${(col.distance / 1000).toFixed(1)} km à ${col.avgGrade.toFixed(1)}%`
        ];
        let summitLabelY = summitEle + (initialYMax - initialYMin) * 0.1;
        while (usedY.some(y => Math.abs(y - summitLabelY) < 150)) {
            summitLabelY += 150;
        }
        usedY.push(summitLabelY);
        climbAnnotations[`col-line-${index}`] = {
            type: 'line',
            xMin: endKm, xMax: endKm,
            yMin: 0,
            yMax: summitLabelY - 50,
            borderColor: 'rgba(0, 0, 0, 0.7)',
            borderWidth: 1,
            borderDash: [6, 6]
        };
        climbAnnotations[`col-label-${index}`] = {
            type: 'label',
            xValue: endKm,
            yValue: summitLabelY,
            backgroundColor: '#fff',
            borderColor: '#FFD100',
            borderWidth: 1.5,
            borderRadius: 6,
            content: labelText,
            color: '#000',
            font: { size: 12, weight: 'bold', family: 'Arial' },
            padding: 6,
            yAdjust: -15,
            textAlign: 'center',
            position: 'center'
        };
        climbAnnotations[`col-start-${index}`] = {
            type: 'label',
            xValue: startKm,
            yValue: startEle + 180,
            content: [`${startEle.toFixed(0)} m`],
            color: '#444',
            backgroundColor: 'transparent',
            font: { size: 11, family: 'Arial' },
            textAlign: 'center',
            position: 'center',
            rotation: -90
        };
        climbAnnotations[`start-line-${index}`] = {
            type: 'line',
            xMin: startKm, xMax: startKm,
            yMin: 0, yMax: startEle + 100,
            borderColor: 'rgba(0, 0, 0, 0.5)',
            borderWidth: 1,
            borderDash: [5, 5]
        };
    });
    const minDist = profileData[0].x;
    const maxDist = profileData.at(-1).x;
    const xPadding = (maxDist - minDist) * 0.01;
    const chartMinX = minDist - xPadding;
    const chartMaxX = maxDist + xPadding;
    climbAnnotations['start-line'] = {
        type: 'line',
        xMin: profileData[0].x,
        xMax: profileData[0].x,
        yMin: 0,
        yMax: initialYMax * 0.8,
        borderColor: '#0077cc',
        borderWidth: 2,
        borderDash: [6, 4]
    };
    climbAnnotations['start-label'] = {
        type: 'label',
        xValue: profileData[0].x + xPadding * 0.5,
        yValue: initialYMax * 0.85,
        backgroundColor: '#0077cc',
        color: '#fff',
        borderRadius: 5,
        font: { weight: 'bold', size: 12 },
        content: [`🏁 DÉPART`, `${profileData[0].y.toFixed(0)} m`],
        padding: 5,
        rotation: -90
    };
    climbAnnotations['end-line'] = {
        type: 'line',
        xMin: maxDist,
        xMax: maxDist,
        yMin: 0,
        yMax: initialYMax * 0.8,
        borderColor: '#c00',
        borderWidth: 2,
        borderDash: [6, 4]
    };
    climbAnnotations['end-label'] = {
        type: 'label',
        xValue: maxDist - xPadding * 0.5,
        yValue: initialYMax * 0.85,
        backgroundColor: '#c00',
        color: '#fff',
        borderRadius: 5,
        font: { weight: 'bold', size: 12 },
        content: [`ARRIVÉE 🏁`, `${profileData.at(-1).y.toFixed(0)} m`],
        padding: 5,
        rotation: -90
    };
    stageProfileChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Altitude',
                data: profileData,
                borderColor: '#b58900',
                borderWidth: 1.4,
                fill: true,
                backgroundColor: gradient,
                pointRadius: 0,
                tension: 0.25
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Distance (km)', color: '#555' },
                    ticks: { color: '#555' },
                    grid: { display: false },
                    min: chartMinX,
                    max: chartMaxX
                },
                y: {
                    title: { display: true, text: 'Altitude (m)', color: '#555' },
                    ticks: { color: '#555', stepSize: yStepSize },
                    grid: { display: false },
                    min: initialYMin,
                    max: initialYMax
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true, mode: 'index', intersect: false },
                annotation: {
                    annotations: climbAnnotations,
                    drawTime: 'afterDraw'
                }
            },
            layout: { padding: 10 },
            animation: false
        },
        plugins: [
            {
                id: 'minorGrid',
                afterDatasetsDraw(chart) {
                    const yScale = chart.scales.y;
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 0.6;
                    ctx.setLineDash([2, 4]);
                    const chartArea = chart.chartArea;
                    for (let y = yScale.min; y <= yScale.max; y += minorStep) {
                        const yPix = yScale.getPixelForValue(y);
                        ctx.beginPath();
                        ctx.moveTo(chartArea.left, yPix);
                        ctx.lineTo(chartArea.right, yPix);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            },
            {
                id: 'canvasBackgroundColor',
                beforeDraw: (chart) => {
                    const {ctx, width, height} = chart;
                    ctx.save();
                    ctx.globalCompositeOperation = 'destination-over';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.restore();
                }
            }
        ]
    });
    sliderYMin.min = sliderMin_Min;
    sliderYMin.max = sliderMin_Max;
    sliderYMin.value = initialYMin;
    labelYMin.textContent = initialYMin;
    sliderYMax.min = sliderMax_Min;
    sliderYMax.max = sliderMax_Max;
    sliderYMax.value = initialYMax;
    labelYMax.textContent = initialYMax;
    sliderYMin.addEventListener('input', (e) => {
        let newMin = parseInt(e.target.value);
        let currentMax = parseInt(sliderYMax.value);
        if (newMin >= currentMax) {
            newMin = currentMax - 1;
            e.target.value = newMin;
        }
        labelYMin.textContent = newMin;
        stageProfileChart.options.scales.y.min = newMin;
        stageProfileChart.update();
    });
    sliderYMax.addEventListener('input', (e) => {
        let newMax = parseInt(e.target.value);
        let currentMin = parseInt(sliderYMin.value);
        if (newMax <= currentMin) {
            newMax = currentMin + 1;
            e.target.value = newMax;
        }
        labelYMax.textContent = newMax;
        stageProfileChart.options.scales.y.max = newMax;
        stageProfileChart.update();
    });
    resetZoomBtn.addEventListener('click', () => {
        sliderYMin.value = initialYMin;
        sliderYMax.value = initialYMax;
        labelYMin.textContent = initialYMin;
        labelYMax.textContent = initialYMax;
        stageProfileChart.options.scales.y.min = initialYMin;
        stageProfileChart.options.scales.y.max = initialYMax;
        stageProfileChart.update();
    });
    const downloadBtn = document.getElementById('downloadStageBtn');
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.download = `${currentFileName}_profil_etape.png`;
            link.href = stageProfileChart.toBase64Image('image/png', 1.0);
            link.click();
        };
    }
}

// /main.js - CORRECTION de la fonction saveCurrentSimulation()

async function saveCurrentSimulation() {
    if (!lastSimulationJSON) {
        alert("Veuillez d'abord lancer une simulation pour pouvoir la sauvegarder.");
        return;
    }

    if (lastSimulationJSON.resultats_simulation.temps_total_str === "--:--" || 
        lastSimulationJSON.resultats_simulation.vitesse_moyenne_kmh === 0) {
        alert("La simulation semble vide. Lancez le calcul avant de sauvegarder.");
        return;
    }

    // Création d'un nom par défaut avec l'heure pour éviter les doublons
    const timestamp = new Date().toLocaleTimeString('fr-FR').replace(/:/g, '-');
    let defaultName = `${currentFileName}_Simu_${timestamp}`;
    
    const simName = prompt("Nom de la simulation :", defaultName);
    if (!simName) return; // Annulé par l'utilisateur

    try {
        // CORRECTION : Extraction correcte des stats depuis lastSimulationJSON
        const stats = {
             totalDistance: lastSimulationJSON.informations_parcours.distance_totale_km * 1000,
             totalElevGain: lastSimulationJSON.informations_parcours.denivele_positif_m,
             // CORRECTION : Extraction correcte des résultats de simulation
             sim_time_str: lastSimulationJSON.resultats_simulation.temps_total_str,
             sim_avg_speed: parseFloat(lastSimulationJSON.resultats_simulation.vitesse_moyenne_kmh),
             sim_avg_power: parseFloat(lastSimulationJSON.resultats_simulation.puissance_moyenne_w),
             sim_kcal: parseFloat(lastSimulationJSON.resultats_simulation.kcal_total)
        };

        // Vérification que les valeurs sont bien extraites (debug)
        console.log("Stats à sauvegarder:", stats);

        // Sauvegarde dans la DB (type 'simulation')
        await saveFileToDB('simulation', simName, lastSimulationJSON, stats);
        
        alert("✅ Simulation sauvegardée avec succès dans la bibliothèque !");
        
    } catch (e) {
        console.error("Erreur sauvegarde simulation:", e);
        alert("Erreur lors de la sauvegarde : " + e.message);
    }
}


async function restoreSimulation(simData) {
    if (!simData || !simData.parametres_simulation) {
        alert("Données de simulation invalides.");
        return;
    }

    // 1. Restauration des paramètres (Mise à jour de l'objet global + UI)
    const params = simData.parametres_simulation;
    
    // --- Paramètres Physiques ---
    userParams.simMode = params.mode_simulation || 'power';
    userParams.puissance = parseFloat(params.puissance_cible_w) || 250;
    userParams.targetSpeed = parseFloat(params.vitesse_cible_kmh) || 30;
    userParams.poids = parseFloat(params.poids_cycliste_kg) || 70;
    userParams.poids_velo = parseFloat(params.poids_velo_kg) || 8;
    userParams.CdA = parseFloat(params.cda_m2) || 0.35;
    userParams.eta_muscle = parseFloat(params.rendement_muscle) || 0.24;

    document.getElementById('simMode').value = userParams.simMode;
    updateSimMode({ target: { value: userParams.simMode } }); // Force la mise à jour UI
    document.getElementById('puissance').value = userParams.puissance;
    document.getElementById('puissanceVal').textContent = userParams.puissance + ' W';
    document.getElementById('speed').value = userParams.targetSpeed;
    document.getElementById('speedVal').textContent = userParams.targetSpeed + ' km/h';
    document.getElementById('poids').value = userParams.poids;
    document.getElementById('poidsVal').textContent = userParams.poids + ' kg';
    document.getElementById('poidsvelo').value = userParams.poids_velo;
    document.getElementById('poidsveloVal').textContent = userParams.poids_velo + ' kg';
    document.getElementById('cda').value = userParams.CdA;
    document.getElementById('cdaVal').textContent = userParams.CdA;
    document.getElementById('rm').value = (userParams.eta_muscle * 100).toFixed(0);
    document.getElementById('rmVal').textContent = (userParams.eta_muscle * 100).toFixed(0) + '%';

    // --- Paramètres Avancés (avec vérification d'existence pour compatibilité) ---
    if (params.seuil_col_pente !== undefined) {
        userParams.colthresolddetection = parseFloat(params.seuil_col_pente);
        document.getElementById('colThreshold').value = userParams.colthresolddetection;
        document.getElementById('colThresholdVal').textContent = userParams.colthresolddetection + '%';
    }
    if (params.seuil_col_continue !== undefined) {
        userParams.colcontinuedetection = parseFloat(params.seuil_col_continue);
        document.getElementById('colContinue').value = userParams.colcontinuedetection;
        document.getElementById('colContinueVal').textContent = userParams.colcontinuedetection + '%';
    }
    if (params.max_replat_dist !== undefined) {
        userParams.maxreplatdistance = parseInt(params.max_replat_dist);
        document.getElementById('maxReplatDistance').value = userParams.maxreplatdistance;
        document.getElementById('maxReplatDistanceVal').textContent = userParams.maxreplatdistance + ' m';
    }
    if (params.min_col_dist !== undefined) {
        userParams.minclimbdistance = parseInt(params.min_col_dist);
        document.getElementById('minClimbDistance').value = userParams.minclimbdistance;
        document.getElementById('minClimbDistanceVal').textContent = userParams.minclimbdistance + ' m';
    }
    if (params.seuil_segment_pente !== undefined) {
        userParams.slopeThreshold = parseFloat(params.seuil_segment_pente);
        document.getElementById('slopeThreshold').value = userParams.slopeThreshold;
        document.getElementById('slopeThresholdVal').textContent = userParams.slopeThreshold + '%';
    }
    if (params.min_segment_len !== undefined) {
        userParams.minSegmentLength = parseInt(params.min_segment_len);
        document.getElementById('minLength').value = userParams.minSegmentLength;
        document.getElementById('minLengthVal').textContent = userParams.minSegmentLength + ' m';
    }
    if (params.lissage_pente !== undefined) {
        userParams.slopeSmoothingWindow = parseFloat(params.lissage_pente);
        document.getElementById('lissagepente').value = userParams.slopeSmoothingWindow;
        document.getElementById('lissagepenteVal').textContent = userParams.slopeSmoothingWindow + '%';
    }

    // 2. FORCER LE RECALCUL COMPLET
    // C'est ici que la magie opère : on relance toute la chaîne de traitement
    // si un fichier GPX est actuellement chargé.
    if (allPoints.length > 0) {
        // A) Relisser les pentes avec les nouveaux paramètres
        smoothSlopes(allPoints, userParams.slopeSmoothingWindow);
        updateGlobalStats(allPoints);

        // B) Redétecter les cols
        allClimbs = detectClimbs(allPoints);
        document.getElementById('climbCount').textContent = allClimbs.length;
        drawAltitudeProfile(allPoints, allClimbs);

        // C) Refaire la segmentation
        allSegments = segmentTrackBySlope(allPoints, userParams.slopeThreshold, userParams.minSegmentLength);
        document.getElementById('segmentCount').textContent = allSegments.length;
        drawSegmentsOnMap(allSegments);

        // D) Relancer la simulation physique
        // On utilise await car runSimulation est maintenant asynchrone
        try {
            await runSimulation();
            // Mettre à jour le dernier JSON pour qu'il corresponde exactement à ce qu'on vient de re-calculer
            lastSimulationJSON = generateSimulationJSON(); 
            alert("✅ Simulation restaurée et recalculée avec succès !");
        } catch (e) {
            console.error("Erreur lors du recalcul de la simulation restaurée:", e);
            alert("Paramètres restaurés, mais erreur lors du recalcul.");
        }
    } else {
        alert("Paramètres restaurés.\n⚠️ Veuillez charger le fichier GPX correspondant pour voir les résultats sur la carte.");
    }
}


function exportToZWO(simData, fileName) {
    if (!simData || !simData.segments) {
        alert("Données de simulation invalides.");
        return;
    }

    const ftpRef = userParams.CP || userParams.puissance || 250;
    let zwoContent = `
<workout_file>
    <author>SimuGPX</author>
    <name>${fileName}</name>
    <description>Simulation générée par SimuGPX. Basée sur une FTP de ${ftpRef}W.</description>
    <sportType>bike</sportType>
    <tags><tag name="SimuGPX"/></tags>
    <workout>
`;

    for (const seg of simData.segments) {
        // On utilise les noms de propriétés du JSON sauvegardé (qui peuvent différer légèrement des objets internes)
        // Dans generateSimulationJSON, on avait sauvegardé: puissance_w, temps_sec
        const power = parseFloat(seg.puissance_w || seg.power);
        const duration = parseFloat(seg.temps_sec || seg.time);

        if (duration < 20) continue;

        let roundedDuration = 0;
        if (power > 500) roundedDuration = Math.round(duration / 10) * 10;
        else if (power >= 300) roundedDuration = Math.max(30, Math.round(duration / 30) * 30);
        else roundedDuration = Math.max(60, Math.round(duration / 60) * 60);

        if (roundedDuration <= 0) continue;

        // --- NOUVELLE RÈGLE : Free Ride si < 100W ---
        if (power < 100) {
             // FlatRoad = 1 signifie que le smart trainer ne simulera pas la pente, 
             // laissant l'utilisateur libre de sa puissance (Free Ride)
             zwoContent += `        <FreeRide Duration="${roundedDuration}" FlatRoad="1"/> \n`;
        } else {
             const roundedPower = Math.round(power / 5) * 5;
             const relPower = (roundedPower / ftpRef).toFixed(4);
             zwoContent += `        <SteadyState Duration="${roundedDuration}" Power="${relPower}"/> \n`;
        }
    }

    zwoContent += `    </workout>
</workout_file>`;

    const blob = new Blob([zwoContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.zwo`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}


async function analyzeActivity(gpxData, fileName) {
    // 1. Chargement standard du tracé (nettoyage map, parsing, cols, segmentation initiale)
    processGpxText(gpxData, fileName);

    // Attendre un court instant que processGpxText ait fini ses calculs synchrones
    await new Promise(resolve => setTimeout(resolve, 50));

    if (allPoints.length === 0) return;

    // 2. Calcul des statistiques RÉELLES globales
    let totalTime = 0;
    let weightedPower = 0;
    if (allPoints.length > 0 && allPoints[0].time && allPoints[allPoints.length-1].time) {
        totalTime = (allPoints[allPoints.length-1].time - allPoints[0].time) / 1000;
    }

    // 3. "Simuler" les segments avec les données réelles
    // On parcourt chaque segment créé par la segmentation automatique
    // et on remplace ses valeurs théoriques par les moyennes réelles du GPX.
    allSegments.forEach(seg => {
        // On retrouve les points qui correspondent à ce segment
        // (Simplification : on utilise les indices si disponibles, sinon filtre par distance)
        const segPoints = seg.points; // Normalement déjà peuplé par segmentation.js

        if (segPoints && segPoints.length > 0) {
            // Calcul des vraies moyennes sur ce segment
            const realPower = getAverageParam(segPoints, 'power');
            // Pour la vitesse, on préfère recalculer via temps/distance si possible pour plus de précision
            let realSpeedKmh = 0;
            let segTime = 0;
            if (segPoints[0].time && segPoints[segPoints.length-1].time) {
                 segTime = (segPoints[segPoints.length-1].time - segPoints[0].time) / 1000;
                 if (segTime > 0) realSpeedKmh = (seg.distance / segTime) * 3.6;
            } else {
                 // Fallback si pas de time sur les points (rare pour une activité réelle)
                 realSpeedKmh = getAverageParam(segPoints, 'speed') * 3.6; // Si tu avais calculé 'speed' en m/s lors du parsing
            }
            
            const realHr = getAverageParam(segPoints, 'hr');
            // Estimation énergie réelle (kJ ~ kcal en cyclisme grâce au rendement humain ~24%)
            const realKcal = (realPower * segTime) / 1000 / 4.184 / 0.24; // Approximation

            // ON ÉCRASE LES DONNÉES DU SEGMENT avec le RÉEL
            seg.power = Math.round(realPower);
            seg.speed = realSpeedKmh / 3.6; // m/s
            seg.time = segTime;
            seg.kcal = realKcal;
            seg.hr = Math.round(realHr); // On stocke aussi la FC si dispo
        }
    });

    // 4. Mise à jour de l'interface (Totaux)
    const totalDistKm = parseFloat(document.getElementById('distance').textContent.match(/[\d\.]+/)[0]);
    const realAvgSpeed = totalTime > 0 ? (totalDistKm * 1000 / totalTime) * 3.6 : 0;
    const realAvgPower = getAverageParam(allPoints, 'power');
    // Recalcul énergie totale approximative
    const totalKcal = (realAvgPower * totalTime) / 1000 / 4.184 / 0.24; 

    document.getElementById('temps').textContent = `⏱️ ${secondsToHHMMSS(totalTime)}`;
    document.getElementById('vitesse').textContent = `🚴 ${realAvgSpeed.toFixed(1)} km/h (Réel)`;
    document.getElementById('puissance_reelle').textContent = `⚡ ${realAvgPower.toFixed(0)} W (Réel)`;
    document.getElementById('energie').textContent = `🔥 ~${totalKcal.toFixed(0)} kcal`;

    // 5. Mise à jour de la carte et du tableau
    drawSegmentsOnMap(allSegments);
    rerenderSegmentListAfterSim(allSegments);
    
    // 6. Désactiver le bouton Simuler pour éviter la confusion ?
    // Optionnel : document.getElementById('simulateBtn').disabled = true;
    // Ou changer son texte :
    const simBtn = document.getElementById('simulateBtn');
    simBtn.textContent = "Re-Simuler (Théorique)";

    alert(`Analyse de l'activité "${fileName}" terminée !\nLes segments montrent maintenant vos données RÉELLES.`);
}

function drawZoneChart(points) {
    const canvas = document.getElementById('zoneGraph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // On utilise la CP (Critical Power) comme FTP par défaut
    const userFtp = userParams.CP || 250;
    const zonesMinutes = calculatePowerZones(points, userFtp);

    if (!zonesMinutes) {
        // Pas de puissance ou FTP invalide
        return;
    }

    if (zoneChart) zoneChart.destroy();

    zoneChart = new Chart(ctx, {
        type: 'bar',
        data: {
            // Z1 à Z6
            labels: ['Z1 (<55%)', 'Z2 (56-75%)', 'Z3 (76-90%)', 'Z4 (91-105%)', 'Z5 (106-120%)', 'Z6 (>120%)'],
            datasets: [{
                label: 'Temps passé (minutes)',
                data: zonesMinutes.slice(1), // On ignore Z0
                backgroundColor: [
                    '#808080', // Z1 Gris
                    '#3399FF', // Z2 Bleu
                    '#59B259', // Z3 Vert
                    '#FFD933', // Z4 Jaune
                    '#FF9933', // Z5 Orange
                    '#FF3333'  // Z6 Rouge
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Minutes', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: '#333' }
                },
                x: {
                    ticks: { color: '#ccc' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: `Zones basées sur CP = ${userFtp}W`,
                    color: '#ccc'
                }
            }
        }
    });
}