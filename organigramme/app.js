// ==========================================
// INITIALISATION
// ==========================================
// Note: Les configurations de mapping colonnes sont désormais centralisées dans utils.js
// INITIALISATION
// ==========================================
grist.ready({ requiredAccess: 'read table' });
document.addEventListener('DOMContentLoaded', init);

let allAgents = [];
let allStructures = [];
let structureMap = new Map(); // Index O(1) pour les perfs
let agentsHierarchyMap = new Map(); // Index O(1) pour la hiérarchie

async function init() {
    try {
        console.log("Chargement Organigramme V1 (Interne Grist)...");

        // 1. Récupération directe via Grist Plugin API
        const tables = [TABLE_AGENTS, TABLE_STRUCTURES, TABLE_CONFIG_LOGO];
        const data = {};

        await Promise.all(tables.map(async (name) => {
            try {
                const result = await grist.docApi.fetchTable(name);
                data[name] = window.transformColsToRows(result);
            } catch (err) {
                console.warn(`Table ${name} non trouvée ou inaccessible.`, err);
                data[name] = []; // Fallback si la table de config n'existe pas encore
            }
        }));

        allAgents = window.enrichAgentsData(data[TABLE_AGENTS]); // O(N) Cache les strings
        agentsHierarchyMap = window.createAgentsHierarchyMap(allAgents); // O(N) Cache hiérarchie
        allStructures = data[TABLE_STRUCTURES];
        structureMap = window.createStructureMap(allStructures); // Index Hash Map O(1)

        // Application de la configuration du Logo
        applyLogoConfig(data[TABLE_CONFIG_LOGO]);

        // Lancement du rendu
        renderTopZone();   // Partie Supérieure (DG, Cabinet...)
        renderColumns();   // Colonnes principales
        initQuickSearch(); // Barre de recherche rapide (Accordéon)

        // Exposition sécurisée via un Accessor global pour le PDF ou d'autres modules
        window.getOrganigrammeData = () => ({
            agents: allAgents,
            structures: allStructures
        });

    } catch (e) {
        console.error("ERREUR :", e);
        document.querySelector('.main-grid').innerHTML = `<div class="fr-alert fr-alert--error">${e.message}</div>`;
    }
}

// ==========================================
// CONFIGURATION LOGO
// ==========================================
function applyLogoConfig(configData) {
    if (!configData || configData.length === 0) return; // Pas de config

    const configRow = configData[0]; // On prend la première ligne de configuration
    const logoContainer = document.querySelector('.fr-header__logo');

    if (!logoContainer) return;

    // 1. Masquer le logo si demandé (toggle booléen)
    if (configRow[COL_CONFIG_MASQUER_LOGO]) {
        logoContainer.style.display = 'none';
        return;
    }

    // 2. Changer le texte du logo si fourni
    const customText = safeStr(configRow[COL_CONFIG_TEXTE_LOGO]).trim();
    if (customText) {
        const pLogo = logoContainer.querySelector('.fr-logo');
        if (pLogo) {
            // On autorise un HTML très basique type <br> souvent mis par défaut,
            // mais on passe par notre outil XSS.
            // Vu que Grist ne permet pas de taper du HTML riche facilement dans un champ texte,
            // on remplace manuellement les \n par des <br>
            pLogo.innerHTML = safeHtml(customText).replace(/\n/g, '<br>');
        }
    }
}

// ==========================================
// ==========================================
// RENDU VISUEL (GRILLE)
// ==========================================

// ... (renderTopZone, renderColumns, createDsfrTile inchangés, juste s'assurer que createDsfrTile utilise bien les nouvelles fns locales)

// Affiche la zone du haut (Directeur G., Cabinet, etc.)
function renderTopZone() {
    const left = document.getElementById('top-left');
    if (left) getStructuresByPos('TOP_LEFT').forEach(s => createDsfrTile(left, s));

    const center = document.getElementById('top-center');
    const centerStructs = getStructuresByPos('TOP_CENTER');
    // Le chef au centre a un style spécifique (tile-chef)
    if (center && centerStructs.length > 0) createDsfrTile(center, centerStructs[0], 'tile-chef');

    const right = document.getElementById('top-right');
    if (right) getStructuresByPos('TOP_RIGHT').forEach(s => createDsfrTile(right, s));
}

