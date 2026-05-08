const fs = require('fs');
const path = require('path');
const llmService = require('./llm-service');

const savesDir = path.join(__dirname, '../../data/saves');
const nationsPath = path.join(__dirname, '../../data/nations_v2.json');
const START_DATE_RANGE = { min: '2000-01-01', max: '2024-12-31' };
const DEFAULT_START_DATE = '2024-01-01';

/**
 * Game Engine - File-based game logic for Pax Historia
 */
class GameEngine {
    constructor() {
        if (!fs.existsSync(savesDir)) {
            fs.mkdirSync(savesDir, { recursive: true });
        }
    }

    getNations() {
        if (fs.existsSync(nationsPath)) {
            return JSON.parse(fs.readFileSync(nationsPath, 'utf-8'));
        }
        return {};
    }

    normalizeStartDate(startDate) {
        if (!startDate) return DEFAULT_START_DATE;
        const parsed = new Date(startDate);
        if (Number.isNaN(parsed.getTime())) return DEFAULT_START_DATE;

        const minDate = new Date(START_DATE_RANGE.min);
        const maxDate = new Date(START_DATE_RANGE.max);
        if (parsed < minDate || parsed > maxDate) return DEFAULT_START_DATE;

        return parsed.toISOString().split('T')[0];
    }

    cloneGameState(gameState) {
        if (typeof structuredClone === 'function') {
            return structuredClone(gameState);
        }
        return JSON.parse(JSON.stringify(gameState));
    }

    buildCorruptedSave(saveId, error) {
        const message = error?.message || 'Save file is corrupted or incompatible.';
        const now = new Date().toISOString();
        return {
            id: saveId,
            name: 'Corrupted Save',
            playerNationCode: null,
            currentDate: null,
            turnNumber: 0,
            nations: {},
            chats: [],
            actions: [],
            events: [
                {
                    id: Date.now().toString(),
                    title: 'Save Corrupted',
                    description: message,
                    event_type: 'save_corrupted',
                    severity: 'critical',
                    affected_nations: [],
                    state_changes: {},
                    game_date: now.split('T')[0],
                    created_at: now,
                    turn_number: 0
                }
            ],
            units: [],
            history: [],
            created_at: now,
            error: {
                type: 'save_corrupted',
                message
            }
        };
    }

    isValidSave(gameState) {
        if (!gameState || typeof gameState !== 'object') return false;
        if (!gameState.playerNationCode || !gameState.currentDate) return false;
        if (!gameState.nations || typeof gameState.nations !== 'object') return false;
        return true;
    }

    /**
     * Create a new game
     */
    async createGame(playerNationCode, startDate = DEFAULT_START_DATE) {
        const nations = this.getNations();
        const playerNation = nations[playerNationCode];
        const normalizedStartDate = this.normalizeStartDate(startDate);

        if (!playerNation) {
            throw new Error(`Nation ${playerNationCode} not found`);
        }

        const saveId = Date.now().toString();
        const gameState = {
            id: saveId,
            name: `${playerNation.name} - ${normalizedStartDate}`,
            playerNationCode: playerNationCode,
            currentDate: normalizedStartDate,
            turnNumber: 1,
            nations: {},
            chats: [],
            actions: [],
            events: [],
            units: [],
            history: [],
            created_at: new Date().toISOString(),
            world_context: "Modern 2024 start. A multipolar world faces great-power rivalry, regional wars, and rapid technological shifts.",
            simulation_rules: "1. Realistic consequences. 2. Diplomatic weight. 3. Historical plausibility with player flexibility."
        };

        // Initialize all nations
        Object.keys(nations).forEach(code => {
            const nation = nations[code];
            gameState.nations[code] = {
                code: code,
                stability: 70,
                warSupport: 20,
                manpower: nation.manpower || 100000,
                politicalPower: 100,
                treasury: 1000,
                atWar: false,
                relations: {},
                occupied_regions: []
            };
        });

        // Create starting units
        this.createStartingUnits(gameState);

        this.saveGame(saveId, gameState);

        return {
            save_id: saveId,
            player_nation: playerNation,
            current_date: normalizedStartDate,
            turn_number: 1
        };
    }

    /**
     * Process player action
     */
    async processPlayerAction(saveId, actionText, actionType = 'general') {
        const gameState = await this.loadGame(saveId);

        const newAction = {
            id: Date.now().toString(),
            save_id: saveId,
            nation_code: gameState.playerNationCode,
            action_text: actionText,
            action_type: actionType,
            status: 'pending',
            turn_number: gameState.turnNumber,
            created_at: new Date().toISOString()
        };

        if (!gameState.actions) gameState.actions = [];
        gameState.actions.push(newAction);

        this.saveGame(saveId, gameState);
        return newAction;
    }

