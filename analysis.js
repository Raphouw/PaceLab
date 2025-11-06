// /analysis.js
// Gère la logique de la page d'analyse approfondie d'activité réelle

let currentAnalysisPoints = [];
let analysisMap = null;
let analysisChart = null;
let powerHeatmapLayer = null;
let areAnalysisChartsRendered = false;

/**
 * Initialise et ouvre la page d'analyse.
 * @param {string} gpxData - Le contenu XML/Text du GPX.
 * @param {string} fileName - Le nom du fichier.
 */
function openAnalysisPage(gpxData, fileName) {
    const modal = document.getElementById('analysisPage');
    if (!modal) return;

    resetAnalysisData(); 

    // UTILISATION D'UN PARSER AMÉLIORÉ POUR L'ANALYSE
    currentAnalysisPoints = parseAnalysisGPX(gpxData);

    if (!currentAnalysisPoints || currentAnalysisPoints.length === 0) {
        alert("Impossible d'analyser ce fichier (pas de points trouvés).");
        return;
    }

    // 2. Afficher la modale
    modal.classList.add('visible');
    document.getElementById('analysis-filename').textContent = fileName;

    // 3. Lancer les analyses de base (Vue d'ensemble + Records)
    // Les graphiques lourds et la carte seront chargés à la demande via les onglets
    renderAnalysisOverview();
    renderBestEfforts();

    initAnalysisMap();
    renderAnalysisMap();
    
    // Force l'onglet par défaut pour éviter de rester sur un onglet vide
    switchAnalysisTab('analysis-overview');
}


function parseAnalysisGPX(gpxData) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxData, "application/xml");
    const points = [];
    const trkpts = xml.getElementsByTagName('trkpt');

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const ele = parseFloat(pt.getElementsByTagName('ele')[0]?.textContent) || 0;
        const timeStr = pt.getElementsByTagName('time')[0]?.textContent;
        const time = timeStr ? new Date(timeStr) : null;

        // Extensions (Power, HR, Cadence, Temp)
        let power = null, hr = null, cad = null, temp = null;
        
        // Chercher partout dans les extensions possibles
        const ext = pt.getElementsByTagName('extensions')[0];
        if (ext) {
            // Power
            power = parseFloat(ext.getElementsByTagName('power')[0]?.textContent || 
                               ext.getElementsByTagName('gpxtpx:Watts')[0]?.textContent || 0);
            // HR
            hr = parseFloat(ext.getElementsByTagName('gpxtpx:hr')[0]?.textContent || 
                            ext.getElementsByTagName('hr')[0]?.textContent || 0);
            // Cadence
            cad = parseFloat(ext.getElementsByTagName('gpxtpx:cad')[0]?.textContent || 
                             ext.getElementsByTagName('cad')[0]?.textContent || 0);
             // Temp
            temp = parseFloat(ext.getElementsByTagName('gpxtpx:atemp')[0]?.textContent || 
                              ext.getElementsByTagName('atemp')[0]?.textContent || 0);
        }

        points.push({
            lat, lon, ele, time,
            power: (isNaN(power) ? null : power),
            hr: (isNaN(hr) ? null : hr),
            cad: (isNaN(cad) ? null : cad),
            temp: (isNaN(temp) ? null : temp),
            dist: 0 // Sera calculé après
        });
    }

    // Calcul des distances cumulées
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
        totalDist += distance(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
        points[i].dist = totalDist;
    }

    return points;
}

/**
 * NOUVELLE FONCTION : Nettoie tout avant de charger une nouvelle activité.
 */
function resetAnalysisData() {
    // 1. Reset des données
    currentAnalysisPoints = [];
    
    // 2. Reset des flags d'optimisation
    areAnalysisChartsRendered = false;
    
    // 3. Destruction propre des anciens graphiques pour éviter les conflits
    Object.values(analysisCharts).forEach(chart => {
        if (chart) chart.destroy();
    });
    analysisCharts = {}; // On vide l'objet stockant les références

    // 4. Nettoyage de la carte si nécessaire
    if (powerHeatmapLayer && analysisMap) {
        powerHeatmapLayer.remove();
        powerHeatmapLayer = null;
    }
    // On ne détruit PAS analysisMap elle-même, on la garde en mémoire pour la réutiliser.
}

