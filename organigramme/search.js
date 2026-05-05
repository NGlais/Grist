/**
 * search.js
 * Moteur de recherche et annuaire des agents de l'Organigramme SAAM.
 */

// --- RÉCUPÉRATION DES PARAMÈTRES ET ÉTAT GLOBAL ---

const urlParams = new URLSearchParams(window.location.search);
const structFilterId = urlParams.get('structure'); // ID numérique de la structure
const textFilterQuery = urlParams.get('q');       // Requête texte libre

let allAgents = [];
let allStructures = [];
let structureMap = new Map();
let agentsHierarchyMap = new Map();

// --- INITIALISATION DE L'APPLICATION ---

grist.ready({ requiredAccess: 'read table' });
document.addEventListener('DOMContentLoaded', init);

/**
 * Point d'entrée principal : charge les données et lance la recherche initiale.
 */
async function init() {
    try {
        console.log("Initialisation page recherche (Interne Grist)...");
        document.getElementById('loadingMessage').style.display = 'block';

        const tables = [TABLE_AGENTS, TABLE_STRUCTURES, TABLE_CONFIG_LOGO];
        const data = {};

        await Promise.all(tables.map(async (name) => {
            try {
                const result = await grist.docApi.fetchTable(name);
                data[name] = window.transformColsToRows(result);
            } catch (err) {
                console.warn(`Table ${name} non trouvée ou inaccessible.`, err);
                data[name] = [];
            }
        }));

        allAgents = window.enrichAgentsData(data[TABLE_AGENTS]);
        agentsHierarchyMap = window.createAgentsHierarchyMap(allAgents);
        allStructures = data[TABLE_STRUCTURES];
        structureMap = window.createStructureMap(allStructures);

        window.applyLogoConfig(data[TABLE_CONFIG_LOGO]);

        console.log(`Données chargées : ${allAgents.length} agents, ${allStructures.length} structures.`);

        setupUI();
        populateStructureSelect();

        if (structFilterId) {
            const select = document.getElementById('select-structure');
            if (select) select.value = structFilterId;
        }

        if (textFilterQuery) {
            document.getElementById('searchInput').value = textFilterQuery;
        }

        if (structFilterId || textFilterQuery) {
            performSearch();
        } else {
            document.getElementById('loadingMessage').style.display = 'none';
        }

    } catch (e) {
        console.error("ERREUR :", e);
        document.getElementById('resultArea').innerHTML = `<div class="fr-alert fr-alert--error">${e.message}</div>`;
    }
}

// --- LOGIQUE D'INTERFACE (UI & ÉVÉNEMENTS) ---

/**
 * Bascule l'état d'ouverture d'un accordéon agent.
 */
window.toggleAgent = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('open');
};

/**
 * Configure les écouteurs d'événements (boutons, saisie texte).
 */
function setupUI() {
    document.getElementById('searchBtn').addEventListener('click', performSearch);

    const debouncedSearch = window.debounce(performSearch, 300);
    document.getElementById('searchInput').addEventListener('input', debouncedSearch);

    const select = document.getElementById('select-structure');
    if (select) {
        select.addEventListener('change', performSearch);
    }

    const filterBanner = document.getElementById('filter-banner');
    if (filterBanner) filterBanner.style.display = 'none';
}

/**
 * Peuple le menu déroulant des structures.
 */
