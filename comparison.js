// /comparison.js
// Gère la logique de la page de comparaison d'effort (réel vs. simu)

// Variable globale pour stocker les données de la simulation
let currentSimData = null;
let allSimPoints = []; 
let compareMap = null; 
let activeCompareSegment = null; 
let activeCompareClimb = null; 
let loadedRealGpxText = null; // Pour le GPX pré-chargé
let currentColorMode = 'mode1'; // Pour les couleurs de pente



// --- NOUVEAU: Groupes de couches séparés ---
let segmentLayersGroup = null; // Groupe pour les segments
let climbLayersGroup = null; // Groupe pour les cols
let segmentLayers = []; // Tableau pour les couches de segments
let climbLayers = []; // Tableau pour les couches de cols

// NOUVEAU: Stockage des données pour les graphiques de col
let detailedClimbData = {
    realPoints: [],
    climbResults: [],
    segmentResults: [] // Stocker les résultats des segments
};
let climbCompareChart = null;
let rideEvolutionChart = null; // <-- NOUVELLE LIGNE
let miniClimbCharts = []; // NOUVEAU: Pour stocker les instances des mini-graphiques
let climbChartsRendered = false; // <-- NOUVEAU: Ajouter ce drapeau

/**
 * Initialise la page de comparaison.
 * Appelée par main.js lors de l'ouverture de la modale.
 * @param {object} simData - L'objet JSON de la simulation (depuis lastSimulationJSON).
 * @param {Array} allPoints - Le tableau de points GPX de la simulation.
 * @param {string} lastLoadedGPXText - Le texte du GPX principal (pour pré-charger)
 */
function initializeComparisonPage(simData, allPoints, lastLoadedGPXText) { 
    currentSimData = simData;
    allSimPoints = allPoints; 
    loadedRealGpxText = lastLoadedGPXText; 
    currentColorMode = document.getElementById('colorMode').value; 
    
    // Réinitialisation des variables
    segmentLayers = []; 
    climbLayers = []; 
    activeCompareSegment = null;
    activeCompareClimb = null;
    climbChartsRendered = false;
    detailedClimbData = { realPoints: [], climbResults: [], segmentResults: [] }; 
    realGpxText = null; 
    if (rideEvolutionChart) {
        rideEvolutionChart.destroy();
        rideEvolutionChart = null;
    }   

    // Mise à jour des textes de statut
    const realStatusEl = document.getElementById('real-activity-status');
    if (realStatusEl) {
        realStatusEl.textContent = "Aucune activité sélectionnée (Ouvrez la Biblio)";
        realStatusEl.style.color = "#888";
    }

    const statusEl = document.getElementById('simu-status');
    const runBtn = document.getElementById('runComparisonBtn');
    if (runBtn) runBtn.disabled = true; 

    if (!currentSimData) {
        if (statusEl) {
             statusEl.textContent = "Erreur: Simulation non trouvée.";
             statusEl.style.color = "#F44336";
        }
        // SUPPRIMÉ: realGpxInput.disabled = true;  <-- C'était ici l'erreur
    } else {
        if (statusEl) {
            const simInfo = currentSimData.informations_parcours;
            statusEl.textContent = `Fichier: ${simInfo.nom_fichier} (${simInfo.distance_totale_km} km, ${simInfo.denivele_positif_m} m D+)`;
            statusEl.style.color = "#4CAF50";
        }
        // SUPPRIMÉ: realGpxInput.disabled = false; <-- Et ici
    }
    
    // Nettoyage de l'interface
    document.getElementById('comparisonTableBody').innerHTML = '';
    document.getElementById('comparisonClimbTableBody').innerHTML = ''; 
    document.getElementById('global-score-card').style.display = 'none';
    document.getElementById('compare-climb-charts-container').innerHTML = '';

    // --- RÉINITIALISATION DES ONGLETS ---
    document.getElementById('showSegmentsBtn')?.classList.add('active');
    document.getElementById('showClimbsBtn')?.classList.remove('active');
    document.getElementById('showEvolutionBtn')?.classList.remove('active');
    document.getElementById('segments-content')?.classList.add('active');
    document.getElementById('climbs-content')?.classList.remove('active');
    document.getElementById('evolution-content')?.classList.remove('active');

    const mapContainer = document.getElementById('compare-map');
    if (mapContainer) mapContainer.style.display = 'block';
    const chartsContainer = document.getElementById('compare-climb-charts-container');
    if (chartsContainer) chartsContainer.style.display = 'none';

    // --- INITIALISATION DE LA CARTE ---
    if (!compareMap) {
        compareMap = L.map('compare-map').setView([45.9, 6.1], 9);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 15
        }).addTo(compareMap);
        
        compareMap.on('click', () => {
            highlightCompareSegment(null);
            highlightCompareClimb(null); 
        });
    }
    
    if (segmentLayersGroup) segmentLayersGroup.remove();
    if (climbLayersGroup) climbLayersGroup.remove();
    segmentLayersGroup = L.featureGroup().addTo(compareMap); 
    climbLayersGroup = L.featureGroup(); 
    
    setTimeout(() => {
        if (compareMap) {
            compareMap.invalidateSize();
        }
    }, 100);
}

/**
 * Calcule la note pour une métrique (Puissance ou Vitesse)
 * @param {number} simValue - La valeur prévue par la simulation
 * @param {number} realValue - La valeur réelle mesurée
 * @returns {number} Une note de 0 à 100
 */
function calculateMetricScore(simValue, realValue) {
    if (!realValue || realValue <= 0) return 0;
    if (!simValue || simValue <= 0) {
        return 0; 
    }

    const ratio = realValue / simValue;

    if (ratio >= 0.9 && ratio <= 1.1) {
        return 100;
    }

    if (ratio > 1.1) {
        if (ratio >= 2.0) return 0;
        const penalty = (ratio - 1.1) / (2.0 - 1.1);
        return 100 - (penalty * 100);
    }

    if (ratio < 0.9) {
        if (ratio <= 0.5) return 0;
        return (ratio - 0.5) / (0.9 - 0.5) * 100;
    }
    
    return 0; 
}

/**
 * MODIFIÉ: Parse un fichier GPX (réel) et extrait les points
 * Calcule la vitesse à partir des balises <time> (plus fiable).
 * @param {string} gpxString - Le contenu texte du fichier GPX.
 * @returns {Array} Tableau de points {lat, lon, ele, dist, power, speed_ms}
 */
