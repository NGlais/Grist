/**
 * utils.js
 * Utilitaires partagés pour le widget Organigramme SAAM.
 */

// --- CONFIGURATION GRIST (MAPPING DES COLONNES) ---

// Noms des tables
const TABLE_AGENTS = 'Base_Agent';
const TABLE_STRUCTURES = 'Structures';
const TABLE_CONFIG_LOGO = 'Config_Logo';

// Mapping Config_Logo
const COL_CONFIG_TEXTE_LOGO = 'Texte_Logo';
const COL_CONFIG_MASQUER_LOGO = 'Masquer_Logo';

// Mapping Base_Agent
const COL_AGENT_NOM = 'Nom_d_usage_de_l_agent';
const COL_AGENT_PRENOM = 'Prenom';
const COL_AGENT_FONCTION = 'Fonction_de_l_agent';
const COL_AGENT_STRUCT_REF = 'Structure_de_l_agent';
const COL_AGENT_STRUCT_SUP = 'Structure_superieur_hierarchique';
const COL_AGENT_MAIL = 'Mail_agent';
const COL_AGENT_MAIL_GEN = 'Mail_generique';
const COL_AGENT_TEL = 'Tel_';
const COL_AGENT_TEL_PORT = 'Tel_PORT';
const COL_AGENT_SITE = 'Site';
const COL_AGENT_BUREAU = 'Bureau';
const COL_AGENT_TELETRAVAIL = 'Jour_s_de_teletravail';
const COL_AGENT_MISSIONS = 'Missions_du_poste';
const COL_AGENT_PROJET = 'nom_du_projet';
const COL_AGENT_ROLE_PROJET = 'Role_chef_projet_ou_participnt';
const COL_AGENT_POLE = 'Pole_ou_section_';
const COL_AGENT_DESC_POLE = 'Description_pole';
const COL_AGENT_SECTEUR = 'Secteur_ou_cellule_';
const COL_AGENT_DESC_SECTEUR = 'Description_secteur';

// Mapping Structures
const COL_STRUCT_CODE = 'Structure';
const COL_STRUCT_LIBELLE = 'Libelle';
const COL_STRUCT_POSITION = 'Code_Position';
const COL_STRUCT_STYLE = 'Style_Special';
const COL_STRUCT_DESC = 'Description_Structure';
const COL_STRUCT_RESP = 'Responsable_Manuel';
const COL_STRUCT_CHEF_SUP = 'Superieur_hierarchique';


// --- SÉCURISATION ET FORMATAGE ---

/**
 * Retourne une chaîne, vide par défaut si la valeur est nulle.
 */
window.safeStr = function (val, def = "") {
    return val === null || val === undefined ? def : String(val);
};

/**
 * Échappe les caractères HTML (Protection XSS).
 */
