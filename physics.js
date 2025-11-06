// /physics.js
// VERSION COMBINÉE (Modèle SimuGPX + Solveur/Pacing SimuRaph)

const G_PHYSICS = 9.80665; 
const RHO_PHYSICS = 1.225; // Densité de l'air par défaut

/**
 * MODÈLE PHYSIQUE (de SimuGPX)
 * Calcule la puissance (W) pour une vitesse (v) donnée.
 * @param {number} v - Vitesse (m/s)
 * @param {number} slope - Pente (décimal, ex: 0.08 pour 8%)
 * @param {object} p - Objet de paramètres (mass, crr, cda, rho, wind)
 */
function powerFromSpeed(v, slope, p) {
    const g = 9.81; // Gravité
    const theta = Math.atan(slope);
  
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
  
    // Roulement
    const crrEff = p.crr * (1 - 0.15 * slope);
    const Fr = p.mass * g * crrEff * cosT;
  
    // Gravité
    const Fg = p.mass * g * sinT;
  
    // Vent relatif
    const vrel = v + (p.wind || 0);
    const Fa = 0.5 * p.rho * p.cda * vrel * vrel * Math.sign(vrel);
  
    // Puissance totale (Pertes mécaniques estimées à 3W)
    const Ptot = (Fr + Fg + Fa) * v + 3; 
    return Math.max(Ptot, 0);
}


/**
 * SOLVEUR DE VITESSE (de SimuRaph - Robuste)
 * Trouve la vitesse (v) pour une puissance (P) donnée.
 * MODIFIÉ pour utiliser le 'powerFromSpeed' de SimuGPX.
 */
function solveVitesse(P_meca, m_total, pente_decimal, Crr, CdA) {
    
    // --- ADAPTATION ---
    // On crée l'objet 'p' attendu par 'powerFromSpeed'
    const params_p = {
        mass: m_total,
        cda: CdA,
        crr: Crr,
        // Paramètres avancés (non gérés par l'UI de SimuRaph pour l'instant)
        rho: RHO_PHYSICS, // Densité de l'air
        wind: 0,          // Vent
        vmax: 80 / 3.6    // Vitesse max
    };
    // ------------------

    let v_min = 0.1; 
    let v_max = 33.3; // 120 km/h

    // L'équation à résoudre est f(v) = powerFromSpeed(v) - P_meca = 0
    
    const f_min = powerFromSpeed(v_min, pente_decimal, params_p) - P_meca;
    const f_max = powerFromSpeed(v_max, pente_decimal, params_p) - P_meca;

    if (f_max < 0) {
        return v_max;
    }
    if (f_min > 0) {
        return v_min; 
    }

    // Bisection
    for (let i = 0; i < 20; i++) { 
        let v_mid = (v_min + v_max) / 2;
        let f_mid = powerFromSpeed(v_mid, pente_decimal, params_p) - P_meca;

        if (Math.abs(f_mid) < 0.1) { 
            return v_mid;
        }
        if (f_mid * f_min > 0) { 
            v_min = v_mid;
        } else {
            v_max = v_mid;
        }
    }
    
    return (v_min + v_max) / 2;
}

/**
 * Calcule l'énergie métabolique (kcal)
 * (GARDÉ DE SIMURAPH)
 */
function calculateKcal(P_meca, temps, eta_muscle = 0.24) {
    
    if (eta_muscle === 0) return 0;
    const P_metabolique = P_meca / eta_muscle; // Watts métaboliques
    const E_metabolique_J = P_metabolique * temps; // Joules
    
    return E_metabolique_J / 4184; // Conversion J -> kcal
}

/**
 * Calcule la nouvelle réserve W' (Joules) après un segment.
 * (GARDÉ DE SIMURAPH - ESSENTIEL POUR LE PACING)
 */
function calculateWPrime(P, t, W_prime_start, CP, W_prime_max, tau_rec) {
    P = Math.max(P, 0.1); 

    if (P > CP) {
        // --- DÉPLÉTION ---
        let W_prime_end = W_prime_start - (P - CP) * t;
        return Math.max(0, W_prime_end);
    } else {
        // --- RÉCUPÉRATION ---
        const W_deficit_start = W_prime_max - W_prime_start;
        const W_deficit_end = W_deficit_start * Math.exp( -t / tau_rec );
        let W_prime_end = W_prime_max - W_deficit_end;
        
        return Math.min(W_prime_max, W_prime_end);
    }
}