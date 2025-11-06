// /metrics.js
// PAS D'EXPORT. Les fonctions sont globales.

/**
 * Calcule la distance (Haversine) entre deux points GPS.
 * @returns {number} Distance en mètres.
 */
function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const dφ = (lat2-lat1) * Math.PI/180;
    const dλ = (lon2-lon1) * Math.PI/180;
    
    const a = Math.sin(dφ/2) * Math.sin(dφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(dλ/2) * Math.sin(dλ/2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // distance en mètres
}

/**
 * Calcule les métriques cumulées d'un tracé.
 * @param {Array} points - Array de {lat, lon, ele}
 * @returns {object} { totalDistance, totalElevGain }
 */
function calculateTrackStats(points) {
    let totalDistance = 0;
    let totalElevGain = 0;

    for (let i = 1; i < points.length; i++) {
        const a = points[i-1];
        const b = points[i];
        
        const d = distance(a.lat, a.lon, b.lat, b.lon); // Appelle la fonction globale
        const dh = b.ele - a.ele;
        
        totalDistance += d;
        if (dh > 0) {
            totalElevGain += dh;
        }
    }
    return { totalDistance, totalElevGain };
}

function calculateNormalizedPower(points) {
    if (!points || points.length < 30) return 0;

    let rollingAveragesPow4 = [];
    const windowSize = 30; // Fenêtre de 30 secondes

    for (let i = windowSize - 1; i < points.length; i++) {
        // 1. Calcul de la moyenne mobile sur les 30 dernières secondes (Trailing 30s)
        let sum = 0;
        let count = 0;
        for (let j = 0; j < windowSize; j++) {
            // On sécurise au cas où un point n'aurait pas de puissance
            const p = points[i - j].power || 0;
            sum += p;
            count++;
        }
        const rollingAvg = sum / count;

        // 2. Élévation à la puissance 4
        rollingAveragesPow4.push(Math.pow(rollingAvg, 4));
    }

    if (rollingAveragesPow4.length === 0) return 0;

    // 3. Moyenne des valeurs élevées à la puissance 4
    let sumPow4 = rollingAveragesPow4.reduce((a, b) => a + b, 0);
    const avgPow4 = sumPow4 / rollingAveragesPow4.length;

    // 4. Racine quatrième finale
    return Math.round(Math.pow(avgPow4, 0.25));
}


function smoothSlopes(gpxPoints, windowSize = 10) {
    const n = gpxPoints.length;
    if (n < 2) return;

    // 1. Calculer la pente locale (point à point)
    for (let i = 1; i < n; i++) {
        const p1 = gpxPoints[i-1];
        const p2 = gpxPoints[i];
        const d = p2.dist - p1.dist;
        const e = p2.ele - p1.ele;
        
        // Pente en %
        p1.localSlope = (d > 0.1) ? (e / d) * 100 : 0;
    }
    // Dernier point prend la valeur du précédent
    if (n > 1) {
        gpxPoints[n-1].localSlope = gpxPoints[n-2].localSlope;
    } else {
        gpxPoints[0].localSlope = 0;
    }

    // 2. Lisser la pente (moyenne mobile)
    // CORRECTION : On force windowSize à être un entier pour éviter les indices décimaux
    const w = Math.floor(windowSize) || 1; 

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - w);
        const end = Math.min(n - 1, i + w);
        let sum = 0;
        let count = 0;
        
        for (let j = start; j <= end; j++) {
            if (gpxPoints[j]) { // Sécurité supplémentaire
                sum += gpxPoints[j].localSlope;
                count++;
            }
        }
        gpxPoints[i].smoothedSlope = count > 0 ? sum / count : 0;
    }
}