// Affiche les 4 colonnes principales
function renderColumns() {
    for (let i = 1; i <= 4; i++) {
        const container = document.getElementById(`col-${i}`);
        if (!container) continue;

        // Tête de Colonne (taille fixe via CSS .tile-head)
        const heads = getStructuresByPos(`COL${i}_HEAD`);
        if (heads.length > 0) createDsfrTile(container, heads[0], 'tile-head');

        // Sous-bureaux (Tuiles standards)
        const subs = getStructuresByPos(`COL${i}_SUB`);
        subs.forEach(sub => createDsfrTile(container, sub));
    }
}

/**
 * CRÉATION HTML D'UNE TUILE DSFR
 * Gère l'affichage standard et les variantes (pointillé, chef...)
 */
function createDsfrTile(container, struct, extraClass = '') {
    const codeBureau = window.safeHtml(struct[COL_STRUCT_CODE]).trim();
    const libelle = window.safeHtml(struct[COL_STRUCT_LIBELLE], "Sans nom");
    const resp = window.safeHtml(window.findResponsableName(struct, agentsHierarchyMap));
    const specialStyle = window.safeStr(struct[COL_STRUCT_STYLE]).toLowerCase();

    // Gestion du style pointillé (ex: Cellule Communication)
    if (specialStyle.includes('pointill')) {
        extraClass += ' tile-dashed';
    }

    const div = document.createElement('div');
    // fr-enlarge-link permet de rendre toute la tuile cliquable via le <a> interne
    div.className = `fr-tile fr-enlarge-link fr-tile--no-icon ${extraClass}`;

    // Header (Code du bureau, ex: SAAM A)
    const headerHtml = codeBureau ? `<div class="tile-header">${codeBureau}</div>` : '';

    // Bloc Responsable (Affiché en bas de tuile)
    let respHtml = '';
    if (resp) {
        respHtml = `
        <div class="tile-resp-container">
            <div class="tile-separator"></div>
            <span class="tile-resp-name">${resp}</span>
        </div>`;
    }

    div.innerHTML = `
        ${headerHtml}
        <div class="fr-tile__body">
            <div class="fr-tile__content">
                <h3 class="fr-tile__title">
                    <a href="#">${libelle}</a>
                </h3>
            </div>
            ${respHtml}
        </div>
    `;

    // Clic sur la tuile -> Ouverture Modale
    div.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        openModalForStructure(struct.id);
    });

    container.appendChild(div);
}


// ==========================================
// LOGIQUE MODALE DE DÉTAIL
// ==========================================

