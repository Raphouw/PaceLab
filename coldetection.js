// /colDetection.js
// VERSION CORRIGÉE (Lit les 4 paramètres)

/**
 * Fonction principale : Scanne tous les points et renvoie un tableau de cols.
 * @param {Array} allPoints - Le tableau complet des points GPX (avec .dist et .smoothedSlope)
 * @returns {Array} Un tableau d'objets "col"
 */
function detectClimbs(allPoints) {
    const climbs = [];
    if (allPoints.length < 10) return climbs;

    // Lit les 4 paramètres à jour directement depuis l'objet global userParams
    // (J'utilise des valeurs par défaut "||" au cas où ils ne seraient pas définis)
    const SLOPE_THRESHOLD = userParams.colthresolddetection || 3.0;
    const SLOPE_CONTINUE = userParams.colcontinuedetection || 1.5;
    const MAX_REPLAT_DISTANCE = userParams.maxreplatdistance || 500;
    const MIN_CLIMB_DISTANCE = userParams.minclimbdistance || 1000; 

    let isClimbing = false;
    let currentClimbStartPoint = null;
    let lastClimbPoint = null;
    let replatDistance = 0;

    for (let i = 0; i < allPoints.length; i++) {
        const point = allPoints[i];
        const slope = point.smoothedSlope;

        if (isClimbing) {
            // --- ON EST DANS UNE MONTÉE ---
            
            if (slope >= SLOPE_CONTINUE) {
                // La pente est positive, on continue
                lastClimbPoint = point;
                replatDistance = 0;
            } else {
                // On est sur un replat ou une descente
                if (i > 0) { 
                    replatDistance += (point.dist - allPoints[i-1].dist);
                }
                
                // Si le replat est trop long, on arrête la montée
                if (replatDistance >= MAX_REPLAT_DISTANCE) {
                    isClimbing = false;
                    // On passe MIN_CLIMB_DISTANCE à la fonction de sauvegarde
                    saveClimb(climbs, currentClimbStartPoint, lastClimbPoint, allPoints, MIN_CLIMB_DISTANCE);
                }
            }

        } else {
            // --- ON NE MONTE PAS ---
            
            // Si la pente devient assez forte, on DÉMARRE une montée
            if (slope >= SLOPE_THRESHOLD) {
                isClimbing = true;
                currentClimbStartPoint = point;
                lastClimbPoint = point;
                replatDistance = 0;
            }
        }
    }

    // S'il restait une montée en cours à la fin du GPX
    if (isClimbing) {
        // On passe MIN_CLIMB_DISTANCE à la fonction de sauvegarde
        saveClimb(climbs, currentClimbStartPoint, lastClimbPoint, allPoints, MIN_CLIMB_DISTANCE);
    }

    console.log(`Détection de ${climbs.length} montées.`);
    return climbs;
}

/**
 * Outil pour sauvegarder un col s'il est valide
 * @param {number} MIN_CLIMB_DISTANCE - La distance minimale (passée en argument)
 */
function saveClimb(climbs, startPoint, endPoint, pointsArray, MIN_CLIMB_DISTANCE) {
    if (!startPoint || !endPoint) return;

    const climbDistance = endPoint.dist - startPoint.dist;
    const climbElevGain = endPoint.ele - startPoint.ele;
    
    // On utilise la variable passée en argument
    if (climbDistance >= MIN_CLIMB_DISTANCE) {
        
        const startIndex = pointsArray.indexOf(startPoint);
        const endIndex = pointsArray.indexOf(endPoint);

        if (startIndex === -1 || endIndex === -1) {
            console.error("Erreur: Impossible de trouver les points du col dans le tableau.");
            return;
        }

        const climbPoints = pointsArray.slice(startIndex, endIndex + 1);
        
        climbs.push({
            name: `Col ${climbs.length + 1}`,
            startPoint: startPoint,
            endPoint: endPoint,
            distance: climbDistance,
            elevGain: climbElevGain,
            avgGrade: (climbDistance > 0 ? (climbElevGain / climbDistance) * 100 : 0),
            points: climbPoints
        });
    }
}