window.escapeHtml = function (unsafe) {
    if (unsafe === null || unsafe === undefined) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

/**
 * Traite une valeur pour injection sécurisée dans le DOM.
 */
window.safeHtml = function (val, def = "") {
    return window.escapeHtml(window.safeStr(val, def));
};

/**
 * Normalise une chaîne pour les comparaisons (minuscules, sans accents).
 */
window.normalizeString = function (str) {
    if (!str) return "";
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};


// --- GESTION DES DONNÉES GRIST ---

/**
 * Transforme le format colonne de Grist en format ligne (objets JS).
 */
window.transformColsToRows = function (cols) {
    if (!cols || !cols.id) return [];
    const rows = [];
    for (let i = 0; i < cols.id.length; i++) {
        let r = {};
        for (const k in cols) r[k] = cols[k][i];
        rows.push(r);
    }
    return rows;
};

/**
 * Enrichit les données des agents avec des champs de recherche pré-calculés.
 * Optimisation O(N) effectuée au chargement.
 */
window.enrichAgentsData = function (agentsArray) {
    agentsArray.forEach(agent => {
        const nom = safeStr(agent[COL_AGENT_NOM]);
        const prenom = safeStr(agent[COL_AGENT_PRENOM]);

        // Indexation des noms pour accélération des recherches
        agent._fullname = normalizeString(`${prenom} ${nom}`);
        agent._fullnameReverse = normalizeString(`${nom} ${prenom}`);
    });
    return agentsArray;
};

/**
 * Crée un index Map des structures pour un accès instantané par ID.
 */
window.createStructureMap = function (structuresArray) {
    const map = new Map();
    structuresArray.forEach(s => map.set(s.id, s));
    return map;
};
/**
 * Résout une valeur de colonne Reference Grist vers un ID numérique.
 * Grist peut retourner : un entier, un tableau [id, "label"], ou 0/null si vide.
 */
window.resolveGristRef = function (rawRef) {
    if (Array.isArray(rawRef) && rawRef.length > 0) return rawRef[0];
    if (typeof rawRef === 'number' && rawRef > 0) return rawRef;
    return null;
};

/**
 * Crée un index des agents regroupés par leur structure (bureau).
 * Gère les deux formats possibles de Structure_de_l_agent :
 *   - Reference Grist → ID numérique (ex: 2)
 *   - Texte → code structure (ex: "SAAM A1")
 * Les agents sont indexés par la clé brute (ID ou texte).
 */
window.createAgentsHierarchyMap = function (agentsArray) {
    const map = new Map();
    agentsArray.forEach(a => {
        const raw = a[COL_AGENT_STRUCT_REF];

        // Clé = ID numérique (si Reference) ou texte (si colonne Texte)
        const refId = window.resolveGristRef(raw);
        const key = refId || (typeof raw === 'string' ? raw.trim() : null);

        if (key) {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(a);
        }
    });
    return map;
};

/**
 * Identifie le nom du responsable d'une structure.
 *
 * Logique métier :
 *   - Chaque agent a Structure_superieur_hierarchique qui indique
 *     dans quel bureau travaille son N+1.
 *   - Les agents « normaux » ont leur N+1 dans le MÊME bureau.
 *   - Le CHEF du bureau a son N+1 dans un AUTRE bureau.
 *
 * Gère les colonnes de type Reference (ID numérique) ET Texte (code string).
 */
window.findResponsableName = function (structObject, agentsHierarchyMap) {
    if (!structObject) return null;

    const structId = structObject.id;
    const structCode = safeStr(structObject[COL_STRUCT_CODE]).trim();

    // 1. Priorité au responsable saisi manuellement (texte uniquement)
    const rawResp = structObject[COL_STRUCT_RESP];
    if (rawResp && typeof rawResp === 'string') {
        const manualChef = rawResp.trim();
        if (manualChef) return manualChef;
    }

    // 2. Détection automatique du chef
    if (agentsHierarchyMap) {
        // Chercher les agents de cette structure (par ID numérique OU par code texte)
        const agentsInStruct = agentsHierarchyMap.get(structId) ||
                               agentsHierarchyMap.get(structCode) ||
                               [];

        if (agentsInStruct.length > 0) {
            // Le chef = l'agent dont le N+1 est dans un AUTRE bureau
            const chef = agentsInStruct.find(a => {
                const rawSup = a[COL_AGENT_STRUCT_SUP];

                // Cas 1: Reference (ID numérique)
                const supRefId = window.resolveGristRef(rawSup);
                if (supRefId) {
                    return supRefId !== structId;
                }

                // Cas 2: Texte (code structure)
                const supText = safeStr(rawSup).trim();
                if (supText) {
                    return supText !== structCode;
                }

                // Pas de valeur → on ne peut pas déterminer
                return false;
            });

            if (chef) {
                const p = safeStr(chef[COL_AGENT_PRENOM]);
                const n = safeStr(chef[COL_AGENT_NOM]);
                return `${p} ${n}`.trim();
            }
        }
    }

    // 3. Dernier recours : champ Superieur_hierarchique sur la structure
    const rawChefSup = structObject[COL_STRUCT_CHEF_SUP];
    if (rawChefSup && typeof rawChefSup === 'string') {
        const chefSup = rawChefSup.trim();
        if (chefSup) return chefSup;
    }

    return null;
};



// --- INTERACTIONS UI ---

/**
 * Limite la fréquence d'exécution d'une fonction (debounce).
 */
window.debounce = function (func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

/**
 * Copie un texte dans le presse-papier avec retour visuel.
 */
window.copyToClipboard = function (text, btnElement) {
    if (!navigator.clipboard) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showCopyTooltip(btnElement);
        } catch (err) {
            console.error('Erreur technique lors de la copie', err);
        }
        document.body.removeChild(textArea);
        return;
    }

    navigator.clipboard.writeText(text).then(() => {
        showCopyTooltip(btnElement);
    }).catch(err => {
        console.error('Erreur lors de l\'accès au presse-papier', err);
    });
};

/**
 * Affiche une bulle de confirmation temporaire après une copie.
 */
function showCopyTooltip(element) {
    if (element.querySelector('.copy-tooltip')) return;

    const tooltip = document.createElement('span');
    tooltip.className = 'copy-tooltip';
    tooltip.innerHTML = '<span class="fr-icon-check-line fr-icon--sm fr-mr-1v"></span> Copié !';

    element.style.position = 'relative';
    element.appendChild(tooltip);

    setTimeout(() => {
        if (tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
        }
    }, 2000);
}

/**
 * Applique la configuration dynamique du logo (Masquage / Texte).
 */
window.applyLogoConfig = function (configData) {
    if (!configData || configData.length === 0) return;

    const configRow = configData[0];
    const logoContainer = document.querySelector('.fr-header__logo');

    if (!logoContainer) return;

    // 1. Masquage conditionnel
    if (configRow[COL_CONFIG_MASQUER_LOGO]) {
        logoContainer.style.display = 'none';
        return;
    }

    // 2. Personnalisation du texte
    const customText = safeStr(configRow[COL_CONFIG_TEXTE_LOGO]).trim();
    if (customText) {
        const pLogo = logoContainer.querySelector('.fr-logo');
        if (pLogo) {
            pLogo.innerHTML = safeHtml(customText).replace(/\n/g, '<br>');
        }
    }
}