function getAverageParam(points, prop) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < points.length; i++) {
        // On vérifie que la propriété existe et est un nombre valide
        if (points[i][prop] !== undefined && points[i][prop] !== null && !isNaN(points[i][prop])) {
            sum += points[i][prop];
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
}

/**
 * Calcule la distribution du temps passé dans les zones de puissance (Coggan classique).
 * @param {Array} points - Tous les points de l'activité avec .power et .time
 * @param {number} ftp - La FTP (ou CP) de l'utilisateur.
 */
function calculatePowerZones(points, ftp) {
    if (!ftp || ftp <= 0) return null;
    
    // Zones classiques Coggan (en % de FTP)
    // Z1: <55%, Z2: 56-75%, Z3: 76-90%, Z4: 91-105%, Z5: 106-120%, Z6: >121%
    // Z7 non incluse pour simplicité ici, souvent regroupée avec Z6
    const zones = [0, 0, 0, 0, 0, 0, 0]; // Z0 (bug), Z1, Z2, Z3, Z4, Z5, Z6+
    let totalTime = 0;

    for (let i = 1; i < points.length; i++) {
        const p1 = points[i-1];
        const p2 = points[i];
        
        if (p1.power !== null && p1.time && p2.time) {
            const duration = (p2.time - p1.time) / 1000; // en secondes
            if (duration > 0 && duration < 10) { // Filtre les sauts GPS bizarres > 10s
                const pct = (p1.power / ftp) * 100;
                let zoneIndex = 0;
                if (pct < 55) zoneIndex = 1;      // Z1
                else if (pct < 75) zoneIndex = 2; // Z2
                else if (pct < 90) zoneIndex = 3; // Z3
                else if (pct < 105) zoneIndex = 4;// Z4
                else if (pct < 120) zoneIndex = 5;// Z5
                else zoneIndex = 6;               // Z6+

                zones[zoneIndex] += duration;
                totalTime += duration;
            }
        }
    }
    
    // Conversion en minutes pour l'affichage
    return zones.map(seconds => Math.round(seconds / 60));
}




function findBestPowerOverDuration(points, durationSeconds) {
    if (!points || points.length < 2 || durationSeconds <= 0) return null;

    let maxWatts = 0;
    let bestStart = -1;
    let bestEnd = -1;

    let currentSumPower = 0;
    let currentCount = 0;
    let startI = 0;

    // Pré-calcul des deltas de temps pour être plus précis qu'un simple index
    // On suppose ici des points relativement réguliers (1s environ), 
    // sinon il faut une vraie intégrale temporelle, plus complexe.
    // Pour une V1, une fenêtre glissante sur les index si les données sont à 1Hz est une bonne approximation.
    // Si les données ne sont pas à 1Hz, ceci est une approximation.
    
    for (let endI = 0; endI < points.length; endI++) {
        const pEnd = points[endI];
        if (typeof pEnd.power !== 'number') continue;

        currentSumPower += pEnd.power;
        currentCount++;

        // On réduit la fenêtre par la gauche tant qu'elle est trop grande en temps
        while (startI < endI && (points[endI].time - points[startI].time) / 1000 > durationSeconds) {
            if (typeof points[startI].power === 'number') {
                currentSumPower -= points[startI].power;
                currentCount--;
            }
            startI++;
        }

        // Si la fenêtre a approximativement la bonne durée (à 10% près pour éviter les trous de données)
        const currentDuration = (points[endI].time - points[startI].time) / 1000;
        if (currentDuration >= durationSeconds * 0.9 && currentCount > 0) {
            const avg = currentSumPower / currentCount;
            if (avg > maxWatts) {
                maxWatts = avg;
                bestStart = startI;
                bestEnd = endI;
            }
        }
    }

    return maxWatts > 0 ? { watts: Math.round(maxWatts), startIndex: bestStart, endIndex: bestEnd } : null;
}


function movingAverage(data, windowSize) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length - 1, i + Math.floor(windowSize / 2));
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += data[j];
    }
    result.push(sum / (end - start + 1));
  }
  return result;
}

/**
 * Calcule la distribution de puissance par tranches (bins).
 * @param {Array} points - Points avec .power
 * @param {number} binSize - Taille des tranches (ex: 25W)
 */
function calculatePowerDistribution(points, binSize = 25) {
    const bins = {};
    points.forEach(p => {
        if (typeof p.power === 'number') {
            const bin = Math.floor(p.power / binSize) * binSize;
            bins[bin] = (bins[bin] || 0) + 1;
        }
    });
    // Conversion en format pour Chart.js [labels, data]
    const sortedBins = Object.keys(bins).map(Number).sort((a,b) => a - b);
    const labels = sortedBins.map(b => `${b}-${b+binSize}W`);
    // On suppose 1 point = 1 seconde environ pour simplifier, sinon il faut utiliser les deltas de temps
    const dataMinutes = sortedBins.map(b => (bins[b] / 60).toFixed(1)); 
    
    return { labels, data: dataMinutes };
}