function parseRealGPX(gpxString) {
    console.log("Parsing du GPX réel...");
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxString, "application/xml");
    const points = [];
    const trkpts = xml.getElementsByTagName('trkpt');
    if (!trkpts.length) {
        alert("Ce GPX ne contient aucun point de tracé (trkpt).");
        return [];
    }

    let dist = 0;
    let prevTime = null; 

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        
        const eleNode = pt.getElementsByTagName('ele')[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : 0;
        const timeNode = pt.getElementsByTagName('time')[0];
        const currentTime = timeNode ? new Date(timeNode.textContent) : null;
        
        let speed_ms = 0;
        let delta_dist = 0;

         if (i > 0) {
            const prev = points[i-1];
            delta_dist = distance(lat, lon, prev.lat, prev.lon); 
            dist += delta_dist;

            if (currentTime && prevTime) {
                const deltaTimeSeconds = (currentTime.getTime() - prevTime.getTime()) / 1000.0;
                if (deltaTimeSeconds > 0) {
                    speed_ms = delta_dist / deltaTimeSeconds; 
                }
            }
        }

        let power = 0;
        const extensions = pt.getElementsByTagName('extensions')[0];
        if (extensions) {
            const powerNode = extensions.getElementsByTagName('power')[0]; 
            if (powerNode) {
                power = parseFloat(powerNode.textContent);
            } else {
                const tpx = extensions.getElementsByTagName('gpxtpx:TrackPointExtension')[0];
                 if (tpx) {
                     const powerNodeTPX = tpx.getElementsByTagName('gpxtpx:power')[0];
                     if(powerNodeTPX) power = parseFloat(powerNodeTPX.textContent);
                 }
            }
        }
        
        points.push({ lat, lon, ele, dist, power, speed_ms });
        prevTime = currentTime; 

    }
    console.log(`GPX réel parsé: ${points.length} points trouvés.`);
    return points;
}

/**
 * Calcule la moyenne d'une propriété (power, speed_ms) sur un tableau de points.
 * @param {Array} pointsArray - Le tableau de points du segment.
 * @param {string} property - Le nom de la propriété ('power' ou 'speed_ms').
 * @returns {number} La moyenne.
 */
function calculateAverage(pointsArray, property) {
    if (!pointsArray || pointsArray.length === 0) return 0;
    
    let sum = 0;
    let count = 0;
    
    for (const point of pointsArray) {
        if (point[property] !== null && typeof point[property] === 'number' && isFinite(point[property])) {
            
            if (property === 'power' && point[property] === 0) {
                continue; 
            }
            
            sum += point[property];
            count++;
        }
    }
    
    return count > 0 ? sum / count : 0;
}

/**
 * NOUVEAU: Calcule la moyenne PONDÉRÉE par la distance.
 * Essentiel pour agréger les segments en cols.
 * @param {Array} segments - Tableau de segments (simulés)
 * @param {string} property - 'puissance_w' ou 'vitesse_kmh'
 * @returns {number} Moyenne pondérée
 */
function calculateWeightedAverage(segments, property) {
    let totalValueDist = 0;
    let totalDist = 0;

    segments.forEach(seg => {
        const value = parseFloat(seg[property]);
        const dist = parseFloat(seg.distance_m);
        
        if (!isNaN(value) && !isNaN(dist) && dist > 0) {
            totalValueDist += value * dist;
            totalDist += dist;
        }
    });

    return totalDist > 0 ? totalValueDist / totalDist : 0;
}

function simpleMovingAverage(data, windowSize) {
    const smoothed = [];
    for (let i = 0; i < data.length; i++) {
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(data.length - 1, i + Math.floor(windowSize / 2));
        let sum = 0;
        let count = 0;
        for (let j = start; j <= end; j++) {
            sum += data[j];
            count++;
        }
        smoothed.push(sum / count);
    }
    return smoothed;
}


function movingNoteAverage(data){
    const movingAverage = [];
    let sum = 0;
    for (let i = 0; i<data.length; i++){
        sum+=data[i];
        movingAverage.push(sum/(i+1));
    }
return(movingAverage);

}

/**
 * Fonction principale: Compare la simulation avec les points réels.
 */