    /**
     * Save game to local JSON
     */
    saveGame(saveId, gameState) {
        const filePath = path.join(savesDir, `${saveId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(gameState, null, 2));
    }

    /**
     * Load game from local JSON
     */
    async loadGame(saveId) {
        const filePath = path.join(savesDir, `${saveId}.json`);
        if (!fs.existsSync(filePath)) {
            throw new Error('Save not found');
        }

        let gameState;
        try {
            gameState = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (error) {
            return this.buildCorruptedSave(saveId, error);
        }
        if (!this.isValidSave(gameState)) {
            return this.buildCorruptedSave(saveId, new Error('Save file schema mismatch.'));
        }
        const nations = this.getNations();

        return {
            ...gameState,
            playerNation: nations[gameState.playerNationCode],
            events: gameState.events || [],
            actions: gameState.actions || []
        };
    }

    async getSaves() {
        if (!fs.existsSync(savesDir)) return [];
        const files = fs.readdirSync(savesDir).filter(f => f.endsWith('.json'));
        const nations = this.getNations();

        return files.map(file => {
            const filePath = path.join(savesDir, file);
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!this.isValidSave(data)) {
                    throw new Error('Save file schema mismatch.');
                }
                return {
                    id: data.id,
                    name: data.name,
                    nation_code: data.playerNationCode,
                    nation_name: nations[data.playerNationCode]?.name || 'Unknown',
                    current_date: data.currentDate,
                    updated_at: data.created_at
                };
            } catch (error) {
                const fallbackId = path.basename(file, '.json');
                return {
                    id: fallbackId,
                    name: 'Corrupted Save',
                    nation_code: null,
                    nation_name: 'Corrupted Save',
                    current_date: null,
                    updated_at: null,
                    error: 'save_corrupted'
                };
            }
        });
    }

    async deleteSave(saveId) {
        const filePath = path.join(savesDir, `${saveId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }

    /**
     * Create starting units for the world
     */
    createStartingUnits(gameState) {
        const startingUnits = [
            // ITALY
            { name: "1a Divisione Eritrea", type: "infantry", nation: "ITA", region: "Asmara", coords: [860, 460] },
            { name: "2a Divisione Eritrea", type: "infantry", nation: "ITA", region: "Massaua", coords: [870, 450] },
            { name: "Corpo d'Armata Indigeno", type: "infantry", nation: "ITA", region: "Eritrea", coords: [850, 470] },
            { name: "Divisione Gavinana", type: "infantry", nation: "ITA", region: "Adigrat", coords: [880, 490] },

            // ETHIOPIA
            { name: "Guardia Imperiale Kebur Zabagna", type: "infantry", nation: "ETH", region: "Addis Abeba", coords: [880, 480] },
            { name: "Armata dell'Ogaden", type: "infantry", nation: "ETH", region: "Ogaden", coords: [920, 500] },
            { name: "Armata del Nord", type: "infantry", nation: "ETH", region: "Amhara", coords: [860, 490] },

            // GERMANY
            { name: "1. Panzer-Division", type: "armor", nation: "GER", region: "Berlin", coords: [750, 120] },
            { name: "1. Infanterie-Division", type: "infantry", nation: "GER", region: "East Prussia", coords: [800, 100] },

            // FRANCE
            { name: "1ère Division Blindée", type: "armor", nation: "FRA", region: "Paris", coords: [660, 150] },
            { name: "7ème Armée", type: "infantry", nation: "FRA", region: "Metz", coords: [690, 140] },

            // UK
            { name: "Home Fleet", type: "naval", nation: "ENG", region: "Scapa Flow", coords: [620, 80] },
            { name: "British Expeditionary Force", type: "infantry", nation: "ENG", region: "London", coords: [640, 125] }
        ];

        gameState.units = startingUnits.map((u, index) => ({
            id: `unit_${Date.now()}_${index}`,
            name: u.name,
            unit_type: u.type,
            nation_code: u.nation,
            region_id: u.region,
            centroid: u.coords, // For map placement
            strength: 100,
            organization: 100,
            experience: 0,
            created_at: gameState.created_at
        }));
    }

    /**
     * Advance time (process turn) - AI FULL INTEGRATION
     */
    async advanceTime(saveId, timeJump) {
        const gameState = await this.loadGame(saveId);
        const currentDate = new Date(gameState.currentDate);
        const updatedGameState = this.cloneGameState(gameState);

        // 1. Prepare AI Context
        const pendingActions = (gameState.actions || []).filter(a => a.status === 'pending');
        const gameContext = {
            currentDate: gameState.currentDate,
            playerNation: gameState.playerNation,
            actions: pendingActions,
            recentEvents: (gameState.events || []).slice(-10),
            worldState: this.buildWorldStateSummary(gameState),
            worldContext: gameState.world_context,
            simulationRules: gameState.simulation_rules
        };

        // 2. Call AI to generate consequences and events
        console.log(`[Engine] Generating turn events for ${saveId} (${timeJump})...`);
        const aiResult = await llmService.generateEvents(timeJump, gameContext);

        if (aiResult.error) {
            console.error(`[Engine] AI Generation Error: ${aiResult.error}`);
        }

        console.log(`[Engine] Received ${aiResult.events?.length || 0} events from AI.`);

        // 3. Process consequences and update state
        if (aiResult.events && aiResult.events.length > 0) {
            aiResult.events.forEach(event => {
                const newEvent = {
                    ...event,
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    game_date: updatedGameState.currentDate,
                    created_at: new Date().toISOString(),
                    turn_number: updatedGameState.turnNumber
                };
                updatedGameState.events.push(newEvent);

                // Apply state changes from event to nations
                if (event.state_changes) {
                    Object.keys(event.state_changes).forEach(nationCode => {
                        const changes = event.state_changes[nationCode];
                        const nationState = updatedGameState.nations[nationCode.toUpperCase()];
                        if (nationState) {
                            if (changes.stability) nationState.stability = Math.max(0, Math.min(100, (nationState.stability || 70) + changes.stability));
                            if (changes.war_support) nationState.warSupport = Math.max(0, Math.min(100, (nationState.warSupport || 20) + changes.war_support));
                            if (changes.treasury) nationState.treasury = (nationState.treasury || 1000) + changes.treasury;
                            if (changes.occupied_regions) {
                                nationState.occupied_regions = [...new Set([...(nationState.occupied_regions || []), ...changes.occupied_regions])];
                            }
                        }
                    });
                }
            });
        }

        // 4. Update Game Date and Turn
        const nextDate = this.calculateNewDate(currentDate, timeJump);
        updatedGameState.currentDate = nextDate.toISOString().split('T')[0];
        updatedGameState.turnNumber += 1;

        // 5. Mark pending actions as completed
        pendingActions.forEach(a => {
            const action = updatedGameState.actions.find(act => act.id === a.id);
            if (action) action.status = 'completed';
        });

        // 6. Save and Return
        this.saveGame(saveId, updatedGameState);

        return {
            previous_date: currentDate.toISOString().split('T')[0],
            new_date: updatedGameState.currentDate,
            turn_number: updatedGameState.turnNumber,
            events: aiResult.events || [],
            processed_actions: pendingActions.length
        };
    }

    buildWorldStateSummary(gameState) {
        const nations = this.getNations();
        const summary = {};

        // 1. Identify priority nations to stay within token limits
        const priorityNations = new Set();
        priorityNations.add(gameState.playerNationCode);

        // Add Nations from Pending Actions
        (gameState.actions || []).filter(a => a.status === 'pending').forEach(a => {
            if (a.nation_code) priorityNations.add(a.nation_code);
            // If the action text mentions a country code (regex), add it
            const mentions = a.action_text?.match(/[A-Z]{3}/g);
            if (mentions) mentions.forEach(m => priorityNations.add(m));
        });

        // Add Nations from Recent Events
        (gameState.events || []).slice(-10).forEach(e => {
            if (e.affected_nations) e.affected_nations.forEach(n => priorityNations.add(n));
        });

        // Add Major Powers
        Object.keys(nations).forEach(code => {
            if (nations[code].is_major_power) priorityNations.add(code);
        });

        // 2. Build summary for prioritizing nations
        Object.keys(gameState.nations).forEach(code => {
            if (priorityNations.has(code)) {
                const state = gameState.nations[code];
                const info = nations[code];
                if (info) {
                    summary[code] = {
                        name: info.name,
                        stability: state.stability,
                        war_support: state.warSupport,
                        occupied: state.occupied_regions?.length || 0,
                        at_war: state.atWar
                    };
                }
            }
        });

        return summary;
    }

    calculateNewDate(currentDate, timeJump) {
        const newDate = new Date(currentDate);
        switch (timeJump) {
            case '1_week': newDate.setDate(newDate.getDate() + 7); break;
            case '1_month': newDate.setMonth(newDate.getMonth() + 1); break;
            case '3_months': newDate.setMonth(newDate.getMonth() + 3); break;
            case '6_months': newDate.setMonth(newDate.getMonth() + 6); break;
            case '1_year': newDate.setFullYear(newDate.getFullYear() + 1); break;
            default:
                // Handle arbitrary numeric days if passed or fallback to 1 day
                const days = parseInt(timeJump);
                if (!isNaN(days)) {
                    newDate.setDate(newDate.getDate() + days);
                } else {
                    newDate.setDate(newDate.getDate() + 1);
                }
        }
        return newDate;
    }

    async getAdvisorContext(saveId) {
        const gameState = await this.loadGame(saveId);
        const nations = this.getNations();

        const playerFull = {
            ...gameState.playerNation,
            ...gameState.nations[gameState.playerNationCode]
        };

        return {
            currentDate: gameState.currentDate,
            playerNation: {
                name: playerFull.name,
                code: playerFull.code,
                atWar: playerFull.atWar,
                occupied_regions: playerFull.occupied_regions || []
            },
            worldState: this.buildWorldStateSummary(gameState),
            recentEvents: (gameState.events || []).slice(-10),
            pendingActions: (gameState.actions || []).filter(a => a.status === 'pending'),
            worldContext: gameState.world_context,
            simulationRules: gameState.simulation_rules,
            turnNumber: gameState.turnNumber || 1
        };
    }

    async renameSave(saveId, newName) {
        const gameState = await this.loadGame(saveId);
        gameState.name = newName;
        this.saveGame(saveId, gameState);
    }
}

module.exports = GameEngine;