window.openModalForStructure = function (structId) {
    if (!structId) return;
    const struct = allStructures.find(s => s.id === structId);
    if (!struct) return;

    const title = safeStr(struct[COL_STRUCT_LIBELLE]);
    const respNameRaw = findResponsableName(struct, agentsHierarchyMap);
    const respName = safeHtml(respNameRaw);

    // Recherche des détails de l'agent responsable (via cache normalisé)
    let respAgent = null;
    if (respNameRaw) {
        const target = window.normalizeString(respNameRaw);
        respAgent = allAgents.find(a =>
            (a._fullname && a._fullname.includes(target)) ||
            (a._fullnameReverse && a._fullnameReverse.includes(target))
        );
    }

    let htmlContent = '';

    // 1. Carte du Responsable
    if (respNameRaw) {
        const fct = respAgent ? safeHtml(respAgent[COL_AGENT_FONCTION]) : "Responsable";
        const emailAgent = respAgent ? safeHtml(respAgent[COL_AGENT_MAIL]) : "";
        const emailGeneric = respAgent ? safeHtml(respAgent['Mail_generique']) : "";
        const tel = respAgent ? safeHtml(respAgent[COL_AGENT_TEL]) : "";
        const mobile = respAgent ? safeHtml(respAgent['Tel_PORT']) : "";



        htmlContent += `
        <div class="fr-card fr-card--no-border fr-mb-2w">
            <div class="fr-card__body">
                <div class="fr-card__content">
                    <h3 class="fr-card__title">
                        <span class="fr-icon-user-star-line fr-mr-1w" aria-hidden="true"></span>
                        ${respName}
                    </h3>
                    <p class="fr-card__desc text-bold">${fct}</p>
                    <div class="fr-card__start">
                        <ul class="fr-badges-group">
                             ${emailAgent ? `<li><button onclick="copyToClipboard('${emailAgent.toLowerCase()}', this)" class="fr-badge fr-badge--info fr-badge--no-icon copy-btn" style="text-transform: none; display: inline-flex; width: 100%; white-space: normal; text-align: left; cursor: pointer; border: none; background: var(--background-contrast-info); color: var(--text-action-high-blue-france);" title="Copier l'adresse email">${emailAgent.toLowerCase()}</button></li>` : ''}
                             ${emailGeneric ? `<li><button onclick="copyToClipboard('${emailGeneric.toLowerCase()}', this)" class="fr-badge fr-badge--purple-glycine fr-badge--no-icon copy-btn" style="text-transform: none; font-style: italic; display: inline-flex; width: 100%; white-space: normal; text-align: left; cursor: pointer; border: none; background: var(--background-contrast-purple-glycine); color: var(--text-action-high-purple-glycine);" title="Copier l'adresse email">Générique : ${emailGeneric.toLowerCase()}</button></li>` : ''}
                             ${tel ? `<li><button onclick="copyToClipboard('${tel}', this)" class="fr-badge fr-badge--info fr-badge--no-icon copy-btn" style="text-transform: none; cursor: pointer; border: none; background: var(--background-contrast-info); color: var(--text-action-high-blue-france);" title="Copier le numéro">Fixe : ${tel}</button></li>` : ''}
                             ${mobile ? `<li><button onclick="copyToClipboard('${mobile}', this)" class="fr-badge fr-badge--info fr-badge--no-icon copy-btn" style="text-transform: none; cursor: pointer; border: none; background: var(--background-contrast-info); color: var(--text-action-high-blue-france);" title="Copier le numéro">Mob. : ${mobile}</button></li>` : ''}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        `;
    } else {
        htmlContent += `
            <div class="fr-alert fr-alert--warning fr-mb-2w">
                <p>Aucun responsable identifié pour ce service.</p>
            </div>
            `;
    }

    // 2. Bouton vers la liste complète (Page Recherche)
    htmlContent += `
            <div class="fr-grid-row fr-grid-row--center fr-mt-3w">
                <a href="search.html?structure=${structId}" class="fr-btn fr-btn--secondary fr-btn--icon-right fr-icon-arrow-right-line">
                    Voir toute l'équipe
                </a>
            </div>
            `;

    // Injection dans la modale et affichage
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = htmlContent;

    // Déclencheur officiel DSFR (qui gère son propre backdrop et sa fermeture)
    document.getElementById('dsfr-hidden-modal-btn').click();
};

// ==========================================
// UTILITAIRES ET LOGIQUE MÉTIER
// ==========================================

// Filtre les structures par leur Position (Code saisi dans Grist)
function getStructuresByPos(code) {
    return allStructures.filter(s => window.safeStr(s[COL_STRUCT_POSITION]).trim() === code);
}

// Gestion des événements de fermeture de la modale gérée nativement par DSFR
// Plus besoin de `.showModal()` ou `.close()` manuels du navigateur web.

// Initialisation de la recherche rapide (Accordéon)
function initQuickSearch() {
    // 1. Peupler le select
    const select = document.getElementById('quick-select-structure');
    if (!select) return;

    const options = allStructures.map(struct => {
        const code = window.safeStr(struct['Structure']).trim();
        const libelle = window.safeStr(struct[COL_STRUCT_LIBELLE]).trim();
        let label = libelle;
        if (code && code.toLowerCase() !== libelle.toLowerCase()) {
            label = `${code} - ${libelle} `;
        }
        return { id: struct.id, label: label };
    });

    options.sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.id;
        option.textContent = opt.label;
        select.appendChild(option);
    });

    // 2. Gérer le bouton et l'entrée
    const btn = document.getElementById('quick-search-btn');
    const input = document.getElementById('quick-search-input');

    if (btn) {
        // Clic bouton
        btn.addEventListener('click', triggerQuickSearch);

        // Touche Entrée
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') triggerQuickSearch();
        });

        function triggerQuickSearch() {
            const structId = select.value;
            const query = input.value.trim();

            const params = new URLSearchParams();
            if (structId) params.set('structure', structId);
            if (query) params.set('q', query);

            const queryString = params.toString();
            window.location.href = queryString ? `search.html?${queryString}` : 'search.html';
        }
    }
}