function runComparison(realGpxText) {
    const loadingText = document.getElementById('comparison-loading-text');
    loadingText.style.display = 'block';
    document.getElementById('comparisonTableBody').innerHTML = '';
    document.getElementById('global-score-card').style.display = 'none';

    setTimeout(() => {
        try {
            const realPoints = parseRealGPX(realGpxText);
            if (realPoints.length === 0) {
                loadingText.style.display = 'none';
                return;
            }
            detailedClimbData.realPoints = realPoints;
            detailedClimbData.segmentResults = []; 

            const simSegments = currentSimData.segments;
            const simParams = currentSimData.parametres_simulation;
            const results = [];
            let totalScoreSum = 0;
            let segmentsCounted = 0;

            for (const simSegment of simSegments) {
                const startDist = parseFloat(simSegment.start_dist_m);
                const endDist = parseFloat(simSegment.end_dist_m);
                const segmentLength = parseFloat(simSegment.distance_m);

                const pointsInSegment = realPoints.filter(p => p.dist >= startDist && p.dist <= endDist);
                const isSegmentValid = segmentLength > 100; 

                if (pointsInSegment.length === 0) {
                    results.push({ ...simSegment, real_power: 0, real_speed_kmh: 0, power_score: 0, speed_score: 0, global_score: 0, isSegmentValid });
                    continue;
                }

                const realAvgPower = calculateAverage(pointsInSegment, 'power');
                const realAvgSpeed_ms = calculateAverage(pointsInSegment, 'speed_ms');
                
                const simAvgPower = parseFloat(simSegment.puissance_w);
                const simAvgSpeed_kmh = parseFloat(simSegment.vitesse_kmh);
                
                const powerScore = calculateMetricScore(simAvgPower, realAvgPower);
                const speedScore = calculateMetricScore(simAvgSpeed_kmh / 3.6, realAvgSpeed_ms); 
                
                let globalScore;
                const pentePct = parseFloat(simSegment.pente_moyenne_pct);

                if (pentePct <= -5.5) {
                    globalScore = speedScore;
                }                
                else {
                    globalScore = (3 * powerScore + 1 * speedScore) / 4;
                }

                if(isSegmentValid) {
                    totalScoreSum += globalScore;
                    segmentsCounted++;
                }
                
                results.push({
                    ...simSegment,
                    real_power: realAvgPower,
                    real_speed_kmh: realAvgSpeed_ms * 3.6,
                    power_score: powerScore,
                    speed_score: speedScore,
                    global_score: globalScore,
                    isSegmentValid: isSegmentValid
                });
            }
            
            detailedClimbData.segmentResults = results; 

            renderComparisonResults(results);
            drawComparisonSegmentsOnMap(results);
            drawRideEvolutionChart(results);

            const simClimbs = currentSimData.col_datas || [];
            const climbResults = [];

            for (const simClimb of simClimbs) {
                const startDist = parseFloat(simClimb.col_start_dist_m);
                const endDist = parseFloat(simClimb.col_end_dist_m);

                const realPointsInClimb = realPoints.filter(p => p.dist >= startDist && p.dist <= endDist);
                
                const simSegmentsInClimb = simSegments.filter(s => {
                    const segStart = parseFloat(s.start_dist_m);
                    const segEnd = parseFloat(s.end_dist_m);
                    return segStart < endDist && segEnd > startDist;
                });

                if (realPointsInClimb.length === 0 || simSegmentsInClimb.length === 0) continue;

                const realAvgPower = calculateAverage(realPointsInClimb, 'power');
                const realAvgSpeed_ms = calculateAverage(realPointsInClimb, 'speed_ms');
                
                const simAvgPower = calculateWeightedAverage(simSegmentsInClimb, 'puissance_w');
                const simAvgSpeed_kmh = calculateWeightedAverage(simSegmentsInClimb, 'vitesse_kmh');

                const powerScore = calculateMetricScore(simAvgPower, realAvgPower);
                const speedScore = calculateMetricScore(simAvgSpeed_kmh / 3.6, realAvgSpeed_ms);
                const globalScore = (3 * powerScore + 1 * speedScore) / 4; 

                climbResults.push({
                    ...simClimb, 
                    real_power: realAvgPower,
                    real_speed_kmh: realAvgSpeed_ms * 3.6,
                    sim_power: simAvgPower,
                    sim_speed_kmh: simAvgSpeed_kmh,
                    power_score: powerScore,
                    speed_score: speedScore,
                    global_score: globalScore
                });
            }
            
            renderClimbResults(climbResults);
            detailedClimbData.climbResults = climbResults; 
            
            drawComparisonClimbsOnMap(climbResults); 

            const finalScore = segmentsCounted > 0 ? totalScoreSum / segmentsCounted : 0;
            
            document.getElementById('total-score').textContent = `${finalScore.toFixed(0)}/100`;
            document.getElementById('score-summary').textContent = `Basé sur ${segmentsCounted} segments valides.`;
            document.getElementById('global-score-card').style.display = 'block';

            const saveBtn = document.getElementById('saveComparisonBtn');
            if (saveBtn) saveBtn.disabled = false;

        } catch (error) {
            console.error("Erreur lors de la comparaison:", error);
            alert("Une erreur est survenue lors du parsing ou de la comparaison des fichiers. Vérifiez la console.");
        } finally {
            loadingText.style.display = 'none';
        }
    }, 50); 
}

/**
 * Affiche les résultats dans le tableau HTML.
 * @param {Array} results - Le tableau des segments notés.
 */
function renderComparisonResults(results) {
    const tableBody = document.getElementById('comparisonTableBody');
    tableBody.innerHTML = ''; 

    const getScoreClass = (score) => {
        if (score >= 90) return 'score-good';
        if (score >= 60) return 'score-medium';
        return 'score-bad';
    };

    results.forEach((res, index) => { 
        const tr = document.createElement('tr');
        tr.id = `compare-row-${index}`;
        if (!res.isSegmentValid) {
            tr.style.opacity = "0.4";
            tr.style.fontStyle = "italic";
        }
        
    tr.innerHTML = `
            <td>
                <strong>Segment ${res.segment_index}</strong><br>
                <span style="font-size: 0.9em; color: #ccc;">
                    ${(res.distance_m / 1000).toFixed(1)} km à ${(res.pente_moyenne_pct * 1).toFixed(1)}%
                </span>
            </td>
            
            <td>${res.puissance_w} W</td>
            <td>${res.real_power.toFixed(0)} W</td>
            <td class="${getScoreClass(res.power_score)}">${res.power_score.toFixed(0)}</td>
            
            <td>${res.vitesse_kmh} km/h</td>
            <td>${res.real_speed_kmh.toFixed(1)} km/h</td>
            <td class="${getScoreClass(res.speed_score)}">${res.speed_score.toFixed(0)}</td>
            
            <td class="${getScoreClass(res.global_score)}" style="font-size: 1.1em; font-weight: bold;">
                ${res.global_score.toFixed(0)}
            </td>
        `;


      tr.addEventListener('click', () => {
            highlightCompareSegment(index); 
        });

        tableBody.appendChild(tr);
    });
}

/**
 * NOUVEAU: Affiche les résultats des COLS dans le tableau HTML.
 * @param {Array} climbResults - Le tableau des cols notés.
 */
function renderClimbResults(climbResults) {
    const tableBody = document.getElementById('comparisonClimbTableBody');
    tableBody.innerHTML = ''; 

    const getScoreClass = (score) => {
        if (score >= 90) return 'score-good';
        if (score >= 60) return 'score-medium';
        return 'score-bad';
    };

    climbResults.forEach((res, index) => {
        const tr = document.createElement('tr');
        tr.id = `compare-climb-row-${index}`;
        
        tr.innerHTML = `
            <td>
                <strong>${res.col_nom}</strong><br>
                <span style="font-size: 0.9em; color: #ccc;">
                    ${(res.col_distance_m / 1000).toFixed(1)} km à ${res.col_pente_moyenne_pct}%
                </span>
            </td>
            <td>
                ${(res.col_dplus_m * 1).toFixed(0)} m D+
            </td>
            
            <td>${res.sim_power.toFixed(0)} W</td>
            <td>${res.real_power.toFixed(0)} W</td>
            <td class="${getScoreClass(res.power_score)}">${res.power_score.toFixed(0)}</td>
            
            <td>${res.sim_speed_kmh.toFixed(1)} km/h</td>
            <td>${res.real_speed_kmh.toFixed(1)} km/h</td>
            <td class="${getScoreClass(res.speed_score)}">${res.speed_score.toFixed(0)}</td>
            
            <td class="${getScoreClass(res.global_score)}" style="font-size: 1.1em; font-weight: bold;">
                ${res.global_score.toFixed(0)}
            </td>
        `;

        tr.addEventListener('click', () => {
            highlightCompareClimb(index); 
            showClimbComparisonDetail(index);
        });

        tableBody.appendChild(tr);
    });
}