/**
 * Calcule et affiche les stats globales.
 */
function renderAnalysisOverview() {
    const pts = currentAnalysisPoints;
    if (pts.length < 2) return;

    // Initialisation
    let totalDist = 0, totalElev = 0, maxSpeed = 0, movingTime = 0;
    let sumPower = 0, countPower = 0, maxPower = 0, sumNzPower = 0, countNzPower = 0;
    let sumHr = 0, countHr = 0, maxHr = 0;
    // MODIF CADENCE : on sépare total et non-zero (nz)
    let sumCadTotal = 0, countCadTotal = 0, sumCadNz = 0, countCadNz = 0, maxCad = 0;
    let coastingTime = 0;
    let minAlt = Infinity, maxAlt = -Infinity;
    let totalWorkkJ = 0;

    const startTime = pts[0].time ? pts[0].time.getTime() : 0;
    const endTime = pts[pts.length - 1].time ? pts[pts.length - 1].time.getTime() : 0;
    const totalElapsedTime = (endTime - startTime) / 1000; 

    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.ele < minAlt) minAlt = p.ele;
        if (p.ele > maxAlt) maxAlt = p.ele;

        if (i > 0) {
            const prev = pts[i-1];
            const d = distance(p.lat, p.lon, prev.lat, prev.lon);
            totalDist += d;
            if (p.ele > prev.ele) totalElev += (p.ele - prev.ele);

            if (p.time && prev.time) {
                const dt = (p.time - prev.time) / 1000;
                if (dt > 0 && dt < 120) {
                    const speed = (d / dt) * 3.6;
                    if (speed > 1.0) {
                        movingTime += dt;
                        if (speed < 130 && speed > maxSpeed) maxSpeed = speed;

                        // Détection Roue Libre
                        const isCoasting = (p.cad !== null && p.cad < 5) || (p.cad === null && p.power !== null && p.power < 5);
                        if (isCoasting) coastingTime += dt;
                    }
                    if (p.power) totalWorkkJ += (p.power * dt) / 1000;
                }
            }
        }

        // CUMULS
        if (p.power !== null) {
            sumPower += p.power; countPower++;
            if (p.power > 0) { sumNzPower += p.power; countNzPower++; }
            if (p.power > maxPower) maxPower = p.power;
        }
        if (p.hr !== null) {
            sumHr += p.hr; countHr++;
            if (p.hr > maxHr) maxHr = p.hr;
        }
        // MODIF CADENCE
        if (p.cad !== null) {
            sumCadTotal += p.cad; countCadTotal++;
            if (p.cad > 0) { sumCadNz += p.cad; countCadNz++; }
            if (p.cad > maxCad) maxCad = p.cad;
        }
    }

    // CALCULS FINAUX
    const avgMovingSpeed = movingTime > 0 ? (totalDist / 1000) / (movingTime / 3600) : 0;
    const avgTotalSpeed = totalElapsedTime > 0 ? (totalDist / 1000) / (totalElapsedTime / 3600) : 0;
    const pauseTime = Math.max(0, totalElapsedTime - movingTime);

    const avgPower = countPower > 0 ? sumPower / countPower : 0;
    const avgNzPower = countNzPower > 0 ? sumNzPower / countNzPower : 0;
    const npCoggan = calculateNormalizedPower(pts);
    
    const avgCadTotal = countCadTotal > 0 ? sumCadTotal / countCadTotal : 0;
    const avgCadNz = countCadNz > 0 ? sumCadNz / countCadNz : 0;

    const userWeight = userParams.poids || 70;
    const userFTP = userParams.CP || userParams.puissance || 250;
    const IF = userFTP > 0 ? npCoggan / userFTP : 0;
    const TSS = (userFTP > 0 && movingTime > 0) ? (movingTime * npCoggan * IF) / (userFTP * 3600) * 100 : 0;

    const coastingPct = movingTime > 0 ? (coastingTime / movingTime) * 100 : 0;
    const totalKcal = totalWorkkJ / 0.24 / 4.184;
    const kcalPerHour = movingTime > 0 ? (totalKcal / (movingTime / 3600)) : 0;

    // REMPLISSAGE DOM V4
    
    // Hero
    document.getElementById('ana-dist').textContent = (totalDist / 1000).toFixed(2) + ' km';
    document.getElementById('ana-elev').textContent = totalElev.toFixed(0) + ' m';
    document.getElementById('ana-time').textContent = secondsToHHMMSS(movingTime);
    document.getElementById('ana-avg-spd').textContent = avgMovingSpeed.toFixed(1) + ' km/h';

    // Chrono & Terrain
    document.getElementById('ana-total-time').textContent = secondsToHHMMSS(totalElapsedTime);
    document.getElementById('ana-pause-time').textContent = secondsToHHMMSS(pauseTime);
    document.getElementById('ana-total-avg-spd').textContent = avgTotalSpeed.toFixed(1) + ' km/h';
    document.getElementById('ana-max-spd').textContent = maxSpeed.toFixed(1) + ' km/h';
    document.getElementById('ana-alt-max').textContent = maxAlt.toFixed(0) + ' m';
    document.getElementById('ana-alt-min').textContent = minAlt.toFixed(0) + ' m';

    // Puissance & Charge
    document.getElementById('ana-pwr-avg').innerHTML = `${Math.round(avgPower)} W <small style="color:#888">(${Math.round(avgNzPower)} nz)</small>`;
    document.getElementById('ana-pwr-np').textContent = npCoggan + ' W';
    document.getElementById('ana-pwr-max').textContent = Math.round(maxPower) + ' W';
    
    // NOUVEAU : Double W/kg
    document.getElementById('ana-wkg-avg').textContent = (avgPower / userWeight).toFixed(2);
    document.getElementById('ana-wkg-np').textContent = (npCoggan / userWeight).toFixed(2);
    
    document.getElementById('ana-load-if').textContent = IF.toFixed(2);
    document.getElementById('ana-load-tss').textContent = TSS.toFixed(0);
    document.getElementById('ana-work-kj').textContent = totalWorkkJ.toFixed(0) + ' kJ';
    document.getElementById('ana-kcal').textContent = totalKcal.toFixed(0) + ' kcal';
    document.getElementById('ana-kcal-h').textContent = `(${Math.round(kcalPerHour)} kcal/h)`;

    // Pédalage & Cardio
    // NOUVEAU : Double Cadence
    document.getElementById('ana-cad-avg-nz').textContent = Math.round(avgCadNz) + ' rpm';
    document.getElementById('ana-cad-avg-total').textContent = Math.round(avgCadTotal);
    document.getElementById('ana-cad-max').textContent = Math.round(maxCad) + ' rpm';
    
    document.getElementById('ana-hr-avg').textContent = (countHr > 0 ? Math.round(sumHr / countHr) : '-') + ' bpm';
    document.getElementById('ana-hr-max').textContent = (maxHr > 0 ? Math.round(maxHr) : '-') + ' bpm';
    
    document.getElementById('ana-coasting-bar').style.width = coastingPct + '%';
    document.getElementById('ana-coasting-pct').textContent = coastingPct.toFixed(0) + '% Roue libre';
    document.getElementById('ana-pedaling-pct').textContent = (100 - coastingPct).toFixed(0) + '% Pédalage';
}