function populateStructureSelect() {
    const select = document.getElementById('select-structure');
    if (!select) return;

    const options = allStructures.map(struct => {
        const code = safeStr(struct['Structure']).trim();
        const libelle = safeStr(struct['Libelle']).trim();
        let label = libelle;

        if (code && code.toLowerCase() !== libelle.toLowerCase()) {
            label = `${code} - ${libelle}`;
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
}

// --- MOTEUR DE RECHERCHE ET FILTRAGE ---

/**
 * Pilote la recherche, le filtrage et le tri des résultats.
 */
function performSearch() {
    const textQuery = document.getElementById('searchInput').value.trim().toLowerCase();
    const select = document.getElementById('select-structure');
    const structIdVal = select ? select.value : null;
    const structId = structIdVal ? parseInt(structIdVal, 10) : null;

    if (!textQuery && !structId) {
        document.getElementById('resultArea').innerHTML = '';
        document.getElementById('page-title').innerText = 'Moteur de recherche';

        const qs = new URLSearchParams(window.location.search);
        qs.delete('structure');
        qs.delete('q');
        const queryString = qs.toString();
        const newUrl = queryString ? `?${queryString}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        return;
    }

    document.getElementById('loadingMessage').style.display = 'block';

    const qs = new URLSearchParams(window.location.search);
    if (structId) qs.set('structure', structId);
    else qs.delete('structure');

    if (textQuery) qs.set('q', textQuery);
    else qs.delete('q');

    const queryString = qs.toString();
    const newUrl = queryString ? `?${queryString}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);

    // Filtrage des agents
    const results = allAgents.filter(a => {
        const aStructId = window.resolveGristRef(a[COL_AGENT_STRUCT_REF]);

        if (structId !== null && aStructId !== structId) {
            return false;
        }

        if (textQuery) {
            const nom = safeStr(a[COL_AGENT_NOM]).toLowerCase();
            const prenom = safeStr(a[COL_AGENT_PRENOM]).toLowerCase();
            const fct = safeStr(a[COL_AGENT_FONCTION]).toLowerCase();
            const missions = safeStr(a[COL_AGENT_MISSIONS] || a['missions_du_poste']).toLowerCase();
            const projet = safeStr(a[COL_AGENT_PROJET] || a['Nom_du_projet']).toLowerCase();

            let structLibelle = '';
            let structCode = '';
            if (aStructId) {
                const s = structureMap.get(aStructId);
                if (s) {
                    structLibelle = safeStr(s[COL_STRUCT_LIBELLE]).toLowerCase();
                    structCode = safeStr(s[COL_STRUCT_CODE]).toLowerCase();
                }
            }

            return nom.includes(textQuery) ||
                prenom.includes(textQuery) ||
                fct.includes(textQuery) ||
                missions.includes(textQuery) ||
                projet.includes(textQuery) ||
                structLibelle.includes(textQuery) ||
                structCode.includes(textQuery);
        }

        return true;
    });

    let title = `${results.length} résultat(s)`;
    let description = 'Recherchez un agent ou un bureau.';

    if (structId) {
        const s = allStructures.find(st => st.id === structId);
        if (s) {
            const code = safeStr(s[COL_STRUCT_CODE]).trim();
            const libelle = safeStr(s[COL_STRUCT_LIBELLE]).trim();
            let label = (code && code.toLowerCase() !== libelle.toLowerCase()) ? `${code} - ${libelle}` : libelle;
            title = `Structure : ${label}`;

            const descStruct = safeHtml(s[COL_STRUCT_DESC] || s['description_structure']);
            if (descStruct) {
                description = descStruct;
            }

            if (textQuery) title += ` (recherche "${textQuery}")`;
        }
    } else if (textQuery) {
        title += ` pour "${textQuery}"`;
    }

    // --- TRI DES RÉSULTATS ---
    const norm = str => safeStr(str).toLowerCase().trim();

    let chefNameNormalized = "";
    if (structId) {
        const s = structureMap.get(structId);
        if (s) {
            const chefName = window.findResponsableName(s, agentsHierarchyMap);
            if (chefName) chefNameNormalized = norm(chefName);
        }
    }

    if (structId && !textQuery) {
        // Regroupement par pôle
        const groups = {};
        results.forEach(a => {
            const pole = safeStr(a['Pole_ou_section_'] || a['pole_ou_section_']).trim();
            if (!groups[pole]) groups[pole] = [];
            groups[pole].push(a);
        });

        const sortedKeys = Object.keys(groups).sort((k1, k2) => {
            if (!k1) return -1;
            if (!k2) return 1;
            return k1.localeCompare(k2);
        });

        const sortedGroups = [];
        sortedKeys.forEach(key => {
            const groupAgents = groups[key];
            groupAgents.sort((a, b) => {
                const scoreA = key ? getPoleScore(a) : getRoleScore(a, chefNameNormalized);
                const scoreB = key ? getPoleScore(b) : getRoleScore(b, chefNameNormalized);

                if (scoreA !== scoreB) return scoreB - scoreA;
                return norm(a[COL_AGENT_NOM]).localeCompare(norm(b[COL_AGENT_NOM]));
            });
            sortedGroups.push({ name: key, agents: groupAgents });
        });

        renderGroupedResults(sortedGroups, title, description);

    } else {
        // Liste plate triée
        results.sort((a, b) => {
            const scoreA = getRoleScore(a, chefNameNormalized);
            const scoreB = getRoleScore(b, chefNameNormalized);

            if (scoreA !== scoreB) return scoreB - scoreA;
            return norm(a[COL_AGENT_NOM]).localeCompare(norm(b[COL_AGENT_NOM]));
        });

        document.getElementById('page-title').innerText = title;
        document.getElementById('page-desc').innerHTML = description;
        renderResults(results, title);
    }

    document.getElementById('loadingMessage').style.display = 'none';
}

/**
 * Calcule un score de priorité hiérarchique (responsable, adjoint, secrétaire).
 */
function getRoleScore(agent, chefNameNormalized) {
    const nom = safeStr(agent[COL_AGENT_NOM]);
    const prenom = safeStr(agent[COL_AGENT_PRENOM]);
    const fullname = safeStr(prenom + " " + nom).toLowerCase().trim();
    const fullnameRev = safeStr(nom + " " + prenom).toLowerCase().trim();
    const fct = safeStr(agent[COL_AGENT_FONCTION]).toLowerCase();

    if (chefNameNormalized && (fullname.includes(chefNameNormalized) || fullnameRev.includes(chefNameNormalized))) {
        return 4;
    }
    if (fct.includes('adj') || fct.includes('second')) return 3;
    if (fct.includes('secre') || fct.includes('assist')) return 2;
    return 1;
}

/**
 * Calcule un score de priorité interne aux pôles.
 */
function getPoleScore(agent) {
    const fct = safeStr(agent[COL_AGENT_FONCTION]).toLowerCase();
    const isChefKeyword = fct.includes('chef') || fct.includes('responsable') || fct.includes('dirigeant') || fct.includes('tête');
    const isAdjointKeyword = fct.includes('adj') || fct.includes('second');

    if (isChefKeyword && !isAdjointKeyword) return 4;
    if (isAdjointKeyword) return 3;
    if (fct.includes('secré') || fct.includes('assist') || fct.includes('secretaire')) return 2;
    return 1;
}

// --- SYSTÈME DE RENDU DYNAMIQUE ---

/**
 * Affiche les résultats regroupés par pôle.
 */
function renderGroupedResults(groups, title, description) {
    const container = document.getElementById('resultArea');
    document.getElementById('page-title').innerText = title;
    document.getElementById('page-desc').innerHTML = description;

    if (groups.length === 0 || groups.every(g => g.agents.length === 0)) {
        container.innerHTML = `<div class="fr-alert fr-alert--warning fr-mt-2w"><p>Aucun agent trouvé.</p></div>`;
        return;
    }

    let html = '';
    groups.forEach(group => {
        if (group.name) {
            html += `
             <div class="fr-col-12 fr-mt-4w fr-mb-2w">
                <h3 class="fr-h5" style="border-bottom: 2px solid var(--background-action-high-blue-france); padding-bottom: 0.5rem;">
                    ${safeHtml(group.name)}
                </h3>
             </div>`;
        }
        html += `<div class="fr-grid-row fr-grid-row--gutters">`;
        group.agents.forEach(agent => {
            html += generateAgentCardHtml(agent);
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

/**
 * Génère le HTML d'une carte agent.
 */
function generateAgentCardHtml(agent) {
    const nom = `${safeHtml(agent[COL_AGENT_PRENOM])} ${safeHtml(agent[COL_AGENT_NOM])}`;
    const fct = safeHtml(agent[COL_AGENT_FONCTION]);
    const mailAgent = safeHtml(agent[COL_AGENT_MAIL]);
    const mailGeneric = safeHtml(agent[COL_AGENT_MAIL_GEN]);
    const tel = safeHtml(agent[COL_AGENT_TEL]);
    const mobile = safeHtml(agent[COL_AGENT_TEL_PORT]);
    const site = safeHtml(agent[COL_AGENT_SITE] || agent['site']);
    const piece = safeHtml(agent[COL_AGENT_BUREAU] || agent['Piece'] || agent['piece'] || agent['bureau']);

    let ttRaw = agent[COL_AGENT_TELETRAVAIL];
    let teletravail = '';
    if (Array.isArray(ttRaw)) {
        teletravail = safeHtml(ttRaw.filter(v => v !== 'L').join(', '));
    } else if (ttRaw) {
        let str = String(ttRaw);
        if (str.startsWith('L, ')) str = str.substring(3);
        teletravail = safeHtml(str);
    }

    const missions = safeHtml(agent[COL_AGENT_MISSIONS] || agent['missions_du_poste']);
    const projet = safeHtml(agent[COL_AGENT_PROJET] || agent['Nom_du_projet']);
    const roleProjet = safeHtml(agent[COL_AGENT_ROLE_PROJET] || agent['role_chef_projet_ou_participnt']);
    const pole = safeHtml(agent[COL_AGENT_POLE] || agent['pole_ou_section_']);
    const poleDesc = safeHtml(agent[COL_AGENT_DESC_POLE] || agent['description_pole']);
    const secteur = safeHtml(agent[COL_AGENT_SECTEUR] || agent['secteur_ou_cellule_'] || agent['Cellule'] || agent['Secteur']);
    const secteurDesc = safeHtml(agent[COL_AGENT_DESC_SECTEUR] || agent['description_secteur']);

    const structId = window.resolveGristRef(agent[COL_AGENT_STRUCT_REF]);
    const struct = structureMap.get(structId);
    const structName = struct ? window.safeHtml(struct[COL_STRUCT_LIBELLE]) : '';
    const structCode = struct ? window.safeHtml(struct[COL_STRUCT_CODE]) : '';

    const uniqueId = `agent-${Math.floor(Math.random() * 1000000)}`;

    return `
    <div class="fr-col-12 fr-col-md-6">
        <div class="agent-accordion" id="${uniqueId}">
            <div class="agent-header" onclick="toggleAgent('${uniqueId}')">
                <div class="agent-info">
                    <div style="font-weight:700; font-size:0.95rem; margin-bottom:0.1rem; color: var(--text-default-grey);">${nom}</div>
                    <div style="font-size:0.8rem; color: var(--text-mention-grey);">${fct}</div>
                    ${structCode ? `<div class="fr-badge fr-badge--sm fr-badge--info fr-mb-1v fr-mt-1w">${structCode}</div>` : ''}
                    ${structName ? `<div class="fr-badge fr-badge--sm fr-badge--purple-glycine fr-mt-1v" style="display:table;">${structName}</div>` : ''}
                </div>
                <span class="fr-icon-arrow-down-s-line agent-arrow"></span>
            </div>

            <div class="agent-details">
                <div class="details-grid">
                    <div class="detail-item">
                        <span class="detail-label">Fonction</span>
                        <div class="detail-value">${fct || '-'}</div>
                    </div>
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">Email</span>
                        <div class="detail-value" style="word-break: break-word;">
                            ${mailAgent ? `<div><button onclick="copyToClipboard('${mailAgent.toLowerCase()}', this)" style="background:none; border:none; padding:0; color:var(--text-action-high-blue-france); cursor:pointer; text-decoration:underline;" title="Copier">${mailAgent.toLowerCase()}</button></div>` : ''}
                            ${mailGeneric ? `<div class="fr-mt-1v"><i>Générique :</i><br>${mailGeneric.split(/;/).map(email => {
        const e = email.trim().toLowerCase();
        return e ? `<button onclick="copyToClipboard('${e}', this)" style="background:none; border:none; padding:0; color:var(--text-action-high-blue-france); cursor:pointer; text-decoration:underline;" title="Copier">${e}</button>` : '';
    }).filter(Boolean).join('<br>')
            }</div>` : ''}
                            ${!mailAgent && !mailGeneric ? '-' : ''}
                        </div>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Téléphone</span>
                        <div class="detail-value">
                            ${tel ? `<div>Fixe : <br><button onclick="copyToClipboard('${tel}', this)" style="background:none; border:none; padding:0; color:var(--text-action-high-blue-france); cursor:pointer; text-decoration:underline;" title="Copier">${tel}</button></div>` : ''}
                            ${mobile ? `<div>Portable : <br><button onclick="copyToClipboard('${mobile}', this)" style="background:none; border:none; padding:0; color:var(--text-action-high-blue-france); cursor:pointer; text-decoration:underline;" title="Copier">${mobile}</button></div>` : ''}
                            ${!tel && !mobile ? '-' : ''}
                        </div>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Site / Bureau</span>
                        <div class="detail-value">${[site, piece].filter(Boolean).join(' / ') || '-'}</div>
                    </div>

                    ${teletravail ? `
                    <div class="detail-item">
                        <span class="detail-label">Télétravail</span>
                        <div class="detail-value">${teletravail}</div>
                    </div>` : ''}
                    
                    ${pole ? `
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">Pôle ou Section</span>
                        <div class="detail-value">
                            ${pole}
                            ${poleDesc ? `<p class="fr-text--xs fr-text--mention-grey fr-mb-0 fr-mt-1v" style="font-weight:400; font-style:italic;">${poleDesc}</p>` : ''}
                        </div>
                    </div>` : ''}

                    ${secteur ? `
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">Secteur ou Cellule</span>
                        <div class="detail-value">
                            ${secteur}
                            ${secteurDesc ? `<p class="fr-text--xs fr-text--mention-grey fr-mb-0 fr-mt-1v" style="font-weight:400; font-style:italic;">${secteurDesc}</p>` : ''}
                        </div>
                    </div>` : ''}
                    
                    ${missions ? `
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">Missions du poste</span>
                        <div class="detail-value">${missions}</div>
                    </div>` : ''}

                    ${projet ? `
                    <div class="detail-item" style="grid-column: span 2;">
                        <span class="detail-label">Projet</span>
                        <div class="detail-value">
                            ${roleProjet ? `<span class="fr-badge fr-badge--sm fr-badge--green-emeraude fr-mr-1w" style="vertical-align: middle;">${roleProjet}</span>` : ''}
                            <strong style="vertical-align: middle;">${projet}</strong>
                        </div>
                    </div>` : ''}
                </div>
            </div>
        </div>
    </div>`;
}

/**
 * Affiche les résultats sous forme de liste plate.
 */
function renderResults(agents, title) {
    const container = document.getElementById('resultArea');

    if (agents.length === 0) {
        container.innerHTML = `
            <div class="fr-alert fr-alert--warning fr-mt-2w">
                <p>Aucun agent trouvé correspondant à vos critères.</p>
            </div>`;
        return;
    }

    let html = `<h2 class="fr-h6 fr-mb-2w fr-mt-2w">${safeHtml(title)}</h2>`;
    html += `<div class="fr-grid-row fr-grid-row--gutters">`;
    agents.forEach(agent => {
        html += generateAgentCardHtml(agent);
    });
    html += `</div>`;
    container.innerHTML = html;
}