// --- NOUVELLES FONCTIONS POUR LA CARTE INTERACTIVE ---

/**
 * Donne une couleur (vert/jaune/rouge) basée sur la note
 * @param {number} score - Note de 0 à 100
 * @returns {string} Code couleur Hex
 */
function colorForScore(score) {
    if (score >= 90) return '#4CAF50'; // Vert
    if (score >= 60) return '#FFC107'; // Jaune
    return '#F44336'; // Rouge
}

/**
 * Trouve le premier index de point dans allSimPoints >= une distance
 */
function findPointIndex(dist) {
    let low = 0, high = allSimPoints.length - 1;
    let result = -1;

    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (allSimPoints[mid].dist >= dist) {
            result = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return result;
}

/**
 * Dessine les segments de simulation sur la carte de comparaison, colorés par note.
 * @param {Array} results - Le tableau des segments notés.
 */
function drawComparisonSegmentsOnMap(results) {
    if (!compareMap || allSimPoints.length === 0) return;

    if (segmentLayersGroup) segmentLayersGroup.clearLayers(); 
    segmentLayers = []; 

    results.forEach((res, index) => {
        const startDist = parseFloat(res.start_dist_m);
        const endDist = parseFloat(res.end_dist_m);
        
        const startIndex = findPointIndex(startDist);
        let endIndex = findPointIndex(endDist);

        if (endIndex === -1) endIndex = allSimPoints.length - 1; 
        if (startIndex === -1 || startIndex >= allSimPoints.length) return; 

        const segmentPoints = allSimPoints.slice(startIndex, endIndex + 1);
        const latlngs = segmentPoints.map(p => [p.lat, p.lon]);
        
        if (latlngs.length < 2) return;

        const color = colorForScore(res.global_score);
        
        const outlineLayer = L.polyline(latlngs, {
            color: '#FF0000', weight: 9, opacity: 0
        });

        const fillLayer = L.polyline(latlngs, {
            color: color, weight: 5, opacity: 0.8
        });

        const clickHandler = (e) => {
            L.DomEvent.stop(e);
            highlightCompareSegment(index);
        };
        fillLayer.on('click', clickHandler);
        outlineLayer.on('click', clickHandler);

        segmentLayers[index] = { fill: fillLayer, outline: outlineLayer };
        
        segmentLayersGroup.addLayer(fillLayer);
        segmentLayersGroup.addLayer(outlineLayer);
    });
    
    if (segmentLayers.length > 0) {
        compareMap.fitBounds(segmentLayersGroup.getBounds().pad(0.1));
    }
}

/**
 * NOUVEAU: Dessine les COLS sur la carte de comparaison.
 * @param {Array} climbResults - Le tableau des cols notés.
 */
function drawComparisonClimbsOnMap(climbResults) {
    if (!compareMap || allSimPoints.length === 0) return;

    if (climbLayersGroup) climbLayersGroup.clearLayers();
    climbLayers = [];

    climbResults.forEach((res, index) => {
        const startDist = parseFloat(res.col_start_dist_m);
        const endDist = parseFloat(res.col_end_dist_m);
        
        const startIndex = findPointIndex(startDist);
        let endIndex = findPointIndex(endDist);

        if (endIndex === -1) endIndex = allSimPoints.length - 1;
        if (startIndex === -1) return;

        const segmentPoints = allSimPoints.slice(startIndex, endIndex + 1);
        const latlngs = segmentPoints.map(p => [p.lat, p.lon]);
        
        if (latlngs.length < 2) return;

        const color = colorForScore(res.global_score);
        
        const outlineLayer = L.polyline(latlngs, { color: '#FF0000', weight: 10, opacity: 0 });
        const fillLayer = L.polyline(latlngs, { color: color, weight: 6, opacity: 0.85 });

        const clickHandler = (e) => {
            L.DomEvent.stop(e);
            highlightCompareClimb(index);
            showClimbComparisonDetail(index); 
        };
        fillLayer.on('click', clickHandler);
        outlineLayer.on('click', clickHandler);

        climbLayers[index] = { fill: fillLayer, outline: outlineLayer };
        
        climbLayersGroup.addLayer(fillLayer);
        climbLayersGroup.addLayer(outlineLayer);
    });
}


/**
 * Met en surbrillance un segment sur la carte et dans le tableau.
 * @param {number | null} segmentIndex - L'index du segment, ou null pour désélectionner.
 */
function highlightCompareSegment(segmentIndex) {
    if (segmentIndex === activeCompareSegment) {
        segmentIndex = null; 
    }
    
   if (segmentIndex !== null) {
        highlightCompareClimb(null);
    }
    activeCompareSegment = segmentIndex; 

    document.querySelectorAll('#comparisonTableBody tr').forEach((row, idx) => {
        const isHighlighted = (idx === segmentIndex);
        row.classList.toggle('highlighted', isHighlighted);
        if (isHighlighted) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    segmentLayers.forEach((layers, idx) => {
        if (layers) {
            if (idx === segmentIndex) {
                layers.outline.setStyle({ opacity: 0.8 }); 
                layers.outline.bringToFront(); 
                layers.fill.bringToFront();
            } else {
                layers.outline.setStyle({ opacity: 0 }); 
            }
        }
    });
    
    if (segmentIndex !== null && segmentLayers[segmentIndex]) {
        compareMap.fitBounds(segmentLayers[segmentIndex].fill.getBounds(), {
            maxZoom: 16,
            padding: [20, 20]
        });
    }
}

/**
 * NOUVEAU: Met en surbrillance un COL sur la carte et dans le tableau.
 * @param {number | null} climbIndex - L'index du col, ou null pour désélectionner.
 */
function highlightCompareClimb(climbIndex) {
    if (climbIndex === activeCompareClimb) {
        climbIndex = null; 
    }
    
    if (climbIndex !== null) {
        highlightCompareSegment(null);
    }
    activeCompareClimb = climbIndex; 

    document.querySelectorAll('#comparisonClimbTableBody tr').forEach((row, idx) => {
        const isHighlighted = (idx === climbIndex);
        row.classList.toggle('highlighted', isHighlighted);
        if (isHighlighted) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    climbLayers.forEach((layers, idx) => {
        if (layers) {
            if (idx === climbIndex) {
                layers.outline.setStyle({ opacity: 0.8 }); 
                layers.outline.bringToFront(); 
                layers.fill.bringToFront();
            } else {
                layers.outline.setStyle({ opacity: 0 }); 
            }
        }
    });
    
    if (climbIndex !== null && climbLayers[climbIndex]) {
        compareMap.fitBounds(climbLayers[climbIndex].fill.getBounds(), {
            maxZoom: 16,
            padding: [20, 20]
        });
    }
}


// --- NOUVEAU: FONCTIONS GRAPHIQUE COL DÉTAILLÉ (Requête 3) ---

/**
 * NOUVEAU: Donne une couleur de pente (utilise le mode de couleur global)
 */
function colorForSlope(slope) {
    // Dégradé fixe : Rouge (difficile) -> Vert (facile)
    if (slope > 10) return '#b71c1c'; // Rouge foncé
    if (slope > 8)  return '#e53935'; // Rouge
    if (slope > 6)  return '#fb8c00'; // Orange
    if (slope > 4)  return '#fdd835'; // Jaune
    if (slope > 2)  return '#7cb342'; // Vert clair
    if (slope > 0)  return '#43a047'; // Vert
    return '#2e7d32'; // Vert foncé (plat ou descente)
}


/**
 * Prépare les données pour le graphique de col détaillé en segmentant
 * par morceaux de 'segmentLength' (ex: 500m).
 * @param {object} climb - L'objet col de 'climbResults'
 * @param {Array} realPoints - Tous les points réels
 * @param {Array} simSegments - Tous les segments simulés
 * @param {number} segmentLength - Longueur de segment (ex: 500m)
 */
function segmentClimbForCompare(climb, realPoints, simSegments, segmentLength = 500) {
    const labels = [];
    const altitudeData = [];
    const realPowerData = [];
    const simPowerData = [];
    const slopeAnnotations = []; // Pour les couleurs
    const slopeLabels = []; // <-- NOUVEAU: Pour l'axe X du bas

    const climbStartDist = parseFloat(climb.col_start_dist_m);
    const climbEndDist = parseFloat(climb.col_end_dist_m);
    const climbDist = climbEndDist - climbStartDist;

    if (climbDist <= 0) return { labels, altitudeData, realPowerData, simPowerData, slopeAnnotations, slopeLabels: [] }; // MODIFIÉ

    for (let dist = 0; dist < climbDist; dist += segmentLength) {
        const chunkStart = climbStartDist + dist;
        const chunkEnd = Math.min(climbStartDist + dist + segmentLength, climbEndDist);
        
        const label = `km ${((chunkStart - climbStartDist) / 1000).toFixed(1)}`;
        labels.push(label);

        const realPointsInChunk = realPoints.filter(p => p.dist >= chunkStart && p.dist < chunkEnd);
        
        const simSegmentsInChunk = simSegments.filter(s => {
            const segStart = parseFloat(s.start_dist_m);
            const segEnd = parseFloat(s.end_dist_m);
            return segStart < chunkEnd && segEnd > chunkStart;
        });

        const realAvgPower = calculateAverage(realPointsInChunk, 'power');
        const simAvgPower = calculateWeightedAverage(simSegmentsInChunk, 'puissance_w');
        
        const altPoint = allSimPoints[findPointIndex(chunkStart)];
        const altitude = altPoint ? altPoint.ele : null;
        altitudeData.push(altitude);

        let avgSlopePct = 0;
        if (realPointsInChunk.length > 1) {
            const startEle = realPointsInChunk[0].ele;
            const endEle = realPointsInChunk[realPointsInChunk.length - 1].ele;
            const chunkDist = realPointsInChunk[realPointsInChunk.length - 1].dist - realPointsInChunk[0].dist;
            if (chunkDist > 0) {
                avgSlopePct = ((endEle - startEle) / chunkDist) * 100;
            }
        } else if (simSegmentsInChunk.length > 0) {
            avgSlopePct = parseFloat(simSegmentsInChunk[0].pente_moyenne_pct);
        }
        
        realPowerData.push(realAvgPower);
        simPowerData.push(simAvgPower);

        slopeAnnotations.push({
            label: label,
            slope: avgSlopePct,
            altitude: altitude || 0 
        });
        
        slopeLabels.push(`${avgSlopePct.toFixed(1)}%`); // <-- NOUVEAU: Ajouter le label de pente
    }
    
    // S'assurer d'ajouter le TOUT DERNIER point
    const lastLabel = `km ${((climbEndDist - climbStartDist) / 1000).toFixed(1)}`;
    labels.push(lastLabel);
    const lastAltPoint = allSimPoints[findPointIndex(climbEndDist)] || allSimPoints.at(-1);
    altitudeData.push(lastAltPoint.ele);
    // On duplique la dernière valeur
    realPowerData.push(realPowerData.at(-1));
    simPowerData.push(simPowerData.at(-1));
    slopeAnnotations.push(slopeAnnotations.at(-1));
    slopeLabels.push(''); // <-- NOUVEAU: Label vide pour le dernier point

    
    return { labels, altitudeData, realPowerData, simPowerData, slopeAnnotations, slopeLabels }; // <-- MODIFIÉ
}

/**
 * NOUVEAU: Dessine un seul mini-graphique de profil de col
 * (CORRIGÉ POUR UTILISER LA SEGMENTATION)
 */
function drawMiniClimbChart(canvas, climbIndex) {
    const climb = detailedClimbData.climbResults[climbIndex];
    if (!climb) return;

    // Segmenter tous les 100m pour un profil plus joli
    const chartData = segmentClimbForCompare(
        climb,
        detailedClimbData.realPoints,
        currentSimData.segments,
        100 // Segments de 100m pour le mini-profil
    );

    const ctx = canvas.getContext('2d');
    
    const validAltitudes = chartData.altitudeData.filter(a => a !== null);
    const minAltitude = validAltitudes.length > 0 ? Math.min(...validAltitudes) : 0;
    // Définir une altitude de base pour le remplissage, un peu en dessous
    const baseAltitude = minAltitude - 20; // 20m sous le point le plus bas

    const miniChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Altitude (m)',
                    data: chartData.altitudeData,
                    borderColor: 'rgba(50, 50, 50, 0.9)', // Ligne de profil foncée
                    borderWidth: 2,
                    fill: 'start', // Remplir vers le bas
                    tension: 0, // Lignes droites
                    pointRadius: 0, 
                    yAxisID: 'y_altitude',

                    // --- SOLUTION ---
                    // On utilise la segmentation pour colorer le FOND
                    segment: {
                        backgroundColor: (ctx) => {
                            // ctx.p0DataIndex est l'index du point de DÉPART du segment
                            const index = ctx.p0DataIndex;
                            if (chartData.slopeAnnotations && index < chartData.slopeAnnotations.length) {
                                const slope = chartData.slopeAnnotations[index].slope;
                                // Utilise la fonction de couleur globale
                                return colorForSlope(slope); 
                            }
                            return 'rgba(150, 150, 150, 0.1)'; // Couleur par défaut
                        },
                        // On ne colore pas la bordure, on la garde foncée
                        borderColor: 'rgba(50, 50, 50, 0.9)',
                    }
                    // --- FIN SOLUTION ---
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false }, // Pas d'axes
                y_altitude: { // Doit correspondre à yAxisID
                    display: false,
                    grid: { drawOnChartArea: false },
                    min: baseAltitude // Utilise la nouvelle altitude de base
                }
            },
            plugins: {
                legend: { display: false }, 
                tooltip: { enabled: false }, 
                // Plus besoin d'annotations de boîte
            },
            animation: false
        }
    });
    miniClimbCharts.push(miniChart); // Stocker pour destruction future
}