/**
 * Calcule et affiche les "Records" (1s, 5min, 20min).
 */
function renderBestEfforts() {
    const efforts = [
        { id: 'effort-5s', dur: 5, label: '5 sec' },
        { id: 'effort-1min', dur: 60, label: '1 min' },
        { id: 'effort-5min', dur: 300, label: '5 min' },
        { id: 'effort-20min', dur: 1200, label: '20 min' },
        { id: 'effort-30min', dur: 1800, label: '30 min' },
        { id: 'effort-45min', dur: 2700, label: '45 min' },
        { id: 'effort-1h', dur: 3600, label: '1h' },
        { id: 'effort-2h', dur: 7200, label: '2h' },
        { id: 'effort-3h', dur: 10800, label: '3h' }
    ];

    efforts.forEach(eff => {
        const data = findBestPowerOverDuration(currentAnalysisPoints, eff.dur);
        updateBestEffortCard(eff.id, data);
    });
}

function updateBestEffortCard(elementId, effortData, label) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    if (effortData) {
        el.querySelector('.effort-value').textContent = effortData.watts + ' W';
        // Optionnel : afficher où ça s'est passé (km X à Y)
        const startKm = (currentAnalysisPoints[effortData.startIndex].dist / 1000).toFixed(1);
        el.querySelector('.effort-details').textContent = `au km ${startKm}`;
    } else {
        el.querySelector('.effort-value').textContent = '-- W';
        el.querySelector('.effort-details').textContent = 'Pas assez de données';
    }
}

