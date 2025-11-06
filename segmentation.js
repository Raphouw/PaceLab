// /segmentation.js

/**
 * NOUVEL ALGORITHME : Découpe le tracé par changement de pente.
 * (CORRIGÉ POUR "SOUDER" LES SEGMENTS)
 * @param {Array} points - Doit avoir 'dist' et 'smoothedSlope'
 * @param {number} slopeThreshold - Seuil de changement de pente (%) pour couper
 * @param {number} minLength - Longueur minimale d'un segment (m)
 */
function segmentTrackBySlope(points, slopeThreshold = 3, minLength = 200) {
    if (points.length < 2) return [];

    const segments = [];
    let currentStartIdx = 0;
    
    if (points.length === 0) return []; // Sécurité
    
    let currentSegmentSlopeSum = points[0].smoothedSlope;
    let currentSegmentPointCount = 1;

    for (let i = 1; i < points.length; i++) {
        const currentPoint = points[i];
        const currentSlope = currentPoint.smoothedSlope;
        const distSinceStart = currentPoint.dist - points[currentStartIdx].dist;

        const avgSmoothedSlope = currentSegmentSlopeSum / currentSegmentPointCount;
        const slopeDiff = Math.abs(currentSlope - avgSmoothedSlope);
        const isLongEnough = (distSinceStart >= minLength);

        // Si la pente change ET qu'on a fait la distance min, on coupe.
        // OU si c'est le tout dernier point
        if ( (isLongEnough && slopeDiff > slopeThreshold) || i === points.length - 1 ) {
            
            const startPoint = points[currentStartIdx];
            // CORRECTION : L'endpoint est le point 'i' (celui du changement)
            const endPoint = points[i]; 
            // CORRECTION : On slice de 'start' à 'i + 1' pour INCLURE le point 'i'
            const segmentPoints = points.slice(currentStartIdx, i + 1); 
            
            const dist = endPoint.dist - startPoint.dist;
            
            // Recalculer le D+ exact du segment
            let segmentElevGain = 0;
            for(let j = 1; j < segmentPoints.length; j++) {
                const diff = segmentPoints[j].ele - segmentPoints[j-1].ele;
                if (diff > 0) {
                    segmentElevGain += diff;
                }
            }
            // Utiliser la pente lissée moyenne pour la simulation
            const finalAvgSlopePercent = avgSmoothedSlope; 
            
            segments.push({
                start: startPoint,
                end: endPoint,
                distance: dist,
                elevGain: segmentElevGain, // Utiliser le D+ réel
                avgGrade: finalAvgSlopePercent / 100, // Pente lissée pour la physique
                points: segmentPoints,
                power: 0,
                speed: 25 / 3.6,
                time: (dist > 0 ? dist / (25 / 3.6) : 0),
                layer_fill: null,
                layer_outline: null
            });
            
            // On démarre le nouveau segment
            currentStartIdx = i; // <-- Le nouveau segment démarre au point 'i'
            currentSegmentSlopeSum = currentSlope;
            currentSegmentPointCount = 1;
        } else {
            // On continue le segment en cours
            currentSegmentSlopeSum += currentSlope;
            currentSegmentPointCount++;
        }
    }
    
    return segments;
}