/**
 * NOUVEAU: Remplit le dashboard des mini-profils de cols
 */
function renderAllClimbPreviewGraphs() {
    const container = document.getElementById('compare-climb-charts-container');
    container.innerHTML = ''; 
    
    miniClimbCharts.forEach(chart => chart.destroy());
    miniClimbCharts = [];

    detailedClimbData.climbResults.forEach((climb, index) => {
        const card = document.createElement('div');
        card.className = 'mini-climb-profile-card';

        const title = document.createElement('h4');
        title.textContent = climb.col_nom;
        card.appendChild(title);

        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'mini-climb-profile-canvas-container';
        
        const canvas = document.createElement('canvas');
        canvas.id = `mini-climb-chart-${index}`;
        canvasContainer.appendChild(canvas);
        card.appendChild(canvasContainer);

        container.appendChild(card);

        setTimeout(() => {
            drawMiniClimbChart(canvas, index);
        }, 0);

        card.addEventListener('click', () => {
            showClimbComparisonDetail(index);
            highlightCompareClimb(index);
        });
    });
}


/**
 * Affiche la modale et dessine le graphique de comparaison du col.
 * (CORRIGÉ POUR UTILISER LA SEGMENTATION)
 * @param {number} climbIndex - L'index du col dans 'detailedClimbData.climbResults'
 */