// --- GESTION CARTE & GRAPHIQUES ---

let analysisCharts = {};


function renderAnalysisChartsAsync() {
    // Nettoyage préalable si besoin
    Object.values(analysisCharts).forEach(c => c?.destroy());
    areAnalysisChartsRendered = false; // Reset du flag pendant le rendu

    // On affiche un petit texte de chargement si tu veux (optionnel)
    // document.getElementById('analysis-charts').style.opacity = '0.5';

    // Étape 1 : Le gros graphique de synchro (immédiat)
    // On utilise requestAnimationFrame pour s'assurer que l'UI a le temps de switcher d'onglet avant de lancer le calcul lourd
    requestAnimationFrame(() => {
        renderSyncChart();

        // Étape 2 : Distribution de puissance (après 100ms)
        setTimeout(() => {
            renderPowerDistChart();

            // Étape 3 : Profil d'altitude (après encore 100ms)
            setTimeout(() => {
                renderAltitudeChart();
                
                // Fini !
                areAnalysisChartsRendered = true;
                // document.getElementById('analysis-charts').style.opacity = '1';
            }, 100);

        }, 100);
    });
}

function renderSyncChart() { // Note: J'ai renommé en renderSyncChart pour matcher l'appel dans renderAnalysisChartsAsync
    const ctx = document.getElementById('analysisSyncChart').getContext('2d');
    const pts = currentAnalysisPoints;
    
    // LISSAGE des données (fenêtre de ~30 points)
    const window = 30;
    // On utilise les distances brutes pour l'axe X si on veut que la décimation marche bien,
    // ou alors on garde les labels string si on n'utilise pas la décimation ici.
    // Pour la synchro, les labels string sont souvent plus simples si on ne zoome pas.
    const labels = pts.map(p => (p.dist / 1000).toFixed(1));
    
    // Utilisation de la fonction globale movingAverage (assure-toi qu'elle est dans metrics.js)
    const smoothPower = movingAverage(pts.map(p => p.power || 0), window);
    const smoothHr = movingAverage(pts.map(p => p.hr || 0), window);
    const ele = pts.map(p => p.ele); 

    // On détruit l'ancien si il existe (sécurité supplémentaire)
    if (analysisCharts.sync) analysisCharts.sync.destroy();

    analysisCharts.sync = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Altitude (m)', data: ele,
                    borderColor: 'rgba(255, 255, 255, 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    fill: true, yAxisID: 'y_ele', pointRadius: 0, borderWidth: 1, order: 3
                },
                {
                    label: 'Puissance (30s avg)', data: smoothPower,
                    borderColor: '#ff9100', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y_power', order: 2,
                    tension: 0.3 
                },
                {
                    label: 'FC (30s avg)', data: smoothHr,
                    borderColor: '#E91E63', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y_hr', order: 1,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { ticks: { maxTicksLimit: 15, color: '#888' } },
                y_ele: { position: 'left', grid: {color: '#333'}, title: {display: true, text: 'Alt (m)', color: '#888'} },
                y_power: { position: 'right', grid: {drawOnChartArea: false}, title: {display: true, text: 'Watts', color: '#ff9100'} },
                y_hr: { position: 'right', grid: {drawOnChartArea: false}, title: {display: true, text: 'BPM', color: '#E91E63'}, min: 50 }
            },
            plugins: { legend: { labels: { color: '#ccc', boxWidth: 12 } } }
        }
    });
}