function showClimbComparisonDetail(climbIndex) {
    const climb = detailedClimbData.climbResults[climbIndex];
    if (!climb) return;

    // 1. Préparer les données (contient maintenant 'slopeLabels')
    const chartData = segmentClimbForCompare(
        climb,
        detailedClimbData.realPoints,
        currentSimData.segments,
        250 // Segmenter tous les 500m
    );

    // 2. Mettre à jour le titre
    document.getElementById('climbCompareTitle').textContent = `Analyse Détaillée: ${climb.col_nom}`;

    // 3. Dessiner le graphique
    const canvas = document.getElementById('climbCompareChart');
    const ctx = canvas.getContext('2d');

    if (climbCompareChart) {
        climbCompareChart.destroy();
    }
    
    // --- Logique d'altitude (inchangée) ---
    const validAltitudes = chartData.altitudeData.filter(a => a !== null);
    const minAltitude = validAltitudes.length > 0 ? Math.min(...validAltitudes) : 0;
    const maxAltitude = validAltitudes.length > 0 ? Math.max(...validAltitudes) : 0;
    const baseAltitude = minAltitude - (maxAltitude - minAltitude) * 0.1;

    // --- NOUVEAU (Goal 2): Calculer le range de la puissance ---
    // Filtre les puissances > 0 pour un meilleur cadrage
    const allPowerData = [...chartData.simPowerData, ...chartData.realPowerData]
                         .filter(p => p !== null && !isNaN(p) && p > 0); 
    const minPower = allPowerData.length > 0 ? Math.min(...allPowerData) : 0;
    const maxPower = allPowerData.length > 0 ? Math.max(...allPowerData) : 100;
    const powerRange = maxPower - minPower;
    
    // Définir un min/max pour l'axe Y de puissance pour mieux centrer les lignes
    const powerPadding = powerRange * 0.1; // Garder 10% de marge en haut
    const powerAxisMin = 0; // <-- FORCER L'AXE À 0
    const powerAxisMax = Math.ceil(maxPower + powerPadding);
    // --- FIN NOUVEAU ---


    // --- SUPPRESSION (Goal 1): Retirer les annotations en haut ---
    // Le bloc "const slopeLabelAnnotations = {};" et sa boucle "forEach" sont supprimés.
    // --- FIN SUPPRESSION ---

    climbCompareChart = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: chartData.labels,
         datasets: [ 
                {
                    type: 'line', 
                    label: 'Altitude (m)',
                    data: chartData.altitudeData,
                    order: 3,
                    borderWidth: 2, 
                    fill: 'start',
                    tension: 0,
                    yAxisID: 'y_altitude',
                    pointRadius: 0,
                    segment: {
                        backgroundColor: (ctx) => {
                            const index = ctx.p0DataIndex;
                            if (chartData.slopeAnnotations && index < chartData.slopeAnnotations.length) {
                                const slope = chartData.slopeAnnotations[index].slope;
                                return colorForSlope(slope); 
                            }
                            return 'rgba(150, 150, 150, 0.1)'; 
                        },
                        borderColor: (ctx) => {
                            const index = ctx.p0DataIndex;
                            if (chartData.slopeAnnotations && index < chartData.slopeAnnotations.length) {
                                const slope = chartData.slopeAnnotations[index].slope;
                                const color = colorForSlope(slope);
                                if (color === '#66cc66' || color === '#73e673' || color === '#79f279') {
                                    return '#006400';
                                }
                                if (color === '#000000' || color === '#191919') {
                                    return '#FFFFFF';
                                }
                                return color.replace('0.7', '1.0'); 
                            }
                            return 'rgba(50, 50, 50, 0.9)';
                        }
                    }
                },
                
                // --- AJOUT DES DATASETS DE PUISSANCE MANQUANTS ---
                {
                    type: 'line', 
                    label: 'Puissance Prévue (W)',
                    data: chartData.simPowerData,
                    order: 2,
                    backgroundColor: 'rgba(255, 145, 0, 0.7)', 
                    borderColor: 'rgba(255, 145, 0, 1)',
                    borderWidth: 2, 
                    yAxisID: 'y_power', 
                    tension: 0.4, 
                    pointRadius: 0, 
                    fill: false 
                },
                {
                    type: 'line', 
                    label: 'Puissance Réelle (W)',
                    data: chartData.realPowerData,
                    order: 1,
                    backgroundColor: 'rgba(0, 208, 255, 0.7)', 
                    borderColor: 'rgba(0, 208, 255, 1)',
                    borderWidth: 2, 
                    yAxisID: 'y_power', 
                    tension: 0.4, 
                    pointRadius: 0, 
                    fill: false 
                }
                // --- FIN DE LA CORRECTION ---
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Distance dans le col', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.05)' } 
                },
                
                // --- NOUVEAU (Goal 1): Axe X pour les pentes ---
                x_slope: {
                    position: 'bottom',
                    labels: chartData.slopeLabels, // Utilise les nouvelles données
                    ticks: { 
                        color: '#fff', 
                        font: { weight: 'bold', size: 12 }, 
                        padding: 5 // Espace entre l'axe et les labels
                    },
                    grid: { drawOnChartArea: false }
                },
                // --- FIN NOUVEAU ---

                y_altitude: { 
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Altitude (m)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { drawOnChartArea: false }, 
                    min: baseAltitude,
                    max: maxAltitude + (maxAltitude - minAltitude) * 0.1
                },
                
                // --- MODIFIÉ (Goal 2): Axe Y pour la puissance ---
               y_power: { 
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'Puissance (W)', color: '#ccc' },
                ticks: { color: '#ccc' },
                grid: { color: 'rgba(255,255,255,0.1)' },
                // Utiliser les nouvelles valeurs min/max
                min: powerAxisMin,
                max: powerAxisMax
            }
                // --- FIN MODIFIÉ ---
            },
           plugins: {
                legend: { display: true, labels: { color: '#ccc' } },
                tooltip: { 
                    mode: 'index', 
                    intersect: false,
                    callbacks: {
                        footer: function(tooltipItems) {
                            const index = tooltipItems[0].dataIndex;
                            if (chartData.slopeAnnotations && index < chartData.slopeAnnotations.length) {
                                const slope = chartData.slopeAnnotations[index].slope;
                                return `Pente: ${slope.toFixed(1)}%`;
                            }
                            return '';
                        }
                    }
                }
                // L'ancien bloc 'annotation: {}' est supprimé
            }
        }
    });

    document.getElementById('climbCompareModal').classList.add('visible');
}


// --- Mettre en place les écouteurs d'événements ---
let realGpxText = null; // Stocke le GPX réel uploadé

document.addEventListener('DOMContentLoaded', () => {
    const runBtn = document.getElementById('runComparisonBtn');
    const saveCompBtn = document.getElementById('saveComparisonBtn');


    if (runBtn) {
        runBtn.addEventListener('click', () => {
            // Utilise le nouveau fichier (realGpxText) s'il existe,
            // SINON, utilise le fichier pré-chargé (loadedRealGpxText)
            const gpxToUse = realGpxText || loadedRealGpxText;

            if (gpxToUse && currentSimData) {
                runComparison(gpxToUse);
            } else {
                alert("Erreur: Données de simulation ou GPX réel manquants.");
            }
        });
    }

    if (saveCompBtn) {
        saveCompBtn.addEventListener('click', saveCurrentComparison);
    }

    // --- NOUVEAU: Écouteurs pour les onglets ---
    const showSegmentsBtn = document.getElementById('showSegmentsBtn');
    const showClimbsBtn = document.getElementById('showClimbsBtn');
    const showEvolutionBtn = document.getElementById('showEvolutionBtn'); // AJOUT

    const segmentsContent = document.getElementById('segments-content');
    const climbsContent = document.getElementById('climbs-content');
    const evolutionContent = document.getElementById('evolution-content'); // AJOUT

    const compareMapEl = document.getElementById('compare-map');
    const climbChartsEl = document.getElementById('compare-climb-charts-container');

    if (showSegmentsBtn) {
        showSegmentsBtn.addEventListener('click', () => {
            showSegmentsBtn.classList.add('active');
            showClimbsBtn.classList.remove('active');
            showEvolutionBtn.classList.remove('active'); // AJOUT

            segmentsContent.classList.add('active');
            climbsContent.classList.remove('active');
            evolutionContent.classList.remove('active'); // AJOUT
            
            if (compareMapEl) compareMapEl.style.display = 'block';
            if (climbChartsEl) climbChartsEl.style.display = 'none';
            
            if (compareMap) {
                if (climbLayersGroup) compareMap.removeLayer(climbLayersGroup);
                if (segmentLayersGroup) compareMap.addLayer(segmentLayersGroup);
                if (segmentLayers && segmentLayers.length > 0) {
                     compareMap.fitBounds(segmentLayersGroup.getBounds().pad(0.1));
                }
                 compareMap.invalidateSize();
            }
        });
    }
    if (showClimbsBtn) {
        showClimbsBtn.addEventListener('click', () => {
            showSegmentsBtn.classList.remove('active');
            showClimbsBtn.classList.add('active');
            showEvolutionBtn.classList.remove('active'); // AJOUT

            segmentsContent.classList.remove('active');
            climbsContent.classList.add('active');
            evolutionContent.classList.remove('active'); // AJOUT
            
            if (compareMapEl) compareMapEl.style.display = 'none';
            if (climbChartsEl) climbChartsEl.style.display = 'grid'; // S'assurer que c'est 'grid'
            
            if (!climbChartsRendered && detailedClimbData.climbResults.length > 0) {
            renderAllClimbPreviewGraphs();
            climbChartsRendered = true; // Marquer comme dessiné
        }

            if (compareMap) {
                if (segmentLayersGroup) compareMap.removeLayer(segmentLayersGroup);
            }
        });
    }

    if (showEvolutionBtn) {
        showEvolutionBtn.addEventListener('click', () => {
            showSegmentsBtn.classList.remove('active');
            showClimbsBtn.classList.remove('active');
            showEvolutionBtn.classList.add('active');
            
            segmentsContent.classList.remove('active');
            climbsContent.classList.remove('active');
            evolutionContent.classList.add('active');
            
            if (compareMapEl) compareMapEl.style.display = 'none';
            if (climbChartsEl) climbChartsEl.style.display = 'none';
            
            // Redimensionner le graphique pour s'adapter au panneau
            if (rideEvolutionChart) {
                rideEvolutionChart.resize();
            }
        });
    }
    
    // --- NOUVEAU: Écouteur pour fermer la modale du col ---
    const closeClimbCompareBtn = document.getElementById('closeClimbCompareModal');
    if (closeClimbCompareBtn) {
        closeClimbCompareBtn.addEventListener('click', () => {
            document.getElementById('climbCompareModal').classList.remove('visible');
            if (climbCompareChart) {
                climbCompareChart.destroy();
                climbCompareChart = null;
            }
        });
    }
    
    // Fermer la modale en cliquant à l'extérieur
    const climbCompareModal = document.getElementById('climbCompareModal');
    if (climbCompareModal) {
         climbCompareModal.addEventListener('click', (e) => {
            if (e.target === climbCompareModal) { 
                climbCompareModal.classList.remove('visible');
                 if (climbCompareChart) {
                    climbCompareChart.destroy();
                    climbCompareChart = null;
                }
            }
        });
    }
});