function renderPowerDistChart() {
    const ctx = document.getElementById('analysisPowerDistChart').getContext('2d');
    // Bins de 25W
    const dist = calculatePowerDistribution(currentAnalysisPoints, 25);

    analysisCharts.powerDist = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dist.labels,
            datasets: [{
                label: 'Temps passé (minutes)',
                data: dist.data,
                backgroundColor: '#ff9100',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: '#888', maxRotation: 45, autoSkip: true } },
                y: { title: {display: true, text: 'Minutes', color: '#ccc'}, ticks: {color: '#ccc'}, grid: {color: '#333'} }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderAltitudeChart() {
    const ctx = document.getElementById('analysisAltitudeChart').getContext('2d');
    const pts = currentAnalysisPoints;

    // 1. Préparation des données au format numérique {x, y} pour la décimation
    const dataXY = pts.map(p => ({
        x: p.dist / 1000, // X doit être un nombre pour que l'axe linéaire fonctionne
        y: p.ele
    }));

    analysisCharts.alt = new Chart(ctx, {
        type: 'line',
        data: {
            // Pas de 'labels' ici, l'axe X utilisera les valeurs 'x' de dataXY
            datasets: [{
                label: 'Altitude',
                data: dataXY,
                borderColor: '#888',
                borderWidth: 1,
                pointRadius: 0,
                fill: 'start',
                // La coloration dynamique (segment) peut être lourde avec beaucoup de points,
                // mais la décimation devrait aider en réduisant le nombre de segments à dessiner.
                segment: {
                    borderColor: ctx => {
                         // Attention: avec la décimation, p0DataIndex peut ne pas correspondre exactement à 'pts'
                         // si l'algo a fusionné des points. C'est un compromis performance/précision.
                         const i = ctx.p0DataIndex;
                         if (i > 0 && i < pts.length) {
                             // Fallback simple si l'index ne correspond plus parfaitement à cause de la décimation
                             // Idéalement, il faudrait recalculer la pente entre les points décimés, mais c'est complexe.
                             // On tente d'utiliser les points originaux si possible.
                             const pCurrent = pts[i];
                             const pPrev = pts[i-1];
                             if (!pCurrent || !pPrev) return '#888';

                             const d = pCurrent.dist - pPrev.dist;
                             const e = pCurrent.ele - pPrev.ele;
                             const slope = d > 0 ? (e/d)*100 : 0;
                             return (typeof getClimbProfileSlopeColor === 'function') ? getClimbProfileSlopeColor(slope) : '#888';
                         }
                         return '#888';
                    },
                    backgroundColor: ctx => {
                        const i = ctx.p0DataIndex;
                         if (i > 0 && i < pts.length) {
                             const pCurrent = pts[i];
                             const pPrev = pts[i-1];
                             if (!pCurrent || !pPrev) return 'rgba(255,255,255,0.1)';

                             const d = pCurrent.dist - pPrev.dist;
                             const e = pCurrent.ele - pPrev.ele;
                             const slope = d > 0 ? (e/d)*100 : 0;
                             return (typeof getClimbProfileSlopeColor === 'function') ? getClimbProfileSlopeColor(slope) + '60' : '#88888860';
                         }
                        return 'rgba(255,255,255,0.1)';
                    }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Désactive l'animation pour plus de rapidité sur les gros fichiers
            
            // Optimisations de performance pour les grands jeux de données
            parsing: false,
            normalized: true, 
            spanGaps: true, // Évite les coupures si quelques données manquent

            scales: {
                x: {
                    type: 'linear', // INDISPENSABLE pour la décimation
                    ticks: { color: '#888', maxTicksLimit: 10 }
                },
                y: {
                    title: { display: true, text: 'Altitude (m)', color: '#ccc' },
                    ticks: { color: '#ccc' },
                    grid: { color: '#333' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { intersect: false, mode: 'nearest', axis: 'x' },
                decimation: {
                    enabled: true,
                    algorithm: 'lttb', // 'lttb' est souvent plus joli que 'min-max' pour garder la forme globale
                    samples: 250,     // Nombre cible de points à afficher
                    threshold: 1000    // N'active la décimation que si > 2000 points
                }
            }
        }
    });
}

function initAnalysisMap() {
    if (!analysisMap) {
        analysisMap = L.map('analysis-map').setView([46, 6], 10);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, attribution: '©OpenStreetMap, ©CartoDB'
        }).addTo(analysisMap);
    }
    setTimeout(() => analysisMap.invalidateSize(), 200);
}

/**
 * Dessine la trace colorée selon la puissance (Heatmap simplifiée).
 */
function renderAnalysisMap() {
    if (!analysisMap || currentAnalysisPoints.length === 0) return;
    if (powerHeatmapLayer) powerHeatmapLayer.remove();

    // On va créer plein de petits segments colorés.
    // Pour la performance, on pourrait regrouper, mais testons brute-force d'abord.
    const layerGroup = L.featureGroup();
    
    // Trouver le max Power pour l'échelle de couleur (on cape à 400W pour éviter que les pics écrasent tout)
    const MAX_HEATMAP_POWER = 400; 

    for (let i = 1; i < currentAnalysisPoints.length; i++) {
        const p1 = currentAnalysisPoints[i-1];
        const p2 = currentAnalysisPoints[i];
        
        if (distance(p1.lat, p1.lon, p2.lat, p2.lon) < 2) continue; // Optimisation

        const power = p2.power || 0;
        const intensity = Math.min(power / MAX_HEATMAP_POWER, 1.0); // 0 à 1
        
        // Dégradé simple : Bleu (froid/0W) -> Vert -> Jaune -> Rouge (chaud/400W+)
        const color = getHeatmapColor(intensity);

        L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
            color: color,
            weight: 4,
            opacity: 0.8
        }).addTo(layerGroup);
    }

    powerHeatmapLayer = layerGroup;
    powerHeatmapLayer.addTo(analysisMap);
    analysisMap.fitBounds(powerHeatmapLayer.getBounds());
}

function getHeatmapColor(t) {
    // t entre 0 et 1
    // 0.0 -> Bleu (#0000ff)
    // 0.33 -> Vert (#00ff00)
    // 0.66 -> Jaune (#ffff00)
    // 1.0 -> Rouge (#ff0000)
    // Implémentation simplifiée HSL
    const hue = (1.0 - t) * 240; // 240(bleu) à 0(rouge)
    return `hsl(${hue}, 100%, 50%)`;
}

// --- GESTION DES ONGLETS ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.analysis-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchAnalysisTab(btn.dataset.target);
        });
    });

    document.getElementById('btn-back-analysis')?.addEventListener('click', () => {
        document.getElementById('analysisPage').classList.remove('visible');
        // Optionnel : si on veut rouvrir la bibliothèque automatiquement
         const libModal = document.getElementById('gpxLibraryModal');
         if (libModal) libModal.classList.add('visible');
    });
    
    document.getElementById('closeAnalysisPage')?.addEventListener('click', () => {
         document.getElementById('analysisPage').classList.remove('visible');
    });
    document.getElementById('btn-reset-analysis-map')?.addEventListener('click', () => {
        if (analysisMap && powerHeatmapLayer) {
            // Animation fluide vers les limites du tracé
            analysisMap.fitBounds(powerHeatmapLayer.getBounds(), {
                padding: [20, 20],
                animate: true,
                duration: 0.5
            });
        }
    });
});


function switchAnalysisTab(targetId) {
    // 1. Active le bouton
    document.querySelectorAll('.analysis-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.analysis-tab-btn[data-target="${targetId}"]`)?.classList.add('active');

    // 2. Affiche le contenu
    document.querySelectorAll('.analysis-content').forEach(c => c.classList.remove('active'));
    document.getElementById(targetId)?.classList.add('active');

    // 3. Refresh si besoin (carte/graph)
   if (targetId === 'analysis-map-tab' && analysisMap) {
        setTimeout(() => {
            analysisMap.invalidateSize();
            // AJOUT : Recentrage automatique si le calque existe
            if (powerHeatmapLayer) {
                analysisMap.fitBounds(powerHeatmapLayer.getBounds(), {
                    padding: [20, 20],
                    animate: true,
                    duration: 0.5
                });
            }
        }, 100);
    }
    // MODIFICATION ICI : Appel de la nouvelle fonction qui gère TOUS les graphiques
    if (targetId === 'analysis-charts' && !areAnalysisChartsRendered) {
        // On lance le rendu asynchrone
        renderAnalysisChartsAsync();
    }
}

/**
 * Dessine le grand graphique synchronisé (Altitude + Puissance + FC).
 */