function drawRideEvolutionChart(results) {
    const canvas = document.getElementById('rideEvolutionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (rideEvolutionChart) {
        rideEvolutionChart.destroy();
    }

    // Préparation des données
    const validSegments = results.filter(r => r.isSegmentValid);
    const labels = validSegments.map(r => (r.start_dist_m / 1000).toFixed(1));
    const scoreData = validSegments.map(r => r.global_score);
    const simPowerData = validSegments.map(r => r.puissance_w);
    const realPowerData = validSegments.map(r => r.real_power);

    // --- AJOUT (Goal 3) ---
    const smoothedScoreData = simpleMovingAverage(scoreData, 10); // Fenêtre de 5 segments
    const globalNoteAverage = movingNoteAverage(scoreData);
    

    rideEvolutionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Note (Lissée)',
                    data: smoothedScoreData,
                    borderColor: '#4CAF50', // Vert
                    borderWidth: 3, // Ligne principale
                    pointRadius: 0,
                    yAxisID: 'y_score',
                    tension: 0.3
                },
                  {
                    label: 'Evolution note',
                    data: globalNoteAverage,
                    borderColor: '#004602ff', // Vert
                    borderWidth: 3, // Ligne principale
                    pointRadius: 0,
                    yAxisID: 'y_score',
                    tension: 0.3
                },

                
                /*{
                    label: 'Puissance Prévue (W)',
                    data: simPowerData,
                    borderColor: '#ff9100', // Orange
                    borderWidth: 2,
                    yAxisID: 'y_power',
                    pointRadius: 0,
                    tension: 0.2
                },
                {
                    label: 'Puissance Réelle (W)',
                    data: realPowerData,
                    borderColor: '#00d0ff', // Bleu
                    borderWidth: 2,
                    yAxisID: 'y_power',
                    pointRadius: 0,
                    tension: 0.2
                }*/
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    title: { display: true, text: 'Distance (km)', color: '#ccc' },
                    ticks: { color: '#ccc' }
                },
                y_score: {
                    type: 'linear',
                    position: 'left',
                    // --- MODIFICATION (Goal 2) ---
                    min: 0, // Zoom sur le haut du score
                    max: 105,
                    // --- FIN MODIFICATION ---
                    title: { display: true, text: 'Note (sur 100)', color: '#4CAF50' },
                    ticks: { color: '#4CAF50' },
                    grid: { drawOnChartArea: false }
                },
                /*y_power: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Puissance (W)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    beginAtZero: true
                }*/
            },
            plugins: {
                legend: { display: true, labels: { color: '#ccc' } }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    // Trouver l'index cliqué (basé sur les datasets de note)
                    const dataIndex = elements.find(el => el.datasetIndex <= 1)?.index;
                    if (dataIndex === undefined) return;

                    const clickedData = validSegments[dataIndex];
                    const originalIndex = results.findIndex(r => r.segment_index === clickedData.segment_index);
                    
                    if (originalIndex !== -1) {
                        highlightCompareSegment(originalIndex);
                    }
                }
            }
        }
    });
}


async function saveCurrentComparison() {
    if (!currentSimData || !allSimPoints) {
        alert("Données de comparaison incomplètes.");
        return;
    }
    
    // On récupère le texte GPX réel utilisé (soit celui uploadé, soit celui pré-chargé)
    const usedRealGpx = realGpxText || loadedRealGpxText;
    if (!usedRealGpx) {
        alert("Pas de données GPX réelles à sauvegarder.");
        return;
    }

    const defaultName = `Comparaison_${new Date().toLocaleTimeString('fr-FR').replace(/:/g, '-')}`;
    const compName = prompt("Nom du rapport de comparaison :", defaultName);
    if (!compName) return;

    // On prépare l'objet complet à sauvegarder
    // Il doit contenir TOUT ce qu'il faut pour 'initializeComparisonPage'
    const comparisonData = {
        simData: currentSimData,
        simPoints: allSimPoints,
        realGpx: usedRealGpx
    };

    // Quelques métadonnées pour l'affichage sympa dans la bibliothèque
    const scoreText = document.getElementById('total-score')?.textContent || "0/100";
    const scoreVal = parseInt(scoreText) || 0;
    const stats = {
        globalScore: scoreVal,
        simName: currentSimData.informations_parcours.nom_fichier
    };

    try {
        // On sauvegarde avec le type 'comparison'
        await saveFileToDB('comparison', compName, comparisonData, stats);
        alert("✅ Rapport de comparaison sauvegardé !");
    } catch (e) {
        console.error(e);
        alert("Erreur lors de la sauvegarde du rapport.");
    }
}